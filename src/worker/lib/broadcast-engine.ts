// ── broadcast-engine.ts ─────────────────────────────────────────────────────
// Helpers PURS pour `broadcast.ts` (Marketing P1-5, renforcement 2026-05-26) :
//   - VALID_CHANNELS whitelist (email|sms) frozen
//   - MAX_RECIPIENTS / MAX_THROTTLE_PER_MIN caps
//   - validateBroadcastInput (subject, body, channel, recipients)
//   - validateAbVariants (sum split_pct = 100)
//   - validateScheduledAt (ISO futur, max +90j)
//   - computeThrottleSchedule (batches + duration)
//   - assignVariantBucket (FNV-1a déterministe par recipient)
//   - validateRecipientCount (cap)
//
// Bornage tenant : assuré par le handler broadcast.ts (segment client_id /
// filters.tags + client_id). Ces helpers sont PURS — pas de DB, pas d'I/O.
// Best-effort STRICT : retours Result `{ ok; error? }`.

/** Codes d'erreur normalisés. */
export const BROADCAST_ERROR_CODES = Object.freeze({
  SUBJECT_REQUIRED: 'SUBJECT_REQUIRED',
  SUBJECT_TOO_LONG: 'SUBJECT_TOO_LONG',
  BODY_REQUIRED: 'BODY_REQUIRED',
  CHANNEL_INVALID: 'CHANNEL_INVALID',
  RECIPIENTS_REQUIRED: 'RECIPIENTS_REQUIRED',
  RECIPIENTS_TOO_MANY: 'RECIPIENTS_TOO_MANY',
  THROTTLE_INVALID: 'THROTTLE_INVALID',
  THROTTLE_TOO_HIGH: 'THROTTLE_TOO_HIGH',
  AB_VARIANTS_EMPTY: 'AB_VARIANTS_EMPTY',
  AB_SPLIT_INVALID: 'AB_SPLIT_INVALID',
  AB_SPLIT_NOT_100: 'AB_SPLIT_NOT_100',
  SCHEDULED_AT_INVALID: 'SCHEDULED_AT_INVALID',
  SCHEDULED_AT_PAST: 'SCHEDULED_AT_PAST',
  SCHEDULED_AT_TOO_FAR: 'SCHEDULED_AT_TOO_FAR',
} as const);

export type BroadcastErrorCode =
  (typeof BROADCAST_ERROR_CODES)[keyof typeof BROADCAST_ERROR_CODES];

/** Plafonds & whitelist. */
export const MAX_RECIPIENTS = 10000;
export const MAX_THROTTLE_PER_MIN = 200;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 100000;
export const MAX_SCHEDULED_AHEAD_DAYS = 90;

/** Canaux valides (frozen). */
export const VALID_CHANNELS = Object.freeze(['email', 'sms'] as const);
export type BroadcastChannel = (typeof VALID_CHANNELS)[number];

