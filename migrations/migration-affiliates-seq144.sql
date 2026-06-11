-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 144 — Sprint 49 Affiliates / Referrals (programme parrainage v2)
-- (Manager-A) — 2026-05-25
--
-- EXTENSION du module affiliation natif S(G2) (seq92) — passage d'un modèle
-- "lead-based commissions manual payout" à un modèle "order-based affiliate
-- program avec tiers (starter|silver|gold), link click tracking, commission
-- automatique par order completed, payouts mensuels en batch". Trois axes :
--
--   1) Affiliés enrichis — `affiliates` (table S92) ÉTENDUE par ALTER ADD COLUMN
--      (additif pur, IDEMPOTENT en cas de rejeu). Nouvelles colonnes :
--      customer_id (lien customer existant V1 e-commerce), tier (enum HANDLER
--      starter|silver|gold), commission_pct (5/10/15%), total_commissions_cents
--      + total_referrals_count (cache UI), payout_method (manual|stripe_connect
--      — flag stripe_connect INACTIF V1), payout_account_ref (token Stripe
--      Connect futur). UNIQUE INDEX (client_id, code) garantit unicité du code
--      affilié par tenant (override de l'unicité applicative S92).
--
--   2) Referrals order-based — `affiliate_referrals` (table S92) ÉTENDUE par
--      ALTER ADD COLUMN. Nouvelles colonnes : order_id (FK applicative orders),
--      customer_id (résolu via order.customer_id), commission_cents (calculé
--      SERVEUR au order completed via affiliate-engine.computeCommissionForOrder),
--      status enum HANDLER (pending|confirmed|paid|reversed), confirmed_at,
--      paid_at, payout_id (FK applicative affiliate_payouts), client_id denorm
--      (pour bornage tenant rapide). v1 garde aussi la colonne legacy lead_id
--      (S92) INTOUCHÉE — coexistence des 2 modèles le temps de la migration.
--
--   3) Payouts batch — `affiliate_payouts` (table NEUVE) gère les versements
--      mensuels regroupant les referrals confirmés. Status enum HANDLER
--      (pending|paid|failed). stripe_transfer_id colonne PRÉSENTE mais flag
--      INACTIF V1 (payout manuel admin marque paid + export CSV). Phase B
--      câblera Stripe Connect réel.
--
--   4) Click tracking enrichi — `affiliate_clicks` (table S92) ÉTENDUE par
--      ALTER ADD COLUMN : visitor_id (UUID cookie 1st-party), source_url
--      (referer HTTP), landing_page (page d'atterrissage), ip_hash (PII Loi 25
--      — hash SHA256 IP, pas l'IP brute), user_agent_hash (idem), country
--      (Cf-IPCountry), converted_order_id (FK applicative orders au moment du
--      checkout), converted_at. La colonne legacy ip (clair S92) coexiste —
--      Phase B migrera vers ip_hash exclusif.
--
--   5) Attribution orders — `orders` (table seq58) ÉTENDUE par ALTER ADD
--      COLUMN : referred_by_affiliate_id (FK applicative affiliates), referral_code
--      (snapshot code utilisé au moment du checkout — debug + idempotence).
--      Hook posé via affiliate-engine.attributeOrderToAffiliate() appelé sur
--      order completed (Phase B).
--
-- depends_on (manifest) :
--   - migration-b2b-bundles-preorders-seq143.sql (chaînage SÉQUENTIEL manifest)
--   - migration-sprintE1-m1-ecommerce-schema.sql (orders + customers existants)
--
-- ⚠ 100 % STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / FK
--   destructrice / CHECK contraint. Ce lot N'AJOUTE QUE :
--     - 1 `CREATE TABLE IF NOT EXISTS` neuve  (affiliate_payouts)
--     - N `ALTER TABLE ... ADD COLUMN`        (affiliates +9 / affiliate_referrals
--                                              +8 / affiliate_clicks +7 /
--                                              orders +2). SQLite ne supporte
--                                              PAS `IF NOT EXISTS` sur ADD
--                                              COLUMN — la migration est donc
--                                              SENSIBLE au rejeu (D1 lèvera
--                                              "duplicate column name" en rejeu).
--                                              MITIGATION : le tracker
--                                              `_migrations` SQL bloque le
--                                              rejeu (migrate.ts:applyMigration).
--                                              Pour environnement local sans
--                                              tracker, drop la table avant
--                                              rejeu.
--     - 8 `CREATE INDEX IF NOT EXISTS` neufs   (idempotents — 7 lookup
--                                              + 1 UNIQUE composite)
--   AUCUNE FK SQL (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Les
--   jointures customer_id / order_id / payout_id / converted_order_id /
--   referred_by_affiliate_id sont APPLICATIVES, par colonne TEXT. PAS de CHECK
--   SQL (additif pur — enums tier / status validés HANDLER affiliate-engine.ts).
--
-- Capabilities FIGÉES (AUCUN ajout à ALL_CAPABILITIES seq 80) :
--   - clients.manage : affiliates CRUD + metrics, referrals list + confirm +
--                      reverse, click tracking lecture.
--   - settings.manage : payouts list + createPayoutBatch + markPayoutPaid
--                       (action sensible — escalade capability vs CRUD courant).
--   - PUBLIC (pré-requireAuth) : POST /api/public/affiliates/signup
--                      (visitor opt-in programme affiliation), POST
--                      /api/public/affiliates/track-click (script tracking
--                      site marchand — log click anonyme). Rate-limit
--                      HANDLER (calque /api/public/preorders).
--
-- TOLÉRANCE rejeu — exécution best-effort partielle :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent. Les `ALTER TABLE ADD
--   COLUMN` lèvent "duplicate column name" en rejeu — c'est ATTENDU. Le
--   tracker `_migrations` empêche le rejeu en environnement production
--   (migrate.ts:applyMigration).
--
-- Conventions (calque seq 143 / seq 142 / seq 92) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT DEFAULT
--   (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement, PAS de FK.
--   Money en cents INTEGER, devise locked 'CAD' V1. Multi-tenant : client_id
--   sur TOUTES les tables tenant-scopées (defense-in-depth IDOR — bornage
--   WHERE client_id = ? au HANDLER). Denorm client_id sur tables d'association
--   (affiliate_referrals.client_id, affiliate_payouts.client_id) pour query
--   plan rapide sans jointure cross-tenant.
--
-- Flag PUBLIC signup + track-click : rate-limit buckets
--   `aff_signup:<ip>` 3/3600s + `aff_click:<ip>` 60/60s (calque
--   /api/public/preorders + /api/public/tickets). Honeypot champ `website`
--   HANDLER. PII Loi 25 : ip_hash + user_agent_hash (SHA256, pas brut).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-affiliates-seq144.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) ALTER affiliates (table S92) — ajoute colonnes Sprint 49 ────────────
-- Colonnes additives. Tier + commission_pct résolus HANDLER
-- (affiliate-engine.computeCommissionForOrder) — pas de CHECK SQL. UNIQUE
-- INDEX (client_id, code) ajouté plus bas garantit unicité du code par tenant.
ALTER TABLE affiliates ADD COLUMN customer_id TEXT;
ALTER TABLE affiliates ADD COLUMN tier TEXT DEFAULT 'starter';
ALTER TABLE affiliates ADD COLUMN commission_pct REAL DEFAULT 0.05;
ALTER TABLE affiliates ADD COLUMN total_commissions_cents INTEGER DEFAULT 0;
ALTER TABLE affiliates ADD COLUMN total_referrals_count INTEGER DEFAULT 0;
ALTER TABLE affiliates ADD COLUMN payout_method TEXT DEFAULT 'manual';
ALTER TABLE affiliates ADD COLUMN payout_account_ref TEXT;

-- ── 2) ALTER affiliate_referrals (table S92) — ajoute colonnes order-based ─
-- Colonnes additives. Le modèle S92 (lead_id) coexiste avec le nouveau
-- (order_id) — le HANDLER décide selon le contexte. status enum HANDLER
-- (pending|confirmed|paid|reversed). client_id denorm pour bornage tenant
-- rapide (defense-in-depth IDOR sans jointure affiliates).
ALTER TABLE affiliate_referrals ADD COLUMN order_id TEXT;
ALTER TABLE affiliate_referrals ADD COLUMN customer_id TEXT;
ALTER TABLE affiliate_referrals ADD COLUMN commission_cents INTEGER DEFAULT 0;
ALTER TABLE affiliate_referrals ADD COLUMN status TEXT DEFAULT 'pending';
ALTER TABLE affiliate_referrals ADD COLUMN confirmed_at TEXT;
ALTER TABLE affiliate_referrals ADD COLUMN paid_at TEXT;
ALTER TABLE affiliate_referrals ADD COLUMN payout_id TEXT;

