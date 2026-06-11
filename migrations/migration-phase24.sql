-- Migration Sprint 5 - Phase A (Calendar)
-- Multi-calendars per user
CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  client_id TEXT,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#009DDB',
  is_default INTEGER DEFAULT 0,
  is_visible INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Availability rules per user
CREATE TABLE IF NOT EXISTS availability_rules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,  -- 0=dimanche, 1=lundi, ...
  start_time TEXT NOT NULL,  -- '09:00'
  end_time TEXT NOT NULL,    -- '17:00'
  is_active INTEGER DEFAULT 1
);

-- Date overrides (vacances, jours fériés QC)
CREATE TABLE IF NOT EXISTS date_overrides (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,  -- 'YYYY-MM-DD'
  is_available INTEGER DEFAULT 0,  -- 0 = blocked
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Appointments : enrichir
ALTER TABLE appointments ADD COLUMN calendar_id TEXT;
ALTER TABLE appointments ADD COLUMN assignee_user_id TEXT;
ALTER TABLE appointments ADD COLUMN attendees_json TEXT DEFAULT '[]';
ALTER TABLE appointments ADD COLUMN conference_link TEXT;
ALTER TABLE appointments ADD COLUMN reminder_minutes INTEGER DEFAULT 60;
ALTER TABLE appointments ADD COLUMN buffer_before_min INTEGER DEFAULT 0;
ALTER TABLE appointments ADD COLUMN buffer_after_min INTEGER DEFAULT 0;
ALTER TABLE appointments ADD COLUMN recurring_rule TEXT;  -- iCal RRULE
ALTER TABLE appointments ADD COLUMN parent_appointment_id TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_calendar ON appointments(calendar_id);
CREATE INDEX IF NOT EXISTS idx_availability_user ON availability_rules(user_id);

-- Jours fériés QC pré-seedés
INSERT OR IGNORE INTO date_overrides (id, user_id, date, is_available, reason)
SELECT lower(hex(randomblob(16))), u.id, '2026-07-01', 0, 'Fête du Canada'
FROM users u;
INSERT OR IGNORE INTO date_overrides (id, user_id, date, is_available, reason)
SELECT lower(hex(randomblob(16))), u.id, '2026-06-24', 0, 'Saint-Jean-Baptiste'
FROM users u;
