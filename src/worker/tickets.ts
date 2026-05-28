// ── tickets.ts — LOT G1 Helpdesk & Tickets de support (Sprint 8) ───────────
//
// Handlers backend du module support : file de tickets multi-canaux + fil de
// messages. Visiteur ANONYME possible (lead_id nullable) → l'Inbox lead-centric
// (conversations.lead_id requis) N'EST PAS réutilisée ; tables NEUVES seq 89.
//
// ⚠ CORPS RÉELS PHASE B (Manager-B backend exclusif) — signatures FIGÉES
//   Phase A (Manager-A SOLO). Les signatures (ordre/typage des params, forme de
//   la Response) NE CHANGENT PAS : worker.ts (gelé Phase A) câble déjà ces
//   handlers, api.ts (gelé Phase A) appelle déjà ces routes. Contrat §6
//   verbatim dans docs/LOT-HELPDESK-G1.md.
//
//   NB ÉCART brief↔disque (code fait foi) : le brief Phase B nomme les handlers
//   `handleListTickets(request,env,auth)` etc. ; les signatures FIGÉES Phase A
//   sur disque sont `handleGetTickets(env,auth,url)`, `handleGetTicket(env,auth,
//   id)`, `handleUpdateTicket(request,env,auth,id)`, `handleReplyTicket(request,
//   env,auth,id)`. On adapte AU DISQUE (worker.ts les câble déjà ainsi), on ne
//   touche PAS worker.ts/api.ts (gelés). Comportement identique au brief.
//
// Conventions imposées (docs/LOT-HELPDESK-G1.md §6.C/§6.D/§6.I) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS — §6.D).
//   - Garde capability : helpdeskCapGuard(auth) = mode-agence-only (calque
//     dashboards.ts:reportsCapGuard / LOT B-bis). Réutilise 'leads.write'
//     (déjà dans ALL_CAPABILITIES — AUCUN ajout). Legacy/mono-tenant ⇒
//     undefined (set legacy LARGE ⇒ zéro régression). Mode agence ⇒
//     requireCapability réel (viewer bridé).
//   - Bornage tenant : loadTicketInTenant (calque funnels.ts:loadFunnelInTenant
//     — legacy → row ; mode agence → client_id ∈ accessibleClientIds OU
//     agency_id == tenant.agencyId, sinon 404).
//   - Wiring CRM (Phase B) : RÉUTILISE le pipeline forms.ts sur la création
//     (applyLeadMapping / resolveDedup / mergeIntoLead / logIngestConsent) →
//     support_tickets.lead_id rempli si match email/phone, sinon NULL (PAS de
//     création de lead forcée — §6.A Q5). best-effort try/catch avalant : un
//     échec de mapping n'échoue JAMAIS la création du ticket.
//   - SLA v1 : sla_level enum applicatif ∈ none|1h|4h|24h|72h validé handler
//     (PAS de CHECK SQL) + sla_due_at epoch calculé création (Phase B).
//   - Statuts v1 : ouvert|en_cours|attente_client|resolu|escale validés handler.
//   - Email Resend best-effort (garde if(!RESEND_API_KEY), jamais throw).
//   - best-effort : table/colonne absente → réponse propre (404 / {data:[]}),
//     JAMAIS de 500/throw non maîtrisé.

import { Resend } from 'resend';
import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
// Renforcement V2 — helpers PUR engine (validation statut/priorité/SLA, constantes).
import {
  isValidPriority,
  VALID_PRIORITIES,
  TICKETS_ERROR_CODES,
} from './lib/tickets-engine';

// Auth enrichi au choke-point (worker.ts) — calque le type passé à
// routeProtected (userId/role/clientId/tenant/capabilities).
export type TicketAuth = CapAuth & { capabilities?: Set<string> };

// Statuts v1 validés HANDLER (PAS de CHECK SQL — §6.A Q3).
const TICKET_STATUSES = [
  'ouvert',
  'en_cours',
  'attente_client',
  'resolu',
  'escale',
] as const;

