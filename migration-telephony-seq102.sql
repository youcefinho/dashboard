-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 102 — LOT TELEPHONY-F Téléphonie 2-way (fondations)
-- (2026-05-21)
-- 2 tables NEUVES pour la TÉLÉPHONIE 2-WAY : journalisation structurée des appels
-- (entrants ET sortants) + configuration des menus IVR (réception automatisée).
-- Module 100% SÉPARÉ du voicemail entrant existant (voice.ts INTOUCHÉ — pas de
-- régression sur le flux Record + Whisper + findOrCreateConversation en prod).
--
-- ⚠ APPELS TWILIO RÉELS — FLAG INACTIF (calque EXACT helpers.ts:sendSms). Tout
--   appel API Twilio sortant (placeCall) est précédé du garde credentials
--   (`if (!ACCOUNT_SID||!AUTH_TOKEN||!PHONE_NUMBER) return { success:false }`).
--   Le call_log est créé QUAND MÊME (status 'mock'/'queued') ⇒ la logique de
--   journalisation + wiring CRM est testable SANS credentials. ZÉRO appel réel
--   tant que les secrets Twilio ne sont pas configurés.
--
-- ⚠ BORNAGE TENANT — `call_logs.client_id` / `ivr_menus.client_id` portent le
--   tenant propriétaire. CHAQUE lecture est bornée (calque conversations.ts:27 :
--   `auth.role !== 'admin'` → `WHERE client_id = ?`). client_id résolu côté
--   serveur (lead → leads.client_id, jamais depuis le body/query).
--
-- depends_on : migration-portal-seq101.sql (seq 101 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 101). Les tables référencées
--              en LECTURE par le wiring CRM (Phase B) — leads seq1, conversations
--              seq?, messages seq2, activity_log seq1 — existent déjà ; JAMAIS
--              par FK.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 2 `CREATE TABLE IF NOT EXISTS` — neuves, idempotentes ;
--     - 4 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN DEFAULT non-NULL (hors id randomblob / duration_sec 0 / is_active 1 /
--   timestamp datetime('now') — défauts internes propres aux tables neuves).
--   AUCUN CHECK. AUCUNE FK. AUCUN rebuild. AUCUN touch clients / agencies /
--   users / leads / conversations / messages / activity_log / sub_accounts.
--   AUCUN touch tables E4/E6 régulées. Le CHECK role users seq 59
--   (rebuild:users) est INTOUCHÉ.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` sont idempotents
--   (rejeu = no-op). scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-telephony-seq102.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) call_logs — journal structuré des appels (entrants ET sortants). lead_id /
--    conversation_id NULLABLES (un appel peut précéder la résolution lead, ou ne
--    jamais être rattaché). client_id = tenant propriétaire (borne cross-tenant).
--    direction 'inbound'|'outbound'. status 'mock'|'queued'|'ringing'|'completed'
--    |'failed'|'no-answer' (libre, posé par placeCall ou le status-callback
--    Twilio). twilio_sid = corrélation au Call Twilio (NULL en mode mock).
CREATE TABLE IF NOT EXISTS call_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT, lead_id TEXT, conversation_id TEXT,
  direction TEXT, from_number TEXT, to_number TEXT,
  status TEXT, duration_sec INTEGER DEFAULT 0,
  recording_url TEXT, transcription TEXT, twilio_sid TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 2) ivr_menus — configuration des menus IVR (réception automatisée). config_json
--    = arbre de réponse sérialisé (Say + Gather + options digit → action
--    dial/record/say). is_active 1 par défaut. client_id = tenant propriétaire.
CREATE TABLE IF NOT EXISTS ivr_menus (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT, name TEXT, config_json TEXT,
  is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFS idempotents.
-- Liste des appels d'un tenant, triés par date (chemin chaud handleGetCallLogs).
CREATE INDEX IF NOT EXISTS idx_call_logs_client ON call_logs(client_id, created_at);
-- Filtre par lead (timeline call_logs d'une fiche lead).
CREATE INDEX IF NOT EXISTS idx_call_logs_lead ON call_logs(lead_id);
-- Liste des menus IVR d'un tenant.
CREATE INDEX IF NOT EXISTS idx_ivr_menus_client ON ivr_menus(client_id);
-- Corrélation status-callback Twilio (MAJ par twilio_sid).
CREATE INDEX IF NOT EXISTS idx_call_logs_sid ON call_logs(twilio_sid);

-- NB : 2 CREATE TABLE neuves, 4 INDEX neufs, AUCUN CHECK, AUCUNE FK, AUCUN DROP /
-- RENAME / rebuild / ALTER. NULL lead_id/conversation_id admis (appel non
-- rattaché). Bornage tenant = client_id (auth.role admin calque conversations.ts).
-- ZÉRO ajout ALL_CAPABILITIES (leads.write click-to-call / settings.manage IVR
-- réutilisées). Appels Twilio réels FLAG INACTIF (call_log mock sans credentials).
-- voice.ts INTOUCHÉ (voicemail prod préservé). Choix figés docs/LOT-TELEPHONY-F.md §6.
