-- Cloudflare D1 — Schéma CRM central Intralys
-- Exécuter via : npx wrangler d1 execute intralys-crm --file=schema.sql --remote
-- Version consolidée : toutes les tables P0 à P3.10

-- Utilisateurs (admin + courtiers)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin', 'broker')) DEFAULT 'broker',
  client_id TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Clients (courtiers Intralys)
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  site_url TEXT DEFAULT '',
  city TEXT DEFAULT '',
  banner TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  amf_certificate TEXT DEFAULT '',
  amf_disclaimer_required INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Leads centraux (copie de TOUS les leads de TOUS les clients)
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  external_id TEXT DEFAULT '',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  message TEXT DEFAULT '',
  type TEXT CHECK (type IN ('inbound', 'qualified', 'customer')) DEFAULT 'inbound',
  status TEXT CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'closed', 'lost')) DEFAULT 'new',
  budget TEXT DEFAULT '',
  timeline TEXT DEFAULT '',
  address TEXT DEFAULT '',
  property_type TEXT DEFAULT '',
  source TEXT DEFAULT 'website',
  notes TEXT DEFAULT '',
  score INTEGER DEFAULT 0,
  deal_value REAL DEFAULT 0,
  favorite INTEGER DEFAULT 0,
  lifecycle_stage TEXT DEFAULT 'subscriber',
  dnd INTEGER DEFAULT 0,
  dnd_email INTEGER DEFAULT 0,
  dnd_sms INTEGER DEFAULT 0,
  dnd_calls INTEGER DEFAULT 0,
  date_of_birth TEXT,
  country TEXT DEFAULT 'CA',
  timezone TEXT DEFAULT 'America/Toronto',
  deleted_at TEXT,
  pipeline_id TEXT REFERENCES pipelines(id),
  stage_id TEXT REFERENCES pipeline_stages(id),
  lost_reason_id TEXT REFERENCES lost_reasons(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Sessions admin (token + expiration)
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin', 'broker')) DEFAULT 'broker',
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Rate limiting : tentatives de connexion
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  attempted_at TEXT DEFAULT (datetime('now'))
);

-- CASL : Suppression list (opt-outs)
CREATE TABLE IF NOT EXISTS unsubscribes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT,
  phone TEXT,
  channel TEXT CHECK (channel IN ('email', 'sms', 'all')) DEFAULT 'all',
  reason TEXT DEFAULT '',
  client_id TEXT DEFAULT '',
  unsubscribed_at TEXT DEFAULT (datetime('now'))
);

-- Loi 25 : Historique de consentement
CREATE TABLE IF NOT EXISTS consent_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL REFERENCES leads(id),
  consent_type TEXT NOT NULL,
  granted INTEGER DEFAULT 0,
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  granted_at TEXT DEFAULT (datetime('now'))
);

-- P3.2 Documents & E-Signature
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  lead_id TEXT REFERENCES leads(id),
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT DEFAULT 'application/octet-stream',
  r2_key TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT REFERENCES clients(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  body_html TEXT NOT NULL,
  variables TEXT DEFAULT '[]',
  category TEXT DEFAULT 'general',
  is_active INTEGER DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  template_id TEXT REFERENCES document_templates(id),
  lead_id TEXT NOT NULL REFERENCES leads(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL,
  status TEXT CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'expired')) DEFAULT 'draft',
  body_html TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  signature_data TEXT,
  audit_trail TEXT DEFAULT '[]',
  expires_at TEXT,
  sent_at TEXT,
  viewed_at TEXT,
  signed_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- P3.4 Custom Fields & Smart Lists
CREATE TABLE IF NOT EXISTS custom_field_defs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'textarea', 'number', 'date', 'select', 'multiselect', 'boolean')),
  options TEXT DEFAULT '[]',
  is_required INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id, slug)
);

CREATE TABLE IF NOT EXISTS custom_field_values (
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES custom_field_defs(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (lead_id, field_id)
);

CREATE TABLE IF NOT EXISTS smart_lists (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- P3.7 Workflows (branches conditionnelles)
CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workflow_id TEXT NOT NULL,
  step_type TEXT NOT NULL,
  config TEXT DEFAULT '{}',
  position_x REAL DEFAULT 0,
  position_y REAL DEFAULT 0,
  next_step_id TEXT,
  if_true_step_id TEXT,
  if_false_step_id TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- P3.8 Facturation & Paiements Stripe
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  lead_id TEXT REFERENCES leads(id),
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'CAD',
  status TEXT CHECK (status IN ('draft', 'sent', 'paid', 'cancelled')) DEFAULT 'draft',
  stripe_payment_intent_id TEXT,
  payment_url TEXT,
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- P3.9 SaaS Multi-tenant
CREATE TABLE IF NOT EXISTS agencies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id),
  custom_domain TEXT,
  logo_url TEXT DEFAULT '',
  primary_color TEXT DEFAULT '#0891b2',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  plan TEXT CHECK (plan IN ('starter', 'pro', 'enterprise')) DEFAULT 'starter',
  status TEXT CHECK (status IN ('active', 'cancelled', 'past_due')) DEFAULT 'active',
  stripe_subscription_id TEXT,
  current_period_end TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- P3.10 Mobile Prep
CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- P3.11 Multi-Pipelines & Custom Stages (Phase B)
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  color TEXT DEFAULT '#0891b2',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  probability INTEGER DEFAULT 0,
  color TEXT DEFAULT '#9ca3af',
  wip_limit INTEGER DEFAULT 0,
  sla_days INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lost_reasons (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_leads_client_id ON leads(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_client_status ON leads(client_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_external_id ON leads(external_id);
CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON leads(deleted_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_unsubscribes_email ON unsubscribes(email);
CREATE INDEX IF NOT EXISTS idx_consent_log_lead ON consent_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_documents_lead ON documents(lead_id);
CREATE INDEX IF NOT EXISTS idx_documents_token ON documents(token);
CREATE INDEX IF NOT EXISTS idx_smart_lists_user ON smart_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_lead ON custom_field_values(lead_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);