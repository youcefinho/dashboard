-- ── Sprint 31 — Stripe live activation — seq126 (2026-05-23) ──────────────
-- 100% ADDITIF : ALTER subscriptions ADD COLUMN nullables + CREATE TABLE IF NOT EXISTS.
-- AUCUN ALTER de CHECK, AUCUN DROP. Conventions id/datetime/PK figées.
-- depends_on : migration-billing-stripe-mock-seq120.sql (Sprint 22 subscriptions enrichi)
--            + migration-sprintE4-m1.sql (Sprint E4 payment_provider_config réutilisé)

-- 1. Subscriptions enrichies pour live billing (3 colonnes additives)
ALTER TABLE subscriptions ADD COLUMN stripe_payment_method_id TEXT;
ALTER TABLE subscriptions ADD COLUMN stripe_latest_invoice_id TEXT;
ALTER TABLE subscriptions ADD COLUMN live_activated_at TEXT;

-- 2. payment_methods : cartes/Apple Pay/Google Pay attachées au Stripe Customer
--    PCI SAQ-A : on stocke UNIQUEMENT brand + last4 (non sensibles, fournis par Stripe).
--    AUCUN PAN, AUCUN CVV, AUCUNE expiry complète. Tokens Stripe (payment_method_id) seulement.
CREATE TABLE IF NOT EXISTS payment_methods (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agency_id                TEXT NOT NULL,
  stripe_payment_method_id TEXT NOT NULL,
  stripe_customer_id       TEXT NOT NULL,
  type                     TEXT NOT NULL,     -- 'card' | 'apple_pay' | 'google_pay'
  brand                    TEXT,              -- 'visa' | 'mastercard' | 'amex' | ...
  last4                    TEXT,              -- 4 chiffres NON sensibles (Stripe-fournis)
  exp_month                INTEGER,           -- mois (1-12) NON sensible
  exp_year                 INTEGER,           -- année 4 chiffres NON sensible
  is_default               INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now')),
  UNIQUE (agency_id, stripe_payment_method_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_agency  ON payment_methods (agency_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_default ON payment_methods (agency_id, is_default);

-- 3. stripe_connect_accounts : tenant vendeur ecom (Connect Express)
CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id                TEXT NOT NULL UNIQUE,    -- tenant
  stripe_account_id        TEXT NOT NULL UNIQUE,    -- acct_XXXX
  account_type             TEXT NOT NULL DEFAULT 'express',
  charges_enabled          INTEGER NOT NULL DEFAULT 0,
  payouts_enabled          INTEGER NOT NULL DEFAULT 0,
  details_submitted        INTEGER NOT NULL DEFAULT 0,
  capabilities_json        TEXT,
  requirements_json        TEXT,
  onboarding_completed_at  TEXT,
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stripe_connect_client  ON stripe_connect_accounts (client_id);
CREATE INDEX IF NOT EXISTS idx_stripe_connect_account ON stripe_connect_accounts (stripe_account_id);

-- 4. PAS de nouveau flag global payments_live_enabled — réutilise payment_provider_config (seq62)
--    Activation gradué par tenant :
--    INSERT OR REPLACE INTO payment_provider_config (client_id, provider, payments_live_enabled, mode)
--      VALUES (?, 'stripe', 1, 'live');
--    AUCUNE migration ne flippe automatiquement ce flag — acte admin manuel.

-- 5. PAS de nouvelle capability — réutilise billing.view + settings.manage (seq80 figées).
