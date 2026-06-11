-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 115 — SPRINT 15 « Reports builder — templates + planif dashboard
-- custom » (2026-05-22)
-- Le Reports builder existe DÉJÀ à ~85% : DashboardBuilder.tsx (drag-drop 8 visus)
-- + handleRunReportWidget (moteur whitelist anti-injection, reports.ts:644) +
-- table `dashboards` (seq 51) + dashboards.ts (CRUD/share) + scheduled-reports.ts
-- (cron digest) + pdfExport. CE LOT NE RECONSTRUIT RIEN — il AJOUTE (a) cette
-- table NEUVE `report_templates` (catalogue de modèles clonables) ; (b) côté
-- HANDLER Phase B, l'activation de `scheduled_reports.dashboard_id` (POSÉ seq 97
-- mais INERTE — le cron envoie buildActivityDigestHtml générique, jamais le rendu
-- d'un dashboard sauvegardé) en RÉTRO-COMPAT (fallback si dashboard_id NULL).
--
-- ⚠ config = JSON {cols, widgets[]} au format DashboardBuilderValue (cf.
--   src/components/reports/DashboardBuilder.tsx : { cols: number; widgets:
--   WidgetConfig[] }), CLONABLE tel quel dans `dashboards.config`. Le clone passe
--   par un HANDLER qui VALIDE le JSON (réutilise les whitelists ALLOWED_SOURCES/
--   DIMENSION/METRIC de reports.ts) AVANT INSERT — JAMAIS de SQL libre.
--
-- ⚠ BORNAGE TENANT — client_id / agency_id proviennent TOUJOURS de l'auth (JAMAIS
--   du body). client_id / agency_id NULL = template SYSTÈME global (is_system=1,
--   visible de tous les tenants en LECTURE). category = chaîne validée HANDLER
--   (whitelist JS), JAMAIS par CHECK SQL. Aucune nouvelle capability : lecture
--   `reports.view` / écriture-clone `workflows.manage` (calque dashboards.ts:387 —
--   PAS de `reports.manage` qui n'existe pas). ZÉRO ajout à ALL_CAPABILITIES.
--
-- depends_on : migration-forecast-seq114.sql (seq 114 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 114). La jointure
--              report_templates.client_id → clients.id / .agency_id → agencies.id
--              est APPLICATIVE (colonne TEXT), zéro FK. La table `dashboards`
--              (seq 51) — cible du clone — est INTOUCHÉE (clone par INSERT via
--              handleCreateDashboard, jamais ALTER).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 1 `CREATE TABLE IF NOT EXISTS` — neuve, idempotente ;
--     - 1 `CREATE INDEX IF NOT EXISTS` — neuf, idempotent.
--   AUCUN NOT NULL forcé. AUCUN CHECK (category validé HANDLER). AUCUNE FK
--   (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). AUCUN rebuild. AUCUN
--   touch `dashboards` / `scheduled_reports` / `clients` / `agencies` / `users` /
--   `admin_sessions` / tables E4/E6 régulées.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` sont idempotents
--   (rejeu = no-op). scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Conventions (calque seq 97 scheduled_reports / seq 88 reports-d) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch. PAS de FK. Bornage tenant :
--   `client_id` (+ `agency_id` NULLABLE). client_id/agency_id NULL = système.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-reporttemplates-seq115.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) report_templates — UN modèle de dashboard clonable (catalogue). client_id /
--    agency_id NULL ⇒ template SYSTÈME global (is_system=1, lecture pour tous les
--    tenants) ; renseignés ⇒ template propre au tenant (depuis auth, JAMAIS body).
--    name / description = libellés affichés. category = regroupement (ex
--    'sales'|'marketing'|'support'… — validé HANDLER, PAS par CHECK). config =
--    JSON {cols, widgets[]} au format DashboardBuilderValue, CLONÉ tel quel dans
--    dashboards.config par le handler (après validation whitelist). is_system =
--    0|1 (1 = catalogue système non éditable par le tenant). Jointures client_id /
--    agency_id APPLICATIVES (zéro FK).
CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  name TEXT,
  description TEXT,
  category TEXT,
  config TEXT,
  is_system INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIF idempotent.
-- Lecture : templates visibles d'un tenant (scope agence + sous-compte). Les
-- templates système (client_id / agency_id NULL) sont lus à part par le handler.
CREATE INDEX IF NOT EXISTS idx_report_templates_scope ON report_templates(agency_id, client_id);

-- NB : 1 CREATE TABLE neuve, 1 INDEX neuf, AUCUN NOT NULL forcé, AUCUN CHECK
-- (category validé HANDLER), AUCUNE FK, AUCUN DROP / RENAME / rebuild / ALTER.
-- AUCUN touch dashboards (seq 51) / scheduled_reports (seq 97) / clients /
-- agencies / users / tables E4/E6 régulées. Le clone d'un template = config JSON
-- VALIDÉE HANDLER (whitelists reports.ts réutilisées) → INSERT dans
-- dashboards.config via handleCreateDashboard, JAMAIS de SQL libre. Bornage
-- tenant = client_id / agency_id (depuis auth JAMAIS body) ; NULL = système.
-- L'activation de scheduled_reports.dashboard_id (inerte seq 97) est CÔTÉ HANDLER
-- (Phase B Manager-B : buildDashboardDigestHtml, rétro-compat fallback
-- buildActivityDigestHtml). datetime('now'). Capabilities reports.view (lecture) /
-- workflows.manage (clone). Choix figés docs/LOT-REPORT-TEMPLATES.md §6.
