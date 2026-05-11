-- ── Sprint 7 Phase A : Email Builder + Folders + A/B Testing ──

ALTER TABLE email_templates ADD COLUMN blocks_json TEXT;
ALTER TABLE email_templates ADD COLUMN preheader TEXT DEFAULT '';
ALTER TABLE email_templates ADD COLUMN reply_to TEXT DEFAULT '';
ALTER TABLE email_templates ADD COLUMN ab_variant_of TEXT;
ALTER TABLE email_templates ADD COLUMN folder_id TEXT;
ALTER TABLE email_templates ADD COLUMN open_count INTEGER DEFAULT 0;
ALTER TABLE email_templates ADD COLUMN click_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS template_folders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_template_folders_client ON template_folders(client_id);
CREATE INDEX IF NOT EXISTS idx_templates_folder ON email_templates(folder_id);
CREATE INDEX IF NOT EXISTS idx_templates_ab ON email_templates(ab_variant_of);
