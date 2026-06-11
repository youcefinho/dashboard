-- Sprint 92 (seq187) — Colonnes chiffrées + index de recherche blind
-- Stratégie dual-write : les colonnes en clair restent pendant la migration progressive.
-- Phase 2 (Sprint 93) : les colonnes en clair seront vidées.

-- Leads : champs PII chiffrés
ALTER TABLE leads ADD COLUMN email_enc TEXT;
ALTER TABLE leads ADD COLUMN phone_enc TEXT;
ALTER TABLE leads ADD COLUMN notes_enc TEXT;

-- Leads : hash de recherche blind (HMAC-SHA256)
ALTER TABLE leads ADD COLUMN email_hash TEXT;
ALTER TABLE leads ADD COLUMN phone_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_email_hash ON leads(email_hash);
CREATE INDEX IF NOT EXISTS idx_leads_phone_hash ON leads(phone_hash);

-- Messages : body chiffré
ALTER TABLE messages ADD COLUMN body_enc TEXT;
