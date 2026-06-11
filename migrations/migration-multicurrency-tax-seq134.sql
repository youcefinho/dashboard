-- ── Sprint 39 — Multi-currency + Tax engine multi-région (NEUF) — seq134 (2026-05-24)
-- 100% ADDITIF. Zéro DROP. Zéro RENAME. Zéro CHECK. Zéro FK destructrice.
-- ENRICHIT le module ecommerce B2 (seq58 = migration-sprintE1-m1-ecommerce-schema.sql)
-- + la couche RÉGION existante (seq sprintER-m1/m2 = orders.tax_region/tax_breakdown_json
-- + clients.region/country/default_currency/tax_regime/legal_flags_json) avec :
--
--   (1) un cache devises (`currency_rates`) alimenté par fetch ECB/Frankfurter
--       + override manuel admin (rate REAL, source 'ecb'|'frankfurter'|'manual'),
--   (2) un référentiel admin-managed RÉGIONS FISCALES par tenant (`tax_regions`)
--       avec type ∈ {vat|gst_pst|sales_tax|tva_dz|exempt} et rates_json,
--   (3) un référentiel RÈGLES PAR CATÉGORIE PRODUIT (`tax_rules`) par région
--       (ex 'standard', 'food', 'digital' — taux distinct par catégorie).
--
-- ⚠️ RÉGRESSION-ZÉRO QC/EU/DZ : la logique fiscale historique
-- (`src/worker/ecommerce-tax-engine.ts` — régimes 'qc'/'eu'/'dz'/'exempt')
-- N'EST PAS TOUCHÉE. Le nouveau régime `us_sales_tax` + l'overlay régional
-- admin-managed sont DÉLÉGUÉS par `tax-engine-multi.ts` qui APPELLE
-- computeTax() legacy quand opts.region n'est pas fournie. Pour tout
-- subtotalCents en régime 'qc', la sortie reste IDENTIQUE bit-pour-bit
-- à l'ancien code (verbatim TPS 0.05 + TVQ 0.09975 — calque E3).
--
-- depends_on : seq133 (gift cards + loyalty — chaînage strict du manifest)
--              + sprintER-m1 (orders.tax_region/tax_breakdown_json).
-- Voir docs/LOT-MULTICURRENCY-TAX-S39.md §6 pour contrat figé inter-agent Phase B.
--
-- Périmètre v1 :
--   - CREATE currency_rates              : cache taux change base→quote, source, fetched_at.
--   - CREATE tax_regions                 : régions fiscales admin-managed par tenant.
--   - CREATE tax_rules                   : règles taux par catégorie produit par région.
--   - ALTER  products.tax_category       : catégorie fiscale du produit (DEFAULT 'standard').
--   - ALTER  orders.currency_rate_used   : taux change appliqué à la commande (audit).
--   - ALTER  orders.currency_base        : montant total dans la devise base du tenant (audit).
--   - 6 indexes : listing tenant, lookup paire/catégorie, cron rafraîchissement.
--
-- Validation enums (`type` régions, `source` rates, currencies ∈ CAD|USD|EUR|DZD|MAD)
-- faite SIDE-HANDLER (`currencies.ts` / `tax-regions.ts` + libs `currency-converter.ts`
-- / `tax-engine-multi.ts`) — calque LOT-GIFTCARDS-LOYALTY-S38 §6 (pas de CHECK =
-- pas de rebuild SQLite jamais).
--
-- AUCUNE FK destructrice (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit).
-- tax_rules.region_id ⟶ tax_regions.id ON DELETE CASCADE est documentée en
-- commentaire SQL ; la cascade est APPLICATIVE côté handler delete (calque
-- coupons + loyalty_ledger seq133).
-- Money TOUJOURS en cents (INTEGER). Taux REAL (rates 0.0..1.0 pour taxes,
-- positive REAL >0 pour currency rates).
--
-- Conventions schema.sql (vérifiées sur migration-giftcards-loyalty-seq133.sql) :
--   id TEXT PK lower(hex(randomblob(16))), timestamps TEXT DEFAULT (datetime('now')).
--   PAS d'unixepoch, PAS d'INTEGER autoincrement, PAS de FK.
--
-- Bornage tenant : `client_id` (tenant propriétaire — calque gift_cards.client_id
-- seq133 / orders.client_id seq58). Les handlers (Phase A stubs → Phase B corps)
-- bornent systématiquement `WHERE client_id = ?` (calque ecommerce-orders.ts:76 /
-- gift-cards.ts).
--
-- Idempotence currency_rates : (base_currency|quote_currency|source) côté cron
-- fetch — l'index (base, quote, fetched_at) ordonne par fraîcheur (DESC) sans
-- unicité forcée (legacy/manual entries peuvent coexister).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-multicurrency-tax-seq134.sql --remote

