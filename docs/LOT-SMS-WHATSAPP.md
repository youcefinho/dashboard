# LOT SMS/WHATSAPP — STOP/CASL + signature Twilio + delivery receipts + broadcast SMS + WhatsApp (SMS/WhatsApp completion)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> disjoints — §6.H). Non exécuté (VM VMware sans bun/node) — Antigravity
> buildera/testera côté hôte. Modèle : `docs/LOT-BOOKING-REMINDERS.md`. **Phase
> B/C ne lisent QUE ce document** (+ le CODE, jamais le brief).

Sprint resserré, **100% ADDITIF**, qui ferme 5 gaps du canal SMS (sortant
Twilio flag-inactif `helpers.sendSms`, inbound `handleInboundSms`, Inbox 2-way
déjà ~85%) :

1. **STOP / opt-out CASL** : l'inbound ne détecte PAS STOP → non-conforme
   (bloquant légal). → `detectStopKeyword` (Phase A) + branchement Manager-B.
2. **Signature Twilio** : webhooks `/api/webhook/sms` publics SANS validation. →
   `verifyTwilioSignature` (Phase A) branché EN AMONT (worker.ts).
3. **Delivery receipts** : pas de status-callback SMS. → route
   `POST /api/webhook/sms/status` + `handleSmsStatusCallback` (stub A, corps B)
   + colonne `messages.delivery_status` (seq 104).
4. **Broadcast SMS de masse** : le mass-send est email-only. → `broadcasts.channel`
   + `broadcasts.body_text` (seq 104) ; path SMS dans `processBroadcastQueueJob`
   (Manager-B). **Path email INCHANGÉ** (DEFAULT 'email', rétro-compat byte).
5. **WhatsApp** : ABSENT → squelette flag-inactif (`whatsapp.ts` + tables
   `sms_templates` / `whatsapp_connections`, `sendWhatsAppTemplate` gardé flag).

Architecture figée (NE PAS réinventer) :
- Tables `messages` (seq 2, rebuild seq 49) + `broadcasts` (seq 24) EXISTENT —
  NON recréées. `messages.channel` / `messages.status` SANS CHECK depuis seq 49
  ⇒ ajouter `whatsapp` / `delivered` / `failed` est LIBRE (aucun ALTER de CHECK).
- Migration seq **104** = STRICTEMENT ADDITIVE (`ALTER ADD COLUMN` + `CREATE
  TABLE/INDEX IF NOT EXISTS`). Zéro DROP/RENAME/rebuild/FK.
- Capabilities = **RÉUTILISE `settings.manage`** (templates SMS / config
  WhatsApp) + **`leads.write`** (envoi). Liste FIGÉE seq 80 — ZÉRO ajout à
  `ALL_CAPABILITIES`.
- Tout secret externe sans credentials = **FLAG INACTIF** (mock, aucun appel
  réseau) : calque `helpers.sendSms:93-95` / `telephony.placeCall:85-88`.
- E4/E6 INACTIFS : `price_cents` jamais touché, aucune logique paiement.
- NE PAS casser : `telephony.ts` / `call_logs` / `ivr_menus` / `/api/voice/*`
  (seq 102), ni la signature de `helpers.sendSms`, ni le path email du broadcast.

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS (rappel)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` (`src/lib/types.ts`) **GELÉS**.
Phase A ne les a PAS modifiés ; Phase B/C ne les touchent PAS.
- Succès = **`json({ data })`** ; erreur = **`json({ error }, status)`**.
  **JAMAIS de champ `code`** — discrimination front string-match sur `error`.

Helpers/Types ADDITIFS posés Phase A dans `src/lib/api.ts` — **FIGÉS**, Phase C
les CONSOMME tels quels (signatures EXACTES) :

```
getSmsTemplates(): ApiResponse<SmsTemplate[]>                      GET    /sms-templates
createSmsTemplate({name, body}): ApiResponse<{id, success}>       POST   /sms-templates
updateSmsTemplate(id, {name, body}): ApiResponse<{id, success}>   PUT    /sms-templates/:id
deleteSmsTemplate(id): ApiResponse<{success}>                     DELETE /sms-templates/:id
getWhatsAppConnection(): ApiResponse<WhatsAppConnection | null>   GET    /integrations/whatsapp
saveWhatsAppConnection({phone_number_id?, access_token?}):        POST   /integrations/whatsapp
                       ApiResponse<{id, status, success}>
