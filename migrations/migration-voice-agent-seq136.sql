-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 136 — SPRINT 41 « AI Voice Agent — inbound auto-response +
-- escalation » (2026-05-25)
--
-- ÉTEND Sprint 34 Twilio Voice (seq129) — NE TOUCHE PAS aux fichiers existants
-- (twilio-twiml.ts, lib/twilio-voice.ts, voice.ts). AJOUT de 2 tables NEUVES
-- (voice_agent_scripts + voice_agent_calls) et 2 ALTER additifs sur call_logs
-- pour matérialiser le handling AI (agent_handled flag + agent_script_id
-- pointer). L'intégration au TwiML flow se fait via routes additives Phase B
-- — JAMAIS via modification du code TwiML existant.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / CREATE
--   TABLE call_logs / ALTER d'une contrainte existante. Ce lot N'AJOUTE QUE :
--     - 2 `CREATE TABLE IF NOT EXISTS` — voice_agent_scripts (configuration
--       par tenant des scripts d'intent + template de réponse) + voice_agent_calls
--       (historique des appels traités par l'AI agent, transcript + intent +
--       confidence + escalation) ;
--     - 2 `ALTER TABLE call_logs ADD COLUMN` — agent_handled (flag binaire :
--       l'appel a-t-il été traité par l'AI) + agent_script_id (script utilisé,
--       FK applicative vers voice_agent_scripts.id) ;
--     - 3 `CREATE INDEX IF NOT EXISTS` — listing scripts actifs par tenant,
--       jointure call_log↔voice_agent_call, listing calls par tenant trié.
--   AUCUN CHECK. AUCUNE FK destructrice. AUCUN rebuild. AUCUN touch call_logs
--   en dehors des 2 ADD COLUMN. AUCUN touch voicemails / call_recordings_metadata.
--
-- ⚠ ADD COLUMN sur SQLite/D1 : ajout de colonne NULLABLE / DEFAULT constant =
--   opération in-place (PAS de rebuild de table). On reste donc sur le contrat
--   « zéro rebuild call_logs ».
--
-- ⚠ BORNAGE TENANT — `voice_agent_scripts.client_id` + `voice_agent_calls.client_id`
--   portent le tenant propriétaire. Toute lecture/écriture (Phase B handlers)
--   est bornée WHERE client_id = ? (résolu serveur via resolveClientId, JAMAIS
--   depuis le body).
--
-- ⚠ AI ENGINE — `voice_agent_scripts.intent_keywords_json` = array de mots-clés
--   pour le matching keyword fallback (si env.AI absent / Haiku KO). Le matching
--   Haiku est fait HANDLER (`lib/voice-agent-engine.ts:detectIntent`), JAMAIS
--   en SQL. `response_template` supporte des variables {{visitor_name}} interpolées
--   par `buildResponse()`. `escalation_threshold` = confidence minimum (REAL 0..1)
--   pour répondre sans escalader vers humain (default 0.7).
--
-- ⚠ FK APPLICATIVE call_logs.id REFERENCES — `voice_agent_calls.call_log_id`
--   est documentée en commentaire SQL (NO REFERENCES clause posée car
--   call_logs est une table EXISTANTE — FK ⇒ rebuild interdit). Jointures
--   APPLICATIVES dans les handlers.
--
-- depends_on : migration-product-reviews-abandoned-seq135.sql (chaînage strict
--              dernier lot LOT 4) + migration-twilio-voice-seq129.sql (parent
--              module Sprint 34 — call_logs ALTER + voicemails + call_recordings_metadata).
--
-- Voir docs/LOT-VOICE-AGENT-S41.md §6 pour contrat figé inter-agent Phase B.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `ALTER TABLE … ADD COLUMN` n'est PAS idempotent sur D1 (échoue si la
--   colonne existe déjà). En cas de rejeu, retirer manuellement les 2 ADD
--   COLUMN déjà appliqués. `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF
--   NOT EXISTS` sont idempotents (rejeu = no-op).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-voice-agent-seq136.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- ── voice_agent_scripts : configuration AI agent par tenant ─────────────────
-- Un tenant peut définir plusieurs scripts (un par intent : "horaires", "tarifs",
-- "rendez-vous", etc.). Phase B handlers : list/create/update/delete + test.
-- intent_keywords_json : array JSON de mots-clés ["horaire","heures","ouvert"]
--   utilisés en fallback keyword matching si env.AI absent (Workers AI KO).
-- response_template : template texte avec variables {{visitor_name}}, {{tenant_name}}
--   interpolées par buildResponse() côté handler.
-- escalation_threshold : REAL 0..1 — confidence min pour répondre sans escalader.
CREATE TABLE IF NOT EXISTS voice_agent_scripts (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id                TEXT NOT NULL,                    -- tenant propriétaire (bornage strict)
  name                     TEXT NOT NULL,                    -- nom court du script ("Horaires d'ouverture")
  intent_keywords_json     TEXT NOT NULL DEFAULT '[]',       -- JSON array de mots-clés (fallback keyword match)
  response_template        TEXT NOT NULL,                    -- template texte avec variables {{visitor_name}}
  escalation_threshold     REAL DEFAULT 0.7,                 -- confidence min (0..1) pour répondre sans escalader
  is_active                INTEGER DEFAULT 1,                -- 1 = script actif (peut être matché), 0 = désactivé
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);

