// ── data-reconcile-engine.ts — Helpers PURS reconcile orphans / stale (P2-1) ─
//
// 100% ADDITIF — complète `data-reconcile.ts` (handler READ-ONLY orphan
// detection). Helpers PURS (zéro I/O) pour :
//   - Validation de la query reconcile (pass type, dryRun, batchSize)
//   - Formatage du rapport (summary + détails par type)
//   - Détection des records "stale" (ancienneté > threshold)
//   - Catalogue des pass types (orphans|duplicates|stale)
//
// IMPORTANT : ce module est PUR — pas de DB. Distinct de
// `reconcile-engine.ts` (qui couvre customer↔lead dédoublonnage email/phone/
// fuzzy name). Ici, c'est l'intégrité référentielle large + stale data.

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const DATA_RECONCILE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_PASS_TYPE: 'INVALID_PASS_TYPE',
  INVALID_BATCH_SIZE: 'INVALID_BATCH_SIZE',
  INVALID_DRY_RUN: 'INVALID_DRY_RUN',
  INVALID_THRESHOLD_DAYS: 'INVALID_THRESHOLD_DAYS',
  INVALID_RECORD: 'INVALID_RECORD',
} as const);

export type DataReconcileErrorCode =
  (typeof DATA_RECONCILE_ERROR_CODES)[keyof typeof DATA_RECONCILE_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Constantes
// ════════════════════════════════════════════════════════════════════════════

// Types de passes de reconcile. Distinct des pass-types de `reconcile-engine`
// (qui font du dédoublonnage). Ici on couvre l'intégrité large.
export const RECONCILE_PASS_TYPES = Object.freeze([
  'orphans',
  'duplicates',
  'stale',
] as const);
export type ReconcilePassType = (typeof RECONCILE_PASS_TYPES)[number];

const PASS_TYPE_SET: ReadonlySet<string> = new Set<string>(RECONCILE_PASS_TYPES);

// Cap batch size — anti-DoS (le caller peut demander dryRun: false pour
// effectuer un cleanup, mais on borne la taille pour éviter de bloquer D1).
export const MAX_BATCH_SIZE = 1000;
export const MIN_BATCH_SIZE = 1;
export const DEFAULT_BATCH_SIZE = 100;

// Threshold par défaut pour "stale" (90 jours).
export const DEFAULT_STALE_DAYS = 90;
export const MAX_STALE_DAYS = 3650; // 10 ans (cap raisonnable)
export const MIN_STALE_DAYS = 1;

// ════════════════════════════════════════════════════════════════════════════
// validateReconcileQuery
// ════════════════════════════════════════════════════════════════════════════

export interface ReconcileQueryInput {
  pass?: unknown;
  dryRun?: unknown;
  batchSize?: unknown;
  thresholdDays?: unknown;
}

export interface ReconcileQueryValidation {
  ok: boolean;
  error?: DataReconcileErrorCode;
  field?: string;
  pass?: ReconcilePassType;
  dryRun?: boolean;
  batchSize?: number;
  thresholdDays?: number;
}

export function validateReconcileQuery(
  input: ReconcileQueryInput,
): ReconcileQueryValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: DATA_RECONCILE_ERROR_CODES.INVALID_INPUT };
  }
  // pass (requis).
  const p = input.pass;
  if (typeof p !== 'string' || !PASS_TYPE_SET.has(p)) {
    return {
      ok: false,
      error: DATA_RECONCILE_ERROR_CODES.INVALID_PASS_TYPE,
      field: 'pass',
    };
  }
  // dryRun (optionnel, defaut true — safety first).
  let dryRun = true;
  if (input.dryRun !== undefined) {
    if (typeof input.dryRun !== 'boolean') {
      return {
        ok: false,
        error: DATA_RECONCILE_ERROR_CODES.INVALID_DRY_RUN,
        field: 'dryRun',
      };
    }
    dryRun = input.dryRun;
  }
  // batchSize (optionnel, defaut DEFAULT_BATCH_SIZE).
  let batchSize = DEFAULT_BATCH_SIZE;
  if (input.batchSize !== undefined) {
    if (
      typeof input.batchSize !== 'number' ||
      !Number.isFinite(input.batchSize) ||
      !Number.isInteger(input.batchSize) ||
      input.batchSize < MIN_BATCH_SIZE ||
      input.batchSize > MAX_BATCH_SIZE
    ) {
      return {
        ok: false,
        error: DATA_RECONCILE_ERROR_CODES.INVALID_BATCH_SIZE,
        field: 'batchSize',
      };
    }
    batchSize = input.batchSize;
  }
  // thresholdDays (optionnel, defaut DEFAULT_STALE_DAYS — seulement pour pass=stale).
  let thresholdDays = DEFAULT_STALE_DAYS;
  if (input.thresholdDays !== undefined) {
    if (
      typeof input.thresholdDays !== 'number' ||
      !Number.isFinite(input.thresholdDays) ||
      !Number.isInteger(input.thresholdDays) ||
      input.thresholdDays < MIN_STALE_DAYS ||
      input.thresholdDays > MAX_STALE_DAYS
    ) {
      return {
        ok: false,
        error: DATA_RECONCILE_ERROR_CODES.INVALID_THRESHOLD_DAYS,
        field: 'thresholdDays',
      };
    }
    thresholdDays = input.thresholdDays;
  }
  return {
    ok: true,
    pass: p as ReconcilePassType,
    dryRun,
    batchSize,
    thresholdDays,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// isStaleRecord
// ════════════════════════════════════════════════════════════════════════════
//
// Retourne true si le record est plus vieux que `thresholdDays`. Accepte
// `record` sous forme d'objet avec `updated_at`/`created_at`, OU directement
// une date/string/number. `now` injecté pour testability.

export function isStaleRecord(
  record:
    | { updated_at?: string | number | Date | null; created_at?: string | number | Date | null; last_seen_at?: string | number | Date | null }
    | string
    | number
    | Date
    | null
    | undefined,
  thresholdDays: number = DEFAULT_STALE_DAYS,
  now: number = Date.now(),
): boolean {
  if (record == null) return false;
  if (
    !Number.isFinite(thresholdDays) ||
    thresholdDays < MIN_STALE_DAYS ||
    thresholdDays > MAX_STALE_DAYS
  ) {
    return false;
  }
  let raw: string | number | Date | null | undefined;
  if (record && typeof record === 'object' && !(record instanceof Date)) {
    const r = record as {
      updated_at?: string | number | Date | null;
      created_at?: string | number | Date | null;
      last_seen_at?: string | number | Date | null;
    };
    // Priorité : updated_at > last_seen_at > created_at.
    raw = r.updated_at ?? r.last_seen_at ?? r.created_at;
  } else {
    raw = record as string | number | Date;
  }
  if (raw == null) return false;
  let recordMs: number;
  if (raw instanceof Date) {
    recordMs = raw.getTime();
  } else if (typeof raw === 'number') {
    recordMs = raw < 1e12 ? raw * 1000 : raw;
  } else if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return false;
    recordMs = parsed;
  } else {
    return false;
  }
  if (!Number.isFinite(recordMs)) return false;
  const ageMs = now - recordMs;
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return ageMs > thresholdMs;
}

