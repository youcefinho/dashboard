-- Sprint 8: Phase 33 Migration
-- Saved Reports & Customization

CREATE TABLE IF NOT EXISTS saved_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  schedule_cron TEXT,
  email_recipients TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
