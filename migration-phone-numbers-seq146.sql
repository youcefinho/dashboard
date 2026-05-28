-- Migration seq146 : Routage Dynamique de Numéros Virtuels
-- Ajout des tables pour le provisionnement et le routage des numéros de téléphone virtuels.

CREATE TABLE IF NOT EXISTS phone_numbers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phone_number TEXT UNIQUE NOT NULL,
  friendly_name TEXT DEFAULT '',
  twilio_sid TEXT DEFAULT '',
  status TEXT CHECK (status IN ('active', 'suspended', 'released')) DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS phone_routing_rules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  phone_number_id TEXT NOT NULL REFERENCES phone_numbers(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 1,
  condition_type TEXT CHECK (condition_type IN ('all', 'area_code')) DEFAULT 'all',
  condition_value TEXT DEFAULT '',
  target_type TEXT CHECK (target_type IN ('user', 'ivr', 'forward')) DEFAULT 'forward',
  target_id TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_phone_numbers_client ON phone_numbers(client_id);
CREATE INDEX IF NOT EXISTS idx_phone_routing_rules_num ON phone_routing_rules(phone_number_id);
