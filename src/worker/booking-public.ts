// ── booking-public.ts — LOT BOOKING (Sprint 3) ─────────────────────────────
//
// Moteur de réservation client pro (niveau GHL/Calendly) + CRUD des types de
// RDV (booking_event_types). Fichier NEUF et ISOLÉ — N'ÉTEND PAS bookings.ts
// (l'existant `handlePublicBookingPage` / `handlePublicCreateBooking` reste
// intact pour rétro-compat). Le moteur de créneaux ici est CORRECT en fuseau ;
// `src/worker/calendar.ts:handleGetAvailability` (vue interne Calendar.tsx)
// reste INTACT — zéro régression.
//
// ⚠ CORPS RÉELS PHASE B — Manager-B SOLO sur ce fichier. Les signatures
//   (ordre/typage des params, forme de la Response) NE CHANGENT PAS :
//   worker.ts (GELÉ Phase A) câble déjà ces handlers ; src/lib/api.ts (GELÉ
//   Phase A) appelle les endpoints. Contrat §6 verbatim dans
//   docs/LOT-BOOKING.md (Phase B/C ne lisent QUE ce document + le CODE).
//
// Conventions imposées (docs/LOT-BOOKING.md §6.A/§6.C/§6.D/§6.F/§6.I) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS — §6.A).
//   - Garde capability protégée : requireCapability(auth.capabilities,
//     'workflows.manage') en tête des handlers CRUD (réutilise la capability
//     EXISTANTE — AUCUN ajout à ALL_CAPABILITIES). Pattern calqué
//     funnels.ts:capGuard / clients-admin.ts.
//   - Bornage tenant : calque clients-admin.ts:assertClientInTenant
//     (isLegacy → pas de garde nouvelle ; mode agence → agency_id ∈ tenant
//     OU client_id ∈ accessibleClientIds, sinon 404 'Introuvable').
//   - Moteur de créneaux : algo §6.C (heure locale du booking_pages.timezone,
//     défaut 'America/Toronto' ; DST déterministe via Intl.DateTimeFormat ;
//     soustraction bookings 'confirmed' ∪ appointments ∪ date_overrides ;
//     buffers / min_notice / pas = slot_step_min ; sortie ISO8601 UTC).
//   - Booking → CRM (handlePublicCreateBookingV2) : RÉUTILISE le pipeline
//     forms.ts (PAS de dup dedup) — applyLeadMapping / resolveDedup /
//     mergeIntoLead / logIngestConsent / INSERT leads borné client_id /
//     autoEnrollForTrigger(env,'appointment_booked',leadId) — source
//     ='booking'. Cf. §6.F.
//   - Statut bookings : énumération seq 7 INTOUCHABLE
//     ('confirmed','cancelled','completed','no_show') — JAMAIS 'pending'.
//   - best-effort : table/colonne absente → réponse propre (404 / {data:[]}),
//     JAMAIS de 500/throw non maîtrisé.

import { Resend } from 'resend';
import type { Env } from './types';
import { json, sanitizeInput, createNotification, sendSms } from './helpers';
import { requireCapability, type CapAuth } from './capabilities';
import { autoEnrollForTrigger } from './workflows';
// Sprint P0-2 — helpers PURS partagés (validateBookingInput honeypot V2).
// `isCancellable` et `hashBookingToken` exposés par lib/booking-engine sont
// importables ici si on durcit la fenêtre cancel plus tard (non-breaking
// uniquement avec un opt-in via query param ou config event_type).
import { validateBookingInput, BOOKING_ERROR_CODES } from './lib/booking-engine';

// Auth enrichi au choke-point (worker.ts) — calque le type passé à
// routeProtected (userId/role/clientId/tenant/capabilities).
export type BookingAuth = CapAuth & { capabilities?: Set<string> };

// ════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ════════════════════════════════════════════════════════════════════════════

// Garde capability (calque funnels.ts:capGuard / clients-admin.ts). Réutilise
// 'workflows.manage' (déjà dans ALL_CAPABILITIES seq 80). En legacy/mono-tenant
// le set est LARGE ⇒ pas de régression ; bridage actif en mode agence.
function capGuard(auth: BookingAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'workflows.manage');
}

// Bornage tenant sur une row porteuse de client_id/agency_id (calque
// funnels.ts:loadFunnelInTenant + clients-admin.ts:assertClientInTenant).
//   - Legacy/mono-tenant (!tenant || agencyId == null) → true : endpoints
//     NEUFS, rétro-compat byte-équivalente à l'absence historique de borne.
//   - Mode agence (agencyId != null) → client_id ∈ accessibleClientIds OU
//     agency_id == auth.tenant.agencyId, sinon false ⇒ 404 'Introuvable'.
function rowInTenant(
  row: { client_id?: unknown; agency_id?: unknown },
  auth: BookingAuth,
): boolean {
  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return true;
  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  const rowAgency = (row.agency_id as string | null) ?? null;
  return (
    (rowClient != null && accessible.includes(rowClient)) ||
    (rowAgency != null && rowAgency === agencyId)
  );
}

interface ResolvedEventType {
  id: string | null;
  duration_minutes: number;
  buffer_before_min: number;
  buffer_after_min: number;
  slot_step_min: number;
  min_notice_min: number;
}

