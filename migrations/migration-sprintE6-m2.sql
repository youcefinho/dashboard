-- ── Sprint E6 M2 — Litiges (disputes) + RMA / retours (2026-05-16) ──────────
--
-- Tables du pont LITIGE / RETOUR marchand e-commerce (B2). DISTINCT de
-- billing.ts (abo SaaS Intralys) et des Invoices/CRM — ne JAMAIS confondre.
--
-- ⚠️ ZONE RÉGULÉE — revue Rochdi requise (frontière litige / chargeback /
-- remboursement). Un webhook dispute est UN ENREGISTREMENT DB seulement : il ne
-- déclenche AUCUN mouvement de fonds (revue Rochdi requise avant tout impact
-- financier réel). Inoffensif tant que payment_provider_config
-- .payments_live_enabled=0 (Stripe forcé sk_test_ via resolveStripeSecret).
--
-- PCI : ZÉRO colonne carte (PAN/CVV/expiry/track). Seules des RÉFÉRENCES
-- opaques (provider_dispute_ref) transitent ici.
--
-- Conventions strictes projet :
--   - id TEXT DEFAULT (lower(hex(randomblob(16)))) — PAS d'unixepoch.
--   - timestamps TEXT DEFAULT (datetime('now')).
--   - Money en cents INTEGER.
--   - Multi-tenant : client_id sur la table (toute requête tenant-scopée).
--   - Additif / non destructif : AUCUN ALTER sur orders/refunds/payments
--     (le pont financial_status reste piloté par recordRefundTransition M1 —
--     UPDATE ciblé, PAS d'ALTER ici).
--   - ZÉRO double-ALTER : aucune colonne existante ré-ajoutée.

-- ── disputes — litige / chargeback provider (enregistrement DB seulement) ────
-- UNIQUE(provider, provider_dispute_ref) = anti-rejeu du webhook dispute
-- (INSERT OR IGNORE + relecture, même pattern que payment_events à l'init).
-- AUCUN mouvement de fonds n'est déclenché par l'insertion (régulé).
CREATE TABLE IF NOT EXISTS disputes (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id            TEXT NOT NULL,
  order_id             TEXT NOT NULL,
  payment_id           TEXT,                   -- ligne payments source (réf interne, si résolue)
  provider             TEXT NOT NULL,          -- 'stripe' | 'cod' | 'dz_gateway'
  provider_dispute_ref TEXT NOT NULL,          -- réf opaque litige provider (PAS de carte)
  status               TEXT NOT NULL DEFAULT 'open', -- 'open'|'under_review'|'won'|'lost'|'refunded'
  amount_cents         INTEGER NOT NULL DEFAULT 0,
  evidence_json        TEXT,                   -- preuves soumises (non sensible — réfs/notes)
  created_at           TEXT DEFAULT (datetime('now')),
  updated_at           TEXT DEFAULT (datetime('now')),
  UNIQUE (provider, provider_dispute_ref)
);
CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes (client_id, order_id);

-- ── return_requests — demande de retour (RMA) cycle dédié ────────────────────
-- Machine PROPRE au RMA, DISTINCTE de la machine commande E3 et du shipment E5 :
--   pending → approved → received → refunded   (rejected possible avant received)
-- Le remboursement N'EST déclenché QU'À `received` (anti-abus : jamais à la
-- demande), via la logique refund M1 réutilisée (recordRefundTransition).
-- region_snapshot fige le contexte région (resolveRegionContext E-R) au moment
-- de la demande (traçabilité — politique conso applicable, ressort M3).
CREATE TABLE IF NOT EXISTS return_requests (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id       TEXT NOT NULL,
  order_id        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'approved'|'received'|'refunded'|'rejected'
  reason          TEXT,                     -- motif libre (non sensible)
  region_snapshot TEXT,                     -- JSON RegionContext figé à la demande
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_return_requests_order ON return_requests (client_id, order_id);

-- ── rma_items — lignes d'une demande de retour (article + quantité) ──────────
-- ON DELETE CASCADE : supprimer la demande purge ses lignes (intégrité).
-- restock = intention de remise en stock à la réception (consommé par la
-- logique refund M1, qui est elle-même idempotente / anti double-restock).
CREATE TABLE IF NOT EXISTS rma_items (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_request_id TEXT NOT NULL REFERENCES return_requests (id) ON DELETE CASCADE,
  order_item_id     TEXT NOT NULL,
  quantity          INTEGER NOT NULL DEFAULT 1,
  restock           INTEGER NOT NULL DEFAULT 0, -- 1 = remettre en stock à la réception
  created_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rma_items_request ON rma_items (return_request_id);
