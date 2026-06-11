-- Sprint 8: Phase 32 Migration
-- Settings, User Preferences, API Keys, Webhooks, Security

-- 1. Enrichir Audit Log (Commenté car la colonne existe peut-être déjà)
-- ALTER TABLE audit_log ADD COLUMN ip TEXT;
-- ALTER TABLE audit_log ADD COLUMN user_agent TEXT;

-- 2. User preferences globales
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  notification_preferences_json TEXT DEFAULT '{}',
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  weekly_digest INTEGER DEFAULT 1,
  ui_density TEXT DEFAULT 'comfortable',
  language TEXT DEFAULT 'fr'
);

-- 3. API keys per client
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT DEFAULT 'read',
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 4. Webhooks OUT registry
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  secret TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  last_triggered_at TEXT,
  fail_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 5. 2FA Backup codes (supprimé car géré par backup_codes de la phase 28)
DROP TABLE IF EXISTS totp_backup_codes;

-- 6. Enrichir Sessions (si pas déjà fait)
-- ALTER TABLE admin_sessions ADD COLUMN device_info TEXT;
-- ALTER TABLE admin_sessions ADD COLUMN ip TEXT;
-- Note: SQLite ALTER TABLE ADD COLUMN ne permet pas toujours IF NOT EXISTS proprement sans pragma.
-- Pour un script de dev, on va utiliser une astuce ou simplement l'exécuter si on sait qu'elles n'existent pas.
