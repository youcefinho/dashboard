-- ── Sprint 38 — Gift cards + Loyalty programs (NEUF) — seq133 (2026-05-24)
-- 100% ADDITIF. Zéro DROP. Zéro RENAME. Zéro CHECK. Zéro FK destructrice.
-- ENRICHIT le module ecommerce B2 (seq58 = migration-sprintE1-m1-ecommerce-schema.sql)
-- avec une couche cartes-cadeaux + fidélité au-dessus de l'ecommerce existant.
-- On NE TOUCHE PAS aux tables paiement E4/E6 régulées (`payments`, `payment_events`,
-- `payment_provider_config`, `refunds`, `disputes`, `return_requests`).
--
-- depends_on : seq132 (POS — chaînage strict du manifest).
-- Voir docs/LOT-GIFTCARDS-LOYALTY-S38.md §6 pour contrat figé inter-agent Phase B.
--
-- Périmètre v1 :
--   - CREATE gift_cards               : cartes-cadeaux émises (code, soldes, statut, échéance).
--   - CREATE gift_card_transactions   : ledger des mouvements (issue/credit/debit/refund/expire/void).
--   - CREATE loyalty_programs         : programmes fidélité par tenant (taux earn/redeem, tiers).
--   - CREATE loyalty_ledger           : ledger points (earn/redeem/adjust/expire/tier_bonus).
--   - CREATE loyalty_customer_state   : balance courant + lifetime + tier par client.
--   - 11 indexes : listing tenant, lookup par code/customer/programme, expiration cron.
--
-- Validation enums (`status`, `type`, `current_tier`, `currency`) faite SIDE-HANDLER
-- (`gift-cards.ts` / `loyalty.ts` + libs `gift-card-engine.ts` / `loyalty-engine.ts`)
-- — calque LOT-POS-S37 §6 + LOT-CHAT-WIDGET-S36 (pas de CHECK = pas de rebuild SQLite jamais).
--
-- AUCUNE FK destructrice (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit).
-- Les jointures gift_card↔order / loyalty↔customer sont APPLICATIVES (colonne TEXT).
-- Money TOUJOURS en cents (INTEGER). Points en INTEGER signé (positif=earn, négatif=redeem).
--
-- Conventions schema.sql (vérifiées sur migration-pos-seq132.sql) :
--   id TEXT PK lower(hex(randomblob(16))), timestamps TEXT DEFAULT (datetime('now')).
--   PAS d'unixepoch, PAS d'INTEGER autoincrement, PAS de FK.
--
-- Bornage tenant : `client_id` (tenant propriétaire — calque pos_registers.client_id
-- seq132 / orders.client_id seq58) + `agency_id` (scope agence — calque funnels seq83).
-- Les handlers (Phase A stubs → Phase B/C corps) bornent systématiquement
-- `WHERE client_id = ?` (calque ecommerce-orders.ts:76 / pos-registers.ts:60).
--
-- Idempotence ABSOLUE :
--   - gift_card_transactions.idempotency_key : (gift_card_id|order_id|type) côté handler.
--   - loyalty_ledger.idempotency_key         : (program_id|customer_id|order_id|type) côté handler.
--   La colonne est NULLable (legacy/manual entries) mais l'index UNIQUE filtré est posé
--   APPLICATIVEMENT par le handler via SELECT ... WHERE idempotency_key = ? avant INSERT.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-giftcards-loyalty-seq133.sql --remote

-- ── gift_cards : cartes-cadeaux émises par tenant ──────────────────────────
CREATE TABLE IF NOT EXISTS gift_cards (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id                TEXT NOT NULL,
  agency_id                TEXT,
  code                     TEXT NOT NULL,                    -- code unique tenant (normalisé MAJ alphanumérique)
  initial_value_cents      INTEGER NOT NULL DEFAULT 0,
  current_balance_cents    INTEGER NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL DEFAULT 'CAD',
  expires_at               TEXT,                             -- NULL = pas d'expiration
  issued_to_customer_id    TEXT,                             -- NULL si carte anonyme
  issued_to_email          TEXT,                             -- destinataire optionnel
  issued_by_user_id        TEXT,                             -- audit-trail caissier/admin
  issued_at                TEXT DEFAULT (datetime('now')),
  last_used_at             TEXT,
  status                   TEXT NOT NULL DEFAULT 'active',   -- enum HANDLER : active|redeemed|expired|voided
  notes                    TEXT DEFAULT '',
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);

