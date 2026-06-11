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
