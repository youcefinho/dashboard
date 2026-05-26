-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 140 — Sprint 45 Community / Groups (forum tenant interne)
-- Phase A SOLO (Manager-A) — scaffolding additif (2026-05-25)
--
-- FORUM TENANT INTERNE : membres connectés (users + admin_sessions, AUTH STD
-- — distinct de l'auth membre SÉPARÉE seq 87/seq 93 G10) peuvent créer threads,
-- comments nested 1 level, upvotes, modération. Feature signature
-- anti-Mighty-Networks / Circle pour vertical coaching/training.
--
-- ⚠ PRÉFIXE `c45_*` — collision intentionnelle évitée avec seq93 G10
--   (community_threads/community_posts/lesson_comments — AUTH MEMBRE SÉPARÉE,
--   member_id/member-auth). Pattern strictement calque sprint 44 (`fb_*`
--   seq139 vs `funnels` seq83). Le LOT-COMMUNITY-S45 a sa propre population
--   d'auth (users.community_role + caps `leads.write`/`settings.manage`), son
--   propre modèle (upvotes + nested comments + spam_score). PAS de réutilisation
--   de community_threads seq93 ; aucun ALTER de table existante.
--
-- depends_on : migration-funnels-seq139.sql (chaînage SÉQUENTIEL pour l'ordre
--              manifest ; AUCUNE dépendance schéma réelle sur seq 139).
--
-- ⚠ 100% STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une contrainte existante. Ce lot N'AJOUTE QUE :
--     - 4 `CREATE TABLE IF NOT EXISTS` NEUVES, idempotentes
--       (c45_threads, c45_comments, c45_votes, c45_moderation_actions) ;
--     - 5 `CREATE INDEX IF NOT EXISTS` neufs, idempotents ;
--     - 2 `ALTER TABLE users ADD COLUMN` (community_role + community_banned_at)
--       — additifs purs, defaults safe, AUCUN rebuild.
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Les
--   jointures c45_comments.thread_id → c45_threads.id / *.author_user_id →
--   users.id sont APPLICATIVES, par colonne TEXT. PAS de CHECK SQL (additif
--   pur — enums status / community_role / action validés HANDLER, pas SQL).
--
-- Anti-spam : moderateContent() (lib/community-engine.ts) réutilise S40
--   lib/review-moderation.ts (computeSpamScore + containsBadWords). Aucun
--   dictionnaire dupliqué.
--
-- Capabilities FIGÉES (AUCUN ajout à ALL_CAPABILITIES seq 80) :
--   - membres   : `leads.write`     (créer thread/comment, voter)
--   - modération: `settings.manage` (hide/delete/pin/lock/ban admin)
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent. `ALTER TABLE ADD COLUMN`
--   n'est PAS nativement IF NOT EXISTS dans SQLite — si rejoué après succès,
--   le runner doit absorber l'erreur "duplicate column name" (scripts/migrate.ts
--   FIGÉ, comportement legacy : log + continue ; calque ALTER seq 79/seq 80).
--
-- Conventions (calque seq 139 — funnels) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT DEFAULT
--   (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement, PAS de FK.
--   Bornage tenant : `client_id` NOT NULL (forum tenant interne — pas de mode
--   legacy mono-tenant pour ce lot ; le handler enforce resolveClientId AVANT
--   tout INSERT/SELECT).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-community-seq140.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) c45_threads — fil de discussion forum tenant. category = whitelist HANDLER
--    (general|question|announce|... — pas de CHECK SQL). status enum HANDLER
--    (open|hidden|deleted — soft-delete pour audit modération). is_pinned /
--    is_locked = flags modération (validés HANDLER). upvotes_count /
--    comments_count = compteurs dénormalisés (UPDATE atomic dans engine,
--    jamais COUNT(*) à la lecture — perf scroll forum). last_activity_at =
--    timestamp du dernier commentaire/upvote (driver le sort "hot").
CREATE TABLE IF NOT EXISTS c45_threads (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  author_user_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  is_pinned INTEGER DEFAULT 0,
  is_locked INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',
  upvotes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  last_activity_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2) c45_comments — commentaire d'un thread (replies nested 1 level via
