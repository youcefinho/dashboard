-- Migration Sprint 43 — Backend wiring M3
-- Auteur : Manager M3 — Sprint 43 (2026-05-15)
--
-- Tables :
--   1. message_reactions       — reactions emoji par message (M3.1)
--   2. quick_replies           — quick replies per-lead × per-user FIFO 3 (M3.2)
--   3. lead_score_cache        — cache 1h des breakdowns explicables (M3.4)
--
-- Note M3.3 (AI Drafts) : pas de table — wirage direct sur Anthropic API via
-- callLLM() existant dans src/worker/ai.ts.

-- ════════════════════════════════════════════════════════════════
-- 1) Reactions emoji par message
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS message_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON message_reactions(user_id);

-- ════════════════════════════════════════════════════════════════
-- 2) Quick Replies per-lead × per-user (FIFO 3)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS quick_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_quick_replies_lead_user
  ON quick_replies(lead_id, user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════
-- 3) Cache lead score explainable (TTL 1h, recompute on miss)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lead_score_cache (
  lead_id TEXT PRIMARY KEY,
  score INTEGER NOT NULL,
  signals TEXT NOT NULL,           -- JSON ScoreSignal[]
  computed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_lead_score_cache_computed_at
  ON lead_score_cache(computed_at);
