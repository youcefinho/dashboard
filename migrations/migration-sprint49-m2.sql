-- Migration Sprint 49 M2 — Predictive + insights
-- Auteur : Manager M2 — Sprint 49 (2026-05-16)
--
-- Table :
--   lead_predictions — cache 6h des prévisions de conversion 30j (M2.1)
--
-- Note M2.2 (bottlenecks) / M2.3 (anomalies) : pas de table — calcul
-- déterministe SQL à la volée (cf. src/worker/pipeline-insights.ts).
-- Note M2.4 (insight variants) : pure présentation, aucune table.

-- ════════════════════════════════════════════════════════════════
-- Cache prévision conversion 30 jours (TTL 6h, recompute on miss)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lead_predictions (
  lead_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,            -- JSON LeadPrediction
  computed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_lead_predictions_computed_at
  ON lead_predictions(computed_at);
