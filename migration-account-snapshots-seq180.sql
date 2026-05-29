-- ── Sprint 85 (seq180) — Snapshots de Comptes (Configurations Portables) ──
--
-- Création de la table account_snapshots pour stocker en DB les instantanés de configuration
-- (pipelines, formulaires, templates, calendriers) d'un compte afin de permettre
-- sa duplication inter-sous-comptes en direct.

CREATE TABLE IF NOT EXISTS account_snapshots (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  config_blob TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_account_snapshots_client ON account_snapshots(client_id);
