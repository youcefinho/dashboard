-- Sprint 13: Phase 38 Migration
-- Webhook Deliveries Log

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending', 'delivered', 'failed', 'retrying', 'dead')) DEFAULT 'pending',
  response_code INTEGER,
  response_body TEXT,
  attempt INTEGER DEFAULT 0,
  scheduled_at TEXT DEFAULT (datetime('now')),
  delivered_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub ON webhook_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
