-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 97 — LOT SCHEDREPORT-A Reporting planifié (squelette transverse)
-- (2026-05-20)
-- 1 table ADDITIVE pour des rapports d'activité ENVOYÉS automatiquement par
-- email à intervalle régulier (digest). Un tenant programme un rapport
-- (cadence weekly|monthly, destinataires) ; un hook cron best-effort traite les
-- rapports échus (next_run_at <= now) et envoie le digest via Resend.
--
-- ⚠ BORNAGE TENANT — client_id / agency_id proviennent TOUJOURS de l'auth
--   (jamais du body). Tout SELECT/UPDATE/DELETE du CRUD est borné
--   `WHERE client_id = ?`. Le digest (Phase B) fera ses PROPRES SELECT bornés
--   `WHERE client_id = ?` (FLAG A1 : ne RÉUTILISE PAS handleReportsOverview qui
--   lit client_id query brut, non borné). Capability protégée 'reports.view'
--   (déjà dans ALL_CAPABILITIES — ZÉRO ajout). Jointures client_id → clients.id
--   / agency_id → agencies.id APPLICATIVES (colonne TEXT, zéro FK).
--
-- ⚠ CRON BEST-EFFORT — le processeur (Phase B) est appelé via
--   ctx.waitUntil(...).catch(()=>undefined) dans scheduled() : un échec isolé
--   n'altère JAMAIS RFM / workflows / broadcasts / cleanup. Échéances avancées
--   en JS pur (computeNextRunAt, format 'YYYY-MM-DD HH:MM:SS' — calque
--   advanceRunAt de ecommerce-subscriptions seq 85).
--
-- ⚠ COLONNES INERTES v1 — dashboard_id (lien vers un dashboard custom) et
--   format (pdf) sont POSÉES mais INERTES en v1 : le digest v1 = activité
--   générique HTML uniquement (SELECT leads bornés). v2 activera dashboard_id /
--   format=pdf. Aucun handler v1 ne s'appuie dessus.
--
-- depends_on : migration-marketplace-seq96.sql (seq 96 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 96). Les jointures vers
--              clients (seq 81) / agencies (seq 19) sont APPLICATIVES (colonne
--              TEXT), zéro FK.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 1 `CREATE TABLE IF NOT EXISTS` NEUVE, idempotente ;
--     - 2 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN ALTER. AUCUN touch clients / agencies / users / admin_sessions /
--   industry_packs / leads / dashboards. AUCUN touch tables E4/E6 régulées.
--   Le CHECK role users seq 59 (rebuild:users) est INTOUCHÉ. AUCUNE table
--   existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures scheduled_reports.client_id → clients.id / .agency_id →
--   agencies.id / .dashboard_id → dashboards.id sont APPLICATIVES, par
--   colonne). PAS de CHECK (additif pur — report_kind / cadence / status / format
--   sont des chaînes posées/validées côté HANDLER, pas par CHECK SQL).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas d'erreur si rejoué).
--   scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Conventions (calque seq 85 product_subscriptions / seq 96 marketplace) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch. PAS de FK. Bornage tenant :
--   `client_id` (+ `agency_id` NULLABLE).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-scheduled-reports-seq97.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) scheduled_reports — UN rapport d'activité programmé. client_id = tenant
--    propriétaire (depuis auth, JAMAIS body), agency_id NULLABLE. report_kind =
--    'activity' (v1, validé HANDLER, pas par CHECK). cadence = 'weekly'|'monthly'
--    (validée HANDLER). day_of_week (0=dimanche..6=samedi, cadence weekly) /
--    day_of_month (1..28, cadence monthly) = ancrage humain INDICATIF (v1 :
--    computeNextRunAt avance simplement de 7 / ~30 jours depuis maintenant).
--    recipients = JSON array d'emails. format = 'html' (v1 ; pdf=v2 INERTE).
--    dashboard_id = lien dashboard custom (v2 INERTE). last_sent_at / next_run_at
--    pilotent le cron. status = 'active'|'paused' (validé HANDLER). Jointures
--    client_id / agency_id / dashboard_id APPLICATIVES (zéro FK).
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT,
  name TEXT,
  dashboard_id INTEGER,
  report_kind TEXT DEFAULT 'activity',
  cadence TEXT DEFAULT 'weekly',
  day_of_week INTEGER, day_of_month INTEGER,
  recipients TEXT,
  format TEXT DEFAULT 'html',
  last_sent_at TEXT, next_run_at TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFS idempotents.
-- Cron : rapports échus (status='active' AND next_run_at<=now) triés par échéance.
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_due ON scheduled_reports(status, next_run_at);
-- CRUD : liste bornée par tenant.
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_client ON scheduled_reports(client_id);

-- NB : 1 table NEUVE (scheduled_reports), 2 INDEX NEUFS, AUCUN ALTER, AUCUNE FK,
-- AUCUN CHECK (report_kind / cadence / status / format validés HANDLER). AUCUN
-- touch clients / agencies / users / admin_sessions / leads / dashboards /
-- tables E4/E6 régulées. AUCUN DROP / RENAME / rebuild. Bornage tenant =
-- client_id (depuis auth JAMAIS body) + agency_id NULLABLE. dashboard_id /
-- format=pdf INERTES v1. datetime('now'). Choix figés docs/LOT-SCHEDREPORT-A.md §6.
