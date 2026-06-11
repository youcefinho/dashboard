-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 142 — Sprint 47 Multi-warehouse + Dropshipping — Phase A SOLO
-- (Manager-A) — 2026-05-25
--
-- EXTENSION CHIRURGICALE du schéma e-commerce S(E1) (seq58). Ce lot pose deux
-- mécaniques distinctes mais complémentaires sur le pipeline order/inventory :
--
--   1) Multi-warehouse — Stock physique réparti sur plusieurs lieux (entrepôts,
--      stores, dépôts). Une table `warehouses` (id PK + client_id + name +
--      adresse + flags actif/défaut) + une colonne nullable `warehouse_id` sur
--      `inventory` (seq58) permettant de mapper la ligne de stock au lieu sans
--      casser la lecture legacy (`location` TEXT reste). Transferts entre
--      lieux : table `inventory_transfers` (statut enum HANDLER).
--
--   2) Dropshipping fournisseurs — Catalogue routé chez un supplier externe
--      (CSV import + auto-routing order). Tables `dropship_suppliers` (config
--      + flag actif), `dropship_routings` (variant → supplier mapping UNIQUE),
--      `dropship_orders` (orders dispatchés au supplier + tracking_number).
--      api_key_encrypted via TOKEN_KEY HMAC HANDLER (jamais en clair en DB).
--      Flag `is_active` permet de désactiver un supplier sans le supprimer.
--
-- depends_on (manifest) :
--   - migration-subscriptions-advanced-seq141.sql (chaînage SÉQUENTIEL manifest)
--   - migration-sprintE1-m1-ecommerce-schema.sql  (inventory + product_variants
--                                                  + orders + order_items)
--
-- ⚠ 100% STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une contrainte existante. Ce lot N'AJOUTE QUE :
--     - 5 `CREATE TABLE IF NOT EXISTS` neuves   (warehouses, inventory_transfers,
--                                                dropship_suppliers,
--                                                dropship_routings,
--                                                dropship_orders)
--     - 1 `ALTER TABLE inventory ADD COLUMN warehouse_id` (nullable safe)
--     - 6 `CREATE INDEX IF NOT EXISTS` neufs    (idempotents — 5 lookup + 1 UNIQUE)
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Les
--   jointures warehouse_id / variant_id / supplier_id / order_id sont
--   APPLICATIVES, par colonne TEXT. PAS de CHECK SQL (additif pur — enums
--   transfer.status / dropship_orders.status validés HANDLER, pas SQL).
--
-- Capabilities FIGÉES (AUCUN ajout à ALL_CAPABILITIES seq 80) :
--   - clients.manage : warehouses (CRUD + default), inventory_transfers (CRUD
--                      + complete), dropship_routings (CRUD), dropship_orders
--                      (list + route)
--   - settings.manage : dropship_suppliers (CRUD admin — secrets api_key) +
--                       import-csv (catalogue brut, surface admin)
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent. `ALTER TABLE ADD COLUMN`
--   n'est PAS nativement IF NOT EXISTS dans SQLite — si rejoué après succès,
--   le runner (scripts/migrate.ts) absorbe l'erreur "duplicate column name"
--   (calque ALTER seq 79 / seq 80 / seq 140 / seq 141).
--
-- Conventions (calque seq 141 / seq 120) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT DEFAULT
--   (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement, PAS de FK.
--   Money en cents INTEGER, devise locked 'CAD' V1. Multi-tenant : client_id
--   sur TOUTES les tables tenant-scopées (defense-in-depth IDOR — bornage
--   WHERE client_id = ? au HANDLER).
--
-- Flag supplier_api : si `api_endpoint` NULL ou vide ⇒ supplier en mode
--   "manuel" (HANDLER notifySupplier retourne sent:false + reason:'no_endpoint').
--   Activation tenant-by-tenant via UPDATE dropship_suppliers (cap settings.manage).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-warehouse-dropship-seq142.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) warehouses — Lieux physiques de stock ──────────────────────────────
-- Tenant-scoped (client_id NOT NULL). `is_default = 1` désigne le warehouse
-- par défaut au routing order (1 seul par client — unicité applicative
-- HANDLER, pas UNIQUE SQL pour permettre transitions). Désactivation soft
-- via is_active = 0 (pas de DELETE destructif côté handler — cf. Phase B).
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  country TEXT,
  country_subdiv TEXT,
  is_active INTEGER DEFAULT 1,
  is_default INTEGER DEFAULT 0,
  contact_email TEXT,
  contact_phone TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── 2) inventory_transfers — Transferts inter-warehouse ───────────────────
-- Statut enum HANDLER (whitelist verrouillée warehouse-engine.ts) :
--   pending | in_transit | completed | cancelled
-- Lifecycle : pending (créé) → in_transit (transporteur en route, optionnel)
--           → completed (executeTransfer applique le delta sur inventory)
--           → cancelled (rollback avant completed possible).
-- completed_at NULL tant que pas exécuté (executeTransfer set datetime('now')).
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  from_warehouse_id TEXT NOT NULL,
  to_warehouse_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_by_user_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- ── 3) dropship_suppliers — Configs fournisseurs dropshipping ─────────────
