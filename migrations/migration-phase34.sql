-- Migration Phase 34 : Propriétés (Centris)
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  mls_number TEXT DEFAULT '',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL DEFAULT 0,
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  property_type TEXT DEFAULT 'Maison',
  status TEXT CHECK (status IN ('active', 'sold', 'expired', 'rented')) DEFAULT 'active',
  bedrooms INTEGER DEFAULT 0,
  bathrooms INTEGER DEFAULT 0,
  area_sqft INTEGER DEFAULT 0,
  year_built INTEGER DEFAULT 0,
  image_url TEXT DEFAULT '',
  features_json TEXT DEFAULT '[]',
  sync_source TEXT DEFAULT 'manual', -- 'manual', 'centris', etc.
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_properties_client ON properties(client_id);
CREATE INDEX IF NOT EXISTS idx_properties_mls ON properties(mls_number);
