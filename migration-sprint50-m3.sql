-- ── Sprint 50 M3 — Beta invite flow ───────────────────────────────────────
-- Tables : beta_signups, magic_tokens, beta_feedback, roadmap_items, roadmap_votes
-- Note : ces tables sont aussi auto-créées idempotemment au runtime par
-- src/worker/beta.ts (ensureSchema). Cette migration est le canal officiel.

-- Liste d'attente beta privée (Loi 25/CASL : consent explicite obligatoire)
CREATE TABLE IF NOT EXISTS beta_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  company TEXT,
  industry TEXT,
  team_size TEXT,
  use_case TEXT,
  consent INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  invited_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Tokens magic link (single-use, TTL 15 min)
CREATE TABLE IF NOT EXISTS magic_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_email ON magic_tokens(email);

-- Feedback widget in-app (type / message / url) — distinct du NPS feedback existant
CREATE TABLE IF NOT EXISTS beta_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT,
  message TEXT,
  url TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Roadmap publique (kanban 3 colonnes : idea / progress / done)
CREATE TABLE IF NOT EXISTS roadmap_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  column TEXT DEFAULT 'idea',
  votes INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Votes roadmap (dédup par voter = IP best-effort)
CREATE TABLE IF NOT EXISTS roadmap_votes (
  item_id TEXT NOT NULL,
  voter TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (item_id, voter)
);
