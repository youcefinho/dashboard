-- Migration Phase 1 — Nouvelles fonctionnalités CRM
-- Exécuter après schema.sql : bun run db:migrate

-- ── Tags sur les leads ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(lead_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_lead_tags_lead_id ON lead_tags(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_tags_tag ON lead_tags(tag);

-- ── Historique d'activité / timeline ────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  client_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,           -- 'status_change', 'note_added', 'tag_added', 'tag_removed', 'email_sent', 'sms_sent', 'created'
  details TEXT DEFAULT '',         -- JSON avec les détails (ex: {"from": "new", "to": "contacted"})
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_log_lead_id ON activity_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);

-- ── Nouveaux champs sur leads ───────────────────────────────
-- Valeur monétaire du deal
ALTER TABLE leads ADD COLUMN deal_value REAL DEFAULT 0;
-- UTM tracking
ALTER TABLE leads ADD COLUMN utm_source TEXT DEFAULT '';
ALTER TABLE leads ADD COLUMN utm_medium TEXT DEFAULT '';
ALTER TABLE leads ADD COLUMN utm_campaign TEXT DEFAULT '';
-- Assignation
ALTER TABLE leads ADD COLUMN assigned_to TEXT DEFAULT '';
-- Score du lead (0-100)
ALTER TABLE leads ADD COLUMN score INTEGER DEFAULT 0;

-- ── Index pour les nouvelles colonnes ───────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_deal_value ON leads(deal_value);