// Résout le type de RDV applicable (§6.C étape 2) : event_type_id fourni →
// row exacte sinon premier actif de la page sinon fallback dérivé de la page.
async function resolveEventType(
  env: Env,
  page: Record<string, unknown>,
  eventTypeId: string | null,
): Promise<ResolvedEventType> {
  const pageId = page.id as string;
  let et: Record<string, unknown> | null = null;
  try {
    if (eventTypeId) {
      et = (await env.DB.prepare(
        'SELECT * FROM booking_event_types WHERE id = ? AND booking_page_id = ? AND is_active = 1',
      )
        .bind(eventTypeId, pageId)
        .first()) as Record<string, unknown> | null;
    }
    if (!et) {
      et = (await env.DB.prepare(
        'SELECT * FROM booking_event_types WHERE booking_page_id = ? AND is_active = 1 ORDER BY created_at ASC LIMIT 1',
      )
        .bind(pageId)
        .first()) as Record<string, unknown> | null;
    }
  } catch {
    // Table seq 84 absente : best-effort → fallback dérivé de la page.
    et = null;
  }
  if (et) {
    return {
      id: et.id as string,
      duration_minutes: Number(et.duration_minutes) || 30,
      buffer_before_min: Number(et.buffer_before_min) || 0,
      buffer_after_min: Number(et.buffer_after_min) || 0,
      slot_step_min: Number(et.slot_step_min) || 30,
      min_notice_min: Number(et.min_notice_min) || 0,
    };
  }
  // Fallback dérivé de la page (§6.C étape 2).
  return {
    id: null,
    duration_minutes: Number(page.duration_minutes) || 30,
    buffer_before_min: 0,
    buffer_after_min: Number(page.buffer_minutes) || 0,
    slot_step_min: 30,
    min_notice_min: 0,
  };
}

// Premier user rattaché au client (calque résolution admin bookings.ts:60).
async function firstUserOf(env: Env, clientId: string): Promise<string | null> {
  try {
    const r = (await env.DB.prepare(
      "SELECT id FROM users WHERE client_id = ? AND is_active = 1 ORDER BY created_at ASC LIMIT 1",
    )
      .bind(clientId)
      .first()) as { id: string } | null;
    if (r?.id) return r.id;
  } catch {
    /* colonne client_id absente / panne D1 : best-effort */
  }
  // Fallback ultime : un admin actif (calque bookings.ts:60).
  try {
    const a = (await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY created_at ASC LIMIT 1",
    ).first()) as { id: string } | null;
    return a?.id ?? null;
  } catch {
    return null;
  }
}

// ── Conversion locale ↔ UTC DÉTERMINISTE (DST géré) — §6.C ──────────────────
// INTERDIT : `new Date(`${date}T${hh}:mm:00Z`)` (bug calendar.ts:132 /
// bookings.ts:34 — heure locale traitée comme UTC). Méthode : on calcule
// l'offset effectif du fuseau `tz` à l'instant considéré via
// Intl.DateTimeFormat (timeZone), puis on ajuste. Itération unique suffit
// (la frontière DST ne se produit jamais à l'intérieur d'une plage de
// disponibilité raisonnable ; double-passe pour robustesse aux bornes).

// Offset (en minutes) du fuseau `tz` pour un instant UTC donné. Positif =
// fuseau en avance sur UTC (ex. Europe/Paris été = +120). America/Toronto
// hiver = -300, été = -240.
function tzOffsetMinutes(utcMs: number, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
    // Composantes "heure-mur" du fuseau réinterprétées comme un instant UTC.
    const asUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    return Math.round((asUtc - utcMs) / 60000);
  } catch {
    return 0; // Intl/timeZone indispo : best-effort (traite comme UTC).
  }
}

// Instant UTC (ms) correspondant à une heure-mur locale (`date` 'YYYY-MM-DD',
// `hhmm` 'HH:MM') dans le fuseau `tz`. Double-passe : 1ʳᵉ estimation avec
// offset au "naïf UTC", correction avec l'offset réel à l'instant estimé
// (gère DST de façon déterministe aux frontières).
function utcInstant(date: string, hhmm: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const naiveUtc = Date.UTC(
    y || 1970,
    (m || 1) - 1,
    d || 1,
    hh || 0,
    mm || 0,
    0,
  );
  const off1 = tzOffsetMinutes(naiveUtc, tz);
  const guess = naiveUtc - off1 * 60000;
  const off2 = tzOffsetMinutes(guess, tz);
  return naiveUtc - off2 * 60000;
}

// Jour de semaine (0=dim..6=sam) d'une date dans le fuseau `tz`.
function weekdayInTz(date: string, tz: string): number {
  try {
    const noonUtc = utcInstant(date, '12:00', tz);
    const wd = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
    }).format(new Date(noonUtc));
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[wd] ?? new Date(`${date}T12:00:00Z`).getUTCDay();
  } catch {
    return new Date(`${date}T12:00:00Z`).getUTCDay();
  }
}

interface Interval {
  from: number;
  to: number;
}

function overlapsAny(a: Interval, busy: Interval[]): boolean {
  for (const b of busy) {
    if (a.from < b.to && a.to > b.from) return true;
  }
  return false;
}

