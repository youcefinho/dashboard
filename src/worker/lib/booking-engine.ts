// ════════════════════════════════════════════════════════════════════════════
// Sprint P0-2 — booking-engine.ts (helpers PURS, partagés cross-modules)
// ════════════════════════════════════════════════════════════════════════════
//
// Couvre `src/worker/{appointments,bookings,booking-public,booking-reminders}.ts`.
//
// Helpers 100 % PURS (no I/O, no D1, no fetch) → testables sans mock.
// Additif strict : aucun handler n'est forcé d'utiliser ces helpers. Les modules
// existants conservent leur logique ; les helpers fournissent une référence
// canonique pour `validateSlot`, `slotsOverlap`, `isWithinBusinessHours`,
// `isCancellable`, `computeReminderSchedule`, `parseTimeRange`,
// `applyTimezoneOffset`, `validateBookingInput`, `hashBookingToken`.
//
// Conventions :
//   - Imports relatifs uniquement (calque ./calendar-engine.ts).
//   - Dates : ISO 8601 UTC en stockage (`startAt`, `endAt`) → `string` ISO ou
//     `number` ms epoch. Pas de Date locale en interne.
//   - Codes d'erreur : `BOOKING_ERROR_CODES` (constante exportée — pas un enum
//     pour rester JSON-friendly côté Worker).
//   - Heures business : JSON `{ mon: '09:00-17:00', tue: '09:00-17:00', ... }`
//     (jours absents = fermé). Minutes since midnight côté helpers.
//   - Aucune throw : retour `{ ok: boolean; error?: string; field?: string }`.
// ════════════════════════════════════════════════════════════════════════════

// ── Constantes publiques ────────────────────────────────────────────────────

export const MIN_SLOT_DURATION_MIN = 15;
export const MAX_SLOT_DURATION_MIN = 480; // 8h
export const DEFAULT_CANCEL_WINDOW_HOURS = 24;
export const MAX_REMINDERS_PER_BOOKING = 5;
export const MAX_BUSINESS_HOURS_PER_DAY = 1; // 1 plage par jour (extensible plus tard)

/**
 * Codes d'erreur canoniques exposés par les handlers. Côté JSON, on renvoie
 * généralement `{ error: '...' }` (§6.A) — ces codes sont pour la couche
 * helper / log interne / tests. Listés in extenso pour faciliter le grep.
 */
