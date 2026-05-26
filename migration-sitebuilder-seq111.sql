-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 111 — LOT SITE BUILDER (Sprint 10 « Site builder — multi-pages
-- réutilisant le moteur funnel », 2026-05-22). DERNIER sprint du LOT 1. Le moteur
-- de blocs funnel est COMPLET et RÉUTILISÉ (funnel-blocks.ts compileBlocksToHtml /
-- createDefaultBlock / FunnelBlock ; funnels.ts CRUD/publish/public ;
-- FunnelBuilder.tsx dnd ; PublicFunnel.tsx rendu hydraté ; route-meta-ssr.ts
-- maybeServeFunnelSsr ; capture→CRM via forms.ts). Le GAP comblé ici = un
-- CONTENEUR multi-pages ADRESSABLES + navigation/menu + routing public
-- `/site/:slug/:page`. On CALQUE le schéma funnels (seq 83) : tables NEUVES, slug
-- applicatif, custom_domain POSÉ mais INACTIF.
--
-- depends_on : migration-social-seq110.sql (seq 110 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 110).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   CONTRAINTE existante. Ce lot N'AJOUTE QUE des CREATE TABLE/INDEX
--   IF NOT EXISTS (idempotents). AUCUN ALTER sur funnels / funnel_pages /
--   tables existantes. Les tables `sites` / `site_pages` / `site_publications`
--   sont NEUVES. AUCUN ADD COLUMN (préféré CREATE TABLE IF NOT EXISTS, idempotent
--   sur D1 — ADD COLUMN ne l'est PAS, « duplicate column » au rejeu).
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Les
--   jointures site↔pages / site↔publication restent APPLICATIVES, par `site_id`
--   en colonne TEXT (bornées serveur). AUCUN touch tables E4/E6 régulées
--   (payments / refunds / disputes / return_requests). AUCUNE activation paiement.
--
--   CHECK sur table NEUVE AUTORISÉ : sites.status IN ('draft','published',
--   'archived') CALQUE EXACT funnels.status seq 83 (table neuve ⇒ pas de rebuild).
--   JAMAIS de modification d'un CHECK existant.
--
-- TOLÉRANCE best-effort : `CREATE TABLE/INDEX IF NOT EXISTS` reste idempotent.
--   scripts/migrate.ts est FIGÉ, NON modifié — l'entrée manifest seq 111 est
--   OBLIGATOIRE (ajoutée Phase A).
--
-- Conventions schema.sql : id TEXT PK (généré applicatif crypto.randomUUID côté
--   handler, calque social_posts seq 110), timestamps TEXT DEFAULT (datetime('now')).
--   Bornage tenant : client_id (calque funnels.client_id) + agency_id (scope
--   agence). Le slug de publication a une unicité APPLICATIVE (handler Phase B),
--   PAS de contrainte UNIQUE SQL. `custom_domain` POSÉ mais INACTIF (calque
--   funnels custom_domain seq 83 + custom_hostnames seq 94 flag
--   WHITELABEL_PROVISIONING_ENABLED — jamais lu en v1, voir docs/LOT-SITE-BUILDER.md §6.E).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-sitebuilder-seq111.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) sites — conteneur multi-pages de premier ordre (un site = N pages
--    adressables + une navigation). status draft/published/archived (CHECK sur
--    table NEUVE, calque funnels seq 83). theme_json = thème global (couleurs/
--    polices) ; nav_json = items de navigation (SiteNavItem[] sérialisé JSON,
--    compilé en <nav> par site-nav.ts:compileNavToHtml). custom_domain POSÉ mais
--    INACTIF (v1 — jamais lu). Bornage tenant client_id + agency_id (zéro FK).
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  agency_id TEXT,
  name TEXT,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  theme_json TEXT,
  nav_json TEXT,
  custom_domain TEXT DEFAULT NULL,
  total_views INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2) site_pages — UNE page d'un site = lecture/écriture ATOMIQUE de ses blocs.
--    `blocks` = FunnelBlock[] JSON (format IDENTIQUE à funnel_pages.blocks seq 83 —
--    RÉUTILISE compileBlocksToHtml). slug = adresse de la page DANS le site
--    (`/site/:siteSlug/:pageSlug`), unicité APPLICATIVE par site (handler Phase B).
--    is_home (1 = page d'accueil servie sur `/site/:slug`) ; in_nav (1 = affichée
--    dans la barre de navigation) ; position = ordre nav/menu. seo_* alimentent le
--    snapshot crawler (site-ssr.ts maybeServeSiteSsr, calque maybeServeFunnelSsr).
--    Jointure applicative par site_id (PAS de FK).
CREATE TABLE IF NOT EXISTS site_pages (
  id TEXT PRIMARY KEY,
  site_id TEXT,
  slug TEXT,
  title TEXT,
  blocks TEXT DEFAULT '[]',
  settings_json TEXT,
  seo_title TEXT,
  seo_description TEXT,
  seo_image TEXT,
  position INTEGER DEFAULT 0,
  is_home INTEGER DEFAULT 0,
  in_nav INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 3) site_publications — un site publié reçoit une ligne (slug tenant). Le rendu
--    public `/site/:slug[/:page]` résout client_id + site_id ICI. Unicité du slug
--    = APPLICATIVE (handler Phase B), PAS de UNIQUE SQL. `custom_domain` POSÉ mais
--    INACTIF (v1). is_active permet dé-publication sans suppression. CALQUE EXACT
--    funnel_publications seq 83.
CREATE TABLE IF NOT EXISTS site_publications (
  id TEXT PRIMARY KEY,
  site_id TEXT,
  client_id TEXT,
  agency_id TEXT,
  slug TEXT,
  custom_domain TEXT DEFAULT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 4) Index de LECTURE (idempotents) :
--    - idx_site_pages_site : pages d'un site (éditeur + rendu public), borné site_id.
--    - idx_site_publications_slug : résolution publique slug → site_id (rendu
--      `/site/:slug`, calque idx_funnel_pub_slug). Sans index : full scan.
--    - idx_sites_client : liste des sites par tenant (GET /api/sites), borné client_id.
CREATE INDEX IF NOT EXISTS idx_site_pages_site ON site_pages(site_id);
CREATE INDEX IF NOT EXISTS idx_site_publications_slug ON site_publications(slug);
CREATE INDEX IF NOT EXISTS idx_sites_client ON sites(client_id);

-- NB : 3 tables ADDITIVES (IF NOT EXISTS) + 3 index de LECTURE. AUCUN ADD COLUMN.
-- AUCUN CHECK existant touché (seul CHECK NEUF = sites.status, calque funnels).
-- AUCUNE FK. AUCUN DROP / RENAME / rebuild. AUCUNE capability ajoutée (réutilise
-- workflows.manage — calque funnels capGuard). custom_domain INACTIF (flag, jamais
-- lu v1). Le moteur de blocs (compileBlocksToHtml/createDefaultBlock/FunnelBlock),
-- le pipeline capture→CRM (forms.ts) et le snapshot SEO (maybeServeFunnelSsr) sont
-- RÉUTILISÉS, jamais reconstruits. Contrat figé docs/LOT-SITE-BUILDER.md §6.
