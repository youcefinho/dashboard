-- Migration Phase 36 : Device tokens pour push notifications
-- Sprint 11 — Capacitor V1

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK(platform IN ('ios', 'android', 'web')),
  created_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token);
