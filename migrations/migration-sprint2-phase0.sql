-- Migration Sprint 2 Phase 0 — Multi-score profiles
-- Exécuter : npx wrangler d1 execute intralys-crm --local --file=migration-sprint2-phase0.sql

-- Profils de scoring multi-critères
CREATE TABLE IF NOT EXISTS score_profiles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  formula TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Scores calculés par lead × profil
CREATE TABLE IF NOT EXISTS lead_scores (
  lead_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  computed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (lead_id, profile_id),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (profile_id) REFERENCES score_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_profile ON lead_scores(profile_id);
CREATE INDEX IF NOT EXISTS idx_score_profiles_client ON score_profiles(client_id);

-- Notes multiples par lead (remplace le champ notes unique)
CREATE TABLE IF NOT EXISTS lead_notes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL,
  user_id TEXT,
  body TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  is_pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id);

-- Attributions multi-touch (source tracking)
CREATE TABLE IF NOT EXISTS lead_attributions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL,
  medium TEXT,
  source TEXT,
  campaign TEXT,
  referrer TEXT,
  session_source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_lead_attributions_lead ON lead_attributions(lead_id);

-- Smart Lists persistées (remplace localStorage)
CREATE TABLE IF NOT EXISTS smart_lists (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT,
  client_id TEXT,
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  is_shared INTEGER DEFAULT 0,
  count_cache INTEGER DEFAULT 0,
  count_updated_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_smart_lists_user ON smart_lists(user_id);

-- Préférences utilisateur (colonnes, layout, etc.)
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT NOT NULL,
  page TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT DEFAULT '{}',
  PRIMARY KEY (user_id, page, key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Colonnes supplémentaires leads
-- (utiliser des statements séparés pour ignorer si déjà existant)
