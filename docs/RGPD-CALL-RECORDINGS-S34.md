# RGPD / CRTC — Call Recordings (Sprint 34)

> Cartographie consent + retention + cascade delete pour les enregistrements d'appels Twilio Voice (outbound + inbound voicemail + inbound live agent) introduits par le Sprint 34 (migration `seq129`).
> Date : 2026-05-24. Version : 1.0. Sprint : 34.
> Compagnon de [`LOT-TWILIO-VOICE-S34.md`](LOT-TWILIO-VOICE-S34.md) §7 + [`TWIML-WEBHOOKS-S34.md`](TWIML-WEBHOOKS-S34.md). Calque la structure de [`RGPD-CALENDAR-SYNC-S33.md`](RGPD-CALENDAR-SYNC-S33.md).

## §1 Contexte légal applicable

L'enregistrement d'appels téléphoniques au Canada / Québec / UE est encadré par trois régimes cumulatifs. Intralys déploie la téléphonie auprès de courtiers hypothécaires + cabinets de services financiers (clients AMF) au Québec — la conformité doit donc satisfaire SIMULTANÉMENT les trois cadres.

| Régime | Référence | Exigence centrale |
|---|---|---|
| Canada (fédéral) | Code criminel L.R.C. art. 184 (interception communications privées) + Loi C-29 (PIPEDA) + CRTC Code télécom | **Bi-party consent** : enregistrer un appel exige le consentement des DEUX parties. Une exception « one-party consent » existe pour la personne qui enregistre, MAIS la jurisprudence + lignes directrices CRTC requièrent l'information préalable de l'autre partie pour les contextes commerciaux. |
| Québec (provincial) | Loi 25 (modernisant la protection des renseignements personnels) art. 8 + art. 28.1 (droit à l'effacement) + art. 27 (droit d'accès) | **Information préalable** sur la collecte (finalité, conservation, droits) + **droit d'accès** + **droit d'effacement** + **transfert hors-Québec** encadré (art. 17). |
| UE (RGPD) | Règlement 2016/679 art. 6(1)(a) (consentement) + art. 5(1)(b) (limitation finalité) + art. 17 (effacement) + art. 15 (accès) | **Base légale = consentement explicite** (l'intérêt légitime est rarement opposable pour de l'enregistrement audio). **Durée justifiée** + **portabilité** + **effacement**. |

Politique Intralys consolidée : consent bi-party explicite documenté ISO 8601 + rétention bornée 90 jours + cascade delete cross-system (Twilio API + R2 + D1 + audit log) + export portable + capability `settings.manage` requise pour la suppression côté admin.

## §2 Données collectées

Le périmètre Sprint 34 touche 3 tables D1 (existantes + neuves seq129). Chaque colonne contenant PII ou métadonnée RGPD-sensible est listée.

### 2.1 `call_recordings_metadata` (seq129 — neuve, audit RGPD)

| Colonne | Type | Sensibilité | Description |
|---|---|---|---|
| `id` | TEXT PK | technique | UUID interne. |
| `call_log_id` | TEXT | technique | FK applicative → `call_logs.id`. |
| `client_id` | TEXT | technique | Tenant propriétaire (bornage strict). |
| `recording_sid` | TEXT | technique | SID Twilio `REcXXX` (cascade delete). |
| `r2_key` | TEXT | technique | Clé R2 `voice/{client_id}/{call_log_id}/{recording_sid}.mp3`. |
| `duration_sec` | INTEGER | métier | Durée enregistrement. |
| `size_bytes` | INTEGER | métier | Taille audio (R2 metadata). |
| `consent_obtained_at` | TEXT (ISO 8601) | **RGPD** | Horodatage du consentement bi-party. |
| `consent_method` | TEXT | **RGPD** | `twiml_say_dtmf` \| `lead_preconsent` \| `agent_attest` (validé HANDLER, whitelist JS, JAMAIS CHECK SQL). |
| `retention_days` | INTEGER (default 90) | **RGPD** | Politique Intralys par défaut. |
| `deleted_at` | TEXT (ISO 8601) | **RGPD** | Soft-delete côté Intralys. |
| `twilio_deleted_at` | TEXT (ISO 8601) | **RGPD** | Confirmation `DELETE Recordings/{Sid}.json` Twilio. |
| `created_at` | TEXT | technique | Horodatage insertion. |

