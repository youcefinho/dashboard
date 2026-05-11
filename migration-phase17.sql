-- Migration Phase 17 — Saved Replies / Snippets
-- Exécuter : bun run db:migrate:phase17

CREATE TABLE IF NOT EXISTS saved_replies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  shortcut TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_saved_replies_client ON saved_replies(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_replies_client_shortcut ON saved_replies(client_id, shortcut);

-- Add email_signature_html to users
ALTER TABLE users ADD COLUMN email_signature_html TEXT;