// Moteur de créneaux pur (algo §6.C verbatim). Best-effort : à tout échec
// (page absente / owner null / table manquante) retourne []. Réutilisé par
// handleGetBookingAvailability ET les re-checks anti-collision (create /
// reschedule).
async function computeSlots(
  env: Env,
  page: Record<string, unknown>,
  eventTypeId: string | null,
  date: string,
): Promise<{ slots: string[]; et: ResolvedEventType; ownerUserId: string | null }> {
  const pageId = page.id as string;
  const clientId = (page.client_id as string) || '';
  const tz = (page.timezone as string) || 'America/Toronto';

  const et = await resolveEventType(env, page, eventTypeId);

  let ownerUserId = (page.owner_user_id as string | null) || null;
  if (!ownerUserId) ownerUserId = await firstUserOf(env, clientId);
  if (!ownerUserId) return { slots: [], et, ownerUserId: null };

  const dow = weekdayInTz(date, tz);

  // date_overrides : jour bloqué (congé / férié QC) → aucun créneau.
  try {
    const ov = (await env.DB.prepare(
      'SELECT is_available FROM date_overrides WHERE user_id = ? AND date = ?',
    )
      .bind(ownerUserId, date)
      .first()) as { is_available: number } | null;
    if (ov && Number(ov.is_available) === 0) {
      return { slots: [], et, ownerUserId };
    }
  } catch {
    /* table seq 32 absente : best-effort */
  }

  // Règles de disponibilité (fenêtres locales du fuseau tz).
  let rules: Array<{ start_time: string; end_time: string }> = [];
  try {
    const { results } = await env.DB.prepare(
      'SELECT start_time, end_time FROM availability_rules WHERE user_id = ? AND day_of_week = ? AND is_active = 1',
    )
      .bind(ownerUserId, dow)
      .all();
    rules = (results || []) as Array<{ start_time: string; end_time: string }>;
  } catch {
    rules = [];
  }
  if (rules.length === 0) return { slots: [], et, ownerUserId };

  // Occupations du jour : bookings 'confirmed' (seq 7) ∪ appointments
  // (assignee_user_id, confirmed/scheduled). Bornes larges sur la journée
  // locale (±36h autour du midi local → couvre tout chevauchement).
  const dayStartUtc = utcInstant(date, '00:00', tz);
  const dayEndUtc = dayStartUtc + 24 * 3600 * 1000;
  const winLo = new Date(dayStartUtc - 36 * 3600 * 1000).toISOString();
  const winHi = new Date(dayEndUtc + 36 * 3600 * 1000).toISOString();
  const busy: Interval[] = [];

  try {
    const { results } = await env.DB.prepare(
      "SELECT start_time, end_time FROM bookings WHERE booking_page_id = ? AND status = 'confirmed' AND start_time < ? AND end_time > ?",
    )
      .bind(pageId, winHi, winLo)
      .all();
    for (const r of (results || []) as Array<{ start_time: string; end_time: string }>) {
      const f = Date.parse(r.start_time);
      const t = Date.parse(r.end_time);
      if (!Number.isNaN(f) && !Number.isNaN(t)) busy.push({ from: f, to: t });
    }
  } catch {
    /* best-effort */
  }

  try {
    const { results } = await env.DB.prepare(
      "SELECT start_time, end_time FROM appointments WHERE assignee_user_id = ? AND status IN ('confirmed','scheduled') AND start_time < ? AND end_time > ?",
    )
      .bind(ownerUserId, winHi, winLo)
      .all();
    for (const r of (results || []) as Array<{ start_time: string; end_time: string }>) {
      const f = Date.parse(r.start_time);
      const t = Date.parse(r.end_time);
      if (!Number.isNaN(f) && !Number.isNaN(t)) busy.push({ from: f, to: t });
    }
  } catch {
    /* table seq 32 colonne absente : best-effort */
  }

  const stepMs = et.slot_step_min * 60000;
  const durMs = et.duration_minutes * 60000;
  const bufBeforeMs = et.buffer_before_min * 60000;
  const bufAfterMs = et.buffer_after_min * 60000;
  const minNoticeMs = et.min_notice_min * 60000;
  const nowUtc = Date.now();

  const out = new Set<string>();
  for (const r of rules) {
    if (!r.start_time || !r.end_time || stepMs <= 0) continue;
    const winStart = utcInstant(date, String(r.start_time).slice(0, 5), tz);
    const winEnd = utcInstant(date, String(r.end_time).slice(0, 5), tz);
    for (let s = winStart; s + durMs + bufAfterMs <= winEnd; s += stepMs) {
      if (s - bufBeforeMs < winStart) continue;
      if (s < nowUtc + minNoticeMs) continue;
      const widened: Interval = {
        from: s - bufBeforeMs,
        to: s + durMs + bufAfterMs,
      };
      if (overlapsAny(widened, busy)) continue;
      out.add(new Date(s).toISOString());
    }
  }
  const slots = Array.from(out).sort();
  return { slots, et, ownerUserId };
}

