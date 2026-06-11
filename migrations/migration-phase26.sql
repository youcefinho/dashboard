-- Migration Sprint 6 - Phase A (Inbox & Templates)

-- 1. Table Snippets (Réponses rapides / Saved Replies)
CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT,
  name TEXT NOT NULL,
  shortcut TEXT DEFAULT '',
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snippets_user ON snippets(user_id);
CREATE INDEX IF NOT EXISTS idx_snippets_shortcut ON snippets(shortcut);

-- 2. Enrichir les Templates pour supporter les SMS
ALTER TABLE email_templates ADD COLUMN channel TEXT DEFAULT 'email';
