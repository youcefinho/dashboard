-- Migration Phase 3 — Automations & Workflows
-- Exécuter : bun run db:migrate:phase3

-- ── Définitions de workflows ────────────────────────────────
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,                     -- NULL = workflow global Intralys
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  trigger_type TEXT NOT NULL,          -- 'lead_created', 'status_changed', 'tag_added', 'form_submitted', 'score_threshold'
  trigger_config TEXT DEFAULT '{}',    -- JSON config du trigger (ex: {"from_status":"new","to_status":"contacted"})
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workflows_client_id ON workflows(client_id);
CREATE INDEX IF NOT EXISTS idx_workflows_trigger_type ON workflows(trigger_type);
CREATE INDEX IF NOT EXISTS idx_workflows_is_active ON workflows(is_active);

-- ── Steps d'un workflow (séquence ordonnée) ─────────────────
CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  step_type TEXT NOT NULL,             -- 'send_email', 'send_sms', 'wait', 'condition', 'add_tag', 'remove_tag', 'change_status', 'assign', 'notify', 'webhook'
  config TEXT DEFAULT '{}',            -- JSON config du step
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow_id ON workflow_steps(workflow_id);

-- ── Enrollments (un lead inscrit dans un workflow) ──────────
CREATE TABLE IF NOT EXISTS workflow_enrollments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  current_step_id TEXT,                -- ID du step actuel
  status TEXT CHECK (status IN ('active', 'paused', 'completed', 'cancelled')) DEFAULT 'active',
  next_action_at TEXT,                 -- Quand le prochain step s'exécute (pour le cron)
  enrolled_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_enrollments_workflow_id ON workflow_enrollments(workflow_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_lead_id ON workflow_enrollments(lead_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON workflow_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_enrollments_next_action ON workflow_enrollments(next_action_at);

-- ── Log d'exécution des steps ───────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_execution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT CHECK (status IN ('executed', 'skipped', 'failed')) DEFAULT 'executed',
  result TEXT DEFAULT '',              -- JSON détails du résultat
  executed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exec_log_enrollment ON workflow_execution_log(enrollment_id);

-- ══════════════════════════════════════════════════════════════
-- Workflows pré-configurés pour courtiers immobiliers
-- ══════════════════════════════════════════════════════════════

-- ── Workflow 1 : Nouveau lead → Séquence de relance ────────
INSERT OR IGNORE INTO workflows (id, client_id, name, description, trigger_type, trigger_config, is_active)
VALUES (
  'wf-new-lead-followup', NULL,
  '🆕 Relance nouveau lead',
  'Séquence automatique : email de bienvenue, puis relances J+1, J+3 et J+7 si pas de réponse.',
  'lead_created', '{}', 1
);

INSERT OR IGNORE INTO workflow_steps (id, workflow_id, step_order, step_type, config) VALUES
  ('step-nf-1', 'wf-new-lead-followup', 1, 'send_email', '{"template_id":"tpl-welcome","delay_minutes":0}'),
  ('step-nf-2', 'wf-new-lead-followup', 2, 'wait', '{"delay_minutes":1440}'),
  ('step-nf-3', 'wf-new-lead-followup', 3, 'send_email', '{"template_id":"tpl-followup-1","delay_minutes":0}'),
  ('step-nf-4', 'wf-new-lead-followup', 4, 'wait', '{"delay_minutes":4320}'),
  ('step-nf-5', 'wf-new-lead-followup', 5, 'send_email', '{"template_id":"tpl-followup-3","delay_minutes":0}'),
  ('step-nf-6', 'wf-new-lead-followup', 6, 'wait', '{"delay_minutes":10080}'),
  ('step-nf-7', 'wf-new-lead-followup', 7, 'add_tag', '{"tag":"froid"}'),
  ('step-nf-8', 'wf-new-lead-followup', 8, 'notify', '{"message":"Le lead {{nom}} n''a pas répondu après 7 jours de relance."}');

-- ── Workflow 2 : RDV confirmé → Rappels ────────────────────
INSERT OR IGNORE INTO workflows (id, client_id, name, description, trigger_type, trigger_config, is_active)
VALUES (
  'wf-meeting-reminders', NULL,
  '📅 Rappels de rendez-vous',
  'Envoie une confirmation immédiate + rappel SMS 24h avant le RDV.',
  'status_changed', '{"to_status":"meeting"}', 1
);

INSERT OR IGNORE INTO workflow_steps (id, workflow_id, step_order, step_type, config) VALUES
  ('step-mr-1', 'wf-meeting-reminders', 1, 'send_email', '{"template_id":"tpl-rdv-confirm","delay_minutes":0}'),
  ('step-mr-2', 'wf-meeting-reminders', 2, 'wait', '{"delay_minutes":1440}'),
  ('step-mr-3', 'wf-meeting-reminders', 3, 'send_sms', '{"message":"Rappel : votre rendez-vous avec {{courtier}} est demain. À bientôt !","delay_minutes":0}');

-- ── Workflow 3 : Lead chaud → Notification courtier ────────
INSERT OR IGNORE INTO workflows (id, client_id, name, description, trigger_type, trigger_config, is_active)
VALUES (
  'wf-hot-lead-notify', NULL,
  '🔥 Lead chaud — Notification',
  'Notifie le courtier et ajoute le tag "chaud" quand un lead atteint un score > 70.',
  'score_threshold', '{"min_score":70}', 1
);

INSERT OR IGNORE INTO workflow_steps (id, workflow_id, step_order, step_type, config) VALUES
  ('step-hn-1', 'wf-hot-lead-notify', 1, 'add_tag', '{"tag":"chaud"}'),
  ('step-hn-2', 'wf-hot-lead-notify', 2, 'change_status', '{"status":"contacted"}'),
  ('step-hn-3', 'wf-hot-lead-notify', 3, 'notify', '{"message":"🔥 Lead chaud détecté : {{nom}} (score {{score}}) — Contactez-le rapidement !"}');
