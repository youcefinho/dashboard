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

-- Migration Sprint 5 - Phase A (Calendar)
-- Multi-calendars per user
CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  client_id TEXT,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#009DDB',
  is_default INTEGER DEFAULT 0,
  is_visible INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Availability rules per user
CREATE TABLE IF NOT EXISTS availability_rules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,  -- 0=dimanche, 1=lundi, ...
  start_time TEXT NOT NULL,  -- '09:00'
  end_time TEXT NOT NULL,    -- '17:00'
  is_active INTEGER DEFAULT 1
);

-- Date overrides (vacances, jours fériés QC)
CREATE TABLE IF NOT EXISTS date_overrides (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,  -- 'YYYY-MM-DD'
  is_available INTEGER DEFAULT 0,  -- 0 = blocked
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Appointments : enrichir
ALTER TABLE appointments ADD COLUMN calendar_id TEXT;
ALTER TABLE appointments ADD COLUMN assignee_user_id TEXT;
ALTER TABLE appointments ADD COLUMN attendees_json TEXT DEFAULT '[]';
ALTER TABLE appointments ADD COLUMN conference_link TEXT;
ALTER TABLE appointments ADD COLUMN reminder_minutes INTEGER DEFAULT 60;
ALTER TABLE appointments ADD COLUMN buffer_before_min INTEGER DEFAULT 0;
ALTER TABLE appointments ADD COLUMN buffer_after_min INTEGER DEFAULT 0;
ALTER TABLE appointments ADD COLUMN recurring_rule TEXT;  -- iCal RRULE
ALTER TABLE appointments ADD COLUMN parent_appointment_id TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_calendar ON appointments(calendar_id);
CREATE INDEX IF NOT EXISTS idx_availability_user ON availability_rules(user_id);

-- Jours fériés QC pré-seedés
INSERT OR IGNORE INTO date_overrides (id, user_id, date, is_available, reason)
SELECT lower(hex(randomblob(16))), u.id, '2026-07-01', 0, 'Fête du Canada'
FROM users u;
INSERT OR IGNORE INTO date_overrides (id, user_id, date, is_available, reason)
SELECT lower(hex(randomblob(16))), u.id, '2026-06-24', 0, 'Saint-Jean-Baptiste'
FROM users u;

- -   M i g r a t i o n   S p r i n t   5   -   P h a s e   B   ( T a s k s )  
 - -   S u b t a s k s  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   s u b t a s k s   (  
     i d   T E X T   P R I M A R Y   K E Y   D E F A U L T   ( l o w e r ( h e x ( r a n d o m b l o b ( 1 6 ) ) ) ) ,  
     t a s k _ i d   T E X T   N O T   N U L L   R E F E R E N C E S   t a s k s ( i d )   O N   D E L E T E   C A S C A D E ,  
     t i t l e   T E X T   N O T   N U L L ,  
     i s _ d o n e   I N T E G E R   D E F A U L T   0 ,  
     s o r t _ o r d e r   I N T E G E R   D E F A U L T   0 ,  
     c r e a t e d _ a t   T E X T   D E F A U L T   ( d a t e t i m e ( ' n o w ' ) )  
 ) ;  
  
 - -   C o m m e n t s   o n   t a s k s  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   t a s k _ c o m m e n t s   (  
     i d   T E X T   P R I M A R Y   K E Y   D E F A U L T   ( l o w e r ( h e x ( r a n d o m b l o b ( 1 6 ) ) ) ) ,  
     t a s k _ i d   T E X T   N O T   N U L L   R E F E R E N C E S   t a s k s ( i d )   O N   D E L E T E   C A S C A D E ,  
     u s e r _ i d   T E X T   N O T   N U L L ,  
     b o d y   T E X T   N O T   N U L L ,  
     c r e a t e d _ a t   T E X T   D E F A U L T   ( d a t e t i m e ( ' n o w ' ) )  
 ) ;  
  
 - -   T a s k   a t t a c h m e n t s  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   t a s k _ a t t a c h m e n t s   (  
     t a s k _ i d   T E X T   N O T   N U L L   R E F E R E N C E S   t a s k s ( i d )   O N   D E L E T E   C A S C A D E ,  
     f i l e _ i d   T E X T   N O T   N U L L ,  
     P R I M A R Y   K E Y   ( t a s k _ i d ,   f i l e _ i d )  
 ) ;  
  
 - -   T a s k   t e m p l a t e s  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   t a s k _ t e m p l a t e s   (  
     i d   T E X T   P R I M A R Y   K E Y   D E F A U L T   ( l o w e r ( h e x ( r a n d o m b l o b ( 1 6 ) ) ) ) ,  
     c l i e n t _ i d   T E X T ,  
     u s e r _ i d   T E X T ,  
     n a m e   T E X T   N O T   N U L L ,  
     d e s c r i p t i o n   T E X T   D E F A U L T   ' ' ,  
     d e f a u l t _ p r i o r i t y   T E X T   D E F A U L T   ' m e d i u m ' ,  
     d e f a u l t _ d u e _ o f f s e t _ d a y s   I N T E G E R   D E F A U L T   0 ,  
     s u b t a s k s _ j s o n   T E X T   D E F A U L T   ' [ ] ' ,  
     c r e a t e d _ a t   T E X T   D E F A U L T   ( d a t e t i m e ( ' n o w ' ) )  
 ) ;  
  
 - -   E n r i c h i r   t a s k s  
 A L T E R   T A B L E   t a s k s   A D D   C O L U M N   r e c u r r i n g _ r u l e   T E X T ;  
 A L T E R   T A B L E   t a s k s   A D D   C O L U M N   p a r e n t _ t a s k _ i d   T E X T ;  
 A L T E R   T A B L E   t a s k s   A D D   C O L U M N   r e m i n d e r _ m i n u t e s _ b e f o r e   I N T E G E R ;  
  
 C R E A T E   I N D E X   I F   N O T   E X I S T S   i d x _ s u b t a s k s _ t a s k   O N   s u b t a s k s ( t a s k _ i d ) ;  
 C R E A T E   I N D E X   I F   N O T   E X I S T S   i d x _ c o m m e n t s _ t a s k   O N   t a s k _ c o m m e n t s ( t a s k _ i d ) ;  
 -- Migration Sprint 5 - Phase B (Tasks)
-- Subtasks
CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_done INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Comments on tasks
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Task attachments
CREATE TABLE IF NOT EXISTS task_attachments (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  PRIMARY KEY (task_id, file_id)
);

-- Task templates
CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  default_priority TEXT DEFAULT 'medium',
  default_due_offset_days INTEGER DEFAULT 0,
  subtasks_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Enrichir tasks
ALTER TABLE tasks ADD COLUMN recurring_rule TEXT;
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;
ALTER TABLE tasks ADD COLUMN reminder_minutes_before INTEGER;

CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);
-- Migration Sprint 6 - Phase A (Inbox & Templates)

-- 1. Table Snippets (Réponses rapides / Saved Replies)
CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT,
  name TEXT NOT NULL,
  shortcut TEXT DEFAULT '',
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snippets_user ON snippets(user_id);
CREATE INDEX IF NOT EXISTS idx_snippets_shortcut ON snippets(shortcut);

-- 2. Enrichir les Templates pour supporter les SMS
ALTER TABLE email_templates ADD COLUMN channel TEXT DEFAULT 'email';
