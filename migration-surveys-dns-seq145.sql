-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 145 — Sprint 50 Surveys avancés + DNS records UI (LOT 5 FIN)
-- (Manager-A SOLO) — 2026-05-25
--
-- DERNIER LOT du PROGRAMME GIGA-PLAN. Deux modules indépendants livrés ensemble
-- pour boucler la roadmap V1 :
--
--   1) Surveys avancés — questionnaires multi-pages avec branching logic
--      conditionnel, NPS scores (Net Promoter Score -100..+100), CSAT
--      (Customer Satisfaction), question types variés (text, multiple_choice,
--      rating, nps, csat, date). DISTINCT du module Forms (S5, seq106) qui
--      est single-step capture de leads. Les surveys sont des questionnaires
--      d'engagement post-vente / mesure de satisfaction, multi-pages,
--      branching (saut conditionnel q→q ou jump_to_end). Agrégats NPS
--      pré-calculés périodiquement (rolling 30/60/90j) dans `nps_aggregates`
--      (engine `survey-engine.aggregateNpsForPeriod` Phase B / cron).
--
--   2) Custom domains + DNS records UI — white-label complet par client.
--      `custom_domains` existait déjà via S(G3) seq94 sub-accounts (whitelabel
--      basique), MAIS sans gestion DNS records ni provisioning Cloudflare
--      for SaaS. Cette migration AJOUTE une nouvelle table `custom_domains`
--      (NOMMÉE DIFFÉREMMENT — pas de collision avec table éventuelle S94 :
--      le set seq94 ne définit PAS de table `custom_domains` mais une colonne
--      `clients.custom_domain` ; à vérifier au Phase B avant câblage final).
--      Si une table `custom_domains` neuve existe déjà côté D1, le
--      `CREATE TABLE IF NOT EXISTS` est idempotent (NO-OP). `dns_records`
--      est NEUVE (aucun antécédent).
--
-- depends_on (manifest) :
--   - migration-affiliates-seq144.sql (chaînage SÉQUENTIEL manifest)
--
-- ⚠ 100 % STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / FK
--   destructrice / CHECK contraint. Ce lot N'AJOUTE QUE :
--     - 8 `CREATE TABLE IF NOT EXISTS` neuves
--         (surveys, survey_questions, survey_branches, survey_responses,
--          survey_response_answers, nps_aggregates, custom_domains,
--          dns_records)
--     - 9 `CREATE INDEX IF NOT EXISTS` neufs (1 UNIQUE composite + 8 lookup)
--     - AUCUN `ALTER TABLE` (aucune table existante touchée).
--   AUCUNE FK SQL (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Les
--   jointures survey_id / question_id / response_id / domain_id /
--   affiliate_id / client_id sont APPLICATIVES, par colonne TEXT. PAS de CHECK
--   SQL (additif pur — enums type / status / ssl_status / dns type validés
--   HANDLER survey-engine.ts + dns-engine.ts).
--
-- Capabilities FIGÉES (AUCUN ajout à ALL_CAPABILITIES seq 80) :
--   - settings.manage : Surveys CRUD + questions + branches + responses
--                       list/detail + NPS aggregates compute, Custom domains
--                       CRUD + verify + DNS records CRUD + sync Cloudflare.
--                       Action sensible (white-label modifie la résolution
--                       DNS d'un tenant — escalade vs clients.manage).
--   - PUBLIC (pré-requireAuth) : POST /api/public/surveys/:id/submit
--                       (visitor répond au questionnaire — rate-limit +
--                       honeypot HANDLER, calque /api/public/affiliates/
--                       track-click + /api/public/preorders).
--
-- TOLÉRANCE rejeu — exécution best-effort partielle :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent. Le tracker
--   `_migrations` empêche le rejeu en environnement production
--   (migrate.ts:applyMigration).
--
-- Conventions (calque seq 144 / seq 143 / seq 92) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT DEFAULT
--   (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement, PAS de FK.
--   Multi-tenant : client_id sur TOUTES les tables tenant-scopées (defense-in-
--   depth IDOR — bornage WHERE client_id = ? au HANDLER). Denorm client_id sur
--   tables d'association (survey_responses.client_id, nps_aggregates.client_id)
--   pour query plan rapide sans jointure cross-tenant.
--
-- Flag PUBLIC submit : rate-limit bucket `survey_submit:<ip>` 10/3600s
--   (calque /api/public/preorders). Honeypot champ `website` HANDLER. PII
--   Loi 25 : ip_hash (SHA256, pas brut), respondent_email OPT-IN HANDLER.
--
-- Cloudflare for SaaS — flag INACTIF V1 :
--   `custom_domains.cloudflare_zone_id` + `dns_records.cloudflare_record_id`
--   PRÉSENTS mais flag INACTIF (env.CLOUDFLARE_API_TOKEN absent ⇒
--   provisionCloudflareForSaas() retourne { zone_id: null, ssl_status: 'pending' }
--   et reste à 'pending'). Phase B câblera l'API Cloudflare réelle.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-surveys-dns-seq145.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) surveys — Questionnaires (NPS / CSAT / standard / custom) ──────────
-- type validé HANDLER (standard|nps|csat|custom — survey-engine.SURVEY_TYPES).
-- is_published 0|1, published_at TEXT (ISO) au flip publish. target_audience_json
-- = JSON serialized config (segment_id, lead_status, tags, etc. — Phase B).
CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'standard',
  is_published INTEGER DEFAULT 0,
  published_at TEXT,
  target_audience_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── 2) survey_questions — Questions d'un survey (multi-pages + ordering) ──
-- type validé HANDLER (text|multiple_choice|rating|nps|csat|date —
-- survey-engine.QUESTION_TYPES). options_json = JSON serialized choix
-- (multiple_choice → ["A","B","C"], rating → {min:1,max:5}, nps → {scale:10},
-- csat → {scale:5}). required 0|1. page_number ≥ 1 pour split multi-pages.
-- order_index : ordre intra-page (ASC).
CREATE TABLE IF NOT EXISTS survey_questions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  survey_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  type TEXT,
  options_json TEXT,
  required INTEGER DEFAULT 0,
  order_index INTEGER DEFAULT 0,
  page_number INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 3) survey_branches — Branching logic conditionnelle ───────────────────
-- Pour chaque question, N branches : si la réponse égale `condition_value`,
-- aller à `next_question_id` (ou jump_to_end=1 pour terminer le survey).
-- condition_value TEXT (compare textuelle HANDLER — pour multiple_choice :
-- valeur du choix ; pour rating/nps/csat : score stringifié). Si plusieurs
-- branches matchent : 1ère (ORDER BY rowid) gagne. Si aucune branche match :
-- question suivante par order_index (HANDLER `resolveNextQuestion`).
CREATE TABLE IF NOT EXISTS survey_branches (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id TEXT NOT NULL,
  condition_value TEXT,
  next_question_id TEXT,
  jump_to_end INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 4) survey_responses — Sessions de réponse (1 par respondent) ──────────
-- client_id DÉNORM (defense-in-depth IDOR : bornage tenant sans jointure
-- surveys). respondent_email + respondent_name OPT-IN (anonyme par défaut).
-- ip_hash SHA256 (PII Loi 25, pas brut). status enum HANDLER (in_progress|
-- completed|abandoned — survey-engine.RESPONSE_STATUSES). completed_at posé
-- au submit final (dernière page ou jump_to_end).
CREATE TABLE IF NOT EXISTS survey_responses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  survey_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  respondent_email TEXT,
  respondent_name TEXT,
  ip_hash TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT DEFAULT 'in_progress',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 5) survey_response_answers — Réponses individuelles aux questions ─────
