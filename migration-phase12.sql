-- Migration Phase 12 — P4.6 Reviews & Reputation
-- Exécuter : npx wrangler d1 execute intralys-crm --file=migration-phase12.sql

-- Demandes d'avis envoyées aux leads
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

-- Cache des reviews Google/Facebook
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
