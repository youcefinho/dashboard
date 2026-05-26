# LOT Twilio Voice — Sprint 34

> Doc contrat §6 FIGÉ. Migration : seq129 — `migration-twilio-voice-seq129.sql`.
> Compagnons : `LOT-TELEPHONY-F.md` (seq102 — call_logs + ivr_menus + placeCall flag inactif + click-to-call + IVR TwiML + status callback), `LOT-TELEPHONY-DISPOSITION.md` (seq116 — disposition + notes ADDITIFS sur call_logs), `LOT-CALENDAR-SYNC-S33.md` (seq128 — chaînage séquentiel précédent), `RGPD-CALL-RECORDINGS-S34.md` (politique consent bi-party CRTC + retention 90j + cascade delete — squelette posé Phase A, rempli C4 Phase B), `TWIML-WEBHOOKS-S34.md` (réf webhooks + signature Twilio + handshake — squelette posé Phase A, rempli C4 Phase B).

## §1 Contexte

La téléphonie 2-way existe DÉJÀ (seq102 + seq116) :

- `call_logs` (entrants + sortants) + `ivr_menus` + `telephony.ts:placeCall` FLAG INACTIF + `handlePlaceCall` click-to-call + `handleGetCallLogs` journal + filtres + `handleVoiceIvrTwiml` + `handleCallStatusCallback` (+ recording_url + transcription Whisper voice.ts:64-94).
- `disposition` + `notes` ADDITIFS sur call_logs (seq116) + filtre `?disposition=` + tâche auto sur appel manqué (no-answer/failed/busy).
- UI journal + click-to-call dans `LeadDetail.tsx` + `TelephonySettings` + 17 clés `telephony.*` ×4 catalogues.

**Gaps comblés par Sprint 34** :

1. **Enregistrement opt-in mid-call** avec consentement bi-party CRTC (Code criminel art. 184, loi C-29) — actuellement le recording n'est posé QUE si Twilio l'envoie automatiquement via le webhook status-callback, sans contrôle agent et sans consent tracé.
2. **Boîte vocale structurée** (voicemails table) — actuellement les messages vocaux sont juste un INSERT dans `messages` (voice.ts:97-103) sans cycle de vie listened_at / deleted_at, sans listing UI dédié, sans cascade delete RGPD.
3. **Audio R2 + URL signée** — actuellement on stocke juste `recording_url` brut Twilio (révoqué après 30j retention Twilio). Cette URL n'est pas streamable côté frontend (pas d'auth, pas de signing).
4. **RGPD/CRTC compliance** — actuellement aucun audit consent + aucun cascade delete + aucune retention policy. Nécessaire avant tout déploiement Québec.
5. **Page outbound dédiée** + UI VoicemailInbox + RecordingPlayer (Phase C composants Manager-C).

## §2 Migration seq129 (DDL résumé)

100% ADDITIF — `ALTER TABLE call_logs ADD COLUMN` ×6 (NULLABLES, sans DEFAULT non-constant, sans CHECK) + `CREATE TABLE IF NOT EXISTS` ×2 + `CREATE INDEX IF NOT EXISTS` ×5.

| Élément | Détails |
|---|---|
| `call_logs.recording_sid` | TEXT — SID Twilio REcXXX pour cascade delete + lookup webhook |
| `call_logs.recording_duration_sec` | INTEGER — durée enregistrement (≠ duration_sec appel total) |
| `call_logs.recording_r2_key` | TEXT — clé R2 audio post-download |
| `call_logs.transcription_status` | TEXT — enum HANDLER : `pending\|done\|failed\|skipped` |
| `call_logs.transcription_lang` | TEXT — BCP-47 validé HANDLER |
| `call_logs.recording_consent_obtained_at` | TEXT — ISO 8601 du consent bi-party CRTC |
| `voicemails` | id, client_id, agency_id, call_log_id, lead_id, conversation_id, from/to_number, recording_url, recording_sid, recording_r2_key, duration_sec, transcription, transcription_status, transcription_lang, listened_at, listened_by, deleted_at, created_at |
| `call_recordings_metadata` | id, call_log_id, client_id, recording_sid, r2_key, duration_sec, size_bytes, consent_obtained_at, consent_method, retention_days (90), deleted_at, twilio_deleted_at, created_at |
| Indexes | idx_voicemails_client(client_id, created_at), idx_voicemails_call_log, idx_voicemails_lead, idx_call_recordings_metadata_call_log, idx_call_recordings_metadata_sid |

