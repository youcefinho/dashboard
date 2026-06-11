-- Migration seq 150 — Sprint 57 Canaux Internes de Discussion Équipe (Slack-like)
--
-- Création des tables internal_channels et internal_messages pour le clavardage
-- d'équipe. Pas de clés étrangères (FK) selon les standards applicatifs D1.
-- Jointures applicatives. Timestamps TEXT conventionnels.

CREATE TABLE IF NOT EXISTS internal_channels (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  name TEXT,
  description TEXT,
  is_private INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS internal_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  user_id TEXT,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_internal_channels_client ON internal_channels(client_id);
CREATE INDEX IF NOT EXISTS idx_internal_messages_channel ON internal_messages(channel_id);
