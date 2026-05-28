-- Migration seq 159 (Sprint 64) — Codes Promos & Moteur de Rabais Dynamiques
CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT CHECK (discount_type IN ('fixed', 'percent')) DEFAULT 'percent',
  value INTEGER NOT NULL DEFAULT 0, -- cents si fixe, pourcentage si pourcentage
  starts_at TEXT DEFAULT NULL,
  expires_at TEXT DEFAULT NULL,
  max_uses INTEGER DEFAULT NULL,
  current_uses INTEGER DEFAULT 0,
  rules_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_client ON promo_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
