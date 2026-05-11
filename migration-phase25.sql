-- Migration Sprint 5 - Phase B (Tasks)
-- Subtasks
CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_done INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Comments on tasks
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Task attachments
CREATE TABLE IF NOT EXISTS task_attachments (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  PRIMARY KEY (task_id, file_id)
);

-- Task templates
CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  default_priority TEXT DEFAULT 'medium',
  default_due_offset_days INTEGER DEFAULT 0,
  subtasks_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Enrichir tasks
ALTER TABLE tasks ADD COLUMN recurring_rule TEXT;
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;
ALTER TABLE tasks ADD COLUMN reminder_minutes_before INTEGER;

CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);
