-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 143 — Sprint 48 B2B wholesale + Bundles + Pre-orders — Phase A SOLO
-- (Manager-A) — 2026-05-25
--
-- EXTENSION CHIRURGICALE du schéma e-commerce S(E1) (seq58). Trois mécaniques
-- distinctes mais complémentaires sur le pipeline product/variant/customer/order :
--
--   1) B2B wholesale / Customer groups — Segmentation tarifaire customers
--      (retail | wholesale | VIP | custom-named). Table `customer_groups`
--      (id PK + client_id + name + slug + discount global). Assignements
--      via `customer_group_assignments` (UNIQUE par group×customer). Pricing
--      surchargé par tier via `tier_prices` (variant×group×min_quantity).
--      Résolution prix HANDLER : pricing-engine.resolveTierPrice() applique
--      le meilleur match (min_quantity ≤ qty), sinon variant.price legacy.
--
--   2) Product bundles — Groupage produits avec discount calculé (vs sum
--      items individuels). Tables `product_bundles` (id PK + name + prix
--      total + discount_pct) + `bundle_items` (n variants × quantity).
--      Helper pricing-engine.computeBundleDiscount() PURE — pas d'I/O.
--      Phase B : auto-add bundle items au cart lors du POST.
--
--   3) Pre-orders / waitlist queue — File d'attente acheteurs sur variants
--      en rupture ou pas encore lancés. Table `preorder_queue` (id PK +
--      variant_id + customer_id + email + status enum HANDLER queued|
--      notified|converted|cancelled). Endpoint PUBLIC POST /api/public/
--      preorders permet le join visiteur (email seul requis), rate-limit
--      + honeypot HANDLER. processPreorderNotification() envoie email
--      best-effort quand variant restocké.
--
-- depends_on (manifest) :
--   - migration-warehouse-dropship-seq142.sql (chaînage SÉQUENTIEL manifest)
--   - migration-sprintE1-m1-ecommerce-schema.sql (product_variants + customers
--                                                 + orders pour conversion FK
--                                                 applicative)
--
-- ⚠ 100% STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une contrainte existante. Ce lot N'AJOUTE QUE :
--     - 6 `CREATE TABLE IF NOT EXISTS` neuves   (customer_groups,
--                                                customer_group_assignments,
--                                                tier_prices, product_bundles,
--                                                bundle_items, preorder_queue)
--     - 7 `CREATE INDEX IF NOT EXISTS` neufs    (idempotents — 4 lookup
--                                                + 2 UNIQUE + 1 lookup secondaire)
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Les
--   jointures group_id / customer_id / variant_id / bundle_id / converted_order_id
--   sont APPLICATIVES, par colonne TEXT. PAS de CHECK SQL (additif pur — enums
--   preorder.status validés HANDLER pricing-engine.ts, pas SQL).
--
-- Capabilities FIGÉES (AUCUN ajout à ALL_CAPABILITIES seq 80) :
--   - clients.manage : customer_groups (CRUD + assign/remove), tier_prices
--                      (CRUD + resolve), product_bundles (CRUD + items),
--                      preorders (list + notify + cancel + convert).
--   - PUBLIC (pré-requireAuth) : POST /api/public/preorders — visitor join
--                      waitlist (email + variant_id). Rate-limit + honeypot
--                      HANDLER (calque /api/public/tickets + /api/r/:token/submit).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent. Aucun ALTER ici, donc
--   pas de risque "duplicate column name".
--
-- Conventions (calque seq 142 / seq 141 / seq 120) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT DEFAULT
--   (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement, PAS de FK.
--   Money en cents INTEGER, devise locked 'CAD' V1. Multi-tenant : client_id
--   sur TOUTES les tables tenant-scopées (defense-in-depth IDOR — bornage
--   WHERE client_id = ? au HANDLER). Denorm client_id sur tables d'association
--   (customer_group_assignments, preorder_queue) pour query plan rapide sans
--   jointure cross-tenant.
--
-- Flag PUBLIC preorder join : honeypot champ `website` HANDLER, rate-limit
--   bucket `preorder_join:<ip>` max 5/300s (calque /api/public/tickets).
--   Email format check basique HANDLER (regex). PII Loi 25 : email stocké
--   chiffré en clair V1 (déjà fourni par visiteur — pas de cookie tiers
--   collecté). Phase B : chiffrement TOKEN_KEY si besoin.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-b2b-bundles-preorders-seq143.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) customer_groups — Segments tarifaires customers ────────────────────
-- Tenant-scoped (client_id NOT NULL). Slug optionnel (UI URL). `default_discount_pct`
-- appliqué au checkout si pas de tier_prices override. Désactivation soft via
-- is_active = 0. UNIQUE applicatif slug×client (HANDLER, pas SQL pour permettre
-- transitions / renames).
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

-- ── 2) customer_group_assignments — Affectation customer → group ──────────
-- N→N customers × groups (un customer peut être dans plusieurs groups). UNIQUE
-- SQL sur (group_id, customer_id) empêche les doublons. `expires_at` NULL =
-- assignation permanente. `client_id` denorm pour bornage tenant rapide
-- (defense-in-depth IDOR sans jointure customer_groups).
CREATE TABLE IF NOT EXISTS customer_group_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  assigned_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

