-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 93 — LOT G10 Communauté membres (espace social) + commentaires
-- de leçons (2026-05-20)
-- Espace social DERRIÈRE l'auth membre 100% SÉPARÉE (members / member_sessions
-- seq 87). v1 RÉDUIT : (a) commentaires de leçons + (b) forum threads/posts
-- PLATS. PAS de réactions (couplage reactions.ts FRONT-ONLY interdit), PAS de
-- badges/certifs/lives (v2). Le badge « cours complété » reste COSMÉTIQUE FRONT
-- dérivé de lesson_progress (progress_pct existant seq 87) — ZÉRO table dédiée.
--
-- ⚠ AUTH MEMBRE 100% SÉPARÉE INTOUCHÉE — l'auteur de tout thread / post /
--   commentaire est `member_id` (members seq 87, résolu par requireMember via
--   member_sessions), JAMAIS `users` / `admin_sessions`. member-auth.ts est
--   RÉUTILISÉ EN LECTURE et N'EST PAS modifié. La modération PRO passe par
--   requireAuth + capability 'workflows.manage' (AUCUN ajout à
--   ALL_CAPABILITIES) — distincte de l'écriture membre.
--
-- ⚠ ISOLATION CROSS-SITE NON NÉGOCIABLE (FLAG sécurité #1) — toute table porte
--   client_id. À l'ÉCRITURE le handler pose `client_id = member.clientId`
--   (de members.client_id via requireMember), JAMAIS une valeur du body. À la
--   LECTURE le handler filtre `WHERE client_id = member.clientId`. Les routes
--   par ID (DELETE post/comment, modération) RE-VÉRIFIENT
--   `row.client_id == member.clientId` (membre) / rowInTenant (PRO) AVANT toute
--   action — sinon un membre du tenant B pourrait supprimer un post du tenant A
--   par id deviné. `member.clientId` = SEULE racine de confiance tenant côté
--   espace membre.
--
-- depends_on : migration-affiliate-seq92.sql (seq 92 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 92). Les jointures vers
--              members / lessons / courses (seq 87) sont APPLICATIVES (par
--              colonne TEXT), zéro FK.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 3 `CREATE TABLE IF NOT EXISTS` (community_threads, community_posts,
--       lesson_comments) NEUVES, idempotentes ;
--     - 3 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN ALTER. AUCUN touch `members` / `member_sessions` / `membership_sites`
--   / `lessons` / `courses` (seq 87). AUCUN touch `users` / `admin_sessions`.
--   AUCUN touch tables E4/E6 régulées. Le CHECK role users seq 59
--   (rebuild:users) est INTOUCHÉ. AUCUNE table existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures community_posts.thread_id → community_threads.id /
--   *.member_id → members.id / lesson_comments.lesson_id → lessons.id /
--   *.course_id → courses.id sont APPLICATIVES, par colonne TEXT). PAS de CHECK
--   (additif pur — les statuts is_pinned/is_locked/is_hidden sont des flags
--   booléens 0/1 posés/validés côté HANDLER, pas par CHECK SQL).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas d'erreur si rejoué).
--   scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Conventions (calque seq 92 — affiliate) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement,
--   PAS de FK. Bornage tenant : `client_id` NULLABLE (legacy/mono-tenant →
--   NULL, mode agence → borné member.clientId) + `agency_id` / `site_id`
--   NULLABLE (calque support_tickets seq 89 / courses seq 87).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-community-seq93.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) community_threads — fil de discussion du forum de l'espace membre. PLAT v1
--    (parent_post_id posé sur les posts mais réponses imbriquées = v2 sans
--    migration). title = sujet. is_pinned / is_locked = flags modération PRO
--    (validés HANDLER, PAS de CHECK). member_id = auteur (members seq 87,
--    JAMAIS users). Bornage tenant client_id/agency_id/site_id NULLABLE.
CREATE TABLE IF NOT EXISTS community_threads (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT, site_id TEXT,
  member_id TEXT,
  title TEXT NOT NULL DEFAULT 'Discussion',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 2) community_posts — message d'un thread. PLAT v1 (parent_post_id NULLABLE
--    posé pour réponses imbriquées v2, NON exploité v1). is_hidden = flag
--    modération PRO (soft-hide, validé HANDLER). member_id = auteur (members
--    seq 87). thread_id / member_id = jointures APPLICATIVES.
CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, thread_id TEXT, member_id TEXT,
  parent_post_id TEXT,
  body TEXT,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 3) lesson_comments — commentaire sous une leçon (accès via loadGatedLesson
--    triple borne member.clientId == lesson.client_id + enrollment + drip AVANT
--    lecture/écriture — §6.D). lesson_id / course_id / member_id = jointures
--    APPLICATIVES (lessons / courses seq 87, members seq 87). is_hidden = flag
--    modération PRO.
CREATE TABLE IF NOT EXISTS lesson_comments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, lesson_id TEXT, course_id TEXT, member_id TEXT,
  body TEXT,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFs idempotents — listing threads d'un tenant par date,
-- posts d'un thread par date, commentaires d'une leçon par date.
CREATE INDEX IF NOT EXISTS idx_community_threads_client ON community_threads(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_community_posts_thread ON community_posts(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lesson_comments_lesson ON lesson_comments(lesson_id, created_at);

-- NB : 3 tables NEUVES (community_threads, community_posts, lesson_comments),
-- 3 INDEX NEUFS, AUCUN ALTER, AUCUNE FK, AUCUN CHECK (flags 0/1 validés
-- HANDLER). AUCUN touch members / member_sessions / lessons / courses seq 87 /
-- users / admin_sessions / tables E4/E6 régulées. AUCUN DROP / RENAME /
-- rebuild. Bornage tenant = client_id/agency_id/site_id NULLABLE. Auteur =
-- member_id (auth membre séparée seq 87), JAMAIS users. Isolation cross-site
-- NON négociable (client_id = member.clientId écriture + filtre lecture +
-- re-borne routes par ID). Réactions HORS v1. Choix figés
-- docs/LOT-COMMUNITY-G10.md §6.
