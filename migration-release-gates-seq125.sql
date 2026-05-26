-- ── Sprint 30 — Release Candidate / Beta — seq125 (2026-05-23) ──────────────
-- 100 % ADDITIF : CREATE TABLE IF NOT EXISTS + seed idempotent (ON CONFLICT).
-- AUCUN ALTER de table existante. AUCUNE capability ajoutée (ALL_CAPABILITIES
-- seq80 figées). AUCUN CHECK touché. Convention figée : id TEXT DEFAULT
-- (lower(hex(randomblob(16)))), timestamps TEXT DEFAULT (datetime('now')).
-- depends_on : seq124 (migration-mobile-harden-seq124.sql).

-- 1) release_gates_runs — audit léger de chaque check programmatique
--    déclenché via GET /api/admin/release-gates. Lecture seule pour Rochdi.
CREATE TABLE IF NOT EXISTS release_gates_runs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  ran_by      TEXT,
  all_green   INTEGER NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_release_gates_created
  ON release_gates_runs(created_at);

-- 2) beta_invite_codes — câblage codes BETA-CODES.md ↔ workflow signup.
--    Comble le GAP : BETA-CODES.md mentionne la table mais beta.ts ne la
--    consultait pas. Validation côté handler beta.ts:handleBetaSignup
--    (Sprint 30 patch Manager-B).
CREATE TABLE IF NOT EXISTS beta_invite_codes (
  code         TEXT PRIMARY KEY,
  max_uses     INTEGER NOT NULL DEFAULT 1,
  used_count   INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Seed idempotent des 5 codes documentés BETA-CODES.md (cf. fichier racine).
INSERT OR IGNORE INTO beta_invite_codes (code) VALUES
  ('BETA-INTRALYS-2026-X7K9'),
  ('BETA-INTRALYS-2026-M4P2'),
  ('BETA-INTRALYS-2026-L8V5'),
  ('BETA-INTRALYS-2026-R3N1'),
  ('BETA-INTRALYS-2026-Q9J4');
