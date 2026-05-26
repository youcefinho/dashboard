-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 94 — LOT G9 White-label custom domain (squelette transverse)
-- (2026-05-20)
-- Table compagnon ADDITIVE custom_hostnames : mapping hostname personnalisé →
-- tenant (client_id). Provisioning Cloudflare for SaaS + DKIM/from par tenant
-- restent DERRIÈRE FLAGS INACTIFS (env.WHITELABEL_PROVISIONING_ENABLED /
-- env.WHITELABEL_DKIM_ENABLED) ⇒ AUCUN appel réseau Phase A/B tant que flag off,
-- statut reste 'pending', from email byte-identique au défaut.
--
-- ⚠ RÉSOLUTION TENANT INTOUCHÉE — la résolution reste par IDENTITÉ user
--   (resolveTenantContext, worker.ts:821 via requireAuth). Le hostname n'est
--   qu'un FALLBACK DERNIER RECOURS (atteint UNIQUEMENT si clientId===null à la
--   fin du résolveur — jamais pour un user existant), branché Phase B. Routing
--   tenant byte-identique pour tout user existant.
--
-- ⚠ agencies.custom_domain (seq 19) = legacy NON-ROUTÉ — NON TOUCHÉ. Le mapping
--   white-label v1 vit dans cette table compagnon NEUVE, sur le tenant
--   (client_id), agency_id NULLABLE. Branding (clients.branding/logo_url/
--   primary_color/accent_color seq 81) INTOUCHÉ — géré par clients-admin.ts.
--
-- depends_on : migration-community-seq93.sql (seq 93 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 93). Les jointures vers
--              clients (seq 81) / agencies (seq 19) sont APPLICATIVES (par
--              colonne TEXT), zéro FK.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 1 `CREATE TABLE IF NOT EXISTS` (custom_hostnames) NEUVE, idempotente ;
--     - 2 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN ALTER. AUCUN touch clients / agencies / users / admin_sessions.
--   AUCUN touch tables E4/E6 régulées. Le CHECK role users seq 59
--   (rebuild:users) est INTOUCHÉ. AUCUNE table existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures custom_hostnames.client_id → clients.id /
--   custom_hostnames.agency_id → agencies.id sont APPLICATIVES, par colonne
--   TEXT). PAS de CHECK (additif pur — les statuts status / dkim_status sont
--   des chaînes posées/validées côté HANDLER, pas par CHECK SQL).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas d'erreur si rejoué).
--   scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Conventions (calque seq 93 — community) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement,
--   PAS de FK. Bornage tenant : `client_id` (stockage sur le tenant) +
--   `agency_id` NULLABLE.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-whitelabel-seq94.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) custom_hostnames — mapping hostname personnalisé → tenant. client_id =
--    tenant propriétaire (clients seq 81), agency_id NULLABLE (agence parente,
--    legacy/mono-tenant → NULL). status / dkim_status = 'pending' tant que le
--    flag WHITELABEL_PROVISIONING_ENABLED est OFF (no-op, zéro réseau).
--    provider_ref = id externe Cloudflare for SaaS (rempli Phase B SI flag ON).
--    Jointures client_id / agency_id APPLICATIVES (par colonne TEXT, zéro FK).
CREATE TABLE IF NOT EXISTS custom_hostnames (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT,
  hostname TEXT,
  status TEXT DEFAULT 'pending',
  dkim_status TEXT DEFAULT 'pending',
  provider_ref TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFs idempotents — lookup hostname (fallback résolution tenant
-- DERNIER RECOURS, Phase B) + listing des hostnames d'un tenant.
CREATE INDEX IF NOT EXISTS idx_custom_hostnames_hostname ON custom_hostnames(hostname);
CREATE INDEX IF NOT EXISTS idx_custom_hostnames_client ON custom_hostnames(client_id);

-- NB : 1 table NEUVE (custom_hostnames), 2 INDEX NEUFS, AUCUN ALTER, AUCUNE FK,
-- AUCUN CHECK (statuts validés HANDLER). AUCUN touch clients / agencies / users
-- / admin_sessions / tables E4/E6 régulées. AUCUN DROP / RENAME / rebuild.
-- Bornage tenant = client_id (stockage tenant) + agency_id NULLABLE. Flags
-- WHITELABEL_PROVISIONING_ENABLED / WHITELABEL_DKIM_ENABLED INACTIFS (no-op
-- réseau). Routing tenant byte-identique (hostname = fallback jamais atteint si
-- clientId résolu). Choix figés docs/LOT-WHITELABEL-G9.md §6.