/** Result type uniforme. */
export interface BroadcastValidation {
  ok: boolean;
  error?: string;
  code?: BroadcastErrorCode;
  field?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// validateBroadcastInput — valide { subject, body, channel, recipients }.
// ────────────────────────────────────────────────────────────────────────────

export interface BroadcastInput {
  subject?: unknown;
  body?: unknown;
  channel?: unknown;
  recipients?: unknown;
  throttle_per_min?: unknown;
}

export function validateBroadcastInput(input: BroadcastInput): BroadcastValidation {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Entrée broadcast requise',
      code: BROADCAST_ERROR_CODES.SUBJECT_REQUIRED,
    };
  }
  // Subject : SMS peut accepter subject vide ("Diffusion SMS" injecté), donc on
  // ne le bloque que si VRAIMENT absent/vide quand channel === 'email'.
  const channel = typeof input.channel === 'string' ? input.channel : 'email';
  if (!VALID_CHANNELS.includes(channel as BroadcastChannel)) {
    return {
      ok: false,
      error: `Channel invalide (valeurs : ${VALID_CHANNELS.join('|')})`,
      code: BROADCAST_ERROR_CODES.CHANNEL_INVALID,
      field: 'channel',
    };
  }
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (channel === 'email' && !subject) {
    return {
      ok: false,
      error: 'Sujet requis',
      code: BROADCAST_ERROR_CODES.SUBJECT_REQUIRED,
      field: 'subject',
    };
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return {
      ok: false,
      error: `Sujet trop long (max ${MAX_SUBJECT_LENGTH})`,
      code: BROADCAST_ERROR_CODES.SUBJECT_TOO_LONG,
      field: 'subject',
    };
  }
  const body = typeof input.body === 'string' ? input.body : '';
  if (!body || !body.trim()) {
    return {
      ok: false,
      error: 'Contenu requis',
      code: BROADCAST_ERROR_CODES.BODY_REQUIRED,
      field: 'body',
    };
  }
  if (body.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      error: `Contenu trop long (max ${MAX_BODY_LENGTH})`,
      code: BROADCAST_ERROR_CODES.BODY_REQUIRED,
      field: 'body',
    };
  }
  if (input.throttle_per_min !== undefined && input.throttle_per_min !== null) {
    const t = Number(input.throttle_per_min);
    if (!Number.isFinite(t) || t < 0) {
      return {
        ok: false,
        error: 'throttle_per_min invalide',
        code: BROADCAST_ERROR_CODES.THROTTLE_INVALID,
        field: 'throttle_per_min',
      };
    }
    if (t > MAX_THROTTLE_PER_MIN) {
      return {
        ok: false,
        error: `throttle_per_min trop élevé (max ${MAX_THROTTLE_PER_MIN})`,
        code: BROADCAST_ERROR_CODES.THROTTLE_TOO_HIGH,
        field: 'throttle_per_min',
      };
    }
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// validateRecipientCount — borne le nombre de destinataires.
// ────────────────────────────────────────────────────────────────────────────

export function validateRecipientCount(count: number): BroadcastValidation {
  if (!Number.isFinite(count) || count < 0) {
    return {
      ok: false,
      error: 'Compte destinataires invalide',
      code: BROADCAST_ERROR_CODES.RECIPIENTS_REQUIRED,
      field: 'recipients',
    };
  }
  if (count === 0) {
    return {
      ok: false,
      error: 'Aucun destinataire éligible',
      code: BROADCAST_ERROR_CODES.RECIPIENTS_REQUIRED,
      field: 'recipients',
    };
  }
  if (count > MAX_RECIPIENTS) {
    return {
      ok: false,
      error: `Trop de destinataires (max ${MAX_RECIPIENTS})`,
      code: BROADCAST_ERROR_CODES.RECIPIENTS_TOO_MANY,
      field: 'recipients',
    };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// validateAbVariants — somme des split_pct doit être 100 (tolerance ±0.1).
// ────────────────────────────────────────────────────────────────────────────

export interface AbVariant {
  id?: string;
  split_pct: number;
  subject?: string | null;
  body_html?: string | null;
  body_text?: string | null;
}

export function validateAbVariants(variants: AbVariant[]): BroadcastValidation {
  if (!Array.isArray(variants) || variants.length === 0) {
    return {
      ok: false,
      error: 'Variantes A/B requises (au moins 1)',
      code: BROADCAST_ERROR_CODES.AB_VARIANTS_EMPTY,
      field: 'variants',
    };
  }
  let sum = 0;
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]!;
    const p = Number(v.split_pct);
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      return {
        ok: false,
        error: `split_pct invalide (variante #${i + 1})`,
        code: BROADCAST_ERROR_CODES.AB_SPLIT_INVALID,
        field: `variants[${i}].split_pct`,
      };
    }
    sum += p;
  }
  // Tolérance ±0.1 pour absorber les arrondis flottants raisonnables.
  if (Math.abs(sum - 100) > 0.1) {
    return {
      ok: false,
      error: `Somme split_pct = ${sum.toFixed(2)}, attendu 100`,
      code: BROADCAST_ERROR_CODES.AB_SPLIT_NOT_100,
      field: 'variants',
    };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// validateScheduledAt — ISO futur, max +90j.
// ────────────────────────────────────────────────────────────────────────────

export function validateScheduledAt(
  iso: string | null | undefined,
  now: number = Date.now(),
): BroadcastValidation {
  if (!iso) {
    // Pas de programmation = envoi immédiat (valide).
    return { ok: true };
  }
  if (typeof iso !== 'string') {
    return {
      ok: false,
      error: 'scheduled_at doit être une chaîne ISO',
      code: BROADCAST_ERROR_CODES.SCHEDULED_AT_INVALID,
      field: 'scheduled_at',
    };
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return {
      ok: false,
      error: 'scheduled_at invalide (format ISO requis)',
      code: BROADCAST_ERROR_CODES.SCHEDULED_AT_INVALID,
      field: 'scheduled_at',
    };
  }
  if (t <= now) {
    return {
      ok: false,
      error: 'scheduled_at doit être futur',
      code: BROADCAST_ERROR_CODES.SCHEDULED_AT_PAST,
      field: 'scheduled_at',
    };
  }
  const maxAhead = now + MAX_SCHEDULED_AHEAD_DAYS * 24 * 60 * 60 * 1000;
  if (t > maxAhead) {
    return {
      ok: false,
      error: `scheduled_at trop éloigné (max +${MAX_SCHEDULED_AHEAD_DAYS}j)`,
      code: BROADCAST_ERROR_CODES.SCHEDULED_AT_TOO_FAR,
      field: 'scheduled_at',
    };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// computeThrottleSchedule — calcule batches + durée d'envoi.
// ────────────────────────────────────────────────────────────────────────────

export interface ThrottleSchedule {
  batches: number;
  durationMin: number;
}

export function computeThrottleSchedule(
  total: number,
  throttlePerMin: number,
): ThrottleSchedule {
  const t = Number(total);
  const tpm = Number(throttlePerMin);
  if (!Number.isFinite(t) || t <= 0) return { batches: 0, durationMin: 0 };
  if (!Number.isFinite(tpm) || tpm <= 0) {
    // Throttle 0 = envoi aveugle / immédiat (legacy).
    return { batches: 1, durationMin: 0 };
  }
  const batches = Math.ceil(t / tpm);
  // Entre chaque batch, ~1 minute d'attente. Dernier batch sans attente.
  const durationMin = Math.max(0, batches - 1);
  return { batches, durationMin };
}

// ────────────────────────────────────────────────────────────────────────────
// assignVariantBucket — partition déterministe FNV-1a.
// ────────────────────────────────────────────────────────────────────────────

/** FNV-1a 32-bit déterministe (offline-safe, ZÉRO collision visible <10K leads). */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Math.imul pour rester en 32-bit propre.
    hash = Math.imul(hash, 0x01000193);
  }
  // Normalise en uint32.
  return hash >>> 0;
}

/**
 * Affecte un recipient à UNE variante de manière déterministe (même
 * recipient → même variante, idéal pour l'idempotence A/B).
 * Si la somme split_pct n'est pas 100, on normalise.
 */
export function assignVariantBucket(
  recipientId: string,
  variants: AbVariant[],
): AbVariant | null {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  if (!recipientId) return variants[0] ?? null;
  // Bucket uniforme 0..9999 dérivé du hash.
  const bucket = fnv1aHash(recipientId) % 10000;
  // Somme normalisée → seuils cumulés.
  const totalPct = variants.reduce((s, v) => s + (Number(v.split_pct) || 0), 0);
  if (totalPct <= 0) return variants[0] ?? null;
  let cumulative = 0;
  for (const v of variants) {
    const pct = (Number(v.split_pct) || 0) / totalPct; // normalisé 0..1
    cumulative += pct * 10000;
    if (bucket < cumulative) return v;
  }
  // Edge cas (arrondi flottant) : dernière variante.
  return variants[variants.length - 1] ?? null;
}
