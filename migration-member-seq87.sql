-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 87 — LOT MEMBERSHIPS / COURS / ESPACE CLIENT (Sprint 6, 2026-05-19)
-- Espace membre & cours en ligne niveau Kajabi/Podia entrée de gamme : auth
-- membre SÉPARÉE (login distinct du CRM), cours modules→leçons (texte + vidéo
-- R2 gated), drip release, progression, espace membre public + gestion PRO.
-- SANS paiement réel (E4/E6 jamais activés ; `price_cents` posé INACTIF).
-- ADDITIF pur, zéro régression auth CRM / e-commerce / workflows.
--
-- depends_on : migration-emailseq-seq86.sql (seq 86 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 86).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une CONTRAINTE existante.
--   Ce lot N'AJOUTE QUE :
--     - des `CREATE TABLE IF NOT EXISTS` (9 tables NEUVES, idempotentes) ;
--     - des `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN `ALTER TABLE` sur une table existante. AUCUNE table existante
--   recréée. Toutes les tables ci-dessous sont NEUVES (espace membre
--   100% SÉPARÉ du CRM).
--
--   AUTH MEMBRE 100% SÉPARÉE : `members` / `member_sessions` sont des tables
--   NEUVES, DISTINCTES de `users` (seq 5) et `admin_sessions` (seq 36). Le
--   CHECK role `users` seq 59 (rebuild:users) est INTOUCHÉ. AUCUN touch
--   `users` / `admin_sessions`. La table `course_enrollments` est un
--   NAMESPACE DISTINCT de `workflow_enrollments` (seq 3 ; rebuild seq 73
--   migration-sprintE9-m1.sql) — JAMAIS touchée/lue par ce lot.
--   AUCUN touch tables E4/E6 régulées (`payments`, `payment_events`,
--   `payment_provider_config`, `refunds`, `disputes`, `return_requests`).
--   `price_cents` (membership_plans) est POSÉ mais INACTIF — AUCUNE logique
--   de paiement n'est activée par ce lot (v2 sous revue PCI/légale — voir
--   docs/LOT-MEMBER6.md §6.B).
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures member↔session / course↔module / module↔lesson /
--   enrollment↔course / progress↔lesson sont APPLICATIVES, par colonne
--   TEXT). PAS de CHECK sur `members.status` / `lessons.content_type` /
--   `course_enrollments.status` / `lesson_progress.status` (additif pur —
--   ajouter un CHECK plus tard ⇒ rebuild ⇒ on ne s'enferme pas).
--
-- TOLÉRANCE « table exists » — exécution best-effort :
--   si seq 87 est rejouée, `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent
--   (pas d'erreur). L'exécuteur (Antigravity) joue ce fichier statement-par-
--   statement, log + CONTINUE au statement suivant. scripts/migrate.ts est
--   FIGÉ et N'EST PAS modifié ; la tolérance est une consigne d'exécution.
--
-- Conventions schema.sql (vérifiées sur migration-emailseq-seq86.sql /
--   migration-booking-seq84.sql) :
--   id TEXT PK lower(hex(randomblob(16))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch, PAS d'INTEGER autoincrement,
--   PAS de FK.
--
-- Bornage tenant : `client_id` (tenant propriétaire — calque
--   booking_pages.client_id seq 7 / funnels.client_id seq 83) + `agency_id`
--   (scope agence — calque funnels.agency_id seq 83 / booking seq 84).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-member-seq87.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) members — compte membre (auth SÉPARÉE du CRM `users`). password_hash =
--    pbkdf2 (crypto.ts hashPassword RÉUTILISÉ, format `pbkdf2$...`). status
--    'active' par défaut (PAS de CHECK — additif). lead_id nullable = wiring
--    CRM OPTIONNEL (§6.G — ne couple JAMAIS les deux auth). plan_id nullable
--    = plan d'adhésion (price_cents INACTIF). JAMAIS lié à users/admin_sessions.
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  lead_id TEXT,
  plan_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 2) member_sessions — sessions membre (calque admin_sessions seq 36 MAIS
--    table DISTINCTE — `requireMember` lit CECI UNIQUEMENT, jamais
--    admin_sessions). token = crypto.randomUUID() (calque auth.ts:120).
CREATE TABLE IF NOT EXISTS member_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  member_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 3) membership_sites — espace membre d'un tenant (slug → tenant, calque
--    funnel_publications.slug seq 83 / booking_pages.slug seq 7). Résolution
--    tenant publique = `membership_sites.slug` (§6.C).
CREATE TABLE IF NOT EXISTS membership_sites (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  slug TEXT NOT NULL,
  name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 4) membership_plans — plan d'adhésion. price_cents POSÉ INACTIF — stocké
