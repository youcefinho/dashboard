-- Migration Sprint 2 Phase 1 — Colonnes leads enrichies
-- Exécuter APRÈS phase 0
-- NOTE: chaque ALTER TABLE est dans un statement séparé car D1 ne supporte pas IF NOT EXISTS sur ALTER

-- Champs contact enrichis
ALTER TABLE leads ADD COLUMN additional_phones TEXT DEFAULT '[]';
ALTER TABLE leads ADD COLUMN address TEXT;
ALTER TABLE leads ADD COLUMN city TEXT;
ALTER TABLE leads ADD COLUMN postal_code TEXT;
ALTER TABLE leads ADD COLUMN company TEXT;
ALTER TABLE leads ADD COLUMN lifecycle_stage TEXT DEFAULT 'lead';
ALTER TABLE leads ADD COLUMN favorite INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN assigned_to TEXT;
ALTER TABLE leads ADD COLUMN last_activity_at TEXT;
ALTER TABLE leads ADD COLUMN social_linkedin TEXT;
ALTER TABLE leads ADD COLUMN social_facebook TEXT;
ALTER TABLE leads ADD COLUMN social_instagram TEXT;
ALTER TABLE leads ADD COLUMN avatar_url TEXT;
