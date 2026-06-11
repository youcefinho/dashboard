-- Migration Phase 22 : Multi-Pipelines + Custom Stages + Lost Reasons

-- 1. Création des nouvelles tables
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  color TEXT DEFAULT '#0891b2',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  probability INTEGER DEFAULT 0,
  color TEXT DEFAULT '#9ca3af',
  wip_limit INTEGER DEFAULT 0,
  sla_days INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lost_reasons (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 2. Ajout des colonnes à la table leads
ALTER TABLE leads ADD COLUMN pipeline_id TEXT REFERENCES pipelines(id);
ALTER TABLE leads ADD COLUMN stage_id TEXT REFERENCES pipeline_stages(id);
ALTER TABLE leads ADD COLUMN lost_reason_id TEXT REFERENCES lost_reasons(id);

-- 3. Scripts de data migration (à exécuter via worker/script)
-- Il faudra insérer un pipeline par défaut pour chaque client existant,
-- puis lier les leads existants à ce pipeline.