// Charge la booking_page active d'un slug (best-effort).
async function loadActivePage(
  env: Env,
  slug: string,
): Promise<Record<string, unknown> | null> {
  try {
    return (await env.DB.prepare(
      'SELECT * FROM booking_pages WHERE slug = ? AND is_active = 1',
    )
      .bind(slug)
      .first()) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ENDPOINTS PUBLICS (pré-requireAuth — slug tenant résolu côté handler)
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/book/:slug/availability?date=YYYY-MM-DD[&event_type_id=...]
 *
 * Moteur de créneaux CORRECT en fuseau (algo §6.C). Résout
 * slug→booking_page→event_type→owner_user_id→client_id, calcule les créneaux
 * libres pour la date demandée en heure locale du `booking_pages.timezone`
 * (défaut 'America/Toronto'), soustrait bookings 'confirmed' ∪ appointments
 * (assignee_user_id, statuts confirmed/scheduled) ∪ date_overrides, applique
 * buffer_before_min / buffer_after_min / min_notice_min / pas = slot_step_min,
 * convertit local↔UTC de façon déterministe (DST géré).
 *
 * Succès : json({ data: { slots: string[] } }) — ISO8601 UTC, triés.
 */
export async function handleGetBookingAvailability(
  env: Env,
  url: URL,
  slug: string,
): Promise<Response> {
  if (!slug) return json({ error: 'Slug requis' }, 400);
  const date = url.searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // Date absente/invalide : best-effort → aucun créneau (pas de 500).
    return json({ data: { slots: [] as string[] } });
  }
  const page = await loadActivePage(env, slug);
  if (!page) return json({ error: 'Page non trouvée' }, 404);

  const eventTypeId = url.searchParams.get('event_type_id');
  try {
    const { slots } = await computeSlots(env, page, eventTypeId, date);
    return json({ data: { slots } });
  } catch {
    // Best-effort absolu : jamais de 500 sur un endpoint public.
    return json({ data: { slots: [] as string[] } });
  }
}

/**
 * GET /api/book/:slug/meta
 *
 * Métadonnées PUBLIQUES de la booking page (Sprint 3-bis) : permet au front
 * `/book/$slug` d'afficher un sélecteur de type de RDV et de re-localiser les
 * créneaux dans le fuseau de la page (et non du visiteur). Calque la
 * projection minimale de funnels.ts:handlePublicFunnelGet — ZÉRO donnée
 * tenant sensible exposée (pas de client_id / agency_id / owner_user_id / ids
 * internes / price_cents). Best-effort : slug introuvable/offline → 404
 * propre ; table seq 84 absente → event_types:[] + champs page de base ;
 * jamais 500/throw. Réponse {data}/{error} UNIQUEMENT (jamais `code` — §6.A).
 *
 * Succès : json({ data: { page:{ slug, name?, description?, timezone,
 *   confirmation_message? }, event_types:[{ id, name, description,
 *   duration_minutes, buffer_before_min, buffer_after_min }] } }).
 */
export async function handleGetPublicBookingMeta(
  env: Env,
  _url: URL,
  slug: string,
): Promise<Response> {
  if (!slug) return json({ error: 'Slug requis' }, 404);

  const page = await loadActivePage(env, slug);
  if (!page) return json({ error: 'Page non trouvée' }, 404);

  // Types de RDV actifs de CETTE page uniquement (jointure applicative par
  // booking_page_id — pas de FK). best-effort : table seq 84 absente → [].
  let eventTypes: Array<Record<string, unknown>> = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, description, duration_minutes, buffer_before_min, buffer_after_min
         FROM booking_event_types
        WHERE booking_page_id = ? AND is_active = 1
        ORDER BY created_at ASC LIMIT 50`,
    )
      .bind(page.id as string)
      .all();
    eventTypes = (results || []) as Array<Record<string, unknown>>;
  } catch {
    // Table seq 84 absente : best-effort → aucun type (fallback page côté moteur).
    eventTypes = [];
  }

  // Projection minimale STRICTE (calque handlePublicFunnelGet funnels.ts:756) :
  // AUCUN champ tenant sensible (client_id / agency_id / owner_user_id / id
  // booking_page / price_cents / notification_email…). price_cents JAMAIS
  // exposé publiquement (E4/E6 régulés — §6.B).
  const body = JSON.stringify({
    data: {
      page: {
        slug: (page.slug as string) || slug,
        name: (page.title as string | null) ?? null,
        description: (page.description as string | null) ?? null,
        timezone: (page.timezone as string) || 'America/Toronto',
        confirmation_message:
          (page.confirmation_message as string | null) ?? null,
      },
      event_types: eventTypes.map((et) => ({
        id: et.id,
        name: et.name ?? null,
        description: et.description ?? null,
        duration_minutes: Number(et.duration_minutes) || 30,
        buffer_before_min: Number(et.buffer_before_min) || 0,
        buffer_after_min: Number(et.buffer_after_min) || 0,
      })),
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300, s-maxage=600',
    },
  });
}

// Pipeline lead → CRM canonique (§6.F) — RÉUTILISE forms.ts (zéro dup dedup).
// Identique à forms.ts:75-116 ; source='booking'. Retourne le leadId résolu.
async function wireBookingLead(
  request: Request,
  env: Env,
  page: Record<string, unknown>,
  body: Record<string, unknown>,
  guest: { name: string; email: string; phone: string; message: string },
): Promise<string> {
  const clientId = page.client_id as string;
  const { applyLeadMapping } = await import('./lead-mapping');
  const { logIngestConsent } = await import('./leads');
  const { resolveDedup, mergeIntoLead } = await import('./lead-dedup');

  // applyLeadMapping lit utm_*/gclid/fbclid/referrer + consent du payload
  // (calque forms.ts:78-83). Le payload booking = { ..., data?: {...} }.
  const m = applyLeadMapping(
    (body.data as Record<string, unknown>) || body,
    null,
  );
  const consentStatus =
    m.consent === true ? 'granted' : m.consent === false ? 'denied' : 'unknown';
  const attr = m.attribution;

  // Dédoublonnage unifié (clé 'email_phone', client_id de la page).
  const decision = await resolveDedup(env, 'email_phone', {
    clientId,
    email: guest.email,
    phone: guest.phone,
  });

  let leadId: string;
  if (decision.action !== 'create' && decision.existingId) {
    leadId = decision.existingId;
    if (decision.action === 'merge') {
      await mergeIntoLead(env, leadId, {
        name: guest.name,
        phone: guest.phone,
        message: guest.message,
        ...attr,
      });
    }
    await logIngestConsent(env, request, leadId, m.consent, consentStatus);
  } else {
    leadId = crypto.randomUUID();
    // source='booking' (≠ 'form'/'funnel' — §6.F). Colonnes utm/consent
    // calquées forms.ts:105-113.
    await env.DB.prepare(
      `INSERT INTO leads (id, client_id, name, email, phone, source, message, status, pipeline_id, stage_id,
         utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, referrer, consent_status)
       VALUES (?, ?, ?, ?, ?, 'booking', ?, 'new', 'pipeline-default', 'stage-new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        leadId,
        clientId,
        guest.name,
        guest.email,
        guest.phone,
        guest.message,
        attr.utm_source,
        attr.utm_medium,
        attr.utm_campaign,
        attr.utm_term,
        attr.utm_content,
        attr.gclid,
        attr.fbclid,
        attr.referrer,
        consentStatus,
      )
      .run();
    await logIngestConsent(env, request, leadId, m.consent, consentStatus);
  }

  await autoEnrollForTrigger(env, 'appointment_booked', leadId);
  return leadId;
}

