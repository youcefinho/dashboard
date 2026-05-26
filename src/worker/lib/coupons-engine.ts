// ── Coupons engine — Sprint P0-6 (2026-05-26) ────────────────────────────────
//
// Helpers PURS de validation/calcul pour le module Coupons (ecommerce-coupons.ts).
// 100 % additif : aucune modification de signature/comportement existant.
//
// Renforce les gaps du module legacy :
//   - format du code (alphanumeric upper + dashes, 4..20 chars)
//   - bornes discount (pct 0..100, fixed en cents > 0)
//   - fenêtres temporelles (starts_at < expires_at, dates ISO valides)
//   - quotas (usage_limit total, per_customer_limit)
//   - statut actif effectif (date + usage + flag is_active)
//   - calcul de remise normalisé + plafonnage panier
//
// Conventions du projet :
//   - Helpers PURS uniquement (no I/O, no D1) → testables instantanément
//   - Money en CENTS INTEGER (jamais de float)
//   - PAS de throw — `{ ok, error?, field? }` discriminé
//   - Imports relatifs uniquement (`../types`)

// ── Codes d'erreur figés (discrimination string-match côté tests) ────────────

export const COUPON_ERROR_CODES = {
  CODE_REQUIRED: 'code_required',
  CODE_TOO_SHORT: 'code_too_short',
  CODE_TOO_LONG: 'code_too_long',
  CODE_INVALID_FORMAT: 'code_invalid_format',
  TYPE_INVALID: 'type_invalid',
  VALUE_INVALID: 'value_invalid',
  VALUE_OUT_OF_BOUNDS: 'value_out_of_bounds',
  DATE_INVALID: 'date_invalid',
  DATE_RANGE_INVALID: 'date_range_invalid',
  USAGE_LIMIT_INVALID: 'usage_limit_invalid',
  PER_CUSTOMER_LIMIT_INVALID: 'per_customer_limit_invalid',
  COUPON_INACTIVE: 'coupon_inactive',
  COUPON_NOT_STARTED: 'coupon_not_started',
  COUPON_EXPIRED: 'coupon_expired',
  COUPON_USAGE_REACHED: 'coupon_usage_reached',
  COUPON_PER_CUSTOMER_REACHED: 'coupon_per_customer_reached',
} as const;

export const MIN_CODE_LENGTH = 4;
export const MAX_CODE_LENGTH = 20;

export const VALID_COUPON_TYPES = ['percent', 'fixed', 'bogo'] as const;
export type CouponType = (typeof VALID_COUPON_TYPES)[number];

// ── Types ────────────────────────────────────────────────────────────────────

export interface CouponInput {
  code?: string;
  type?: string;
  value?: number; // percent (0..100) OU cents (>0) selon type
  starts_at?: string | null;
  expires_at?: string | null;
  usage_limit?: number | null;
  per_customer_limit?: number | null;
}

export interface CouponLike {
  code: string;
  type?: string;
  discount_type?: string | null;
  /** Pourcentage (si percent) — 0..100. */
  discount_percent?: number | null;
  /** Montant fixe en CENTS (si fixed). */
  discount_amount?: number | null;
  /** Valeur unifiée alternative (= percent ou cents selon type). */
  value?: number | null;
  starts_at?: string | null;
  expires_at?: string | null;
  usage_limit?: number | null;
  times_used?: number | null;
  per_customer_limit?: number | null;
  is_active?: number | null;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  field?: string;
}

// ── Helpers internes ─────────────────────────────────────────────────────────

