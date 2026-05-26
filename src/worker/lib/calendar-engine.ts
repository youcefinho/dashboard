// ── lib/calendar-engine.ts — Sprint 33 (renforcement A2) ─────────────────
//
// Helpers PURS (zéro I/O, zéro D1, zéro fetch) extraits de calendar-sync.ts
// pour rendre la logique d'orchestration testable indépendamment des appels
// REST des providers (gcal-client.ts / outlook-client.ts).
//
// CONTENU :
//   - ANTI_LOOP_WINDOW_MS              (constante : fenêtre anti-écho push/pull)
//   - shouldSkipAntiLoop()              (push skip si on vient de sync)
//   - applyLwwResolution()              (Last-Write-Wins ; CRM = autorité égalité)
//   - detectConflict()                  (les 2 côtés modifiés depuis last_sync)
//   - validateEventPayload()            (ISO dates, end > start, title requis)
//   - normalizeAttendees()              (lowercase + dedupe + cap MAX_ATTENDEES)
//   - buildIcsEventLine()               (VEVENT RFC5545 minimal)
//   - parseIcsRecurrence()              (RRULE → { freq, interval, until? })
//   - CALENDAR_ERROR_CODES              (codes erreur stables cross-provider)
//
// AUCUNE dépendance Worker (Env, D1, fetch) → 100 % unit-testable.
// Aucune dépendance externe : pas d'import au-delà de ce fichier.

// ════════════════════════════════════════════════════════════
//  CONSTANTES
// ════════════════════════════════════════════════════════════

/**
 * Fenêtre anti-écho push/pull. Si on a sync (push OU pull) il y a moins de
 * 30 s, on suppose qu'un nouveau push entrant est un rebond du webhook qui
 * nous arrive AVANT que le provider considère son propre état stable.
 * Skip pour éviter la boucle push→webhook→pull→push→...
 */
export const ANTI_LOOP_WINDOW_MS = 30_000 as const;

/** Cap dur sur le nombre d'attendees (alignement Google Calendar = 200, Outlook
 *  = 500 ; on retient 100 pour rester sûrs côté payload + activity_log). */
export const MAX_ATTENDEES = 100 as const;

/**
 * Codes erreur stables exposés à l'API (sync_status / last_error) et aux
 * logs. Permet aux UI / dashboards / alertes de matcher sur des chaînes
 * stables au lieu de messages provider variables.
 */
export const CALENDAR_ERROR_CODES = {
  TOKEN_INVALID: 'token_invalid',
  TOKEN_MISSING: 'token_missing',
  CONFLICT: 'conflict',
  INVALID_EVENT: 'invalid_event',
  INVALID_DATE: 'invalid_date',
  INVALID_RANGE: 'invalid_range',
  MISSING_TITLE: 'missing_title',
  RATE_LIMITED: 'rate_limited',
  WEBHOOK_TOKEN_MISMATCH: 'webhook_token_mismatch',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  NOT_FOUND: 'not_found',
} as const;

export type CalendarErrorCode =
  (typeof CALENDAR_ERROR_CODES)[keyof typeof CALENDAR_ERROR_CODES];

// ════════════════════════════════════════════════════════════
//  ANTI-LOOP
// ════════════════════════════════════════════════════════════

/**
 * Retourne true si on doit SKIP le push : un sync a déjà eu lieu dans la
 * fenêtre ANTI_LOOP_WINDOW_MS. Tolère lastSyncedAt null/undefined/invalide
 * (→ false : pas de raison de skip).
 *
 * @param lastSyncedAt — ISO string (de appointment_sync.last_synced_at) ou null
 * @param nowMs        — timestamp courant (Date.now()), paramètre pour testabilité
 */
export function shouldSkipAntiLoop(
  lastSyncedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lastSyncedAt) return false;
  const last = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(last)) return false;
  return nowMs - last < ANTI_LOOP_WINDOW_MS;
}

// ════════════════════════════════════════════════════════════
//  LWW — Last-Write-Wins resolution
// ════════════════════════════════════════════════════════════

export type LwwWinner = 'local' | 'external';
export type LwwAction = 'push' | 'pull' | 'noop';

export interface LwwInput {
  /** ISO updated_at de l'appointment Intralys */
  updatedAt: string | null | undefined;
}

export interface LwwResolution {
  winner: LwwWinner;
  action: LwwAction;
}

/**
 * Résout un conflit LWW entre une version locale (Intralys CRM) et une
 * version externe (Google/Outlook event). Règle :
 *   - external strictement plus récent → winner='external', action='pull'
 *   - local plus récent OU égalité    → winner='local',    action='push'
 *
 * L'égalité va au LOCAL : CRM est autorité (cf. brief Sprint 33).
 * Dates invalides côté external → winner='local' (safety).
 */
