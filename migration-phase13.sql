-- Migration Phase 13 — Sprint 1 Migration GHL support
-- Exécuter : npx wrangler d1 execute intralys-crm --file=migration-phase13.sql

-- Table migration_jobs — suivi des jobs de migration
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

-- Table migration_field_map — mapping des IDs GHL vers IDs Intralys
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
