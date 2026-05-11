-- Migration P3.7: Ajouter branches et conditions aux workflows
ALTER TABLE workflow_steps ADD COLUMN parent_step_id TEXT;
ALTER TABLE workflow_steps ADD COLUMN branch TEXT DEFAULT 'main';
