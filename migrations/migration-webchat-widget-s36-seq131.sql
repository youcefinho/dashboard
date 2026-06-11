-- ── Sprint 36 — Live chat widget (ENRICHISSEMENT webchat existant) — seq131 (2026-05-24)
-- 100% ADDITIF. Zéro DROP. Zéro RENAME. Zéro CHECK. Zéro FK destructrice.
-- ENRICHIT le webchat existant (seq25 = migration-phase15.sql, Durable Object
-- WebchatRoom déjà fonctionnel dans src/worker/webchat.ts). On NE TOUCHE PAS
-- au DO, au widget v1.js, à frame.html : on ajoute le SOCLE (sécurité origin
-- + Turnstile + presence agent + contexte session enrichi) sans réécrire.
--
-- depends_on : seq130 (snapshots — chaînage strict du manifest) +
--              seq25 (migration-phase15.sql — tables webchat_widgets / webchat_sessions).
-- Voir docs/LOT-CHAT-WIDGET-S36.md §6 pour contrat figé inter-agent Phase B.
--
-- Périmètre v1 :
--   - ALTER webchat_widgets : multi-tenant agency + allowlist origins + Turnstile +
--     presence agent + replies bot + branding (avatar, powered_by).
--   - ALTER webchat_sessions : conversation_id + page_url + referrer + UA +
--     hashed IP (SHA-256, jamais IP brute) + presence agent + unread agent.
--   - CREATE webchat_agent_presence : heartbeat agent par tenant (online/away/offline).
--   - 5 indexes : listing tenant/agence + lookup conversation + lookup presence.
--
-- Validation enums (position, status) faite SIDE-HANDLER (chat-widgets.ts) —
-- calque LOT-SNAPSHOTS-S35 §6 + LOT-CALENDAR-SYNC-S33 §6.1 (pas de CHECK = pas
-- de rebuild SQLite jamais).

-- ── webchat_widgets : enrichissement (multi-tenant + sécurité + branding) ───
ALTER TABLE webchat_widgets ADD COLUMN agency_id TEXT;
ALTER TABLE webchat_widgets ADD COLUMN name TEXT;
ALTER TABLE webchat_widgets ADD COLUMN allowed_origins TEXT;        -- JSON array, NULL = no allowlist (legacy)
ALTER TABLE webchat_widgets ADD COLUMN position TEXT DEFAULT 'bottom-right'; -- enum HANDLER : bottom-right|bottom-left|top-right|top-left
ALTER TABLE webchat_widgets ADD COLUMN offline_message TEXT;
ALTER TABLE webchat_widgets ADD COLUMN bot_initial_replies_json TEXT DEFAULT '[]';
ALTER TABLE webchat_widgets ADD COLUMN avatar_url TEXT;
ALTER TABLE webchat_widgets ADD COLUMN show_powered_by INTEGER DEFAULT 1;
ALTER TABLE webchat_widgets ADD COLUMN updated_at TEXT;
ALTER TABLE webchat_widgets ADD COLUMN turnstile_enabled INTEGER DEFAULT 0;

-- ── webchat_sessions : enrichissement (conversation + contexte visiteur) ───
ALTER TABLE webchat_sessions ADD COLUMN conversation_id TEXT;
ALTER TABLE webchat_sessions ADD COLUMN page_url TEXT;
ALTER TABLE webchat_sessions ADD COLUMN referrer TEXT;
ALTER TABLE webchat_sessions ADD COLUMN user_agent TEXT;
ALTER TABLE webchat_sessions ADD COLUMN ip_hash TEXT;               -- SHA-256, JAMAIS IP brute (Loi 25 / RGPD)
ALTER TABLE webchat_sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE webchat_sessions ADD COLUMN agent_user_id TEXT;
ALTER TABLE webchat_sessions ADD COLUMN unread_agent_count INTEGER DEFAULT 0;

-- ── webchat_agent_presence : heartbeat agent par tenant ────────────────────
CREATE TABLE IF NOT EXISTS webchat_agent_presence (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id             TEXT NOT NULL,
  client_id           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'offline',     -- enum HANDLER : online|away|offline
  last_heartbeat_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes (listing tenant + lookup conversation + unicité presence) ──────
CREATE INDEX IF NOT EXISTS idx_webchat_widgets_client      ON webchat_widgets(client_id);
CREATE INDEX IF NOT EXISTS idx_webchat_widgets_agency      ON webchat_widgets(agency_id);
CREATE INDEX IF NOT EXISTS idx_webchat_sessions_conv       ON webchat_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_webchat_sessions_started    ON webchat_sessions(started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webchat_presence_user_client ON webchat_agent_presence(user_id, client_id);
