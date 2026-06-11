-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 163 — Sprint 68 B2B pricing & Customer groups fallback
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_groups (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT,
  description TEXT,
  default_discount_pct REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_group_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  assigned_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS tier_prices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_variant_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  min_quantity INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_groups_client
  ON customer_groups(client_id, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_group_assignments
  ON customer_group_assignments(group_id, customer_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tier_prices_variant_group_qty
  ON tier_prices(product_variant_id, group_id, min_quantity);
