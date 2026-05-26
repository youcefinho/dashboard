// ── ecommerce-analytics-engine.ts ──────────────────────────────────────────
// Helpers PURS pour `ecommerce-analytics.ts` (P2-3) :
//   - ANALYTICS_ERROR_CODES (frozen)
//   - VALID_PERIODS (day|week|month|quarter|year|custom frozen)
//   - computeAov(totalRevenue, orderCount) → number (cents)
//   - computeConversionRate(orders, visitors) → number (% 2 décimales)
//   - computeLtv(customerOrders, marginPct) → number (cents)
//   - computeGrowthRate(current, previous) → number (% growth)
//   - validateAnalyticsQuery({ period, from, to, dimension? }) → Result
//
// Conventions strictes :
//   - PURS : aucune dépendance DB / Env. Composables.
//   - Money en cents (INTEGER). Pourcentages en % avec 2 décimales.
//   - Garde défensive : entrées invalides ⇒ 0 (jamais NaN/Infinity).
//   - Bornage défensif : MAX_WINDOW_DAYS aligné sur ecommerce-analytics.ts:36.
//   - Multi-tenant : N/A ici (helpers PURS — la garde tenant reste dans le
//     handler). Additif strict — NE modifie PAS ecommerce-analytics.ts.

/** Codes d'erreur normalisés (frozen). */
export const ANALYTICS_ERROR_CODES = Object.freeze({
  PERIOD_INVALID: 'PERIOD_INVALID',
  DATE_RANGE_INVALID: 'DATE_RANGE_INVALID',
  DATE_RANGE_INVERTED: 'DATE_RANGE_INVERTED',
  WINDOW_TOO_LARGE: 'WINDOW_TOO_LARGE',
  DIMENSION_INVALID: 'DIMENSION_INVALID',
  QUERY_INVALID: 'QUERY_INVALID',
} as const);

export type AnalyticsErrorCode =
  (typeof ANALYTICS_ERROR_CODES)[keyof typeof ANALYTICS_ERROR_CODES];

/** Périodes whitelistées (frozen) — alignées doc handler analytics. */
export const VALID_PERIODS = Object.freeze([
  'day',
  'week',
  'month',
  'quarter',
  'year',
  'custom',
] as const);

/** Dimensions d'analyse whitelistées (frozen). */
export const VALID_DIMENSIONS = Object.freeze([
  'channel',
  'currency',
  'product',
  'customer',
  'segment',
] as const);

export type AnalyticsPeriod = (typeof VALID_PERIODS)[number];
export type AnalyticsDimension = (typeof VALID_DIMENSIONS)[number];

// Bornes défensives (alignées ecommerce-analytics.ts:36-39 — recopié local).
export const MAX_WINDOW_DAYS = 730; // plafond fenêtre ~2 ans
export const DEFAULT_WINDOW_DAYS = 90;

// ────────────────────────────────────────────────────────────────────────────
// computeAov — Average Order Value en cents (NET).
//
// AOV = net / orderCount. Garde défensive : orderCount ≤ 0 ⇒ 0 ; valeurs
// non finies ⇒ 0 ; valeurs négatives ⇒ 0 (jamais d'AOV négatif).
// ────────────────────────────────────────────────────────────────────────────

export function computeAov(totalRevenue: number, orderCount: number): number {
  if (!Number.isFinite(totalRevenue) || !Number.isFinite(orderCount)) return 0;
  if (orderCount <= 0) return 0;
  const revenue = Math.max(0, totalRevenue);
  return Math.round(revenue / orderCount);
}

// ────────────────────────────────────────────────────────────────────────────
// computeConversionRate — pourcentage avec 2 décimales.
//
// rate = (orders / visitors) × 100. Garde défensive : visitors ≤ 0 ⇒ 0.
// Cap à 100 (sur-conversion = donnée invalide, on plafonne).
// ────────────────────────────────────────────────────────────────────────────

export function computeConversionRate(orders: number, visitors: number): number {
  if (!Number.isFinite(orders) || !Number.isFinite(visitors)) return 0;
  if (visitors <= 0) return 0;
  const o = Math.max(0, orders);
  const rate = (o / visitors) * 100;
  if (!Number.isFinite(rate)) return 0;
  // Arrondi 2 décimales, cap 100.
  return Math.min(100, Math.round(rate * 100) / 100);
}

// ────────────────────────────────────────────────────────────────────────────
// computeLtv — Lifetime Value pondéré par marge.
//
// LTV = sum(customerOrders) × (marginPct / 100). marginPct défaut 100 (brut).
// Garde défensive : customerOrders[] non array ⇒ 0 ; marginPct hors [0..100]
// ⇒ clamp ; valeurs négatives filtrées (pas de "revenu négatif").
// ────────────────────────────────────────────────────────────────────────────

