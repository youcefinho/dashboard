-- Migration Phase 14 — Broadcasts & Queues
-- Exécuter : bun run db:migrate:phase14 (via db:setup plus tard)

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  template_id TEXT,
  body_html TEXT,
  body_text TEXT,
  filters_json TEXT DEFAULT '{}',
  total INTEGER DEFAULT 0,
  sent INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  status TEXT CHECK (status IN ('queued','processing','completed','failed')) DEFAULT 'queued',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_broadcasts_user ON broadcasts(user_id);