--    mais AUCUNE logique paiement (E4/E6 jamais activés — §6.B).
CREATE TABLE IF NOT EXISTS membership_plans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  name TEXT NOT NULL DEFAULT 'Plan',
  price_cents INTEGER NOT NULL DEFAULT 0,   -- POSÉ INACTIF — aucune logique paiement (§6.B)
  created_at TEXT DEFAULT (datetime('now'))
);

-- 5) courses — cours rattaché à un membership_site (jointure applicative
--    site_id, PAS de FK). plan_id nullable = gating par plan (price_cents
--    INACTIF). is_published 0 = brouillon (invisible espace membre).
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  site_id TEXT,
  plan_id TEXT,
  title TEXT NOT NULL DEFAULT 'Cours',
  description TEXT,
  is_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 6) course_modules — module d'un cours (jointure applicative course_id,
--    PAS de FK). sort_order pour l'ordonnancement applicatif.
CREATE TABLE IF NOT EXISTS course_modules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  course_id TEXT,
  title TEXT NOT NULL DEFAULT 'Module',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 7) lessons — leçon d'un module. content_type 'text' | 'video' (PAS de
--    CHECK — additif). body_html = contenu texte. r2_key nullable = clé
--    objet R2 (env.FILES) pour vidéo GATED (proxy worker, JAMAIS URL R2
--    publique — §6.E). drip_days = nb de jours après enrollment avant
--    déblocage (§6.F). course_id dupliqué (jointure applicative directe).
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  module_id TEXT,
  course_id TEXT,
  title TEXT NOT NULL DEFAULT 'Leçon',
  content_type TEXT NOT NULL DEFAULT 'text',
  body_html TEXT,
  r2_key TEXT,
  drip_days INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 8) course_enrollments — inscription d'un membre à un cours. NAMESPACE
--    DISTINCT de workflow_enrollments (seq 3 / rebuild seq 73) — JAMAIS
--    touché/lu. status 'active' (PAS de CHECK — additif). client_id =
--    bornage tenant.
CREATE TABLE IF NOT EXISTS course_enrollments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  member_id TEXT,
  course_id TEXT,
  client_id TEXT,
  enrolled_at TEXT DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active'
);

-- 9) lesson_progress — progression d'un membre sur une leçon. status
--    'started' | 'completed' (PAS de CHECK — additif). Upsert applicatif
--    ON CONFLICT(member_id, lesson_id) (§6.F) → l'index unique ci-dessous.
--    completed_at nullable. % de complétion = COUNT applicatif (§6.F).
CREATE TABLE IF NOT EXISTS lesson_progress (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  member_id TEXT,
  lesson_id TEXT,
  course_id TEXT,
  status TEXT NOT NULL DEFAULT 'started',
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFs idempotents — lookup session (auth membre), unicité
-- email par tenant, résolution slug→tenant, listing inscriptions/
-- progression d'un membre, leçons d'un module. L'index unique
-- lesson_progress(member_id, lesson_id) porte l'upsert ON CONFLICT (§6.F).
CREATE INDEX IF NOT EXISTS idx_member_sessions_token ON member_sessions(token);
CREATE INDEX IF NOT EXISTS idx_members_email ON members(client_id, email);
CREATE INDEX IF NOT EXISTS idx_membership_sites_slug ON membership_sites(slug);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_member ON course_enrollments(member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_progress_member ON lesson_progress(member_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons(module_id);

-- NB : 9 tables NEUVES, AUCUN ALTER sur une table existante. AUCUNE colonne
-- ajoutée à `users` / `admin_sessions` / `clients` / tables E4/E6 régulées.
-- AUCUN CHECK existant modifié (CHECK role users seq 59 / CHECK
-- workflow_enrollments seq 73 INTOUCHÉS). `course_enrollments` est un
-- namespace DISTINCT de `workflow_enrollments` (JAMAIS touché/lu). AUCUNE
-- FK. AUCUN DROP / RENAME / rebuild. Auth membre 100% SÉPARÉE (members /
-- member_sessions ≠ users / admin_sessions). price_cents INACTIF (E4/E6
-- jamais activés). Le wiring membre→CRM (Phase B) est OPTIONNEL via
-- members.lead_id nullable + autoEnrollForTrigger('member_signup') —
-- SANS jamais coupler les deux auth. Choix figés docs/LOT-MEMBER6.md §6.
