-- ── Migration Lead Scoring Comportemental v2 — seq173 ──
CREATE TABLE behavioral_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  score_delta INTEGER NOT NULL,
  score_after INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_behavioral_events_lead ON behavioral_events(lead_id);
CREATE INDEX idx_behavioral_events_created ON behavioral_events(created_at);
