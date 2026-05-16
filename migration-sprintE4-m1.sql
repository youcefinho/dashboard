-- ── Sprint E4 M1 — Paiement multi-provider/région (2026-05-16) ──────────────
--
-- 3 tables du pont paiement marchand e-commerce (B2). DISTINCT de billing.ts
-- (abo SaaS Intralys) — ne JAMAIS confondre / fusionner.
--
-- ⚠️ ZONE RÉGULÉE — revue Rochdi requise (frontière paiement).
-- PCI : ZÉRO colonne carte (PAN/CVV/expiry/track). Tokenisation 100 % côté
-- provider. Seules des RÉFÉRENCES opaques (provider_ref, connect_account_ref)
-- transitent ici — jamais de donnée carte dans nos Workers / notre D1.
--
-- Conventions strictes projet :
--   - id TEXT DEFAULT (lower(hex(randomblob(16)))) — PAS d'unixepoch.
--   - timestamps TEXT DEFAULT (datetime('now')).
--   - Money en cents INTEGER.
--   - Multi-tenant : client_id sur toute table requête tenant.
--   - Additif / non destructif : AUCUN ALTER sur `orders` (statut/financial
--     pilotés par le lifecycle E3 — recordPaymentTransition est le seul pont).
--   - ZÉRO double-ALTER : aucune colonne existante ré-ajoutée.

-- ── payments — une intention/transaction de paiement par (order, méthode) ────
-- idempotency_key déterministe (order_id+method+amount) → UNIQUE(client_id,
-- idempotency_key) = garde anti double-charge à l'init.
CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id       TEXT NOT NULL,
  order_id        TEXT NOT NULL,
  provider        TEXT NOT NULL,            -- 'stripe' | 'cod' | 'dz_gateway'
  method          TEXT NOT NULL,            -- méthode de paiement choisie
  amount_cents    INTEGER NOT NULL,
  currency        TEXT NOT NULL,            -- 'CAD' | 'EUR' | 'DZD'
  status          TEXT NOT NULL DEFAULT 'pending', -- PaymentStatus (contrat figé)
  provider_ref    TEXT,                     -- référence opaque provider (PAS de carte)
  idempotency_key TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE (client_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (client_id, order_id);
CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments (provider, provider_ref);

-- ── payment_events — journal webhook brut + anti-rejeu ───────────────────────
-- UNIQUE(provider, provider_event_id) = dédup stricte : un rejeu de webhook
-- (même event provider) ne peut pas re-déclencher le pont lifecycle.
CREATE TABLE IF NOT EXISTS payment_events (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  payment_id        TEXT,                   -- nullable : event reçu avant résolution
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,          -- id de l'événement chez le provider
  type              TEXT,                   -- type d'event (informatif)
  payload_json      TEXT,                   -- payload brut (AUCUNE donnée carte)
  created_at        TEXT DEFAULT (datetime('now')),
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events (payment_id);

-- ── payment_provider_config — config provider par tenant ─────────────────────
-- ⚠️ ZONE RÉGULÉE : payments_live_enabled défaut 0 (sandbox/test) — le code
-- reste inoffensif tant que non activé (revue Rochdi avant passage live).
-- Réf/clé EXTERNE uniquement (connect_account_ref) — JAMAIS de PAN ni de
-- secret en clair ici (clés sensibles = bindings Wrangler, cf. Env).
CREATE TABLE IF NOT EXISTS payment_provider_config (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id             TEXT NOT NULL,
  provider              TEXT NOT NULL,           -- 'stripe' | 'cod' | 'dz_gateway'
  mode                  TEXT DEFAULT 'test',     -- 'test' | 'live'
  payments_live_enabled INTEGER DEFAULT 0,       -- 0 = sandbox (défaut sûr)
  connect_account_ref   TEXT,                    -- référence compte externe (opaque)
  config_json           TEXT,                    -- config NON sensible (libellés, options)
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now')),
  UNIQUE (client_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_payment_provider_config_client
  ON payment_provider_config (client_id);