Manifest entrée seq129, `depends_on: [seq102, seq116, seq128]`. ZÉRO FK, ZÉRO CHECK, ZÉRO DROP/RENAME, ZÉRO rebuild.

## §3 Routes (4 PUBLIC + 8 AUTHED)

**PUBLIC (hors-try, AVANT `requireAuth`)** — webhooks Twilio (signature vérifiée DANS handler via `verifyTwilioSignature` twilio-verify.ts) :

| Méthode | Path | Handler | Module |
|---|---|---|---|
| POST | `/api/twilio/twiml/voice` | `handleTwilioVoiceTwiml` | `twilio-twiml.ts` |
| POST | `/api/twilio/twiml/voicemail` | `handleTwilioVoicemailTwiml` | `twilio-twiml.ts` |
| POST | `/api/twilio/twiml/recording-status` | `handleTwilioRecordingStatusCallback` | `twilio-twiml.ts` |
| POST | `/api/twilio/twiml/transcription-callback` | `handleTwilioTranscriptionCallback` | `twilio-twiml.ts` |

**AUTHED (post-`requireAuth`)** — capabilities RÉUTILISÉES seq80 (zéro ajout) :

| Méthode | Path | Handler | Module | Cap |
|---|---|---|---|---|
| POST | `/api/calls/outbound` | `handleInitiateOutboundCall` | `calls-outbound.ts` | `leads.write` |
| POST | `/api/calls/:id/record` | `handleToggleCallRecording` | `calls-outbound.ts` | `leads.write` |
| GET | `/api/calls/:id/recording-url` | `handleGetRecordingSignedUrl` | `calls-outbound.ts` | `leads.write` |
| DELETE | `/api/calls/:id/recording` | `handleDeleteCallRecording` | `calls-outbound.ts` | `settings.manage` |
| GET | `/api/voicemails` | `handleListVoicemails` | `voicemails.ts` | `leads.write` |
| GET | `/api/voicemails/:id` | `handleGetVoicemail` | `voicemails.ts` | `leads.write` |
| POST | `/api/voicemails/:id/listen` | `handleMarkVoicemailListened` | `voicemails.ts` | `leads.write` |
| DELETE | `/api/voicemails/:id` | `handleDeleteVoicemail` | `voicemails.ts` | `settings.manage` |

Anti-shadowing : `/api/calls/:id/disposition` (seq116) + `/api/calls/:id/record` + `/api/calls/:id/recording-url` + `/api/calls/:id/recording` ont des suffixes distincts ⇒ aucun chevauchement regex. `/api/voicemails/:id/listen` déclaré AVANT `/api/voicemails/:id` (GET + DELETE) pour anti-shadowing du `[^/]+` générique qui matcherait `xxx/listen`.

## §4 Handlers (4 fichiers, signatures FIGÉES)

| Fichier | Handlers | Phase B owner |
|---|---|---|
| `src/worker/lib/twilio-voice.ts` | `escapeXml`, `isTwilioConfigured`, `buildRecordingR2Key`, `initiateOutboundCall`, `startCallRecording`, `stopCallRecording`, `downloadRecordingToR2`, `getSignedR2Url`, `deleteTwilioRecording`, `deleteR2Recording`, `transcribeRecording`, `generateOutboundDialTwiml`, `generateVoicemailTwiml` | A2 + A3 + C4 |
| `src/worker/twilio-twiml.ts` | `handleTwilioVoiceTwiml`, `handleTwilioVoicemailTwiml`, `handleTwilioRecordingStatusCallback`, `handleTwilioTranscriptionCallback` | A2 + A3 + A4 |
| `src/worker/calls-outbound.ts` | `handleInitiateOutboundCall`, `handleToggleCallRecording`, `handleGetRecordingSignedUrl`, `handleDeleteCallRecording` | A2 + A3 + C4 |
| `src/worker/voicemails.ts` | `handleListVoicemails`, `handleGetVoicemail`, `handleMarkVoicemailListened`, `handleDeleteVoicemail` | A4 + C4 |