-- ── voice_agent_calls : historique des appels traités par l'AI agent ────────
-- Un row par appel inbound traité par l'AI (peut être null script_id si aucun
-- script n'a matché → escalade immédiate). Distinct de call_logs (timeline
-- générique téléphonie) : matérialise la CONVERSATION AI (intent détecté,
-- confidence, réponse TTS, escalation reason, transcript complet).
-- call_log_id FK applicative → call_logs.id (jointure dans handlers).
-- script_id FK applicative → voice_agent_scripts.id (NULL = aucun match).
CREATE TABLE IF NOT EXISTS voice_agent_calls (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  call_log_id              TEXT NOT NULL,                    -- FK applicative → call_logs.id
  client_id                TEXT NOT NULL,                    -- tenant propriétaire (bornage strict)
  script_id                TEXT,                             -- FK applicative → voice_agent_scripts.id (NULL = no match)
  intent_detected          TEXT,                             -- label intent détecté (ex: "horaires", "tarifs")
  confidence               REAL,                             -- confidence Haiku ou keyword (0..1)
  response_text            TEXT,                             -- texte envoyé en TTS <Say> (ou null si escaladé d'office)
  escalated                INTEGER DEFAULT 0,                -- 1 = escaladé vers humain, 0 = AI a répondu
  escalation_reason        TEXT,                             -- raison HANDLER : 'low_confidence'|'user_request'|'no_match'|'error'
  duration_sec             INTEGER DEFAULT 0,                -- durée de la conversation AI (start → réponse ou escalade)
  transcript_full          TEXT,                             -- transcript complet user input + AI response (audit)
  created_at               TEXT DEFAULT (datetime('now'))
);

-- ── ALTERs additifs call_logs (zéro CHECK, DEFAULT constant uniquement) ─────
-- agent_handled : 1 = appel traité par l'AI agent (lookup voice_agent_calls).
--                  0 = appel humain classique (default — préserve sémantique seq102).
-- agent_script_id : pointeur FK applicative vers voice_agent_scripts.id (script
--                   qui a matché, NULL si pas de match ou pas de handling AI).
ALTER TABLE call_logs ADD COLUMN agent_handled INTEGER DEFAULT 0;
ALTER TABLE call_logs ADD COLUMN agent_script_id TEXT;

-- ── Indexes (listing tenant + jointures chaudes Phase B) ────────────────────
--   - listing scripts actifs par tenant (UI settings : afficher scripts is_active=1)
CREATE INDEX IF NOT EXISTS idx_voice_agent_scripts_client     ON voice_agent_scripts(client_id, is_active);
--   - jointure call_log ↔ voice_agent_call (détail appel : qui a été traité par AI)
CREATE INDEX IF NOT EXISTS idx_voice_agent_calls_call_log     ON voice_agent_calls(call_log_id);
--   - listing voice_agent_calls borné tenant trié created_at DESC (UI history)
CREATE INDEX IF NOT EXISTS idx_voice_agent_calls_client_created ON voice_agent_calls(client_id, created_at);

-- NB : 2 CREATE TABLE IF NOT EXISTS, 2 ALTER ADD COLUMN (NULLABLES / DEFAULT
-- constant), 3 CREATE INDEX IF NOT EXISTS. AUCUN CHECK, AUCUNE FK destructrice,
-- AUCUN DROP / RENAME / rebuild. Enums (escalation_reason) validés HANDLER
-- (whitelist JS). UPDATE/DELETE bornés tenant (client_id résolu serveur,
-- JAMAIS body). Capabilities settings.manage (seq80) RÉUTILISÉE — ZÉRO ajout
-- à ALL_CAPABILITIES. Choix figés docs/LOT-VOICE-AGENT-S41.md §6.
