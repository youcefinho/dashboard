-- ── Sprint 22 — Billing Stripe prod (E4 flag mock) — seq120 (2026-05-22) ─────
--
-- Rails de facturation/abonnement SaaS Intralys en mode 100 % MOCK.
-- ⚠️ DISTINCT de migration-sprintE4-m1.sql (seq62, payments marchand E4) et
--    de migration-sprintE6-m1.sql (seq65, refunds marchand E6). NE PAS CONFONDRE.
--
-- Toutes les ajouts sont ADDITIFS : ALTER TABLE ADD COLUMN nullable + CREATE
-- TABLE IF NOT EXISTS. Aucune contrainte CHECK n'est modifiée (interdit).
-- subscriptions (seq19) n'a aucun CHECK sur plan_name/status — toute la
-- validation est HANDLER (saas-billing.ts).
--
-- Idiome mock (handler) : tant que env.STRIPE_SECRET_KEY est ABSENT, AUCUN
-- appel réseau api.stripe.com n'est émis. Les colonnes stripe_* sont remplies
-- avec des refs factices (mock_cus_<hex>, mock_sub_<hex>) au provisioning.
--
-- Conventions :
--   - id TEXT DEFAULT (lower(hex(randomblob(16))))
--   - timestamps TEXT DEFAULT (datetime('now'))
--   - Money en cents INTEGER, devise locked 'CAD' pour V1.
--   - Multi-tenant : client_id sur tables tenant-scopées, agency_id pour SaaS.

-- ── Extension subscriptions (seq19) — colonnes nullable ADDITIVES ──────────
ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN stripe_price_id TEXT;
ALTER TABLE subscriptions ADD COLUMN billing_period TEXT;
ALTER TABLE subscriptions ADD COLUMN trial_ends_at TEXT;
ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN canceled_at TEXT;
ALTER TABLE subscriptions ADD COLUMN current_period_start TEXT;
ALTER TABLE subscriptions ADD COLUMN provider TEXT;
ALTER TABLE subscriptions ADD COLUMN metadata_json TEXT;
ALTER TABLE subscriptions ADD COLUMN updated_at TEXT;

-- ── billing_plans — catalogue de plans ────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_plans (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tier                TEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  description         TEXT,
  price_monthly_cents INTEGER NOT NULL DEFAULT 0,
  price_yearly_cents  INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'CAD',
  stripe_price_monthly_id TEXT,
  stripe_price_yearly_id  TEXT,
  features_json       TEXT,
  limits_json         TEXT,
  display_order       INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_billing_plans_tier ON billing_plans (tier);
CREATE INDEX IF NOT EXISTS idx_billing_plans_active ON billing_plans (is_active, display_order);

-- Seed 4 plans canoniques (idempotent)
INSERT OR IGNORE INTO billing_plans
  (tier, display_name, description, price_monthly_cents, price_yearly_cents, currency, limits_json, display_order)
VALUES
  ('free',      'Gratuit',  'Pour tester Intralys.',          0,     0,      'CAD', '{"maxSubAccounts":2,"maxLeads":500,"maxUsers":3}',           10),
  ('starter',   'Starter',  'Pour démarrer.',                 4900,  49000,  'CAD', '{"maxSubAccounts":5,"maxLeads":2500,"maxUsers":10}',         20),
  ('pro',       'Pro',      'Pour grossir.',                  14900, 149000, 'CAD', '{"maxSubAccounts":10,"maxLeads":10000,"maxUsers":25}',       30),
  ('unlimited', 'Illimité', 'Sans limite.',                   49900, 499000, 'CAD', '{"maxSubAccounts":null,"maxLeads":null,"maxUsers":null}',    40);

-- ── billing_events — log webhook Stripe SaaS (DISTINCT de payment_events E4) ─
CREATE TABLE IF NOT EXISTS billing_events (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agency_id         TEXT,
  subscription_id   TEXT,
  provider          TEXT NOT NULL DEFAULT 'stripe',
  provider_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  signature_verified INTEGER NOT NULL DEFAULT 0,
  is_mock           INTEGER NOT NULL DEFAULT 1,
  payload_json      TEXT,
  processed_at      TEXT,
  error             TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_billing_events_agency ON billing_events (agency_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_subscription ON billing_events (subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_type ON billing_events (event_type);

-- ── billing_invoices_mock — factures SaaS mock ────────────────────────────
CREATE TABLE IF NOT EXISTS billing_invoices_mock (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agency_id           TEXT NOT NULL,
  subscription_id     TEXT,
  stripe_invoice_id   TEXT,
  number              TEXT,
  amount_due_cents    INTEGER NOT NULL DEFAULT 0,
  amount_paid_cents   INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'CAD',
  status              TEXT NOT NULL DEFAULT 'draft',
  period_start        TEXT,
  period_end          TEXT,
  hosted_invoice_url  TEXT,
  pdf_url             TEXT,
  is_mock             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_mock_agency ON billing_invoices_mock (agency_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_mock_status ON billing_invoices_mock (agency_id, status);
