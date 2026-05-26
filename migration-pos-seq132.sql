-- ── Sprint 37 — POS retail caisse (ENRICHISSEMENT ecommerce B2 existant) — seq132 (2026-05-24)
-- 100% ADDITIF. Zéro DROP. Zéro RENAME. Zéro CHECK. Zéro FK destructrice.
-- ENRICHIT le module ecommerce B2 (seq58 = migration-sprintE1-m1-ecommerce-schema.sql)
-- avec une couche POS caisse au-dessus de l'ecommerce existant. On NE TOUCHE PAS
-- à ecommerce-orders.ts / ecommerce-tax-engine.ts / ecommerce-payments.ts.
-- Les transactions POS écriront via createOrderCore + commitOrderSale (verbatim).
--
-- depends_on : seq131 (webchat widget — chaînage strict du manifest) +
--              seq58  (migration-sprintE1-m1-ecommerce-schema.sql — tables orders / product_variants).
-- Voir docs/LOT-POS-S37.md §6 pour contrat figé inter-agent Phase B.
--
-- Périmètre v1 :
--   - CREATE pos_registers : caisses physiques par tenant (nom, devise, régime fiscal défaut, config imprimante).
--   - CREATE pos_sessions  : shifts caissier (ouverture/fermeture, fond de caisse, variance, agrégats).
--   - CREATE pos_transactions : événements caisse (lien optionnel order + paiement + reçu + void).
--   - ALTER orders ADD pos_session_id / pos_register_id (NULL = commande web standard).
--   - 7 indexes : listing tenant + lookup sessions par registre + lookup transactions
--     + lookup variantes par code-barres (scan caisse).
--
-- Validation enums (status pos_sessions, payment_method pos_transactions) faite
-- SIDE-HANDLER (pos-sessions.ts / pos-transactions.ts) — calque LOT-CHAT-WIDGET-S36 §6
-- + LOT-SNAPSHOTS-S35 (pas de CHECK = pas de rebuild SQLite jamais).
--
-- Stripe Terminal (paiements physiques) = flag inactif (E4 figé) — rails posés
-- sans charge réelle (idiome `if (!env.STRIPE_TERMINAL_*) return mock`).

-- ── pos_registers : caisses physiques par tenant ────────────────────────────
CREATE TABLE IF NOT EXISTS pos_registers (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id           TEXT NOT NULL REFERENCES clients(id),
  name                TEXT NOT NULL,
  location            TEXT DEFAULT '',
  currency            TEXT DEFAULT 'CAD',
  is_active           INTEGER DEFAULT 1,
  default_tax_region  TEXT DEFAULT 'qc',           -- enum HANDLER : qc|eu|dz|exempt (verbatim ecommerce-tax-engine.ts)
  printer_config_json TEXT DEFAULT '{}',           -- JSON {vendor_id, product_id, paper_width_mm, ...}
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

-- ── pos_sessions : shifts caissier (ouverture/fermeture/variance) ───────────
CREATE TABLE IF NOT EXISTS pos_sessions (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  register_id            TEXT NOT NULL REFERENCES pos_registers(id),
  client_id              TEXT NOT NULL REFERENCES clients(id),
  opened_by              TEXT,                                     -- user_id ouverture
  opened_at              TEXT,
  closed_at              TEXT,
  closed_by              TEXT,                                     -- user_id fermeture
  opening_cash_cents     INTEGER DEFAULT 0,
  closing_cash_cents     INTEGER,
  expected_cash_cents    INTEGER,
  variance_cents         INTEGER,
  status                 TEXT DEFAULT 'open',                      -- enum HANDLER : open|closed|reconciled
  total_sales_cents      INTEGER DEFAULT 0,
  total_tax_cents        INTEGER DEFAULT 0,
  transaction_count      INTEGER DEFAULT 0,
  notes                  TEXT DEFAULT '',
  created_at             TEXT DEFAULT (datetime('now'))
);

-- ── pos_transactions : événements caisse + paiement + reçu ──────────────────
CREATE TABLE IF NOT EXISTS pos_transactions (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id            TEXT NOT NULL REFERENCES pos_sessions(id),
  client_id             TEXT NOT NULL REFERENCES clients(id),
  order_id              TEXT REFERENCES orders(id),                -- NULL si transaction non-order (ex: rendu fond caisse)
  payment_method        TEXT,                                       -- enum HANDLER : cash|card_terminal|gift_card|other|split
  amount_cents          INTEGER,
  tendered_cents        INTEGER,                                    -- somme remise client (cash) — NULL si carte
  change_due_cents      INTEGER DEFAULT 0,
  card_terminal_ref     TEXT,                                       -- ref Stripe Terminal / autre PSP — NULL si cash
  receipt_url           TEXT,                                       -- URL R2 reçu PDF (généré côté handler)
  voided_at             TEXT,
  voided_by             TEXT,                                       -- user_id annulation
  void_reason           TEXT,
  cashier_id            TEXT,                                       -- user_id caissier (audit-trail)
  created_at            TEXT DEFAULT (datetime('now'))
);

-- ── ALTER orders : rattachement POS (NULL = commande web standard) ──────────
ALTER TABLE orders ADD COLUMN pos_session_id  TEXT;
ALTER TABLE orders ADD COLUMN pos_register_id TEXT;

-- ── Indexes (listing + lookup + scan code-barres) ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_pos_registers_client     ON pos_registers(client_id, is_active);
CREATE INDEX IF NOT EXISTS idx_pos_sessions_register    ON pos_sessions(register_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_sessions_client      ON pos_sessions(client_id, opened_at);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_session ON pos_transactions(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_order   ON pos_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_client  ON pos_transactions(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON product_variants(barcode);
