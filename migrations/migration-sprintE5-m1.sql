-- ── Migration Sprint E5 M1 — Fulfillment region-aware (expéditions) ─────────
-- (2026-05-16) Module Boutique B2. Additif / non destructif sur le schéma
-- E1/E3. ZÉRO double-ALTER : orders.shipping_cents (E1) et
-- orders.fulfillment_status (E1) existent déjà — NON ré-ALTÉRÉS ici.
--
-- Conventions strictes projet :
--   id TEXT DEFAULT (lower(hex(randomblob(16)))) — pas d'INTEGER applicatif.
--   created_at / updated_at TEXT DEFAULT (datetime('now')) — jamais unixepoch.
--   Money en cents INTEGER (non pertinent ici : shipment = trace pure).
--   Multi-tenant : shipments.client_id (1 scope/tenant), indexé.
--
-- Une expédition (shipment) = TRACE PURE d'un envoi (total ou partiel) d'une
-- commande. Elle NE touche JAMAIS le stock (déjà concrétisé au `paid` E3).
-- Le recalcul déterministe de orders.fulfillment_status (E1) se fait côté
-- handler (SUM(shipment_items.quantity) vs SUM(order_items.quantity)).

-- Expéditions : machine d'états propre au shipment (≠ machine commande E3).
CREATE TABLE IF NOT EXISTS shipments (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id       TEXT NOT NULL,
  order_id        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'preparing'
                  CHECK (status IN ('preparing','shipped','in_transit','delivered','failed')),
  carrier         TEXT,
  tracking_number TEXT,
  tracking_url    TEXT,
  shipped_at      TEXT,
  delivered_at    TEXT,
  note            TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- Lignes expédiées (quel order_item, quelle quantité). CASCADE sur le
-- shipment parent ; rattachement à la ligne de commande d'origine.
CREATE TABLE IF NOT EXISTS shipment_items (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  shipment_id   TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL REFERENCES order_items(id),
  quantity      INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shipments_order  ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_client ON shipments(client_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON shipment_items(shipment_id);