-- ── currency_rates : cache taux de change base→quote ────────────────────────
CREATE TABLE IF NOT EXISTS currency_rates (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  base_currency            TEXT NOT NULL,                    -- ex 'CAD' (devise pivot tenant)
  quote_currency           TEXT NOT NULL,                    -- ex 'USD' (devise cible commande)
  rate                     REAL NOT NULL DEFAULT 1,          -- 1 base = rate quote (positive >0)
  source                   TEXT NOT NULL DEFAULT 'ecb',      -- enum HANDLER : ecb|frankfurter|manual
  fetched_at               TEXT DEFAULT (datetime('now')),   -- timestamp de fraîcheur du taux
  created_at               TEXT DEFAULT (datetime('now'))
);

-- ── tax_regions : régions fiscales admin-managed par tenant ─────────────────
CREATE TABLE IF NOT EXISTS tax_regions (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id                TEXT NOT NULL,                    -- tenant propriétaire (bornage strict)
  code                     TEXT NOT NULL,                    -- ex 'QC-CA', 'NY-US', 'FR-EU'
  name                     TEXT NOT NULL DEFAULT '',         -- libellé affiché ('Québec', 'New York')
  country                  TEXT NOT NULL,                    -- ISO 3166-1 alpha-2 ('CA', 'US', 'FR')
  country_subdiv           TEXT,                             -- ISO 3166-2 subdivision ('QC', 'NY')
  type                     TEXT NOT NULL DEFAULT 'exempt',   -- enum HANDLER : vat|gst_pst|sales_tax|tva_dz|exempt
  rates_json               TEXT NOT NULL DEFAULT '{}',       -- JSON {tps:0.05, tvq:0.09975, state:0.04, county:0.045}
  tax_inclusive            INTEGER DEFAULT 0,                -- 0=HT (US/CA), 1=TTC (UE)
  active                   INTEGER DEFAULT 1,                -- soft-delete
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);

-- ── tax_rules : règles de taux par catégorie produit par région ─────────────
-- region_id ⟶ tax_regions.id ON DELETE CASCADE (APPLICATIVE côté handler).
CREATE TABLE IF NOT EXISTS tax_rules (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  region_id                TEXT NOT NULL,                    -- FK applicative vers tax_regions.id
  product_category         TEXT NOT NULL DEFAULT 'standard', -- ex 'standard', 'food', 'digital', 'apparel'
  rate                     REAL NOT NULL DEFAULT 0,          -- taux taxe pour cette catégorie (0.0..1.0)
  compound                 INTEGER DEFAULT 0,                -- 1 = taxe en cascade (rare : QC pré-2013)
  applies_from             TEXT DEFAULT (datetime('now')),   -- date d'effet de la règle
  created_at               TEXT DEFAULT (datetime('now'))
);

-- ── ALTERs additifs (zéro CHECK, zéro DEFAULT non-constant) ─────────────────
-- products : catégorie fiscale du produit (pour lookup tax_rules.product_category).
-- DEFAULT 'standard' garantit régression-zéro (tout produit pré-existant = standard).
ALTER TABLE products ADD COLUMN tax_category TEXT DEFAULT 'standard';

-- orders : audit du taux change appliqué à la commande (multi-currency).
-- NULL = commande mono-devise (legacy CAD) — fallback défensif côté ecommerce-invoice.ts.
ALTER TABLE orders ADD COLUMN currency_rate_used REAL;

-- orders : montant total dans la devise BASE du tenant (audit cross-currency).
-- NULL = commande mono-devise (legacy) — fallback total_cents direct.
ALTER TABLE orders ADD COLUMN currency_base REAL;

-- ── Indexes (listing + lookup paire/catégorie + cron rafraîchissement) ──────
CREATE INDEX        IF NOT EXISTS idx_currency_rates_pair         ON currency_rates(base_currency, quote_currency, fetched_at);
CREATE INDEX        IF NOT EXISTS idx_currency_rates_fetched      ON currency_rates(fetched_at);

CREATE INDEX        IF NOT EXISTS idx_tax_regions_client          ON tax_regions(client_id);
CREATE INDEX        IF NOT EXISTS idx_tax_regions_code            ON tax_regions(client_id, code);

CREATE INDEX        IF NOT EXISTS idx_tax_rules_region            ON tax_rules(region_id);
CREATE INDEX        IF NOT EXISTS idx_tax_rules_category          ON tax_rules(region_id, product_category);
