-- Migration Phase 7 — Booking pages + Form builder + Sub-accounts + AI bot
-- Exécuter : npx wrangler d1 execute intralys-crm --file=migration-phase7.sql

-- ── Booking pages (Calendly clone) ──────────────────────────
CREATE TABLE IF NOT EXISTS booking_pages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  duration_minutes INTEGER DEFAULT 30,
  buffer_minutes INTEGER DEFAULT 15,
  max_bookings_per_day INTEGER DEFAULT 8,
  available_days TEXT DEFAULT '[1,2,3,4,5]',
  available_hours TEXT DEFAULT '{"start":"09:00","end":"17:00"}',
  timezone TEXT DEFAULT 'America/Toronto',
  confirmation_message TEXT DEFAULT 'Votre rendez-vous est confirmé !',
  notification_email TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  color TEXT DEFAULT '#6366f1',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_booking_slug ON booking_pages(slug);
CREATE INDEX IF NOT EXISTS idx_booking_client ON booking_pages(client_id);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  booking_page_id TEXT NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT DEFAULT '',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT CHECK (status IN ('confirmed','cancelled','completed','no_show')) DEFAULT 'confirmed',
  notes TEXT DEFAULT '',
  cancelled_reason TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_page ON bookings(booking_page_id);
CREATE INDEX IF NOT EXISTS idx_bookings_time ON bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- ── Form builder ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  fields TEXT DEFAULT '[]',
  submit_action TEXT CHECK (submit_action IN ('create_lead','webhook','email','none')) DEFAULT 'create_lead',
  submit_config TEXT DEFAULT '{}',
  success_message TEXT DEFAULT 'Merci ! Nous vous contacterons sous peu.',
  redirect_url TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  styling TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_forms_slug ON forms(slug);
CREATE INDEX IF NOT EXISTS idx_forms_client ON forms(client_id);

CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  data TEXT DEFAULT '{}',
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_submissions_form ON form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_submissions_date ON form_submissions(created_at);

-- ── Sub-accounts (agence → emplacement → utilisateur) ───────
-- Ajout de colonnes sur la table users existante
ALTER TABLE users ADD COLUMN parent_user_id TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN account_level TEXT CHECK (account_level IN ('agency','location','user')) DEFAULT 'user';
ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '{}';
ALTER TABLE users ADD COLUMN max_clients INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN branding TEXT DEFAULT '{}';

-- ── AI bot conversations ────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  channel TEXT CHECK (channel IN ('sms','web','email')) DEFAULT 'web',
  status TEXT CHECK (status IN ('active','paused','completed','escalated')) DEFAULT 'active',
  context TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user','assistant','system')) NOT NULL,
  content TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_conv_lead ON ai_conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id);
