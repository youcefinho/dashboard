-- Migration Phase 18 — Scheduled Messages
-- Exécuter : bun run db:migrate:phase18

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  sent_by TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending ON scheduled_messages(status, scheduled_at);
