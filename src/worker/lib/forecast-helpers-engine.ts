// ── forecast-helpers-engine.ts ──────────────────────────────────────────────
// Helpers PURS extraits de `forecast-engine.ts` (Sprint 14, renforcement
// 2026-05-26) :
//   - VALID_SCENARIOS (best|likely|worst) frozen
//   - VALID_GROUP_BY (rep|source|stage|month) frozen
//   - applyScenario (weighted × multiplier borné)
//   - bucketDealByStage (proba → horizon courant|prochain|plus loin)
//   - computeMonthFromDate ('YYYY-MM' depuis ISO)
//   - validateForecastQuery ({period?, group_by?, scenario?, pipeline_id?})
//   - SCENARIO_MULTIPLIERS frozen
//
// Bornage tenant : assuré par le handler forecast-engine.ts. Ces helpers
// sont PURS — pas de DB, pas d'I/O, déterministes, offline-safe.

/** Codes d'erreur normalisés. */
export const FORECAST_HELPERS_ERROR_CODES = Object.freeze({
  SCENARIO_INVALID: 'SCENARIO_INVALID',
  GROUP_BY_INVALID: 'GROUP_BY_INVALID',
  PERIOD_INVALID: 'PERIOD_INVALID',
  PIPELINE_ID_INVALID: 'PIPELINE_ID_INVALID',
  STAGE_INVALID: 'STAGE_INVALID',
  HORIZON_INVALID: 'HORIZON_INVALID',
  DATE_INVALID: 'DATE_INVALID',
} as const);

export type ForecastHelpersErrorCode =
  (typeof FORECAST_HELPERS_ERROR_CODES)[keyof typeof FORECAST_HELPERS_ERROR_CODES];

/** Scénarios valides (frozen). */
export const VALID_SCENARIOS = Object.freeze(['best', 'likely', 'worst'] as const);
export type ForecastScenario = (typeof VALID_SCENARIOS)[number];

/** Group-by valides (frozen). Extension : stage ajouté par renforcement. */
export const VALID_GROUP_BY = Object.freeze(['rep', 'source', 'stage', 'month'] as const);
export type ForecastGroupBy = (typeof VALID_GROUP_BY)[number];

/** Multiplicateurs par défaut (frozen). Alignés forecast-engine.ts:scenarios. */
export const SCENARIO_MULTIPLIERS = Object.freeze({
  best: 1.25,
  likely: 1.0,
  worst: 0.7,
} as const);

/** Pattern 'YYYY-MM'. */
const PERIOD_PATTERN = /^(\d{4})-(\d{2})$/;
/** Pattern UUID (souple, pour pipeline_id). */
const PIPELINE_ID_PATTERN = /^[a-zA-Z0-9_\-]{1,64}$/;

