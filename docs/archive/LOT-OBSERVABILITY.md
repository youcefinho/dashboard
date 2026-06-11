# LOT 3 — Sprint 24 : Observabilité

> Doc contrat §6 figé. Migration : seq122 — `migration-observability-seq122.sql`.

## Objectif

5 axes :

1. **Logger structuré étendu additif** — `createLogger(env)` figé S4 ; on ajoute `debug()` à l'interface `Logger` + helper `createCorrelatedLogger(env, requestId)` qui enrichit `ctx` avec `request_id`.
2. **Middleware `request_id`** — au chokepoint `worker.ts:339`, génération d'un UUID (ou reprise du header `X-Request-Id` entrant), stocké module-scope via `setRequestId()`, injecté en sortie via `json()` (header `X-Request-Id`) et propagé dans `audit_log.request_id` (colonne seq121).
3. **Table `request_metrics`** agrégeable + helper `recordRequestMetric(env, ctx)` appelé via `ctx.waitUntil()` au point de sortie (best-effort, never throws).
4. **6 routes admin observability** sous `/api/admin/observability/*` (proxy `handleAdminWebVitals` S-D pour `/web-vitals`, stubs Phase A pour le reste — Manager-B remplira le corps SQL).
5. **CRUD `alert_rules` + `alert_events`** (cron évaluation = backlog Manager-B).

## Hors-scope

- Refactor des 166 `console.*` worker → mini-sprint séparé post-RC.
- Cron évaluation d'alertes → backlog (stub `evaluateAlertRules` no-op pour Phase A).
- Sentry/DataDog → en-stack uniquement.
- Auto-purge `web_vitals` / `request_metrics` 90j → backlog.
- CSP strict → Sprint 29.
- Analytics Engine binding → reste D1.
- `/api/readiness` séparé de `/api/health` → backlog.

## §6 Contrats figés

### 6.1 SQL migration — seq122

Voir `migration-observability-seq122.sql` (3 tables + 6 index, 100 % additif).

### 6.2 Types

- `src/worker/types.ts` (APPEND, sans toucher `Env`) : `RequestMetricRow`, `AlertConditionType`, `AlertChannel`, `AlertRuleRow`, `AlertEventRow`.
- `src/lib/types.ts` (APPEND, miroirs front) : `AlertConditionType`, `AlertChannel`, `AlertRule`, `AlertEvent`, `ObservabilityHealth`, `RequestMetricsBucket`.

### 6.3 Schemas zod (`src/lib/schemas.ts` append)

- `alertRuleCreateSchema` (name 1-100, condition_type enum, threshold ≥0, window_minutes 1-1440, notification_channel enum, notification_target URL ≤2048, enabled bool).
- `alertRuleUpdateSchema` = `alertRuleCreateSchema.partial()`.
- `observabilityQuerySchema` (`period` ∈ `1h|24h|7d|30d`, `route?` ≤200).

Note : projet utilise `zod/v4` (cf. `schemas.ts:4`) — usage de `z.url()` direct quand pertinent.

### 6.4 API front (`src/lib/api.ts` append)

8 fonctions : `fetchObservabilityHealth`, `fetchRequestMetrics`, `fetchErrorMetrics`, `fetchWebVitalsObservability`, `fetchAlerts`, `createAlertRule`, `updateAlertRule`, `deleteAlertRule`.

### 6.5 Logger extension

- `LogLevel` étendue `'error' | 'warn' | 'info' | 'debug'`.
- `SEVERITY` étendu `{ error:0, warn:1, info:2, debug:3 }`.
- `Logger` interface ajoute `debug(msg, ctx?)`.
- `createLogger(env)` ÉTEND avec implémentation `debug` (signature publique INCHANGÉE).
- `createCorrelatedLogger(env, requestId)` ajouté en bas du fichier — wrap `createLogger` et enrichit `ctx` avec `request_id`.

### 6.6 Helpers.ts extension