Tous les handlers retournent `json({ error: 'Phase B not yet implemented' }, 501)` après la garde capability — Phase B remplit le corps RÉEL. Signatures TypeScript verrouillées Phase A (worker.ts les câble par nom).

## §5 Frontend components (4 fichiers Phase B)

Skeletons à créer dans `src/components/voice/` (Phase C Manager-C remplira) :

- **`OutboundCallButton.tsx`** — CTA Appeler sur fiche lead + option toggle "Enregistrer cet appel" (modal consent CRTC obligatoire). Appelle `initiateOutboundCall({ to, lead_id, record, consent_obtained })`. États : idle / calling / success (toast i18n) / mock / failed / consent_required (modal).
- **`RecordingControls.tsx`** — barre de contrôle d'enregistrement mid-call (Start/Stop) avec affichage du timer recording_duration_sec. Bouton uniquement actif si call_log.status === 'in-progress' && recording_consent_obtained_at !== null. Appelle `toggleCallRecording(id, enable)`.
- **`RecordingPlayer.tsx`** — lecteur audio HTML5 + transcript (collapsible). Appelle `getCallRecordingUrl(id)` pour récupérer la signed R2 URL TTL 1h. Bouton "Supprimer (RGPD)" pour admin (cap settings.manage côté worker → 403 sinon).
- **`VoicemailInbox.tsx`** — page dédiée + widget LeadDetail. Liste paginée `getVoicemails({ unread, lead_id, limit })`, badge unread count, filtres (unread only / par lead). Click row → modal détail avec RecordingPlayer + bouton "Marquer écouté" (`markVoicemailListened`) + "Supprimer" (admin uniquement).

## §6 SCOPE FIGÉ (inter-agent contracts complets, signatures verrouillées)

### §6.1 Contrats apiFetch / ApiResponse (GELÉS — JAMAIS `code`)

Toutes les routes AUTHED suivent le contrat figé Sprint S1 :

- Succès : `json({ data: T })` — 200 OK.
- Erreur : `json({ error: string }, status)` — 4xx/5xx, JAMAIS de champ `code`.
- Validation HANDLER (whitelist JS) — JAMAIS de CHECK SQL. Hors whitelist ⇒ 400 `{ error: '...' }`.
- Bornage tenant STRICT côté handler : `resolveClientId(env, auth)` (calque `telephony.ts:185-195`), UPDATE/DELETE `WHERE id=? AND client_id=?`. JAMAIS `client_id` depuis le body.

### §6.2 FLAG INACTIF Twilio (calque sendSms + placeCall)

Pattern verrouillé pour TOUTES les fonctions library qui appellent l'API Twilio réelle :

```ts
export async function fnName(env: Env, ...): Promise<TwilioVoiceResult<T>> {
  if (!isTwilioConfigured(env)) {
    return { success: false, mock: true };
  }
  // ... vrai appel réseau
}
```

`isTwilioConfigured = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER)`.

Les handlers (calls-outbound.ts / voicemails.ts) doivent gérer le retour `{ mock: true }` en INSÉRANT le call_log / voicemail row QUAND MÊME (avec status='mock' / recording_sid=NULL) pour préserver le wiring CRM testable sans credentials.

### §6.3 Library `lib/twilio-voice.ts` — 13 exports

Signatures FIGÉES Phase A (Phase B remplit corps) :