-- ── 3) tier_prices — Prix spécifiques par variant × group × quantity ──────
-- Override pricing legacy `product_variants.price` quand un customer appartient
-- à un group avec un tier matching `min_quantity ≤ cart_quantity`. UNIQUE SQL
-- sur (product_variant_id, group_id, min_quantity) empêche les doublons. Le
-- HANDLER pricing-engine.resolveTierPrice() prend le tier avec le PLUS GRAND
-- min_quantity ≤ cart_qty (meilleur prix pour le volume demandé).
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

-- ── 4) product_bundles — Groupage produits avec discount calculé ──────────
-- Tenant-scoped. `total_price_cents` = prix de vente du bundle complet
-- (override). `discount_pct` = pourcentage de remise vs somme des items
-- individuels (calculé HANDLER computeBundleDiscount, persisté optionnel
-- pour cache UI). Désactivation soft via is_active = 0.
CREATE TABLE IF NOT EXISTS product_bundles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  total_price_cents INTEGER,
  discount_pct REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── 5) bundle_items — Composition d'un bundle (n variants × qty) ──────────
-- 1 bundle = N items (chaque item = 1 variant × quantity). Pas de UNIQUE sur
-- (bundle_id, product_variant_id) — V1 permet doublons (Phase B UI gère
-- l'agrégation côté form). client_id absent (denorm via bundle_id → product_bundles
-- pour ne pas dupliquer la dénorm tenant à chaque ligne).
CREATE TABLE IF NOT EXISTS bundle_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  bundle_id TEXT NOT NULL,
  product_variant_id TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 6) preorder_queue — Waitlist visiteurs sur variants en rupture ────────
-- Statut enum HANDLER (whitelist verrouillée pricing-engine.ts) :
--   queued | notified | converted | cancelled
-- Lifecycle :
--   queued (créé via PUBLIC POST) → notified (processPreorderNotification
--           envoie email best-effort quand variant restocké) → converted
--           (lors du POST /api/preorders/:id/convert — order_id remplit
--           converted_order_id) | cancelled (admin ou customer cancel).
-- `customer_id` peut être NULL initial (visiteur non encore enregistré —
-- email seul stocké). Phase B : link customer_id quand visiteur s'inscrit.
-- `client_id` denorm pour bornage tenant rapide.
CREATE TABLE IF NOT EXISTS preorder_queue (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  variant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  email TEXT,
  status TEXT DEFAULT 'queued',
  notified_at TEXT,
  converted_order_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── Index ADDITIFs idempotents ─────────────────────────────────────────────

-- Lookup groups actifs pour un client (UI ListCustomerGroups + pricing engine
-- bootstrap).
CREATE INDEX IF NOT EXISTS idx_customer_groups_client
  ON customer_groups(client_id, is_active);

-- UNIQUE assignation — 1 customer par group×customer (enforce SQL +
-- HANDLER fail-fast sur duplicate).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_group_assignments
  ON customer_group_assignments(group_id, customer_id);

-- UNIQUE tier — 1 prix par variant×group×min_quantity (enforce SQL +
-- HANDLER fail-fast sur duplicate, ordre canonique pricing-engine).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tier_prices_variant_group_qty
  ON tier_prices(product_variant_id, group_id, min_quantity);

-- Lookup bundles actifs pour un client (UI ListBundles + cart auto-add).
CREATE INDEX IF NOT EXISTS idx_product_bundles_client
  ON product_bundles(client_id, is_active);

-- Lookup items d'un bundle (UI BundleEditor + computeBundleDiscount).
CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle
  ON bundle_items(bundle_id);

-- Lookup preorders par variant+statut (cron processPreorderNotification quand
-- inventory restock + admin UI WaitlistManager).
CREATE INDEX IF NOT EXISTS idx_preorder_queue_variant_status
  ON preorder_queue(variant_id, status);

-- Lookup preorders par customer+statut (customer portal "Mes pre-orders" +
-- cancel admin).
CREATE INDEX IF NOT EXISTS idx_preorder_queue_customer
  ON preorder_queue(customer_id, status);

-- NB : 6 tables NEUVES (customer_groups, customer_group_assignments, tier_prices,
-- product_bundles, bundle_items, preorder_queue), 7 INDEX NEUFS (4 lookup +
-- 2 UNIQUE + 1 lookup secondaire). AUCUN ALTER, AUCUNE FK, AUCUN CHECK, AUCUN
-- DROP / RENAME / rebuild. NE TOUCHE PAS aux handlers ecommerce-*.ts existants
-- (Sprint E1+) — handlers NEUFS dans b2b-bundles-preorders.ts +
-- lib/pricing-engine.ts. Capabilities FIGÉES : clients.manage (groups CRUD +
-- assign + tier_prices + bundles + preorders) + PUBLIC (preorder join visitor
-- rate-limit + honeypot HANDLER). AUCUN ajout ALL_CAPABILITIES seq 80.
-- i18n parité STRICTE 4 catalogues (en, fr-CA, fr-FR, es). Choix figés
-- docs/LOT-B2B-BUNDLES-PREORDERS-S48.md §6.
