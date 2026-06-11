-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 79 — LOT TEAM A (2026-05-18)
-- Cycle d'invitation Team + colonne additive role_generic (rôles PME).
--
-- depends_on : migration-sprintLOT1-m1.sql (seq 78 — clients.agency_id,
--              user_sub_accounts, users.agency_id/account_level).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / rebuild de `users`
--   (CHECK role seq 59 = role IN ('admin','broker','store_manager') ;
--   on n'insère JAMAIS un rôle générique dans users.role — voir mapping
--   handleAcceptInvitation : owner→admin / manager→broker /
--   member|viewer→store_manager). Le rôle générique vit dans la colonne
--   ADDITIVE `role_generic`, jamais dans `users.role`.
--
-- TOLÉRANCE « duplicate column name » — exécution best-effort :
--   `users.last_login_at` existe DÉJÀ (auth.ts:115 fait
--   UPDATE users SET last_login_at). L'ALTER ci-dessous ÉCHOUERA donc avec
--   « duplicate column name: last_login_at » sur une base à jour : c'est
--   ATTENDU et NON FATAL. Idem `role_generic` si seq 79 est rejouée.
--   L'exécuteur (Antigravity) DOIT jouer ce fichier statement-par-statement :
--   une erreur « duplicate column name » sur un ALTER => on log et on CONTINUE
--   au statement suivant. `CREATE TABLE/INDEX IF NOT EXISTS` sont idempotents.
--   scripts/migrate.ts est FIGÉ et n'est PAS modifié ; la tolérance
--   duplicate-column est une consigne d'exécution, pas du code.
--
-- Conventions schema.sql : id TEXT PK lower(hex(randomblob(16))),
--   timestamps TEXT DEFAULT (datetime('now')). PAS d'unixepoch, PAS
--   d'INTEGER autoincrement.
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-team-lotA-seq79.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Table des invitations d'équipe (cycle create → accept / revoke / resend).
--    scope 'agency'      : le membre accède à TOUS les sous-comptes de l'agence.
--    scope 'subaccount'  : le membre accède au seul client_id ciblé.
--    token_hash : SHA-256 hex du token clair (le token CLAIR n'est JAMAIS
--                 persisté ; il ne circule QUE dans le lien d'email).
CREATE TABLE IF NOT EXISTS user_invitations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT NOT NULL,
  agency_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'agency' CHECK (scope IN ('agency', 'subaccount')),
  client_id TEXT DEFAULT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by TEXT DEFAULT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_invitations_agency ON user_invitations(agency_id);
CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON user_invitations(email);

-- 2) Colonne additive : rôle PME générique (owner/manager/member/viewer).
--    NULL pour les users legacy non encore back-fillés ; users.role (CHECK
--    seq 59) reste la source de vérité technique, role_generic = surcouche
--    sémantique PME. Échoue « duplicate column name » si seq 79 rejouée : OK.
ALTER TABLE users ADD COLUMN role_generic TEXT DEFAULT NULL;

-- 3) Colonne last_login_at — DÉFENSIVE. auth.ts:115 l'UPDATE déjà ; sur une
--    base à jour cet ALTER ÉCHOUE « duplicate column name: last_login_at ».
--    C'est ATTENDU et NON FATAL (best-effort). Présent ici pour les bases qui
--    n'auraient jamais eu la colonne (sécurité du back-fill #5).
ALTER TABLE users ADD COLUMN last_login_at TEXT DEFAULT NULL;

-- 4) Back-fill role_generic : mapping inverse du CHECK seq 59.
--    admin→owner / broker→manager / store_manager→member. Idempotent
--    (WHERE role_generic IS NULL : ne réécrit jamais une valeur déjà posée).
UPDATE users SET role_generic = 'owner'   WHERE role_generic IS NULL AND role = 'admin';
UPDATE users SET role_generic = 'manager' WHERE role_generic IS NULL AND role = 'broker';
UPDATE users SET role_generic = 'member'  WHERE role_generic IS NULL AND role = 'store_manager';

-- 5) Back-fill last_login_at best-effort depuis admin_sessions
--    (MAX(last_active_at) de la session la plus récente). N'écrase pas une
--    valeur déjà présente (WHERE last_login_at IS NULL). Best-effort : si
--    admin_sessions/last_active_at indisponible, statement skippé par
--    l'exécuteur (log + continue), aucune régression.
UPDATE users
SET last_login_at = (
  SELECT MAX(s.last_active_at) FROM admin_sessions s WHERE s.user_id = users.id
)
WHERE last_login_at IS NULL
  AND EXISTS (SELECT 1 FROM admin_sessions s2 WHERE s2.user_id = users.id);
