-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 88 — LOT D Reports Builder Hardening + Data Wiring (2026-05-20)
-- Verrouillage tenant des dashboards custom existants (Sprint 46 M1.3) :
-- scope agence/sous-compte signé + journal d'audit consultation/partage.
-- Aucun nouvel endpoint data ; juste de quoi BORNER un dashboard à un tenant
-- et tracer les accès. Le wiring widgets→vraies sources data passe par les
-- modules existants (ecommerce-analytics, leads, tasks, clients-admin
-- handleGetAgencyReports) bornés tenant côté handler — JAMAIS de nouvelle
-- source data.
--
-- depends_on : migration-member-seq87.sql (seq 87 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 87).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une CONTRAINTE existante.
--   Ce lot N'AJOUTE QUE :
--     - 2 `CREATE TABLE IF NOT EXISTS` (dashboard_scopes, dashboard_audit_log)
--       NEUVES, idempotentes ;
--     - 3 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN `ALTER TABLE` sur une table existante. La table `dashboards`
--   (seq 51 — migration-sprint46.sql) reste INTOUCHÉE. Le bornage tenant
--   se fait par TABLE COMPAGNON `dashboard_scopes` (jointure applicative
--   par `dashboard_id`), PAS par ALTER sur `dashboards`.
--
--   CHECK role `users` seq 59 (rebuild:users) est INTOUCHÉ. AUCUN touch
--   `users` / `admin_sessions`. AUCUN touch tables E4/E6 régulées
--   (`payments`, `payment_events`, `payment_provider_config`, `refunds`,
--   `disputes`, `return_requests`). AUCUNE table existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; la
--   jointure `dashboard_scopes.dashboard_id` → `dashboards.id` est
--   APPLICATIVE, par colonne INTEGER). PAS de CHECK (additif pur — ajouter
--   un CHECK plus tard ⇒ rebuild ⇒ on ne s'enferme pas).
--
-- TOLÉRANCE « table exists » — exécution best-effort :
--   si seq 88 est rejouée, `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent
--   (pas d'erreur). L'exécuteur (Antigravity) joue ce fichier statement-par-
--   statement, log + CONTINUE au statement suivant. scripts/migrate.ts est
--   FIGÉ et N'EST PAS modifié ; la tolérance est une consigne d'exécution.
--
-- Conventions schema.sql + migration-sprint46.sql :
--   `dashboards.id` est INTEGER PRIMARY KEY AUTOINCREMENT — on chaîne en
--   INTEGER pour `dashboard_scopes.dashboard_id` (jointure homogène). PAS
--   de FK. `scope_signature` = HMAC applicatif signé serveur (calque
--   pattern share_token genToken existant), JAMAIS recalculé côté client.
--   Timestamps en INTEGER `unixepoch()` — homogène avec dashboards.updated_at
--   (migration-sprint46 DEFAULT (unixepoch())).
--
-- Bornage tenant : `client_id` (tenant propriétaire — calque
--   funnels.client_id seq 83 / membership_sites.client_id seq 87) +
--   `agency_id` (scope agence — calque funnels.agency_id seq 83). Tous
--   deux nullables : legacy/mono-tenant → NULL, mode agence → bornés.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-reports-d-seq88.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) dashboard_scopes — table COMPAGNON liant un `dashboards.id` (seq 51) à
--    un scope tenant signé. PK = dashboard_id (1 dashboard → 1 scope ; absent
--    ⇒ legacy/mono-tenant byte-équivalent). `scope_signature` est un HMAC
--    serveur (calque genToken existant) recalculé/vérifié AVANT toute lecture
--    publique via /api/dashboards/shared/:token (corps Phase B Manager-B —
--    Phase A pose UNIQUEMENT le SCHÉMA). client_id & agency_id nullables
--    (legacy/mono-tenant → NULL, mode agence → bornés au tenant créateur).
--    PAS de FK vers dashboards (D1/SQLite : FK ⇒ rebuild ⇒ interdit).
CREATE TABLE IF NOT EXISTS dashboard_scopes (
  dashboard_id INTEGER NOT NULL,
  client_id TEXT,
  agency_id TEXT,
  scope_signature TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY(dashboard_id)
);

-- 2) dashboard_audit_log — journal d'audit consultation/partage des
--    dashboards. NEUF (namespace DISTINCT de `audit_log` seq 5 — JAMAIS
--    touché/lu par ce lot). Append-only applicatif (PAS de CHECK status —
--    additif pur). `action` valeurs typiques : 'view' | 'share_open' |
--    'share_create' | 'share_rotate' | 'update' | 'delete' (PAS de CHECK :
--    additif). `ip`/`ua` best-effort depuis request headers. `at` = epoch-s.
--    Corps écriture Phase B Manager-B ; Phase A pose UNIQUEMENT le SCHÉMA.
CREATE TABLE IF NOT EXISTS dashboard_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id INTEGER,
  user_id TEXT,
  action TEXT,
  ip TEXT,
  ua TEXT,
  at INTEGER DEFAULT (unixepoch())
);

-- Index ADDITIFs idempotents — lookup scope par tenant (mode agence :
-- liste des dashboards visibles pour un agency_id ou un client_id) +
-- lookup audit par dashboard + tri chronologique (consultation récente,
-- détection abus partage public).
CREATE INDEX IF NOT EXISTS idx_dashboard_scopes_client ON dashboard_scopes(client_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_scopes_agency ON dashboard_scopes(agency_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_audit_did_at ON dashboard_audit_log(dashboard_id, at);

-- NB : 2 tables NEUVES, AUCUN ALTER sur une table existante. AUCUNE colonne
-- ajoutée à `dashboards` (seq 51) — bornage par TABLE COMPAGNON. AUCUN
-- touch `users` / `admin_sessions` / `clients` / tables E4/E6 régulées.
-- AUCUN CHECK existant modifié (CHECK role users seq 59 INTOUCHÉ). AUCUNE
-- FK. AUCUN DROP / RENAME / rebuild. Le wiring widgets→vraies sources
-- data se fait CÔTÉ HANDLER (Phase B Manager-B : handleRunReportWidget
-- dispatcher → ecommerce-analytics / clients-admin handleGetAgencyReports /
-- leads / tasks bornés tenant), JAMAIS via nouvelle source DB. Choix
-- figés docs/LOT-REPORTS-D.md §6.
