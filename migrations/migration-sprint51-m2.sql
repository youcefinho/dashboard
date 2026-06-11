-- ════════════════════════════════════════════════════════════════════
-- Sprint 51 M2 — Connecteur entrant générique (2026-05-16)
-- Tokens par source + moteur de mapping + dédoublonnage unifié + consentement
-- Idempotent : CREATE IF NOT EXISTS / ALTER tolérant (exécuter ligne par ligne)
-- ════════════════════════════════════════════════════════════════════

-- ── Table sources de leads (un token d'ingestion par source/client) ──
CREATE TABLE IF NOT EXISTS lead_sources (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_key TEXT NOT NULL,                 -- slug utilisé dans leads.source (ex: 'facebook-ads')
  token TEXT NOT NULL UNIQUE,               -- secret d'ingestion (crypto, fort)
  type TEXT NOT NULL DEFAULT 'webhook',     -- webhook | zapier | custom
  mapping_json TEXT,                        -- mapping perso JSON (nullable = mapping par défaut)
  dedup_strategy TEXT NOT NULL DEFAULT 'email_phone', -- email | phone | email_phone | none
  consent_default TEXT NOT NULL DEFAULT 'unknown',    -- granted | unknown | denied
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  last_received_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_sources_token ON lead_sources(token);
CREATE INDEX IF NOT EXISTS idx_lead_sources_client ON lead_sources(client_id);

-- ── Attribution additionnelle sur leads (utm_source/medium/campaign existent déjà via migration-phase1.sql) ──
-- ALTER additif nullable : exécuter individuellement, ignorer "duplicate column" si déjà présent.
ALTER TABLE leads ADD COLUMN utm_term TEXT DEFAULT '';
ALTER TABLE leads ADD COLUMN utm_content TEXT DEFAULT '';
ALTER TABLE leads ADD COLUMN gclid TEXT DEFAULT '';
ALTER TABLE leads ADD COLUMN fbclid TEXT DEFAULT '';
ALTER TABLE leads ADD COLUMN referrer TEXT DEFAULT '';

-- ── Statut de consentement à la source (Loi 25 / CASL) ──
-- granted = consentement explicite capturé · unknown = source marketing sans preuve · denied = opt-out
ALTER TABLE leads ADD COLUMN consent_status TEXT DEFAULT 'unknown';

-- ── Source d'origine traçable (réutilise external_id/migrated_from de migration-phase10) ──
-- (lead_source_id permet de relier un lead à sa source d'ingestion configurée)
ALTER TABLE leads ADD COLUMN lead_source_id TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_lead_source ON leads(lead_source_id);
