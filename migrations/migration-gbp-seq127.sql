-- ── Sprint 32 — Google Business Profile (GBP) integration — seq127 (2026-05-23)
-- 100% ADDITIF : 4 CREATE TABLE IF NOT EXISTS + 4 CREATE INDEX. AUCUN ALTER de
-- table existante. AUCUNE FK. AUCUN CHECK (status/provider validés HANDLER).
-- Tokens GBP stockés dans oauth_connections (seq95) — pas de duplication crypto.
-- depends_on : seq95 (oauth_connections), seq109 (reviews_cache), seq110 (social_posts)
--            + chaînage seq126 (Sprint 31 dernier)

CREATE TABLE IF NOT EXISTS gbp_connections (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id             TEXT,
  agency_id             TEXT,
  oauth_connection_id   TEXT,           -- FK applicative → oauth_connections.id (provider='google_business')
  gbp_account_id        TEXT,           -- "accounts/{accountId}" sans préfixe Google
  gbp_account_name      TEXT,
  status                TEXT DEFAULT 'active',
  last_sync_at          TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gbp_locations (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id             TEXT,
  gbp_connection_id     TEXT,
  gbp_account_id        TEXT,
  gbp_location_id       TEXT,           -- "locations/{locId}" sans préfixe
  location_title        TEXT,
  primary_phone         TEXT,
  primary_category      TEXT,
  store_code            TEXT,
  metadata_json         TEXT,           -- JSON brut location (cache léger)
  is_default            INTEGER DEFAULT 0,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gbp_posts_sync (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id             TEXT,
  social_post_id        TEXT,           -- jointure applicative → social_posts.id
  gbp_location_id       TEXT,
  gbp_local_post_name   TEXT,           -- "accounts/{a}/locations/{l}/localPosts/{p}"
  status                TEXT DEFAULT 'pending',  -- pending|published|failed
  error                 TEXT,
  published_at          TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gbp_reviews_sync (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id             TEXT,
  reviews_cache_id      TEXT,           -- jointure applicative → reviews_cache.id (peut être NULL avant 1er sync)
  gbp_location_id       TEXT,
  gbp_review_name       TEXT UNIQUE,    -- "accounts/{a}/locations/{l}/reviews/{r}" — unique cross-tenant (ID Google global)
  reply_status          TEXT DEFAULT 'none',  -- none|pending|sent|failed
  reply_synced_at       TEXT,
  last_fetched_at       TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gbp_conn_tenant       ON gbp_connections(client_id);
CREATE INDEX IF NOT EXISTS idx_gbp_loc_tenant        ON gbp_locations(client_id, gbp_account_id);
CREATE INDEX IF NOT EXISTS idx_gbp_posts_sync_post   ON gbp_posts_sync(social_post_id);
CREATE INDEX IF NOT EXISTS idx_gbp_reviews_sync_loc  ON gbp_reviews_sync(gbp_location_id, reply_status);
