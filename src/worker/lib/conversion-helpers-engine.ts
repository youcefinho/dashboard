// ── conversion-helpers-engine.ts ────────────────────────────────────────────
// Helpers PURS extraits de `conversion-engine.ts` (Sprint 13, renforcement
// 2026-05-26) :
//   - clampScore [0..100]
//   - computeWeightedScore (factors[] → score pondéré)
//   - confidenceFromSampleSize ('low'|'medium'|'high')
//   - estimateSampleFromFactors (parse "(n=X)" depuis labels)
//   - validateBaselineInput (dimension whitelist, sample_size, conversion_rate)
//   - VALID_DIMENSIONS / FACTOR_LABEL_WHITELIST frozen
//
// Bornage tenant : assuré par le handler conversion-engine.ts. Ces helpers
// sont PURS — pas de DB, pas d'I/O, déterministes, offline-safe.

/** Codes d'erreur normalisés. */
export const CONVERSION_HELPERS_ERROR_CODES = Object.freeze({
  DIMENSION_INVALID: 'DIMENSION_INVALID',
  SAMPLE_SIZE_INVALID: 'SAMPLE_SIZE_INVALID',
  CONVERSION_RATE_INVALID: 'CONVERSION_RATE_INVALID',
  FACTORS_NOT_ARRAY: 'FACTORS_NOT_ARRAY',
  FACTOR_LABEL_INVALID: 'FACTOR_LABEL_INVALID',
} as const);

export type ConversionHelpersErrorCode =
  (typeof CONVERSION_HELPERS_ERROR_CODES)[keyof typeof CONVERSION_HELPERS_ERROR_CODES];

/** Dimensions valides pour conversion_baselines (frozen). */
export const VALID_DIMENSIONS = Object.freeze([
  'source',
  'status',
  'score_bucket',
  'overall',
] as const);

export type BaselineDimension = (typeof VALID_DIMENSIONS)[number];

/** Whitelist des labels de facteurs connus (anti-leak / cohérence UI). */
export const FACTOR_LABEL_WHITELIST = Object.freeze([
  'Activité récente',
  'Engagement',
  'Étape pipeline',
  'Valeur deal',
  'Source',
  'Tags chauds',
] as const);

/** Seuils de confiance (alignés conversion-engine.ts:MIN_SAMPLE_FOR_CALIBRATION). */
export const CONFIDENCE_THRESHOLDS = Object.freeze({
  LOW_MAX: 49,
  MEDIUM_MAX: 499,
} as const);

/** Result type uniforme. */
export interface ConversionHelpersValidation {
  ok: boolean;
  error?: string;
  code?: ConversionHelpersErrorCode;
  field?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// clampScore — borne 0..100.
// ────────────────────────────────────────────────────────────────────────────

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 100) return 100;
  // Arrondi entier pour cohérence avec conversion-engine (probabilités entières).
  return Math.round(score);
}

// ────────────────────────────────────────────────────────────────────────────
// computeWeightedScore — facteurs pondérés → score clampé.
// ────────────────────────────────────────────────────────────────────────────

export interface ScoreFactor {
  label: string;
  impact: number;
  weight?: number;
}

/**
 * Combine un tableau de facteurs en un score pondéré [0..100].
 * Formule : Σ(impact * weight). Weight absent ⇒ 1 (somme directe d'impacts).
 * Clampé final [0..100].
 */
export function computeWeightedScore(factors: ScoreFactor[]): number {
  if (!Array.isArray(factors) || factors.length === 0) return 0;
  let sum = 0;
  for (const f of factors) {
    if (!f || typeof f !== 'object') continue;
    const impact = Number(f.impact);
    const weight = f.weight === undefined || f.weight === null ? 1 : Number(f.weight);
    if (!Number.isFinite(impact) || !Number.isFinite(weight)) continue;
    sum += impact * weight;
  }
  return clampScore(sum);
}

// ────────────────────────────────────────────────────────────────────────────
// confidenceFromSampleSize — seuils alignés conversion-engine.
// ────────────────────────────────────────────────────────────────────────────

export type Confidence = 'low' | 'medium' | 'high';

/**
 * Seuils : <50 = low, 50..500 = medium, >500 = high.
 * Aligné avec conversion-engine.ts:MIN_SAMPLE_FOR_CALIBRATION (=10) mais
 * stratifie plus finement pour l'UI dashboard.
 */
export function confidenceFromSampleSize(n: number): Confidence {
  if (!Number.isFinite(n) || n < 0) return 'low';
  if (n > CONFIDENCE_THRESHOLDS.MEDIUM_MAX) return 'high';
  if (n > CONFIDENCE_THRESHOLDS.LOW_MAX) return 'medium';
  return 'low';
}