### 2.2 `voicemails` (seq129 — neuve, boîte vocale structurée)

| Colonne | Type | Sensibilité | Description |
|---|---|---|---|
| `id` | TEXT PK | technique | UUID interne. |
| `client_id`, `agency_id` | TEXT | technique | Bornage tenant + agence. |
| `call_log_id`, `lead_id`, `conversation_id` | TEXT | technique | FK applicatives (NULL si orphelin). |
| `from_number` | TEXT (E.164) | **PII directe** | Numéro de l'appelant. |
| `to_number` | TEXT (E.164) | **PII** | Numéro Twilio appelé (tenant). |
| `recording_url` | TEXT | **PII potentielle** | URL Twilio brute (audio = contenu vocal PII). |
| `recording_sid` | TEXT | technique | REcXXX (cascade delete). |
| `recording_r2_key` | TEXT | **PII potentielle** | Clé R2 audio local (URL signée Intralys). |
| `duration_sec` | INTEGER | métier | Durée message. |
| `transcription` | TEXT | **PII directe** | Texte transcrit (Whisper / Twilio native) — peut contenir nom, téléphone, situation perso. |
| `transcription_status` | TEXT | technique | `pending` \| `done` \| `failed` \| `skipped` (HANDLER validé). |
| `transcription_lang` | TEXT | technique | BCP-47 (HANDLER validé). |
| `listened_at`, `listened_by` | TEXT | métier + audit | 1ère écoute + user_id auditeur. |
| `deleted_at` | TEXT (ISO 8601) | **RGPD** | Soft-delete (trace de suppression sans hard-delete immédiat). |
| `created_at` | TEXT | technique | Horodatage insertion. |

### 2.3 `call_logs` (seq102 + 6 colonnes ADDITIVES seq129)

Colonnes seq129 ajoutées à la table existante (les colonnes seq102 + seq116 sont hors scope de cette doc) :

| Colonne | Type | Sensibilité | Description |
|---|---|---|---|
| `recording_sid` | TEXT | technique | REcXXX Twilio. |
| `recording_duration_sec` | INTEGER | métier | Durée enregistrement ≠ `duration_sec` appel total. |
| `recording_r2_key` | TEXT | **PII potentielle** | Clé R2 audio (cf. §2.2). |
| `transcription_status` | TEXT | technique | Validé HANDLER. |
| `transcription_lang` | TEXT | technique | BCP-47 validé HANDLER. |
| `recording_consent_obtained_at` | TEXT (ISO 8601) | **RGPD** | Horodatage consent bi-party (NULL = enregistrement INTERDIT). |

La colonne `call_logs.transcription` (seq102, existante) contient le texte transcrit — **PII directe** au même titre que `voicemails.transcription`.

## §3 Bases légales & rétention

### 3.1 Base légale par flow

| Flow | Base légale | Mécanisme consent |
|---|---|---|
| Outbound enregistré (agent → lead) | Consentement explicite bi-party (CRTC + Loi 25 + RGPD art. 6.1.a) | Agent coche « Enregistrer cet appel » + modal disclaimer + `consent_obtained=true` envoyé au handler. Refus 400 `consent_required` côté backend si flag absent. |
| Inbound voicemail | Consentement implicite documenté (le fait de rester en ligne après le `<Say>` de notification CRTC vaut consent au sens art. 184 C.cr.) | TwiML `<Say>` initial préprononce « Cet appel sera enregistré… Restez en ligne pour l'accepter ou raccrochez maintenant » AVANT le `<Record>`. Horodatage ISO 8601 stocké côté `recording-status` callback. |
| Inbound live agent (Phase C v2) | Consentement explicite DTMF | TwiML `<Say>` + `<Gather numDigits=1>` « 1 accepter, 2 refuser ». DTMF=1 → start recording + consent log. DTMF=2 → pas de recording, suite normale. |

### 3.2 Rétention 90 jours (politique Intralys par défaut)

- `call_recordings_metadata.retention_days = 90` (DEFAULT, override possible par tenant settings — Phase C).
- Justification métier : 90 jours = délai raisonnable pour résolution litige client + conformité minimale Loi 25 art. 5 (durée nécessaire à la finalité).
- Cron quotidien parcourt :

