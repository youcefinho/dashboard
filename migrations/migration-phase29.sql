-- Migration Phase 29 - Notifications & Profil (Phase E)

-- Préférences de notifications
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'push', 'in_app')),
  event_type TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, channel, event_type)
);

-- Signatures d'email
ALTER TABLE users ADD COLUMN email_signature TEXT DEFAULT '';