export const BOOKING_ERROR_CODES = {
  SLOT_INVALID: 'SLOT_INVALID',
  SLOT_TOO_SHORT: 'SLOT_TOO_SHORT',
  SLOT_TOO_LONG: 'SLOT_TOO_LONG',
  SLOT_CONFLICT: 'SLOT_CONFLICT',
  OUTSIDE_HOURS: 'OUTSIDE_HOURS',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  ALREADY_CANCELLED: 'ALREADY_CANCELLED',
  ALREADY_COMPLETED: 'ALREADY_COMPLETED',
  BOOKING_EXPIRED: 'BOOKING_EXPIRED',
  CANCEL_WINDOW_PASSED: 'CANCEL_WINDOW_PASSED',
  INPUT_INVALID: 'INPUT_INVALID',
  EMAIL_INVALID: 'EMAIL_INVALID',
  PHONE_INVALID: 'PHONE_INVALID',
  NAME_REQUIRED: 'NAME_REQUIRED',
  HONEYPOT_TRIPPED: 'HONEYPOT_TRIPPED',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[keyof typeof BOOKING_ERROR_CODES];

// ── Types publics ───────────────────────────────────────────────────────────

export interface Slot {
  startAt: string | number; // ISO 8601 UTC | ms epoch
  endAt: string | number;
}

export interface NormalizedSlot {
  startMs: number;
  endMs: number;
}

export type BusinessHours = Record<string, string>;
// Ex: { mon: '09:00-17:00', tue: '09:00-17:00', wed: '09:00-12:00' }
// Jours fermés = clé absente OU valeur falsy.

export interface BookingStatusBearer {
  status?: string | null;
  startAt?: string | number | null;
  start_time?: string | null;
}

export interface ValidateResult {
  ok: boolean;
  error?: BookingErrorCode | string;
  field?: string;
}

// ── Normalisation interne (no-throw) ────────────────────────────────────────

function toMs(value: string | number | null | undefined): number {
  if (value == null) return Number.NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.NaN;
}

function normalize(slot: Slot): NormalizedSlot | null {
  const startMs = toMs(slot.startAt);
  const endMs = toMs(slot.endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs };
}

// ════════════════════════════════════════════════════════════════════════════
// validateSlot — start < end + durée bornes [MIN, MAX]
// ════════════════════════════════════════════════════════════════════════════

export function validateSlot(slot: Slot): ValidateResult {
  const n = normalize(slot);
  if (!n) return { ok: false, error: BOOKING_ERROR_CODES.SLOT_INVALID };
  if (n.startMs >= n.endMs) return { ok: false, error: BOOKING_ERROR_CODES.SLOT_INVALID };

  const durationMin = (n.endMs - n.startMs) / 60000;
  if (durationMin < MIN_SLOT_DURATION_MIN) {
    return { ok: false, error: BOOKING_ERROR_CODES.SLOT_TOO_SHORT };
  }
  if (durationMin > MAX_SLOT_DURATION_MIN) {
    return { ok: false, error: BOOKING_ERROR_CODES.SLOT_TOO_LONG };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// slotsOverlap — intervalle [start, end), exclusif droit
// ════════════════════════════════════════════════════════════════════════════
//
// Deux slots se chevauchent si A.start < B.end ET B.start < A.end. Bord-à-bord
// (A.end == B.start) = PAS d'overlap (compatible booking-public.ts:overlapsAny).

export function slotsOverlap(a: Slot, b: Slot): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na.startMs < nb.endMs && nb.startMs < na.endMs;
}

// ════════════════════════════════════════════════════════════════════════════
// parseTimeRange — "09:00-17:00" → { open: 540, close: 1020 }
// ════════════════════════════════════════════════════════════════════════════
//
// Format strict HH:MM-HH:MM (24h). Retourne null sur tout autre format.
// open & close = minutes since midnight. close > open requis. Pas de wrap
// minuit (un format "22:00-02:00" est rejeté — out of scope V1).

const TIME_RANGE_RE = /^([0-2]\d):([0-5]\d)-([0-2]\d):([0-5]\d)$/;

export function parseTimeRange(str: string): { open: number; close: number } | null {
  if (typeof str !== 'string') return null;
  const m = TIME_RANGE_RE.exec(str.trim());
  if (!m) return null;
  const oh = Number(m[1]);
  const om = Number(m[2]);
  const ch = Number(m[3]);
  const cm = Number(m[4]);
  if (oh > 23 || ch > 23) return null;
  const open = oh * 60 + om;
  const close = ch * 60 + cm;
  if (close <= open) return null;
  return { open, close };
}

// ════════════════════════════════════════════════════════════════════════════
// isWithinBusinessHours — slot ∈ businessHours[weekday] ?
// ════════════════════════════════════════════════════════════════════════════
//
// Le weekday est calculé en UTC (les helpers du moteur sont TZ-agnostic ; la
// conversion TZ-locale est faite côté handler via `applyTimezoneOffset` ou via
// l'algo §6.C de booking-public.ts qui fait sa propre conversion via Intl.DTF).
//
// businessHours clés acceptées : 'sun','mon','tue','wed','thu','fri','sat'
// (lowercase 3 lettres). Si la clé du jour est absente OU la valeur n'est pas
// un range valide → fermé → false.

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function isWithinBusinessHours(slot: Slot, businessHours: BusinessHours): boolean {
  const n = normalize(slot);
  if (!n) return false;
  if (!businessHours || typeof businessHours !== 'object') return false;

  const start = new Date(n.startMs);
  const end = new Date(n.endMs);
  // Slot ne doit pas traverser un jour (sinon ambigu vs business hours par jour).
  if (start.getUTCFullYear() !== end.getUTCFullYear()
    || start.getUTCMonth() !== end.getUTCMonth()
    || start.getUTCDate() !== end.getUTCDate()) {
    // Si end == début exact du jour suivant, on accepte (slot finit pile minuit).
    const endIsMidnightNextDay = end.getUTCHours() === 0 && end.getUTCMinutes() === 0
      && (end.getUTCDate() === start.getUTCDate() + 1
        || (end.getUTCMonth() !== start.getUTCMonth() && end.getUTCDate() === 1));
    if (!endIsMidnightNextDay) return false;
  }

  const wdKey = WEEKDAY_KEYS[start.getUTCDay()];
  if (!wdKey) return false; // garde noUncheckedIndexedAccess (jour 0..6 garanti par Date)
  const raw = businessHours[wdKey];
  if (!raw || typeof raw !== 'string') return false;
  const range = parseTimeRange(raw);
  if (!range) return false;

  const slotOpen = start.getUTCHours() * 60 + start.getUTCMinutes();
  const slotClose = end.getUTCHours() * 60 + end.getUTCMinutes();
  // Cas slot finissant minuit (00:00) → 24*60 effectif.
  const effectiveClose = (slotClose === 0 && n.endMs > n.startMs) ? 24 * 60 : slotClose;

  return slotOpen >= range.open && effectiveClose <= range.close;
}

// ════════════════════════════════════════════════════════════════════════════
// isCancellable — fenêtre + statut
// ════════════════════════════════════════════════════════════════════════════
//
// Refuse si :
//   - booking absent
//   - status ∈ {'cancelled', 'completed', 'no_show'} (déjà clos)
//   - now > startAt - cancelWindowHours (trop tard pour annuler)
//   - now > startAt (RDV passé)
// `cancelWindowHours` défaut DEFAULT_CANCEL_WINDOW_HOURS (24h).

export function isCancellable(
  booking: BookingStatusBearer | null | undefined,
  nowDate: Date,
  cancelWindowHours: number = DEFAULT_CANCEL_WINDOW_HOURS,
): ValidateResult {
  if (!booking) return { ok: false, error: BOOKING_ERROR_CODES.BOOKING_NOT_FOUND };

  const status = (booking.status || '').toLowerCase();
  if (status === 'cancelled') return { ok: false, error: BOOKING_ERROR_CODES.ALREADY_CANCELLED };
  if (status === 'completed') return { ok: false, error: BOOKING_ERROR_CODES.ALREADY_COMPLETED };
  if (status === 'no_show') return { ok: false, error: BOOKING_ERROR_CODES.ALREADY_COMPLETED };

  const startMs = toMs(booking.startAt ?? booking.start_time ?? null);
  if (!Number.isFinite(startMs)) return { ok: false, error: BOOKING_ERROR_CODES.SLOT_INVALID };

  const nowMs = nowDate.getTime();
  if (nowMs >= startMs) return { ok: false, error: BOOKING_ERROR_CODES.BOOKING_EXPIRED };

  const windowMs = Math.max(0, cancelWindowHours) * 3600_000;
  if (nowMs > startMs - windowMs) {
    return { ok: false, error: BOOKING_ERROR_CODES.CANCEL_WINDOW_PASSED };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// computeReminderSchedule — dates ABSOLUES de rappel (T - offset)
// ════════════════════════════════════════════════════════════════════════════
//
// `leadDurationsMin` = liste d'offsets en minutes avant `startAt`. Ex:
// [24*60, 2*60] → 2 rappels (T-24h, T-2h). Filtre :
//   - offset <= 0 ignoré
//   - cap MAX_REMINDERS_PER_BOOKING
//   - dates passées (avant `now` si fourni) retournées mais classables côté
//     handler ; ce helper reste pur (laisse le filtrage temporel au caller).
// Retourne les Dates triées chronologiquement (plus tôt en premier).

export function computeReminderSchedule(
  startAt: string | number | Date,
  leadDurationsMin: number[],
): Date[] {
  let startMs: number;
  if (startAt instanceof Date) startMs = startAt.getTime();
  else startMs = toMs(startAt);
  if (!Number.isFinite(startMs)) return [];
  if (!Array.isArray(leadDurationsMin) || leadDurationsMin.length === 0) return [];

  const seen = new Set<number>();
  const dates: Date[] = [];
  for (const off of leadDurationsMin) {
    const n = Number(off);
    if (!Number.isFinite(n) || n <= 0) continue;
    const at = startMs - n * 60000;
    if (seen.has(at)) continue;
    seen.add(at);
    dates.push(new Date(at));
    if (dates.length >= MAX_REMINDERS_PER_BOOKING) break;
  }
  dates.sort((a, b) => a.getTime() - b.getTime());
  return dates;
}

// ════════════════════════════════════════════════════════════════════════════
// applyTimezoneOffset — décale une Date pour rendu local (display only)
// ════════════════════════════════════════════════════════════════════════════
//
// Helper bas-niveau : prend une Date UTC + un offset string ('+05:30', '-04:00',
// 'Z', 'UTC') et retourne une Date dont les composantes UTC correspondent à
// l'heure locale du offset (utile pour formats display côté SMS/Email).
// NB: pour les TZ avec DST, préférer Intl.DateTimeFormat avec timeZone (déjà
// utilisé dans booking-public.ts:utcInstant / tzOffsetMinutes). Ce helper sert
// pour les TZ à offset fixe (ex: confirmation mail dans un fuseau donné).

const OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;

export function applyTimezoneOffset(date: Date, offset: string): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return new Date(NaN);
  if (typeof offset !== 'string') return new Date(date.getTime());
  const trimmed = offset.trim().toUpperCase();
  if (trimmed === 'Z' || trimmed === 'UTC' || trimmed === '+00:00' || trimmed === '-00:00') {
    return new Date(date.getTime());
  }
  const m = OFFSET_RE.exec(trimmed);
  if (!m) return new Date(date.getTime());
  const sign = m[1] === '+' ? 1 : -1;
  const oh = Number(m[2]);
  const om = Number(m[3]);
  if (oh > 23 || om > 59) return new Date(date.getTime());
  const offsetMs = sign * (oh * 60 + om) * 60000;
  return new Date(date.getTime() + offsetMs);
}

// ════════════════════════════════════════════════════════════════════════════
// validateBookingInput — validation full payload public (anti-bot)
// ════════════════════════════════════════════════════════════════════════════
//
// Champs vérifiés :
//   - guest_name (requis, non vide après trim, <= 100 chars)
//   - guest_email (requis, format basique RFC-like, <= 200 chars)
//   - guest_phone (optionnel, format E.164-lax si fourni)
//   - start_time (requis, ISO 8601 parsable)
//   - honeypot (champ piège : doit être absent OU vide ; rempli ⇒ bot)
//
// Anti-bot : `honeypot_field` (par convention `website` ou `hp`) — handler
// passe `body.website` ici. Si tripped → SLOT_INVALID style (HONEYPOT_TRIPPED)
// avec ok=false ; handler renvoie un 200 trompeur (calque pattern lead-honeypot
// dans leads-engine).

export interface BookingInput {
  guest_name?: unknown;
  guest_email?: unknown;
  guest_phone?: unknown;
  start_time?: unknown;
  honeypot?: unknown; // doit être absent / vide / null / undefined
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_LAX_RE = /^[+]?[0-9 ()\-.]{6,30}$/;

export function validateBookingInput(input: BookingInput | null | undefined): ValidateResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: BOOKING_ERROR_CODES.INPUT_INVALID };
  }

  // Honeypot d'abord — si bot, on ne donne aucun signal sur les autres champs.
  if (input.honeypot != null && String(input.honeypot).trim() !== '') {
    return { ok: false, error: BOOKING_ERROR_CODES.HONEYPOT_TRIPPED, field: 'honeypot' };
  }

  const name = typeof input.guest_name === 'string' ? input.guest_name.trim() : '';
  if (!name) return { ok: false, error: BOOKING_ERROR_CODES.NAME_REQUIRED, field: 'guest_name' };
  if (name.length > 100) {
    return { ok: false, error: BOOKING_ERROR_CODES.INPUT_INVALID, field: 'guest_name' };
  }

  const email = typeof input.guest_email === 'string' ? input.guest_email.trim() : '';
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    return { ok: false, error: BOOKING_ERROR_CODES.EMAIL_INVALID, field: 'guest_email' };
  }

  if (input.guest_phone != null && String(input.guest_phone).trim() !== '') {
    const phone = String(input.guest_phone).trim();
    if (phone.length > 30 || !PHONE_LAX_RE.test(phone)) {
      return { ok: false, error: BOOKING_ERROR_CODES.PHONE_INVALID, field: 'guest_phone' };
    }
  }

  const startRaw = typeof input.start_time === 'string' ? input.start_time.trim() : '';
  if (!startRaw) {
    return { ok: false, error: BOOKING_ERROR_CODES.SLOT_INVALID, field: 'start_time' };
  }
  const startMs = Date.parse(startRaw);
  if (!Number.isFinite(startMs)) {
    return { ok: false, error: BOOKING_ERROR_CODES.SLOT_INVALID, field: 'start_time' };
  }

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// hashBookingToken — short hash pour liens SMS (cancel/reschedule)
// ════════════════════════════════════════════════════════════════════════════
//
// Hash DJB2 (32-bit) → 8 chars base36. Suffisamment court pour SMS, suffisamment
// déterministe pour matcher côté handler. NE remplace PAS un secret signé :
// reste un identifiant compact (le `booking_id` UUID demeure la source de
// vérité ; ce hash sert de checksum visuel). Pas de collision attendue à l'échelle
// d'un tenant (UUIDs distincts → hash distinct sauf collision DJB2 mathématique
// rare).

export function hashBookingToken(token: string): string {
  if (typeof token !== 'string' || token.length === 0) return '';
  let hash = 5381;
  for (let i = 0; i < token.length; i++) {
    // hash * 33 + c — version 32-bit safe
    hash = ((hash << 5) + hash + token.charCodeAt(i)) | 0;
  }
  // Force unsigned 32-bit → base36, pad-left à 8 chars max (DJB2 32-bit ~13 chars en base36).
  const unsigned = hash >>> 0;
  return unsigned.toString(36).padStart(7, '0').slice(0, 8);
}
