-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 101 — LOT PORTAL-E Portail client final (fondations)
-- (2026-05-21)
-- 3 tables NEUVES pour le PORTAIL CLIENT : un espace authentifié 100% SÉPARÉ du
-- CRM où le CLIENT FINAL d'un pro (lead converti) consulte SES factures / devis /
-- rendez-vous / documents / tickets, demande un RDV, crée un ticket et signe un
-- document. L'auth portail est DISTINCTE de l'auth membre (member_sessions) ET de
-- l'auth admin (admin_sessions/users) : `portal_sessions` est lu UNIQUEMENT par
-- `requirePortalUser` (portal-auth.ts), token distinct `intralys_portal_token`.
--
-- ⚠ IDENTITÉ DÉDIÉE — `portal_users` est une entité PROPRE (PAS de réutilisation
--   de `members`, PAS de promotion d'un lead). Chaque portal_user porte `lead_id`
--   (clé d'AGRÉGATION au provisioning) + `client_id` (tenant). Ces DEUX colonnes
--   sont injectées dans le contexte de session par `requirePortalUser` et bornent
--   CHAQUE lecture (WHERE lead_id = ? AND client_id = ?). ISOLATION DOUBLE :
--   cross-lead ET cross-tenant. JAMAIS depuis le body/query.
--
-- ⚠ PROVISIONNING ADMIN — pas d'auto-inscription. L'admin (PRO) invite un portal_user
--   (POST /api/portal-users, capability billing.view RÉUTILISÉE — ZÉRO ajout à
--   ALL_CAPABILITIES) en choisissant un lead → crée portal_users + lien set-password.
--
-- ⚠ AUCUN PAIEMENT (E4) — la facture est LECTURE SEULE côté portail. Aucune table
--   E4/E6 régulée n'est touchée, aucun flux de paiement n'est exposé.
--
-- depends_on : migration-attribution-cohort-seq100.sql (seq 100 — dernière migration
--              du manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 100). Les tables LECTURES
--              (invoices seq18, quotes seq82, appointments seq4, documents seq11,
--              support_tickets seq89, leads seq1) existent déjà — référencées en
--              LECTURE par les agrégateurs (Phase B), JAMAIS par FK.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 3 `CREATE TABLE IF NOT EXISTS` — neuves, idempotentes ;
--     - 4 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN DEFAULT non-NULL (hors id randomblob / status / timestamp datetime('now')
--   / is_active — défauts internes propres aux tables neuves). AUCUN CHECK. AUCUNE
--   FK. AUCUN rebuild. AUCUN touch clients / agencies / users / leads / members /
--   member_sessions / invoices / quotes / appointments / documents / support_tickets.
--   AUCUN touch tables E4/E6 régulées. Le CHECK role users seq 59 (rebuild:users)
--   est INTOUCHÉ.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` sont idempotents
--   (rejeu = no-op). scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-portal-seq101.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) portal_users — identité du CLIENT FINAL du portail (entité DÉDIÉE, distincte
--    de members). lead_id = clé d'agrégation posée au provisioning (les 5
--    agrégateurs lisent WHERE lead_id = ?). client_id = tenant propriétaire (borne
--    cross-tenant). password_hash = pbkdf2 RÉUTILISÉ crypto.ts. status 'active' par
--    défaut (désactivation possible sans suppression).
CREATE TABLE IF NOT EXISTS portal_users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT,
  email TEXT NOT NULL, password_hash TEXT NOT NULL, name TEXT,
  lead_id TEXT, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 2) portal_sessions — sessions du portail, lues UNIQUEMENT par requirePortalUser
--    (JAMAIS admin_sessions / users / members / member_sessions). Token distinct.
--    expires_at = horizon de session (calque member_sessions).
CREATE TABLE IF NOT EXISTS portal_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  portal_user_id TEXT NOT NULL, token TEXT NOT NULL, expires_at TEXT NOT NULL,
  ip TEXT, user_agent TEXT, created_at TEXT DEFAULT (datetime('now'))
);

-- 3) portal_sites — résolution du tenant d'un portail via son slug (calque EXACT
--    membership_sites). slug → client_id/agency_id (resolvePortalSiteTenant).
CREATE TABLE IF NOT EXISTS portal_sites (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT,
  slug TEXT NOT NULL, name TEXT, is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFS idempotents.
-- Lookup session par token (chemin chaud de requirePortalUser).
CREATE INDEX IF NOT EXISTS idx_portal_sessions_token ON portal_sessions(token);
-- Anti-doublon / login : (tenant, email).
CREATE INDEX IF NOT EXISTS idx_portal_users_email ON portal_users(client_id, email);
-- Résolution tenant par slug.
CREATE INDEX IF NOT EXISTS idx_portal_sites_slug ON portal_sites(slug);
-- Agrégation par lead (les 5 agrégateurs bornent lead_id).
CREATE INDEX IF NOT EXISTS idx_portal_users_lead ON portal_users(lead_id);

-- NB : 3 CREATE TABLE neuves, 4 INDEX neufs, AUCUN CHECK, AUCUNE FK, AUCUN DROP /
-- RENAME / rebuild / ALTER. NULL client_id/lead_id jamais produit par le
-- provisioning (toujours posés depuis l'admin). Bornage tenant = client_id ;
-- bornage lead = lead_id ; les DEUX dans la session (jamais body/query). ZÉRO ajout
-- ALL_CAPABILITIES (billing.view réutilisée). Auth portail 100% séparée
-- (portal_sessions). Facture LECTURE SEULE (E4 jamais). Choix figés
-- docs/LOT-PORTAL-E.md §6.
