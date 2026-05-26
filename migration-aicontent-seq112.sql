-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 112 — SPRINT 12 « IA contenu — atelier centralisé »
-- (2026-05-22)
-- Atelier IA centralisé : persistance de la bibliothèque de contenus générés
-- (ai_content_items) + presets de voix de marque éditables multi-presets
-- (ai_brand_voices). Le MOTEUR de génération existe déjà (ai.ts:handleAiGenerate,
-- social-ai.ts, lib/aiDrafts.ts, ai-chat.ts) — CE LOT NE LE RÉÉCRIT PAS, il le
-- RÉUTILISE et lui AJOUTE la persistance + un pont IA→templates.
--
-- ⚠ NE PAS toucher `clients.brand_voice` (colonne EXISTANTE, fallback mono-valeur
--   consommé par 4 générateurs — INTOUCHÉE ici). Les presets ai_brand_voices sont
--   une couche ADDITIVE, jamais un remplacement de la colonne legacy.
--
-- depends_on : migration-sitebuilder-seq111.sql (seq 111 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 111).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   CONTRAINTE existante. Ce lot N'AJOUTE QUE :
--     - 2 `CREATE TABLE IF NOT EXISTS` (ai_content_items, ai_brand_voices) NEUVES,
--       idempotentes ;
--     - 2 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN ALTER. AUCUN touch `clients` (ni brand_voice). AUCUN touch
--   `email_templates` / `sms_templates` (le pont use-as-template fait des INSERT
--   côté HANDLER, jamais un ALTER de schéma). AUCUNE table existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures applicatives se font par colonne TEXT). PAS de CHECK : `format`
--   (email | sms | social | blog | landing), `status` (draft | …) et `is_default`
--   sont validés côté HANDLER, jamais par CHECK SQL.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas d'erreur si rejoué).
--
-- Conventions (calque seq 91 — ai_chat_*) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement,
--   PAS de FK. Bornage tenant : `client_id` NULLABLE (legacy/mono-tenant → NULL,
--   mode agence → borné côté handler depuis l'AUTH). `user_id` NULLABLE (legacy).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-aicontent-seq112.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) ai_content_items — bibliothèque des contenus générés par l'atelier IA.
--    format = email | sms | social | blog | landing (validé HANDLER, PAS de CHECK).
--    brief = consigne utilisateur ; content = texte généré/édité. tone_preset_id
--    = jointure APPLICATIVE → ai_brand_voices.id (zéro FK). source_action = action
--    du moteur (ex 'email_followup', 'rewrite:expand') pour traçabilité. status
--    validé HANDLER (draft par défaut). Bornage tenant : client_id NULLABLE
--    (legacy → NULL), user_id NULLABLE (legacy), TOUJOURS bornés côté handler
--    depuis l'AUTH (jamais le body).
CREATE TABLE IF NOT EXISTS ai_content_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT,
  format TEXT,
  title TEXT,
  brief TEXT,
  content TEXT,
  tone_preset_id TEXT,
  source_action TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2) ai_brand_voices — presets de voix de marque éditables (multi-presets par
--    tenant). description = PROMPT DE TON injecté dans le system prompt du moteur.
--    is_default = 0|1 (validé HANDLER, PAS de CHECK ; l'unicité du défaut est
--    gérée applicativement). Bornage tenant : client_id NULLABLE (legacy → NULL),
--    user_id NULLABLE (legacy). NE REMPLACE PAS `clients.brand_voice` (legacy
--    mono-valeur intouché) — couche ADDITIVE.
CREATE TABLE IF NOT EXISTS ai_brand_voices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT,
  name TEXT,
  description TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFs idempotents — bibliothèque d'un tenant/user triée récents ;
-- presets d'un tenant.
CREATE INDEX IF NOT EXISTS idx_ai_content_items_client ON ai_content_items(client_id, user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_brand_voices_client ON ai_brand_voices(client_id);

-- NB : 2 tables NEUVES (ai_content_items, ai_brand_voices), 2 INDEX NEUFS, AUCUN
-- ALTER, AUCUNE FK, AUCUN CHECK (format/status/is_default validés HANDLER). AUCUN
-- touch `clients` (ni brand_voice) / `email_templates` / `sms_templates`. AUCUN
-- DROP / RENAME / rebuild. Bornage tenant = AUTH uniquement. Choix figés
-- docs/LOT-AI-CONTENT.md §6.
