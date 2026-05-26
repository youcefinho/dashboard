-- Sprint 21 — Onboarding durci : checklist serveur + events analytics
-- (2026-05-22). Durcit le parcours d'onboarding existant (S8 seq76) en
-- persistant la checklist côté serveur (au lieu de localStorage seul) et en
-- traçant les events de completion/skip pour analytics.
--
-- 100% ADDITIF : ALTER TABLE ADD COLUMN nullable sans DEFAULT non-constant,
-- CREATE TABLE IF NOT EXISTS. AUCUN CHECK modifié, AUCUN rebuild, AUCUN DROP.
-- Conventions : id TEXT DEFAULT (lower(hex(randomblob(16)))), timestamps
-- TEXT DEFAULT (datetime('now')) — JAMAIS unixepoch. Enums validés HANDLER.
--
-- Dépend de seq76 (migration-sprintS8-m1.sql) pour les colonnes additionnelles
-- sur onboarding_state, et chaîne sur seq118 (migration-catalog-seq118.sql).

-- Colonnes additives sur onboarding_state (seq76). Toutes nullables, pas de
-- DEFAULT non-constant ⇒ pas de rebuild SQLite, pas de CHECK touché.
ALTER TABLE onboarding_state ADD COLUMN checklist_items_json TEXT;
ALTER TABLE onboarding_state ADD COLUMN skipped_items_json TEXT;
ALTER TABLE onboarding_state ADD COLUMN skipped_at TEXT;
ALTER TABLE onboarding_state ADD COLUMN dismissed_at TEXT;
ALTER TABLE onboarding_state ADD COLUMN last_active_at TEXT;

-- Audit léger des transitions checklist. Enums (event_type, item_key) validés
-- côté HANDLER worker (pas de CHECK SQL — rétro-compat additive).
CREATE TABLE IF NOT EXISTS onboarding_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  item_key TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_onbevents_client ON onboarding_events(client_id);
CREATE INDEX IF NOT EXISTS idx_onbevents_user ON onboarding_events(user_id);
CREATE INDEX IF NOT EXISTS idx_onbevents_type ON onboarding_events(event_type);
