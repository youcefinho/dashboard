// ── ecommerce-rfm-engine.ts ────────────────────────────────────────────────
// Helpers PURS pour `ecommerce-rfm.ts` (P2-3) :
//   - RFM_ERROR_CODES (frozen)
//   - RFM_SEGMENT_LABELS (frozen) — taxonomie RFM industrie (Kotler/CRM)
//   - computeQuintileScore(value, sortedValues) → 1|2|3|4|5
//   - computeRfmScore({r,f,m}, sortedR, sortedF, sortedM) → {r,f,m,combined}
//   - assignSegment({r,f,m}) → SegmentLabel (matrice 5×5 simplifiée)
//   - validateRfmInput(input) → Result
//
// ⚠️ Indépendant de ecommerce-rfm.ts (qui utilise SCORES 1..3 paramétrables).
//   Ce moteur fournit la VARIANTE QUINTILE 1..5 industrie (segments riches),
//   pour usage analytics dashboards/cohorts. Les 2 modèles coexistent :
//   - ecommerce-rfm.ts : score 1..3 simple, derive 9 segments (production).
//   - ce moteur       : score 1..5 quintile, derive 12 segments (analytics).
//
// Conventions strictes :
//   - PURS : aucune dépendance DB / Env.
//   - Garde défensive : entrées invalides ⇒ score 1 (le plus faible, pas crash).
//   - Additif strict — NE modifie PAS ecommerce-rfm.ts.

/** Codes d'erreur normalisés (frozen). */
export const RFM_ERROR_CODES = Object.freeze({
  RECENCY_INVALID: 'RECENCY_INVALID',
  FREQUENCY_INVALID: 'FREQUENCY_INVALID',
  MONETARY_INVALID: 'MONETARY_INVALID',
  SORTED_VALUES_EMPTY: 'SORTED_VALUES_EMPTY',
  INPUT_INVALID: 'INPUT_INVALID',
} as const);

export type RfmErrorCode = (typeof RFM_ERROR_CODES)[keyof typeof RFM_ERROR_CODES];

/** Segments RFM quintile (frozen) — taxonomie industrie standard. */
export const RFM_SEGMENT_LABELS = Object.freeze([
  'champions',
  'loyal',
  'potential_loyalist',
  'new',
  'promising',
  'need_attention',
  'about_to_sleep',
  'at_risk',
  'cannot_lose',
  'hibernating',
  'lost',
  'unknown',
] as const);

export type RfmSegmentLabel = (typeof RFM_SEGMENT_LABELS)[number];

/** Score quintile : 1 (faible) à 5 (élevé). */
export type QuintileScore = 1 | 2 | 3 | 4 | 5;

export interface RfmScoreInput {
  recency: number; // jours depuis dernière commande (plus bas = meilleur)
  frequency: number; // nombre de commandes (plus haut = meilleur)
  monetary: number; // total dépensé en cents (plus haut = meilleur)
}

export interface RfmScore {
  r: QuintileScore;
  f: QuintileScore;
  m: QuintileScore;
  combined: number; // r*100 + f*10 + m (déterministe pour debug/audit)
}

// ────────────────────────────────────────────────────────────────────────────
// computeQuintileScore — projette une valeur sur 5 quintiles.
//
// Quintile 1 = bottom 20%, Quintile 5 = top 20%. sortedValues DOIT être trié
// ASC (du plus petit au plus grand). Retourne 1..5.
//
// Garde défensive : sortedValues vide/non-array ⇒ 1 ; value non finie ⇒ 1.
// ────────────────────────────────────────────────────────────────────────────

export function computeQuintileScore(
  value: number,
  sortedValues: number[],
): QuintileScore {
  if (!Number.isFinite(value)) return 1;
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 1;
  const n = sortedValues.length;
  // Position binary-search-like (linéaire suffit, quintiles ⇒ datasets bornés).
  let rank = 0;
  for (const v of sortedValues) {
    if (Number.isFinite(v) && v <= value) rank += 1;
  }
  // Percentile dans [0..1], puis quintile dans [1..5].
  const pct = rank / n;
  if (pct <= 0.2) return 1;
  if (pct <= 0.4) return 2;
  if (pct <= 0.6) return 3;
  if (pct <= 0.8) return 4;
  return 5;
}

// ────────────────────────────────────────────────────────────────────────────
// computeRfmScore — calcule (R,F,M) sur quintiles.
//
// RECENCY : INVERSE (plus c'est récent = bas en jours = quintile 5). Donc on
// passe -recency au lieu de recency pour que le quintile s'aligne.
// FREQUENCY/MONETARY : direct.
// ────────────────────────────────────────────────────────────────────────────

