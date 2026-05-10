-- Migration Phase 6 — Multi-pipelines + SMS
-- Exécuter : bun run db:migrate:phase6

-- ── Pipelines ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── Étapes de pipeline ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  position INTEGER DEFAULT 0,
  is_win_stage INTEGER DEFAULT 0,
  is_loss_stage INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);

-- ── Ajouter pipeline_id + stage_id aux leads ────────────────
-- ⚠️ ATTENTION : SQLite ne supporte PAS ADD COLUMN IF NOT EXISTS
-- Ne jamais exécuter cette migration 2 fois sur la même DB !
-- Si la migration échoue ici, c'est que les colonnes existent déjà → OK, ignorer l'erreur.

ALTER TABLE leads ADD COLUMN pipeline_id TEXT DEFAULT NULL;
ALTER TABLE leads ADD COLUMN stage_id TEXT DEFAULT NULL;

-- ── Pipeline par défaut avec les statuts existants ──────────

INSERT OR IGNORE INTO pipelines (id, name, description, is_default, position)
VALUES ('pipeline-default', 'Pipeline Principal', 'Pipeline de vente par défaut pour les courtiers immobiliers', 1, 0);

INSERT OR IGNORE INTO pipeline_stages (id, pipeline_id, name, slug, color, position, is_win_stage, is_loss_stage)
VALUES
  ('stage-new', 'pipeline-default', 'Nouveau', 'new', '#6366f1', 0, 0, 0),
  ('stage-contacted', 'pipeline-default', 'Contacté', 'contacted', '#8b5cf6', 1, 0, 0),
  ('stage-meeting', 'pipeline-default', 'Rendez-vous', 'meeting', '#f59e0b', 2, 0, 0),
  ('stage-signed', 'pipeline-default', 'Signé', 'signed', '#10b981', 3, 1, 0),
  ('stage-closed', 'pipeline-default', 'Fermé', 'closed', '#059669', 4, 1, 0),
  ('stage-lost', 'pipeline-default', 'Perdu', 'lost', '#ef4444', 5, 0, 1);

-- ── Migrer les leads existants vers le pipeline par défaut ──

UPDATE leads SET pipeline_id = 'pipeline-default' WHERE pipeline_id IS NULL;
UPDATE leads SET stage_id = 'stage-' || status WHERE stage_id IS NULL AND status IS NOT NULL;
