-- ── Migration Call Summaries & Actions — seq175 ──
CREATE TABLE call_summaries (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  call_id TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_call_summaries_call_id ON call_summaries(call_id);