```ts
// Helpers purs (Phase A complet)
export function escapeXml(input: string): string;
export function isTwilioConfigured(env: Env): boolean;
export function buildRecordingR2Key(clientId: string, callLogId: string, recordingSid: string): string;

// API Twilio (Phase B fills body, FLAG INACTIF mock si pas de credentials)
export async function initiateOutboundCall(env, payload): Promise<TwilioVoiceResult<{ callSid; status }>>;
export async function startCallRecording(env, payload): Promise<TwilioVoiceResult<{ recordingSid }>>;
export async function stopCallRecording(env, callSid, recordingSid): Promise<TwilioVoiceResult<void>>;
export async function downloadRecordingToR2(env, recordingUrl, r2Key): Promise<TwilioVoiceResult<{ r2Key; sizeBytes }>>;
export async function getSignedR2Url(env, r2Key, ttlSec?): Promise<TwilioVoiceResult<{ url; expiresAt }>>;
export async function deleteTwilioRecording(env, recordingSid): Promise<TwilioVoiceResult<void>>;
export async function deleteR2Recording(env, r2Key): Promise<TwilioVoiceResult<void>>;
export async function transcribeRecording(env, audioUrlOrR2Key, lang?): Promise<TwilioVoiceResult<{ text; lang? }>>;

// TwiML générateurs purs (Phase B fills body)
export function generateOutboundDialTwiml(payload): string;
export function generateVoicemailTwiml(greeting, consentNotice, callback?): string;
```

`TwilioVoiceResult<T>` = `{ success: boolean; sid?: string; mock?: boolean; error?: string; data?: T }`.

### §6.4 Handlers PUBLICS `twilio-twiml.ts` — 4 webhooks

Signatures FIGÉES :

```ts
export async function handleTwilioVoiceTwiml(request: Request, env: Env): Promise<Response>;
export async function handleTwilioVoicemailTwiml(request: Request, env: Env): Promise<Response>;
export async function handleTwilioRecordingStatusCallback(request: Request, env: Env): Promise<Response>;
export async function handleTwilioTranscriptionCallback(request: Request, env: Env): Promise<Response>;
```

Tous vérifient la signature Twilio via `verifyTwilioSignature` (twilio-verify.ts:37). TwiML handlers retournent `text/xml 200 OK`. Status callbacks retournent `'OK' 200` toujours (Twilio retry sur 5xx — best-effort).

### §6.5 Handlers AUTHED `calls-outbound.ts` — 4 handlers

Signatures FIGÉES (calque CapAuth type telephony.ts:69) :

```ts
export async function handleInitiateOutboundCall(request, env, auth): Promise<Response>;          // cap leads.write
export async function handleToggleCallRecording(request, env, auth, callLogId): Promise<Response>; // cap leads.write
export async function handleGetRecordingSignedUrl(env, auth, callLogId): Promise<Response>;        // cap leads.write
export async function handleDeleteCallRecording(env, auth, callLogId): Promise<Response>;          // cap settings.manage
```

### §6.6 Handlers AUTHED `voicemails.ts` — 4 handlers

Signatures FIGÉES :

```ts
export async function handleListVoicemails(env, auth, url): Promise<Response>;                  // cap leads.write
export async function handleGetVoicemail(env, auth, voicemailId): Promise<Response>;            // cap leads.write
export async function handleMarkVoicemailListened(env, auth, voicemailId): Promise<Response>;   // cap leads.write
export async function handleDeleteVoicemail(env, auth, voicemailId): Promise<Response>;         // cap settings.manage
```

### §6.7 Anti-loop guard & idempotence

- `handleMarkVoicemailListened` : `COALESCE(listened_at, datetime('now'))` côté UPDATE ⇒ idempotent (1er auditeur préservé).
- `handleDeleteVoicemail` + `handleDeleteCallRecording` : soft-delete (deleted_at = now) + cascade delete Twilio + R2 best-effort. Idempotent si appelé 2x (DELETE WHERE deleted_at IS NULL ⇒ changes=0 sur 2e appel).
- Recording webhooks Twilio sont retry-safe : on UPDATE `WHERE recording_sid = ?` qui est unique (anti-doublon).

