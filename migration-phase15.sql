-- Migration Phase 15 — Webchat Widget Live
-- Exécuter : bun run db:migrate:phase15

CREATE TABLE IF NOT EXISTS webchat_widgets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  primary_color TEXT DEFAULT '#009DDB',
  welcome_message TEXT DEFAULT 'Bonjour ! Comment puis-je vous aider ?',
  business_hours_json TEXT DEFAULT '{}',
  offline_form_enabled INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webchat_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  widget_id TEXT NOT NULL,
  lead_id TEXT,
  visitor_id TEXT,
  visitor_name TEXT,
  visitor_email TEXT,
  status TEXT CHECK (status IN ('active','closed','offline_form')) DEFAULT 'active',
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webchat_sessions_widget ON webchat_sessions(widget_id);
CREATE INDEX IF NOT EXISTS idx_webchat_sessions_lead ON webchat_sessions(lead_id);