```sql
DELETE FROM voicemails
 WHERE created_at < datetime('now', '-90 days')
   AND deleted_at IS NULL;

DELETE FROM call_recordings_metadata
 WHERE created_at < datetime('now', '-' || retention_days || ' days')
   AND deleted_at IS NULL;
```

- Cascade `deleteTwilioRecording` (REST `DELETE /2010-04-01/Accounts/{Sid}/Recordings/{RecordingSid}.json`) + `deleteR2Recording` (env.FILES.delete(r2_key)) appelés best-effort.
- **TODO** : le cron n'est PAS câblé Sprint 34. Planifié Sprint 24 Observabilité (voir §10 Limitations).

## §4 Mécanisme consentement

### 4.1 Voicemail entrant (TwiML `<Say>` préprononcé)

Le handler `handleTwilioVoicemailTwiml` ([`src/worker/twilio-twiml.ts`](../src/worker/twilio-twiml.ts):174-194) émet le TwiML suivant AVANT tout `<Record>` :

```xml
<Response>
  <Say voice="alice" language="fr-CA">
    Cet appel sera enregistré pour le service à la clientèle.
    Restez en ligne pour l'accepter ou raccrochez maintenant.
    Au signal sonore, veuillez laisser votre message après le bip.
  </Say>
  <Record maxLength="120" playBeep="true"
          transcribe="true"
          transcribeCallback="…/transcription-callback"
          recordingStatusCallback="…/recording-status" />
  <Say voice="alice" language="fr-CA">Merci, au revoir.</Say>
</Response>
```

Le fait de rester en ligne = consent implicite (CRTC + Loi 25). Horodatage `recording_consent_obtained_at = datetime('now')` posé dans `handleTwilioRecordingStatusCallback` au moment du callback `RecordingStatus=completed`.

### 4.2 Outbound dialer (RecordingConsentBanner + agent attestation)

Workflow Phase C (`OutboundCallButton.tsx` + `RecordingControls.tsx`) :

1. Agent clique « Appeler ».
2. Modal disclaimer affiche : « En enregistrant cet appel, vous attestez que le consentement du correspondant a été obtenu OU sera obtenu verbalement en début d'appel ».
3. Agent coche « Enregistrer » + bouton « J'atteste » (= `consent_method='agent_attest'`).
4. `localStorage` mémorise la préférence par tenant (UX uniquement, JAMAIS authoritative).
5. Backend `handleInitiateOutboundCall` valide `consent_obtained=true` AVANT de poser `record=true` dans `generateOutboundDialTwiml`. Sinon réponse `400 { error: 'consent_required' }`.

### 4.3 Lead pré-consent (capture marketing)

Cas marginal Phase C v2 : le lead a coché « J'accepte l'enregistrement des appels » dans un formulaire web. Stocké côté `leads.consent_call_recording` (TODO seq future). `consent_method='lead_preconsent'`.

### 4.4 Garde backend stricte

Le handler `handleToggleCallRecording` ([`src/worker/calls-outbound.ts`](../src/worker/calls-outbound.ts)) refuse strictement :

```ts
if (body.enable === true && !call.recording_consent_obtained_at) {
  return json({ error: 'consent_required' }, 400);
}
```

JAMAIS de start recording sans `recording_consent_obtained_at` non-NULL.

## §5 Cascade delete RGPD (Right to erasure)

### 5.1 `DELETE /api/voicemails/:id` (cap `settings.manage`)

Handler `handleDeleteVoicemail` ([`src/worker/voicemails.ts`](../src/worker/voicemails.ts)). Cascade :

