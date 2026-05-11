-- Migration Sprint 3 — Vertical Conversations
-- Exécuter : npx wrangler d1 execute intralys-crm --file=migration-sprint3.sql

-- Table conversations — entité first-class
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'email',        -- email, sms, webchat, facebook_messenger, instagram_dm
  status TEXT NOT NULL DEFAULT 'open',           -- open, closed, snoozed
  assigned_to TEXT,                               -- user_id de l'agent assigné
  subject TEXT DEFAULT '',
  last_message_at TEXT,
  last_message_preview TEXT DEFAULT '',
  unread_count INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  snoozed_until TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(last_message_at DESC);

-- Ajouter conversation_id aux messages existants
ALTER TABLE messages ADD COLUMN conversation_id TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