// SLA v1 : enum applicatif → delta secondes (sla_due_at = created_at + delta).
const SLA_DELTA_SECONDS: Record<string, number | null> = {
  none: null,
  '1h': 3600,
  '4h': 14400,
  '24h': 86400,
  '72h': 259200,
};
function isSlaLevel(v: unknown): v is string {
  return typeof v === 'string' && v in SLA_DELTA_SECONDS;
}
function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}
function computeSlaDueAt(slaLevel: string, createdAt: number): number | null {
  const delta = SLA_DELTA_SECONDS[slaLevel];
  return delta == null ? null : createdAt + delta;
}

// ── Garde capability mode-agence-only (calque dashboards.ts:reportsCapGuard /
//    LOT B-bis) ───────────────────────────────────────────────────────────────
// Legacy/mono-tenant (!tenant || agencyId == null) → undefined : aucun bridage
// nouveau (le set legacy `legacyCapsFromRole` est LARGE ⇒ pas de régression
// historique). Mode agence (agencyId != null) → enforcement réel via
// requireCapability ('leads.write') ; viewer bridé.
export function helpdeskCapGuard(auth: TicketAuth): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, 'leads.write');
}

// ── Bornage tenant sur un ticket (calque funnels.ts:loadFunnelInTenant) ──────
//   - Legacy/mono-tenant (!tenant || agencyId == null) → row : endpoint NEUF,
//     rétro-compat byte-équivalente à l'absence historique de borne.
//   - Mode agence (agencyId != null) → le ticket doit avoir
//     client_id ∈ accessibleClientIds OU agency_id == auth.tenant.agencyId,
//     sinon json({error:'Ticket introuvable'},404).
// Renvoie la row ticket (best-effort) ou une Response 404.
export async function loadTicketInTenant(
  env: Env,
  ticketId: string,
  auth: TicketAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM support_tickets WHERE id = ?')
      .bind(ticketId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Ticket introuvable' }, 404);
  }
  if (!row) return json({ error: 'Ticket introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  const rowAgency = (row.agency_id as string | null) ?? null;

  const inTenant =
    (rowClient != null && accessible.includes(rowClient)) ||
    (rowAgency != null && rowAgency === agencyId);
  if (!inTenant) return json({ error: 'Ticket introuvable' }, 404);
  return row;
}

// ── Email Resend best-effort (calque workflows.ts:send_internal_email) ───────
// Garde RESEND_API_KEY : absente → no-op silencieux. try/catch avalant : un
// échec d'envoi n'échoue JAMAIS le handler appelant. Jamais de throw.
async function sendTicketEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const dest = (to || '').trim();
  if (!dest) return;
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Intralys Support <support@intralys.com>',
      to: [dest],
      subject,
      html,
    });
  } catch {
    /* best-effort : jamais de throw, jamais de 500 */
  }
}

// ── Wiring CRM best-effort : rattache le ticket à un lead EXISTANT par match
//    email/phone (RÉUTILISE le pipeline forms.ts : applyLeadMapping /
//    resolveDedup / mergeIntoLead / logIngestConsent). JAMAIS de création de
//    lead forcée — si pas de match → retourne null (lead_id reste NULL).
//    try/catch avalant total : un échec ne casse JAMAIS la création du ticket.
async function resolveLeadForTicket(
  env: Env,
  request: Request | null,
  clientId: string | null,
  requesterName: string,
  requesterEmail: string,
  requesterPhone: string,
  body: string,
): Promise<string | null> {
  if (!clientId) return null;
  if (!requesterEmail && !requesterPhone) return null;
  try {
    const { resolveDedup, mergeIntoLead } = await import('./lead-dedup');
    const { logIngestConsent } = await import('./leads');

    const decision = await resolveDedup(env, 'email_phone', {
      clientId,
      email: requesterEmail,
      phone: requesterPhone,
    });

    // PAS de match → on NE crée PAS de lead (lead_id reste NULL — §6.A Q5).
    if (decision.action === 'create' || !decision.existingId) return null;

    const leadId = decision.existingId;
    if (decision.action === 'merge') {
      await mergeIntoLead(env, leadId, {
        name: requesterName,
        phone: requesterPhone,
        message: body,
      });
    }
    if (request) {
      // consent inconnu pour un ticket support (pas de case opt-in explicite).
      await logIngestConsent(env, request, leadId, null, 'unknown');
    }
    return leadId;
  } catch {
    // Pipeline lead indisponible (table absente / panne) : best-effort.
    return null;
  }
}

