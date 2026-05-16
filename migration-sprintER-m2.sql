-- ── Migration Sprint E-R M2 — Config région par boutique/tenant ─────────────
-- (2026-05-16) Module Boutique B2. Additif / non destructif sur E1 + E-R M1.
--
-- Conventions strictes projet :
--   Timestamps TEXT DEFAULT (datetime('now')) — jamais unixepoch.
--   id TEXT (lower(hex(randomblob(16)))) — pas d'INTEGER autoincrement applicatif.
--   Money en cents INTEGER.
--   Multi-tenant : isolation par client_id (table `clients` = le tenant lui-même).
--
-- Objectif : porter la configuration RÉGION/PAYS/DEVISE/RÉGIME FISCAL au niveau
-- du tenant (table `clients`). Le backend commande (M1) résout le régime fiscal
-- via cette config (resolveRegionContext) au lieu d'un défaut 'qc' codé en dur.
--
-- ⚠️ RÉTRO-COMPAT TOTALE : tous les défauts = Québec (region 'QC', country 'CA',
-- default_currency 'CAD', tax_regime 'qc'). Tout client pré-existant reste donc
-- strictement Québec → régression-zéro données ET comportement.
--
-- ⚠️ `currency` existe DÉJÀ sur orders/products/carts (migration E1, défaut
-- 'CAD'). Ici c'est `default_currency` SUR `clients` = colonne NEUVE (devise
-- par défaut de la boutique du tenant). Aucun double-ALTER.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-sprintER-m2.sql --remote

-- Région logique de la boutique (libre, ex 'QC' / 'EU' / 'DZ'). Pilote le
-- format d'adresse/téléphone + le contexte fiscal. Défaut 'QC' (rétro-compat).
ALTER TABLE clients ADD COLUMN region TEXT DEFAULT 'QC';

-- Pays ISO 3166-1 alpha-2 du tenant (ex 'CA' / 'FR' / 'DZ'). Utilisé par le
-- moteur fiscal M1 (UE : taux selon pays destination) + formats locaux.
ALTER TABLE clients ADD COLUMN country TEXT DEFAULT 'CA';

-- Devise par défaut de la boutique (ex 'CAD' / 'EUR' / 'DZD'). Distincte des
-- colonnes `currency` E1 (orders/products/carts) : ici = défaut tenant.
ALTER TABLE clients ADD COLUMN default_currency TEXT DEFAULT 'CAD';

-- Régime fiscal du tenant, aligné moteur M1 (ecommerce-tax-engine.ts) :
-- 'qc' | 'eu' | 'dz' | 'exempt'. Défaut 'qc' → régression-zéro Québec.
ALTER TABLE clients ADD COLUMN tax_regime TEXT DEFAULT 'qc';

-- Drapeaux légaux régionaux (JSON, ex {"loi25":true,"rgpd":false,"conso_dz":false}).
-- FLAGS UNIQUEMENT : aucune implémentation légale ici (vient Sprint E6).
-- NULL = aucun flag explicite → défauts région appliqués côté code.
ALTER TABLE clients ADD COLUMN legal_flags_json TEXT;
