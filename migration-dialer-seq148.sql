-- Migration: seq148
-- Description: Table pour le Power Dialer (S54)
-- Dependances: migration-voicemail-seq147.sql

CREATE TABLE IF NOT EXISTS dialer_campaigns (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  leads_json TEXT NOT NULL, -- Liste ordonnée de lead_ids : '["id1", "id2", ...]'
  status TEXT CHECK(status IN ('draft', 'active', 'paused', 'completed')) DEFAULT 'draft',
  current_index INTEGER DEFAULT 0,
  script_markdown TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dialer_campaigns_client ON dialer_campaigns(client_id);