const CODE_REGEX = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function isValidIsoDate(s: string): boolean {
  // Accepte "YYYY-MM-DD" ou "YYYY-MM-DD HH:MM:SS" ou ISO complet.
  if (!s || typeof s !== 'string') return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

function pickDiscountValue(c: CouponLike): { type: CouponType; value: number } {
  const rawType = (c.type || c.discount_type || '').toString().toLowerCase().trim();
  const type: CouponType = rawType === 'fixed'
    ? 'fixed'
    : rawType === 'bogo'
      ? 'bogo'
      : 'percent';

  let value = 0;
  if (type === 'percent') {
    const v = Number(c.discount_percent ?? c.value ?? 0);
    if (Number.isFinite(v)) value = v;
  } else if (type === 'fixed') {
    const v = Number(c.discount_amount ?? c.value ?? 0);
    if (Number.isFinite(v)) value = v;
  }
  return { type, value };
}

// ── Helpers exportés ─────────────────────────────────────────────────────────

/**
 * Valide le format d'un code coupon : alphanumeric UPPERCASE + dashes
 * (non-consécutifs, pas en bord), 4..20 caractères.
 *
 * Exemples OK : "BLACK20", "WELCOME-2026", "X1Y2".
 * Exemples KO : "abc", "BLACK 20", "X", "-BLACK-", "BLACK--20".
 */
export function validateCouponCode(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  const c = code.trim();
  if (c.length < MIN_CODE_LENGTH || c.length > MAX_CODE_LENGTH) return false;
  return CODE_REGEX.test(c);
}

/**
 * Valide un input de création/maj de coupon (PUR, no I/O). Retourne
 * `{ ok, error?, field? }` discriminé pour collecte d'erreurs côté handler.
 */
export function validateCouponInput(input: CouponInput): ValidationResult {
  // 1. Code
  const code = (input.code || '').toString().trim();
  if (!code) {
    return { ok: false, error: COUPON_ERROR_CODES.CODE_REQUIRED, field: 'code' };
  }
  if (code.length < MIN_CODE_LENGTH) {
    return { ok: false, error: COUPON_ERROR_CODES.CODE_TOO_SHORT, field: 'code' };
  }
  if (code.length > MAX_CODE_LENGTH) {
    return { ok: false, error: COUPON_ERROR_CODES.CODE_TOO_LONG, field: 'code' };
  }
  if (!validateCouponCode(code)) {
    return { ok: false, error: COUPON_ERROR_CODES.CODE_INVALID_FORMAT, field: 'code' };
  }

  // 2. Type
  const rawType = (input.type || '').toString().toLowerCase().trim();
  if (!rawType || !(VALID_COUPON_TYPES as readonly string[]).includes(rawType)) {
    return { ok: false, error: COUPON_ERROR_CODES.TYPE_INVALID, field: 'type' };
  }
  const type = rawType as CouponType;

  // 3. Value (sauf bogo qui n'a pas de valeur monétaire directe)
  if (type !== 'bogo') {
    const v = Number(input.value);
    if (!Number.isFinite(v)) {
      return { ok: false, error: COUPON_ERROR_CODES.VALUE_INVALID, field: 'value' };
    }
    if (type === 'percent') {
      if (v <= 0 || v > 100) {
        return { ok: false, error: COUPON_ERROR_CODES.VALUE_OUT_OF_BOUNDS, field: 'value' };
      }
    } else if (type === 'fixed') {
      if (v <= 0 || !Number.isInteger(v)) {
        return { ok: false, error: COUPON_ERROR_CODES.VALUE_OUT_OF_BOUNDS, field: 'value' };
      }
    }
  }

  // 4. Dates
  if (input.starts_at != null && input.starts_at !== '') {
    if (!isValidIsoDate(String(input.starts_at))) {
      return { ok: false, error: COUPON_ERROR_CODES.DATE_INVALID, field: 'starts_at' };
    }
  }
  if (input.expires_at != null && input.expires_at !== '') {
    if (!isValidIsoDate(String(input.expires_at))) {
      return { ok: false, error: COUPON_ERROR_CODES.DATE_INVALID, field: 'expires_at' };
    }
  }
  if (input.starts_at && input.expires_at) {
    const s = Date.parse(String(input.starts_at));
    const e = Date.parse(String(input.expires_at));
    if (Number.isFinite(s) && Number.isFinite(e) && s >= e) {
      return { ok: false, error: COUPON_ERROR_CODES.DATE_RANGE_INVALID, field: 'expires_at' };
    }
  }

  // 5. Usage limits
  if (input.usage_limit != null) {
    const u = Number(input.usage_limit);
    if (!Number.isFinite(u) || u < 0 || !Number.isInteger(u)) {
      return { ok: false, error: COUPON_ERROR_CODES.USAGE_LIMIT_INVALID, field: 'usage_limit' };
    }
  }
  if (input.per_customer_limit != null) {
    const p = Number(input.per_customer_limit);
    if (!Number.isFinite(p) || p < 0 || !Number.isInteger(p)) {
      return {
        ok: false,
        error: COUPON_ERROR_CODES.PER_CUSTOMER_LIMIT_INVALID,
        field: 'per_customer_limit',
      };
    }
  }

  return { ok: true };
}

/**
 * Vérifie qu'un coupon est ACTIF à un instant donné (date window + usage
 * global + flag is_active). PUR — `now` est injecté pour testabilité (ISO).
 */
export function isCouponActive(
  coupon: CouponLike,
  now: string | Date = new Date(),
): { active: boolean; reason?: string } {
  if (coupon.is_active != null && Number(coupon.is_active) === 0) {
    return { active: false, reason: COUPON_ERROR_CODES.COUPON_INACTIVE };
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (Number.isFinite(nowMs)) {
    if (coupon.starts_at) {
      const startMs = Date.parse(String(coupon.starts_at));
      if (Number.isFinite(startMs) && nowMs < startMs) {
        return { active: false, reason: COUPON_ERROR_CODES.COUPON_NOT_STARTED };
      }
    }
    if (coupon.expires_at) {
      const endMs = Date.parse(String(coupon.expires_at));
      if (Number.isFinite(endMs) && nowMs > endMs) {
        return { active: false, reason: COUPON_ERROR_CODES.COUPON_EXPIRED };
      }
    }
  }

  if (coupon.usage_limit != null && Number.isFinite(Number(coupon.usage_limit))) {
    const used = Number(coupon.times_used ?? 0);
    if (used >= Number(coupon.usage_limit)) {
      return { active: false, reason: COUPON_ERROR_CODES.COUPON_USAGE_REACHED };
    }
  }

  return { active: true };
}

/**
 * Calcule la remise (cents) pour un sous-total donné. Plafonné au total.
 * PUR. Retourne `{ discount, final }` (cents INT). Bogo → 0 ici (résolu en amont
 * par item, hors scope du moteur monétaire).
 */
export function computeDiscount(
  coupon: CouponLike,
  orderTotal: number,
): { discount: number; final: number } {
  const total = Math.max(0, Math.round(Number(orderTotal) || 0));
  const { type, value } = pickDiscountValue(coupon);

  let discount = 0;
  if (type === 'percent') {
    const pct = Math.max(0, Math.min(100, value));
    discount = Math.round(total * (pct / 100));
  } else if (type === 'fixed') {
    discount = Math.max(0, Math.round(value));
  } else {
    discount = 0;
  }

  discount = Math.max(0, Math.min(discount, total));
  return { discount, final: total - discount };
}

/**
 * Vérifie qu'un client peut encore utiliser ce coupon vs sa propre limite
 * (per_customer_limit). PUR — `customerUsageCount` est injecté (lookup côté DB).
 */
export function canUseCoupon(
  coupon: CouponLike,
  customerUsageCount: number,
): { ok: boolean; reason?: string } {
  if (coupon.per_customer_limit == null) return { ok: true };
  const limit = Number(coupon.per_customer_limit);
  if (!Number.isFinite(limit) || limit <= 0) return { ok: true };
  const used = Math.max(0, Math.round(Number(customerUsageCount) || 0));
  if (used >= limit) {
    return { ok: false, reason: COUPON_ERROR_CODES.COUPON_PER_CUSTOMER_REACHED };
  }
  return { ok: true };
}
