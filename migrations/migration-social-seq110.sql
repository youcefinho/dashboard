-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 110 — LOT SOCIAL PLANNER (Sprint 9 « Social planner — rails
-- complets, publication mock », 2026-05-22). Le module Social planner est
-- ENTIÈREMENT ABSENT (aucun module social/publish). Ce lot pose le SOCLE :
-- composer + calendrier + file planifiée + cron de publication MOCK + génération
-- IA de posts + connexions sociales (flag INACTIF). On CALQUE les rails
-- existants : oauth.ts (OAuth tenant-borné + flag inactif + encryptToken/
-- decryptToken), broadcast.ts:runDueScheduledBroadcasts (due-processor file
-- planifiée), worker.ts scheduled() (cron best-effort), reviews.ts (client
-- Claude), whatsapp.ts:sendWhatsAppTemplate (pattern mock {success:false,
-- mock:true}).
--
-- Cette migration AJOUTE 2 tables neuves + 2 INDEX de lecture. AUCUNE table
-- modifiée, AUCUN ADD COLUMN, AUCUN CHECK, AUCUNE FK, AUCUN DROP/RENAME.
-- Publication sociale RÉELLE + analytics = MOCK / flag INACTIF : sans credentials
-- OAuth social, authorize renvoie json({error},400) propre, callback no-op,
-- publishToNetwork renvoie {success:false, mock:true} SANS appel réseau (calque
-- sendWhatsAppTemplate). E4/E6 inactifs.
--
-- depends_on : migration-reputation-seq109.sql (seq 109 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 109).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   CONTRAINTE existante. `CREATE TABLE IF NOT EXISTS` est idempotent (préféré à
--   ADD COLUMN qui n'est PAS idempotent sur D1/SQLite — « duplicate column » au
--   rejeu). AUCUN ADD COLUMN ici (tables 100% neuves).
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Les liens
--   social_posts.client_id ↔ clients(id), social_accounts.client_id ↔ clients(id),
--   social_posts.created_by ↔ users(id) restent APPLICATIFS (bornés serveur).
--
--   AUCUN CHECK : status (draft|queued|processing|published|failed) et provider
--   (facebook|instagram|linkedin|google_business) sont des valeurs APPLICATIVES
--   sans CHECK (calque EXACT seq 109 : valeurs status/routed_to applicatives sans
--   CHECK ⇒ pas de rebuild SQLite, additif pur).
--
-- TOLÉRANCE best-effort : `CREATE TABLE/INDEX IF NOT EXISTS` reste idempotent.
--   scripts/migrate.ts est FIGÉ, NON modifié — l'entrée manifest seq 110 est
--   OBLIGATOIRE (ajoutée Phase A).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-social-seq110.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) social_accounts — connexions sociales PAR tenant (OAuth tenant-borné, calque
--    oauth_connections seq 95). FLAG INACTIF par défaut : status='inactive' tant
--    que les credentials OAuth social ne sont pas posés (authorize 400 propre,
--    callback no-op). access_token / refresh_token CHIFFRÉS AES-GCM (encryptToken
--    réutilisé — Manager-B). provider ∈ { 'facebook','instagram','linkedin',
--    'google_business' } — valeur APPLICATIVE, PAS de CHECK. agency_id NULLABLE
--    (legacy → null). Lien client_id/agency_id APPLICATIF (zéro FK).
CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  agency_id TEXT,
  provider TEXT,
  account_name TEXT,
  account_external_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TEXT,
  scopes TEXT,
  status TEXT DEFAULT 'inactive',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2) social_posts — post du Social planner (composer + file planifiée). content =
--    texte ; media_json = tableau JSON d'URLs/médias ; networks_json = tableau JSON
--    de providers ciblés. scheduled_at = échéance de publication (NULL = brouillon
--    non planifié). status APPLICATIF draft|queued|processing|published|failed
--    (SANS CHECK — calque seq 109) : draft (composer) → queued (planifié) →
--    processing (verrou cron) → published / failed (résultat mock). published_at /
--    error remplis par le cron de publication mock (Manager-B). created_by ↔
--    users(id) APPLICATIF. Lien client_id APPLICATIF (zéro FK).
CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  content TEXT,
  media_json TEXT,
  networks_json TEXT,
  scheduled_at TEXT,
  status TEXT DEFAULT 'draft',
  published_at TEXT,
  error TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 3) Index de LECTURE (idempotents) :
--    - idx_social_posts_due : due-processor du cron de publication (SELECT
--      social_posts WHERE scheduled_at <= now AND status='queued' — calque
--      runDueScheduledBroadcasts). Sans index : full scan social_posts à chaque
--      tick.
--    - idx_social_accounts_client : liste des connexions sociales par tenant
--      (GET /api/social/accounts), borné client_id.
CREATE INDEX IF NOT EXISTS idx_social_posts_due ON social_posts(scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_social_accounts_client ON social_accounts(client_id);

-- NB : 2 tables ADDITIVES (IF NOT EXISTS) + 2 index de LECTURE. AUCUN ADD COLUMN.
-- AUCUN CHECK. AUCUNE FK. AUCUN DROP / RENAME / rebuild. AUCUNE capability ajoutée
-- (réutilise workflows.manage pour posts/file, ai.use pour génération IA,
-- settings.manage pour connexions — toutes EXISTANTES dans ALL_CAPABILITIES seq
-- 80). Publication sociale réelle + analytics INACTIFS (MOCK / flag). Contrat figé
-- docs/LOT-SOCIAL-PLANNER.md §6.