--    parent_comment_id NULLABLE). status enum HANDLER (visible|hidden|deleted —
--    soft-delete pour audit). upvotes_count dénormalisé. ON DELETE CASCADE est
--    SIMULÉ côté handler (SQLite FK désactivées sur D1 par défaut + on évite
--    PRAGMA foreign_keys ON — rebuild risk). Le handler deleteThread cascade
--    explicitement DELETE FROM c45_comments WHERE thread_id = ?.
CREATE TABLE IF NOT EXISTS c45_comments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  thread_id TEXT NOT NULL,
  author_user_id TEXT,
  parent_comment_id TEXT,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'visible',
  upvotes_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 3) c45_votes — vote utilisateur sur thread/comment. target_type whitelist
--    HANDLER (thread|comment). voter_ip_hash = SHA-256 anonymisé (anti-spam IP
--    rate-limit côté engine ; jamais l'IP brute). UNIQUE index empêche
--    duplicates (handler gère 409 "duplicate_vote" via INSERT OR IGNORE).
CREATE TABLE IF NOT EXISTS c45_votes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  target_type TEXT,
  target_id TEXT NOT NULL,
  voter_user_id TEXT NOT NULL,
  voter_ip_hash TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 4) c45_moderation_actions — journal des actions de modération (hide|delete|
--    warn|ban). action enum HANDLER. moderator_user_id = users.id (RBAC
--    settings.manage). reason = texte libre (capé HANDLER 500 chars). client_id
--    pour audit cross-tenant.
CREATE TABLE IF NOT EXISTS c45_moderation_actions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  target_type TEXT,
  target_id TEXT,
  action TEXT,
  moderator_user_id TEXT,
  reason TEXT,
  client_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 5) ALTER users — rôle community + ban timestamp.
--    community_role enum HANDLER (member|moderator|admin) — pas de CHECK.
--    Defaults safe : tout user existant devient 'member' (lecture autorisée,
--    écriture gated par cap leads.write existante seq 80). community_banned_at
--    NULL = pas banni ; le handler refuse écriture si != NULL avec erreur
--    'community.errors.banned'. Le CHECK role users seq 59 (rebuild:users) est
--    INTOUCHÉ (additive column ne déclenche pas rebuild).
ALTER TABLE users ADD COLUMN community_role TEXT DEFAULT 'member';
ALTER TABLE users ADD COLUMN community_banned_at TEXT;

-- ── Index ADDITIFs idempotents ──────────────────────────────────────────────
-- Listing threads d'un tenant filtré status, trié last_activity_at (sort "hot").
CREATE INDEX IF NOT EXISTS idx_community_threads_client_status
  ON c45_threads(client_id, status, last_activity_at);

-- Listing threads filtré par catégorie (UI tabs catégories).
CREATE INDEX IF NOT EXISTS idx_community_threads_category
  ON c45_threads(client_id, category);

-- Listing commentaires d'un thread, trié created_at ASC (chronological).
CREATE INDEX IF NOT EXISTS idx_community_comments_thread
  ON c45_comments(thread_id, created_at);

-- UNIQUE vote — empêche double-vote (handler s'appuie sur INSERT OR IGNORE).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_community_votes
  ON c45_votes(target_type, target_id, voter_user_id);

-- Audit modération : lookup actions sur une cible (thread/comment).
CREATE INDEX IF NOT EXISTS idx_community_moderation_target
  ON c45_moderation_actions(target_type, target_id);

-- NB : 4 tables NEUVES (c45_threads, c45_comments, c45_votes,
-- c45_moderation_actions), 2 ALTER additifs users (community_role +
-- community_banned_at), 5 INDEX NEUFS. AUCUNE FK, AUCUN CHECK, AUCUN DROP /
-- RENAME / rebuild. Bornage tenant client_id NOT NULL forum (resolveClientId
-- HANDLER AVANT INSERT/SELECT). Anti-spam = lib/community-engine.moderateContent
-- (réutilise lib/review-moderation S40 — computeSpamScore + containsBadWords ;
-- aucun dictionnaire dupliqué). Capabilities FIGÉES leads.write membres +
-- settings.manage modération (AUCUN ajout ALL_CAPABILITIES seq 80). Préfixe
-- `c45_*` pour éviter collision intentionnelle avec seq93 G10 (AUTH MEMBRE
-- SÉPARÉE). Choix figés docs/LOT-COMMUNITY-S45.md §6.
