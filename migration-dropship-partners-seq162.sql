-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 162 — Sprint 67 Portail Fournisseurs & Dropshipping
--
-- Création de la table dropship_partners et liaison avec les utilisateurs et
-- les fournisseurs de dropshipping.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) dropship_partners — Partenaires grossistes/fournisseurs dropship ────
CREATE TABLE IF NOT EXISTS dropship_partners (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index pour accélérer le filtrage par client_id et statut (recherche dans l'UI/API)
CREATE INDEX IF NOT EXISTS idx_dropship_partners_client
  ON dropship_partners(client_id, status);

-- ── 2) ALTER users — Liaison utilisateur → partenaire dropship ──────────────
ALTER TABLE users ADD COLUMN dropship_partner_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_dropship_partner
  ON users(dropship_partner_id);

-- ── 3) ALTER dropship_suppliers — Liaison fournisseur → partenaire ─────────
ALTER TABLE dropship_suppliers ADD COLUMN dropship_partner_id TEXT;

CREATE INDEX IF NOT EXISTS idx_dropship_suppliers_partner
  ON dropship_suppliers(dropship_partner_id);
