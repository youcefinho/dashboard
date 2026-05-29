-- Migration: migration-weekly-insights-seq170.sql
-- Description: Création de la table weekly_ai_insights pour stocker les rapports d'analyse hebdomadaire IA
-- Depends-on: migration-sentiment-intent-seq168.sql

CREATE TABLE IF NOT EXISTS weekly_ai_insights (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  content TEXT NOT NULL,
  metric_changes_json TEXT NOT NULL, -- JSON contenant les deltas de KPIs (leads, deals, conversion)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_weekly_ai_insights_client ON weekly_ai_insights(client_id);
CREATE INDEX IF NOT EXISTS idx_weekly_ai_insights_created ON weekly_ai_insights(created_at);
