-- Migration seq 160 (Sprint 65) — Gestion Multi-Entrepôts (Multi-Location Inventory)
CREATE TABLE IF NOT EXISTS location_stocks (
  location_id TEXT NOT NULL, -- Correspond à warehouses.id
  variant_id TEXT NOT NULL,  -- Correspond à product_variants.id
  client_id TEXT NOT NULL,   -- Cloisonnement locataires (defense-in-depth IDOR)
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (location_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_location_stocks_client ON location_stocks(client_id);
CREATE INDEX IF NOT EXISTS idx_location_stocks_variant ON location_stocks(variant_id);
