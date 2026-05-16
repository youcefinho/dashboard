-- Migration Sprint 46 M2 — Admin analytics telemetry
-- Auteur : Manager M2 — Sprint 46 (2026-05-15)
--
-- Tables :
--   1. feature_events — telemetry feature usage (M2.4)
--                      tracking adoption / sessions / unique users / last_used
--                      par feature_id + user_id + role + timestamp.
--
-- Note : on garde INTEGER PK AUTOINCREMENT cohérent avec autres tables
-- d'audit/telemetry (audit_log etc.). user_id en INTEGER pour matcher la
-- forme spec, mais en pratique users.id est TEXT (UUID) dans schema.sql —
-- on garde INTEGER comme demandé dans le brief (compat MVP, cast côté
-- worker au besoin).

CREATE TABLE IF NOT EXISTS feature_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  feature_id TEXT NOT NULL,
  role TEXT,
  event_time INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_feature_events_feature ON feature_events(feature_id);
CREATE INDEX IF NOT EXISTS idx_feature_events_user ON feature_events(user_id);
CREATE INDEX IF NOT EXISTS idx_feature_events_time ON feature_events(event_time);
