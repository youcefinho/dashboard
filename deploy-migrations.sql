-- ============================================================
-- DEPLOY-MIGRATIONS.sql — Script combiné pour les phases 10-13
-- ============================================================
-- Exécuter en LOCAL :
--   npx wrangler d1 execute intralys-crm --local --file=deploy-migrations.sql
--
-- Exécuter en REMOTE (production) :
--   npx wrangler d1 execute intralys-crm --file=deploy-migrations.sql --remote
-- ============================================================

-- ── Phase 10 — DND + champs étendus + migration support ─────
ALTER TABLE leads ADD COLUMN dnd INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN dnd_settings TEXT DEFAULT '{}';
ALTER TABLE leads ADD COLUMN additional_emails TEXT DEFAULT '[]';
ALTER TABLE leads ADD COLUMN date_of_birth TEXT;
ALTER TABLE leads ADD COLUMN country TEXT DEFAULT 'CA';
ALTER TABLE leads ADD COLUMN timezone TEXT DEFAULT 'America/Toronto';
ALTER TABLE leads ADD COLUMN external_id TEXT;
ALTER TABLE leads ADD COLUMN migrated_from TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_external_id ON leads(external_id);

-- ── Phase 11 — Documents + e-signature ──────────────────────
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  lead_id TEXT,
  name TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  mime TEXT DEFAULT 'application/octet-stream',
  r2_key TEXT NOT NULL UNIQUE,
  uploaded_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  body_html TEXT NOT NULL,
  variables TEXT DEFAULT '[]',
  category TEXT DEFAULT 'general',
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  template_id TEXT,
  lead_id TEXT,
  client_id TEXT,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  token TEXT UNIQUE,
  sent_at TEXT,
  viewed_at TEXT,
  signed_at TEXT,
  signature_data TEXT,
  signed_pdf_key TEXT,
  audit_trail TEXT DEFAULT '[]',
  expires_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES document_templates(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_documents_token ON documents(token);
CREATE INDEX IF NOT EXISTS idx_documents_lead ON documents(lead_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_files_lead ON files(lead_id);

-- ── Phase 12 — Reviews & Reputation ─────────────────────────
CREATE TABLE IF NOT EXISTS review_requests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL,
  client_id TEXT,
  channel TEXT DEFAULT 'email',
  template_id TEXT,
  review_url TEXT,
  status TEXT DEFAULT 'pending',
  rating INTEGER,
  sent_at TEXT,
  clicked_at TEXT,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS reviews_cache (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  source TEXT DEFAULT 'google',
  author_name TEXT,
  rating INTEGER NOT NULL,
  comment TEXT,
  review_date TEXT,
  reply TEXT,
  reply_date TEXT,
  external_id TEXT UNIQUE,
  fetched_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_review_requests_lead ON review_requests(lead_id);
CREATE INDEX IF NOT EXISTS idx_review_requests_status ON review_requests(status);
CREATE INDEX IF NOT EXISTS idx_reviews_cache_client ON reviews_cache(client_id);
CREATE INDEX IF NOT EXISTS idx_reviews_cache_source ON reviews_cache(source);

-- ── Phase 13 — Migration GHL support ────────────────────────
CREATE TABLE IF NOT EXISTS migration_jobs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  sub_account_id TEXT NOT NULL,
  source TEXT DEFAULT 'ghl',
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  cursor TEXT,
  total_processed INTEGER DEFAULT 0,
  total_imported INTEGER DEFAULT 0,
  total_skipped INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  error_log TEXT DEFAULT '[]',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS migration_field_map (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  sub_account_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(sub_account_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_migration_jobs_status ON migration_jobs(status);
CREATE INDEX IF NOT EXISTS idx_migration_field_map_source ON migration_field_map(sub_account_id, source_type, source_id);

-- ✅ Terminé — 4 phases, 6 nouvelles tables, 12 index