```

Le helper d'envoi de broadcast **`sendBroadcast`** (NOM EXACT — `src/lib/api.ts`)
est ÉTENDU Phase A par 2 champs OPTIONNELS FIGÉS (rétro-compat byte : absents ⇒
broadcast email legacy strictement identique) :

```
channel?: 'email' | 'sms'      // défaut serveur 'email' ; 'sms' = mass-send SMS
body_text?: string             // corps SMS en clair (ignoré si channel email)
```

Phase C branche le sélecteur de canal + corps SMS sur `sendBroadcast` tel quel —
AUCUN nouveau helper broadcast.

Types front (miroir, `src/lib/types.ts`, FIGÉS A) : `SmsTemplate {id; client_id?;
name; body; created_at?}` et `WhatsAppConnection {id; client_id?; phone_number_id?;
status; created_at?}`. ⚠ `access_token` JAMAIS exposé au front (secret) — absent
du miroir et NON renvoyé par `handleGetWhatsAppConnection`.

### §6.B — DDL seq 104 + conventions

Fichier : `migration-sms-whatsapp-seq104.sql` — seq **104**,
`depends_on: migration-booking-reminders-seq103.sql` (dernière migration du
manifest = seq 103, chaînage SÉQUENTIEL, AUCUNE dépendance de schéma réelle).
Entrée manifest ajoutée Phase A (`docs/migrations-manifest.json` seq 104, risk
`low`, `objects: ["alter:broadcasts","alter:messages","table:sms_templates",
"table:whatsapp_connections","index:sms_templates","index:whatsapp_connections"]`).

> ⚠ `scripts/migrate.ts` STOPPE en erreur dure sur tout fichier `migration-*`
> présent sur disque mais ABSENT du manifest. L'entrée seq 104 est OBLIGATOIRE
> et a été ajoutée Phase A (JSON validé).

Conventions (calque seq 102/103) : `ALTER ... ADD COLUMN` purs + `CREATE TABLE/
INDEX IF NOT EXISTS`, timestamps `TEXT DEFAULT (datetime('now'))`, id `TEXT
PRIMARY KEY`, **zéro FK**, PAS d'unixepoch/autoincrement. AUCUN ALTER de
contrainte / DROP / RENAME / rebuild. Tolérance duplicate-column best-effort.

**Objets ajoutés (additif pur)** :
- **`broadcasts`** (seq 24) : `channel TEXT NOT NULL DEFAULT 'email'` (rétro-compat
  byte : broadcast existant reste 'email') + `body_text TEXT` (NULL = email legacy).
- **`messages`** (seq 49, channel/status SANS CHECK) : `delivery_status TEXT`
  (NULL = legacy ; DISTINCT de `status` ; posé par `handleSmsStatusCallback` via
  MessageSid — SANS CHECK, libre).
- **`sms_templates`** (NEUVE) : `id PK, client_id, name, body, created_at`.
- **`whatsapp_connections`** (NEUVE) : `id PK, client_id, phone_number_id,
  access_token, status DEFAULT 'inactive', created_at`.
- Index : `idx_sms_templates_client(client_id)`,
  `idx_whatsapp_connections_client(client_id)`.

E4/E6 régulés : **AUCUNE activation paiement**, `price_cents` jamais touché.

### §6.C — Helpers NEUFS `src/worker/twilio-verify.ts` (signatures FIGÉES)

Fichier NEUF/ISOLÉ, imports RELATIFS (`./types`), Web Crypto (`crypto.subtle`,
PAS de lib Node). Signatures FIGÉES Phase A (worker.ts les câble). Phase B/C
**NE TOUCHENT PAS** ce fichier.

```
export async function verifyTwilioSignature(request: Request, env: Env, params: Record<string,string>): Promise<boolean>
export function detectStopKeyword(body: string): boolean
```

- **`verifyTwilioSignature`** : HMAC-SHA1 du `TWILIO_AUTH_TOKEN` sur (URL +
  params triés par clé concaténés key+value), base64, comparé au header
  `X-Twilio-Signature`. **FLAG INACTIF** : `!env.TWILIO_AUTH_TOKEN` → `return
  true` (bypass, mode mock préservé). Token présent + header absent/invalide →
  `false`. Corps RÉEL posé Phase A (fonctionnel).
- **`detectStopKeyword`** : `true` si le body (NFD, retrait diacritiques
  combinants U+0300–U+036F, trim, uppercase, espaces normalisés) ∈ {STOP, ARRET,
  ARRÊT, DESABONNEMENT, DÉSABONNEMENT, UNSUBSCRIBE, STOPTOUT, "STOP TOUT", FIN,
  CANCEL}. **EMPLACEMENT FIGÉ : `src/worker/twilio-verify.ts`** (PAS dans
  helpers.ts). Manager-B importe `import { detectStopKeyword } from
  './twilio-verify'`.

### §6.D — Stubs/handlers neufs (corps minimal qui COMPILE)

Fichiers NEUFS, imports RELATIFS. Signatures FIGÉES (worker.ts les câble).

**`src/worker/sms-templates.ts`** (NEUF, corps RÉELS posés Phase A — calque
telephony.ts, capability `settings.manage`, bornage tenant `resolveClientId`,
`{data}`/`{error}`) :
```
handleListSmsTemplates(env, auth, url): Promise<Response>            GET    /api/sms-templates
handleCreateSmsTemplate(request, env, auth): Promise<Response>       POST   /api/sms-templates
handleUpdateSmsTemplate(request, env, auth, templateId): Promise<Response>  PUT    /api/sms-templates/:id
handleDeleteSmsTemplate(env, auth, templateId): Promise<Response>    DELETE /api/sms-templates/:id
```

**`src/worker/whatsapp.ts`** (NEUF, corps mock fonctionnels Phase A) :
```
handleWhatsAppWebhook(request, env): Promise<Response>              GET/POST /api/webhook/whatsapp (PUBLIC)
handleGetWhatsAppConnection(env, auth, url): Promise<Response>      GET  /api/integrations/whatsapp  (settings.manage)
handleSaveWhatsAppConnection(request, env, auth): Promise<Response> POST /api/integrations/whatsapp  (settings.manage)
sendWhatsAppTemplate(env, to, templateName, languageCode?): Promise<{success; id?; mock?; error?}>
```
- `handleWhatsAppWebhook` GET = handshake `hub.challenge` (si `hub.verify_token
  === env.WHATSAPP_VERIFY_TOKEN` → renvoie challenge ; sinon 403, jamais 500 ;
  flag inactif sans verify_token → 403). POST = inbound stub (accusé 200).
- `sendWhatsAppTemplate` **FLAG INACTIF** : `!env.WHATSAPP_ACCESS_TOKEN ||
  !env.WHATSAPP_PHONE_NUMBER_ID` → `{success:false, mock:true, error:'WhatsApp
  non configuré'}` SANS fetch (calque sendSms/placeCall).

**`src/worker/messages.ts`** (⚠ OWNED Manager-B — voir §6.H) — Phase A n'a
ajouté QUE le stub EN FIN DE FICHIER + un commentaire repère dans
`handleInboundSms` :
```
handleSmsStatusCallback(request, env): Promise<Response>           POST /api/webhook/sms/status (PUBLIC, stub → Response('',200))
```

### §6.E — Routes / webhooks (worker.ts, FIGÉ Phase A)

Toutes câblées Phase A dans `worker.ts` (Phase B/C NE TOUCHENT PAS worker.ts) :

**Webhook SMS inbound signé** (`POST /api/webhook/sms`, PUBLIC) —
`verifyTwilioSignature` branché EN AMONT de `handleInboundSms` (signature de
`handleInboundSms` INCHANGÉE) :
- Si vérif échoue **ET** `env.TWILIO_AUTH_TOKEN` présent → `403`.
- Si flag inactif (`!TWILIO_AUTH_TOKEN`) → bypass, `handleInboundSms` appelé
  normalement (mode mock préservé).

> **CONVENTION BODY WEBHOOK (FIGÉE — Manager-B la respecte)** : le body
> form-urlencoded est lu **UNE SEULE FOIS** dans worker.ts via
> **`request.clone().formData()`** → `params: Record<string,string>` passés à
> `verifyTwilioSignature`. La requête **ORIGINALE** (`request`) reste intacte et
> est transmise à `handleInboundSms`, qui relit le body lui-même (son
> `request.formData()` existant). **Manager-B NE doit PAS** reconsommer le body
> hors de `handleInboundSms` ni changer la signature `handleInboundSms(request,
> env)` ; il ajoute sa logique STOP À L'INTÉRIEUR de `handleInboundSms` après le
> parsing `formData` déjà présent (ligne ~262).

**Autres routes** :
```
POST /api/webhook/sms/status          → handleSmsStatusCallback(request, env)        (PUBLIC, ./worker/messages)
GET/POST /api/webhook/whatsapp         → handleWhatsAppWebhook(request, env)          (PUBLIC, ./worker/whatsapp)
GET    /api/sms-templates              → handleListSmsTemplates(env, auth, url)       (protégé, settings.manage)
POST   /api/sms-templates              → handleCreateSmsTemplate(request, env, auth)  (protégé)
PUT    /api/sms-templates/:id          → handleUpdateSmsTemplate(request, env, auth, id) (protégé ; /:id APRÈS la collection)
DELETE /api/sms-templates/:id          → handleDeleteSmsTemplate(env, auth, id)       (protégé)
GET    /api/integrations/whatsapp      → handleGetWhatsAppConnection(env, auth, url)  (protégé, settings.manage)
POST   /api/integrations/whatsapp      → handleSaveWhatsAppConnection(request, env, auth) (protégé)
```
Les webhooks publics sont câblés dans la zone pré-`requireAuth` (à côté de
`/api/webhook/sms`) ; les CRUD dans `routeProtected` (après le bloc téléphonie).

### §6.F — Secrets Env (worker types.ts, FIGÉ Phase A)

Ajout au type `Env` (calque les secrets Twilio existants ~l.12-14, tous
OPTIONNELS → flag inactif) :
```
WHATSAPP_PHONE_NUMBER_ID?: string;
WHATSAPP_ACCESS_TOKEN?: string;
WHATSAPP_VERIFY_TOKEN?: string;
```
+ interfaces backend `SmsTemplate` / `WhatsAppConnection` (cf. §6.A miroir front).

### §6.G — i18n (POSÉ Phase A — parité STRICTE 4 catalogues)

17 clés posées Phase A dans `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (parité STRICTE
vérifiée — mêmes 17 clés partout, valeurs traduites). Phase C les CONSOMME, n'en
crée AUCUNE :

```
smsCampaign.channel            smsCampaign.channel_email      smsCampaign.channel_sms
smsCampaign.body               smsCampaign.body_placeholder
smsCampaign.segments           smsCampaign.segments_count
smsTemplate.title              smsTemplate.name               smsTemplate.body
smsTemplate.create             smsTemplate.edit               smsTemplate.delete
system.sms_unsubscribe_confirm    (FR-CA : « Vous êtes désabonné. Répondez DÉBUT pour vous réabonner. »)
whatsapp.title                 whatsapp.not_configured        whatsapp.connect
```

### §6.H — Répartition DISJOINTE Phase B/C (zéro fichier partagé)

**Manager-B (backend) — owned EXCLUSIF** :
- `src/worker/messages.ts` :
  - **durcir `handleInboundSms`** : appel `detectStopKeyword(body)` (import
    `./twilio-verify`) → si STOP : INSERT `unsubscribes` (phone + channel 'sms')
    + auto-reply TwiML de confirmation (clé `system.sms_unsubscribe_confirm`) +
    `handleLogConsent` marketing_sms `granted=0`. À placer AVANT l'INSERT du
    message inbound (repère commentaire posé Phase A ~l.266). **NE PAS changer la
    signature `handleInboundSms(request, env)` ni reconsommer le body** (cf.
    convention §6.E).
  - **corps réel de `handleSmsStatusCallback`** : parse formData (MessageSid /
    MessageStatus) → `UPDATE messages SET delivery_status = ? WHERE external_id =
    ?` (best-effort, 200 toujours).
  - **check `isUnsubscribed(env, '', phone, 'sms')`** dans `handleSendSmsRoute`
    (refus avant envoi si opt-out).
- `src/worker/broadcast.ts` : branche le path SMS dans `processBroadcastQueueJob`
  (lit `broadcasts.channel` ; si 'sms' → `helpers.sendSms` par lead, check
  `isUnsubscribed(...'sms')`, INSERT messages channel 'sms') + l'enqueue lit
  `channel`/`body_text`. **Path email INCHANGÉ (byte-identique).**
- `src/worker/workflows.ts` : check `isUnsubscribed(...'sms')` + quiet-hours dans
  le case `send_sms`.
- corps réels de `whatsapp.ts` si besoin (parsing inbound POST, wiring Inbox) —
  `whatsapp.ts` = **Manager-B exclusif**.
- `src/worker/sms-templates.ts` = **Manager-B exclusif** (corps déjà fonctionnels
  Phase A ; enrichissements éventuels, signatures FIGÉES).

**Manager-C (front) — owned EXCLUSIF** :
- `src/pages/Campaigns.tsx` : sélecteur canal email/SMS + corps SMS + compteur
  de segments (branché sur `sendBroadcast` étendu — `channel`/`body_text`).
- `src/components/Inbox/*` : afficher `delivery_status` + badge canal.
- `src/pages/settings/SmsTemplates.tsx` (NEUF) : gestion des modèles SMS
  (helpers `getSmsTemplates`/`createSmsTemplate`/`updateSmsTemplate`/
  `deleteSmsTemplate`).
- `src/pages/Integrations.tsx` : carte WhatsApp « non configuré »
  (`getWhatsAppConnection`/`saveWhatsAppConnection`, clés `whatsapp.*`).
- `src/components/conversations/` : indicateur opt-out lead.

**INTERDITS aux DEUX Managers** (FIGÉS Phase A ou hors scope, lecture seule) :
- `migration-sms-whatsapp-seq104.sql`, `docs/migrations-manifest.json`,
  `src/worker/types.ts`, `src/lib/types.ts`, `src/worker.ts`, `src/lib/api.ts`,
  `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, `src/index.css`,
  `src/worker/twilio-verify.ts`, `src/worker/telephony.ts`,
  `src/worker/compliance.ts` (sauf LECTURE — `isUnsubscribed`/`handleLogConsent`),
  **`docs/LOT-SMS-WHATSAPP.md`**.
- ⚠ `src/worker/messages.ts` = **Manager-B exclusif** (Phase A n'y a posé qu'un
  stub + un commentaire). `whatsapp.ts` / `sms-templates.ts` = **Manager-B
  exclusif**. **Aucun fichier partagé entre B et C** ⇒ parallélisation sûre.

### §6.I — Pièges / garde-fous

- **CHECK INTOUCHABLES** — `messages.channel`/`status` SANS CHECK depuis seq 49 :
  valeurs `whatsapp`/`delivered`/`failed` libres, AUCUN ALTER de CHECK. Jamais de
  DROP/RENAME/rebuild.
- **Manifest OBLIGATOIRE** — entrée seq 104 ajoutée (JSON validé) ; sans elle
  `scripts/migrate.ts` STOPPE en erreur dure.
- **FK INTERDITES** — jointures sms_templates/whatsapp_connections ↔ client
  APPLICATIVES (client_id TEXT, bornage serveur).
- **FLAG INACTIF partout** — `verifyTwilioSignature` (sans token → bypass),
  `sendWhatsAppTemplate` (sans access_token → no-op), webhook WhatsApp GET (sans
  verify_token → 403). AUCUN appel réseau sans credentials. Mode mock préservé.
- **CASL STOP OBLIGATOIRE** — `detectStopKeyword` posé Phase A ; le branchement
  inbound (unsubscribe + auto-reply + consent) est BLOQUANT LÉGAL (Manager-B).
- **Body webhook lu UNE SEULE FOIS** — `request.clone().formData()` côté
  worker.ts pour la vérif ; `handleInboundSms` relit la requête originale (cf.
  convention §6.E). Ne JAMAIS reconsommer le body hors handler.
- **NE PAS casser** : `helpers.sendSms` (signature INCHANGÉE), path email du
  broadcast (DEFAULT 'email', byte-identique), téléphonie seq 102 (`telephony.ts`
  / `call_logs` / `ivr_menus` / `/api/voice/*`).
- **Imports worker RELATIFS** (`./types`, `./helpers`, `./capabilities`,
  `./twilio-verify`) — PAS d'alias `@/`. Front utilise `@/`.
- **Capabilities FIGÉES seq 80** — réutilise `settings.manage` + `leads.write`,
  ZÉRO ajout à `ALL_CAPABILITIES`.
- **Parité i18n STRICTE** sur les 4 catalogues (17 clés vérifiées).
- **E4/E6 OFF** — `price_cents` jamais touché, aucune logique paiement.
- best-effort partout : table/colonne absente ⇒ réponse propre, JAMAIS de
  500/throw non maîtrisé.
- Pas de build/test côté VM (VMware sans bun/node) — Antigravity build/test
  côté hôte. NE PAS prétendre « vert ».

---

## État Phase A (livré)

Fichiers créés :
- `migration-sms-whatsapp-seq104.sql` — DDL additif (2 ALTER broadcasts + 1 ALTER
  messages + 2 CREATE TABLE + 2 CREATE INDEX).
- `src/worker/twilio-verify.ts` — `verifyTwilioSignature` (HMAC-SHA1, flag
  inactif) + `detectStopKeyword` (opt-out CASL robuste). Signatures FIGÉES.
- `src/worker/sms-templates.ts` — CRUD modèles SMS (corps réels, settings.manage).
- `src/worker/whatsapp.ts` — webhook Meta + CRUD config + `sendWhatsAppTemplate`
  (flag inactif). Corps mock fonctionnels.
- `docs/LOT-SMS-WHATSAPP.md` — ce document (§6 A→I FIGÉ).

Fichiers modifiés (GELÉS pour Phase B/C ensuite) :
- `docs/migrations-manifest.json` — entrée seq 104.
- `src/worker/types.ts` — 3 secrets WhatsApp OPTIONNELS + interfaces SmsTemplate
  / WhatsAppConnection.
- `src/worker.ts` — verify Twilio en amont de handleInboundSms +
  `/api/webhook/sms/status` + `/api/webhook/whatsapp` + CRUD `/api/sms-templates`
  (+ /:id) + `/api/integrations/whatsapp`.
- `src/worker/messages.ts` — UNIQUEMENT stub `handleSmsStatusCallback` (fin de
  fichier) + commentaire repère STOP dans handleInboundSms (= Manager-B exclusif
  pour le reste).
- `src/lib/types.ts` — miroirs front SmsTemplate / WhatsAppConnection.
- `src/lib/api.ts` — `sendBroadcast` étendu (`channel`/`body_text`) + 6 helpers
  CRUD SMS templates / WhatsApp connection.
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 17 clés smsCampaign/smsTemplate/
  whatsapp/system, parité STRICTE 4 catalogues.

Non touché : `helpers.sendSms` (signature INCHANGÉE), `broadcast.ts` (path SMS =
Phase B), `workflows.ts` (send_sms = Phase B), `compliance.ts` (lecture seule),
`telephony.ts`/`voice.ts` (seq 102), `capabilities.ts` (ALL_CAPABILITIES),
`index.css`, `Campaigns.tsx`/`Inbox`/`Integrations.tsx`/`SmsTemplates.tsx` (= Phase
C), corps réels `handleInboundSms`/`handleSmsStatusCallback` (= Phase B). Non
exécuté (VM) — Antigravity build/test côté hôte.