-- Secrets : `api_key_encrypted` stocké HMAC via TOKEN_KEY (cf. lib/crypto.ts
-- + secret-store.ts — calque integration_secrets seq75). JAMAIS en clair.
-- `csv_format_json` : mapping colonnes CSV → champs internes (JSON HANDLER).
--   Ex : {"sku":"SKU","name":"PRODUCT","cost":"COST_CENTS","stock":"QTY"}.
-- `default_shipping_cost_cents` : appliqué si pas d'override par routing.
CREATE TABLE IF NOT EXISTS dropship_suppliers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  api_endpoint TEXT,
  api_key_encrypted TEXT,
  csv_format_json TEXT,
  contact_email TEXT,
  default_shipping_cost_cents INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── 4) dropship_routings — Mapping variant → supplier ─────────────────────
-- Une variante peut être routée à 1 seul supplier (UNIQUE applicative et SQL).
-- `auto_route = 1` ⇒ routeOrderItems dispatche automatiquement à ce supplier
-- au moment du paiement. `auto_route = 0` ⇒ ligne créée à la main (Phase B).
-- `supplier_sku` : référence interne supplier (peut différer du variant.sku).
-- `cost_cents` : coût unitaire d'approvisionnement (override sur supplier
--                default si présent). Margin calc HANDLER (variant.price - cost).
CREATE TABLE IF NOT EXISTS dropship_routings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  auto_route INTEGER DEFAULT 1,
  supplier_sku TEXT,
  cost_cents INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── 5) dropship_orders — Orders dispatchés au supplier ────────────────────
-- Trace tous les orders e-commerce où routeOrderItems a INSERT une ligne
-- (1 ligne par supplier × order — Phase B regroupera les items par supplier).
-- Statut enum HANDLER (whitelist verrouillée warehouse-engine.ts) :
--   pending | sent | confirmed | shipped | delivered | failed
-- supplier_order_ref : référence retournée par le supplier (API ou manuel).
-- tracking_number : numéro de tracking transporteur (Phase B webhook update).
CREATE TABLE IF NOT EXISTS dropship_orders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  order_id TEXT,
  supplier_id TEXT,
  supplier_order_ref TEXT,
  status TEXT DEFAULT 'pending',
  tracking_number TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── 6) ALTER inventory — Ajout warehouse_id nullable ──────────────────────
-- Colonne ADDITIVE : `location` TEXT (seq58) reste pour rétro-compat lecture
-- legacy. `warehouse_id` TEXT nullable pointe vers warehouses.id (jointure
-- applicative HANDLER, pas FK). Migration de `location` → `warehouse_id`
-- via script séparé Phase B (best-effort, ne casse pas la lecture si NULL).
ALTER TABLE inventory ADD COLUMN warehouse_id TEXT;

-- ── Index ADDITIFs idempotents ─────────────────────────────────────────────

-- Lookup warehouses actifs pour un client (UI ListWarehouses + routing engine).
CREATE INDEX IF NOT EXISTS idx_warehouses_client
  ON warehouses(client_id, is_active);

-- Lookup transfers récents tenant-wide trié par statut+date (UI inbox + cron
-- nettoyage transfers stale).
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_client_status
  ON inventory_transfers(client_id, status, created_at);

-- Lookup suppliers actifs pour un client (UI ListSuppliers + routing engine).
CREATE INDEX IF NOT EXISTS idx_dropship_suppliers_client
  ON dropship_suppliers(client_id, is_active);

-- UNIQUE routing — 1 supplier max par variant×client (enforce SQL +
-- HANDLER fail-fast sur duplicate).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dropship_routings_variant
  ON dropship_routings(client_id, variant_id);

-- Lookup dropship orders par order_id (UI OrderDetail → "Dispatché chez X").
CREATE INDEX IF NOT EXISTS idx_dropship_orders_order
  ON dropship_orders(order_id);

-- Lookup dropship orders par supplier+statut (UI SupplierDashboard +
-- cron retry sur pending/failed).
CREATE INDEX IF NOT EXISTS idx_dropship_orders_supplier_status
  ON dropship_orders(supplier_id, status);

-- NB : 5 tables NEUVES (warehouses, inventory_transfers, dropship_suppliers,
-- dropship_routings, dropship_orders), 1 ALTER additif (inventory.warehouse_id),
-- 6 INDEX NEUFS (5 lookup + 1 UNIQUE routing). AUCUNE FK, AUCUN CHECK, AUCUN
-- DROP / RENAME / rebuild. NE TOUCHE PAS aux handlers ecommerce-*.ts existants
-- (Sprint E1+) — handlers NEUFS dans warehouse-dropship.ts + lib/warehouse-engine.ts.
-- Capabilities FIGÉES : clients.manage (warehouses/transfers/routings/dropship_orders)
-- + settings.manage (dropship_suppliers admin). AUCUN ajout ALL_CAPABILITIES seq 80.
-- api_key_encrypted via TOKEN_KEY HMAC HANDLER (jamais en clair). supplier_api
-- INACTIF par défaut (api_endpoint NULL ⇒ notifySupplier retourne sent:false).
-- i18n parité STRICTE 4 catalogues (en, fr-CA, fr-FR, es). Choix figés
-- docs/LOT-WAREHOUSE-DROPSHIP-S47.md §6.
