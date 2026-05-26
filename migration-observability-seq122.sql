-- ── Sprint 24 — Observabilité — seq122 (2026-05-22) ─────────────────────────
-- 100% ADDITIF : CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- AUCUN ALTER de table existante. AUCUNE capability ajoutée (ALL_CAPABILITIES seq80 FIGÉE).
-- Sources de vérité (grep) :
--   - web_vitals    : migration-sprintS9-m1.sql:65-77  (seq77) — lecture seulement.
--   - audit_log     : migration-phase5.sql:5-14 + ALTER seq121 (request_id, tenant_id, redacted).
--   - clients(id)   : bootstrap schema.sql.
-- Convention figée : id TEXT PK lower(hex(randomblob(16))), timestamps datetime('now').

-- 1. Métriques requêtes agrégées (bucket 1min × route × status × tenant)
CREATE TABLE IF NOT EXISTS request_metrics (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  bucket_start  TEXT NOT NULL,
  route         TEXT NOT NULL,
  method        TEXT NOT NULL,
  status        INTEGER NOT NULL,
  tenant_id     TEXT,
  count         INTEGER NOT NULL DEFAULT 1,
  latency_sum_ms INTEGER NOT NULL DEFAULT 0,
  latency_max_ms INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_req_metrics_bucket ON request_metrics(bucket_start);
CREATE INDEX IF NOT EXISTS idx_req_metrics_route_bucket ON request_metrics(route, bucket_start);
CREATE INDEX IF NOT EXISTS idx_req_metrics_tenant ON request_metrics(tenant_id);

-- 2. Règles d'alerte
CREATE TABLE IF NOT EXISTS alert_rules (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name                  TEXT NOT NULL,
  condition_type        TEXT NOT NULL,
  metric_name           TEXT,
  threshold             REAL NOT NULL,
  window_minutes        INTEGER NOT NULL DEFAULT 60,
  notification_channel  TEXT NOT NULL DEFAULT 'log',
  notification_target   TEXT DEFAULT '',
  enabled               INTEGER NOT NULL DEFAULT 1,
  created_by            TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);

-- 3. Événements d'alerte (audit firings)
CREATE TABLE IF NOT EXISTS alert_events (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  rule_id       TEXT NOT NULL REFERENCES alert_rules(id),
  triggered_at  TEXT DEFAULT (datetime('now')),
  payload       TEXT DEFAULT '{}',
  resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_events_rule ON alert_events(rule_id, triggered_at);
CREATE INDEX IF NOT EXISTS idx_alert_events_unresolved ON alert_events(resolved_at);
