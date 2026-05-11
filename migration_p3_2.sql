-- Migration P3.2 : Documents & E-Signature
-- Exécuter en local : npx wrangler d1 execute intralys-crm --local --file=migration_p3_2.sql
-- Exécuter en prod : npx wrangler d1 execute intralys-crm --remote --file=migration_p3_2.sql

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

CREATE INDEX IF NOT EXISTS idx_documents_lead ON documents(lead_id);
CREATE INDEX IF NOT EXISTS idx_documents_token ON documents(token);
