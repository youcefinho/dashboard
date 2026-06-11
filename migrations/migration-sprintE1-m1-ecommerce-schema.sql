-- Sprint E1 M1 — Fondation schéma e-commerce (2026-05-16) — module B2
-- Modèle B2 : Intralys EST la boutique (paiement marchand plus tard).
-- 2 univers parallèles : entités e-commerce dédiées, AUCUNE fusion dans `leads`.
-- Lien faible : customers.lead_id nullable (réconciliation acheteur↔lead CRM, Sprint 51 dedup).
-- Conventions alignées sur schema.sql : id TEXT PK lower(hex(randomblob(16))),
-- FK REFERENCES table(id), timestamps TEXT DEFAULT (datetime('now')),
-- money en cents INTEGER (jamais de float), multi-tenant strict via client_id.
-- Exécution manuelle : npx wrangler d1 execute intralys-crm --file=migration-sprintE1-m1-ecommerce-schema.sql --remote

-- ════════════════════════════════════════════════════════════
-- M1.1 — CATALOGUE PRODUITS
-- ════════════════════════════════════════════════════════════

-- Produits (multi-tenant : un produit appartient à un client/tenant)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT CHECK (status IN ('draft', 'active', 'archived')) DEFAULT 'draft',
  product_type TEXT DEFAULT '',
  vendor TEXT DEFAULT '',
  base_price INTEGER DEFAULT 0,            -- cents
  currency TEXT DEFAULT 'CAD',
  tax_class TEXT DEFAULT 'standard',
  seo_title TEXT DEFAULT '',
  seo_description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_products_client ON products(client_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);

-- Catégories / collections (hiérarchie via parent_id)
CREATE TABLE IF NOT EXISTS product_categories (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  parent_id TEXT REFERENCES product_categories(id),
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_client ON product_categories(client_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_parent ON product_categories(parent_id);

-- Jointure produit ↔ catégorie (N:N)
CREATE TABLE IF NOT EXISTS product_category_links (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (product_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_pcl_category ON product_category_links(category_id);

-- Variantes (ex "Rouge / L")
CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT,
  title TEXT NOT NULL,
  price_override INTEGER,                  -- cents nullable (sinon products.base_price)
  options_json TEXT DEFAULT '{}',          -- ex {"color":"Rouge","size":"L"}
  barcode TEXT,
  weight_grams INTEGER,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku);

-- Images (rattachées au produit, optionnellement à une variante)
CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  alt TEXT DEFAULT '',
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

-- ════════════════════════════════════════════════════════════
-- M1.2 — INVENTAIRE + CUSTOMERS
-- ════════════════════════════════════════════════════════════

-- Stock par variante (1:1 avec product_variants)
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  variant_id TEXT NOT NULL UNIQUE REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 0,
  reserved INTEGER DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 5,
  track_inventory INTEGER DEFAULT 1,
  allow_backorder INTEGER DEFAULT 0,
  location TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_variant ON inventory(variant_id);

-- Mouvements de stock (audit trail)
CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,                  -- + restock / - sale
  reason TEXT CHECK (reason IN ('sale', 'restock', 'adjustment', 'return', 'reservation')) DEFAULT 'adjustment',
  reference_type TEXT,                     -- ex 'order'
  reference_id TEXT,
  note TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant ON inventory_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(created_at);

-- Acheteurs finaux (≠ leads CRM ≠ clients tenant). lead_id = lien faible réconciliation.
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  phone TEXT,
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  accepts_marketing INTEGER DEFAULT 0,
  total_spent_cents INTEGER DEFAULT 0,
  orders_count INTEGER DEFAULT 0,
  avg_order_value_cents INTEGER DEFAULT 0,
  first_order_at TEXT,
  last_order_at TEXT,
  rfm_segment TEXT,
  tags_json TEXT,
  default_address_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id, email)
);

CREATE INDEX IF NOT EXISTS idx_customers_client ON customers(client_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_lead ON customers(lead_id);

-- ════════════════════════════════════════════════════════════
-- M1.3 — COMMANDES + PANIER
-- ════════════════════════════════════════════════════════════

-- Commandes (statut commande dédié, distinct du pipeline de vente lead)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  customer_id TEXT REFERENCES customers(id),     -- nullable : guest checkout
  order_number TEXT,                             -- séquentiel lisible par client, ex "#1001"
  status TEXT CHECK (status IN ('pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded')) DEFAULT 'pending',
  financial_status TEXT CHECK (financial_status IN ('unpaid', 'paid', 'partially_refunded', 'refunded')) DEFAULT 'unpaid',
  fulfillment_status TEXT CHECK (fulfillment_status IN ('unfulfilled', 'partial', 'fulfilled')) DEFAULT 'unfulfilled',
  subtotal_cents INTEGER DEFAULT 0,
  tps_cents INTEGER DEFAULT 0,                    -- TPS QC (5%)
  tvq_cents INTEGER DEFAULT 0,                    -- TVQ QC (9.975%) — combiné 14.975%
  shipping_cents INTEGER DEFAULT 0,
  discount_cents INTEGER DEFAULT 0,
  total_cents INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'CAD',
  email TEXT DEFAULT '',
  shipping_address_json TEXT,
  billing_address_json TEXT,
  note TEXT DEFAULT '',
  source TEXT DEFAULT 'web',                      -- web/shopify/woo/manual
  external_id TEXT,                               -- sync plateformes
  placed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_external_id ON orders(external_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

-- Lignes de commande (snapshots figés au moment de l'achat)
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  product_title_snapshot TEXT DEFAULT '',
  variant_title_snapshot TEXT DEFAULT '',
  sku_snapshot TEXT DEFAULT '',
  unit_price_cents INTEGER DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  total_cents INTEGER DEFAULT 0,
  tax_cents INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Paniers (session anonyme via token, abandon/recovery tracking)
CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  customer_id TEXT REFERENCES customers(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT CHECK (status IN ('active', 'abandoned', 'converted')) DEFAULT 'active',
  abandoned_at TEXT,
  recovered_at TEXT,
  currency TEXT DEFAULT 'CAD',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_carts_client ON carts(client_id);
CREATE INDEX IF NOT EXISTS idx_carts_token ON carts(token);
CREATE INDEX IF NOT EXISTS idx_carts_status ON carts(status);

-- Lignes de panier
CREATE TABLE IF NOT EXISTS cart_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity INTEGER DEFAULT 1,
  added_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
