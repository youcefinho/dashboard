-- Migration D1 — Sprint 70 (Calculateur de Taxes Multi-Régions)
-- seq: 160
-- depends_on: migration-b2b-pricing-seq163.sql

CREATE TABLE IF NOT EXISTS tax_rates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  country TEXT NOT NULL,
  state_province TEXT,
  rate_tps REAL DEFAULT 0,
  rate_tvq REAL DEFAULT 0,
  rate_tva REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tax_rates_client_country ON tax_rates(client_id, country);
