// ── admin-analytics-engine.ts ───────────────────────────────────────────────
// Helpers PURS pour `admin-analytics.ts` (P4) :
//   - VALID_METRICS whitelist (mrr|arr|churn|active_clients|signups|trial_conversions)
//   - VALID_PERIODS whitelist (day|week|month|quarter|year)
//   - validateMetricRequest ({metric, period, from, to})
//   - aggregateByPeriod (rows[] → {periods: [{label, count}]})
//   - formatChurnRate (churned, total → % 2 décimales)
//
// Bornage tenant : admin-analytics est ADMIN-ONLY (calque admin-analytics.ts:18
// ADMIN_ROLES). Ces helpers sont PURS — la garde admin reste dans le handler.
//
// Best-effort STRICT : retours Result `{ ok; error? }`.

/** Codes d'erreur normalisés. */
export const ADMIN_ANALYTICS_ERROR_CODES = Object.freeze({
  METRIC_INVALID: 'METRIC_INVALID',
  PERIOD_INVALID: 'PERIOD_INVALID',
  DATE_RANGE_INVALID: 'DATE_RANGE_INVALID',
  DATE_RANGE_INVERTED: 'DATE_RANGE_INVERTED',
  PERIOD_KEY_INVALID: 'PERIOD_KEY_INVALID',
  ROWS_NOT_ARRAY: 'ROWS_NOT_ARRAY',
} as const);

export type AdminAnalyticsErrorCode =
  (typeof ADMIN_ANALYTICS_ERROR_CODES)[keyof typeof ADMIN_ANALYTICS_ERROR_CODES];

/** Métriques whitelistées (frozen). */
export const VALID_METRICS = Object.freeze([
  'mrr',
  'arr',
  'churn',
  'active_clients',
  'signups',
  'trial_conversions',
] as const);

