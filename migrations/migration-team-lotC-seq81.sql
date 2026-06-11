-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 81 — LOT TEAM C (2026-05-19)
-- Branding white-label par sous-compte (table `clients` = le tenant).
--
-- depends_on : migration-sprintLOT1-m1.sql (seq 78 — clients.agency_id : la
--              gestion CRUD/branding/soft-delete des sous-comptes s'opère sur
--              `clients`, périmètre borné par agency_id / accessibleClientIds).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / rebuild de `clients`
--   (perte des ~1078 références client_id). ALTER ADD COLUMN UNIQUEMENT.
--
-- AUDIT COLONNES `clients` SUR DISQUE (grep migrations 1→79, schema.sql) :
--   schema.sql:19-32 → id,name,email,phone,site_url,city,banner,
--     is_active(INTEGER DEFAULT 1 — DÉJÀ PRÉSENT),amf_certificate,
--     amf_disclaimer_required,created_at,updated_at
--   + ALTERs : business_type/brand_voice/scoring_prompt_extra/mapbox_token
--     (seq 35), modules_json (seq 59), region/country/default_currency/
--     tax_regime/legal_flags_json (seq 72), agency_id (seq 78).
--   ⇒ `clients.is_active` EXISTE DÉJÀ (schema.sql:27) : on NE LE RÉAJOUTE PAS.
--     Le soft-delete sous-compte (LOT C) réutilise CETTE colonne (UPDATE
--     clients SET is_active = 0). Aucune colonne is_active ici.
--   ⇒ branding/logo_url/primary_color/accent_color ABSENTS de `clients`
--     (logo_url/primary_color existent sur `agencies` & `webchat_widgets`,
--     PAS sur `clients`). seq 81 = SEULES ces 4 colonnes neuves.
--
-- TOLÉRANCE « duplicate column name » — best-effort : si seq 81 est rejouée
--   (ou ces colonnes pré-existent), les ALTER échouent « duplicate column
--   name: <col> » : ATTENDU et NON FATAL. L'exécuteur (Antigravity) joue
--   statement-par-statement, log + continue. scripts/migrate.ts FIGÉ.
--
-- Conventions schema.sql : TEXT, défauts régression-zéro ('').
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-team-lotC-seq81.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- Branding white-label JSON libre (ex {"font":"Inter","favicon":"..."}).
-- NULL/'' = aucun branding custom → défauts produit appliqués côté front.
ALTER TABLE clients ADD COLUMN branding TEXT DEFAULT '';

-- URL du logo du sous-compte (white-label). '' = logo produit par défaut.
ALTER TABLE clients ADD COLUMN logo_url TEXT DEFAULT '';

-- Couleur primaire de marque du sous-compte (hex, ex '#0891b2').
-- '' = palette produit par défaut.
ALTER TABLE clients ADD COLUMN primary_color TEXT DEFAULT '';

-- Couleur d'accent de marque du sous-compte (hex). '' = défaut produit.
ALTER TABLE clients ADD COLUMN accent_color TEXT DEFAULT '';

-- NB : PAS d'ALTER is_active — la colonne EXISTE déjà (schema.sql:27,
-- DEFAULT 1). Le soft-delete LOT C fait UPDATE clients SET is_active = 0
-- (handler handleDeleteClient, Phase B Manager-C).
