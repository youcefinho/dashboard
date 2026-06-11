-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 118 — SPRINT 18 « Catalogue de services + sélecteur devis »
-- (2026-05-22)
-- Le CATALOGUE PRODUITS e-commerce existe DÉJÀ (seq E1, products status CHECK
-- draft/active/archived, base_price en CENTS INTEGER, gated requireModule
-- ('ecommerce') ; ecommerce-products.ts CRUD/variants/catégories/recherche). Les
-- DEVIS existent DÉJÀ (seq 82, migration-invoice-real-seq82.sql : quotes status
-- CHECK FIGÉ draft/sent/accepted/declined/expired + quote_items label/qty/
-- unit_price en DOLLARS REAL + computeTotals TPS/TVQ). Les lignes de devis sont
-- en SAISIE LIBRE, sans aucun lien catalogue.
-- CE LOT NE RECONSTRUIT RIEN — il AJOUTE seulement : (1) une table NEUVE
-- `catalog_items` = catalogue de SERVICES (et produits) UTILISABLE SANS Boutique
-- (gating requireAuth SEUL, PAS requireModule('ecommerce')) ; (2) une colonne de
-- TRAÇABILITÉ `quote_items.catalog_item_id` (NULLABLE) pour relier une ligne de
-- devis à un item de catalogue. Côté HANDLER (Phase B Manager-B) : CRUD borné
-- tenant + recherche + import optionnel depuis products (mapping cents→dollars
-- /100). Côté FRONT (Phase C Manager-C) : page Catalog + sélecteur dans Quotes.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante.
--   ⚠ NE JAMAIS TOUCHER le CHECK `products.status` (E1 : draft/active/archived)
--   ni le CHECK `quotes.status` (seq 82 : draft/sent/accepted/declined/expired).
--   Aucune de ces deux tables n'est recréée ni altérée.
--   Ce lot N'AJOUTE QUE :
--     - 1 `CREATE TABLE IF NOT EXISTS catalog_items` — NEUF, idempotent.
--       `kind` (service|product) et `recurrence` (one_time|recurring) sont SANS
--       CHECK — énum GARDÉE APPLICATIVEMENT par le handler (calque
--       product_subscriptions.status seq 85 : pas de rebuild possible si l'énum
--       évolue Phase B/C). `product_id` = lien FAIBLE vers products (jointure
--       APPLICATIVE pour l'import, PAS de FK).
--     - 1 `ALTER TABLE quote_items ADD COLUMN catalog_item_id TEXT DEFAULT NULL`
--       — colonne TEXT NULLABLE, sans DEFAULT non-constant, sans CHECK, sans FK.
--     - 2 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN CHECK. AUCUNE FK. AUCUN rebuild. AUCUN touch products / quotes /
--   quote_items (au-delà du seul ADD COLUMN ci-dessus) / leads / clients /
--   invoices / agencies / users. AUCUN touch tables E4/E6 régulées.
--
-- ⚠ ADD COLUMN sur SQLite/D1 : ajout d'une colonne NULLABLE avec DEFAULT NULL
--   (constant) = opération IN-PLACE (PAS de rebuild de table tant qu'il n'y a ni
--   DEFAULT non-constant ni CHECK ni FK). On reste donc sur le contrat « zéro
--   rebuild quote_items ».
--
-- ⚠ MONEY — `catalog_items.unit_price` est en DOLLARS REAL (aligné sur
--   quote_items.unit_price seq 82, PAS sur products.base_price en CENTS). L'import
--   depuis `products` (Phase B) CONVERTIT base_price/100 → dollars. Cohérence
--   directe avec computeTotals (qui consomme des dollars REAL).
--
-- ⚠ BORNAGE TENANT — `client_id` (tenant propriétaire — calque products.client_id
--   / quotes.client_id) + `agency_id` (scope agence — calque quotes.agency_id
--   seq 82). Les handlers (Phase A stubs → Phase B corps) bornent
--   systématiquement WHERE client_id = ? (calque ecommerce-products.ts
--   resolveClientId / quotes.ts loadQuoteScoped). client_id/agency_id résolus
--   serveur, JAMAIS body.
--
-- depends_on : migration-proposals-esign-seq117.sql (seq 117 — dernière migration
--              du manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 117). Tables ciblées
--              `products` (E1, lecture/import) et `quotes`/`quote_items` (seq 82).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (rejeu = no-op).
--   `ALTER TABLE … ADD COLUMN` n'est PAS idempotent sur D1 (échoue si la colonne
--   existe déjà). En cas de rejeu, retirer manuellement le ADD COLUMN déjà
--   appliqué. scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-catalog-seq118.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Table NEUVE catalog_items — catalogue de SERVICES (et produits) utilisable
--    SANS Boutique. id randomblob, timestamps (calque product_subscriptions
--    seq 85). kind/recurrence SANS CHECK (énum gardée applicativement). unit_price
--    en DOLLARS REAL (aligné quote_items seq 82). product_id = lien FAIBLE vers
--    products (jointure applicative pour l'import, PAS de FK).
CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'service',     -- service|product — SANS CHECK, énum gardée applicativement
  unit_price REAL DEFAULT 0,                -- DOLLARS REAL (aligné quote_items seq 82, PAS cents)
  currency TEXT DEFAULT 'CAD',
  category TEXT,
  recurrence TEXT DEFAULT 'one_time',       -- one_time|recurring — SANS CHECK, énum gardée applicativement
  is_active INTEGER DEFAULT 1,
  product_id TEXT,                          -- lien FAIBLE → products (jointure applicative import, PAS de FK)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2) Traçabilité ligne de devis → item de catalogue. NULLABLE, DEFAULT NULL
--    (constant) ⇒ ADD COLUMN in-place, ZÉRO rebuild. Jointure APPLICATIVE, PAS de
--    FK. ⚠ NE TOUCHE PAS le CHECK quotes.status (seq 82). Le contrat createQuote
--    {label,qty,unit_price} reste INCHANGÉ — catalog_item_id est facultatif.
ALTER TABLE quote_items ADD COLUMN catalog_item_id TEXT DEFAULT NULL;

-- 3) Index ADDITIFS idempotents — liste bornée tenant (client_id + is_active) et
--    filtre par catégorie.
CREATE INDEX IF NOT EXISTS idx_catalog_items_client ON catalog_items(client_id, is_active);
CREATE INDEX IF NOT EXISTS idx_catalog_items_category ON catalog_items(category);

-- NB : 1 CREATE TABLE IF NOT EXISTS (catalog_items), 1 ALTER ADD COLUMN
-- (quote_items.catalog_item_id TEXT NULLABLE DEFAULT NULL), 2 INDEX neufs, AUCUN
-- CHECK, AUCUNE FK, AUCUN DROP / RENAME / rebuild / CREATE TABLE products /
-- CREATE TABLE quotes / CREATE TABLE quote_items. CHECK products.status (E1) et
-- CHECK quotes.status (seq 82) INTOUCHÉS. kind/recurrence SANS CHECK (gardés
-- applicativement). unit_price en DOLLARS REAL (import products = /100). Lien
-- catalog_items↔products et quote_items↔catalog_items APPLICATIF (TEXT, PAS de
-- FK). Bornage tenant client_id/agency_id résolu serveur. Capability
-- invoices.write RÉUTILISÉE — ZÉRO ajout ALL_CAPABILITIES. Gating requireAuth
-- SEUL (PAS requireModule('ecommerce') — un catalogue de services vit sans
-- Boutique). Choix figés docs/LOT-CATALOG.md §6.
