-- Migration Phase 21: Universalize Lead Statuses and Types

-- 1. Update Lead Statuses
-- 'meeting' -> 'qualified'
-- 'signed' -> 'won'
UPDATE leads SET status = 'qualified' WHERE status = 'meeting';
UPDATE leads SET status = 'won' WHERE status = 'signed';

-- 2. Update Lead Types
-- 'buy' -> 'inbound'
-- 'sell' -> 'customer' (or 'qualified', but we need to match LEAD_TYPES = ['inbound', 'qualified', 'customer'])
UPDATE leads SET type = 'inbound' WHERE type = 'buy';
UPDATE leads SET type = 'customer' WHERE type = 'sell';

-- 3. Update Custom Field Definitions if they have specific values
-- Not needed unless they are specifically named.

-- Note: In SQLite, CHECK constraints are not easily altered. 
-- For production D1, we would recreate the table or just rely on the app logic if CHECK constraints aren't strict,
-- but the main schema.sql CHECK constraints:
-- type CHECK (type IN ('buy', 'sell')) 
-- status CHECK (status IN ('new', 'contacted', 'meeting', 'signed', 'closed', 'lost'))
-- In D1, it's better to update schema.sql for new databases and use PRAGMA foreign_keys=off; table recreation for existing ones if CHECK constraint fails.
-- Since this is just a dev environment migration, we'll try to update directly.
