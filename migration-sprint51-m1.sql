-- ── Sprint 51 M1 — Meta / Google Lead Ads ingestion (2026-05-16) ──
-- Tables de connexion découplées (NE PAS toucher meta_connections messaging).

-- Connexions Meta Lead Ads (Facebook/Instagram Lead Forms)
CREATE TABLE IF NOT EXISTS meta_lead_connections (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  page_id         TEXT NOT NULL,
  page_name       TEXT DEFAULT '',
  page_access_token TEXT NOT NULL,
  form_ids        TEXT,            -- JSON array nullable : filtre optionnel de form_id
  field_mapping   TEXT,            -- JSON nullable : { "full_name":"name", "email":"email", ... }
  active          INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meta_lead_conn_page ON meta_lead_connections(page_id);
CREATE INDEX IF NOT EXISTS idx_meta_lead_conn_client ON meta_lead_connections(client_id);

-- Connexions Google Lead Form (Google Ads Lead Form extensions)
CREATE TABLE IF NOT EXISTS google_lead_connections (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  webhook_key     TEXT NOT NULL,   -- google_key envoyé dans le payload, validé par connexion
  label           TEXT DEFAULT '', -- ex: "Campagne Été 2026" / Customer ID Google Ads
  field_mapping   TEXT,            -- JSON nullable
  active          INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_google_lead_conn_key ON google_lead_connections(webhook_key);
CREATE INDEX IF NOT EXISTS idx_google_lead_conn_client ON google_lead_connections(client_id);

-- gclid : capture du Google Click ID pour attribution (additive, nullable)
ALTER TABLE leads ADD COLUMN gclid TEXT;