/** Result type uniforme. */
export interface ForecastHelpersValidation {
  ok: boolean;
  error?: string;
  code?: ForecastHelpersErrorCode;
  field?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// applyScenario — applique un multiplicateur borné au total pondéré.
// ────────────────────────────────────────────────────────────────────────────

export interface ScenarioMultipliers {
  best?: number;
  likely?: number;
  worst?: number;
}

/**
 * Applique le multiplicateur du scénario au total pondéré.
 * Multiplicateurs custom acceptés (ex: calibration baseline) mais bornés
 * [0..5] pour éviter les valeurs aberrantes.
 */
export function applyScenario(
  weightedTotal: number,
  scenario: ForecastScenario,
  multipliers: ScenarioMultipliers = SCENARIO_MULTIPLIERS,
): number {
  if (!Number.isFinite(weightedTotal)) return 0;
  if (!VALID_SCENARIOS.includes(scenario)) return 0;
  const m = multipliers[scenario];
  // Si un multiplier custom finite est fourni (même négatif), on le borne [0..5].
  // Sinon (absent / NaN / non-fourni), fallback sur la valeur par défaut figée.
  const mult = Number.isFinite(m as number)
    ? Math.min(5, Math.max(0, m as number))
    : SCENARIO_MULTIPLIERS[scenario];
  // Arrondi monétaire stable 2 décimales (calque round2 de forecast-engine).
  const raw = weightedTotal * mult;
  return Math.round(raw * 100) / 100;
}

// ────────────────────────────────────────────────────────────────────────────
// bucketDealByStage — proba/horizonDays → bucket courant/prochain/plus loin.
// ────────────────────────────────────────────────────────────────────────────

export type DealBucket = 'current' | 'next' | 'later';

/**
 * Bucket déterministe d'un deal selon la phase pipeline (stage probability) ET
 * l'horizon attendu en jours. Aligne le critère métier avec
 * forecast-engine.ts:stageHorizonMonths :
 *   - proba >= 75 ou horizon <= 30  → 'current'
 *   - proba >= 50 ou horizon <= 60  → 'next'
 *   - sinon                          → 'later'
 *
 * Le `stage` est tolérant (string ou number). `horizonDays` peut être <0
 * (close passée non-fermée) ⇒ traité comme 'current' (priorité aux actions).
 */
export function bucketDealByStage(
  stage: string | number,
  horizonDays: number,
): DealBucket {
  // Stage peut être un libellé (qualified/proposal) OU une proba 0..100.
  let prob = 0;
  if (typeof stage === 'number' && Number.isFinite(stage)) {
    prob = Math.max(0, Math.min(100, stage));
  } else if (typeof stage === 'string') {
    // Mappage simple si libellé connu. Sinon 0 → 'later' par défaut.
    const m: Record<string, number> = {
      new: 10,
      contacted: 25,
      qualified: 60,
      proposal: 70,
      negotiation: 80,
      won: 100,
      closed: 100,
      lost: 0,
    };
    prob = m[stage.toLowerCase()] ?? 0;
  }
  const h = Number.isFinite(horizonDays) ? horizonDays : 999;
  if (prob >= 75 || h <= 30) return 'current';
  if (prob >= 50 || h <= 60) return 'next';
  return 'later';
}

// ────────────────────────────────────────────────────────────────────────────
// computeMonthFromDate — ISO → 'YYYY-MM'.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extrait 'YYYY-MM' d'une chaîne ISO/SQLite (tolère espace au lieu de T).
 * Retourne '' si invalide (jamais throw).
 */
export function computeMonthFromDate(iso: string | null | undefined): string {
  if (!iso || typeof iso !== 'string') return '';
  const trimmed = iso.trim();
  if (!trimmed) return '';
  // Forme courte 'YYYY-MM' déjà valide.
  if (PERIOD_PATTERN.test(trimmed)) return trimmed;
  // 'YYYY-MM-DD ...' ou 'YYYY-MM-DDTHH:MM:SS' → on prend les 7 premiers.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.substring(0, 7);
  }
  // Fallback : Date.parse + reconstruction.
  const norm = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T') + 'Z';
  const t = Date.parse(norm);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// ────────────────────────────────────────────────────────────────────────────
// validateForecastQuery — valide {period, group_by, scenario, pipeline_id}.
// ────────────────────────────────────────────────────────────────────────────

export interface ForecastQuery {
  period?: string | null;
  group_by?: string | null;
  scenario?: string | null;
  pipeline_id?: string | null;
}

export function validateForecastQuery(
  query: ForecastQuery,
): ForecastHelpersValidation {
  if (!query || typeof query !== 'object') return { ok: true };
  // period optionnel : si présent, doit matcher 'YYYY-MM'.
  if (query.period !== undefined && query.period !== null && query.period !== '') {
    if (typeof query.period !== 'string' || !PERIOD_PATTERN.test(query.period)) {
      return {
        ok: false,
        error: 'period invalide (format YYYY-MM requis)',
        code: FORECAST_HELPERS_ERROR_CODES.PERIOD_INVALID,
        field: 'period',
      };
    }
    // Vérif sémantique mois 01..12.
    const m = PERIOD_PATTERN.exec(query.period);
    if (m) {
      const mm = Number(m[2]);
      if (mm < 1 || mm > 12) {
        return {
          ok: false,
          error: 'period invalide (mois 01..12)',
          code: FORECAST_HELPERS_ERROR_CODES.PERIOD_INVALID,
          field: 'period',
        };
      }
    }
  }
  // group_by optionnel : whitelist.
  if (
    query.group_by !== undefined &&
    query.group_by !== null &&
    query.group_by !== ''
  ) {
    if (!VALID_GROUP_BY.includes(query.group_by as ForecastGroupBy)) {
      return {
        ok: false,
        error: `group_by invalide (valeurs : ${VALID_GROUP_BY.join('|')})`,
        code: FORECAST_HELPERS_ERROR_CODES.GROUP_BY_INVALID,
        field: 'group_by',
      };
    }
  }
  // scenario optionnel : whitelist.
  if (
    query.scenario !== undefined &&
    query.scenario !== null &&
    query.scenario !== ''
  ) {
    if (!VALID_SCENARIOS.includes(query.scenario as ForecastScenario)) {
      return {
        ok: false,
        error: `scenario invalide (valeurs : ${VALID_SCENARIOS.join('|')})`,
        code: FORECAST_HELPERS_ERROR_CODES.SCENARIO_INVALID,
        field: 'scenario',
      };
    }
  }
  // pipeline_id optionnel : pattern alphanumeric/dash/underscore, ≤64.
  if (
    query.pipeline_id !== undefined &&
    query.pipeline_id !== null &&
    query.pipeline_id !== ''
  ) {
    if (
      typeof query.pipeline_id !== 'string' ||
      !PIPELINE_ID_PATTERN.test(query.pipeline_id)
    ) {
      return {
        ok: false,
        error: 'pipeline_id invalide',
        code: FORECAST_HELPERS_ERROR_CODES.PIPELINE_ID_INVALID,
        field: 'pipeline_id',
      };
    }
  }
  return { ok: true };
}
