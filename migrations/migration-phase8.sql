-- ═══════════════════════════════════════════════════════════
-- Migration Phase 8 — Conformité QC (CASL + Loi 25 + AMF)
-- ═══════════════════════════════════════════════════════════

-- Table des désabonnements (CASL compliance)
CREATE TABLE IF NOT EXISTS unsubscribes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT,
  phone TEXT,
  channel TEXT CHECK (channel IN ('email','sms','all')) DEFAULT 'all',
  reason TEXT DEFAULT '',
  client_id TEXT DEFAULT '',
  unsubscribed_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_unsub_email ON unsubscribes(email);
CREATE INDEX IF NOT EXISTS idx_unsub_phone ON unsubscribes(phone);
CREATE INDEX IF NOT EXISTS idx_unsub_client ON unsubscribes(client_id);

-- Table de consentement (Loi 25 Québec / preuve juridique)
CREATE TABLE IF NOT EXISTS consent_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL,
  consent_type TEXT NOT NULL,
  granted INTEGER DEFAULT 0,
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  granted_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consent_lead ON consent_log(lead_id);

-- Colonnes AMF sur clients
-- ALTER TABLE clients ADD COLUMN amf_certificate TEXT DEFAULT '';
-- ALTER TABLE clients ADD COLUMN amf_disclaimer_required INTEGER DEFAULT 0;
-- Note: Exécuter ces ALTER TABLE séparément si la table existe déjà