-- ── gift_card_transactions : ledger des mouvements de carte-cadeau ──────────
CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  gift_card_id             TEXT NOT NULL,
  client_id                TEXT NOT NULL,                    -- dénormalisé pour listing tenant rapide
  order_id                 TEXT,                             -- NULL si non-order (issue/refund manuel/expire)
  amount_cents             INTEGER NOT NULL DEFAULT 0,       -- signé : positif=credit/issue/refund, négatif=debit/expire/void
  type                     TEXT NOT NULL,                    -- enum HANDLER : issue|credit|debit|refund|expire|void
  balance_after_cents      INTEGER NOT NULL DEFAULT 0,       -- snapshot solde après application
  idempotency_key          TEXT,                             -- (gift_card_id|order_id|type) — anti-rejeu
  created_by_user_id       TEXT,                             -- audit-trail
  created_at               TEXT DEFAULT (datetime('now'))
);

-- ── loyalty_programs : programmes fidélité par tenant ───────────────────────
CREATE TABLE IF NOT EXISTS loyalty_programs (
  id                                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id                            TEXT NOT NULL,
  agency_id                            TEXT,
  name                                 TEXT NOT NULL DEFAULT '',
  currency                             TEXT NOT NULL DEFAULT 'CAD',
  earn_rate_per_dollar                 INTEGER NOT NULL DEFAULT 1,  -- points gagnés par $1 (entier)
  redeem_rate_cents_per_point          INTEGER NOT NULL DEFAULT 1,  -- valeur en cents d'un point au redeem
  min_redeem_points                    INTEGER NOT NULL DEFAULT 100,
  points_expiry_days                   INTEGER,                     -- NULL = pas d'expiration
  tier_thresholds_json                 TEXT DEFAULT '{}',           -- JSON {silver:N, gold:N, ...} lifetime_earned
  tier_benefits_json                   TEXT DEFAULT '{}',           -- JSON {silver:{multiplier:1.5}, ...}
  is_active                            INTEGER NOT NULL DEFAULT 1,
  created_at                           TEXT DEFAULT (datetime('now')),
  updated_at                           TEXT DEFAULT (datetime('now'))
);

-- ── loyalty_ledger : ledger des mouvements de points ────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  program_id               TEXT NOT NULL,
  client_id                TEXT NOT NULL,                    -- dénormalisé pour listing tenant rapide
  customer_id              TEXT NOT NULL,
  points                   INTEGER NOT NULL DEFAULT 0,       -- signé : positif=earn/adjust+/tier_bonus, négatif=redeem/expire/adjust-
  type                     TEXT NOT NULL,                    -- enum HANDLER : earn|redeem|adjust|expire|tier_bonus
  source_order_id          TEXT,                             -- NULL si non-order
  idempotency_key          TEXT,                             -- (program_id|customer_id|order_id|type) — anti-rejeu
  tier_snapshot            TEXT DEFAULT 'bronze',            -- tier au moment de l'écriture (audit)
  balance_after            INTEGER NOT NULL DEFAULT 0,       -- snapshot balance customer après application
  expires_at               TEXT,                             -- pour earn : date d'expiration projetée (sinon NULL)
  created_by_user_id       TEXT,                             -- audit-trail
  created_at               TEXT DEFAULT (datetime('now'))
);

-- ── loyalty_customer_state : balance courant par programme×customer ─────────
CREATE TABLE IF NOT EXISTS loyalty_customer_state (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  program_id               TEXT NOT NULL,
  client_id                TEXT NOT NULL,
  customer_id              TEXT NOT NULL,
  current_balance          INTEGER NOT NULL DEFAULT 0,
  lifetime_earned          INTEGER NOT NULL DEFAULT 0,
  current_tier             TEXT NOT NULL DEFAULT 'bronze',   -- enum HANDLER : bronze|silver|gold|... (extensible)
  tier_updated_at          TEXT,
  last_earn_at             TEXT,
  last_redeem_at           TEXT,
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);

-- ── Indexes (listing + lookup + cron expiry) ────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gift_cards_client_code      ON gift_cards(client_id, code);
CREATE INDEX        IF NOT EXISTS idx_gift_cards_status_expires    ON gift_cards(status, expires_at);

CREATE INDEX        IF NOT EXISTS idx_gc_tx_card                   ON gift_card_transactions(gift_card_id);
CREATE INDEX        IF NOT EXISTS idx_gc_tx_order                  ON gift_card_transactions(order_id);
CREATE INDEX        IF NOT EXISTS idx_gc_tx_client_created         ON gift_card_transactions(client_id, created_at);

CREATE INDEX        IF NOT EXISTS idx_loyalty_programs_client      ON loyalty_programs(client_id);

CREATE INDEX        IF NOT EXISTS idx_loyalty_ledger_customer      ON loyalty_ledger(program_id, customer_id);
CREATE INDEX        IF NOT EXISTS idx_loyalty_ledger_expires       ON loyalty_ledger(type, expires_at);
CREATE INDEX        IF NOT EXISTS idx_loyalty_ledger_client_created ON loyalty_ledger(client_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_loyalty_state_prog_cust     ON loyalty_customer_state(program_id, customer_id);
CREATE INDEX        IF NOT EXISTS idx_loyalty_state_client_tier    ON loyalty_customer_state(client_id, current_tier);
