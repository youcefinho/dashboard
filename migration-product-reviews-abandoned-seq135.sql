-- ── Sprint 40 — Product Reviews + Abandoned Carts Recovery (NEUF) — seq135 (2026-05-24)
-- 100% ADDITIF. Zéro DROP. Zéro RENAME. Zéro CHECK. Zéro FK destructrice.
-- DERNIER sprint LOT 4. Cohabite SANS toucher :
--   - `src/worker/reviews.ts` (Sprint 9 — review_requests + reviews_cache Google/FB,
--     INVITATIONS d'avis = flux 1st-party SÉPARÉ. Sprint 40 cible AVIS PRODUITS).
--   - `src/worker/ecommerce-cart-recovery.ts` (Sprint E7 — single-touch
--     detectAbandonedCarts + handleRecoverCart. Sprint 40 ÉTEND via ALTER carts
--     multi-touch sequence 1h/24h/72h — colonnes additives, no-op pour code legacy).
--
-- depends_on : seq134 (migration-multicurrency-tax-seq134.sql, chaînage strict)
--              + sprintE1-m1 (carts/products/customers schema base).
-- Voir docs/LOT-REVIEWS-ABANDONED-S40.md §6 pour contrat figé inter-agent Phase B.
--
-- Périmètre v1 :
--   - CREATE product_reviews                : avis produit client (PUBLIC submit + moderation).
--   - CREATE product_review_helpful_votes   : ledger anti-rejeu votes utiles (IP-hash).
--   - ALTER  products.reviews_count + avg_rating + reviews_last_updated_at
--                                            : dénormalisation listing storefront.
--   - ALTER  customers.reviews_count + avg_rating_given
--                                            : profil reviewer pour bordereau client.
--   - ALTER  carts.recovery_email_sent_count + last_recovery_at + recovery_attempts_json
--                                            + recovery_discount_code + recovery_completed_at
--                                            : sequence multi-touch additif (compatible E7).
--   - 6 indexes : listing tenant, lookup par product/status/customer, anti-rejeu helpful,
--                 cron scan sequence carts.
--
-- Validation enums (`status` ∈ pending|approved|rejected|flagged, `rating` ∈ [1..5])
-- faite SIDE-HANDLER (`product-reviews.ts` + `lib/review-moderation.ts`) — calque
-- LOT-GIFTCARDS-LOYALTY-S38 §6 + LOT-MULTICURRENCY-TAX-S39 §6 (pas de CHECK =
-- pas de rebuild SQLite jamais).
--
-- AUCUNE FK destructrice (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit).
-- product_reviews.product_id REFERENCES products(id) est documentée en
-- commentaire SQL — pas de FK posée. Les jointures sont APPLICATIVES.
-- SEULE EXCEPTION : `product_review_helpful_votes.review_id` peut porter une
-- FK ON DELETE CASCADE car la table EST CRÉÉE ICI (création initiale =
-- pas de rebuild — SQLite n'a besoin de rebuild QUE sur ALTER d'une table
-- existante). Cascade applicative posée en redondance dans handleDeleteReview
-- (calque coupons + loyalty_ledger seq133).
-- Money TOUJOURS en cents (INTEGER). Rating INTEGER 1..5 (validation HANDLER).
--
-- Conventions schema.sql (vérifiées sur migration-multicurrency-tax-seq134.sql) :
--   id TEXT PK lower(hex(randomblob(16))), timestamps TEXT DEFAULT (datetime('now')).
--   PAS d'unixepoch, PAS d'INTEGER autoincrement, PAS de FK sauf création initiale.
--
-- Bornage tenant : `client_id` (tenant propriétaire — calque gift_cards.client_id
-- seq133 / orders.client_id seq58). Les handlers (Phase A stubs → Phase B corps)
-- bornent systématiquement `WHERE client_id = ?` (calque ecommerce-orders.ts:76 /
-- gift-cards.ts).
--
-- Idempotence helpful_votes : UNIQUE (review_id, voter_ip_hash) anti-rejeu STRICT.
-- Submit anonyme : rate-limit + honeypot website_url (HANDLER) — pas de table
-- dédiée (réutilise `rate_limit_buckets` seq121).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-product-reviews-abandoned-seq135.sql --remote

-- ── product_reviews : avis produit client (PUBLIC submit + moderation admin) ──
CREATE TABLE IF NOT EXISTS product_reviews (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id                TEXT NOT NULL,                    -- tenant propriétaire (bornage strict)
  product_id               TEXT NOT NULL,                    -- FK applicative vers products.id
  customer_id              TEXT,                             -- FK applicative vers customers.id (NULL = anonyme)
  order_id                 TEXT,                             -- FK applicative vers orders.id (NULL = pas vérifié)
  rating                   INTEGER NOT NULL DEFAULT 5,       -- 1..5 (validation HANDLER)
  title                    TEXT DEFAULT '',                  -- titre court de l'avis
  body                     TEXT DEFAULT '',                  -- corps libre (sanitizeInput côté handler)
  photos_json              TEXT,                             -- JSON array URLs photos uploadées (NULL = none)
  verified_buyer           INTEGER DEFAULT 0,                -- 1 = order_id matché → "Achat vérifié"
  status                   TEXT NOT NULL DEFAULT 'pending',  -- enum HANDLER : pending|approved|rejected|flagged
  moderation_notes         TEXT,                             -- raison rejection / flag (admin)
  moderator_id             TEXT,                             -- FK applicative vers users.id (admin qui a modéré)
  moderated_at             TEXT,                             -- timestamp de la décision admin
  helpful_count            INTEGER DEFAULT 0,                -- dénormalisé depuis product_review_helpful_votes
  spam_score               INTEGER DEFAULT 0,                -- 0..100 (heuristique HANDLER : badwords, links, ratelimit)
  submitter_ip             TEXT,                             -- IP du submitter (anti-fraude, purgée >90j Loi 25)
  submitter_locale         TEXT,                             -- locale auto-détectée (fr-CA|fr-FR|en|es)
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);

-- ── product_review_helpful_votes : ledger anti-rejeu votes utiles ──────────────
-- voter_ip_hash = SHA-256 hex de l'IP du voter (Loi 25 : pas d'IP brute).
-- review_id FK + CASCADE = OK car table CRÉÉE ICI (pas de rebuild SQLite).
CREATE TABLE IF NOT EXISTS product_review_helpful_votes (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  review_id                TEXT NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  voter_ip_hash            TEXT NOT NULL,                    -- SHA-256 hex (anonymisation Loi 25)
  created_at               TEXT DEFAULT (datetime('now'))
);