export function applyLwwResolution(
  local: LwwInput,
  external: LwwInput,
): LwwResolution {
  const a = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
  const b = external.updatedAt ? new Date(external.updatedAt).getTime() : 0;
  if (!Number.isFinite(b) || b === 0) return { winner: 'local', action: 'push' };
  if (!Number.isFinite(a)) return { winner: 'external', action: 'pull' };
  if (b > a) return { winner: 'external', action: 'pull' };
  if (a > b) return { winner: 'local', action: 'push' };
  // Égalité → CRM gagne, mais aucune action push nécessaire (déjà aligné)
  return { winner: 'local', action: 'noop' };
}

// ════════════════════════════════════════════════════════════
//  CONFLICT DETECTION
// ════════════════════════════════════════════════════════════

export interface ConflictInput {
  /** updated_at local (Intralys appointment) */
  localUpdatedAt: string | null | undefined;
  /** updated_at externe (event.updated / event.lastModifiedDateTime) */
  externalUpdatedAt: string | null | undefined;
  /** dernier last_synced_at (appointment_sync.last_synced_at) */
  lastSyncedAt: string | null | undefined;
}

export interface ConflictResult {
  conflict: boolean;
  reason?: string;
}

/**
 * Détecte un conflit "vrai" : les DEUX côtés (local + externe) ont été
 * modifiés APRÈS le dernier sync connu. Sans lastSyncedAt on ne peut rien
 * affirmer → pas de conflit (le sync précédent n'a jamais eu lieu, c'est
 * un premier push à venir).
 */
export function detectConflict(input: ConflictInput): ConflictResult {
  const local = input.localUpdatedAt ? new Date(input.localUpdatedAt).getTime() : 0;
  const external = input.externalUpdatedAt
    ? new Date(input.externalUpdatedAt).getTime()
    : 0;
  const lastSync = input.lastSyncedAt ? new Date(input.lastSyncedAt).getTime() : 0;
  if (!Number.isFinite(local) || !Number.isFinite(external) || !Number.isFinite(lastSync)) {
    return { conflict: false, reason: 'invalid_dates' };
  }
  if (lastSync === 0) return { conflict: false, reason: 'no_prior_sync' };
  if (local > lastSync && external > lastSync) {
    return { conflict: true, reason: 'both_modified_after_last_sync' };
  }
  return { conflict: false };
}

// ════════════════════════════════════════════════════════════
//  VALIDATION
// ════════════════════════════════════════════════════════════

export interface EventPayloadInput {
  title?: string | null;
  start?: string | null;
  end?: string | null;
  attendees?: string[] | null;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  code?: CalendarErrorCode;
}

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isValidIsoDate(s: string | null | undefined): boolean {
  if (!s || typeof s !== 'string') return false;
  if (!ISO_DATE_RE.test(s)) return false;
  const t = new Date(s).getTime();
  return Number.isFinite(t);
}

/**
 * Valide la forme d'un event payload AVANT de l'envoyer à un provider :
 *   - title non vide (après trim)
 *   - start + end ISO valides (regex + Date parsable)
 *   - end strictement > start
 *   - attendees optionnels mais si présents : limite MAX_ATTENDEES
 */
export function validateEventPayload(input: EventPayloadInput): ValidationResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'payload missing', code: CALENDAR_ERROR_CODES.INVALID_EVENT };
  }
  const title = (input.title ?? '').trim();
  if (!title) {
    return { ok: false, error: 'title required', code: CALENDAR_ERROR_CODES.MISSING_TITLE };
  }
  if (!isValidIsoDate(input.start)) {
    return { ok: false, error: 'start not ISO', code: CALENDAR_ERROR_CODES.INVALID_DATE };
  }
  if (!isValidIsoDate(input.end)) {
    return { ok: false, error: 'end not ISO', code: CALENDAR_ERROR_CODES.INVALID_DATE };
  }
  const startMs = new Date(input.start as string).getTime();
  const endMs = new Date(input.end as string).getTime();
  if (!(endMs > startMs)) {
    return { ok: false, error: 'end must be > start', code: CALENDAR_ERROR_CODES.INVALID_RANGE };
  }
  if (Array.isArray(input.attendees) && input.attendees.length > MAX_ATTENDEES) {
    return {
      ok: false,
      error: `attendees > ${MAX_ATTENDEES}`,
      code: CALENDAR_ERROR_CODES.INVALID_EVENT,
    };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════
//  ATTENDEES
// ════════════════════════════════════════════════════════════

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalise une liste d'attendees (formats variables : strings emails,
 * objets { email }, mix) :
 *   - filtre les non-emails
 *   - lowercase
 *   - trim
 *   - dedupe (Set)
 *   - cap MAX_ATTENDEES (premier-arrivé premier-servi après dedupe)
 *
 * Robuste à : null, undefined, []. Renvoie [] par défaut.
 */
