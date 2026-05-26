-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 137 — SPRINT 42 « AI Chat Agent — conversational bot Haiku 4.5
-- + RAG knowledge base + escalation humain » (2026-05-25)
--
-- ÉTEND Sprint 36 Webchat Widget (seq131) — NE TOUCHE PAS aux fichiers
-- existants (src/worker/webchat.ts, src/worker/chat-widgets.ts,
-- src/worker/chat-session.ts, src/worker/lib/chat-session-do.ts). AJOUT de
-- 2 tables NEUVES (chat_knowledge_base + chat_bot_config) et 2 ALTER additifs
-- sur webchat_sessions pour matérialiser le handling AI (bot_handled flag +
-- bot_messages_count). L'intégration au DO WebchatRoom + flow visitor se fait
-- via routes additives Phase B — JAMAIS via modification du DO / des helpers
-- chat-session-do existants.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / CREATE
--   TABLE webchat_sessions / ALTER d'une contrainte existante. Ce lot
--   N'AJOUTE QUE :
--     - 2 `CREATE TABLE IF NOT EXISTS` — chat_knowledge_base (entries RAG par
--       tenant, FAQ + docs + URLs scrapées) + chat_bot_config (1 row par tenant,
--       configuration globale du bot : system prompt + threshold + escalation
--       message + enabled flag) ;
--     - 2 `ALTER TABLE webchat_sessions ADD COLUMN` — bot_handled (flag binaire :
--       cette session a-t-elle été traitée par le bot) + bot_messages_count
--       (compteur de messages bot pour rate-limit applicatif) ;
--     - 2 `CREATE INDEX IF NOT EXISTS` — listing KB entries actives par tenant,
--       UNIQUE INDEX 1 config par tenant (chat_bot_config.client_id).
--   AUCUN CHECK. AUCUNE FK destructrice. AUCUN rebuild. AUCUN touch
--   webchat_sessions en dehors des 2 ADD COLUMN. AUCUN touch webchat_widgets /
--   webchat_agent_presence (S36 INCHANGÉS).
--
-- ⚠ ADD COLUMN sur SQLite/D1 : ajout de colonne NULLABLE / DEFAULT constant =
--   opération in-place (PAS de rebuild de table). On reste donc sur le contrat
--   « zéro rebuild webchat_sessions ».
--
-- ⚠ BORNAGE TENANT — `chat_knowledge_base.client_id` + `chat_bot_config.client_id`
--   portent le tenant propriétaire. Toute lecture/écriture (Phase B handlers)
--   est bornée WHERE client_id = ? (résolu serveur via resolveClientId,
--   JAMAIS depuis le body).
--
-- ⚠ AI ENGINE — `chat_knowledge_base.embedding_json` = vecteur embedding
--   stocké comme JSON array (computed Phase B via env.AI binding Workers AI
--   embeddings model si disponible). NULL = entrée non encore embeddée → fallback
--   keyword/LIKE search HANDLER. `chat_bot_config.confidence_threshold` = REAL
--   (0..1) — seuil minimum pour répondre sans escalader (default 0.7).
--   `chat_bot_config.max_messages_per_session` = hard cap applicatif pour
--   éviter abuse visitor (default 20).
--
-- ⚠ FK APPLICATIVE webchat_widgets.id REFERENCES — `chat_bot_config.widget_id`
--   est documentée en commentaire SQL (NO REFERENCES clause posée car
--   webchat_widgets est une table EXISTANTE seq25 — FK ⇒ rebuild interdit).
--   Jointures APPLICATIVES dans les handlers. NULL autorisé = config globale
--   tenant non liée à un widget précis (default).
--
-- depends_on : migration-voice-agent-seq136.sql (chaînage strict dernier lot)
--              + migration-webchat-widget-s36-seq131.sql (parent module
--              Sprint 36 — webchat_widgets ALTER + webchat_sessions ALTER +
--              webchat_agent_presence).
--
-- Voir docs/LOT-CHAT-BOT-S42.md §6 pour contrat figé inter-agent Phase B.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `ALTER TABLE … ADD COLUMN` n'est PAS idempotent sur D1 (échoue si la
--   colonne existe déjà). En cas de rejeu, retirer manuellement les 2 ADD
--   COLUMN déjà appliqués. `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF
--   NOT EXISTS` sont idempotents (rejeu = no-op).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-chat-bot-seq137.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- ── chat_knowledge_base : entries RAG par tenant (FAQ / docs / URLs) ────────
-- Un tenant peut ajouter N entries (FAQ Q/R, extraits de docs, contenu scrapé
-- depuis une URL). Phase B handlers : list/create/update/delete + recherche
-- (LIKE fallback ou cosine similarity sur embedding_json si présent).
-- embedding_json : JSON array du vecteur embedding (computed Phase B via
--   env.AI binding Workers AI embeddings, ex bge-large-en-v1.5 → 1024 floats).
--   NULL = entrée pas encore embeddée → fallback keyword/LIKE search HANDLER.
-- source : enum HANDLER ('manual' | 'url' | 'faq') — validation side-handler
--   (whitelist JS), JAMAIS de CHECK SQL (rebuild interdit).
CREATE TABLE IF NOT EXISTS chat_knowledge_base (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id                TEXT NOT NULL,                    -- tenant propriétaire (bornage strict)
  title                    TEXT NOT NULL,                    -- titre court ("Heures d'ouverture", "Tarifs", etc.)
  content                  TEXT NOT NULL,                    -- contenu de l'entrée (texte brut, jusqu'à plusieurs KB)
  embedding_json           TEXT,                             -- JSON array du vecteur embedding (NULL = pas encore embeddé)
  source                   TEXT DEFAULT 'manual',            -- 'manual'|'url'|'faq' (whitelist HANDLER)
  is_active                INTEGER DEFAULT 1,                -- 1 = entrée disponible pour RAG, 0 = désactivée
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);