// ── PROTÉGÉ : file des tickets du tenant ────────────────────────────────────
// SELECT support_tickets borné tenant. Legacy → byte-équivalent (pas de borne).
// Mode agence → WHERE agency_id = ? OR client_id IN (accessibleClientIds).
// Filtres query optionnels : status / assigned_to / priority. Tri
// last_message_at DESC.
export async function handleGetTickets(
  env: Env,
  auth: TicketAuth,
  url: URL,
): Promise<Response> {
  const g = helpdeskCapGuard(auth);
  if (g) return g;

  try {
    const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
    const conds: string[] = [];
    const binds: unknown[] = [];

    if (!isLegacy) {
      // Borne tenant (client OU agence) — calque funnels.ts:handleGetFunnels.
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

    // Filtres optionnels (validés côté handler).
    const status = url.searchParams.get('status');
    if (status && TICKET_STATUSES.includes(status as never)) {
      conds.push('status = ?');
      binds.push(status);
    }
    const assignedTo = url.searchParams.get('assigned_to');
    if (assignedTo) {
      conds.push('assigned_to = ?');
      binds.push(assignedTo);
    }
    // Renforcement V2 — validation priorité via engine whitelist.
    const priority = url.searchParams.get('priority');
    if (priority) {
      if (!isValidPriority(priority)) {
        return json({ error: 'Priorité invalide', error_code: TICKETS_ERROR_CODES.INVALID_PRIORITY }, 400);
      }
      conds.push('priority = ?');
      binds.push(priority);
    }

    let sql = 'SELECT * FROM support_tickets';
    if (conds.length > 0) sql += ` WHERE ${conds.join(' AND ')}`;
    sql += ' ORDER BY last_message_at DESC LIMIT 200';

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: results || [] });
  } catch {
    // Table seq 89 absente : best-effort → liste vide.
    return json({ data: [] });
  }
}

