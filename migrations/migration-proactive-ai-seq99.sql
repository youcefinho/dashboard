-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 99 — LOT PROACTIVE-C IA proactive batch (fondations)
-- (2026-05-21)
-- 2 tables NEUVES pour la couche IA proactive batch : `churn_scores` (scores de
-- risque de décrochage, déterministes, par entité lead|customer bornée tenant) +
-- `proactive_alerts` (alertes actionnables churn|nba|summary, statut cycle de
-- vie new|seen|dismissed|acted). Les scores/alertes sont CALCULÉS PAR LE CRON
-- (Phase B, 100% déterministe — ZÉRO LLM en batch, contrôle coût) et exposés via
-- handlers HTTP bornés client_id. L'IA AGIT EN LECTURE/ALERTE SEULEMENT (crée des
-- scores + alertes in-app, ne mute RIEN d'autre, n'envoie ni email ni SMS auto).
--
-- ⚠ ENUMS validés CÔTÉ HANDLER (whitelist JS), JAMAIS par CHECK SQL :
--     churn_scores.entity_type   ∈ 'lead' | 'customer'
--     churn_scores.risk_level    ∈ 'low'  | 'medium' | 'high'
--     proactive_alerts.kind      ∈ 'churn'| 'nba'    | 'summary'
--     proactive_alerts.status    ∈ 'new'  | 'seen'   | 'dismissed' | 'acted'
--   Valeur hors-liste ⇒ rejet HANDLER (jamais persisté). Aucune contrainte SQL.
--
-- ⚠ BORNAGE TENANT — chaque ligne porte `client_id` (NULLABLE au schéma, TOUJOURS
--   renseigné par les handlers/cron depuis l'auth ou l'itération DISTINCT
--   client_id, JAMAIS le body). `agency_id` NULLABLE (mode agence optionnel).
--   Aucune nouvelle capability : `ai.use` (déjà dans ALL_CAPABILITIES) suffit —
--   ZÉRO ajout.
--
-- depends_on : migration-multilang-out-seq98.sql (seq 98 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 98). Tables `leads` (seq 1) /
--              `customers` (seq 58) existent déjà — référencées en LECTURE par le
--              batch Phase B, JAMAIS par FK ici.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 2 `CREATE TABLE IF NOT EXISTS` — neuves, idempotentes ;
--     - 2 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN NOT NULL. AUCUN DEFAULT non-NULL (hors id randomblob / status / score /
--   risk_level / timestamps datetime('now') — défauts internes propres aux tables
--   neuves). AUCUN CHECK. AUCUNE FK. AUCUN rebuild. AUCUN touch clients /
--   agencies / users / admin_sessions / industry_packs / dashboards / leads /
--   customers. AUCUN touch tables E4/E6 régulées. Le CHECK role users seq 59
--   (rebuild:users) est INTOUCHÉ.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` sont idempotents
--   (rejeu = no-op). scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-proactive-ai-seq99.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) churn_scores — score de risque de décrochage par entité (lead|customer),
--    borné tenant. Calcul DÉTERMINISTE (Phase B : RFM at_risk/hibernating/lost
--    pour customers, computeDeterministic inversé pour leads). UNIQUE(client_id,
--    entity_type, entity_id) ⇒ upsert idempotent par run de cron.
CREATE TABLE IF NOT EXISTS churn_scores (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT,
  entity_type TEXT, entity_id TEXT,
  score INTEGER DEFAULT 0, risk_level TEXT DEFAULT 'low',
  computed_at TEXT DEFAULT (datetime('now'))
);

-- 2) proactive_alerts — alertes actionnables in-app (churn|nba|summary), statut
--    cycle de vie new|seen|dismissed|acted. Poussées par le cron (Phase B) +
--    1 createNotification récap par tenant/run (anti-spam). Lecture/dismiss/seen
--    via handlers HTTP bornés client_id.
CREATE TABLE IF NOT EXISTS proactive_alerts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT,
  kind TEXT, entity_type TEXT, entity_id TEXT,
  title TEXT, body TEXT,
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFS idempotents.
-- UNIQUE : 1 score par (tenant, type, entité) — support de l'upsert idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_churn_scores_entity ON churn_scores(client_id, entity_type, entity_id);
-- Liste des alertes d'un tenant filtrée par statut, triée récent.
CREATE INDEX IF NOT EXISTS idx_proactive_alerts_client ON proactive_alerts(client_id, status, created_at);

-- NB : 2 CREATE TABLE neuves, 2 INDEX neufs, AUCUN NOT NULL forcé, AUCUN CHECK,
-- AUCUNE FK, AUCUN DROP / RENAME / rebuild / ALTER. Enums validés HANDLER. NULL
-- client_id jamais produit par les handlers (toujours borné auth/itération).
-- Bornage tenant = client_id partout. ZÉRO ajout ALL_CAPABILITIES (ai.use).
-- Churn batch 100% déterministe (ZÉRO LLM). Choix figés docs/LOT-PROACTIVE-C.md §6.
