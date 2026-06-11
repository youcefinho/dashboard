-- Migration seq 151 — Sprint 59 Notifications Push Mobile (FCM & APNS)
--
-- Création de la table user_push_tokens pour stocker les tokens FCM/APNS
-- des terminaux mobiles Capacitor. Pas de FK réelles selon les standards D1.
-- Jointures applicatives.

CREATE TABLE IF NOT EXISTS user_push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  token TEXT,
  platform TEXT,
  device_id TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_push_tokens_device ON user_push_tokens(device_id);
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user ON user_push_tokens(user_id);
