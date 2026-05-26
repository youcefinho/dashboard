-- ── Sprint 33 — Calendar sync GCal + Outlook bidirectional — seq128 (2026-05-23)
-- 100% ADDITIF. Zéro ALTER. Zéro FK. Zéro CHECK. Validation HANDLER.
-- depends_on : seq95 (oauth_connections) + seq32 phase24 (appointments enriched)
--            + seq127 (chaînage)

CREATE TABLE IF NOT EXISTS calendar_connections (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id               TEXT,
  agency_id               TEXT,
  user_id                 TEXT,
  oauth_connection_id     TEXT,           -- FK applicative → oauth_connections.id
  provider                TEXT,           -- 'google_calendar' | 'outlook'
  external_account_email  TEXT,
  external_calendar_id    TEXT,           -- "primary" GCal OU id Outlook
  external_calendar_name  TEXT,
  webhook_channel_id      TEXT,
  webhook_resource_id     TEXT,
  webhook_client_state    TEXT,
  webhook_expires_at      TEXT,
  sync_direction          TEXT DEFAULT 'bidirectional',  -- 'push_only' | 'pull_only' | 'bidirectional'
  status                  TEXT DEFAULT 'active',         -- 'active' | 'paused' | 'error' | 'revoked'
  last_pull_at            TEXT,
  last_push_at            TEXT,
  last_error              TEXT,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_external_events (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id               TEXT,
  calendar_connection_id  TEXT,
  external_event_id       TEXT,
  external_etag           TEXT,
  summary                 TEXT,
  description             TEXT,
  start_time              TEXT,
  end_time                TEXT,
  location                TEXT,
  organizer_email         TEXT,
  attendees_json          TEXT DEFAULT '[]',
  status                  TEXT,
  recurrence_rule         TEXT,
  external_updated_at     TEXT,
  raw_json                TEXT,
  fetched_at              TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointment_sync (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id               TEXT,
  appointment_id          TEXT,
  calendar_connection_id  TEXT,
  external_event_id       TEXT,
  external_etag           TEXT,
  sync_status             TEXT DEFAULT 'pending',
  sync_direction          TEXT,
  last_synced_at          TEXT,
  last_error              TEXT,
  conflict_resolution     TEXT,
  conflict_resolved_at    TEXT,
  conflict_resolved_by    TEXT,
  intralys_updated_at     TEXT,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cal_conn_tenant      ON calendar_connections(client_id, provider, status);
CREATE INDEX IF NOT EXISTS idx_cal_ext_events_conn  ON calendar_external_events(calendar_connection_id, external_event_id);
CREATE INDEX IF NOT EXISTS idx_appt_sync_appt       ON appointment_sync(client_id, appointment_id);
CREATE INDEX IF NOT EXISTS idx_appt_sync_external   ON appointment_sync(calendar_connection_id, external_event_id);
