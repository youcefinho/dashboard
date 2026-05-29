-- ── Sprint 93 (seq188) — Purge RGPD & Loi 25 Automatisée ──
--

CREATE TABLE IF NOT EXISTS privacy_purge_rules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  inactive_days INTEGER NOT NULL DEFAULT 365,
  action TEXT NOT NULL DEFAULT 'delete' CHECK (action IN ('delete', 'anonymize')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
