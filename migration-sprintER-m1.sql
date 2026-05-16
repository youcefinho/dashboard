-- ── Migration Sprint E-R M1 — Internationalisation fiscale commerce ──────────
-- (2026-05-16) Module Boutique B2. Additif / non destructif sur E1+E3.
--
-- Conventions strictes projet :
--   Timestamps TEXT DEFAULT (datetime('now')) — jamais unixepoch.
--   id TEXT (lower(hex(randomblob(16)))) — pas d'INTEGER autoincrement applicatif.
--   Money en cents INTEGER.
--   Multi-tenant : isolation par client_id (déjà portée par orders/order_items).
--
-- Objectif : permettre une fiscalité multi-régime (QC/UE/DZ/exempt) sans
-- toucher au comportement Québec existant.
--   - orders.tax_region        : régime fiscal figé de la commande (défaut 'QC'
--                                 → rétro-compat données E3 où la colonne est
--                                 absente : le code lit 'QC' par défaut).
--   - orders.tax_breakdown_json: ventilation multi-lignes (toutes les taxes).
--   - order_items.tax_breakdown_json : ventilation par ligne (UE multi-taux).
--
-- ⚠️ orders.currency / carts.currency / products.currency existent DÉJÀ
-- (migration-sprintE1-m1-ecommerce-schema.sql, défaut 'CAD') — PAS ré-ajoutés
-- ici (double-ALTER interdit).

-- Régime fiscal de la commande (figé à la création). Défaut 'QC' :
-- toute commande E3 antérieure (colonne absente) est traitée Québec → la
-- régression-zéro QC est garantie au niveau données comme au niveau code.
ALTER TABLE orders ADD COLUMN tax_region TEXT DEFAULT 'QC';

-- Ventilation fiscale complète de la commande (JSON : [{label,rate,amountCents}]).
-- Permet l'affichage facture multi-lignes (UE) sans recalcul. NULL = legacy E3
-- (fallback défensif sur tps_cents/tvq_cents côté ecommerce-invoice.ts).
ALTER TABLE orders ADD COLUMN tax_breakdown_json TEXT;

-- Ventilation fiscale par ligne de commande (réservé UE multi-taux / OSS-IOSS).
-- NULL = legacy ou régime mono-taux (tax_cents agrégé suffit).
ALTER TABLE order_items ADD COLUMN tax_breakdown_json TEXT;
