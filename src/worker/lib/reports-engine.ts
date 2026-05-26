// ── reports-engine.ts ──────────────────────────────────────────────────────
// Helpers PURS pour `reports.ts` (P2) :
//   - Whitelists aggregations / filter operators / sources / dimensions / metrics
//   - validateQueryFilters (array de {field, operator, value})
//   - validateDateRange (max 730 jours)
//   - validateGroupBy (max 5 fields)
//   - validateAggregation ({field, op})
//   - formatExportCsv (RFC 4180 escape)
//
// Bornage tenant : helpers PURS, le bornage `WHERE client_id = ?` reste dans
// le handler reports.ts:handleRunReportWidget. JAMAIS d'accès D1 ici.
//
// Best-effort STRICT : retours Result `{ ok; error?; field? }`.

/** Codes d'erreur normalisés. */
export const REPORTS_ERROR_CODES = Object.freeze({
  QUERY_INVALID: 'QUERY_INVALID',
  FILTER_INVALID: 'FILTER_INVALID',
  FILTER_OPERATOR_INVALID: 'FILTER_OPERATOR_INVALID',
  FILTER_FIELD_INVALID: 'FILTER_FIELD_INVALID',
  FILTER_VALUE_INVALID: 'FILTER_VALUE_INVALID',
  DATE_RANGE_INVALID: 'DATE_RANGE_INVALID',
  DATE_RANGE_TOO_LARGE: 'DATE_RANGE_TOO_LARGE',
  DATE_RANGE_INVERTED: 'DATE_RANGE_INVERTED',
  GROUP_BY_TOO_MANY: 'GROUP_BY_TOO_MANY',
  GROUP_BY_FIELD_INVALID: 'GROUP_BY_FIELD_INVALID',
  AGGREGATION_INVALID: 'AGGREGATION_INVALID',
  AGGREGATION_FIELD_REQUIRED: 'AGGREGATION_FIELD_REQUIRED',
  EXPORT_TOO_LARGE: 'EXPORT_TOO_LARGE',
} as const);

export type ReportsErrorCode =
  (typeof REPORTS_ERROR_CODES)[keyof typeof REPORTS_ERROR_CODES];

/** Limites figées (calque reports.ts:359 WIDGET_BUCKET_LIMIT). */
export const MAX_GROUP_BY_FIELDS = 5;
export const MAX_DATE_RANGE_DAYS = 730; // 2 ans
export const MAX_FILTERS_PER_QUERY = 20;
export const MAX_EXPORT_ROWS = 100_000;
export const MAX_FIELD_NAME_LENGTH = 64;

/** Agrégations whitelistées (frozen). */
export const VALID_AGGREGATIONS = Object.freeze([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'distinct',
] as const);

/** Opérateurs de filtre whitelistés (frozen). */
export const VALID_FILTER_OPERATORS = Object.freeze([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'starts_with',
] as const);

/** Sources canoniques (mirror reports.ts:254 ALLOWED_SOURCES). */
export const VALID_REPORT_SOURCES = Object.freeze([
  'leads',
  'tasks',
  'conversations',
  'events',
  'invoices',
  'orders',
  'agency',
] as const);

/** Dimensions builder (mirror reports.ts:271 ALLOWED_DIMENSIONS). */
export const VALID_REPORT_DIMENSIONS = Object.freeze([
  'source',
  'status',
  'type',
  'owner',
  'client',
  'date',
  'week',
  'month',
] as const);

/** DateRange presets (mirror reports.ts:343 resolveSince). */
export const VALID_DATE_RANGES = Object.freeze([
  '7d',
  '30d',
  '90d',
  '12m',
  'all',
] as const);

/** Result type uniforme. */
export interface ReportsValidation {
  ok: boolean;
  error?: string;
  code?: ReportsErrorCode;
  field?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// validateFieldName — alphanumérique + underscore, ≤ 64 chars.
// Anti-injection : refuse tout ce qui n'est pas [a-zA-Z0-9_].
// ────────────────────────────────────────────────────────────────────────────

const FIELD_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

export function isValidFieldName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > MAX_FIELD_NAME_LENGTH) return false;
  return FIELD_NAME_RE.test(name);
}

// ────────────────────────────────────────────────────────────────────────────
// validateQueryFilters — tableau de filtres.
// Format : Array<{ field, operator, value }>.
// ────────────────────────────────────────────────────────────────────────────