1. **Twilio side** : `deleteTwilioRecording(env, recording_sid)` → `DELETE /2010-04-01/Accounts/{AccountSid}/Recordings/{RecordingSid}.json` (Basic Auth `TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN`). Best-effort : si Twilio 404 (déjà purgé), on poursuit. Si 5xx réseau, on log + on poursuit (idempotent : retry futur OK).
2. **R2 side** : `env.FILES.delete(recording_r2_key)`. Best-effort si le blob a déjà été purgé.
3. **D1 side** : `UPDATE voicemails SET deleted_at = datetime('now'), recording_url = NULL, recording_sid = NULL, recording_r2_key = NULL, transcription = NULL WHERE id = ? AND client_id = ?`. Soft-delete : conserve `id` + `created_at` + `from_number` (anonymisé Phase C v2) pour audit immuable, purge tout le payload PII.
4. **`call_recordings_metadata`** : `UPDATE call_recordings_metadata SET deleted_at = datetime('now'), twilio_deleted_at = datetime('now') WHERE recording_sid = ?`.
5. **Audit** : `audit('voicemail.deleted_rgpd', 'voicemail', id, { recording_sid, by: auth.userId })`.

Idempotent : 2e appel sur même `id` retourne `200 { data: { ok: true, already_deleted: true } }`.

### 5.2 `DELETE /api/calls/:id/recording` (cap `settings.manage`)

Handler `handleDeleteCallRecording` ([`src/worker/calls-outbound.ts`](../src/worker/calls-outbound.ts)). Cascade identique adaptée à `call_logs` :

