-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 129 — SPRINT 34 « Twilio Voice — outbound + recording +
-- voicemail RGPD/CRTC » (2026-05-24)
--
-- La TÉLÉPHONIE 2-WAY existe DÉJÀ (seq 102 call_logs + ivr_menus + seq 116
-- disposition/notes ; module telephony.ts FLAG INACTIF Twilio ; voice.ts
-- voicemail entrant prod intouché). CE LOT NE RECONSTRUIT RIEN — il AJOUTE
-- sur la table EXISTANTE `call_logs` (seq 102) les colonnes RECORDING +
-- TRANSCRIPTION (audio enregistré + Whisper) + CONSENT bi-party CRTC, plus
-- 2 tables NEUVES voicemails (boîte vocale structurée) + call_recordings_metadata
-- (retention 90j + cascade delete RGPD).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / CREATE
--   TABLE call_logs / ALTER d'une contrainte existante. recording_url ET
--   transcription EXISTENT DÉJÀ (seq 102, l.58) — NE PAS les re-ajouter.
--   Ce lot N'AJOUTE QUE :
--     - 6 `ALTER TABLE call_logs ADD COLUMN` — colonnes NULLABLES, sans
--       DEFAULT non-NULL, sans CHECK (enum transcription_status validé
--       HANDLER : pending|done|failed|skipped ; lang BCP-47 validé HANDLER) ;
--     - 2 `CREATE TABLE IF NOT EXISTS` — voicemails (boîte vocale unifiée
--       lead↔conversation↔call_log) + call_recordings_metadata (retention 90j
--       + audit RGPD/CRTC) ;
--     - 5 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents, ciblent les
--       chemins chauds (listing voicemails par tenant/created_at DESC ;
--       jointure call_log↔voicemail ; jointure lead↔voicemail ; jointure
--       call_log↔recording_metadata ; lookup par recording_sid Twilio).
--   AUCUN CHECK. AUCUNE FK. AUCUN rebuild. AUCUN touch ivr_menus / clients /
--   agencies / users / leads / conversations / messages / activity_log /
--   tasks / sub_accounts. AUCUN touch tables E4/E6 régulées.
--
-- ⚠ ADD COLUMN sur SQLite/D1 : ajout de colonne NULLABLE = opération in-place
--   (PAS de rebuild de table tant qu'il n'y a ni DEFAULT non-constant ni CHECK
--   ni FK). On reste donc sur le contrat « zéro rebuild call_logs ».
--
-- ⚠ BORNAGE TENANT — `call_logs.client_id` (seq 102) + voicemails.client_id +
--   call_recordings_metadata.client_id portent le tenant propriétaire. Toute
--   lecture/écriture (Phase B handlers) est bornée WHERE client_id = ?
--   (résolu serveur via resolveClientId, JAMAIS depuis le body).
--
-- ⚠ RGPD/CRTC — `recording_consent_obtained_at` (call_logs) + `consent_obtained_at`
--   (call_recordings_metadata) tracent le consentement bi-party explicite
--   (Québec : enregistrer un appel requiert le consentement des DEUX parties,
--   loi C-29 + Code criminel art. 184). `retention_days` borné 90 jours par
--   défaut (politique Intralys RGPD §6.7 LOT-TWILIO-VOICE-S34.md), cascade
--   delete via cron quotidien : DELETE FROM voicemails WHERE created_at <
--   datetime('now', '-' || retention_days || ' days') (Phase B).
--
-- depends_on : migration-telephony-seq102.sql (call_logs base) +
--              migration-telephony-disposition-seq116.sql (disposition/notes
--              ADDITIFS sur même table — ordre chaîné) +
--              migration-calendar-sync-seq128.sql (chaînage séquentiel manifest
--              — AUCUNE dépendance de schéma calendar).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `ALTER TABLE … ADD COLUMN` n'est PAS idempotent sur D1 (échoue si la
--   colonne existe déjà). En cas de rejeu, retirer manuellement les 6 ADD
--   COLUMN déjà appliqués. `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF
--   NOT EXISTS` sont idempotents (rejeu = no-op). scripts/migrate.ts est FIGÉ
--   et N'EST PAS modifié.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-twilio-voice-seq129.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) recording_sid — SID Twilio de l'enregistrement (REcXXXX). Permet le lookup
--    croisé webhook recording-status-callback → call_log + suppression Twilio
--    DELETE /2010-04-01/Recordings/{Sid}.json (cascade delete RGPD).
ALTER TABLE call_logs ADD COLUMN recording_sid TEXT;