// Confirmation immédiate (§6.E) : notification interne admins + courriel
// Resend + SMS si téléphone. Best-effort — n'échoue jamais la réservation.
async function sendBookingConfirmation(
  env: Env,
  page: Record<string, unknown>,
  guest: { name: string; email: string; phone: string },
  startIso: string,
  bookingId?: string,
): Promise<void> {
  const clientId = (page.client_id as string) || '';
  const when = new Date(startIso).toLocaleString('fr-CA');
  const confirmMsg =
    (page.confirmation_message as string) ||
    `Votre rendez-vous est confirmé pour le ${when}.`;

  // Liens self-service cancel/reschedule (§6.F). origin best-effort reconstruit
  // depuis l'env (calque broadcast.ts:453 / workflows.ts:605 — Env GELÉ, accès
  // indexé tolérant ; défaut sûr). slug = page.slug, booking_id = id du booking.
  const slug = (page.slug as string) || '';
  const baseUrl = String(
    (env as unknown as Record<string, string | undefined>).PUBLIC_BASE_URL ||
      (env as unknown as Record<string, string | undefined>).APP_URL ||
      'https://app.intralys.com',
  ).replace(/\/+$/, '');
  let cancelUrl = '';
  let rescheduleUrl = '';
  if (slug && bookingId) {
    const id = encodeURIComponent(bookingId);
    cancelUrl = `${baseUrl}/book/${slug}?booking_id=${id}&action=cancel`;
    rescheduleUrl = `${baseUrl}/book/${slug}?booking_id=${id}&action=reschedule`;
  }
  const linksHtml =
    cancelUrl && rescheduleUrl
      ? `<p>Besoin de modifier ? <a href="${rescheduleUrl}">Reprogrammer</a> · <a href="${cancelUrl}">Annuler</a></p>`
      : '';

  // Notification interne aux admins actifs (calque bookings.ts:60-63).
  try {
    const { results: admins } = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1",
    ).all();
    for (const admin of (admins || []) as Array<{ id: string }>) {
      await createNotification(
        env,
        admin.id,
        '📅 Nouveau RDV',
        `${guest.name} — ${when}`,
        '📅',
        '',
        clientId,
      );
    }
  } catch {
    /* best-effort */
  }

  // Courriel de confirmation (Resend — calque workflows.ts:572-578).
  if (env.RESEND_API_KEY && guest.email) {
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Intralys CRM <noreply@intralys.com>',
        to: [guest.email],
        subject: 'Confirmation de votre rendez-vous',
        html: `<p>Bonjour ${guest.name},</p><p>${confirmMsg}</p><p>Date : ${when}</p>${linksHtml}`,
      });
    } catch {
      /* envoi non critique */
    }
  }

  // SMS de confirmation si téléphone fourni (helpers.ts:sendSms).
  if (guest.phone) {
    try {
      await sendSms(
        env,
        guest.phone,
        `${confirmMsg} (${when})`,
      );
    } catch {
      /* envoi non critique */
    }
  }
}

/**
 * POST /api/book/:slug
 *
 * Création de réservation V2 (moteur correct + wiring CRM canonique). Vérifie
 * la dispo via l'algo §6.C (anti double-booking en fuseau), insère un
 * `bookings` (status 'confirmed' — énumération seq 7), RÉUTILISE le pipeline
 * forms.ts pour le lead (applyLeadMapping / resolveDedup / mergeIntoLead /
 * logIngestConsent / INSERT borné client_id / autoEnrollForTrigger
 * 'appointment_booked'), source='booking'. Projection optionnelle
 * lecture-seule dans `appointments` pour visibilité Calendar.tsx (§6.F).
 *
 * Succès : json({ data: { id, start_time, end_time, confirmation,
 *   redirect_url? } }, 201).
 */
