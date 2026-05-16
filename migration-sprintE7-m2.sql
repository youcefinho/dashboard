-- ── Sprint E7 M2 — Configuration de segmentation RFM par tenant ──────────────
--
-- Une seule table NEUVE (zéro ALTER, zéro double-ALTER). Stocke les seuils RFM
-- paramétrables par client (pas de magic number hardcodé côté code : les défauts
-- sont seedés idempotemment via INSERT OR IGNORE depuis ecommerce-rfm.ts).
--
-- Convention stricte Chaman :
--   - id TEXT DEFAULT (lower(hex(randomblob(16))))
--   - created_at / updated_at TEXT DEFAULT (datetime('now'))  [PAS unixepoch]
--   - Multi-tenant : client_id NOT NULL REFERENCES clients(id), UNIQUE(client_id)
--
-- Pas de table de log de récupération : la relance panier est tracée via
-- carts.recovered_at (E1) + workflow_execution_log (Sprint 46).

CREATE TABLE IF NOT EXISTS customer_segment_config (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  -- JSON : seuils de récence en jours (ex {"hot":30,"warm":90,"cold":180})
  recency_days_json TEXT,
  -- JSON : seuils de fréquence sur orders_count (ex {"low":1,"mid":3,"high":6})
  frequency_thresholds_json TEXT,
  -- JSON : seuils monétaires en cents sur total_spent_cents
  -- (ex {"low":5000,"mid":25000,"high":100000})
  monetary_thresholds_json TEXT,
  -- Délai d'inactivité (minutes) avant de marquer un panier 'active' comme
  -- 'abandoned'. Défaut 24 h = 1440 min.
  abandoned_cart_ttl_minutes INTEGER DEFAULT 1440,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_segment_config_client
  ON customer_segment_config(client_id);
