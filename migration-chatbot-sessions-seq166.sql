CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_token TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  confidence_avg REAL DEFAULT 0,
  client_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_client ON chatbot_sessions(client_id);
