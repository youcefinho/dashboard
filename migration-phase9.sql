-- ═══════════════════════════════════════════════════════════
-- Migration Phase 9 — Smart Lists + Custom Fields
-- ═══════════════════════════════════════════════════════════

-- Définitions de champs personnalisés (par client)
CREATE TABLE IF NOT EXISTS custom_field_defs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  field_type TEXT CHECK (field_type IN ('text','number','date','select','multiselect','boolean','url','phone','email')) NOT NULL,
  options TEXT DEFAULT '[]',
  is_required INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cfd_client ON custom_field_defs(client_id);

-- Valeurs de champs personnalisés (par lead)
CREATE TABLE IF NOT EXISTS custom_field_values (
  lead_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value TEXT DEFAULT '',
  PRIMARY KEY (lead_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_cfv_lead ON custom_field_values(lead_id);

-- Vues sauvegardées (smart lists)
CREATE TABLE IF NOT EXISTS smart_lists (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  client_id TEXT DEFAULT '',
  name TEXT NOT NULL,
  filters TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sl_user ON smart_lists(user_id);
