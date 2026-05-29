-- ── Sprint 89 (seq184) — Marque Blanche Complète (Portal Customization) ──
--

CREATE TABLE IF NOT EXISTS branding_settings (
  client_id TEXT PRIMARY KEY,
  logo_url TEXT,
  favicon_url TEXT,
  brand_color TEXT,
  custom_domain TEXT,
  support_email TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
