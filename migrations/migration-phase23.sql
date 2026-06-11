-- ── Phase C: Workflows Engine Extensions (Sprint 4) ──

ALTER TABLE workflows ADD COLUMN folder_id TEXT;
ALTER TABLE workflows ADD COLUMN status TEXT CHECK (status IN ('draft','published','paused','archived')) DEFAULT 'draft';
ALTER TABLE workflows ADD COLUMN reenrollment_rules_json TEXT DEFAULT '{}';
ALTER TABLE workflows ADD COLUMN stop_on_reply INTEGER DEFAULT 0;
ALTER TABLE workflows ADD COLUMN respect_timezone INTEGER DEFAULT 1;
ALTER TABLE workflows ADD COLUMN quiet_hours_start TEXT;
ALTER TABLE workflows ADD COLUMN quiet_hours_end TEXT;
ALTER TABLE workflows ADD COLUMN business_hours_only INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS workflow_folders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE workflow_steps ADD COLUMN parent_step_id TEXT;
ALTER TABLE workflow_steps ADD COLUMN branch TEXT CHECK (branch IN ('main','true','false')) DEFAULT 'main';

CREATE TABLE IF NOT EXISTS trigger_links (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  click_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trigger_link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL,
  lead_id TEXT,
  ip TEXT,
  user_agent TEXT,
  clicked_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_link_clicks_link ON trigger_link_clicks(link_id);
CREATE INDEX idx_link_clicks_lead ON trigger_link_clicks(lead_id);

CREATE TABLE IF NOT EXISTS message_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  event_type TEXT CHECK (event_type IN ('open','click')) NOT NULL,
  url TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_message_events_msg ON message_events(message_id);