-- answer_text TEXT (text/multiple_choice/date) + answer_value INTEGER
-- (rating/nps/csat — typed numeric pour agrégats SQL rapides). 1 row par
-- (response_id, question_id). Pas d'UNIQUE composite (HANDLER assure
-- l'idempotence via upsert applicatif Phase B).
CREATE TABLE IF NOT EXISTS survey_response_answers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  response_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer_text TEXT,
  answer_value INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 6) nps_aggregates — Agrégats NPS pré-calculés (rolling 30/60/90j) ─────
-- 1 row par (client_id, survey_id, period_days, calculated_at). Calcul cron
-- périodique HANDLER (survey-engine.aggregateNpsForPeriod) — Phase B câblera
-- un scheduled cron. nps_score ∈ [-100..+100] = % promoteurs (9-10) - %
-- détracteurs (0-6). passives = 7-8.
CREATE TABLE IF NOT EXISTS nps_aggregates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  survey_id TEXT NOT NULL,
  period_days INTEGER,
  promoters_count INTEGER DEFAULT 0,
  passives_count INTEGER DEFAULT 0,
  detractors_count INTEGER DEFAULT 0,
  total_responses INTEGER DEFAULT 0,
  nps_score INTEGER DEFAULT 0,
  calculated_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 7) custom_domains — Domaines white-label par client (Cloudflare for SaaS)