export function computeLtv(customerOrders: number[], marginPct: number = 100): number {
  if (!Array.isArray(customerOrders) || customerOrders.length === 0) return 0;
  if (!Number.isFinite(marginPct)) return 0;
  const margin = Math.max(0, Math.min(100, marginPct));
  let sum = 0;
  for (const v of customerOrders) {
    if (!Number.isFinite(v)) continue;
    if (v <= 0) continue;
    sum += v;
  }
  return Math.round(sum * (margin / 100));
}

// ────────────────────────────────────────────────────────────────────────────
// computeGrowthRate — pourcentage de croissance période-sur-période.
//
// growth = ((current - previous) / previous) × 100. Cas spéciaux :
//   - previous ≤ 0 et current > 0 ⇒ 100 (nouvelle activité, croissance "x∞"
//     normalisée à 100% pour rester comparable).
//   - previous ≤ 0 et current ≤ 0 ⇒ 0.
//   - current < 0 toléré (décroissance possible négative).
// Arrondi 2 décimales. Cap symétrique ±10000 (garde défensive overflow).
// ────────────────────────────────────────────────────────────────────────────

export function computeGrowthRate(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous <= 0) {
    if (current <= 0) return 0;
    return 100;
  }
  const growth = ((current - previous) / previous) * 100;
  if (!Number.isFinite(growth)) return 0;
  const rounded = Math.round(growth * 100) / 100;
  // Cap symétrique défensif (anti-overflow réseau de petites previous).
  return Math.max(-10000, Math.min(10000, rounded));
}

// ────────────────────────────────────────────────────────────────────────────
// validateAnalyticsQuery — valide { period, from, to, dimension? }.
// ────────────────────────────────────────────────────────────────────────────

export interface AnalyticsQuery {
  period?: unknown;
  from?: unknown;
  to?: unknown;
  dimension?: unknown;
}

export interface AnalyticsValidation {
  ok: boolean;
  error?: string;
  code?: AnalyticsErrorCode;
  field?: string;
  windowDays?: number;
}

function parseAnyDateMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === 'string') {
    if (!v.trim()) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function validateAnalyticsQuery(req: AnalyticsQuery): AnalyticsValidation {
  if (!req || typeof req !== 'object') {
    return {
      ok: false,
      error: 'Requête analytics requise',
      code: ANALYTICS_ERROR_CODES.QUERY_INVALID,
    };
  }
  if (
    typeof req.period !== 'string' ||
    !VALID_PERIODS.includes(req.period as AnalyticsPeriod)
  ) {
    return {
      ok: false,
      error: `Période invalide (attendu: ${VALID_PERIODS.join('|')})`,
      code: ANALYTICS_ERROR_CODES.PERIOD_INVALID,
      field: 'period',
    };
  }
  // dimension optionnelle — whitelistée si fournie.
  if (req.dimension != null) {
    if (
      typeof req.dimension !== 'string' ||
      !VALID_DIMENSIONS.includes(req.dimension as AnalyticsDimension)
    ) {
      return {
        ok: false,
        error: `Dimension invalide (attendu: ${VALID_DIMENSIONS.join('|')})`,
        code: ANALYTICS_ERROR_CODES.DIMENSION_INVALID,
        field: 'dimension',
      };
    }
  }
  // from/to obligatoires si period === 'custom'.
  if (req.period === 'custom' && (req.from == null || req.to == null)) {
    return {
      ok: false,
      error: 'from et to requis pour period=custom',
      code: ANALYTICS_ERROR_CODES.DATE_RANGE_INVALID,
      field: 'from',
    };
  }
  if (req.from != null || req.to != null) {
    const fromMs = parseAnyDateMs(req.from);
    const toMs = parseAnyDateMs(req.to);
    if ((req.from != null && fromMs == null) || (req.to != null && toMs == null)) {
      return {
        ok: false,
        error: 'from/to invalides (ISO string, Date ou epoch ms attendus)',
        code: ANALYTICS_ERROR_CODES.DATE_RANGE_INVALID,
      };
    }
    if (fromMs != null && toMs != null) {
      if (fromMs > toMs) {
        return {
          ok: false,
          error: 'from > to (inversion)',
          code: ANALYTICS_ERROR_CODES.DATE_RANGE_INVERTED,
        };
      }
      const windowDays = Math.round((toMs - fromMs) / 86400000);
      if (windowDays > MAX_WINDOW_DAYS) {
        return {
          ok: false,
          error: `Fenêtre trop large (max ${MAX_WINDOW_DAYS} jours)`,
          code: ANALYTICS_ERROR_CODES.WINDOW_TOO_LARGE,
          windowDays,
        };
      }
      return { ok: true, windowDays };
    }
  }
  return { ok: true };
}
