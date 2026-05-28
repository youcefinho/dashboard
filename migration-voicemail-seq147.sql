-- Migration seq147 : Messagerie Vocale & Whisper
-- Ajout de la table voicemails pour stocker les messages vocaux des prospects.

CREATE TABLE IF NOT EXISTS voicemails (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  call_sid TEXT UNIQUE NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  audio_r2_key TEXT NOT NULL,
  duration INTEGER DEFAULT 0,
  transcript TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_voicemails_user ON voicemails(user_id);
CREATE INDEX IF NOT EXISTS idx_voicemails_created_at ON voicemails(created_at);
