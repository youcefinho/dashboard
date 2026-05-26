-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 113 — SPRINT 13 « Scoring prédictif calibré tenant »
-- (2026-05-22)
-- Le scoring lead existe DÉJÀ avec des coefficients UNIVERSELS codés en dur
-- (SOURCE_COEFFICIENTS / statusToProbability identiques pour TOUS les tenants,
-- cf. lead-predict.ts / lead-score.ts / proactive-ai.ts). CE LOT NE LES RÉÉCRIT
-- PAS — il AJOUTE une couche de CALIBRATION par tenant : on agrège l'historique
-- won/lost RÉEL du tenant (DÉTERMINISTE, offline-safe, ZÉRO LLM) dans
-- `conversion_baselines`, puis on AJUSTE la probabilité déterministe existante par
-- le taux de conversion observé du tenant (par source / status / score_bucket).
--
-- ⚠ NE PAS écraser le cache `lead_predictions` (seq 54, Sprint 49 M2) : ce lot
--   crée une table NEUVE `conversion_predictions` DISTINCTE (cache calibré). Les
--   deux coexistent — aucun ALTER / DROP / RENAME de lead_predictions.
--
-- ⚠ ENUMS validés CÔTÉ HANDLER (whitelist JS), JAMAIS par CHECK SQL :
--     conversion_baselines.dimension ∈ 'source' | 'status' | 'score_bucket' | 'overall'
--   Valeur hors-liste ⇒ rejet HANDLER (jamais persisté). Aucune contrainte SQL.
--
-- ⚠ BORNAGE TENANT — chaque ligne porte `client_id` (NULLABLE au schéma, TOUJOURS
--   renseigné par les handlers/cron depuis l'auth ou l'itération DISTINCT
--   client_id, JAMAIS le body). `agency_id` NULLABLE (mode agence optionnel).
--   Aucune nouvelle capability : `ai.use` (déjà dans ALL_CAPABILITIES) suffit —
--   ZÉRO ajout.
--
-- depends_on : migration-aicontent-seq112.sql (seq 112 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 112). Tables `leads` (seq 1) /
--              `lead_predictions` (seq 54) existent déjà — référencées en LECTURE
--              par le batch Phase B, JAMAIS par FK ici.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 2 `CREATE TABLE IF NOT EXISTS` — neuves, idempotentes ;
--     - 2 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN NOT NULL forcé. AUCUN CHECK. AUCUNE FK. AUCUN rebuild. AUCUN touch
--   `leads` / `lead_predictions` (seq 54) / `customers` / `clients`. Triggers
--   lead_score_changed / score_threshold INTOUCHÉS.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` sont idempotents
--   (rejeu = no-op). scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-conversion-scoring-seq113.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) conversion_baselines — agrégats won/lost RÉELS du tenant, par dimension.
--    dimension = 'source' | 'status' | 'score_bucket' | 'overall' (validé HANDLER,
--    PAS de CHECK). dimension_value = la valeur de la dimension (ex 'referral',
--    'qualified', '60-79', '' pour overall). conversion_rate = won/(won+lost),
--    déterministe. sample_size = won_count + lost_count (sert au fallback
--    coefficients fixes si < 10). UPSERT idempotent par run de cron sur
--    UNIQUE(client_id, dimension, dimension_value). Bornage tenant : client_id
--    NULLABLE au schéma, TOUJOURS renseigné par l'itération DISTINCT du batch.
CREATE TABLE IF NOT EXISTS conversion_baselines (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  dimension TEXT,
  dimension_value TEXT,
  won_count INTEGER DEFAULT 0,
  lost_count INTEGER DEFAULT 0,
  conversion_rate REAL DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  computed_at TEXT DEFAULT (datetime('now'))
);

-- 2) conversion_predictions — cache des prédictions CALIBRÉES par lead (DISTINCT
--    du cache lead_predictions seq 54, qu'on N'ÉCRASE PAS). probability = proba
--    de conversion calibrée 0..100. calibrated = 0|1 (1 si la base tenant a servi,
--    0 si fallback coefficients fixes faute d'échantillon — validé HANDLER).
--    factors_json = explicabilité (facteurs + "taux historique source X%").
--    Bornage tenant : client_id NULLABLE au schéma, TOUJOURS renseigné depuis
--    l'auth côté handler.
CREATE TABLE IF NOT EXISTS conversion_predictions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT,
  client_id TEXT,
  probability REAL DEFAULT 0,
  calibrated INTEGER DEFAULT 0,
  factors_json TEXT,
  computed_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFS idempotents.
-- Lecture des bases d'un tenant filtrées par dimension (calibration par source/
-- status/bucket).
CREATE INDEX IF NOT EXISTS idx_conversion_baselines_client ON conversion_baselines(client_id, dimension);
-- Lookup du cache de prédiction calibrée par lead.
CREATE INDEX IF NOT EXISTS idx_conversion_predictions_lead ON conversion_predictions(lead_id);

-- NB : 2 CREATE TABLE neuves, 2 INDEX neufs, AUCUN NOT NULL forcé, AUCUN CHECK,
-- AUCUNE FK, AUCUN DROP / RENAME / rebuild / ALTER. Enum dimension validé HANDLER.
-- NE PAS écraser lead_predictions (seq 54) — conversion_predictions est DISTINCTE.
-- Bornage tenant = client_id partout. ZÉRO ajout ALL_CAPABILITIES (ai.use).
-- Calibration batch 100% DÉTERMINISTE (ZÉRO LLM). Choix figés
-- docs/LOT-CONVERSION-SCORING.md §6.
