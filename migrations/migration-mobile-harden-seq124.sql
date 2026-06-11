-- ── Sprint 27 — Mobile / PWA harden — seq124 (2026-05-22) ───────────────────
-- 100% ADDITIF : ALTER TABLE ADD COLUMN nullables sans DEFAULT non-constant.
-- AUCUN ALTER de CHECK. AUCUNE capability ajoutée (ALL_CAPABILITIES seq80 figées).
-- Sources de vérité :
--   - device_tokens : migration_p3_10.sql:7-13 (seq20) + migration-phase36.sql (seq44 redondance)
-- Objectif : préparer cleanup tokens stale (cron futur) + user-toggle push notifications
-- par device sans casser le schema existant.
-- depends_on : migration_p3_10.sql (seq20), migration-perf-indexes-seq123.sql (seq123)

ALTER TABLE device_tokens ADD COLUMN last_seen_at TEXT;
ALTER TABLE device_tokens ADD COLUMN app_version TEXT;
ALTER TABLE device_tokens ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE device_tokens ADD COLUMN device_label TEXT;

CREATE INDEX IF NOT EXISTS idx_device_tokens_enabled ON device_tokens(user_id, enabled);