1. `deleteTwilioRecording(env, call.recording_sid)`.
2. `env.FILES.delete(call.recording_r2_key)`.
3. `UPDATE call_logs SET recording_sid = NULL, recording_url = NULL, recording_r2_key = NULL, recording_duration_sec = NULL, transcription = NULL, transcription_status = 'skipped', transcription_lang = NULL WHERE id = ? AND client_id = ?`. Le call_log RESTE (audit de l'appel passé) ; seul l'enregistrement est purgé.
4. `UPDATE call_recordings_metadata SET deleted_at = datetime('now'), twilio_deleted_at = datetime('now') WHERE call_log_id = ?`.
5. `audit('call.recording.deleted_rgpd', 'call_log', id, { recording_sid, by: auth.userId })`.

### 5.3 Cascade compte global (`/api/me/delete-account`)

À l'intérieur de `handleRequestAccountDeletion` (Sprint 23 — TODO Sprint 23.5 enrichir avec Sprint 34) :

```sql
-- 1) Soft-delete voicemails (cascade audio + transcription)
UPDATE voicemails
   SET deleted_at = datetime('now'),
       recording_url = NULL,
       recording_sid = NULL,
       recording_r2_key = NULL,
       transcription = NULL
 WHERE client_id = ?
   AND deleted_at IS NULL;

-- 2) Purge enregistrements call_logs (le log reste pour audit)
UPDATE call_logs
   SET recording_sid = NULL,
       recording_url = NULL,
       recording_r2_key = NULL,
       transcription = NULL,
       transcription_status = 'skipped'
 WHERE client_id = ?;

-- 3) Marquer la metadata audit RGPD
UPDATE call_recordings_metadata
   SET deleted_at = datetime('now'),
       twilio_deleted_at = datetime('now')
 WHERE client_id = ?
   AND deleted_at IS NULL;
```

Côté Twilio + R2 : le cron `handleScheduledAccountDeletion` (J+30) déclenche `deleteTwilioRecording` + `deleteR2Recording` sur chaque ligne marquée. Best-effort, swallow erreurs (ne bloque pas la cascade globale).

## §6 Droit d'accès (Loi 25 art. 27 + RGPD art. 15)

### 6.1 Inclusion dans `/api/me/export-data`

Le handler `handleGetMyDataExport` (Sprint 23) doit inclure (TODO Sprint 23.5) :

```json
{
  "voicemails": [
    {
      "id": "...",
      "from_number": "+15145551234",
      "to_number": "+15145559999",
      "duration_sec": 45,
      "transcription": "...",
      "transcription_lang": "fr-CA",
      "listened_at": "...",
      "created_at": "...",
      "audio_signed_url": "https://.../voice/.../REc.../mp3?sig=...&exp=...",
      "audio_url_expires_at": "..."
    }
  ],
  "call_recordings": [
    {
      "call_log_id": "...",
      "duration_sec": 120,
      "transcription": "...",
      "consent_obtained_at": "...",
      "consent_method": "agent_attest",
      "created_at": "...",
      "audio_signed_url": "...",
      "audio_url_expires_at": "..."
    }
  ]
}
```

### 6.2 Règles d'export

- URLs audio = signées R2 TTL **24h** (HMAC-SHA256 via `TOKEN_KEY` env secret). JAMAIS d'audio binaire dans le payload JSON (volumétrie + sécurité).
- Transcriptions textuelles incluses brut (le user a droit à ses données).
- `recording_sid` Twilio exclu du payload (secret tech, pas user-data).
- Truncation : `voicemails` au-delà de 500 lignes tronqué `ORDER BY created_at DESC LIMIT 500`.
- Lignes `deleted_at IS NOT NULL` exclues (soft-deleted = considéré effacé du point de vue user).

## §7 Logs audit

Toute opération RGPD sensible loggée dans `audit_log` (immuable, append-only Sprint S1) :

| Action | Entity | Trigger | Payload |
|---|---|---|---|
| `call.recording.deleted_rgpd` | `call_log` | `DELETE /api/calls/:id/recording` | `{ recording_sid, by: auth.userId, twilio_status, r2_status }` |
| `voicemail.deleted_rgpd` | `voicemail` | `DELETE /api/voicemails/:id` | `{ recording_sid, by: auth.userId, twilio_status, r2_status }` |
| `voicemail.listened` | `voicemail` | `POST /api/voicemails/:id/listen` | `{ by: auth.userId, first_listen: bool }` |
| `call.recording.consent_obtained` | `call_log` | `recording-status callback (status=completed)` | `{ recording_sid, consent_method, consent_obtained_at }` |
| `call.recording.cron_purged` | `call_log` | Cron retention (TODO) | `{ recording_sid, age_days, retention_days }` |
| `account.recordings.cascade_deleted` | `client` | `handleScheduledAccountDeletion` J+30 | `{ voicemail_count, call_log_count }` |

Toutes les entrées contiennent `client_id` + `created_at` ISO 8601 + `user_id` (NULL pour cron). Aucune PII dans le payload audit (seulement IDs techniques + statuts).

## §8 Variables d'environnement requises

| Variable | Source | Usage | Statut S34 |
|---|---|---|---|
| `TWILIO_ACCOUNT_SID` | secret wrangler | Basic Auth API Twilio (download + delete recording) | EXISTANTE (seq102) |
| `TWILIO_AUTH_TOKEN` | secret wrangler | Basic Auth + signature webhooks (`verifyTwilioSignature`) | EXISTANTE (seq102 + twilio-verify) |
| `TWILIO_PHONE_NUMBER` | secret wrangler | from_number par défaut outbound | EXISTANTE (seq102) |
| `OPENAI_API_KEY` | secret wrangler | Whisper transcription (optionnel — skip si absente) | EXISTANTE (voice.ts:65) |
| `FILES` | R2 binding wrangler.jsonc | Stockage audio recordings (`voice/{client_id}/...`) | EXISTANTE (LOT FILES seq11) |
| `TOKEN_KEY` | secret wrangler | HMAC pour URLs R2 signées (24h TTL pour export, 1h TTL pour streaming UI) | EXISTANTE (TOKEN_KEY Sprint S1) |

**Aucune nouvelle variable d'env Sprint 34.** FLAG INACTIF si Twilio absent (calque `sendSms` helpers.ts:93-95) : les handlers retournent `{ mock: true }` et n'altèrent pas le wiring CRM testable sans credentials.

## §9 Checklist conformité

Pré-flight avant rollout beta tenants AMF Québec :

- [ ] **Consent bi-party documenté** avant tout `<Record>` (TwiML `<Say>` voicemail OR agent attestation outbound OR DTMF live agent).
- [ ] **Rétention 90j configurable** par tenant via `call_recordings_metadata.retention_days` (override Phase C settings).
- [ ] **Cascade delete cross-system** opérationnelle : Twilio API + R2 + D1 + audit log + `call_recordings_metadata.deleted_at`.
- [ ] **Audit log immuable** : 6 actions tracées (cf. §7), `client_id` + `user_id` + ISO 8601.
- [ ] **Export RGPD** inclut voicemails + call_recordings avec URLs signées R2 24h.
- [ ] **Pas d'enregistrement sans flag explicite** : garde backend `400 consent_required` si `recording_consent_obtained_at IS NULL` au moment du `start recording`.
- [ ] **Capability `settings.manage`** requise pour DELETE recording / voicemail (admin only).
- [ ] **Bornage tenant strict** : `WHERE id = ? AND client_id = ?` sur tout UPDATE/DELETE. `client_id` JAMAIS depuis le body.
- [ ] **Whisper data residency** documenté pour clients UE (cf. §10).
- [ ] **DPO contact** publié : accessibilite@intralys.com (cf. [`RGPD-CALENDAR-SYNC-S33.md`](RGPD-CALENDAR-SYNC-S33.md) §7).

## §10 Limitations

- **Cron retention auto pas câblé Sprint 34**. La politique 90j est documentée + le SQL est rédigé (§3.2), mais le `scheduled` handler Cloudflare Workers n'est pas posé. Planifié Sprint 24 Observabilité — d'ici là, suppression manuelle via `DELETE /api/voicemails/:id` ou `DELETE /api/calls/:id/recording`. Le volume reste borné par le débit d'appels du tenant (typiquement < 50 recordings/jour pour un cabinet courtage).
- **Whisper = OpenAI tier US**. La transcription via OpenAI Whisper (voice.ts:64-94) implique un transit transfrontalier vers les datacenters OpenAI (USA). Encadré par DPA OpenAI + clauses contractuelles type Commission EU + DPF. **À noter pour clients UE** : si refus OpenAI US, on désactive Whisper (`OPENAI_API_KEY` absente → `transcription_status='skipped'`) et on tombe sur la transcription Twilio native (best-effort fr-CA, qualité variable). Pour clients QC stricts : Whisper accepté sous le régime DPA OpenAI + DPF (équivalent Calendar Sync §1).
- **R2 bucket partagé multi-tenant**. Path prefix `voice/{client_id}/{call_log_id}/{recording_sid}.mp3` assure l'isolation logique (clé immutable + non-énumerable). Pas d'isolation physique R2 par tenant — pas nécessaire car URLs signées HMAC bornent l'accès.
- **Cascade delete best-effort côté Twilio**. Si l'API Twilio renvoie 5xx au moment du `DELETE Recordings/{Sid}.json`, on log + on poursuit (soft-delete D1 OK). Le retry est manuel via `audit_log` pour l'instant (cron de réconciliation TODO Sprint 24).
- **Transcription native Twilio fr-CA** : qualité médiocre, désactivable par défaut (`transcribe=false` sur `<Record>` Phase C v2 si on s'appuie 100% sur Whisper). Sprint 34 garde `transcribe=true` en backup.
- **Pas de chiffrement at-rest spécifique audio R2**. R2 est chiffré at-rest par Cloudflare par défaut (AES-256). Pas de chiffrement applicatif additionnel sur l'audio (vs tokens OAuth qui sont chiffrés AES-GCM applicatif Sprint 33). Justification : l'audio est volumineux + l'accès est borné par URL signée HMAC.
- **Pas de gestion enregistrements multi-party / conférence** (cf. [`TWIML-WEBHOOKS-S34.md`](TWIML-WEBHOOKS-S34.md) §10). Hors-scope v1.

---

**Cross-references** :
- [`LOT-TWILIO-VOICE-S34.md`](LOT-TWILIO-VOICE-S34.md) — contrat Sprint 34 §6 + §7
- [`TWIML-WEBHOOKS-S34.md`](TWIML-WEBHOOKS-S34.md) — réf webhooks + signature Twilio
- [`RGPD-CALENDAR-SYNC-S33.md`](RGPD-CALENDAR-SYNC-S33.md) — pattern doc RGPD précédent (calque structure)
- [`migration-twilio-voice-seq129.sql`](../migration-twilio-voice-seq129.sql) — DDL colonnes recording + voicemails + call_recordings_metadata
- [`src/worker/twilio-twiml.ts`](../src/worker/twilio-twiml.ts) — 4 webhooks publics + consent timestamp posé
- [`src/worker/calls-outbound.ts`](../src/worker/calls-outbound.ts) — handlers RGPD delete cascade outbound
- [`src/worker/voicemails.ts`](../src/worker/voicemails.ts) — cascade delete voicemail cap `settings.manage`
- [`src/worker/twilio-verify.ts`](../src/worker/twilio-verify.ts) — verifyTwilioSignature
