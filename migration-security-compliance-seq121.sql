-- ── Sprint 23 — Sécurité / conformité — seq121 (2026-05-22) ─────────────────
-- 100% additif : ALTER … ADD COLUMN nullable + CREATE TABLE IF NOT EXISTS.
-- AUCUN CHECK modifié, aucune capability ajoutée (ALL_CAPABILITIES seq80 figées).

-- 1) rate_limit_buckets — sliding window D1 fallback (pas de KV requis).
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  bucket_key  TEXT NOT NULL,
  hit_at      TEXT NOT NULL DEFAULT (datetime('now')),
  meta        TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_rl_buckets_key_time
  ON rate_limit_buckets(bucket_key, hit_at);

-- 2) audit_log enrichi (additif nullable).
ALTER TABLE audit_log ADD COLUMN request_id TEXT;
ALTER TABLE audit_log ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_log ADD COLUMN redacted INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

-- 3) cookie_consent_log — anonyme ou user_id si connecté.
CREATE TABLE IF NOT EXISTS cookie_consent_log (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  anonymous_id    TEXT,
  user_id         TEXT,
  categories      TEXT NOT NULL,
  policy_version  TEXT NOT NULL DEFAULT '1.0',
  ip              TEXT DEFAULT '',
  user_agent      TEXT DEFAULT '',
  url             TEXT DEFAULT '',
  granted_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_anon ON cookie_consent_log(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_user ON cookie_consent_log(user_id);

-- 4) account_deletion_requests — soft-delete avec délai 30j (Loi 25).
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT NOT NULL,
  reason          TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending',
  requested_at    TEXT DEFAULT (datetime('now')),
  scheduled_for   TEXT NOT NULL,
  executed_at     TEXT,
  ip              TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_acct_del_user ON account_deletion_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_acct_del_status ON account_deletion_requests(status, scheduled_for);

-- 5) data_export_requests — trace des exports utilisateurs.
CREATE TABLE IF NOT EXISTS data_export_requests (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL,
  ip          TEXT DEFAULT '',
  user_agent  TEXT DEFAULT '',
  bytes       INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_data_export_user ON data_export_requests(user_id, created_at);
