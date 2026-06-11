-- Migration P3.9: SaaS Configurator (Multi-tenancy)
CREATE TABLE agencies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT, -- user_id of the agency owner
  branding_colors TEXT,
  logo_url TEXT,
  custom_domain TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  agency_id TEXT,
  plan_name TEXT, -- starter, pro, unlimited
  status TEXT DEFAULT 'active', -- active, past_due, canceled
  stripe_subscription_id TEXT,
  current_period_end DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Update users to link to agency (optional, since we already have client_id for tenants)
ALTER TABLE users ADD COLUMN agency_id TEXT;
