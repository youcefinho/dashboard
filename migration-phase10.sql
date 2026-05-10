-- Migration Phase 10 — Sprint 1 Quick Wins (Q.1 DND + Q.5 champs étendus)
-- Exécuter : npx wrangler d1 execute intralys-crm --file=migration-phase10.sql

-- Q.1 — Do Not Disturb par canal
ALTER TABLE leads ADD COLUMN dnd INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN dnd_settings TEXT DEFAULT '{}';
-- dnd_settings JSON: {"email": false, "sms": false, "call": false, "webchat": false}

-- Q.5 — Champs contact étendus (parité GHL)
ALTER TABLE leads ADD COLUMN additional_emails TEXT DEFAULT '[]';
ALTER TABLE leads ADD COLUMN date_of_birth TEXT;
ALTER TABLE leads ADD COLUMN country TEXT DEFAULT 'CA';
ALTER TABLE leads ADD COLUMN timezone TEXT DEFAULT 'America/Toronto';

-- Sprint 1 migration support
ALTER TABLE leads ADD COLUMN external_id TEXT;
ALTER TABLE leads ADD COLUMN migrated_from TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_external_id ON leads(external_id);
