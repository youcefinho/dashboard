-- Migration Sprint 46 — Custom dashboards builder (M1.3)
-- Auteur : Manager M1 — Sprint 46 (2026-05-15)
--
-- Tables :
--   1. dashboards — dashboards custom drag-drop (Reports builder)
--
-- Note : on conserve INTEGER PK AUTOINCREMENT (cohérent avec saved_reports
--        utilisant des UUID texte mais ici on veut des routes /api/dashboards/:id
--        simples (numériques) + share_token séparé pour l'URL publique).

CREATE TABLE IF NOT EXISTS dashboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,                       -- JSON {widgets:[], cols:12}
  share_token TEXT UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_dashboards_user ON dashboards(user_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_share ON dashboards(share_token);
