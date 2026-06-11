# LOT 3 — Sprint 25 : Perf

> Doc contrat §6 figé. Migration : seq123 — `migration-perf-indexes-seq123.sql`.

## Objectif
7 axes ciblés : (1) perf-budgets.ts source-of-truth WEB_VITALS_BUDGETS + checkVitalBudget, (2) cache.ts helper Cache API Cloudflare (3 fonctions never-throws), (3) perf-budget-log worker logger budget (TRACKED LCP/CLS/INP), (4) migration seq123 (3 indexes : audit_log/request_metrics/web_vitals composites), (5) application cache 3 endpoints (Manager-B chirurgical worker.ts), (6) composant PerfBudgetCard intégré ObservabilityPanel (Manager-C), (7) 18 clés i18n perf.* parité 4 catalogues.

## Hors-scope
- Refonte composants lourds (Reports/Workflows/Pipeline) → backlog
- vite.config / wrangler.jsonc → INTOUCHABLES (Sprint 35/43/50 déjà maturé)
- R2 assets / Cloudflare Images / SW custom → backlog
- DB sharding / read replicas → impossible D1 natif
- React.memo audit → backlog Sprint 29

## §6 Contrats figés

### 6.1 Migration SQL `migration-perf-indexes-seq123.sql`

```sql
-- ── Sprint 25 — Perf — seq123 (2026-05-22) ──────────────────────────────────
-- 100% ADDITIF : CREATE INDEX IF NOT EXISTS uniquement.
-- AUCUN ALTER de table. AUCUNE capability. depends_on : seq122 (request_metrics).
-- Sources de vérité (grep) :
--   - audit_log         : migration-phase5.sql:5-14 + seq121 ALTER (action col existante).
--   - request_metrics   : migration-observability-seq122.sql:11-22.
--   - web_vitals        : migration-sprintS9-m1.sql:65-77.
-- Gaps détectés (queries hot observability-admin.ts:246, :179 ; observability-ops.ts:148).

-- 1. audit_log : query `WHERE action LIKE 'error.%' AND created_at > ?`
CREATE INDEX IF NOT EXISTS idx_audit_action_created
  ON audit_log(action, created_at);

-- 2. request_metrics : query `WHERE bucket_start > ? GROUP BY route ORDER BY count DESC`
--    L'index existant `(route, bucket_start)` est inversé pour ce scan.
CREATE INDEX IF NOT EXISTS idx_req_metrics_time_route
  ON request_metrics(bucket_start, route);

-- 3. web_vitals : p75For loop `WHERE metric_name=? AND created_at >= ? ORDER BY value`
CREATE INDEX IF NOT EXISTS idx_web_vitals_metric_created
  ON web_vitals(metric_name, created_at);
```

#### Manifest entry

```json
{
  "seq": 123,
  "file": "migration-perf-indexes-seq123.sql",
  "depends_on": ["migration-observability-seq122.sql", "migration-security-compliance-seq121.sql", "migration-sprintS9-m1.sql"],
  "objects": ["index:audit_log", "index:request_metrics", "index:web_vitals"],
  "risk": "low"
}
```

### 6.2 `src/lib/perf-budgets.ts`

