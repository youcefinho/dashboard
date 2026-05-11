-- ── Sprint 7 Phase C : Form Builder Enrichi + Quiz ──

ALTER TABLE forms ADD COLUMN folder_id TEXT;
ALTER TABLE forms ADD COLUMN settings_json TEXT DEFAULT '{}';
ALTER TABLE forms ADD COLUMN total_views INTEGER DEFAULT 0;
ALTER TABLE forms ADD COLUMN total_submissions INTEGER DEFAULT 0;
ALTER TABLE forms ADD COLUMN form_type TEXT DEFAULT 'form';

CREATE TABLE IF NOT EXISTS form_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id TEXT NOT NULL,
  visitor_id TEXT,
  ip TEXT,
  user_agent TEXT,
  url TEXT,
  viewed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS form_field_options (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  field_id TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT,
  weight INTEGER DEFAULT 0,
  next_field_id TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_form_views_form ON form_views(form_id);
CREATE INDEX IF NOT EXISTS idx_form_field_options_field ON form_field_options(field_id);
