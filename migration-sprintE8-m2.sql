-- Sprint E8 M2 — Omnicanal concurrent : mapping produits + journal de sync
-- (2026-05-16) — module B2.
--
-- Connecteurs Shopify / WooCommerce : table de correspondance des produits
-- (external_id ↔ variante interne) pour l'idempotence des imports, et un
-- journal de synchronisation servant à la fois de trace d'audit ET de
-- garde-fou anti-echo (skip d'un push sortant si l'event vient d'arriver
-- de la même plateforme pour le même external_id).
--
-- Conventions strictes (alignées schema.sql / migration-sprintE1 / E8-m1) :
--   id TEXT PK lower(hex(randomblob(16))), FK REFERENCES table(id),
--   timestamps TEXT DEFAULT (datetime('now')) — JAMAIS unixepoch,
--   money en cents (sans objet ici), multi-tenant strict via client_id.
--   AUCUN ALTER : orders.source / orders.external_id existent depuis E1
--   (réutilisés pour dédup commandes — pas de ré-ALTER). channel_product_map
--   porte la dédup produit ; orders.external_id (idx E1) porte la dédup
--   commande. Tables AUTONOMES, zéro impact sur le schéma existant ⇒
--   boutique sans canal externe = régression-zéro.
-- Exécution manuelle : npx wrangler d1 execute intralys-crm --file=migration-sprintE8-m2.sql --remote

-- ════════════════════════════════════════════════════════════
-- M2.1 — MAPPING PRODUITS CANAL ↔ VARIANTE INTERNE
-- ════════════════════════════════════════════════════════════
-- Correspondance bidirectionnelle : un produit/variante de la plateforme
-- externe (external_id) ↔ une product_variants interne. UNIQUE(channel_id,
-- external_id) garantit l'idempotence des imports (rejeu webhook = no-op).

CREATE TABLE IF NOT EXISTS channel_product_map (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  channel_id TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  internal_variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,         -- id produit/variante côté plateforme (Shopify/Woo)
  external_sku TEXT,                 -- SKU côté plateforme (réconciliation alternative)
  last_synced_at TEXT,               -- dernier import/push réussi pour ce mapping
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(channel_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_chan_prodmap_client ON channel_product_map(client_id);
CREATE INDEX IF NOT EXISTS idx_chan_prodmap_channel ON channel_product_map(channel_id);
CREATE INDEX IF NOT EXISTS idx_chan_prodmap_variant ON channel_product_map(internal_variant_id);
CREATE INDEX IF NOT EXISTS idx_chan_prodmap_extsku ON channel_product_map(external_sku);

-- ════════════════════════════════════════════════════════════
-- M2.2 — JOURNAL DE SYNCHRONISATION (trace + anti-echo)
-- ════════════════════════════════════════════════════════════
-- direction in  = event reçu de la plateforme (webhook / pull)
-- direction out = push initié par Intralys vers la plateforme
-- L'anti-echo lit les lignes `in` récentes pour un external_id donné afin de
-- NE PAS renvoyer (out) ce qu'on vient juste de recevoir (in) → pas de boucle.

CREATE TABLE IF NOT EXISTS channel_sync_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  channel_id TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  direction TEXT CHECK (direction IN ('in', 'out')) NOT NULL DEFAULT 'in',
  entity_type TEXT CHECK (entity_type IN ('product', 'order')) NOT NULL DEFAULT 'product',
  status TEXT CHECK (status IN ('ok', 'conflict', 'error')) NOT NULL DEFAULT 'ok',
  external_id TEXT,                  -- id de l'entité côté plateforme
  conflict_json TEXT,               -- détail (erreur / conflit) — JSON sérialisé
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chan_synclog_client ON channel_sync_log(client_id);
CREATE INDEX IF NOT EXISTS idx_chan_synclog_channel ON channel_sync_log(channel_id);
CREATE INDEX IF NOT EXISTS idx_chan_synclog_ext ON channel_sync_log(channel_id, external_id, created_at);
