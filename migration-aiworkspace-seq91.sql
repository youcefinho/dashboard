-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 91 — LOT G8 AI Workspace conversationnel
-- (2026-05-20)
-- Assistant IA conversationnel global (panel slide-over cmd+/) : threads de
-- conversation + messages persistés, bornés tenant (client_id) + utilisateur
-- (user_id). v1 READ-ONLY / DRAFT-ONLY strict — le LLM (Claude Haiku 4.5
-- réutilisé via helper LOCAL dans ai-chat.ts) LIT / CALCULE / RÉDIGE des
-- brouillons, mais N'EXÉCUTE AUCUNE mutation. Les tools tool-calling
-- worker-side sont READ-ONLY et reçoivent client_id depuis l'AUTH, jamais du
-- LLM ni du body (FLAG sécurité #1 cross-tenant).
--
-- ⚠ PRÉFIXE `ai_chat_*` IMPÉRATIF. Les tables `ai_conversations` / `ai_messages`
--   (seq 7) sont un bot lead-répondeur (FK lead_id NOT NULL → leads, channel
--   sms/web/email) INCOMPATIBLE et INTOUCHABLE. CE LOT NE LES RÉUTILISE NI NE
--   LES ALTÈRE. Tables NEUVES dédiées à l'assistant produit.
--
-- depends_on : migration-segment-abtest-seq90.sql (seq 90 — dernière migration
--              du manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 90).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une CONTRAINTE existante.
--   Ce lot N'AJOUTE QUE :
--     - 2 `CREATE TABLE IF NOT EXISTS` (ai_chat_threads, ai_chat_messages)
--       NEUVES, idempotentes ;
--     - 2 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN ALTER. AUCUN touch `users` / `admin_sessions`. AUCUN touch tables
--   E4/E6 régulées (`payments`, `payment_events`, `payment_provider_config`,
--   `refunds`, `disputes`, `return_requests`). AUCUN touch `ai_conversations` /
--   `ai_messages` (seq 7). Le CHECK role users seq 59 (rebuild:users) est
--   INTOUCHÉ. AUCUNE table existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; la
--   jointure `ai_chat_messages.thread_id` → `ai_chat_threads.id` est
--   APPLICATIVE, par colonne TEXT). PAS de CHECK (additif pur — le `role`
--   ('user' | 'assistant') est validé côté HANDLER, pas par CHECK SQL).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas d'erreur si rejoué).
--   scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Conventions (calque seq 90 — broadcasts/messages, vérifié sur
--   migration-segment-abtest-seq90.sql) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement,
--   PAS de FK. Bornage tenant : `client_id` NULLABLE (legacy/mono-tenant →
--   NULL, mode agence → borné). `user_id` NOT NULL (toujours connu au
--   choke-point auth).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-aiworkspace-seq91.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) ai_chat_threads — fil de conversation de l'assistant IA. Bornage tenant
--    client_id NULLABLE (legacy → NULL). user_id = propriétaire (TOUJOURS borné
--    côté handler : WHERE user_id = auth.userId). title = libellé éditable.
CREATE TABLE IF NOT EXISTS ai_chat_threads (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT NOT NULL,
  title TEXT DEFAULT 'Nouvelle conversation',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2) ai_chat_messages — message d'un thread. role validé HANDLER ('user' |
--    'assistant', PAS de CHECK SQL). content = texte. tool_calls = JSON
--    sérialisé des appels d'outils READ-ONLY exécutés worker-side (trace, NULL
--    si aucun). tokens_used = compteur best-effort. thread_id = jointure
--    APPLICATIVE → ai_chat_threads.id (zéro FK). client_id NULLABLE (legacy),
--    user_id NOT NULL (bornage rate-limit + propriété).
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  thread_id TEXT NOT NULL,
  client_id TEXT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  tokens_used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFs idempotents — liste des threads d'un user triés récents ;
-- fil des messages d'un thread dans l'ordre chronologique (historique + cap 20).
CREATE INDEX IF NOT EXISTS idx_aichat_thread_user ON ai_chat_threads(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_aichat_msg_thread ON ai_chat_messages(thread_id, created_at);

-- NB : 2 tables NEUVES (préfixe ai_chat_*), 2 INDEX NEUFS, AUCUN ALTER, AUCUNE
-- FK, AUCUN CHECK (role validé HANDLER). AUCUN touch `ai_conversations` /
-- `ai_messages` seq 7 / `users` / `admin_sessions` / tables E4/E6 régulées.
-- AUCUN DROP / RENAME / rebuild. Bornage tenant = AUTH uniquement (le LLM
-- n'injecte jamais client_id — FLAG sécurité #1). v1 READ-ONLY / DRAFT-ONLY
-- (aucun tool mutant — FLAG sécurité #2). Choix figés docs/LOT-AICHAT-G8.md §6.
