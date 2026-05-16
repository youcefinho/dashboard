-- ── Migration Sprint E5 M2 — Fulfillment region-aware (zones & tarifs) ──────
-- (2026-05-16) Module Boutique B2. Additif / non destructif sur le schéma
-- E1/E3/E5-M1. ZÉRO double-ALTER : aucune colonne existante ré-ALTÉRÉE ici,
-- uniquement deux NOUVELLES tables (shipping_zones, shipping_rates).
--
-- Conventions strictes projet :
--   id TEXT DEFAULT (lower(hex(randomblob(16)))) — pas d'INTEGER applicatif.
--   created_at / updated_at TEXT DEFAULT (datetime('now')) — jamais unixepoch.
--   Money en cents INTEGER (price_cents / *_subtotal_cents).
--   Multi-tenant : client_id (1 scope/tenant), indexé.
--
-- Une zone d'expédition = regroupement géographique (liste de pays ISO
-- alpha-2). Un tarif est rattaché à une zone et porte un prix en cents +
-- un palier optionnel de déclenchement sur le sous-total du panier. La
-- résolution (POST /shipping/resolve) est region-aware via le pays du tenant
-- (resolveRegionContext E-R) + le sous-total commande. Aligné sur les types
-- canoniques M1 (types.ts) : ShippingZone / ShippingRate / ShippingRateResult.

-- Zones d'expédition : couverture géographique (pays ISO en JSON).
CREATE TABLE IF NOT EXISTS shipping_zones (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id      TEXT NOT NULL,
  name           TEXT NOT NULL,
  countries_json TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

-- Tarifs d'expédition : prix fixe en cents + palier optionnel de panier.
-- CASCADE sur la zone parente (suppression zone ⇒ ses tarifs disparaissent).
CREATE TABLE IF NOT EXISTS shipping_rates (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id          TEXT NOT NULL,
  zone_id            TEXT NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  price_cents        INTEGER NOT NULL DEFAULT 0,
  min_subtotal_cents INTEGER,
  max_subtotal_cents INTEGER,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shipping_zones_client ON shipping_zones(client_id);
CREATE INDEX IF NOT EXISTS idx_shipping_rates_client ON shipping_rates(client_id);
CREATE INDEX IF NOT EXISTS idx_shipping_rates_zone   ON shipping_rates(zone_id);
