-- ── Sprint E6 M1 — Remboursements (refunds) e-commerce (2026-05-16) ─────────
--
-- Table du pont REMBOURSEMENT marchand e-commerce (B2). DISTINCT de billing.ts
-- (abo SaaS Intralys) et des Invoices/CRM — ne JAMAIS confondre / fusionner.
--
-- ⚠️ ZONE RÉGULÉE — revue Rochdi requise (frontière remboursement / fonds).
-- Inoffensif tant que payment_provider_config.payments_live_enabled=0 (sandbox :
-- Stripe forcé sur clé sk_test_ via le garde-fou resolveStripeSecret existant).
--
-- PCI : ZÉRO colonne carte (PAN/CVV/expiry/track). Le remboursement est 100 %
-- côté provider — seules des RÉFÉRENCES opaques (provider_ref) transitent ici.
--
-- Conventions strictes projet :
--   - id TEXT DEFAULT (lower(hex(randomblob(16)))) — PAS d'unixepoch.
--   - timestamps TEXT DEFAULT (datetime('now')).
--   - Money en cents INTEGER.
--   - Multi-tenant : client_id sur la table (toute requête tenant-scopée).
--   - Additif / non destructif : AUCUN ALTER sur `orders` (financial_status /
--     refunded / partially_refunded existent depuis E1 — recordRefundTransition
--     pose financial_status par UPDATE ciblé, PAS d'ALTER ici).
--   - ZÉRO double-ALTER : aucune colonne existante ré-ajoutée.

-- ── refunds — un remboursement (total/partiel) par (order, montant, seq) ─────
-- idempotency_key déterministe `refund:<order>:<amount>:<seq>` →
-- UNIQUE(client_id, idempotency_key) = garde anti double-remboursement
-- (INSERT OR IGNORE + relecture, même pattern que payments à l'init).
CREATE TABLE IF NOT EXISTS refunds (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id       TEXT NOT NULL,
  order_id        TEXT NOT NULL,
  payment_id      TEXT NOT NULL,            -- ligne payments source (réf interne)
  amount_cents    INTEGER NOT NULL,
  currency        TEXT NOT NULL,            -- 'CAD' | 'EUR' | 'DZD'
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'succeeded'|'failed'
  provider_ref    TEXT,                     -- référence opaque provider (PAS de carte)
  idempotency_key TEXT NOT NULL,
  reason          TEXT,                     -- motif libre (non sensible)
  restocked       INTEGER NOT NULL DEFAULT 0, -- 1 = remise en stock déjà faite (anti double-restock)
  created_by      TEXT,                     -- userId à l'origine (audit)
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE (client_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds (client_id, order_id);
