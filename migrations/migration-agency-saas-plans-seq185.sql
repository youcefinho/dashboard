-- ── Sprint 90 (seq185) — Moteur de Facturation SaaS d'Agence (SaaS Configurator) ──
--

CREATE TABLE IF NOT EXISTS agency_saas_plans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  monthly_price_cents INTEGER NOT NULL DEFAULT 0,
  limits_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
