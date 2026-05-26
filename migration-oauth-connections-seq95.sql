-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 95 — LOT G4 OAuth natives (squelette transverse)
-- (2026-05-20)
-- Table compagnon ADDITIVE oauth_connections : connexions OAuth natives par
-- tenant (Google Calendar + Slack en v1 ; Gmail send-as / M365 = v2). Stockage
-- des tokens CHIFFRÉS (AES-GCM via env.TOKEN_KEY, fallback clair documenté si
-- absent — calque migration-ghl-oauth.ts encryptToken/decryptToken).
--
-- ⚠ FLAG PAR PROVIDER (credentials env) — tant que GOOGLE_OAUTH_CLIENT_ID /
--   GOOGLE_OAUTH_CLIENT_SECRET (Google) ou SLACK_CLIENT_ID / SLACK_CLIENT_SECRET
--   (Slack) sont ABSENTS, le handler authorize renvoie 400 'non configuré'
--   (PAS 500, calque _v2-backlog/gcal.ts:28) et callback est no-op. Activation =
--   Rochdi pose les secrets via `wrangler secret put`. AUCUN appel réseau tant
--   que les credentials du provider sont absents.
--
-- ⚠ BORNAGE TENANT STRICT — oauth_connections.client_id = tenant propriétaire
--   (clients seq 81), agency_id NULLABLE (agence parente, legacy/mono-tenant →
--   NULL). Le client_id provient TOUJOURS de l'auth/state KV, JAMAIS du body.
--   Le DELETE re-borne le tenant. Le state CSRF (KV) porte le tenant — jamais
--   cross-tenant. Jointures client_id / agency_id APPLICATIVES (par colonne
--   TEXT, zéro FK).
--
-- depends_on : migration-whitelabel-seq94.sql (seq 94 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 94). Les jointures vers
--              clients (seq 81) / agencies (seq 19) sont APPLICATIVES (par
--              colonne TEXT), zéro FK.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 1 `CREATE TABLE IF NOT EXISTS` (oauth_connections) NEUVE, idempotente ;
--     - 1 `CREATE INDEX IF NOT EXISTS` — neuf, idempotent.
--   AUCUN ALTER. AUCUN touch clients / agencies / users / admin_sessions.
--   AUCUN touch tables E4/E6 régulées. Le CHECK role users seq 59
--   (rebuild:users) est INTOUCHÉ. AUCUNE table existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures oauth_connections.client_id → clients.id /
--   oauth_connections.agency_id → agencies.id sont APPLICATIVES, par colonne
--   TEXT). PAS de CHECK (additif pur — provider / status sont des chaînes
--   posées/validées côté HANDLER, pas par CHECK SQL).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas d'erreur si rejoué).
--   scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Conventions (calque seq 94 — white-label) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement,
--   PAS de FK. Bornage tenant : `client_id` (stockage sur le tenant) +
--   `agency_id` NULLABLE.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-oauth-connections-seq95.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) oauth_connections — connexions OAuth natives par tenant. client_id =
--    tenant propriétaire (clients seq 81), agency_id NULLABLE. provider =
--    'google' | 'slack' (validé HANDLER, pas par CHECK). access_token /
--    refresh_token CHIFFRÉS AES-GCM (env.TOKEN_KEY ; clair si absent, limite
--    documentée). expires_at ISO ; refresh LAZY au getter (calque
--    getGcalAccessToken). status = 'active' par défaut. account_email =
--    identité du compte connecté (affichage UI). Jointures client_id /
--    agency_id APPLICATIVES (par colonne TEXT, zéro FK).
CREATE TABLE IF NOT EXISTS oauth_connections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT,
  provider TEXT,
  access_token TEXT, refresh_token TEXT, expires_at TEXT,
  scopes TEXT, status TEXT DEFAULT 'active', account_email TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIF idempotent — lookup des connexions d'un tenant par provider
-- (listing tenant-borné + getter token avant refresh lazy).
CREATE INDEX IF NOT EXISTS idx_oauth_conn_tenant ON oauth_connections(client_id, provider);

-- NB : 1 table NEUVE (oauth_connections), 1 INDEX NEUF, AUCUN ALTER, AUCUNE FK,
-- AUCUN CHECK (provider / status validés HANDLER). AUCUN touch clients /
-- agencies / users / admin_sessions / tables E4/E6 régulées. AUCUN DROP /
-- RENAME / rebuild. Bornage tenant = client_id (stockage tenant, depuis auth/
-- state JAMAIS body) + agency_id NULLABLE. Flag par provider via credentials
-- env (GOOGLE_OAUTH_* / SLACK_* absents = authorize 400 propre + callback
-- no-op, ZÉRO réseau). Tokens chiffrés AES-GCM (TOKEN_KEY ; clair si absent).
-- Choix figés docs/LOT-OAUTH-G4.md §6.