export async function handlePublicCreateBookingV2(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  if (!slug) return json({ error: 'Slug requis' }, 400);
  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const startTime = sanitizeInput((body.start_time as string) || '', 40);
  const guestName = sanitizeInput((body.guest_name as string) || '', 100);
  const guestEmail = sanitizeInput(
    (body.guest_email as string) || '',
    200,
  ).toLowerCase();
  const guestPhone = sanitizeInput((body.guest_phone as string) || '', 30);
  const notes = sanitizeInput((body.notes as string) || '', 500);

  if (!startTime || !guestName || !guestEmail) {
    return json(
      { error: 'start_time, guest_name et guest_email requis' },
      400,
    );
  }
  // Sprint P0-2 — anti-bot honeypot (champs piège `honeypot` / `website`).
  // Bot signal → 200 OK silencieux (sans INSERT). Pas d'erreur → ne donne
  // aucun signal au scrapeur. Légitimes traversent identique.
  const inputCheck = validateBookingInput({
    guest_name: guestName,
    guest_email: guestEmail,
    guest_phone: guestPhone,
    start_time: startTime,
    honeypot: (body as Record<string, unknown>).honeypot ?? (body as Record<string, unknown>).website,
  });
  if (!inputCheck.ok && inputCheck.error === BOOKING_ERROR_CODES.HONEYPOT_TRIPPED) {
    return json({ data: { ok: true } });
  }
  const startMs = Date.parse(startTime);
  if (Number.isNaN(startMs)) return json({ error: 'start_time invalide' }, 400);

  const page = await loadActivePage(env, slug);
  if (!page) return json({ error: 'Page non trouvée' }, 404);

  const eventTypeId = (body.event_type_id as string) || null;
  const tz = (page.timezone as string) || 'America/Toronto';
  const dateLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(startMs)); // 'YYYY-MM-DD' dans le fuseau de la page.

  // Anti-collision : re-check au moment du POST (pas seulement à l'affichage).
  let et: ResolvedEventType;
  try {
    const computed = await computeSlots(env, page, eventTypeId, dateLocal);
    et = computed.et;
    const startIsoCanon = new Date(startMs).toISOString();
    if (!computed.slots.includes(startIsoCanon)) {
      return json({ error: 'Ce créneau est déjà réservé' }, 409);
    }
  } catch {
    return json({ error: 'Ce créneau est déjà réservé' }, 409);
  }

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(startMs + et.duration_minutes * 60000).toISOString();
  const id = crypto.randomUUID();

  try {
    // INSERT bookings — status 'confirmed' (énumération seq 7 INTOUCHABLE,
    // jamais 'pending'). event_type_id / agency_id = colonnes seq 84.
    await env.DB.prepare(
      `INSERT INTO bookings (id, booking_page_id, client_id, agency_id, event_type_id, guest_name, guest_email, guest_phone, start_time, end_time, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
    )
      .bind(
        id,
        page.id as string,
        (page.client_id as string) || null,
        (page.agency_id as string) || null,
        et.id,
        guestName,
        guestEmail,
        guestPhone,
        startIso,
        endIso,
        notes,
      )
      .run();
  } catch {
    // Colonnes seq 84 absentes : repli rétro-compat (schéma seq 7 strict).
    try {
      await env.DB.prepare(
        `INSERT INTO bookings (id, booking_page_id, client_id, guest_name, guest_email, guest_phone, start_time, end_time, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
      )
        .bind(
          id,
          page.id as string,
          (page.client_id as string) || null,
          guestName,
          guestEmail,
          guestPhone,
          startIso,
          endIso,
          notes,
        )
        .run();
    } catch {
      return json({ error: 'Réservation impossible' }, 409);
    }
  }

  // Wiring CRM canonique (§6.F) — best-effort, n'échoue jamais la résa.
  let leadId: string | null = null;
  try {
    leadId = await wireBookingLead(request, env, page, body, {
      name: guestName,
      email: guestEmail,
      phone: guestPhone,
      message: notes,
    });
    await env.DB.prepare('UPDATE bookings SET lead_id = ? WHERE id = ?')
      .bind(leadId, id)
      .run();
  } catch {
    /* pipeline lead best-effort */
  }

  // Projection appointments lecture-seule (§6.F) — visibilité Calendar.tsx.
  // INSERT pur, jointure applicative, NE MODIFIE PAS Calendar.tsx.
  try {
    await env.DB.prepare(
      `INSERT INTO appointments (id, lead_id, client_id, assignee_user_id, title, start_time, end_time, type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'meeting', 'confirmed')`,
    )
      .bind(
        crypto.randomUUID(),
        leadId,
        (page.client_id as string) || null,
        (page.owner_user_id as string) || null,
        `RDV — ${guestName}`,
        startIso,
        endIso,
      )
      .run();
  } catch {
    /* projection best-effort (NOT NULL client_id / table absente) */
  }

  // Confirmation immédiate (§6.E) — best-effort.
  await sendBookingConfirmation(
    env,
    page,
    { name: guestName, email: guestEmail, phone: guestPhone },
    startIso,
    id,
  );

  return json(
    {
      data: {
        id,
        start_time: startIso,
        end_time: endIso,
        confirmation: page.confirmation_message,
        redirect_url: page.redirect_url || undefined,
      },
    },
    201,
  );
}

/**
 * POST /api/book/:slug/cancel  — body { booking_id, reason? }
 *
 * Annulation publique (UPDATE bookings SET status='cancelled',
 * cancelled_reason=? — énumération seq 7). Best-effort, borné booking_page
 * du slug. Notification/workflow via le scheduler existant (§6.E).
 *
 * Succès : json({ data: { success: true } }).
 */
export async function handlePublicCancelBooking(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  if (!slug) return json({ error: 'Slug requis' }, 400);
  let body: { booking_id?: string; reason?: string };
  try {
    body = ((await request.json()) as { booking_id?: string; reason?: string }) || {};
  } catch {
    body = {};
  }
  const bookingId = sanitizeInput(body.booking_id || '', 60);
  if (!bookingId) return json({ error: 'booking_id requis' }, 400);
  const reason = sanitizeInput(body.reason || '', 500);

  const page = await loadActivePage(env, slug);
  if (!page) return json({ error: 'Page non trouvée' }, 404);

  // Borné aux bookings de la page du slug (slug = secret — calque
  // forms/funnels). Récupère lead_id pour le trigger d'annulation.
  let row: { id: string; lead_id: string | null; status: string } | null = null;
  try {
    row = (await env.DB.prepare(
      'SELECT id, lead_id, status FROM bookings WHERE id = ? AND booking_page_id = ?',
    )
      .bind(bookingId, page.id as string)
      .first()) as { id: string; lead_id: string | null; status: string } | null;
  } catch {
    row = null;
  }
  if (!row) return json({ error: 'Réservation non trouvée' }, 404);

  try {
    await env.DB.prepare(
      "UPDATE bookings SET status = 'cancelled', cancelled_reason = ? WHERE id = ? AND booking_page_id = ?",
    )
      .bind(reason, bookingId, page.id as string)
      .run();
  } catch {
    return json({ error: "Annulation impossible" }, 409);
  }

  // Trigger workflow 'appointment_cancelled' (déjà typé — §6.D/§6.E).
  if (row.lead_id) {
    try {
      await autoEnrollForTrigger(env, 'appointment_cancelled', row.lead_id);
    } catch {
      /* best-effort */
    }
  }

  return json({ data: { success: true } });
}