export interface QueryFilter {
  field: string;
  operator: (typeof VALID_FILTER_OPERATORS)[number];
  value: unknown;
}

export function validateQueryFilters(filters: unknown): ReportsValidation {
  if (filters == null) return { ok: true };
  if (!Array.isArray(filters)) {
    return {
      ok: false,
      error: 'Les filtres doivent être un tableau',
      code: REPORTS_ERROR_CODES.FILTER_INVALID,
    };
  }
  if (filters.length > MAX_FILTERS_PER_QUERY) {
    return {
      ok: false,
      error: `Trop de filtres (${filters.length} > ${MAX_FILTERS_PER_QUERY})`,
      code: REPORTS_ERROR_CODES.FILTER_INVALID,
    };
  }
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i];
    if (!f || typeof f !== 'object') {
      return {
        ok: false,
        error: `Filtre #${i} doit être un objet`,
        code: REPORTS_ERROR_CODES.FILTER_INVALID,
        field: `filters[${i}]`,
      };
    }
    const fr = f as Record<string, unknown>;
    if (!isValidFieldName(fr.field)) {
      return {
        ok: false,
        error: `Filtre #${i}: field invalide`,
        code: REPORTS_ERROR_CODES.FILTER_FIELD_INVALID,
        field: `filters[${i}].field`,
      };
    }
    if (
      typeof fr.operator !== 'string' ||
      !VALID_FILTER_OPERATORS.includes(fr.operator as never)
    ) {
      return {
        ok: false,
        error: `Filtre #${i}: opérateur invalide (attendu: ${VALID_FILTER_OPERATORS.join('|')})`,
        code: REPORTS_ERROR_CODES.FILTER_OPERATOR_INVALID,
        field: `filters[${i}].operator`,
      };
    }
    // Opérateurs in/nin → value DOIT être array.
    if ((fr.operator === 'in' || fr.operator === 'nin') && !Array.isArray(fr.value)) {
      return {
        ok: false,
        error: `Filtre #${i}: opérateur ${fr.operator} requiert un tableau de valeurs`,
        code: REPORTS_ERROR_CODES.FILTER_VALUE_INVALID,
        field: `filters[${i}].value`,
      };
    }
    // Opérateurs contains/starts_with → value DOIT être string.
    if (
      (fr.operator === 'contains' || fr.operator === 'starts_with') &&
      typeof fr.value !== 'string'
    ) {
      return {
        ok: false,
        error: `Filtre #${i}: opérateur ${fr.operator} requiert une string`,
        code: REPORTS_ERROR_CODES.FILTER_VALUE_INVALID,
        field: `filters[${i}].value`,
      };
    }
    // Pour eq/neq/gt/gte/lt/lte : value primitif (pas null/undefined silencieux).
    if (
      ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(fr.operator as string) &&
      (fr.value === undefined ||
        (typeof fr.value !== 'string' &&
          typeof fr.value !== 'number' &&
          typeof fr.value !== 'boolean' &&
          fr.value !== null))
    ) {
      return {
        ok: false,
        error: `Filtre #${i}: value doit être primitif (string|number|boolean|null)`,
        code: REPORTS_ERROR_CODES.FILTER_VALUE_INVALID,
        field: `filters[${i}].value`,
      };
    }
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// validateDateRange — borne entre 1 et MAX_DATE_RANGE_DAYS.
// Accepte ISO strings OR Date OR number (epoch ms). Inversion → erreur.
// ────────────────────────────────────────────────────────────────────────────

export interface DateRangeValidation extends ReportsValidation {
  days?: number;
}

export function validateDateRange(start: unknown, end: unknown): DateRangeValidation {
  const startMs = parseAnyDate(start);
  const endMs = parseAnyDate(end);
  if (startMs == null || endMs == null) {
    return {
      ok: false,
      error: 'Dates de début et fin requises (ISO string, Date ou epoch ms)',
      code: REPORTS_ERROR_CODES.DATE_RANGE_INVALID,
    };
  }
  if (startMs > endMs) {
    return {
      ok: false,
      error: 'Date de début > date de fin (inversion)',
      code: REPORTS_ERROR_CODES.DATE_RANGE_INVERTED,
    };
  }
  const days = Math.ceil((endMs - startMs) / 86_400_000);
  if (days > MAX_DATE_RANGE_DAYS) {
    return {
      ok: false,
      error: `Plage de dates trop large (${days} > ${MAX_DATE_RANGE_DAYS} jours)`,
      code: REPORTS_ERROR_CODES.DATE_RANGE_TOO_LARGE,
      days,
    };
  }
  return { ok: true, days };
}

