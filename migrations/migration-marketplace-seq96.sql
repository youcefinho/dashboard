-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 96 — LOT G7 Marketplace templates (squelette transverse)
-- (2026-05-20)
-- 3 tables ADDITIVES pour un marketplace de TEMPLATES partageables cross-tenant
-- (funnel | workflow | sequence). Un publisher fige un SNAPSHOT STRIPPÉ de la
-- structure (ZÉRO donnée tenant — cf. FLAG #1 docs/LOT-MARKETPLACE-G7.md §6.A),
-- les autres tenants INSTALLENT le template = CLONE chez eux via la create-logic
-- EXISTANTE (funnels.ts / workflows.ts / sequences.ts — moteurs NON réécrits).
--
-- ⚠ FLAG #1 CROSS-TENANT (Phase B Manager-B) — marketplace_listings.content_json
--   est exposé PUBLIQUEMENT (tout tenant lit le détail d'un listing publié). Il
--   ne contient QUE la STRUCTURE (blocs funnel, step_type+config TEMPLATE,
--   libellés). JAMAIS de client_id/agency_id, lead/email réel, enrollment, ni id
--   interne réutilisable. Le strip (allowlist) est appliqué AU PUBLISH côté
--   HANDLER (calque funnels.ts:756 handlePublicFunnelGet qui PROUVE le strip).
--   La table ne porte AUCUNE contrainte là-dessus : c'est une garantie HANDLER.
--
-- ⚠ MONÉTISATION HORS v1 — marketplace_listings.price_cents existe (réservé v2)
--   mais reste INACTIF : aucun handler ne lit ce champ pour un paiement, ZÉRO
--   Stripe / E4 / E6. Tous les listings sont GRATUITS en v1.
--
-- ⚠ BORNAGE TENANT — publisher_client_id / installer_client_id / reviewer_client_id
--   proviennent TOUJOURS de l'auth (jamais du body). Le GET listing(s) est PUBLIC
--   (cross-tenant, lecture seule). publish / install / review sont PROTÉGÉS
--   (capability 'workflows.manage', déjà dans ALL_CAPABILITIES — ZÉRO ajout).
--   Unicité 1 review / tenant / listing = APPLICATIVE (pas de UNIQUE SQL).
--   Jointures *_client_id / *_agency_id APPLICATIVES (par colonne TEXT, zéro FK).
--
-- depends_on : migration-oauth-connections-seq95.sql (seq 95 — dernière migration
--              du manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 95). Les jointures vers
--              clients (seq 81) / agencies (seq 19) sont APPLICATIVES (colonne
--              TEXT), zéro FK.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 3 `CREATE TABLE IF NOT EXISTS` NEUVES, idempotentes ;
--     - 3 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN ALTER. AUCUN touch clients / agencies / users / admin_sessions /
--   industry_packs / funnels / workflows. AUCUN touch tables E4/E6 régulées.
--   Le CHECK role users seq 59 (rebuild:users) est INTOUCHÉ. AUCUNE table
--   existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures marketplace_*.client_id → clients.id / .agency_id → agencies.id /
--   marketplace_reviews.listing_id → marketplace_listings.id /
--   marketplace_installs.listing_id → marketplace_listings.id sont APPLICATIVES,
--   par colonne TEXT). PAS de CHECK (additif pur — kind / status sont des chaînes
--   posées/validées côté HANDLER, pas par CHECK SQL).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas d'erreur si rejoué).
--   scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Conventions (calque seq 94 / 95) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement,
--   PAS de FK. Bornage tenant : `*_client_id` (+ `*_agency_id` NULLABLE).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-marketplace-seq96.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) marketplace_listings — UN template publié. kind = 'funnel'|'workflow'|
--    'sequence' (validé HANDLER, pas par CHECK). publisher_client_id = tenant
--    auteur, publisher_agency_id NULLABLE. content_json = SNAPSHOT FIGÉ STRIPPÉ
--    (FLAG #1 : STRUCTURE seule, zéro donnée tenant — généré AU PUBLISH côté
--    handler). status = 'draft'|'published'. install_count / rating_avg /
--    rating_count = compteurs dénormalisés (MAJ applicative à l'install/review).
--    price_cents = RÉSERVÉ v2, INACTIF (jamais lu pour un paiement). Jointures
--    publisher_client_id / publisher_agency_id APPLICATIVES (colonne TEXT, zéro FK).
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  publisher_client_id TEXT, publisher_agency_id TEXT,
  kind TEXT,
  title TEXT, description TEXT, category TEXT,
  content_json TEXT,
  status TEXT DEFAULT 'draft',
  install_count INTEGER DEFAULT 0,
  rating_avg REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  price_cents INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

-- 2) marketplace_reviews — avis d'un tenant sur un listing. reviewer_client_id =
--    tenant auteur (depuis auth, JAMAIS body). Unicité 1 review / tenant /
--    listing = APPLICATIVE (vérif handler, pas de UNIQUE SQL). rating = 1..5
--    (validé handler). Jointures listing_id / reviewer_client_id APPLICATIVES.
CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  listing_id TEXT,
  reviewer_client_id TEXT,
  rating INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 3) marketplace_installs — trace d'une installation. installer_client_id =
--    tenant installeur (depuis auth, JAMAIS body). installed_kind = copie du
--    kind du listing. installed_id = id de l'entité CLONÉE chez l'installeur
--    (funnel/workflow/sequence). Jointures APPLICATIVES (colonne TEXT, zéro FK).
CREATE TABLE IF NOT EXISTS marketplace_installs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  listing_id TEXT,
  installer_client_id TEXT,
  installed_kind TEXT,
  installed_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFS idempotents.
-- Listing public : tri des publiés par date (GET /api/marketplace/listings).
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_status ON marketplace_listings(status, created_at);
-- Reviews d'un listing (détail public + agrégat rating).
CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_listing ON marketplace_reviews(listing_id);
-- Installs d'un listing (compteur + trace).
CREATE INDEX IF NOT EXISTS idx_marketplace_installs_listing ON marketplace_installs(listing_id);

-- NB : 3 tables NEUVES (marketplace_listings / marketplace_reviews /
-- marketplace_installs), 3 INDEX NEUFS, AUCUN ALTER, AUCUNE FK, AUCUN CHECK
-- (kind / status validés HANDLER). AUCUN touch clients / agencies / users /
-- admin_sessions / industry_packs / funnels / workflows / tables E4/E6 régulées.
-- AUCUN DROP / RENAME / rebuild. Bornage tenant = *_client_id (depuis auth JAMAIS
-- body) + *_agency_id NULLABLE. content_json = STRUCTURE strippée (FLAG #1, garanti
-- HANDLER au publish — calque funnels.ts:756). price_cents INACTIF (monétisation
-- hors v1). Unicité review = APPLICATIVE. Choix figés docs/LOT-MARKETPLACE-G7.md §6.
