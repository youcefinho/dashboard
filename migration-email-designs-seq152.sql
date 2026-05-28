-- Migration seq 152 — Sprint 60 Constructeur de Courriels Drag-and-Drop
--
-- Création de la table email_designs pour le CRUD des gabarits marketing.
-- Pas de FK réelles selon les standards D1. Jointures applicatives.

CREATE TABLE IF NOT EXISTS email_designs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT DEFAULT '',
  html_content TEXT NOT NULL,
  design_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_designs_client ON email_designs(client_id);