-- 2) recording_duration_sec — durée de l'enregistrement (Twilio RecordingDuration).
--    Distinct de duration_sec (durée de l'appel total) : un appel de 60s peut
--    contenir un enregistrement de 45s si on a démarré l'enregistrement à 15s.
ALTER TABLE call_logs ADD COLUMN recording_duration_sec INTEGER;

-- 3) recording_r2_key — clé R2 (Cloudflare Object Storage) de l'audio téléchargé
--    + ré-uploadé en local pour découpler de Twilio (post-retention Twilio + URL
--    signée Intralys). Format : voice/{client_id}/{call_log_id}/{recording_sid}.mp3
ALTER TABLE call_logs ADD COLUMN recording_r2_key TEXT;

-- 4) transcription_status — enum validé HANDLER (JAMAIS CHECK SQL) :
--    pending|done|failed|skipped. pending = Whisper en cours / queue. done =
--    transcript écrit dans call_logs.transcription (seq 102). failed = Whisper
--    KO / pas de clé OPENAI_API_KEY. skipped = enregistrement court / langue
--    non supportée / consent absent.
ALTER TABLE call_logs ADD COLUMN transcription_status TEXT;

-- 5) transcription_lang — code langue BCP-47 (fr-CA, fr-FR, en-US, es-ES, …)
--    détecté ou forcé par le handler. Validé HANDLER (whitelist allowlist Phase
--    B), JAMAIS CHECK SQL.
ALTER TABLE call_logs ADD COLUMN transcription_lang TEXT;

-- 6) recording_consent_obtained_at — timestamp ISO 8601 du consentement bi-party
--    CRTC obtenu (TwiML <Say> de notification + lead réponse via DTMF OU
--    pré-consentement enregistré côté lead + pré-validation côté agent au moment
--    du click-to-call). NULL = enregistrement INTERDIT par défaut (politique
--    Phase B handleToggleCallRecording : ne start QUE si consent timestamp
--    présent).
ALTER TABLE call_logs ADD COLUMN recording_consent_obtained_at TEXT;

-- ── Table voicemails — boîte vocale structurée unifiée ─────────────────────
-- Distincte de voice.ts (qui INSERT un message dans la conversation voice) :
-- voicemails matérialise chaque message vocal comme une entité de premier
-- ordre avec son propre cycle de vie (listened_at, deleted_at, transcription_*,
-- recording_r2_key). Le record voice.ts dans messages reste posé pour la
-- timeline conversation, mais voicemails.id devient la source de vérité pour
-- la VoicemailInbox UI (Phase C Manager-C).
CREATE TABLE IF NOT EXISTS voicemails (
  id                          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id                   TEXT,                        -- tenant propriétaire
  agency_id                   TEXT,                        -- agence (multi-tenant SaaS, NULL en mono-tenant)
  call_log_id                 TEXT,                        -- FK applicative → call_logs.id (NULL si voicemail orphelin)
  lead_id                     TEXT,                        -- FK applicative → leads.id (NULL si appelant inconnu non auto-créé)
  conversation_id             TEXT,                        -- FK applicative → conversations.id (timeline conversation 'voice')
  from_number                 TEXT,                        -- numéro de l'appelant (E.164)
  to_number                   TEXT,                        -- numéro Twilio appelé (tenant)
  recording_url               TEXT,                        -- URL Twilio brut (avant download R2) — peut être révoquée post-retention Twilio
  recording_sid               TEXT,                        -- REcXXX Twilio SID
  recording_r2_key            TEXT,                        -- clé R2 audio local (post-download, URL signée Intralys)
  duration_sec                INTEGER DEFAULT 0,           -- durée du message vocal
  transcription               TEXT,                        -- texte transcrit (Whisper)
  transcription_status        TEXT,                        -- pending|done|failed|skipped (HANDLER validé)
  transcription_lang          TEXT,                        -- BCP-47 (HANDLER validé)
  listened_at                 TEXT,                        -- timestamp ISO de la 1ère écoute (Phase B handleMarkVoicemailListened)
  listened_by                 TEXT,                        -- user_id du 1er auditeur
  deleted_at                  TEXT,                        -- soft-delete (RGPD : trace de suppression sans hard-delete immédiat)
  created_at                  TEXT DEFAULT (datetime('now'))
);