/**
 * POST /api/book/:slug/reschedule — body { booking_id, start_time }
 *
 * Reprogrammation publique : vérifie la nouvelle dispo (algo §6.C), crée le
 * nouveau créneau et lie `rescheduled_from` à l'ancien booking (qui passe
 * 'cancelled' — énumération seq 7). Best-effort, borné booking_page du slug.
 *
 * Succès : json({ data: { id, start_time, end_time } }).
 */
export async function handlePublicRescheduleBooking(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  if (!slug) return json({ error: 'Slug requis' }, 400);
  let body: { booking_id?: string; start_time?: string };
  try {
    body = ((await request.json()) as { booking_id?: string; start_time?: string }) || {};
  } catch {
    body = {};
  }
  const bookingId = sanitizeInput(body.booking_id || '', 60);
  const startTime = sanitizeInput(body.start_time || '', 40);
  if (!bookingId || !startTime) {
    return json({ error: 'booking_id et start_time requis' }, 400);
  }
  const startMs = Date.parse(startTime);
  if (Number.isNaN(startMs)) return json({ error: 'start_time invalide' }, 400);

  const page = await loadActivePage(env, slug);
  if (!page) return json({ error: 'Page non trouvée' }, 404);

  // Booking d'origine borné à la page du slug.
  let old: Record<string, unknown> | null = null;
  try {
    old = (await env.DB.prepare(
      'SELECT * FROM bookings WHERE id = ? AND booking_page_id = ?',
    )
      .bind(bookingId, page.id as string)
      .first()) as Record<string, unknown> | null;
  } catch {
    old = null;
  }
  if (!old) return json({ error: 'Réservation non trouvée' }, 404);

  const eventTypeId = (old.event_type_id as string) || null;
  const tz = (page.timezone as string) || 'America/Toronto';
  const dateLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(startMs));

  // Vérif nouvelle dispo (algo §6.C).
  let et: ResolvedEventType;
  try {
    const computed = await computeSlots(env, page, eventTypeId, dateLocal);
    et = computed.et;
    if (!computed.slots.includes(new Date(startMs).toISOString())) {
      return json({ error: 'Ce créneau est déjà réservé' }, 409);
    }
  } catch {
    return json({ error: 'Ce créneau est déjà réservé' }, 409);
  }

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(startMs + et.duration_minutes * 60000).toISOString();
  const newId = crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO bookings (id, booking_page_id, client_id, agency_id, event_type_id, lead_id, guest_name, guest_email, guest_phone, start_time, end_time, status, notes, rescheduled_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
    )
      .bind(
        newId,
        page.id as string,
        (old.client_id as string) || null,
        (old.agency_id as string) || null,
        eventTypeId,
        (old.lead_id as string) || null,
        (old.guest_name as string) || '',
        (old.guest_email as string) || '',
        (old.guest_phone as string) || '',
        startIso,
        endIso,
        (old.notes as string) || '',
        bookingId,
      )
      .run();
  } catch {
    return json({ error: 'Reprogrammation impossible' }, 409);
  }

  // L'ancien booking passe 'cancelled' (énumération seq 7).
  try {
    await env.DB.prepare(
      "UPDATE bookings SET status = 'cancelled', cancelled_reason = 'Reprogrammé' WHERE id = ? AND booking_page_id = ?",
    )
      .bind(bookingId, page.id as string)
      .run();
  } catch {
    /* best-effort — le nouveau créneau est déjà créé */
  }

  return json({
    data: { id: newId, start_time: startIso, end_time: endIso },
  });
}

// ════════════════════════════════════════════════════════════════════════════
// CRUD booking_event_types (PROTÉGÉ — capability 'workflows.manage')
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/booking-event-types[?booking_page_id=...]
 * Liste les types de RDV du tenant (borné client_id/agency_id §6.D).
 * Succès : json({ data: BookingEventType[] }).
 */
export async function handleListEventTypes(
  env: Env,
  auth: BookingAuth,
  url: URL,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  const bookingPageId = url.searchParams.get('booking_page_id');

  try {
    const conds: string[] = [];
    const binds: unknown[] = [];

    if (!isLegacy) {
      // Mode agence : borne au périmètre (client OU agence).
      const agencyId = auth.tenant!.agencyId as string;
      const accessible = auth.tenant!.accessibleClientIds || [];
      const tenantConds: string[] = ['agency_id = ?'];
      binds.push(agencyId);
      if (accessible.length > 0) {
        tenantConds.push(
          `client_id IN (${accessible.map(() => '?').join(',')})`,
        );
        binds.push(...accessible);
      }
      conds.push(`(${tenantConds.join(' OR ')})`);
    }
    if (bookingPageId) {
      conds.push('booking_page_id = ?');
      binds.push(bookingPageId);
    }

    let sql = 'SELECT * FROM booking_event_types';
    if (conds.length > 0) sql += ` WHERE ${conds.join(' AND ')}`;
    sql += ' ORDER BY created_at DESC LIMIT 200';

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: results || [] });
  } catch {
    // Table seq 84 absente : best-effort → liste vide.
    return json({ data: [] });
  }
}

