-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 141 — Sprint 46 Subscriptions avancées (trials + proration +
-- pause/resume + dunning + métriques MRR) — Phase A SOLO (Manager-A) — 2026-05-25
--
-- EXTENSION CHIRURGICALE de billing Stripe S22 (seq120) + S31 (seq126). Ce lot
-- ÉTEND les rails SaaS posés Sprint 22 — il NE remplace PAS, NE drop PAS, NE
-- modifie AUCUNE contrainte existante. Les handlers `saas-billing*.ts` /
-- `lib/saas-billing-*.ts` (Sprint 22 / 31) restent INTOUCHÉS — ce lot pose des
-- handlers SÉPARÉS `subscriptions-advanced.ts` + `lib/subscription-engine.ts`.
--
-- Périmètre :
--   - trials configurables (7/14/30 jours) via billing_plans.trial_days +
--     subscriptions.trial_ends_at (déjà posée seq120 — ALTER tolérant rejeu)
--   - proration upgrades/downgrades (calcul HANDLER pure subscription-engine)
--   - dunning smart retries (1d / 3d / 7d) — schedule HANDLER, persisté sur
--     subscriptions.dunning_attempts + next_dunning_at + dunning_log_json
--   - pause/resume — subscriptions.paused_at / paused_until + billing_plans.allow_pause
--   - métriques MRR/ARR/churn — table mrr_snapshots calculée par cron
--   - history audit — table subscription_changes (toute mutation tracée)
--
-- depends_on (manifest) :
--   - migration-community-seq140.sql           (chaînage SÉQUENTIEL ordre manifest)
--   - migration-billing-stripe-mock-seq120.sql (subscriptions + billing_plans existants)
--   - migration-billing-stripe-live-seq126.sql (rails Stripe live optionnels)
--
-- ⚠ 100% STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une contrainte existante. Ce lot N'AJOUTE QUE :
--     - 7 `ALTER TABLE subscriptions ADD COLUMN`  (nullable / DEFAULT safe)
--     - 3 `ALTER TABLE billing_plans ADD COLUMN`  (nullable / DEFAULT safe)
--     - 2 `CREATE TABLE IF NOT EXISTS` neuves   (subscription_changes, mrr_snapshots)
--     - 3 `CREATE INDEX IF NOT EXISTS` neufs    (idempotents)
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Les
--   jointures subscription_changes.subscription_id → subscriptions.id /
--   mrr_snapshots.client_id → clients.id sont APPLICATIVES, par colonne TEXT.
--   PAS de CHECK SQL (additif pur — enums change_type / cancellation_policy
--   validés HANDLER, pas SQL).
--
-- Stripe live : flag `BILLING_LIVE_ENABLED` reste INACTIF par défaut (cf.
--   docs/LOT-BILLING-STRIPE-LIVE.md §6.9 / §"Activation graduée par tenant").
--   Tant que flag tenant absent → handlers retournent `mock:true`. Aucune
--   colonne stripe_* ajoutée — réutilisation chirurgicale des colonnes seq120.
--
-- Capabilities FIGÉES (AUCUN ajout à ALL_CAPABILITIES seq 80) :
--   - admin : `settings.manage` partout (toutes mutations + dunning cron +
--             mrr snapshot cron + history read)
--   - (PAS d'endpoint member-facing dans S46 — toutes routes admin)
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent. `ALTER TABLE ADD COLUMN`
--   n'est PAS nativement IF NOT EXISTS dans SQLite — si rejoué après succès,
--   le runner (scripts/migrate.ts) absorbe l'erreur "duplicate column name"
--   (calque ALTER seq 79 / seq 80 / seq 140).
--   ⚠ NB : subscriptions.trial_ends_at est DÉJÀ posée seq120. L'ALTER ci-dessous
--   est NO-OP au rejeu (duplicate column ignorée) — c'est intentionnel :
--   on garde l'ADD COLUMN pour idempotence sur DB neuve, et le runner absorbe
--   le duplicate sur DB déjà migrée.
--
-- Conventions (calque seq 120 / seq 140) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT DEFAULT
--   (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement, PAS de FK.
--   Money en cents INTEGER, devise locked 'CAD' pour V1 (cohérence seq120).
--   Multi-tenant : client_id sur tables tenant-scopées, agency_id NULL pour
--   snapshots SaaS agency-scoped optionnels.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-subscriptions-advanced-seq141.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- ── Extension subscriptions (seq19 → seq120) — 7 colonnes ADDITIVES ────────
-- trial_ends_at : DÉJÀ posée seq120, ALTER ci-dessous NO-OP au rejeu (runner
-- absorbe duplicate column). Conservé pour idempotence DB neuve.
ALTER TABLE subscriptions ADD COLUMN trial_ends_at TEXT;
-- Montant prorata appliqué lors d'un upgrade/downgrade au milieu de période
-- (positif = crédit dû au client, négatif = surcharge facturée). Calcul HANDLER.
ALTER TABLE subscriptions ADD COLUMN prorated_amount_cents INTEGER DEFAULT 0;
-- Pause/resume : si paused_at != NULL ⇒ subscription en pause. paused_until
-- NULL = pause indéfinie (resume manuel requis). Sinon = auto-resume à la date.
ALTER TABLE subscriptions ADD COLUMN paused_at TEXT;
ALTER TABLE subscriptions ADD COLUMN paused_until TEXT;
-- Dunning : tentatives consécutives échouées + log JSON détaillé +
-- timestamp du prochain retry planifié (calcul HANDLER : 1d / 3d / 7d).
ALTER TABLE subscriptions ADD COLUMN dunning_attempts INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN dunning_log_json TEXT;
ALTER TABLE subscriptions ADD COLUMN next_dunning_at TEXT;

-- ── Extension billing_plans (seq120) — 3 colonnes ADDITIVES ────────────────
-- Durée du trial pour ce plan (0 = pas de trial). Lu HANDLER au provisioning.
ALTER TABLE billing_plans ADD COLUMN trial_days INTEGER DEFAULT 0;
-- Flag : ce plan autorise-t-il pause/resume ? Par défaut OUI (1) — admin peut
-- désactiver via UPDATE billing_plans (cap settings.manage HANDLER).
ALTER TABLE billing_plans ADD COLUMN allow_pause INTEGER DEFAULT 1;
-- Politique d'annulation par défaut pour ce plan. Enum HANDLER (pas CHECK SQL) :
--   - 'immediate'      : cancel direct + reset accès
--   - 'end_of_period'  : cancel_at_period_end=1, accès jusqu'à fin période
-- Default 'end_of_period' (UX douce). Override possible /cancel?policy=immediate.
ALTER TABLE billing_plans ADD COLUMN cancellation_policy TEXT DEFAULT 'end_of_period';

-- ── 1) subscription_changes — history audit toutes mutations subscription ──
-- Toute mutation (upgrade/downgrade/pause/resume/trial_start/trial_end/
-- dunning_attempt/cancel/reactivate) écrit une ligne ici via le HANDLER. Permet
-- UI history + audit conformité + analytics churn cohort.
-- change_type enum HANDLER (whitelist verrouillée subscription-engine.ts) :
--   upgrade | downgrade | pause | resume | trial_start | trial_end |
--   dunning_attempt | cancel | reactivate
-- effective_at : moment où le changement prend effet (peut être futur pour
--   end_of_period). reason : texte libre admin (cap settings.manage), capé
--   HANDLER 500 chars. metadata_json : payload libre (proration breakdown,
--   dunning response Stripe, etc.).
CREATE TABLE IF NOT EXISTS subscription_changes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  subscription_id TEXT NOT NULL,
  client_id TEXT,
  change_type TEXT,
  from_plan_id TEXT,
  to_plan_id TEXT,
  prorated_amount_cents INTEGER DEFAULT 0,
  effective_at TEXT,
  reason TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 2) mrr_snapshots — calc périodique pour analytics (MRR/ARR/churn) ──────