-- ── 3) ALTER affiliate_clicks (table S92) — enrichi tracking link ─────────
-- Colonnes additives. PII Loi 25 : ip_hash + user_agent_hash (SHA256 HANDLER,
-- pas brut). La colonne legacy `ip` (clair S92) reste pour compat — Phase B
-- migrera vers ip_hash exclusif. visitor_id = UUID cookie 1st-party (set par
-- track-click endpoint).
ALTER TABLE affiliate_clicks ADD COLUMN visitor_id TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN source_url TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN landing_page TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN ip_hash TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN user_agent_hash TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN country TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN converted_order_id TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN converted_at TEXT;
-- `clicked_at` ajouté pour aligner sur la spec S49 (S92 ne posait que `created_at`).
-- Le HANDLER track-click écrit les 2 colonnes (created_at via DEFAULT, clicked_at
-- explicite) — Phase B unifiera.
ALTER TABLE affiliate_clicks ADD COLUMN clicked_at TEXT;

-- ── 4) affiliate_payouts — Batch de versements (TABLE NEUVE) ───────────────
-- Regroupe N referrals confirmés en 1 payout (mensuel typiquement). Status
-- enum HANDLER (pending|paid|failed). `stripe_transfer_id` PRÉSENT mais flag
-- INACTIF V1 (payout manuel admin marque paid + export CSV). Phase B câblera
-- Stripe Connect réel. `period_start` / `period_end` = bornes ISO du batch
-- (datetime ou date).
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  affiliate_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  total_cents INTEGER DEFAULT 0,
  referrals_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  paid_at TEXT,
  stripe_transfer_id TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── 5) ALTER orders (table seq58) — attribution affiliate ─────────────────
