# TwiML Webhooks Twilio — Sprint 34

> Référence technique des 4 webhooks PUBLICS Twilio Voice introduits par le Sprint 34 (signature, format, cycle de vie complet, configuration Twilio Console, tests curl, erreurs courantes).
> Date : 2026-05-24. Version : 1.0. Sprint : 34.
> Compagnon de [`LOT-TWILIO-VOICE-S34.md`](LOT-TWILIO-VOICE-S34.md) §3 / §6.4 + [`RGPD-CALL-RECORDINGS-S34.md`](RGPD-CALL-RECORDINGS-S34.md).

## §1 URLs publiques

4 webhooks PUBLICS (hors-`requireAuth`) câblés dans [`src/worker.ts`](../src/worker.ts) l.956-971. Tous bornés par signature Twilio (`verifyTwilioSignature`). Tous implémentés dans [`src/worker/twilio-twiml.ts`](../src/worker/twilio-twiml.ts).

| Méthode | Endpoint | Description | Réponse |
|---|---|---|---|
| `POST` | `/api/twilio/twiml/voice` | TwiML d'accueil pour un appel ENTRANT. Résout l'agent à dial via `sub_accounts.twilio_phone`, retourne `<Dial>` avec recording dual-channel + transcription, sinon fallback `<Redirect>` voicemail. | `text/xml 200` |
| `POST` | `/api/twilio/twiml/voicemail` | TwiML `<Say>` consent CRTC + `<Record maxLength=120>` + `transcribe=true`. Déclenche la cascade recording-status + transcription. | `text/xml 200` |
| `POST` | `/api/twilio/twiml/recording-status` | Callback Twilio quand l'enregistrement passe `in-progress \| completed \| failed \| absent`. Si `completed` → fetch R2 + UPDATE `call_logs` + INSERT `call_recordings_metadata` OR INSERT `voicemails`. | `text/plain 200 OK` |
| `POST` | `/api/twilio/twiml/transcription-callback` | Callback Twilio quand la transcription native (`transcribe=true`) est complétée. UPDATE `call_logs.transcription` + `voicemails.transcription`. | `text/plain 200 OK` |

**Conventions de réponse** :
- TwiML handlers (voice + voicemail) → `text/xml 200` avec corps `<?xml…?><Response>…</Response>`. Sur erreur interne, fallback TwiML `<Say>…</Say><Hangup/>` — JAMAIS de 500 vers Twilio.
- Status callbacks (recording + transcription) → `'OK' 200` toujours, même en cas d'erreur DB (Twilio retry sur 5xx — best-effort cross-system avec idempotence par `recording_sid` unique).

## §2 Format X-Twilio-Signature

Twilio signe chaque webhook avec HMAC-SHA1 du body form-urlencoded, en utilisant l'AUTH_TOKEN du compte comme clé. La signature est envoyée dans l'en-tête `X-Twilio-Signature` (base64).

**Algorithme** :

1. Construire la chaîne à signer = **URL absolue du webhook** (avec query string si présent) + concaténation des paires `${key}${value}` triées alphabétiquement par clé.
2. HMAC-SHA1 de la chaîne avec `TWILIO_AUTH_TOKEN` comme clé secrète.
3. Encoder en base64.
4. Comparer à `X-Twilio-Signature` reçu (constant-time comparison).

**Exemple** :

```
URL  : https://app.intralys.dev/api/twilio/twiml/recording-status
Body : RecordingSid=REc123&CallSid=CA456&RecordingStatus=completed

Tri alpha clés : CallSid, RecordingSid, RecordingStatus
String concat  : <URL> + "CallSid" + "CA456" + "RecordingSid" + "REc123" + "RecordingStatus" + "completed"
Signature      : base64(HMAC-SHA1(string, AUTH_TOKEN))
```