/**
 * POST /api/booking-event-types
 * Crée un type de RDV. price_cents POSÉ INACTIF (aucune logique paiement).
 * Succès : json({ data: { id } }, 201).
 */
export async function handleCreateEventType(
  request: Request,
  env: Env,
  auth: BookingAuth,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  // client_id / agency_id POSÉS depuis le tenant à la création (§6.D —
  // calque funnels.ts:170-171).
  const clientId = auth.tenant?.clientId ?? auth.clientId ?? null;
  const agencyId = auth.tenant?.agencyId ?? null;

  const id = crypto.randomUUID();
  const name = sanitizeInput((body.name as string) || 'Rendez-vous', 200);
  const description = sanitizeInput((body.description as string) || '', 500);
  const bookingPageId = sanitizeInput(
    (body.booking_page_id as string) || '',
    60,
  ) || null;
  const duration = Number(body.duration_minutes) || 30;
  const bufBefore = Number(body.buffer_before_min) || 0;
  const bufAfter = Number(body.buffer_after_min) || 0;
  const slotStep = Number(body.slot_step_min) || 30;
  const minNotice = Number(body.min_notice_min) || 0;
  // price_cents POSÉ INACTIF — stocké mais AUCUNE logique paiement (§6.B).
  const priceCents = Number(body.price_cents) || 0;

  try {
    await env.DB.prepare(
      `INSERT INTO booking_event_types
         (id, client_id, agency_id, booking_page_id, name, description,
          duration_minutes, buffer_before_min, buffer_after_min, price_cents,
          slot_step_min, min_notice_min, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
      .bind(
        id,
        clientId,
        agencyId,
        bookingPageId,
        name,
        description,
        duration,
        bufBefore,
        bufAfter,
        priceCents,
        slotStep,
        minNotice,
      )
      .run();
  } catch {
    // Table seq 84 absente : best-effort → réponse propre (pas de 500).
    return json({ error: 'Création impossible' }, 409);
  }
  return json({ data: { id } }, 201);
}

/**
 * PUT /api/booking-event-types/:id
 * Met à jour un type de RDV (borné tenant). price_cents reste INACTIF.
 * Succès : json({ data: { success: true } }).
 */
export async function handleUpdateEventType(
  request: Request,
  env: Env,
  auth: BookingAuth,
  eventTypeId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!eventTypeId) return json({ error: 'id requis' }, 400);

  // Bornage tenant : charge la row, vérifie l'appartenance (calque
  // funnels.ts:loadFunnelInTenant). Legacy → pas de garde nouvelle.
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare(
      'SELECT * FROM booking_event_types WHERE id = ?',
    )
      .bind(eventTypeId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Introuvable' }, 404);
  }
  if (!row) return json({ error: 'Introuvable' }, 404);
  if (!rowInTenant(row, auth)) return json({ error: 'Introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    binds.push(sanitizeInput(body.name as string, 200));
  }
  if (body.description !== undefined) {
    sets.push('description = ?');
    binds.push(sanitizeInput(body.description as string, 500));
  }
  if (body.duration_minutes !== undefined) {
    sets.push('duration_minutes = ?');
    binds.push(Number(body.duration_minutes) || 30);
  }
  if (body.buffer_before_min !== undefined) {
    sets.push('buffer_before_min = ?');
    binds.push(Number(body.buffer_before_min) || 0);
  }
  if (body.buffer_after_min !== undefined) {
    sets.push('buffer_after_min = ?');
    binds.push(Number(body.buffer_after_min) || 0);
  }
  if (body.slot_step_min !== undefined) {
    sets.push('slot_step_min = ?');
    binds.push(Number(body.slot_step_min) || 30);
  }
  if (body.min_notice_min !== undefined) {
    sets.push('min_notice_min = ?');
    binds.push(Number(body.min_notice_min) || 0);
  }
  if (body.is_active !== undefined) {
    sets.push('is_active = ?');
    binds.push(Number(body.is_active) ? 1 : 0);
  }
  // price_cents : stocké si fourni mais reste INACTIF — AUCUNE logique
  // paiement n'est déclenchée (§6.B / E4-E6 jamais activés).
  if (body.price_cents !== undefined) {
    sets.push('price_cents = ?');
    binds.push(Number(body.price_cents) || 0);
  }
  if (sets.length === 0) return json({ error: 'Aucune modification' }, 400);

  sets.push("updated_at = datetime('now')");
  binds.push(eventTypeId);
  try {
    await env.DB.prepare(
      `UPDATE booking_event_types SET ${sets.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();
  } catch {
    return json({ error: 'Mise à jour impossible' }, 409);
  }
  return json({ data: { success: true } });
}

/**
 * DELETE /api/booking-event-types/:id
 * Supprime/désactive un type de RDV (borné tenant).
 * Succès : json({ data: { success: true } }).
 */
export async function handleDeleteEventType(
  env: Env,
  auth: BookingAuth,
  eventTypeId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!eventTypeId) return json({ error: 'id requis' }, 400);

  // Bornage tenant avant suppression (calque funnels.ts:loadFunnelInTenant).
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare(
      'SELECT * FROM booking_event_types WHERE id = ?',
    )
      .bind(eventTypeId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Introuvable' }, 404);
  }
  if (!row) return json({ error: 'Introuvable' }, 404);
  if (!rowInTenant(row, auth)) return json({ error: 'Introuvable' }, 404);

  try {
    await env.DB.prepare('DELETE FROM booking_event_types WHERE id = ?')
      .bind(eventTypeId)
      .run();
  } catch {
    return json({ error: 'Suppression impossible' }, 409);
  }
  return json({ data: { success: true } });
}
