-- Migration Phase 5 — Auth, notifications, tasks, audit
-- Run: bun wrangler d1 execute intralys-crm --local --file=migration-phase5.sql

-- Audit log admin (traçabilité)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT DEFAULT '{}',
  ip TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);

-- Notifications réelles
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  client_id TEXT,
  icon TEXT DEFAULT '🔔',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  link TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(user_id, is_read);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date TEXT,
  priority TEXT CHECK (priority IN ('high','medium','low')) DEFAULT 'medium',
  status TEXT CHECK (status IN ('todo','in_progress','done')) DEFAULT 'todo',
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  client_id TEXT,
  assigned_to TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks(lead_id);

-- 2FA (TOTP) - colonnes optionnelles sur users
ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
