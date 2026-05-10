-- Migration Phase 11 — P4.3 Documents + e-signature
-- Exécuter : npx wrangler d1 execute intralys-crm --file=migration-phase11.sql

-- Fichiers uploadés (R2 storage)
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

-- Templates de documents (contrats, mandats)
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

-- Documents envoyés pour signature
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