function parseAnyDate(v: unknown): number | null {
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
// validateGroupBy — Array<string> ≤ MAX_GROUP_BY_FIELDS.
// ────────────────────────────────────────────────────────────────────────────

export function validateGroupBy(fields: unknown): ReportsValidation {
  if (fields == null) return { ok: true };
  if (!Array.isArray(fields)) {
    return {
      ok: false,
      error: 'groupBy doit être un tableau de strings',
      code: REPORTS_ERROR_CODES.GROUP_BY_FIELD_INVALID,
      field: 'groupBy',
    };
  }
  if (fields.length > MAX_GROUP_BY_FIELDS) {
    return {
      ok: false,
      error: `Trop de champs groupBy (${fields.length} > ${MAX_GROUP_BY_FIELDS})`,
      code: REPORTS_ERROR_CODES.GROUP_BY_TOO_MANY,
      field: 'groupBy',
    };
  }
  for (let i = 0; i < fields.length; i++) {
    if (!isValidFieldName(fields[i])) {
      return {
        ok: false,
        error: `groupBy[${i}] invalide (alphanumérique + underscore, ≤ ${MAX_FIELD_NAME_LENGTH} chars)`,
        code: REPORTS_ERROR_CODES.GROUP_BY_FIELD_INVALID,
        field: `groupBy[${i}]`,
      };
    }
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// validateAggregation — {field, op}.
// op='count' : field optionnel (COUNT(*)). Autres ops: field REQUIS.
// ────────────────────────────────────────────────────────────────────────────

export interface AggregationSpec {
  field?: string | null;
  op: (typeof VALID_AGGREGATIONS)[number];
}

export function validateAggregation(input: unknown): ReportsValidation {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Agrégation doit être un objet { field?, op }',
      code: REPORTS_ERROR_CODES.AGGREGATION_INVALID,
    };
  }
  const a = input as Record<string, unknown>;
  if (typeof a.op !== 'string' || !VALID_AGGREGATIONS.includes(a.op as never)) {
    return {
      ok: false,
      error: `Op invalide (attendu: ${VALID_AGGREGATIONS.join('|')})`,
      code: REPORTS_ERROR_CODES.AGGREGATION_INVALID,
      field: 'op',
    };
  }
  // count : field optionnel. Tous autres : field REQUIS.
  if (a.op !== 'count') {
    if (a.field == null) {
      return {
        ok: false,
        error: `Op '${a.op}' requiert un field`,
        code: REPORTS_ERROR_CODES.AGGREGATION_FIELD_REQUIRED,
        field: 'field',
      };
    }
    if (!isValidFieldName(a.field)) {
      return {
        ok: false,
        error: `field invalide pour op '${a.op}' (alphanumérique + underscore)`,
        code: REPORTS_ERROR_CODES.AGGREGATION_FIELD_REQUIRED,
        field: 'field',
      };
    }
  } else if (a.field != null && !isValidFieldName(a.field)) {
    return {
      ok: false,
      error: 'field invalide pour op count (laisser vide ou alphanumérique)',
      code: REPORTS_ERROR_CODES.AGGREGATION_FIELD_REQUIRED,
      field: 'field',
    };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// formatExportCsv — RFC 4180 strict.
// Header en première ligne, colonnes par ordre fourni. Échappe " et embed
// dans "..." si contient virgule/quote/newline. CRLF en séparateur ligne.
// ────────────────────────────────────────────────────────────────────────────

export function formatExportCsv(
  rows: Array<Record<string, unknown>>,
  columns: string[],
): string {
  if (!Array.isArray(rows)) return '';
  if (!Array.isArray(columns) || columns.length === 0) return '';

  const lines: string[] = [];
  lines.push(columns.map(csvEscape).join(','));
  const max = Math.min(rows.length, MAX_EXPORT_ROWS);
  for (let i = 0; i < max; i++) {
    const row = rows[i] || {};
    const cells = columns.map((c) => csvEscape(row[c]));
    lines.push(cells.join(','));
  }
  return lines.join('\r\n');
}

/** Échappe une cellule selon RFC 4180. */
export function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  // Quote si contient virgule, double quote, CR ou LF.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