-- ── Table call_recordings_metadata — RGPD/CRTC audit + retention ──────────
-- Sépare l'audit RGPD du métier (call_logs.recording_* sont les pointeurs
-- opérationnels ; cette table porte la METADATA conformité : qui a consenti,
-- quand, par quel moyen, combien de temps on garde, quand on a supprimé côté
-- Twilio, quand on a soft-deleted côté Intralys). Permet l'export RGPD
-- portable (right to data portability) + le DELETE forcé sur demande sujet
-- (right to erasure) sans toucher call_logs (qui garde la trace de l'appel).
CREATE TABLE IF NOT EXISTS call_recordings_metadata (
  id                          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  call_log_id                 TEXT,                        -- FK applicative → call_logs.id
  client_id                   TEXT,                        -- tenant propriétaire (bornage)
  recording_sid               TEXT,                        -- REcXXX Twilio
  r2_key                      TEXT,                        -- clé R2 audio (mirror call_logs.recording_r2_key)
  duration_sec                INTEGER,                     -- durée enregistrement
  size_bytes                  INTEGER,                     -- taille audio (R2 metadata)
  consent_obtained_at         TEXT,                        -- ISO 8601 du consentement
  consent_method              TEXT,                        -- 'twiml_say_dtmf'|'lead_preconsent'|'agent_attest' (HANDLER validé)
  retention_days              INTEGER DEFAULT 90,          -- politique Intralys (override possible par tenant settings)
  deleted_at                  TEXT,                        -- timestamp ISO suppression côté Intralys (R2 + DB row)
  twilio_deleted_at           TEXT,                        -- timestamp ISO suppression confirmée côté Twilio (DELETE Recordings/{Sid}.json)
  created_at                  TEXT DEFAULT (datetime('now'))
);

-- Indexes ADDITIFS idempotents — chemins chauds Phase B :
--   - listing VoicemailInbox borné tenant trié created_at DESC
CREATE INDEX IF NOT EXISTS idx_voicemails_client          ON voicemails(client_id, created_at);
--   - jointure call_log ↔ voicemail (timeline call detail Phase C)
CREATE INDEX IF NOT EXISTS idx_voicemails_call_log        ON voicemails(call_log_id);
--   - jointure lead ↔ voicemails (filtre voicemails par fiche lead)
CREATE INDEX IF NOT EXISTS idx_voicemails_lead            ON voicemails(lead_id);
--   - jointure call_log ↔ recording_metadata (audit RGPD par appel)
CREATE INDEX IF NOT EXISTS idx_call_recordings_metadata_call_log ON call_recordings_metadata(call_log_id);
--   - lookup webhook recording-status-callback par recording_sid Twilio
CREATE INDEX IF NOT EXISTS idx_call_recordings_metadata_sid      ON call_recordings_metadata(recording_sid);

-- NB : 6 ALTER ADD COLUMN (NULLABLES, sans DEFAULT non-NULL, sans CHECK), 2
-- CREATE TABLE IF NOT EXISTS, 5 CREATE INDEX IF NOT EXISTS. AUCUN CHECK,
-- AUCUNE FK, AUCUN DROP / RENAME / rebuild / CREATE TABLE call_logs.
-- recording_url / transcription / disposition / notes NON re-ajoutées (seq
-- 102/116). transcription_status + transcription_lang + consent_method
-- validés HANDLER (whitelist JS). UPDATE/DELETE bornés tenant (client_id
-- résolu serveur, JAMAIS body). AUCUN touch ivr_menus / leads / tasks /
-- activity_log / clients / users / tables E4/E6. Capabilities leads.write
-- (outbound/voicemail listen) / settings.manage (recording RGPD delete) +
-- ALL_CAPABILITIES seq80 RÉUTILISÉES — ZÉRO ajout. Choix figés
-- docs/LOT-TWILIO-VOICE-S34.md §6.
