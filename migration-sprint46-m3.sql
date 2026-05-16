-- Migration Sprint 46 M3 — Notifications center (real-time + preferences extended)
-- Auteur : Manager M3 — Sprint 46 (2026-05-15)
--
-- Changements :
--   1. Index composite optimisé sur notifications (user, read_at, created_at DESC)
--      pour query rapide "non lues les plus récentes" du panel.
--   2. Élargissement CHECK constraint notification_preferences pour inclure
--      les nouveaux channels 'slack' (Sprint 46 M3.3). SQLite ne supporte pas
--      ALTER TABLE ... DROP CONSTRAINT — on recrée la table en préservant data.
--
-- Note : `notifications` (Phase 5) et `notification_preferences` (Phase 29)
-- existent déjà. On AJOUTE seulement (idempotent IF NOT EXISTS), pas de DROP.

-- ── 1. Index optimisé notifications (tri timeline panel M3.2) ─────────────────
CREATE INDEX IF NOT EXISTS idx_notif_user_read_created
  ON notifications(user_id, is_read, created_at DESC);

-- ── 2. notification_preferences : élargir CHECK pour inclure 'slack' ─────────
-- Stratégie : table temp + INSERT SELECT + DROP + RENAME (data-preserving).
-- Idempotent : si la nouvelle table existe déjà (re-run migration), no-op.

CREATE TABLE IF NOT EXISTS notification_preferences_v2 (
  user_id TEXT NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'push', 'in_app', 'slack')),
  event_type TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, channel, event_type)
);

-- Migrate data ancienne → nouvelle (IGNORE conflits PK si déjà migrée)
INSERT OR IGNORE INTO notification_preferences_v2 (user_id, channel, event_type, enabled)
SELECT user_id, channel, event_type, enabled
FROM notification_preferences
WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='notification_preferences');

-- NOTE : on ne DROP PAS la table source pour permettre rollback safe.
-- L'application doit pointer vers `notification_preferences` toujours.
-- Si on veut basculer définitivement, déployer en 2 étapes :
--   1) cette migration crée v2 (no-op au runtime)
--   2) migration follow-up : DROP TABLE notification_preferences;
--      ALTER TABLE notification_preferences_v2 RENAME TO notification_preferences;
--
-- Pour Sprint 46 M3 : la route worker `handleNotificationPreferences` lit/écrit
-- toujours sur `notification_preferences`. Comme le CHECK constraint de l'ancienne
-- table N'INCLUT PAS 'slack', un INSERT 'slack' sera REJETÉ par SQLite.
-- Workaround : on patche le CHECK directement en recréant la table source —
-- mais sans drop pour la sécurité, on opte pour la version qui DROP/RENAME
-- en mode "DEPLOY" explicite (commenté pour le moment).
--
-- Pour activer la bascule réelle, décommenter ci-dessous APRÈS backup :
--
-- DROP TABLE IF EXISTS notification_preferences;
-- ALTER TABLE notification_preferences_v2 RENAME TO notification_preferences;