Référence officielle : [Twilio Security — Signature Validation](https://www.twilio.com/docs/usage/security#validating-requests).

## §3 Implémentation `verifyTwilioSignature`

Fichier : [`src/worker/twilio-verify.ts`](../src/worker/twilio-verify.ts) (Sprint Consolidation existant).

**Signature** :

```ts
export async function verifyTwilioSignature(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<boolean>;
```

**Comportement** :

- Si `env.TWILIO_AUTH_TOKEN` absent → **bypass = true** (mode dev / FLAG INACTIF). Permet le test local sans secrets.
- Sinon → enforcement strict : reconstruit la signature attendue + compare constant-time à `X-Twilio-Signature`. Retourne `true` si match, `false` sinon.

**Garde côté handler** ([`twilio-twiml.ts`](../src/worker/twilio-twiml.ts):62-72) :

```ts
async function ensureSignature(request, env, params): Promise<Response | null> {
  const valid = await verifyTwilioSignature(request, env, params);
  if (!valid && env.TWILIO_AUTH_TOKEN) {
    return new Response('Forbidden', { status: 403 });
  }
  return null;
}
```

- **Token configuré + signature invalide** → 403.
- **Token configuré + signature valide** → poursuite handler.
- **Token absent** (dev) → poursuite handler (bypass).

**Convention body** : le body form-urlencoded est lu UNE SEULE FOIS via `request.clone().formData()` pour construire `params {key:value}` (input `verifyTwilioSignature`). `verifyTwilioSignature` ne reconsomme PAS le body original (contrat Phase A — [twilio-verify.ts:34](../src/worker/twilio-verify.ts)).

## §4 Configuration Twilio Console

Pour chaque numéro Twilio acheté par un tenant Intralys :

### 4.1 Phone Number → Voice configuration

| Champ Twilio Console | Valeur |
|---|---|
| **A Call Comes In** | Webhook : `https://<intralys-domain>/api/twilio/twiml/voice` — **HTTP POST** |
| **Primary Handler Fails** | Webhook : `https://<intralys-domain>/api/twilio/twiml/voicemail` — **HTTP POST** (fallback voicemail direct) |
| **Caller Name Lookup** | Optional — désactivé par défaut (économie) |

### 4.2 Status Callback (cross-call)

Configuré au niveau du Phone Number Voice settings :

| Champ | Valeur |
|---|---|
| **Call Status Changes** | `https://<intralys-domain>/api/calls/status-callback` (existant — seq102 `handleCallStatusCallback`) |
| **Events** | `initiated`, `ringing`, `answered`, `completed` |

### 4.3 Recording Status Callback (inline TwiML)

PAS configuré au niveau du Phone Number — injecté INLINE dans le TwiML retourné par `/api/twilio/twiml/voice` et `/api/twilio/twiml/voicemail` :

```xml
<Dial record="record-from-answer-dual"
      recordingStatusCallback="https://<domain>/api/twilio/twiml/recording-status"
      recordingStatusCallbackMethod="POST"
      transcribe="true"
      transcribeCallback="https://<domain>/api/twilio/twiml/transcription-callback"
      timeout="30">
  <Number>+15145559999</Number>
</Dial>
```

Justification : chaque appel peut router vers un agent différent → le callback est dérivé de `request.url` côté worker (via `getOrigin(request)` [twilio-twiml.ts:76-83](../src/worker/twilio-twiml.ts)), pas hardcodé Console.

### 4.4 Transcription Callback (inline TwiML)

Idem : injecté inline via `transcribeCallback="…"` sur `<Dial>` et `<Record>`. Pas de configuration Console.

## §5 Tests curl

### 5.1 Voice webhook (inbound call simulation)

```bash
BASE="https://app.intralys.dev"
curl -X POST "$BASE/api/twilio/twiml/voice" \
  -H "X-Twilio-Signature: <signature-base64>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=CA123abc&From=%2B15145551234&To=%2B15145559999&CallStatus=ringing"
```

**Réponse attendue** (200) :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="fr-CA">Bonjour, votre appel est important. Veuillez patienter.</Say>
  <Dial record="record-from-answer-dual"
        recordingStatusCallback="https://app.intralys.dev/api/twilio/twiml/recording-status"
        transcribe="true"
        transcribeCallback="https://app.intralys.dev/api/twilio/twiml/transcription-callback"
        timeout="30">
    <Number>+15145557777</Number>
  </Dial>
  <Redirect method="POST">https://app.intralys.dev/api/twilio/twiml/voicemail</Redirect>
</Response>
```

### 5.2 Voicemail TwiML (no-agent fallback)

```bash
curl -X POST "$BASE/api/twilio/twiml/voicemail" \
  -H "X-Twilio-Signature: <signature-base64>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=CA123abc&From=%2B15145551234&To=%2B15145559999"
```

### 5.3 Recording status callback (simulate Twilio completed)

```bash
curl -X POST "$BASE/api/twilio/twiml/recording-status" \
  -H "X-Twilio-Signature: <signature-base64>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "RecordingSid=REc789&CallSid=CA123abc&RecordingStatus=completed&RecordingDuration=45&RecordingUrl=https%3A%2F%2Fapi.twilio.com%2F2010-04-01%2FRecordings%2FREc789"
```

**Réponse attendue** : `OK` (text/plain 200).

### 5.4 Transcription callback (simulate Twilio completed)

```bash
curl -X POST "$BASE/api/twilio/twiml/transcription-callback" \
  -H "X-Twilio-Signature: <signature-base64>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "RecordingSid=REc789&CallSid=CA123abc&TranscriptionStatus=completed&TranscriptionText=Bonjour+je+rappelle+au+sujet+du+pret+hypothecaire"
```

### 5.5 Mode dev sans signature

En l'absence de `TWILIO_AUTH_TOKEN` configuré côté worker (ex `.dev.vars` local sans secret), la signature est bypassée :

```bash
curl -X POST "http://localhost:8787/api/twilio/twiml/voice" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=CA-test&From=%2B15140000000&To=%2B15145559999"
```

→ TwiML retourné normalement (mode dev).

## §6 Cycle complet — outbound call enregistré

Workflow numéroté de bout en bout, agent → lead avec consentement obtenu :

1. **Agent clique « Appeler »** dans `OutboundCallButton.tsx` (Phase C) avec checkbox « Enregistrer » + bouton « J'atteste consent ».
2. **`POST /api/calls/outbound`** (authed, cap `leads.write`) avec body `{ to: '+15145551234', lead_id, record: true, consent_obtained: true, consent_method: 'agent_attest' }`.
3. **Handler `handleInitiateOutboundCall`** :
   - Validation cap + consent_obtained=true.
   - INSERT `call_logs` avec status='ringing', direction='outbound', `recording_consent_obtained_at = datetime('now')`, `consent_method='agent_attest'`.
   - Call Twilio REST API `POST /2010-04-01/Accounts/{Sid}/Calls.json` avec `From=TWILIO_PHONE_NUMBER`, `To=+15145551234`, `Url=https://app.intralys.dev/api/twilio/twiml/voice?outbound=1`, `Record=true`, `RecordingStatusCallback=…/recording-status`, `RecordingChannels=dual`.
   - Retour `{ data: { call_sid: 'CA...', status: 'ringing' } }`.
4. **Twilio dial `To`**, le lead décroche → recording démarre (`Record=true`).
5. **Fin de l'appel** → Twilio envoie deux callbacks asynchrones :
   - `POST /api/calls/status-callback` (existant seq102) → UPDATE `call_logs.status='completed'`, `duration_sec=120`.
   - `POST /api/twilio/twiml/recording-status` avec `RecordingStatus=completed`, `RecordingDuration=120`, `RecordingUrl=…`, `RecordingSid=REc...`.
6. **Handler `handleTwilioRecordingStatusCallback`** ([twilio-twiml.ts:215-399](../src/worker/twilio-twiml.ts)) :
   - Verify signature.
   - Lookup `call_log` par `twilio_sid=CallSid`.
   - `fetchRecording(env, recording_sid)` → download Twilio Basic Auth → buffer.
   - `env.FILES.put(r2Key, buffer, { httpMetadata: { contentType: 'audio/mpeg' } })` avec `r2Key = voice/{client_id}/{call_log_id}/{recording_sid}.mp3`.
   - UPDATE `call_logs` : `recording_sid`, `recording_url`, `recording_r2_key`, `recording_duration_sec=120`, `transcription_status='pending'`, `recording_consent_obtained_at` coalesce.
   - INSERT `call_recordings_metadata` (audit RGPD + retention 90j, `consent_method='twiml_callback'`).
7. **Whisper Transcribe** (background, Phase B agent A3 — voice.ts:64-94) → POST `/api/twilio/twiml/transcription-callback` avec texte transcrit.
8. **Handler `handleTwilioTranscriptionCallback`** ([twilio-twiml.ts:417-507](../src/worker/twilio-twiml.ts)) :
   - Verify signature.
   - UPDATE `call_logs SET transcription=?, transcription_status='done', transcription_lang='fr' WHERE recording_sid=? OR twilio_sid=?`.
9. **Frontend `RecordingPlayer.tsx`** (Phase C) → `GET /api/calls/:id/recording-url` (authed) → reçoit URL R2 signée HMAC TTL 1h → `<audio src="…">` playable.

## §7 Cycle complet — voicemail entrant (no-agent)

1. **Lead appelle le numéro Twilio du tenant**.
2. **Twilio POST `/api/twilio/twiml/voice`** avec `From`, `To`, `CallSid`.
3. **Handler `handleTwilioVoiceTwiml`** :
   - Verify signature.
   - Lookup agent à dial via `sub_accounts.twilio_phone` + `users.phone`.
   - **Aucun agent dispo** → retourne TwiML `<Say>…</Say><Redirect>…/voicemail</Redirect>`.
4. **Twilio suit le Redirect** → `POST /api/twilio/twiml/voicemail`.
5. **Handler `handleTwilioVoicemailTwiml`** émet :

```xml
<Response>
  <Say voice="alice" language="fr-CA">Cet appel sera enregistré pour le service à la clientèle. Restez en ligne pour l'accepter ou raccrochez maintenant. Au signal sonore, veuillez laisser votre message après le bip.</Say>
  <Record maxLength="120" playBeep="true"
          transcribe="true"
          transcribeCallback="…/transcription-callback"
          recordingStatusCallback="…/recording-status" />
  <Say voice="alice" language="fr-CA">Merci, au revoir.</Say>
</Response>
```

6. **Lead laisse le message** → Twilio enregistre 0-120s → POST `/api/twilio/twiml/recording-status` avec `RecordingStatus=completed`.
7. **Handler `handleTwilioRecordingStatusCallback`** :
   - PAS de `call_log` matchant `twilio_sid=CallSid` (voicemail direct).
   - Résolution `voicemailClientId` best-effort via `to_number` → `clients.phone` OR `sub_accounts.twilio_phone`.
   - INSERT `voicemails` : `client_id`, `from_number`, `to_number`, `recording_url`, `recording_sid`, `recording_r2_key`, `duration_sec`, `transcription_status='pending'`, `created_at=now`.
8. **Twilio transcribe native** → `POST /api/twilio/twiml/transcription-callback` (best-effort fr-CA).
9. **Handler `handleTwilioTranscriptionCallback`** → `UPDATE voicemails SET transcription=?, transcription_status='done' WHERE recording_sid=?`.
10. **Frontend `VoicemailInbox.tsx`** (Phase C) → `GET /api/voicemails?unread=true` → liste avec badge + RecordingPlayer + bouton « Marquer écouté » + (admin) bouton « Supprimer (RGPD) ».

## §8 Erreurs courantes

| Symptôme | Cause probable | Fix |
|---|---|---|
| **403 sur `/api/twilio/twiml/*`** | `X-Twilio-Signature` invalide : URL absolue côté worker ≠ URL configurée Twilio Console (ex Cloudflare proxy modifie le host). | Vérifier que `request.url` côté worker reflète l'URL publique exacte (sans suffix `?proxy=…`). Vérifier que `TWILIO_AUTH_TOKEN` côté worker = celui du compte Twilio actif. |
| **200 mais R2 upload silently fails** | `env.FILES` non bindé dans `wrangler.jsonc` OU bucket inexistant. | Vérifier `wrangler.jsonc` : `[[r2_buckets]] binding="FILES" bucket_name="intralys-files"`. Run `wrangler r2 bucket list` pour confirmer. |
| **Whisper 401 (transcription jamais done)** | `OPENAI_API_KEY` absente ou révoquée. | `wrangler secret put OPENAI_API_KEY`. Si refus client (data residency UE), accepter `transcription_status='skipped'`. |
| **Recording_status callback retry boucle** | Handler retourne 5xx au lieu de `OK 200`. | Vérifier que TOUTES les branches retournent `new Response('OK', { status: 200 })`, même en cas d'erreur DB (idempotence par `recording_sid` unique). |
| **Recording = NULL après appel terminé** | `Record=true` PAS positionné côté outbound API call OR consent absent → garde backend a refusé. | Vérifier body `POST /api/calls/outbound` : `record:true` + `consent_obtained:true`. Vérifier `call_logs.recording_consent_obtained_at IS NOT NULL` AVANT le start. |
| **Voicemail inbox vide alors que Twilio a enregistré** | Voicemail orphelin : `to_number` ne matche aucun `clients.phone` ni `sub_accounts.twilio_phone` → `voicemails.client_id=NULL`, exclu du listing tenant. | Vérifier que le numéro Twilio est référencé dans une des deux tables. Si client neuf : INSERT `sub_accounts (client_id, twilio_phone)` ou UPDATE `clients.phone`. |
| **`<Dial>` ne ring pas l'agent** | `users.phone` du tenant vide OR mal formaté (non-E.164). | Vérifier `SELECT phone FROM users WHERE client_id=?` — doit être E.164 (`+15145559999`). |
| **TwiML `<Say>` voix wrong language** | `language="fr-CA"` non supporté → fallback en-US. | Twilio supporte `fr-CA`, `fr-FR`. Voir [Twilio TTS voices](https://www.twilio.com/docs/voice/twiml/say/text-speech). |

## §9 Variables d'environnement requises

Rappel — détail complet dans [`RGPD-CALL-RECORDINGS-S34.md`](RGPD-CALL-RECORDINGS-S34.md) §8.

| Variable | Usage webhook | Si absente |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Basic Auth pour `fetchRecording` + `deleteTwilioRecording` REST API | `fetchRecording` retourne `{ mock: true }` ; recording_r2_key reste NULL |
| `TWILIO_AUTH_TOKEN` | Vérification signature webhooks + Basic Auth REST API | Bypass signature (mode dev) ; warning si prod |
| `TWILIO_PHONE_NUMBER` | from_number par défaut outbound | Outbound impossible (handler retourne `{ mock: true }`) |
| `OPENAI_API_KEY` | Whisper transcription (voice.ts:64-94) | Transcription Twilio native uniquement (qualité variable fr-CA) |
| `FILES` | R2 binding pour `env.FILES.put(r2Key, buffer)` | Upload silently skipped, `recording_r2_key=NULL`, fallback Twilio URL brute |
| `TOKEN_KEY` | HMAC pour URLs R2 signées (`getSignedR2Url`) | Frontend ne peut pas streamer audio → 500 sur `GET /api/calls/:id/recording-url` |

## §10 Limitations / TODO

- **Pas de gestion appels conférence multi-party**. `<Conference>` + recording multi-channel non implémentés Sprint 34. Si besoin (ex courtier + lead + assureur en 3-way), Sprint v2.
- **Pas d'IVR dynamique avancé**. L'IVR statique existant (seq102 `ivr_menus` + `telephony.ts:handleVoiceIvrTwiml`) couvre les menus pré-enregistrés. Pas de routing IA / NLU / branching dynamique Sprint 34.
- **Whisper US-only data residency**. Si client UE refuse OpenAI US → désactiver `OPENAI_API_KEY` → fallback Twilio transcribe native fr-CA (qualité médiocre, cf. §8). Cf. [`RGPD-CALL-RECORDINGS-S34.md`](RGPD-CALL-RECORDINGS-S34.md) §10.
- **Pas d'idempotence stricte côté handler recording-status**. Si Twilio retry avec même `recording_sid`, le 2e callback re-UPDATE `call_logs` (idempotent par `WHERE recording_sid=?` unique) MAIS re-INSERT `call_recordings_metadata` (pas de UNIQUE constraint sur `recording_sid` dans cette table). Volume marginal, accepté Sprint 34. TODO : ajouter `INSERT OR IGNORE` ou contrainte UNIQUE Sprint v2.
- **Pas de handshake validation initiale**. Twilio n'expose pas d'endpoint de validation au moment de la configuration du webhook (contrairement à Slack). La première vraie requête signée valide le setup. Test recommandé : appel test depuis un numéro perso + vérification `audit_log`.
- **Pas d'anti-replay nonce/timestamp**. La signature Twilio HMAC-SHA1 n'inclut pas de nonce — un attaquant qui capte une signature valide peut la rejouer indéfiniment tant que l'URL + body identiques. Mitigation : HTTPS obligatoire + idempotence par `recording_sid` (un replay sur recording-status est no-op).
- **Pas de test webhooks local automatisé**. Recommandé pour Sprint 24 : ngrok tunnel + Twilio CLI `twilio phone-numbers:update --voice-url=https://abc.ngrok.io/api/twilio/twiml/voice` + tests E2E sur `bun run dev`. Pour l'instant : tests unitaires + curl manuel §5.
- **Cron retention auto pas câblé**. Cf. [`RGPD-CALL-RECORDINGS-S34.md`](RGPD-CALL-RECORDINGS-S34.md) §10 — TODO Sprint 24 Observabilité.

---

**Cross-references** :
- [`LOT-TWILIO-VOICE-S34.md`](LOT-TWILIO-VOICE-S34.md) — contrat Sprint 34 §3 (routes) + §6.4 (signatures handlers)
- [`RGPD-CALL-RECORDINGS-S34.md`](RGPD-CALL-RECORDINGS-S34.md) — consent + retention + cascade delete
- [`src/worker/twilio-twiml.ts`](../src/worker/twilio-twiml.ts) — 4 handlers publics
- [`src/worker/twilio-verify.ts`](../src/worker/twilio-verify.ts) — `verifyTwilioSignature` + `detectStopKeyword`
- [`src/worker/lib/twilio-voice.ts`](../src/worker/lib/twilio-voice.ts) — `fetchRecording`, `buildR2RecordingKey`, `getSignedR2Url`, `deleteTwilioRecording`
- [`migration-twilio-voice-seq129.sql`](../migration-twilio-voice-seq129.sql) — DDL `voicemails` + `call_recordings_metadata` + 6 colonnes `call_logs`
- [Twilio Security — Signature Validation](https://www.twilio.com/docs/usage/security#validating-requests)
- [Twilio TwiML `<Record>`](https://www.twilio.com/docs/voice/twiml/record)
- [Twilio TwiML `<Dial>`](https://www.twilio.com/docs/voice/twiml/dial)