-- Colonnes additives. Lien applicatif vers affiliates au moment du checkout
-- (resolve via cookie aff_attr ou ?aff=CODE). Snapshot du code utilisé
-- (debug + idempotence : empêche le re-trigger d'une commission si
-- re-completed).
ALTER TABLE orders ADD COLUMN referred_by_affiliate_id TEXT;
ALTER TABLE orders ADD COLUMN referral_code TEXT;

-- ── Index ADDITIFs idempotents ─────────────────────────────────────────────

-- UNIQUE code par tenant (override de l'unicité applicative S92). Permet
-- l'enforcement SQL d'un code affilié unique par client. NB : un autre
-- tenant peut réutiliser le même code (bornage tenant — distinction client).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_affiliates_client_code
  ON affiliates(client_id, code);

-- Lookup affiliés actifs d'un tenant (UI ListAffiliates + dashboards).
CREATE INDEX IF NOT EXISTS idx_affiliates_client_status
  ON affiliates(client_id, status);

-- Lookup affilié lié à un customer (UI customer detail "Programme affilié").
CREATE INDEX IF NOT EXISTS idx_affiliates_customer
  ON affiliates(customer_id);

-- Lookup referrals d'un affilié par statut (UI MyReferrals + cron payout
-- batch sélection des pending→confirmed).
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_affiliate
  ON affiliate_referrals(affiliate_id, status);

-- Lookup referral par order (attribution + idempotence sur order completed).
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_order
  ON affiliate_referrals(order_id);

-- Lookup payouts d'un affilié par statut (UI MyPayouts + cron batch).
CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_affiliate_status
  ON affiliate_payouts(affiliate_id, status);

-- Lookup payouts d'un client par période (UI admin PayoutsManager filtré
-- mensuel + reporting financier).
CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_client_period
  ON affiliate_payouts(client_id, period_end);

-- Lookup clicks d'un affilié dans le temps (UI metrics conversion funnel +
-- cron purge anciennes traces PII Loi 25).
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_affiliate
  ON affiliate_clicks(affiliate_id, clicked_at);

-- NB : 1 table NEUVE (affiliate_payouts), 26 colonnes ADD COLUMN (affiliates +7,
-- affiliate_referrals +7, affiliate_clicks +8, orders +2), 8 INDEX NEUFS
-- (1 UNIQUE + 7 lookup). AUCUNE FK, AUCUN CHECK, AUCUN DROP / RENAME / rebuild.
-- NE TOUCHE PAS aux handlers affiliates.ts S92 — les nouveaux handlers Sprint 49
-- vivent dans affiliates.ts (extension) + lib/affiliate-engine.ts (NEUF).
-- Capabilities FIGÉES : clients.manage (CRUD affiliates + referrals confirm/
-- reverse + metrics) + settings.manage (payouts createBatch/markPaid) + PUBLIC
-- (signup + track-click rate-limit + honeypot HANDLER). AUCUN ajout
-- ALL_CAPABILITIES seq 80. i18n parité STRICTE 4 catalogues (en, fr-CA, fr-FR,
-- es). Choix figés docs/LOT-AFFILIATES-S49.md §6.
