-- ── Sprint 35 — Snapshots GHL-style (export/import bundle multi-table) — seq130 (2026-05-24)
-- 100% ADDITIF. Zéro ALTER. Zéro FK. Zéro CHECK. Zéro DROP. Zéro RENAME.
-- Validation des enums (status, mode) faite SIDE-HANDLER (snapshots.ts /
-- snapshots-import.ts) — calque LOT-CALENDAR-SYNC-S33 §6.1 et tous les
-- sprints LOT 1/2/3 récents (pas de CHECK = pas de rebuild SQLite jamais).
--
-- depends_on : seq129 (twilio-voice — chaînage strict du manifest).
-- Voir docs/LOT-SNAPSHOTS-S35.md §6 pour contrat figé inter-agent Phase B.
--
-- Périmètre v1 :
--   - `snapshots`         : bundle exporté (payload JSON sérialisé +
--                           SHA-256 deterministic + métadonnées status/version).
--   - `snapshot_imports`  : trace d'un import (dry_run | commit) avec id-mapping
--                           résultant + log entry-by-entry pour audit/replay.
--
-- AUCUNE table métier touchée. Les 27 entités snapshottables (pipelines,
-- workflows, templates, forms, calendars, etc.) restent inchangées :
-- l'export les lit (SELECT) et l'import les INSERT côté target, sans toucher
-- au schéma existant.

CREATE TABLE IF NOT EXISTS snapshots (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id              TEXT,
  agency_id              TEXT,
  name                   TEXT NOT NULL,
  description            TEXT,
  version                INTEGER DEFAULT 1,
  schema_version         INTEGER NOT NULL,
  payload_json           TEXT NOT NULL,
  payload_hash_sha256    TEXT NOT NULL,
  payload_size_bytes     INTEGER NOT NULL,
  tables_summary_json    TEXT,
  status                 TEXT NOT NULL DEFAULT 'draft',   -- enum HANDLER : draft|published|archived
  created_by             TEXT NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT
);

CREATE TABLE IF NOT EXISTS snapshot_imports (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  snapshot_id            TEXT,
  source_client_id       TEXT,
  target_client_id       TEXT NOT NULL,
  target_agency_id       TEXT,
  mode                   TEXT NOT NULL,                   -- enum HANDLER : dry_run|commit
  status                 TEXT NOT NULL DEFAULT 'pending', -- enum HANDLER : pending|running|completed|failed
  payload_hash_sha256    TEXT NOT NULL,
  schema_version         INTEGER NOT NULL,
  id_mapping_json        TEXT,
  log_json               TEXT,
  summary_json           TEXT,
  started_by             TEXT NOT NULL,
  started_at             TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_client            ON snapshots(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_agency            ON snapshots(agency_id, status);
CREATE INDEX IF NOT EXISTS idx_snapshot_imports_target     ON snapshot_imports(target_client_id, started_at);
CREATE INDEX IF NOT EXISTS idx_snapshot_imports_snapshot   ON snapshot_imports(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_imports_status     ON snapshot_imports(status);
