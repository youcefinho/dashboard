-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 85 — LOT E-COMMERCE B2 ENRICHI : COUPONS/PROMOS + ABONNEMENTS
-- PRODUIT (Sprint 4, 2026-05-19)
-- Enrichit l'e-commerce B2 (déjà profond ~21k LOC) avec :
--   - Coupons/promos : enrichissement ADDITIF de la table `coupons` (vestige
--     CRM seq 18, non câblée e-commerce) — type de remise, plancher mini,
--     fenêtre de validité, limite d'usage, activation, devise, scope agence.
--   - Abonnements produit : table NEUVE `product_subscriptions`. Cycle = à
--     l'échéance appelle createOrderCore (commande COD/mock). AUCUN
--     prélèvement réel. ZÉRO touch tables paiement E4/E6 régulées.
--
-- depends_on : migration-booking-seq84.sql (seq 84 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 84).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une CONTRAINTE existante.
--   Ce lot N'AJOUTE QUE :
--     - des `ALTER TABLE coupons ADD COLUMN` — additif pur (toutes colonnes
--       nullable / DEFAULT). Les colonnes LEGACY `discount_amount` /
--       `discount_percent` (seq 18, migration_p3_8.sql:20-21) sont
--       INTÉGRALEMENT CONSERVÉES. La table `coupons` EXISTE DÉJÀ (seq 18) —
--       elle N'EST PAS recréée.
--     - un `CREATE TABLE/INDEX IF NOT EXISTS` (product_subscriptions) — neuf,
--       idempotent.
--   Le CHECK role users seq 59 (rebuild:users) est INTOUCHÉ. AUCUN touch
--   `users`. AUCUN touch tables E4/E6 régulées (`payments`, `payment_events`,
--   `payment_provider_config`, `refunds`, `disputes`, `return_requests`).
--   AUCUNE colonne paiement dans `product_subscriptions` (modèle COD/mock —
--   le cycle appelle createOrderCore, jamais de settlement / FX / lecture
--   `payments_live_enabled` — voir docs/LOT-ECOM4.md §6.E).
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures coupon↔client / subscription↔variant / subscription↔customer
--   sont APPLICATIVES, par colonne TEXT). `status` de product_subscriptions
--   est SANS CHECK (figé au contrat ; l'énumération est gardée applicativement
--   par le handler — pas de rebuild possible si l'énum évolue Phase B/C).
--
-- TOLÉRANCE « duplicate column / table exists » — exécution best-effort :
--   si seq 85 est rejouée, `ADD COLUMN` peut échouer (« duplicate column
--   name ») et `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas
--   d'erreur). L'erreur éventuelle d'un `ADD COLUMN` rejoué est ATTENDUE et
--   NON FATALE : l'exécuteur (Antigravity) joue ce fichier statement-par-
--   statement, log + CONTINUE au statement suivant. scripts/migrate.ts est
--   FIGÉ et N'EST PAS modifié ; la tolérance est une consigne d'exécution.
--
-- Conventions schema.sql (vérifiées sur migration-booking-seq84.sql) :
--   id TEXT PK lower(hex(randomblob(16))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch, PAS d'INTEGER autoincrement,
--   PAS de FK. Money TOUJOURS en cents (INTEGER).
--
-- Bornage tenant : `client_id` (tenant propriétaire — calque
--   coupons.client_id seq 18 / orders.client_id seq 58) + `agency_id` (scope
--   agence — calque funnels.agency_id seq 83 / booking_pages.agency_id
--   seq 84). Les handlers (Phase A stubs → Phase B/C corps) bornent
--   systématiquement `WHERE client_id = ?` (calque ecommerce-orders.ts:76).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-promo-seq85.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) coupons — enrichissement ADDITIF (table seq 18 INTOUCHÉE pour
--    l'existant : id/client_id/code/discount_amount/discount_percent/
--    created_at conservées telles quelles). discount_type = 'percent' (utilise
--    discount_percent) | 'fixed' (montant en cents via min_order_cents-style ;
--    la résolution code→montant Phase B lit ces colonnes). min_order_cents =
--    plancher panier (cents). starts_at/expires_at = fenêtre de validité
--    (TEXT datetime, NULL = pas de borne). usage_limit = quota global d'usage
--    (NULL = illimité). times_used = compteur d'usage (incrémenté Phase B).
--    is_active = activation (1 par défaut = rétro-compat : tout coupon legacy
--    reste actif). currency = devise du coupon fixe (NULL = devise tenant,
--    stockage SANS conversion — voir §6.F). agency_id = scope agence.
ALTER TABLE coupons ADD COLUMN discount_type TEXT DEFAULT 'percent';
ALTER TABLE coupons ADD COLUMN min_order_cents INTEGER DEFAULT 0;
ALTER TABLE coupons ADD COLUMN starts_at TEXT;
ALTER TABLE coupons ADD COLUMN expires_at TEXT;
ALTER TABLE coupons ADD COLUMN usage_limit INTEGER;
ALTER TABLE coupons ADD COLUMN times_used INTEGER DEFAULT 0;
ALTER TABLE coupons ADD COLUMN is_active INTEGER DEFAULT 1;
ALTER TABLE coupons ADD COLUMN currency TEXT;
ALTER TABLE coupons ADD COLUMN agency_id TEXT;
CREATE INDEX IF NOT EXISTS idx_coupons_client_code ON coupons(client_id, code);

-- 2) product_subscriptions — table NEUVE. Un abonnement = une variante
--    commandée à intervalle régulier. À l'échéance (next_run_at <= now), le
--    cycle (Phase C) appelle createOrderCore (commande COD/mock, source
--    'subscription') — AUCUN prélèvement réel, AUCUNE lecture
--    `payments_live_enabled`, AUCUN touch tables E4/E6. unit_price_cents =
--    snapshot prix à la souscription (cents). currency = devise (CAD défaut,
--    stockage SANS FX — jamais sommé multi-devise). status SANS CHECK
--    (énum 'active'/'paused'/'cancelled' gardée applicativement Phase C).
--    cycles_completed = nb de commandes générées. Bornage client_id +
--    agency_id (calque funnels seq 83 / booking_event_types seq 84).
CREATE TABLE IF NOT EXISTS product_subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  customer_id TEXT,
  variant_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  interval_unit TEXT NOT NULL DEFAULT 'month',
  interval_count INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CAD',
  status TEXT NOT NULL DEFAULT 'active',   -- SANS CHECK — énum gardée applicativement (§6.E)
  next_run_at TEXT,
  last_run_at TEXT,
  cycles_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_product_subscriptions_client ON product_subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_product_subscriptions_due ON product_subscriptions(status, next_run_at);

-- NB : colonnes LEGACY coupons (discount_amount / discount_percent seq 18)
-- CONSERVÉES. AUCUNE colonne ajoutée à `users` / `clients` / tables E4/E6
-- régulées. AUCUN CHECK existant modifié (role users seq 59 INTOUCHÉ).
-- AUCUNE FK. AUCUN DROP / RENAME / rebuild. Le cycle abonnement (Phase C)
-- RÉUTILISE createOrderCore (signature INCHANGÉE) en mode COD/mock — AUCUN
-- paiement réel n'est activé par ce lot. Choix figé docs/LOT-ECOM4.md §6.E.