-- ── chat_bot_config : 1 row par tenant — configuration globale du bot ───────
-- UNIQUE INDEX sur client_id (1 config par tenant). widget_id est OPTIONNEL :
-- NULL = config globale s'applique à TOUS les widgets du tenant ; non-NULL =
-- override pour ce widget précis (Phase B future enhancement, Phase A
-- simplifie sur 1 config globale par tenant).
-- system_prompt : prompt système Haiku ("You are a helpful assistant for
--   <tenant_name>. Answer concisely…"). Interpolé HANDLER avec variables tenant.
-- confidence_threshold : REAL 0..1 — seuil minimum pour répondre sans
--   escalader vers humain (default 0.7).
-- escalation_message : texte affiché au visiteur quand le bot escalade
--   ("Un agent va vous répondre sous peu.").
-- enabled : 0 par défaut (opt-in conscient par tenant — bot OFF tant que pas
--   configuré + activé explicitement via UI Phase C).
-- max_messages_per_session : hard cap applicatif (default 20) pour éviter
--   abuse visitor (loop, brute-force, jailbreak).
CREATE TABLE IF NOT EXISTS chat_bot_config (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id                TEXT NOT NULL,                    -- tenant propriétaire (bornage strict + UNIQUE)
  widget_id                TEXT,                             -- FK applicative → webchat_widgets.id (NULL = global tenant)
  system_prompt            TEXT NOT NULL DEFAULT 'You are a helpful assistant.',
  confidence_threshold     REAL DEFAULT 0.7,                 -- confidence min (0..1) pour répondre sans escalader
  escalation_message       TEXT NOT NULL DEFAULT 'Un agent va vous répondre sous peu.',
  enabled                  INTEGER DEFAULT 0,                -- 0 = bot OFF (default), 1 = bot actif (opt-in)
  max_messages_per_session INTEGER DEFAULT 20,               -- hard cap applicatif (anti-abuse)
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);

-- ── ALTERs additifs webchat_sessions (zéro CHECK, DEFAULT constant) ─────────
-- bot_handled : 1 = session traitée (au moins partiellement) par le bot AI ;
--                0 = session humaine classique (default — préserve sémantique seq25/seq131).
-- bot_messages_count : compteur applicatif messages bot envoyés sur cette
--                       session (rate-limit côté handler vs
--                       chat_bot_config.max_messages_per_session).
ALTER TABLE webchat_sessions ADD COLUMN bot_handled INTEGER DEFAULT 0;
ALTER TABLE webchat_sessions ADD COLUMN bot_messages_count INTEGER DEFAULT 0;

-- ── Indexes (listing tenant + UNIQUE 1 config par tenant) ───────────────────
--   - listing KB entries actives par tenant (UI : afficher entries is_active=1)
CREATE INDEX IF NOT EXISTS idx_chat_kb_client            ON chat_knowledge_base(client_id, is_active);
--   - UNIQUE : 1 chat_bot_config par tenant (upsert HANDLER en INSERT ... ON
--     CONFLICT(client_id) DO UPDATE … côté PUT /config).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_chat_bot_config_client ON chat_bot_config(client_id);

-- NB : 2 CREATE TABLE IF NOT EXISTS, 2 ALTER ADD COLUMN (NULLABLES / DEFAULT
-- constant), 2 CREATE INDEX IF NOT EXISTS (dont 1 UNIQUE). AUCUN CHECK, AUCUNE
-- FK destructrice, AUCUN DROP / RENAME / rebuild. Enums (source) validés
-- HANDLER (whitelist JS). UPDATE/DELETE bornés tenant (client_id résolu
-- serveur, JAMAIS body). Capabilities settings.manage (seq80) RÉUTILISÉE —
-- ZÉRO ajout à ALL_CAPABILITIES. Choix figés docs/LOT-CHAT-BOT-S42.md §6.
