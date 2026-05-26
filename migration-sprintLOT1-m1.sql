-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 78 — LOT 1 SaaS M1 (2026-05-18)
-- Multi-tenancy agence : clients.agency_id (additif nullable) + table de
-- jonction user_sub_accounts + ré-ajout colonnes users perdues au rebuild seq 59.
--
-- ⚠ RISQUE #0 — RÉ-AJOUT DÉFENSIF DES COLONNES `users`
-- La migration seq 59 (migration-sprintE1-m2-modules-role.sql) RECONSTRUIT la
-- table `users` (CREATE users_e1m2_new → INSERT … FROM users → DROP users →
-- RENAME). Ce rebuild ne reporte QUE les colonnes :
--   id, email, password_hash, name, role, client_id, is_active,
--   created_at, updated_at
-- Conséquence : `users.agency_id` (ajouté en seq 19 / migration_p3_9.sql) est
-- DÉTRUIT par seq 59. `account_level` et `parent_user_id` n'existent pas non
-- plus. CETTE migration les (ré)ajoute.
--
-- TOLÉRANCE « duplicate column name » — exécution best-effort :
-- Si seq 59 a été partiellement réparé manuellement (colonnes déjà présentes
-- sur `users`), les 3 `ALTER TABLE users ADD COLUMN` ci-dessous échoueront
-- avec « duplicate column name: <col> ». C'est ATTENDU et NON FATAL.
-- L'exécuteur (Antigravity) DOIT jouer ce fichier statement-par-statement :
-- une erreur « duplicate column name » sur un ALTER => on log et on CONTINUE
-- au statement suivant. Idem pour `CREATE INDEX IF NOT EXISTS` / `CREATE TABLE
-- IF NOT EXISTS` (déjà idempotents par construction).
-- INTERDIT : tout DROP / rebuild de `users` ou `clients` (perte de données
-- métier garantie). On ne fait QUE de l'additif.
--
-- scripts/migrate.ts est FIGÉ et n'est PAS modifié par cette migration ; la
-- tolérance duplicate-column est une consigne d'exécution, pas du code.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Tenant ⇄ agence : lien nullable additif (0 des ~1078 `WHERE client_id`
--    ne change ; agency_id IS NULL ⇒ comportement legacy byte-identique).
ALTER TABLE clients ADD COLUMN agency_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_agency ON clients(agency_id);

-- 2) Multi-sous-comptes : table de jonction user ⇄ client (sous-compte).
CREATE TABLE IF NOT EXISTS user_sub_accounts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  role TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_usa_user ON user_sub_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_usa_client ON user_sub_accounts(client_id);

-- 3) RISQUE #0 — ré-ajout défensif des colonnes users détruites par seq 59.
--    Peut échouer « duplicate column name » si seq 59 réparé : OK, CONTINUER.
ALTER TABLE users ADD COLUMN agency_id TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN account_level TEXT DEFAULT 'user';
ALTER TABLE users ADD COLUMN parent_user_id TEXT DEFAULT NULL;

-- 4) Back-fill jonction : chaque user mono-tenant existant devient sous-compte
--    de son client_id actuel. INSERT OR IGNORE => rejoue sans casser
--    (UNIQUE(user_id,client_id)). Users sans client_id : ignorés (legacy strict).
INSERT OR IGNORE INTO user_sub_accounts (id, user_id, client_id)
SELECT lower(hex(randomblob(16))), id, client_id
FROM users
WHERE client_id IS NOT NULL AND client_id <> '';
