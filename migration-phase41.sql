-- Migration Phase 41 — Hotfix Sprint 14.5
-- Relâche messages.channel CHECK constraint pour accepter les canaux GHL multi-source
-- (call, webchat, facebook, instagram en plus de email/sms/internal_note).
-- Ajoute UNIQUE(client_id, external_id) partial index pour idempotence des imports.

-- ── Recréation de la table messages sans CHECK channel restrictif ──
-- SQLite ne supporte pas DROP CONSTRAINT, donc table recreation.

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS messages_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')) NOT NULL,
  channel TEXT NOT NULL,  -- Plus de CHECK — accepte tous les canaux GHL (email, sms, call, webchat, facebook, instagram, internal_note, ...)
  subject TEXT DEFAULT '',
  body TEXT NOT NULL,
  status TEXT DEFAULT 'sent',  -- CHECK retiré aussi (broadcast.ts utilise 'mock-sent' qui était rejeté)
  sent_by TEXT DEFAULT '',
  external_id TEXT DEFAULT '',
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Copier les données existantes (si la table source existe)
INSERT INTO messages_new (id, lead_id, client_id, direction, channel, subject, body, status, sent_by, external_id, metadata, created_at)
  SELECT id, lead_id, client_id, direction, channel, subject, body, status, sent_by, external_id, metadata, created_at
  FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

-- Recréer les indexes
CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);

-- Index partiel UNIQUE pour idempotence imports : ne s'applique que sur external_id non-vide
-- (les messages internes Intralys n'ont pas d'external_id et ne doivent pas conflicter entre eux)
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id_unique
  ON messages(client_id, external_id)
  WHERE external_id IS NOT NULL AND external_id != '';

PRAGMA foreign_keys=ON;

-- ── Index lookup migration_id_map (Sprint 14 audit I-1) ─────
-- La UNIQUE constraint crée déjà un index, mais on ajoute un index optimisé pour
-- les SELECT fréquents (chaque conversation/opp/appointment fait un lookup).
CREATE INDEX IF NOT EXISTS idx_migration_idmap_lookup
  ON migration_id_map(client_id, intralys_resource, external_source, external_id);