export function computeRfmScore(
  input: RfmScoreInput,
  sortedRecencies: number[],
  sortedFreqs: number[],
  sortedMonetaries: number[],
): RfmScore {
  const recency = Number.isFinite(input?.recency) ? input.recency : Number.POSITIVE_INFINITY;
  const frequency = Number.isFinite(input?.frequency) ? input.frequency : 0;
  const monetary = Number.isFinite(input?.monetary) ? input.monetary : 0;

  // RECENCY inversée : on évalue -recency vs liste des -recency (ASC).
  const sortedNegRec = (sortedRecencies || [])
    .filter((v) => Number.isFinite(v))
    .map((v) => -v)
    .sort((a, b) => a - b);
  const r = computeQuintileScore(-recency, sortedNegRec);
  const f = computeQuintileScore(frequency, sortedFreqs);
  const m = computeQuintileScore(monetary, sortedMonetaries);

  return {
    r,
    f,
    m,
    combined: r * 100 + f * 10 + m,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// assignSegment — matrice 5×5 simplifiée (RFM industrie standard).
//
// Mapping basé sur la matrice Kotler/CRM commune (R sur 5 niveaux, F+M moyens).
// Garde défensive : scores hors [1..5] ⇒ 'unknown'.
// ────────────────────────────────────────────────────────────────────────────

export function assignSegment(rfmScore: { r: number; f: number; m: number }): RfmSegmentLabel {
  if (
    !rfmScore ||
    !Number.isFinite(rfmScore.r) ||
    !Number.isFinite(rfmScore.f) ||
    !Number.isFinite(rfmScore.m)
  ) {
    return 'unknown';
  }
  const r = Math.max(1, Math.min(5, Math.round(rfmScore.r)));
  const f = Math.max(1, Math.min(5, Math.round(rfmScore.f)));
  const m = Math.max(1, Math.min(5, Math.round(rfmScore.m)));

  const fm = Math.round((f + m) / 2); // moyenne F+M arrondie

  // R=5 : très récent
  if (r === 5) {
    if (fm >= 4) return 'champions';
    if (fm >= 3) return 'loyal';
    if (fm <= 1) return 'new';
    return 'potential_loyalist';
  }
  // R=4
  if (r === 4) {
    if (fm >= 4) return 'loyal';
    if (fm >= 2) return 'potential_loyalist';
    return 'promising';
  }
  // R=3 : intermédiaire
  if (r === 3) {
    if (fm >= 4) return 'need_attention';
    if (fm >= 2) return 'about_to_sleep';
    return 'promising';
  }
  // R=2 : ancien
  if (r === 2) {
    if (fm >= 4) return 'cannot_lose';
    if (fm >= 2) return 'at_risk';
    return 'hibernating';
  }
  // R=1 : très ancien
  if (fm >= 4) return 'cannot_lose';
  if (fm >= 2) return 'hibernating';
  return 'lost';
}

// ────────────────────────────────────────────────────────────────────────────
// validateRfmInput — valide les 3 dimensions R/F/M.
// ────────────────────────────────────────────────────────────────────────────

export interface RfmValidation {
  ok: boolean;
  error?: string;
  code?: RfmErrorCode;
  field?: string;
}

export function validateRfmInput(input: unknown): RfmValidation {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Input RFM requis (objet {recency, frequency, monetary})',
      code: RFM_ERROR_CODES.INPUT_INVALID,
    };
  }
  const inp = input as Record<string, unknown>;
  if (typeof inp.recency !== 'number' || !Number.isFinite(inp.recency) || inp.recency < 0) {
    return {
      ok: false,
      error: 'recency invalide (jours ≥ 0 requis)',
      code: RFM_ERROR_CODES.RECENCY_INVALID,
      field: 'recency',
    };
  }
  if (
    typeof inp.frequency !== 'number' ||
    !Number.isFinite(inp.frequency) ||
    inp.frequency < 0
  ) {
    return {
      ok: false,
      error: 'frequency invalide (nb commandes ≥ 0 requis)',
      code: RFM_ERROR_CODES.FREQUENCY_INVALID,
      field: 'frequency',
    };
  }
  if (typeof inp.monetary !== 'number' || !Number.isFinite(inp.monetary) || inp.monetary < 0) {
    return {
      ok: false,
      error: 'monetary invalide (cents ≥ 0 requis)',
      code: RFM_ERROR_CODES.MONETARY_INVALID,
      field: 'monetary',
    };
  }
  return { ok: true };
}
