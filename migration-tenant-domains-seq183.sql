-- ── Sprint 88 (seq183) — SSL Automatique pour Domaines Personnalisés ──
--

CREATE TABLE IF NOT EXISTS tenant_domains (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  domain TEXT UNIQUE NOT NULL,
  ssl_status TEXT NOT NULL DEFAULT 'pending' CHECK (ssl_status IN ('pending', 'active', 'failed')),
  cloudflare_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_domains_client ON tenant_domains(client_id);
