-- Migration P3.10: Mobile Prep (soft delete, push notifications, API keys)

-- Soft delete on leads
ALTER TABLE leads ADD COLUMN deleted_at TEXT;

-- Device tokens pour push notifications (FCM)
CREATE TABLE device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT DEFAULT 'web', -- web, ios, android
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API keys pour accès programmatique / mobile
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
