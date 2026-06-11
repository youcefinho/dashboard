-- Migration P3.4 - Smart Lists + Custom Fields

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'textarea', 'number', 'date', 'select', 'multiselect', 'boolean')),
  options TEXT DEFAULT '[]', -- JSON array of options for select/multiselect
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
  filters TEXT NOT NULL DEFAULT '{}', -- JSON object of filters
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_smart_lists_user ON smart_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_lead ON custom_field_values(lead_id);