### §6.8 Capabilities GELÉES seq80 — réutilisation only

| Capability | Routes |
|---|---|
| `leads.write` | outbound + toggle record + signed URL + voicemail list/get/listen |
| `settings.manage` | delete recording (RGPD) + delete voicemail (RGPD) |

ZÉRO ajout à `ALL_CAPABILITIES` (capabilities.ts:36-49).

## §7 RGPD / CRTC (consent bi-party, retention 90j, cascade delete)

**Politique consent bi-party (Code criminel canadien art. 184 + loi C-29 + RGPD/Loi 25 QC)** :

- Enregistrer un appel au Québec/Canada exige le consentement EXPLICITE des DEUX parties.
- Implémentation :
  - **Outbound** : agent coche "Enregistrer cet appel" + modal disclaimer + `consent_obtained=true` envoyé. Handler refuse `record=true` sans `consent_obtained=true` (`400 'consent_required'`).
  - **Inbound (voicemail)** : TwiML `<Say>` initial annonce `"Cet appel sera enregistré. Restez en ligne pour l'accepter ou raccrochez."` AVANT le `<Record>`. Le fait de rester en ligne = consent implicite documenté ISO 8601 dans `recording_consent_obtained_at`.
  - **Inbound (live agent)** : TwiML `<Say>` annonce + `<Gather numDigits=1>` "1 pour accepter, 2 pour refuser". DTMF=1 → consent + enregistrement démarre ; DTMF=2 → pas d'enregistrement, suite normale.
- Tous les consents sont tracés ISO 8601 dans `call_logs.recording_consent_obtained_at` + miroir dans `call_recordings_metadata.consent_obtained_at` + `consent_method` ∈ `{'twiml_say_dtmf', 'lead_preconsent', 'agent_attest'}`.

**Retention 90 jours (politique Intralys par défaut)** :

- `call_recordings_metadata.retention_days = 90` (DEFAULT 90, override possible par tenant settings Phase C).
- Cron quotidien (Phase B agent C4) : `DELETE FROM voicemails WHERE created_at < datetime('now', '-' || retention_days || ' days') AND deleted_at IS NULL` + cascade `deleteTwilioRecording` + `deleteR2Recording`.

**Cascade delete (right-to-erasure RGPD/Loi 25)** :

- `handleDeleteCallRecording` (admin) : `deleteTwilioRecording` + `deleteR2Recording` + UPDATE call_recordings_metadata + UPDATE call_logs.
- `handleDeleteVoicemail` (admin) : soft-delete voicemail + cascade vers recording_sid + recording_r2_key + call_log + call_recordings_metadata.
- Tous loggés `audit_log action='recording_deleted_rgpd' | 'voicemail_deleted_rgpd'` avec `user_id` traçable.

Détails complets : `docs/RGPD-CALL-RECORDINGS-S34.md` (rempli par agent C4 Phase B).

## §8 Variables d'env requises

| Variable | Statut | Usage |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | EXISTANTE (seq102) | API auth (FLAG INACTIF si absente) |
| `TWILIO_AUTH_TOKEN` | EXISTANTE (seq102 + twilio-verify) | API auth + signature webhooks (bypass si absente) |
| `TWILIO_PHONE_NUMBER` | EXISTANTE (seq102) | from_number par défaut |
| `OPENAI_API_KEY` | EXISTANTE (voice.ts:65) | Whisper transcription (optionnel, skip si absente) |
| `FILES` | EXISTANTE (seq11 LOT FILES) | R2 binding audio recordings |

ZÉRO nouvelle variable d'env. Tout est posé en flag inactif sans credentials (calque idiome `helpers.ts:sendSms:93-95`).

## Plan validation (12 étapes Chaman §6)