-- Snapshot quotidien (cron /api/billing/cron/mrr-snapshot) du Monthly
-- Recurring Revenue + Annual Run Rate + actifs/nouveaux/churned. Calcul
-- HANDLER (subscription-engine.computeMrr) — agrège subscriptions actives,
-- prorata trial/pause. UNIQUE par (client_id, snapshot_date) — upsert idempotent.
-- agency_id NULL = snapshot tenant-scope ; non-NULL = snapshot agency-scope SaaS.
-- currency = devise locked 'CAD' V1 (cohérence seq120 — V2 multi-currency E6).
CREATE TABLE IF NOT EXISTS mrr_snapshots (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  snapshot_date TEXT NOT NULL,
  mrr_cents INTEGER DEFAULT 0,
  arr_cents INTEGER DEFAULT 0,
  active_subscriptions INTEGER DEFAULT 0,
  new_subscriptions INTEGER DEFAULT 0,
  churned_subscriptions INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'CAD',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── Index ADDITIFs idempotents ─────────────────────────────────────────────
-- Lookup history mutations pour une subscription donnée, trié chronologique
-- (UI panel "Historique abonnement").
CREATE INDEX IF NOT EXISTS idx_subscription_changes_sub
  ON subscription_changes(subscription_id, created_at);

-- Lookup history mutations tenant-wide (audit cross-subscriptions + analytics
-- churn cohort par client).
CREATE INDEX IF NOT EXISTS idx_subscription_changes_client_created
  ON subscription_changes(client_id, created_at);

-- UNIQUE snapshot — empêche double-insertion sur même jour pour même client
-- (cron idempotent via INSERT OR IGNORE / INSERT OR REPLACE HANDLER).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mrr_snapshots_date
  ON mrr_snapshots(client_id, snapshot_date);

-- NB : 7 ALTER additifs subscriptions (trial_ends_at NO-OP rejeu, prorated_amount_cents,
-- paused_at, paused_until, dunning_attempts, dunning_log_json, next_dunning_at),
-- 3 ALTER additifs billing_plans (trial_days, allow_pause, cancellation_policy),
-- 2 tables NEUVES (subscription_changes, mrr_snapshots), 3 INDEX NEUFS
-- (2 lookup + 1 UNIQUE upsert cron). AUCUNE FK, AUCUN CHECK, AUCUN DROP /
-- RENAME / rebuild. NE TOUCHE PAS aux handlers saas-billing-*.ts / lib/saas-billing-*.ts
-- existants (Sprint 22 / 31) — handlers NEUFS dans subscriptions-advanced.ts +
-- lib/subscription-engine.ts. Capabilities FIGÉES settings.manage admin partout
-- (AUCUN ajout ALL_CAPABILITIES seq 80). Stripe live INACTIF par défaut — flag
-- BILLING_LIVE_ENABLED tenant-by-tenant inchangé. Choix figés docs/LOT-SUBSCRIPTIONS-ADV-S46.md §6.