-- 1 domain par row, unicité globale (UNIQUE INDEX uniq_custom_domains_domain
-- ci-dessous : un même domaine ne peut servir qu'un seul tenant). status
-- enum HANDLER (pending|verified|active|failed — dns-engine.DOMAIN_STATUSES).
-- verification_token = token DNS TXT à poser par le client (vérifie
-- ownership). cloudflare_zone_id rempli au verify (Phase B). ssl_status
-- (pending|provisioned|failed) — provisioning auto via Cloudflare for SaaS
-- Phase B.
CREATE TABLE IF NOT EXISTS custom_domains (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  cloudflare_zone_id TEXT,
  verification_token TEXT,
  verified_at TEXT,
  ssl_status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── 8) dns_records — Records DNS d'un custom domain (push to Cloudflare) ──
-- type validé HANDLER (A|AAAA|CNAME|MX|TXT|SRV — dns-engine.DNS_RECORD_TYPES).
-- proxied 0|1 (orange cloud Cloudflare — applicable à A/AAAA/CNAME).
-- priority requis pour MX/SRV. cloudflare_record_id rempli au sync API
-- (Phase B). ttl 3600 par défaut (1h — convention Cloudflare).
CREATE TABLE IF NOT EXISTS dns_records (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  domain_id TEXT NOT NULL,
  type TEXT,
  name TEXT,
  content TEXT,
  ttl INTEGER DEFAULT 3600,
  priority INTEGER,
  proxied INTEGER DEFAULT 0,
  cloudflare_record_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── Index ADDITIFs idempotents ─────────────────────────────────────────────

-- Lookup surveys d'un tenant publiés / drafts (UI ListSurveys + filtre).
CREATE INDEX IF NOT EXISTS idx_surveys_client
  ON surveys(client_id, is_published);

-- Lookup questions d'un survey ordonnées (UI SurveyEditor + runtime player).
CREATE INDEX IF NOT EXISTS idx_survey_questions_survey
  ON survey_questions(survey_id, order_index);

-- Lookup branches d'une question (HANDLER resolveNextQuestion — chaud).
CREATE INDEX IF NOT EXISTS idx_survey_branches_question
  ON survey_branches(question_id);

-- Lookup réponses d'un survey par statut (UI dashboard completion rate +
-- cron abandonment cleanup).
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey_status
  ON survey_responses(survey_id, status);

-- Lookup answers d'une session de réponse (UI ResponseDetail + agrégats NPS).
CREATE INDEX IF NOT EXISTS idx_survey_response_answers_response
  ON survey_response_answers(response_id);

-- Lookup NPS aggregates d'un tenant par période (UI dashboard NPS trend +
-- cron compute périodique).
CREATE INDEX IF NOT EXISTS idx_nps_aggregates_client_period
  ON nps_aggregates(client_id, period_days, calculated_at);

-- UNIQUE domaine global (1 domain = 1 tenant — la résolution DNS partage le
-- nom DNS). NB : l'unicité du champ TEXT est sensible à la casse — HANDLER
-- normalise en lowercase avant insert (dns-engine.normalizeDomain).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_custom_domains_domain
  ON custom_domains(domain);

-- Lookup custom domains d'un client par statut (UI DomainsManager + cron
-- verify pending).
CREATE INDEX IF NOT EXISTS idx_custom_domains_client
  ON custom_domains(client_id, status);

-- Lookup DNS records d'un domain par type (UI DnsRecordsTable groupé par
-- type + sync API Cloudflare).
CREATE INDEX IF NOT EXISTS idx_dns_records_domain
  ON dns_records(domain_id, type);

-- NB : 8 tables NEUVES, 0 ALTER, 9 INDEX NEUFS (1 UNIQUE + 8 lookup). AUCUNE
-- FK, AUCUN CHECK, AUCUN DROP / RENAME / rebuild. Tous les enums (survey.type,
-- question.type, response.status, domain.status, record.type, ssl_status)
-- validés HANDLER (survey-engine.ts + dns-engine.ts). Capabilities FIGÉES :
-- settings.manage (surveys + custom_domains + dns_records) + PUBLIC (survey
-- submit rate-limit + honeypot HANDLER). AUCUN ajout ALL_CAPABILITIES seq 80.
-- i18n parité STRICTE 4 catalogues (en, fr-CA, fr-FR, es). Choix figés
-- docs/LOT-SURVEYS-DNS-S50.md §6.
