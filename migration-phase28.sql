-- Migration Phase 28 - Security & Compliance (Phase D)

-- Enhance admin_sessions with tracking info
ALTER TABLE admin_sessions ADD COLUMN ip TEXT;
ALTER TABLE admin_sessions ADD COLUMN user_agent TEXT;
ALTER TABLE admin_sessions ADD COLUMN last_active_at TEXT;

-- 2FA Backup Codes
CREATE TABLE IF NOT EXISTS backup_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON backup_codes(user_id);