// ── PROTÉGÉ : création d'un ticket côté agent ───────────────────────────────
// INSERT support_tickets (id uuid, client_id depuis tenant, status 'ouvert',
// sla_due_at calculé) + 1er ticket_messages (inbound, body initial). Wiring CRM
// best-effort. Email confirmation Resend best-effort au requester.
export async function handleCreateTicket(
  request: Request,
  env: Env,
  auth: TicketAuth,
): Promise<Response> {
  const g = helpdeskCapGuard(auth);
  if (g) return g;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const id = crypto.randomUUID();
  const subject = sanitizeInput((body.subject as string) || 'Sans objet', 200);
  const bodyText = sanitizeInput((body.body as string) || '', 5000);
  const requesterName = sanitizeInput((body.requester_name as string) || '', 100);
  const requesterEmail = sanitizeInput((body.requester_email as string) || '', 200).toLowerCase();
  const requesterPhone = sanitizeInput((body.requester_phone as string) || '', 30);
  const priority = sanitizeInput((body.priority as string) || 'normal', 30);
  // Renforcement V2 — validation priorité via engine whitelist.
  if (!isValidPriority(priority)) {
    return json({ error: 'Priorité invalide', error_code: TICKETS_ERROR_CODES.INVALID_PRIORITY,
      message: `Priorités acceptées : ${VALID_PRIORITIES.join(', ')}` }, 400);
  }
  const slaLevel = isSlaLevel(body.sla_level) ? (body.sla_level as string) : 'none';
  const assignedTo =
    typeof body.assigned_to === 'string' ? sanitizeInput(body.assigned_to, 80) : null;
  const source = sanitizeInput((body.source as string) || 'manual', 30);

  // client_id / agency_id POSÉS depuis le tenant à la création (calque funnels).
  const clientId = auth.tenant?.clientId ?? auth.clientId ?? null;
  const agencyId = auth.tenant?.agencyId ?? null;

  const createdAt = nowEpoch();
  const slaDueAt = computeSlaDueAt(slaLevel, createdAt);

  // Wiring CRM best-effort AVANT insert (lead_id figé à l'INSERT). N'échoue
  // jamais la création (try/catch interne avalant).
  const leadId = await resolveLeadForTicket(
    env,
    request,
    clientId,
    requesterName,
    requesterEmail,
    requesterPhone,
    bodyText,
  );

  try {
    await env.DB.prepare(
      `INSERT INTO support_tickets
         (id, client_id, agency_id, lead_id, subject, body,
          requester_name, requester_email, requester_phone,
          status, priority, sla_level, sla_due_at, assigned_to, source,
          last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ouvert', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        clientId,
        agencyId,
        leadId,
        subject,
        bodyText,
        requesterName || null,
        requesterEmail || null,
        requesterPhone || null,
        priority,
        slaLevel,
        slaDueAt,
        assignedTo,
        source,
        createdAt,
        createdAt,
        createdAt,
      )
      .run();

    // 1er message du fil : direction 'inbound' (message d'ouverture).
    await env.DB.prepare(
      `INSERT INTO ticket_messages
         (id, ticket_id, client_id, direction, author_id, author_name, body, is_internal, created_at)
       VALUES (?, ?, ?, 'inbound', ?, ?, ?, 0, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        id,
        clientId,
        auth.userId || null,
        requesterName || null,
        bodyText,
        createdAt,
      )
      .run();

    // Email confirmation best-effort au requester.
    if (requesterEmail) {
      await sendTicketEmail(
        env,
        requesterEmail,
        `Votre demande de support : ${subject}`,
        `<p>Bonjour,</p><p>Nous avons bien reçu votre demande de support : <strong>${subject}</strong>.</p><p>Notre équipe vous répondra dès que possible.</p>`,
      );
    }

    return json({ data: { id } }, 201);
  } catch {
    // Table seq 89 absente : best-effort → réponse propre, pas de 500.
    return json({ error: 'Création impossible' }, 404);
  }
}

// ── PROTÉGÉ : détail d'un ticket + fil de messages ──────────────────────────
// loadTicketInTenant 404 → charge le ticket + ses ticket_messages (ORDER BY
// created_at ASC, jointure applicative). Retourne {...ticket, messages}.
export async function handleGetTicket(
  env: Env,
  auth: TicketAuth,
  ticketId: string,
): Promise<Response> {
  const g = helpdeskCapGuard(auth);
  if (g) return g;

  const ticketOr = await loadTicketInTenant(env, ticketId, auth);
  if (ticketOr instanceof Response) return ticketOr;

  let messages: unknown[] = [];
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC',
    )
      .bind(ticketId)
      .all();
    messages = results || [];
  } catch {
    messages = [];
  }

  return json({ data: { ...ticketOr, messages } });
}