// ════════════════════════════════════════════════════════════════════════════
// formatReconcileReport
// ════════════════════════════════════════════════════════════════════════════
//
// Formate un rapport reconcile en `{ summary, details }`. `summary` est un
// dict total par type (orphans/duplicates/stale). `details` est l'array
// passé tel quel (avec normalisation).

export interface ReconcileResult {
  relation?: string;
  type?: ReconcilePassType | string;
  count?: number;
  records?: Array<Record<string, unknown>>;
}

export interface ReconcileReport {
  summary: {
    total: number;
    byType: Record<string, number>;
    byRelation: Record<string, number>;
  };
  details: Array<{
    relation: string;
    type: string;
    count: number;
  }>;
  generated_at: string;
}

export function formatReconcileReport(
  results: ReconcileResult[] | null | undefined,
  now: Date = new Date(),
): ReconcileReport {
  const list = Array.isArray(results) ? results : [];
  const details: ReconcileReport['details'] = [];
  const byType: Record<string, number> = {};
  const byRelation: Record<string, number> = {};
  let total = 0;
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const relation = typeof r.relation === 'string' ? r.relation : 'unknown';
    const type = typeof r.type === 'string' ? r.type : 'orphans';
    const count = Number.isFinite(r.count) ? Number(r.count) : 0;
    if (count <= 0) continue;
    details.push({ relation, type, count });
    byType[type] = (byType[type] || 0) + count;
    byRelation[relation] = (byRelation[relation] || 0) + count;
    total += count;
  }
  return {
    summary: { total, byType, byRelation },
    details,
    generated_at: now.toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// chunkBatch — utilitaire pour découper les IDs en batches sécurisés
// ════════════════════════════════════════════════════════════════════════════

export function chunkBatch<T>(items: T[], batchSize: number = DEFAULT_BATCH_SIZE): T[][] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const size = Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, Math.floor(batchSize)));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// computeReconcileSummary — agrégation simple
// ════════════════════════════════════════════════════════════════════════════
//
// Retourne `{ total, healthy }` à partir d'un rapport. `healthy = total === 0`.

export function computeReconcileSummary(report: ReconcileReport | null | undefined): {
  total: number;
  healthy: boolean;
} {
  if (!report || typeof report !== 'object' || !report.summary) {
    return { total: 0, healthy: true };
  }
  const total = Number.isFinite(report.summary.total) ? report.summary.total : 0;
  return { total, healthy: total === 0 };
}