```ts
// ── Sprint 25 — Perf budgets (source de vérité partagée) ────────────────────
// Référence officielle : web.dev/vitals (seuils Google).
// Réplique des seuils déjà in-line dans webVitals.ts (THRESHOLDS lignes 36-42).
// DRY différée : webVitals.ts reste autonome (1 dep externe = 0), ce module
// est consommé par PerfBudgetCard.tsx + perf-budget-log.ts (worker).

export type WebVitalName = 'LCP' | 'CLS' | 'INP' | 'TTFB' | 'FCP';
export type BudgetSeverity = 'pass' | 'needs-improvement' | 'fail';

export const WEB_VITALS_BUDGETS: Record<WebVitalName, { good: number; poor: number; unit: 'ms' | 'score' }> = {
  LCP:  { good: 2500, poor: 4000, unit: 'ms' },
  CLS:  { good: 0.1,  poor: 0.25, unit: 'score' },
  INP:  { good: 200,  poor: 500,  unit: 'ms' },
  TTFB: { good: 800,  poor: 1800, unit: 'ms' },
  FCP:  { good: 1800, poor: 3000, unit: 'ms' },
};

// Budgets bundle gzip (KB). Source : scripts/check-bundle-size.mjs BUDGETS.
// Ré-exposé ici pour usage admin panel (lecture seule, jamais d'enforcement
// côté UI — c'est CI / Antigravity côté hôte qui enforce via le script).
export const BUNDLE_SIZE_BUDGETS_KB: Record<string, number> = {
  initialApp: 230,
  pageChunkMax: 220,
  vendorChunkMax: 320,
  cssMax: 80,
};

export function checkVitalBudget(name: WebVitalName, value: number): {
  severity: BudgetSeverity;
  budget: { good: number; poor: number; unit: 'ms' | 'score' };
} {
  const b = WEB_VITALS_BUDGETS[name];
  if (value <= b.good) return { severity: 'pass', budget: b };
  if (value <= b.poor) return { severity: 'needs-improvement', budget: b };
  return { severity: 'fail', budget: b };
}
```

### 6.3 `src/worker/lib/cache.ts`

Helpers `cacheGet(req)`, `cachePut(req, res, ttlSec)`, `cacheBust(req)` via `caches.default` Cloudflare Workers. Best-effort STRICT (never throws). `cachePut` mute le header `Cache-Control: public, max-age=N`. À appeler via `ctx.waitUntil(cachePut(...))` pour ne pas bloquer.

### 6.4 `src/worker/perf-budget-log.ts`

Helper `logPerfBudget(env, payload, userId?)`. Filtre `TRACKED = {'LCP','CLS','INP'}`. Si `checkVitalBudget(...).severity === 'fail'` → `console.warn` + `audit(env, userId ?? 'system', 'perf.budget_exceeded', 'web_vitals', '', { name, value, url })`. Adapté signature réelle `audit()` qui exige `resourceId: string` (donc `''` au lieu de `null`).

### 6.5 `src/components/admin/PerfBudgetCard.tsx`

Props : `vitals: Array<{ metric_name; count; avg; p75 }>`. Affiche grille 2 cols mobile / 5 cols md+ ; pour chaque vital TRACKED_VITALS, call `checkVitalBudget(name, v.p75)` → variant `success|warning|danger` → `<Tag>` + valeur formatée (`CLS.toFixed(2)`, autres `Math.round`) + label budget good. Empty state si `vitals.length === 0` (`<EmptyState variant="compact" title={t('perf.no_data')} />`). Imports `Card, Tag, EmptyState` depuis `@/components/ui`.

### 6.6 i18n — 18 clés `perf.*` × 4 catalogues

Clés (parité stricte) :
`perf.budget_card_title`, `perf.budget_card_subtitle`, `perf.budget_pass`, `perf.budget_needs`, `perf.budget_fail`, `perf.metric_lcp_label`, `perf.metric_cls_label`, `perf.metric_inp_label`, `perf.metric_ttfb_label`, `perf.metric_fcp_label`, `perf.threshold_good`, `perf.threshold_poor`, `perf.unit_ms`, `perf.unit_score`, `perf.no_data`, `perf.budget_exceeded_log`, `perf.cache_hint`, `perf.tracked_explanation`.

## Garde-fous
- Cache helper never-throws (try/catch global, calque request-metrics.ts pattern)
- Migration seq123 = 3 CREATE INDEX IF NOT EXISTS (zero risque)
- Source-of-truth budgets DRY différée (webVitals.ts reste autonome, perf-budgets.ts est consommateur uniquement)
- ALL_CAPABILITIES seq80 INTOUCHABLE (PerfBudgetCard sous AdminGuard existant)
- vite.config / wrangler / scripts intouchables (maturité Sprint 35/43/50 préservée)