/** Périodes d'agrégation whitelistées. */
export const VALID_PERIODS = Object.freeze([
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const);

/** Clés temporelles whitelistées pour aggregateByPeriod. */
export const VALID_PERIOD_KEYS = Object.freeze([
  'created_at',
  'updated_at',
] as const);

export type AdminMetric = (typeof VALID_METRICS)[number];
export type AdminPeriod = (typeof VALID_PERIODS)[number];

/** Result type uniforme. */
export interface AdminAnalyticsValidation {
  ok: boolean;
  error?: string;
  code?: AdminAnalyticsErrorCode;
  field?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// validateMetricRequest — valide { metric, period, from, to }.
// ────────────────────────────────────────────────────────────────────────────

export interface MetricRequest {
  metric?: unknown;
  period?: unknown;
  from?: unknown;
  to?: unknown;
}

export function validateMetricRequest(req: MetricRequest): AdminAnalyticsValidation {
  if (!req || typeof req !== 'object') {
    return {
      ok: false,
      error: 'Requête métrique requise',
      code: ADMIN_ANALYTICS_ERROR_CODES.METRIC_INVALID,
    };
  }
  if (typeof req.metric !== 'string' || !VALID_METRICS.includes(req.metric as AdminMetric)) {
    return {
      ok: false,
      error: `Métrique invalide (attendu: ${VALID_METRICS.join('|')})`,
      code: ADMIN_ANALYTICS_ERROR_CODES.METRIC_INVALID,
      field: 'metric',
    };
  }
  if (typeof req.period !== 'string' || !VALID_PERIODS.includes(req.period as AdminPeriod)) {
    return {
      ok: false,
      error: `Période invalide (attendu: ${VALID_PERIODS.join('|')})`,
      code: ADMIN_ANALYTICS_ERROR_CODES.PERIOD_INVALID,
      field: 'period',
    };
  }
  // from/to optionnels — si fournis, doivent être parseables.
  if (req.from != null || req.to != null) {
    const fromMs = parseAnyDateMs(req.from);
    const toMs = parseAnyDateMs(req.to);
    if ((req.from != null && fromMs == null) || (req.to != null && toMs == null)) {
      return {
        ok: false,
        error: 'from/to invalides (ISO string, Date ou epoch ms attendus)',
        code: ADMIN_ANALYTICS_ERROR_CODES.DATE_RANGE_INVALID,
      };
    }
    if (fromMs != null && toMs != null && fromMs > toMs) {
      return {
        ok: false,
        error: 'from > to (inversion)',
        code: ADMIN_ANALYTICS_ERROR_CODES.DATE_RANGE_INVERTED,
      };
    }
  }
  return { ok: true };
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
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// aggregateByPeriod — group rows[] by period using a timestamp column.
// Retourne { periods: [{label, count}] } trié par label ASC.
//
// Convention label :
//   day     → 'YYYY-MM-DD'
//   week    → 'YYYY-Www' (ISO week, %V)
//   month   → 'YYYY-MM'
//   quarter → 'YYYY-Q1'..'YYYY-Q4'
//   year    → 'YYYY'
// ────────────────────────────────────────────────────────────────────────────

export interface AggregatedPeriod {
  label: string;
  count: number;
}

export interface AggregateByPeriodOutput {
  ok: boolean;
  periods?: AggregatedPeriod[];
  error?: string;
  code?: AdminAnalyticsErrorCode;
}

export function aggregateByPeriod(
  rows: Array<Record<string, unknown>>,
  periodKey: 'created_at' | 'updated_at',
  period: AdminPeriod | string,
): AggregateByPeriodOutput {
  if (!Array.isArray(rows)) {
    return {
      ok: false,
      error: 'rows doit être un tableau',
      code: ADMIN_ANALYTICS_ERROR_CODES.ROWS_NOT_ARRAY,
    };
  }
  if (!VALID_PERIOD_KEYS.includes(periodKey as never)) {
    return {
      ok: false,
      error: `periodKey invalide (attendu: ${VALID_PERIOD_KEYS.join('|')})`,
      code: ADMIN_ANALYTICS_ERROR_CODES.PERIOD_KEY_INVALID,
    };
  }
  if (!VALID_PERIODS.includes(period as AdminPeriod)) {
    return {
      ok: false,
      error: `period invalide (attendu: ${VALID_PERIODS.join('|')})`,
      code: ADMIN_ANALYTICS_ERROR_CODES.PERIOD_INVALID,
    };
  }

  const buckets = new Map<string, number>();
  for (const row of rows) {
    const raw = row?.[periodKey];
    const ms = parseAnyDateMs(raw);
    if (ms == null) continue;
    const label = labelForPeriod(new Date(ms), period as AdminPeriod);
    buckets.set(label, (buckets.get(label) ?? 0) + 1);
  }

  const periods: AggregatedPeriod[] = Array.from(buckets.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { ok: true, periods };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function labelForPeriod(d: Date, period: AdminPeriod): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  if (period === 'day') return `${y}-${pad2(m)}-${pad2(dd)}`;
  if (period === 'month') return `${y}-${pad2(m)}`;
  if (period === 'year') return `${y}`;
  if (period === 'quarter') {
    const q = Math.floor((m - 1) / 3) + 1;
    return `${y}-Q${q}`;
  }
  // week — ISO week (Monday-first). Calcul:
  //  - jeudi de la semaine = d + (4 - day_of_week_iso).
  //  - week = round((thursday - jan1_thursday) / 7) + 1
  const dt = new Date(Date.UTC(y, d.getUTCMonth(), dd));
  const dayNum = (dt.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const weekNum =
    1 +
    Math.round(
      ((dt.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${dt.getUTCFullYear()}-W${pad2(weekNum)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// formatChurnRate — % avec 2 décimales (honnête : 0 si total ≤ 0, null si invalide).
// ────────────────────────────────────────────────────────────────────────────

export function formatChurnRate(churned: unknown, total: unknown): number {
  const c = Number(churned);
  const t = Number(total);
  if (!Number.isFinite(c) || !Number.isFinite(t)) return 0;
  if (t <= 0) return 0;
  if (c < 0) return 0;
  // Cap supérieur à 100% (data corrompue ⇒ on log mais retourne 100 plutôt que 200).
  const rate = (c / t) * 100;
  if (rate > 100) return 100;
  return Math.round(rate * 100) / 100;
}

// ────────────────────────────────────────────────────────────────────────────
// formatGrowthRate — variation % entre 2 valeurs (current vs previous).
// Convention : (current - previous) / previous * 100. Si previous ≤ 0 :
//   - current > 0 → 100 (croissance « infinie » bornée pour UI).
//   - current = 0 → 0.
// ────────────────────────────────────────────────────────────────────────────

export function formatGrowthRate(current: unknown, previous: unknown): number {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return 0;
  if (p <= 0) {
    return c > 0 ? 100 : 0;
  }
  const rate = ((c - p) / p) * 100;
  return Math.round(rate * 100) / 100;
}