- `_currentRequestId: string | null` module-scope + `setRequestId(id)` / `getRequestId()` exports.
- `json(data, status)` injecte header `X-Request-Id` si `_currentRequestId` présent (signature publique INCHANGÉE).
- `audit()` étendu avec triple fallback SQL :
  - **9 cols** (chemin nominal seq122+) : `... request_id, redacted)` — utilise `_currentRequestId`.
  - **8 cols** (fallback seq121-only) : `... redacted)` — sans `request_id`.
  - **7 cols** (fallback historique pré-seq121) : forme originale.
  - Détection via `/no such column/i.test(e.message)`.
- Signature publique `audit(env, userId, action, resourceType, resourceId, details?)` INCHANGÉE.

### 6.7 Stubs Phase A

- `src/worker/lib/request-metrics.ts` — `normalizeRoute(path)` no-op + `recordRequestMetric(env, ctx)` no-op (best-effort SWALLOW, never throws).
- `src/worker/lib/alert-evaluator.ts` — `evaluateAlertRules(env): Promise<{ evaluated, fired }>` no-op (best-effort SWALLOW).
- `src/worker/observability-admin.ts` — 6 handlers stubs : `handleGetObservabilityHealth`, `handleGetRequestMetrics`, `handleGetErrorMetrics`, `handleListAlerts`, `handleCreateAlertRule`, `handleUpdateAlertRule`, `handleDeleteAlertRule`.

### 6.8 worker.ts edits

- Chokepoint ~ligne 339 (après `setRequestContext`) : génération `requestId` (header `X-Request-Id` entrant prioritaire, sinon `crypto.randomUUID()`) + `setRequestId(requestId)` + `__startMs = Date.now()`.
- Bloc routes `/api/admin/observability/*` après ligne 2694 (post `/api/admin/web-vitals`) — garde admin/owner LOCALE (calque patron admin-analytics) + dynamic import `./worker/observability-admin`.
  - `GET /health`, `GET /request-metrics`, `GET /errors`, `GET /web-vitals` (proxy `handleAdminWebVitals`), `GET /alerts`, `POST /alert-rules`, `PATCH /alert-rules/:id`, `DELETE /alert-rules/:id`.
- Wrapper `ctx.waitUntil(recordRequestMetric(env, {...}))` autour du `routeProtected` (ligne ~1166) — best-effort `.catch(() => {})`.

### 6.9 i18n ~57 clés × 4 catalogues

- `observability.*` (33 clés) + `alerts.*` (24 clés).
- 4 catalogues stricte parité : `fr-CA.ts`, `fr-FR.ts`, `en.ts`, `es.ts`.

### 6.10 Frontend stubs

- `src/pages/admin/ObservabilityPanel.tsx` — `<div data-pending="manager-c" />`.
- `src/components/admin/AlertRulesPanel.tsx` — `<div data-pending="manager-c" />`.

### 6.11 App.tsx route

- `adminObservabilityRoute` lazy-loaded sous `/admin/observability`, wrappée `LazyGuard + AdminGuard` (calque `adminOverviewRoute`).
- Ajout dans `routeTree.addChildren([...])`.

## Garde-fous

- Best-effort SWALLOW partout (`recordRequestMetric`, `evaluateAlertRules`, `audit()` triple try/catch).
- Signature publique `audit()` INCHANGÉE — extension chirurgicale.
- `createLogger(env)` signature publique INCHANGÉE — extension additive.
- `observability-ops.ts` S-D FIGÉ — on PROXY via réutilisation `handleAdminWebVitals`.
- `health.ts` S10 FIGÉ.
- `error-response.ts` S4 FIGÉ.
- `telemetry.ts` S9 FIGÉ.
- `ALL_CAPABILITIES` seq80 INTOUCHABLE (settings.manage pour lecture, team.manage pour CRUD alerts).
- Migrations historiques + `schema.sql` + `seed.sql` INTOUCHABLES.
- `wrangler.jsonc` : aucun nouveau binding.

## Codes d'erreur Sprint 24

- `ALERT_RULE_INVALID` (400) — body schema fail (création/update).
- `ALERT_NOT_FOUND` (404) — règle absente (update/delete).
- `METRICS_UNAVAILABLE` (200 fallback) — `unavailable: true` dans payload `data`.