export function normalizeAttendees(
  raw: unknown,
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let candidate: string | null = null;
    if (typeof item === 'string') candidate = item;
    else if (item && typeof item === 'object') {
      const obj = item as { email?: unknown; emailAddress?: { address?: unknown } };
      if (typeof obj.email === 'string') candidate = obj.email;
      else if (obj.emailAddress && typeof obj.emailAddress.address === 'string') {
        candidate = obj.emailAddress.address;
      }
    }
    if (!candidate) continue;
    const normalized = candidate.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_ATTENDEES) break;
  }
  return out;
}

// ════════════════════════════════════════════════════════════
//  ICS — RFC5545 helpers
// ════════════════════════════════════════════════════════════

export interface IcsEventInput {
  uid: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  description?: string;
  location?: string;
  organizer?: string;
}

/**
 * Convertit un ISO `2026-05-26T14:30:00Z` en `20260526T143000Z` (format
 * iCalendar DTSTART/DTEND). Si ISO ne contient pas d'heure → format DATE.
 */
function isoToIcsDate(iso: string): string {
  // Préserve la précision : strip séparateurs `-`, `:` et `.mmm`, garde TZ.
  const trimmed = iso.trim();
  // DATE-only (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed.replace(/-/g, '');
  }
  // DATETIME : conserver Z si présent.
  return trimmed
    .replace(/\.\d+/, '') // strip millis
    .replace(/[-:]/g, ''); // strip séparateurs
}

/** Échappe les caractères réservés ICS dans un champ texte (RFC5545 §3.3.11). */
function escapeIcsText(s: string): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Construit un bloc VEVENT RFC5545 minimal (compatible Google/Outlook/Apple).
 * Renvoie une string multi-lignes avec CRLF (\r\n) — convention ICS stricte.
 *
 * NB : pas de RRULE / ATTENDEE ici ; ajoutés en couche au-dessus si besoin.
 */
export function buildIcsEventLine(event: IcsEventInput): string {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${isoToIcsDate(new Date().toISOString())}`,
    `DTSTART:${isoToIcsDate(event.start)}`,
    `DTEND:${isoToIcsDate(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.organizer) lines.push(`ORGANIZER:mailto:${event.organizer}`);
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

export type IcsFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'HOURLY' | 'MINUTELY' | 'SECONDLY';

export interface IcsRecurrence {
  freq: IcsFreq;
  interval: number;
  until?: string;
  count?: number;
}

/**
 * Parse une string RRULE iCalendar (RFC5545) en objet structuré.
 * Supporte FREQ (requis), INTERVAL (défaut 1), UNTIL (ISO), COUNT (int).
 * Renvoie null si invalide ou FREQ absent.
 *
 * Exemples :
 *   "FREQ=DAILY;INTERVAL=2"           → { freq:'DAILY', interval:2 }
 *   "FREQ=WEEKLY;COUNT=10"            → { freq:'WEEKLY', interval:1, count:10 }
 *   "RRULE:FREQ=DAILY;UNTIL=20260601T000000Z" → { freq:'DAILY', interval:1, until }
 */
export function parseIcsRecurrence(rrule: string): IcsRecurrence | null {
  if (!rrule || typeof rrule !== 'string') return null;
  // Tolérer le préfixe "RRULE:".
  const body = rrule.replace(/^RRULE:/i, '').trim();
  if (!body) return null;
  const parts = body.split(';').filter(Boolean);
  const map: Record<string, string> = {};
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim().toUpperCase();
    const v = p.slice(idx + 1).trim();
    if (k && v) map[k] = v;
  }
  const freqRaw = (map.FREQ || '').toUpperCase();
  const ALLOWED: IcsFreq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'HOURLY', 'MINUTELY', 'SECONDLY'];
  if (!ALLOWED.includes(freqRaw as IcsFreq)) return null;
  const intervalParsed = map.INTERVAL ? parseInt(map.INTERVAL, 10) : 1;
  const interval = Number.isFinite(intervalParsed) && intervalParsed > 0 ? intervalParsed : 1;
  const result: IcsRecurrence = { freq: freqRaw as IcsFreq, interval };
  if (map.UNTIL) result.until = map.UNTIL;
  if (map.COUNT) {
    const n = parseInt(map.COUNT, 10);
    if (Number.isFinite(n) && n > 0) result.count = n;
  }
  return result;
}