// ────────────────────────────────────────────────────────────────────────────
// estimateSampleFromFactors — parse "(n=X)" depuis labels.
// ────────────────────────────────────────────────────────────────────────────

const SAMPLE_PATTERN = /\(n=(\d+)\)/;

/**
 * Cherche le 1er facteur dont le label contient "(n=X)" et retourne X.
 * Aligné avec conversion-engine.ts:estimateSampleFromFactors (logique
 * extraite, identique).
 */
export function estimateSampleFromFactors(
  factors: ScoreFactor[] | null | undefined,
): number {
  if (!Array.isArray(factors)) return 0;
  for (const f of factors) {
    if (!f || typeof f.label !== 'string') continue;
    const m = SAMPLE_PATTERN.exec(f.label);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return 0;
}

// ────────────────────────────────────────────────────────────────────────────
// validateBaselineInput — valide une ligne conversion_baselines.
// ────────────────────────────────────────────────────────────────────────────

export interface BaselineInput {
  dimension?: unknown;
  dimension_value?: unknown;
  conversion_rate?: unknown;
  sample_size?: unknown;
  won_count?: unknown;
  lost_count?: unknown;
}

export function validateBaselineInput(
  input: BaselineInput,
): ConversionHelpersValidation {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Baseline requise',
      code: CONVERSION_HELPERS_ERROR_CODES.DIMENSION_INVALID,
    };
  }
  const dimension = typeof input.dimension === 'string' ? input.dimension : '';
  if (!VALID_DIMENSIONS.includes(dimension as BaselineDimension)) {
    return {
      ok: false,
      error: `Dimension invalide (valeurs : ${VALID_DIMENSIONS.join('|')})`,
      code: CONVERSION_HELPERS_ERROR_CODES.DIMENSION_INVALID,
      field: 'dimension',
    };
  }
  const sampleSize = Number(input.sample_size);
  if (!Number.isFinite(sampleSize) || sampleSize < 0) {
    return {
      ok: false,
      error: 'sample_size invalide (entier >= 0)',
      code: CONVERSION_HELPERS_ERROR_CODES.SAMPLE_SIZE_INVALID,
      field: 'sample_size',
    };
  }
  const conversionRate = Number(input.conversion_rate);
  if (
    !Number.isFinite(conversionRate) ||
    conversionRate < 0 ||
    conversionRate > 1
  ) {
    return {
      ok: false,
      error: 'conversion_rate doit être ∈ [0..1]',
      code: CONVERSION_HELPERS_ERROR_CODES.CONVERSION_RATE_INVALID,
      field: 'conversion_rate',
    };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// validateFactors — vérifie un tableau de facteurs (labels whitelist permissive).
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validation permissive : labels custom OK (ex: "Taux historique de tes leads
 * referral : 32% (n=120)" est un label DYNAMIQUE généré par conversion-engine).
 * On vérifie juste que c'est un tableau et que chaque entrée a label string +
 * impact number.
 */
export function validateFactors(
  factors: unknown,
): ConversionHelpersValidation {
  if (!Array.isArray(factors)) {
    return {
      ok: false,
      error: 'Facteurs doivent être un tableau',
      code: CONVERSION_HELPERS_ERROR_CODES.FACTORS_NOT_ARRAY,
      field: 'factors',
    };
  }
  for (let i = 0; i < factors.length; i++) {
    const f = factors[i];
    if (!f || typeof f !== 'object') {
      return {
        ok: false,
        error: `Facteur #${i + 1} invalide`,
        code: CONVERSION_HELPERS_ERROR_CODES.FACTOR_LABEL_INVALID,
        field: `factors[${i}]`,
      };
    }
    const lbl = (f as { label?: unknown }).label;
    const imp = (f as { impact?: unknown }).impact;
    if (typeof lbl !== 'string' || !lbl.trim()) {
      return {
        ok: false,
        error: `Facteur #${i + 1} : label requis`,
        code: CONVERSION_HELPERS_ERROR_CODES.FACTOR_LABEL_INVALID,
        field: `factors[${i}].label`,
      };
    }
    if (!Number.isFinite(Number(imp))) {
      return {
        ok: false,
        error: `Facteur #${i + 1} : impact invalide`,
        code: CONVERSION_HELPERS_ERROR_CODES.FACTOR_LABEL_INVALID,
        field: `factors[${i}].impact`,
      };
    }
  }
  return { ok: true };
}