Checklist Rochdi après `wrangler deploy` Sprint 34 + secrets Twilio configurés :

1. **Migration seq129** appliquée : 3 nouvelles colonnes recording_* + 3 transcription_* + voicemails + call_recordings_metadata + 5 index visibles dans D1.
2. **Outbound mock (sans Twilio creds)** : POST `/api/calls/outbound` → call_log INSERT status='mock' + return `{ data: { mock: true, status: 'mock' } }`.
3. **Outbound réel (Twilio creds)** : POST `/api/calls/outbound { to, lead_id }` → appel Twilio passé, call_log status='ringing', twilio_sid présent.
4. **Recording toggle sans consent** : POST `/api/calls/:id/record { enable: true }` sur un call_log avec recording_consent_obtained_at NULL → 400 `'consent_required'`.
5. **Recording toggle avec consent** : POST outbound avec `record=true, consent_obtained=true` → call_log INSERT avec recording_consent_obtained_at présent + Twilio start recording.
6. **Recording status callback** : Twilio POST `/api/twilio/twiml/recording-status` après fin enregistrement → call_logs.recording_sid + recording_url + recording_r2_key remplis + voicemails OR call_recordings_metadata INSERT.
7. **Signed URL** : GET `/api/calls/:id/recording-url` → URL signée R2 TTL 1h playable depuis frontend.
8. **Whisper transcription** : background job → call_logs.transcription remplie + transcription_status='done'.
9. **Voicemail TwiML** : appel entrant → POST `/api/twilio/twiml/voicemail` → TwiML <Say>consent + <Record> retourné → recording capture → voicemails INSERT.
10. **Voicemail inbox** : GET `/api/voicemails?unread=true` → liste bornée tenant + transcript + audio_url signée.
11. **Mark listened** : POST `/api/voicemails/:id/listen` → listened_at = now() + listened_by = userId. Re-call idempotent (pas d'écrasement).
12. **RGPD delete** : DELETE `/api/voicemails/:id` (admin) → soft-delete + Twilio DELETE Recordings/{Sid}.json + R2 delete + call_recordings_metadata.deleted_at + audit_log entry.

Si tout est vert → Sprint 34 validé, rollout beta tenants avec Twilio account.

## Hors-scope (v2)

- **Power dialer** (queue auto sortants avec disposition rapide) → v2 (déjà déclaré hors scope LOT-TELEPHONY-F).
- **Coaching live** (whisper agent + barge admin) → v2.
- **Sentiment analysis** transcription (positif/négatif/neutre via OpenAI) → v2.
- **Multi-language voicemail greeting** par tenant settings (actuellement fr-CA par défaut) → v2.
- **Cron retention auto** (suppression automatique post-retention_days) → posé Phase B agent C4 mais documenté en mode preview (pas activé prod sans validation Rochdi).
- **Twilio native transcription** (`transcribe=true` sur <Record>) → handler posé mais désactivé par défaut (qualité fr-CA médiocre vs Whisper).

## Cross-references

- `LOT-TELEPHONY-F.md` (seq102) — call_logs base + placeCall flag + IVR + status callback
- `LOT-TELEPHONY-DISPOSITION.md` (seq116) — disposition + notes ADDITIFS
- `LOT-CALENDAR-SYNC-S33.md` (seq128) — chaînage manifest précédent
- `RGPD-CALL-RECORDINGS-S34.md` — politique consent + retention + cascade delete
- `TWIML-WEBHOOKS-S34.md` — réf webhooks + signature Twilio + handshake
- `migrations-manifest.json` seq129 — ordre canonique
- `src/worker/twilio-verify.ts` — verifyTwilioSignature + detectStopKeyword
- `src/worker/voice.ts` — voicemail entrant prod (INTOUCHÉ — préservé pour rétro-compat)
- `src/worker/telephony.ts` — placeCall + handleGetCallLogs + handleSetCallDisposition (INTOUCHÉ — extensions ADDITIVES via calls-outbound.ts)
