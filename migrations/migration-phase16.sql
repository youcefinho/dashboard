-- Migration Phase 16 — Meta Connections (Facebook Messenger & Instagram DM)
-- Exécuter : bun run db:migrate:phase16

CREATE TABLE IF NOT EXISTS meta_connections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  platform TEXT CHECK (platform IN ('facebook','instagram')) NOT NULL,
  page_id TEXT NOT NULL,
  page_name TEXT,
  access_token_encrypted TEXT NOT NULL,
  ig_business_id TEXT,
  is_active INTEGER DEFAULT 1,
  connected_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meta_connections_client ON meta_connections(client_id);
CREATE INDEX IF NOT EXISTS idx_meta_connections_page ON meta_connections(page_id);
