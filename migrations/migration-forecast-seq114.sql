-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 114 — SPRINT 14 « Forecasting — projection + objectifs + scénarios »
-- (2026-05-22)
-- Un forecast pondéré existe DÉJÀ (pipelines.ts handleGetPipelineForecast :
-- deal_value × stage.probability, route GET /api/pipelines/:id/forecast, vue
-- ForecastView.tsx — testé) mais NAÏF : date de close SIMULÉE +90j, pas de
-- projection de tendance, pas de group-by commercial/source, pas d'objectifs/
-- quotas, pas de scénarios. CE LOT NE RÉÉCRIT PAS l'existant — il AJOUTE (a) un
-- moteur de forecast enrichi (DÉTERMINISTE, offline-safe, ZÉRO LLM — Phase B) et
-- (b) cette table NEUVE `forecast_targets` pour stocker les objectifs/quotas.
--
-- ⚠ NE PAS casser handleGetPipelineForecast (pipelines.ts) ni sa route
--   /api/pipelines/:id/forecast ni ForecastView.tsx/Pipeline.tsx (vivants,
--   testés). Le moteur enrichi est SERVI par des routes NEUVES /api/forecast*,
--   table NEUVE — aucune collision.
--
-- ⚠ ENUMS validés CÔTÉ HANDLER (whitelist JS), JAMAIS par CHECK SQL :
--     group_by ∈ 'month' | 'rep' | 'source'
--     scenario ∈ 'best' | 'likely' | 'worst'
--   Valeur hors-liste ⇒ rejet HANDLER (jamais persisté). Aucune contrainte SQL.
--
-- ⚠ BORNAGE TENANT — chaque ligne porte `client_id` (NULLABLE au schéma, TOUJOURS
--   renseigné par les handlers depuis l'auth, JAMAIS le body). `agency_id`
--   NULLABLE (mode agence optionnel). `pipeline_id` / `assigned_to` NULLABLES :
--   null = objectif GLOBAL du tenant (tous pipelines) ou de l'ÉQUIPE (tous
--   commerciaux). Aucune nouvelle capability : `reports.view` (déjà dans
--   ALL_CAPABILITIES) suffit — ZÉRO ajout.
--
-- depends_on : migration-conversion-scoring-seq113.sql (seq 113 — dernière
--              migration du manifest avant ce lot ; chaînage SÉQUENTIEL pour
--              l'ordre, AUCUNE dépendance de SCHÉMA réelle sur seq 113). Tables
--              `leads` (seq 1) / `orders` (seq E1) / `conversion_baselines`
--              (seq 113) / `pipeline_stages` (seq 6) existent déjà — référencées
--              en LECTURE par le moteur Phase B, JAMAIS par FK ici.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 1 `CREATE TABLE IF NOT EXISTS` — neuve, idempotente ;
--     - 1 `CREATE INDEX IF NOT EXISTS` — neuf, idempotent.
--   AUCUN NOT NULL forcé. AUCUN CHECK. AUCUNE FK. AUCUN rebuild. AUCUN touch
--   `leads` / `orders` / `pipelines` / `conversion_baselines`.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` sont idempotents
--   (rejeu = no-op). scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-forecast-seq114.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) forecast_targets — objectifs / quotas de revenu par période (period_month
--    'YYYY-MM'). pipeline_id NULLABLE (null = tous pipelines du tenant),
--    assigned_to NULLABLE (null = objectif d'équipe, sinon quota d'un commercial
--    = users.id). target_amount = montant cible en unité MONÉTAIRE (REAL, même
--    unité que leads.deal_value — PAS en cents). Bornage tenant : client_id
--    NULLABLE au schéma, TOUJOURS renseigné par le handler depuis l'auth.
CREATE TABLE IF NOT EXISTS forecast_targets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  pipeline_id TEXT,
  assigned_to TEXT,
  period_month TEXT,
  target_amount REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIF idempotent.
-- Lecture des objectifs d'un tenant pour une période (objectifs vs réalisé).
CREATE INDEX IF NOT EXISTS idx_forecast_targets_client ON forecast_targets(client_id, period_month);

-- NB : 1 CREATE TABLE neuve, 1 INDEX neuf, AUCUN NOT NULL forcé, AUCUN CHECK,
-- AUCUNE FK, AUCUN DROP / RENAME / rebuild / ALTER. Enums group_by/scenario
-- validés HANDLER. NE PAS casser handleGetPipelineForecast (pipelines.ts) ni sa
-- route /api/pipelines/:id/forecast ni ForecastView.tsx. Bornage tenant =
-- client_id partout. ZÉRO ajout ALL_CAPABILITIES (reports.view). Forecast 100%
-- DÉTERMINISTE (ZÉRO LLM). Choix figés docs/LOT-FORECASTING.md §6.