// ── PROTÉGÉ : mise à jour d'un ticket (status/priority/assigned_to/sla) ──────
// loadTicketInTenant 404 → UPDATE des champs fournis. Recalcul sla_due_at si
// sla_level change (created_at + delta). updated_at refresh.
export async function handleUpdateTicket(
  request: Request,
  env: Env,
  auth: TicketAuth,
  ticketId: string,
): Promise<Response> {
  const g = helpdeskCapGuard(auth);
  if (g) return g;

  const ticketOr = await loadTicketInTenant(env, ticketId, auth);
  if (ticketOr instanceof Response) return ticketOr;
  const ticket = ticketOr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (
    typeof body.status === 'string' &&
    TICKET_STATUSES.includes(body.status as never)
  ) {
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (typeof body.priority === 'string') {
    sets.push('priority = ?');
    binds.push(sanitizeInput(body.priority, 30));
  }
  if ('assigned_to' in body) {
    sets.push('assigned_to = ?');
    binds.push(
      typeof body.assigned_to === 'string'
        ? sanitizeInput(body.assigned_to, 80)
        : null,
    );
  }
  if (isSlaLevel(body.sla_level)) {
    const slaLevel = body.sla_level as string;
    // Recalcul sla_due_at à partir du created_at d'origine (epoch stocké).
    const createdAt = Number(ticket.created_at) || nowEpoch();
    sets.push('sla_level = ?');
    binds.push(slaLevel);
    sets.push('sla_due_at = ?');
    binds.push(computeSlaDueAt(slaLevel, createdAt));
  }

  if (sets.length === 0) return json({ error: 'Aucune modification' }, 400);

  try {
    sets.push('updated_at = ?');
    binds.push(nowEpoch());
    binds.push(ticketId);
    await env.DB.prepare(
      `UPDATE support_tickets SET ${sets.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Ticket introuvable' }, 404);
  }
}

// ── PROTÉGÉ : réponse à un ticket (message sortant agent / note interne) ─────
// loadTicketInTenant 404 → INSERT ticket_messages (direction 'outbound', ou
// is_internal=1 pour une note interne). UPDATE last_message_at. Email Resend au
// requester SI réponse publique (pas si note interne).
export async function handleReplyTicket(
  request: Request,
  env: Env,
  auth: TicketAuth,
  ticketId: string,
): Promise<Response> {
  const g = helpdeskCapGuard(auth);
  if (g) return g;

  const ticketOr = await loadTicketInTenant(env, ticketId, auth);
  if (ticketOr instanceof Response) return ticketOr;
  const ticket = ticketOr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const replyBody = sanitizeInput((body.body as string) || '', 5000);
  if (!replyBody) return json({ error: 'Message requis' }, 400);
  const isInternal = body.is_internal === true || body.is_internal === 1;
  const msgId = crypto.randomUUID();
  const at = nowEpoch();

  try {
    await env.DB.prepare(
      `INSERT INTO ticket_messages
         (id, ticket_id, client_id, direction, author_id, author_name, body, is_internal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        msgId,
        ticketId,
        (ticket.client_id as string | null) ?? null,
        isInternal ? 'internal_note' : 'outbound',
        auth.userId || null,
        null,
        replyBody,
        isInternal ? 1 : 0,
        at,
      )
      .run();

    await env.DB.prepare(
      'UPDATE support_tickets SET last_message_at = ?, updated_at = ? WHERE id = ?',
    )
      .bind(at, at, ticketId)
      .run();

    // Email au requester UNIQUEMENT si réponse publique (jamais note interne).
    if (!isInternal) {
      const requesterEmail = (ticket.requester_email as string | null) || '';
      const subject = (ticket.subject as string | null) || 'Votre demande de support';
      if (requesterEmail) {
        await sendTicketEmail(
          env,
          requesterEmail,
          `Re: ${subject}`,
          `<p>Bonjour,</p><p>Notre équipe a répondu à votre demande :</p><blockquote>${replyBody}</blockquote>`,
        );
      }
    }

    return json({ data: { id: msgId } }, 201);
  } catch {
    return json({ error: 'Ticket introuvable' }, 404);
  }
}

// ── PUBLIC (pré-requireAuth) : soumission d'un ticket par un visiteur ────────
// Tenant résolu côté handler par slug (calque handlePublicFunnelSubmit /
// handlePublicFormSubmit). Le slug d'un formulaire de support (table `forms`,
// is_active=1) porte le client_id propriétaire. Crée le ticket + 1er message
// (source 'form'). Wiring CRM best-effort. Email confirmation. Retourne {id}.
// ZÉRO donnée tenant exposée en réponse.
export async function handlePublicSubmitTicket(
  request: Request,
  env: Env,
): Promise<Response> {
  let raw: Record<string, unknown>;
  try {
    raw = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  // payload public = { slug?, subject?, body?, requester_*?, data? }
  // (calque publicSubmitTicket api.ts). Les champs peuvent aussi arriver sous
  // `data` (calque forms.ts:body.data).
  const data =
    raw.data && typeof raw.data === 'object'
      ? (raw.data as Record<string, unknown>)
      : raw;
  const d = data as Record<string, string>;
  const slug = sanitizeInput((raw.slug as string) || (d.slug as string) || '', 80);

  const subject = sanitizeInput(
    (raw.subject as string) || d.subject || 'Demande de support',
    200,
  );
  const bodyText = sanitizeInput(
    (raw.body as string) || d.message || d.body || '',
    5000,
  );
  const requesterName = sanitizeInput(
    (raw.requester_name as string) || d.name || d.nom || '',
    100,
  );
  const requesterEmail = sanitizeInput(
    (raw.requester_email as string) || d.email || '',
    200,
  ).toLowerCase();
  const requesterPhone = sanitizeInput(
    (raw.requester_phone as string) || d.phone || d.telephone || '',
    30,
  );

  // Résolution tenant par slug → client_id (calque funnels :
  // funnel_publications.slug → client_id ; ici on lit la table `forms`, où un
  // formulaire de support publie son slug et porte son client_id). Best-effort :
  // slug absent / introuvable → client_id NULL (ticket non borné, legacy-safe).
  // JAMAIS d'exposition de données tenant.
  let clientId: string | null = null;
  if (slug) {
    try {
      const form = (await env.DB.prepare(
        'SELECT client_id FROM forms WHERE slug = ? AND is_active = 1 LIMIT 1',
      )
        .bind(slug)
        .first()) as { client_id: string | null } | null;
      clientId = form?.client_id || null;
    } catch {
      clientId = null;
    }
  }

  const id = crypto.randomUUID();
  const createdAt = nowEpoch();

  // Wiring CRM best-effort (rattache un lead existant, ne crée jamais).
  const leadId = await resolveLeadForTicket(
    env,
    request,
    clientId,
    requesterName,
    requesterEmail,
    requesterPhone,
    bodyText,
  );

  try {
    await env.DB.prepare(
      `INSERT INTO support_tickets
         (id, client_id, agency_id, lead_id, subject, body,
          requester_name, requester_email, requester_phone,
          status, priority, sla_level, sla_due_at, assigned_to, source,
          last_message_at, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'ouvert', 'normal', 'none', NULL, NULL, 'form', ?, ?, ?)`,
    )
      .bind(
        id,
        clientId,
        leadId,
        subject,
        bodyText,
        requesterName || null,
        requesterEmail || null,
        requesterPhone || null,
        createdAt,
        createdAt,
        createdAt,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO ticket_messages
         (id, ticket_id, client_id, direction, author_id, author_name, body, is_internal, created_at)
       VALUES (?, ?, ?, 'inbound', NULL, ?, ?, 0, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        id,
        clientId,
        requesterName || null,
        bodyText,
        createdAt,
      )
      .run();

    if (requesterEmail) {
      await sendTicketEmail(
        env,
        requesterEmail,
        `Votre demande de support : ${subject}`,
        `<p>Bonjour,</p><p>Nous avons bien reçu votre demande de support : <strong>${subject}</strong>.</p><p>Notre équipe vous répondra dès que possible.</p>`,
      );
    }

    // ZÉRO champ tenant en réponse (pas de client_id/agency_id).
    return json({ data: { id } }, 201);
  } catch {
    // Table seq 89 absente / panne D1 : best-effort → réponse propre.
    return json({ error: 'Soumission impossible' }, 404);
  }
}