-- ── ALTERs additifs (zéro CHECK, zéro DEFAULT non-constant) ─────────────────

-- products : dénormalisation listing storefront (évite COUNT/AVG runtime).
-- DEFAULTs garantissent régression-zéro (produits pré-existants = 0 reviews / 0 avg).
ALTER TABLE products ADD COLUMN reviews_count INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN avg_rating REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN reviews_last_updated_at TEXT;

-- customers : profil reviewer (bordereau client / segmentation reviewers actifs).
ALTER TABLE customers ADD COLUMN reviews_count INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN avg_rating_given REAL DEFAULT 0;

-- carts : sequence multi-touch additif (E7 mono-touch reste fonctionnel).
-- recovery_email_sent_count starts at 0 (compatible legacy : recovered_at non
-- modifié, fallback côté detectAbandonedCarts/handleRecoverCart inchangé).
ALTER TABLE carts ADD COLUMN recovery_email_sent_count INTEGER DEFAULT 0;
ALTER TABLE carts ADD COLUMN last_recovery_at TEXT;
ALTER TABLE carts ADD COLUMN recovery_attempts_json TEXT;
ALTER TABLE carts ADD COLUMN recovery_discount_code TEXT;
ALTER TABLE carts ADD COLUMN recovery_completed_at TEXT;

-- ── Indexes (listing tenant + lookup product/status/customer + anti-rejeu + cron) ──
CREATE INDEX        IF NOT EXISTS idx_product_reviews_client    ON product_reviews(client_id);
CREATE INDEX        IF NOT EXISTS idx_product_reviews_product   ON product_reviews(product_id);
CREATE INDEX        IF NOT EXISTS idx_product_reviews_status    ON product_reviews(status);
CREATE INDEX        IF NOT EXISTS idx_product_reviews_customer  ON product_reviews(customer_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_review_helpful   ON product_review_helpful_votes(review_id, voter_ip_hash);

CREATE INDEX        IF NOT EXISTS idx_carts_recovery_state      ON carts(client_id, status, last_recovery_at);
