-- Sprint E1 M2 — Feature-flag modules + rôle store_manager (2026-05-16) — module B2
-- Périmètre M2 STRICT : ALTER clients (modules_json) + extension rôle store_manager.
-- NE touche PAS au schéma e-commerce (M1, déjà livré).
-- Conventions alignées sur schema.sql : timestamps TEXT DEFAULT (datetime('now')),
-- id TEXT PK lower(hex(randomblob(16))). PAS d'unixepoch, PAS d'INTEGER autoincrement.
-- Exécution manuelle : npx wrangler d1 execute intralys-crm --file=migration-sprintE1-m2-modules-role.sql --remote

-- ════════════════════════════════════════════════════════════
-- M2.1 — FEATURE-FLAG MODULES PAR TENANT
-- ════════════════════════════════════════════════════════════
-- modules_json : liste JSON des modules activés pour ce client/tenant.
-- Défaut '["crm"]' → tous les clients existants gardent EXACTEMENT le comportement
-- actuel (CRM pur), e-commerce OFF par défaut, zéro régression.
-- "crm" est toujours présent (non désactivable côté API). "ecommerce" optionnel.
ALTER TABLE clients ADD COLUMN modules_json TEXT DEFAULT '["crm"]';

-- ════════════════════════════════════════════════════════════
-- M2.3 — RÔLE store_manager (Gérant de boutique)
-- ════════════════════════════════════════════════════════════
-- schema.sql ligne 11 : `role TEXT CHECK (role IN ('admin', 'broker')) DEFAULT 'broker'`
-- → CHECK STRICT réel sur users.role. SQLite ne permet PAS d'ALTER une contrainte
-- CHECK en place (pas de ALTER TABLE ... DROP/ADD CONSTRAINT). Stratégie projet :
-- recréer la table `users` avec le CHECK élargi, en préservant 100% des données
-- et le schéma de colonnes existant (cf. schema.sql lignes 6-16).
--
-- IMPORTANT : ce bloc est idempotent-safe à exécuter UNE fois sur la prod.
-- Les users existants 'admin'/'broker' sont préservés tels quels. Aucun user
-- 'store_manager' n'est créé ici (création via l'UI Équipe ultérieurement).
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS users_e1m2_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin', 'broker', 'store_manager')) DEFAULT 'broker',
  client_id TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO users_e1m2_new (id, email, password_hash, name, role, client_id, is_active, created_at, updated_at)
SELECT id, email, password_hash, name, role, client_id, is_active, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_e1m2_new RENAME TO users;

PRAGMA foreign_keys=ON;
