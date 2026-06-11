-- Sprint E8 M1 — Omnicanal concurrent : canaux de vente + allocation stock par canal
-- (2026-05-16) — module B2.
--
-- Stratégie d'inventaire multi-canal SANS toucher au schéma existant :
--   - AUCUN ALTER sur products / product_variants / inventory / orders
--     (orders.source + orders.external_id existent déjà depuis E1 — pas de
--      ré-ALTER). Mode cloisonné géré par une table d'allocation SÉPARÉE.
--   - `intralys_master` (DÉFAUT) = délégation verbatim aux helpers stock E2
--     (reserveStock/commitSale/releaseStock) ⇒ toute boutique existante SANS
--     canal externe garde un comportement bit-pour-bit identique (régression-0).
--
-- Conventions strictes (alignées schema.sql / migration-sprintE1) :
--   id TEXT PK lower(hex(randomblob(16))), FK REFERENCES table(id),
--   timestamps TEXT DEFAULT (datetime('now')) — JAMAIS unixepoch,
--   money en cents (sans objet ici), multi-tenant strict via client_id.
--   config_ref = RÉFÉRENCE à un binding secret (ex 'SHOPIFY') — JAMAIS de
--   clé OAuth en clair stockée en base.
-- Exécution manuelle : npx wrangler d1 execute intralys-crm --file=migration-sprintE8-m1.sql --remote

-- ════════════════════════════════════════════════════════════
-- M1.1 — CANAUX DE VENTE (native / shopify / woo)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sales_channels (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL DEFAULT 'Canal',
  type TEXT CHECK (type IN ('native', 'shopify', 'woo')) DEFAULT 'native',
  inventory_strategy TEXT
    CHECK (inventory_strategy IN ('intralys_master', 'partitioned', 'shared_pool'))
    DEFAULT 'intralys_master',
  config_ref TEXT,                 -- réf binding secret (ex 'SHOPIFY' / 'WOO') — JAMAIS la clé OAuth
  shop_domain TEXT,                -- ex 'ma-boutique.myshopify.com'
  external_id TEXT,                -- id du canal côté plateforme (sync M2)
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sales_channels_client ON sales_channels(client_id);
CREATE INDEX IF NOT EXISTS idx_sales_channels_type ON sales_channels(type);
CREATE INDEX IF NOT EXISTS idx_sales_channels_active ON sales_channels(active);

-- ════════════════════════════════════════════════════════════
-- M1.2 — ALLOCATION STOCK PAR CANAL (mode 'partitioned')
-- ════════════════════════════════════════════════════════════
-- Stock cloisonné : chaque canal dispose d'un quota alloué par variante.
-- N'altère JAMAIS inventory.quantity/reserved (mode master/pool intacts).

CREATE TABLE IF NOT EXISTS channel_inventory_allocation (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  channel_id TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  allocated_qty INTEGER DEFAULT 0,    -- quota total alloué au canal pour cette variante
  reserved_qty INTEGER DEFAULT 0,     -- réservé (panier/commande en cours) sur ce quota
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(channel_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_chan_alloc_channel ON channel_inventory_allocation(channel_id);
CREATE INDEX IF NOT EXISTS idx_chan_alloc_variant ON channel_inventory_allocation(variant_id);
