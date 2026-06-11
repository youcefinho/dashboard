# LOT TELEPHONY-DISPOSITION — Téléphonie : disposition + notes + journal global (Sprint 16 : la téléphonie 2-way existe DÉJÀ — `telephony.ts` seq 102 (`placeCall` flag inactif, `handlePlaceCall` click-to-call, `handleGetCallLogs` journal + filtres, IVR TwiML, `handleCallStatusCallback` + `recording_url`/`transcription` Whisper) + table `call_logs`/`ivr_menus` + UI journal+click-to-call dans `LeadDetail.tsx` + `TelephonySettings` + 17 clés `telephony.*` ×4 — on COMBLE les GAPS, 100% ADDITIF, RÉUTILISANT l'existant)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-REPORT-TEMPLATES.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE des fichiers RÉUTILISÉS,
> jamais le brief).

Sprint **100% ADDITIF**, **migration `migration-telephony-disposition-seq116.sql`**
(2 `ALTER TABLE call_logs ADD COLUMN` + 1 index, sur la table EXISTANTE seq 102).
La téléphonie 2-way existe DÉJÀ — **à RÉUTILISER, NE PAS reconstruire** :
- `src/worker/telephony.ts` (seq 102) — GELÉ sauf l'ajout du handler du présent lot
  (Manager-B exclusif). Pièces RÉUTILISÉES :
  - **`placeCall`** (l.79) : appel Twilio sortant — **FLAG INACTIF** (garde
    credentials l.85, sans secrets → `{ success:false, mock:true }`). À NE PAS
    activer. **READ/IMPORT.**
  - **`logCall`** (l.124) : INSERT `call_logs` best-effort. **RÉUTILISÉ.**
  - **`resolveClientId`** (l.185) : client_id serveur (admin = null non borné ;
    sinon `users.client_id`). **RÉUTILISÉ — JAMAIS depuis le body.**
  - **`handleGetCallLogs`** (l.205) : journal borné tenant, JOIN leads (nom),
    filtres `?lead_id=` / `?direction=` DÉJÀ présents, `LIMIT` ≤ 200. **À ÉTENDRE
    (Manager-B) : exposer `disposition`/`notes` (déjà `cl.*`) + filtre
    `?disposition=`.**
  - **`handlePlaceCall`** (l.254) : click-to-call (capGuard leads.write, lead
    borné, wiring `findOrCreateConversation 'voice'` + activity `call_logged`).
    **GELÉ — NE PAS toucher.**
  - **`handleVoiceIvrTwiml`** (l.519) : TwiML IVR public. **GELÉ.**
  - **`handleCallStatusCallback`** (l.618) : webhook Twilio public, UPDATE
    `call_logs` par `twilio_sid`, recording + transcription Whisper, **réponse 200
    TOUJOURS**. **À ÉTENDRE (Manager-B) : appel manqué → tâche.**
- `src/lib/api.ts` — `CallLog` interface (l.6272, ÉTENDUE Phase A : `+disposition`
  `+notes`), `getCallLogs(leadId?)` (l.6305, accepte DÉJÀ lead_id), `placeCall`
  (l.6310). **READ/IMPORT (front).**
- `src/pages/LeadDetail.tsx` — UI journal d'appels + click-to-call EXISTANTE. **À
  ÉTENDRE (Manager-C).**
- Table `tasks` (seq 5, `migration-phase5.sql` l.35) — **SANS FK applicative
  utilisée** (`lead_id` a un `REFERENCES leads ON DELETE SET NULL` natif, mais
  l'INSERT « manqué→tâche » est best-effort), colonnes ci-dessous (§0).

**GAPS comblés :**
- **(A)** aucune **disposition** post-appel ni **notes** sur `call_logs` → 2 colonnes
  NULLABLES seq 116 + route `POST /api/calls/:id/disposition` + helper
  `setCallDisposition`.
- **(B)** **appel manqué → tâche** : `handleCallStatusCallback` MAJ le status mais
  ne crée RIEN sur un `no-answer`/`failed`/`busy` → Manager-B AJOUTE l'INSERT
  best-effort (tâche OU activity_log), **réponse 200 préservée**.
- **(C)** pas de **page Téléphonie dédiée** (journal global filtrable) → NEUVE
  `src/pages/Telephonie.tsx` (Manager-C) via `getCallLogs` + filtres.
- **(D)** click-to-call absent de l'**Inbox** → (optionnel) `MessageThread.tsx`
  canal voice via `placeCall` (Manager-C).

Alias : imports worker **RELATIFS** (`./...`), JAMAIS `@/`. Front `@/`.

---

## §0 — AUDIT DISQUE (le code fait foi — à RÉUTILISER)

### `src/worker/telephony.ts` — `handleGetCallLogs` (l.205, À ÉTENDRE Manager-B)

```ts
export async function handleGetCallLogs(
  env: Env,
  auth: TelephonyAuth,        // = CapAuth & { capabilities?: Set<string> }
  url: URL,
): Promise<Response>;
//   PAS de capGuard (lecture journal, déjà bornée tenant). Route GET /api/calls.
//   clientId = await resolveClientId(env, auth);  ← serveur, JAMAIS body/query.
//   SELECT cl.*, l.name AS lead_name FROM call_logs cl
//     LEFT JOIN leads l ON cl.lead_id = l.id WHERE 1=1
//     [+ AND cl.client_id = ?  si clientId]      ← bornage tenant (admin = null)
//     [+ AND cl.lead_id = ?    si ?lead_id=]      ← sanitizeInput(.,64)
//     [+ AND cl.direction = ?  si ?direction=]    ← sanitizeInput(.,16)
//     ORDER BY cl.created_at DESC LIMIT ? (≤ 200).
//   try/catch → json({ data: res.results ?? [] }) ; catch → json({ data: [] }).
```
⚠ **`cl.*` expose DÉJÀ `disposition`/`notes`** une fois la migration seq 116
appliquée — Manager-B n'a qu'à AJOUTER le filtre `?disposition=`
(`sanitizeInput(.,32)`, `+ AND cl.disposition = ?`) ; aucun changement de SELECT
nécessaire pour l'exposition. **Ne PAS retirer les filtres `lead_id`/`direction`.**

### `src/worker/telephony.ts` — `handleCallStatusCallback` (l.618, À ÉTENDRE Manager-B)

```ts
export async function handleCallStatusCallback(
  request: Request,
  env: Env,
): Promise<Response>;
//   PUBLIC (webhook Twilio, AVANT auth dans worker.ts:909-911). PAS d'auth
//   applicative — bornage par twilio_sid (corrèle à un call_log déjà créé tenant).
//   Lit form-urlencoded : CallSid, CallStatus, CallDuration, RecordingUrl.
//   - !CallSid → return new Response('OK', { status: 200 });  (accusé inerte)
//   - UPDATE call_logs SET status = ?, duration_sec = ? WHERE twilio_sid = ?
//   - si RecordingUrl : (OPENAI_API_KEY ? Whisper : skip) puis
//     UPDATE call_logs SET recording_url = ?, transcription = ? WHERE twilio_sid = ?
//   - return new Response('OK', { status: 200 });   ← TOUJOURS 200, jamais throw.
```
⚠ **Réponse 200 TOUJOURS** (Twilio ne doit jamais recevoir 4xx/5xx). Manager-B
INSÈRE le « manqué→tâche » **best-effort** (try/catch silencieux) APRÈS le UPDATE
status, **SANS** changer la réponse 200 ni jeter. Détection : `CallStatus ∈
{'no-answer','failed','busy'}`. Pour retrouver le tenant + le lead : `SELECT
client_id, lead_id, to_number FROM call_logs WHERE twilio_sid = ?` (le call_log a
été créé par `handlePlaceCall`).

### Table `tasks` (seq 5 — `migration-phase5.sql` l.35) — colonnes pour « manqué→tâche »

```sql
tasks (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title       TEXT NOT NULL,                                  -- ⚠ NOT NULL
  description TEXT DEFAULT '',
  due_date    TEXT,
  priority    TEXT CHECK (priority IN ('high','medium','low')) DEFAULT 'medium',
  status      TEXT CHECK (status IN ('todo','in_progress','done')) DEFAULT 'todo',
  lead_id     TEXT REFERENCES leads(id) ON DELETE SET NULL,
  client_id   TEXT,
  assigned_to TEXT,
  created_by  TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
```
⚠ **`title` est NOT NULL** → l'INSERT « manqué→tâche » DOIT fournir un `title`
non-NULL (ex `'Rappeler — appel manqué'`). **`priority`/`status` ont un CHECK** →
si renseignés, valeurs ∈ whitelist (ou laisser le DEFAULT). `lead_id` peut être
NULL (call_log non rattaché). `client_id` = celui du call_log. INSERT
**best-effort** (try/catch — table/colonne absente ⇒ no-op, jamais throw).
**Alternative autorisée** : si Manager-B préfère ne pas créer de tâche, écrire un
`activity_log` `call_missed` (calque `handlePlaceCall` l.377-387 :
`INSERT INTO activity_log (lead_id, client_id, user_id, action, details)`). Dans
le webhook public il n'y a PAS de `user_id` (mettre `null`). Best-effort.

### `findOrCreateConversation` (`./conversations`, RÉUTILISÉ) + `resolveClientId`

`findOrCreateConversation(env, leadId, clientId, 'voice')` → conversation_id (canal
`'voice'`). `resolveClientId(env, auth)` → client_id serveur (admin null). **NE PAS
réécrire — importer/réutiliser.**

### Colonnes ADDITIVES (seq 116 — manifestée)

```sql
ALTER TABLE call_logs ADD COLUMN disposition TEXT;   -- NULLABLE, validé HANDLER
ALTER TABLE call_logs ADD COLUMN notes       TEXT;   -- NULLABLE, sanitizeInput
CREATE INDEX IF NOT EXISTS idx_call_logs_disposition ON call_logs(client_id, disposition);
```
`recording_url`/`transcription` **existent DÉJÀ** (seq 102, l.58) — **NE PAS
re-ajouter**. Zéro CHECK / FK / DROP / RENAME / rebuild. `disposition` valeur LIBRE
validée HANDLER (whitelist JS), JAMAIS par CHECK SQL.

---

## §1 — MIGRATION (seq 116, ADDITIVE)

`migration-telephony-disposition-seq116.sql` (racine) — calque l'en-tête seq 102 :
2 `ALTER TABLE call_logs ADD COLUMN` (NULLABLES, sans DEFAULT non-NULL, sans CHECK)
+ 1 `CREATE INDEX IF NOT EXISTS idx_call_logs_disposition(client_id, disposition)`.
**ZÉRO CHECK, ZÉRO FK, ZÉRO DROP/RENAME/rebuild, ZÉRO `CREATE TABLE call_logs`,
ZÉRO re-ajout `recording_url`/`transcription`.** Manifestée
`docs/migrations-manifest.json` seq 116
(`depends_on:["migration-reporttemplates-seq115.sql"]`, objects
`["alter:call_logs","index:call_logs"]`, risk low). ⚠ **NE touche NI `ivr_menus`
NI `leads` NI `tasks` NI `activity_log` NI `clients` NI `users`.**

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helper (FIGÉ Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **INCHANGÉS**. Succès =
**`json({ data })`** ; erreur = **`json({ error }, status)`**. **JAMAIS de champ
`code`**. **AUCUN helper n'envoie de `client_id`** (tenant re-borné worker-side).

```ts
// Disposition post-appel (signature FIGÉE Phase A).
setCallDisposition(
  callLogId: string,
  payload: { disposition?: string; notes?: string },
): Promise<ApiResponse<{ success: boolean }>>
//   → apiFetch('/calls/'+encodeURIComponent(id)+'/disposition',
//              { method:'POST', body: JSON.stringify(payload) })
```
⚠ `getCallLogs(leadId?)` est INCHANGÉ (accepte DÉJÀ lead_id). Pour le journal
global filtré par disposition, Manager-C peut appeler `apiFetch('/calls?disposition=…')`
ou `apiFetch('/calls?direction=…')` directement (le worker accepte ces query —
§6.H Manager-B). **NE PAS modifier `api.ts` (FIGÉ Phase A).**

### §6.B — Type `CallLog` (`src/lib/api.ts`, ÉTENDU Phase A) — ApiResponse INCHANGÉ

```ts
export interface CallLog {
  …                          // champs seq 102 INCHANGÉS
  recording_url: string | null;
  transcription: string | null;
  twilio_sid: string | null;
  created_at: string | null;
  disposition: string | null;   // ← ADDITIF seq 116
  notes: string | null;         // ← ADDITIF seq 116
}
```

### §6.C — Route worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

| Route | Méthode | Handler (`./worker/telephony`) | capGuard |
|---|---|---|---|
| `/api/calls/:id/disposition` | POST | `handleSetCallDisposition(request, env, auth, id)` | `leads.write` |

Placée dans la section **TELEPHONY-F** (APRÈS `/api/calls` POST, AVANT
`/api/ivr-menus`), **APRÈS `requireAuth`**. Import dynamique
`await import('./worker/telephony')` (calque les routes `/api/calls` existantes).
**Anti-shadowing** : `/api/calls/:id/disposition` est un path EXACT
(`/^\/api\/calls\/([^/]+)\/disposition$/`) déclaré APRÈS `/api/calls` (collection)
— pas de chevauchement. capGuard appliqué **DANS le handler** (pas dans le routeur).
⚠ Les routes `/api/calls` (GET/POST), `/api/ivr-menus*`, `/api/voice/*` sont
**INTOUCHÉES**.

### §6.E — Stub (`src/worker/telephony.ts` — owned Manager-B, stub posé Phase A)

Signature **FIGÉE Phase A**, corps Phase B. Type auth :
`TelephonyAuth = CapAuth & { capabilities?: Set<string> }` (existant l.69). Garde
`requireCapability(auth.capabilities, 'leads.write')`. `resolveClientId(env, auth)`
réutilisé (auth, JAMAIS body).

```ts
handleSetCallDisposition(request, env, auth, id): Promise<Response>
//   capGuard leads.write + stub json({ data: { success: true } })
//   + // Manager-B: corps réel
```

### §6.F — i18n (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, FIGÉ Phase A)

Namespace `telephony.*` (ÉTENDU) — **11 clés ×4, parité STRICTE**, insérées APRÈS
`telephony.transcription` (clés AVANT usage) :
`telephony.disposition.label`, `.interested`, `.callback`, `.voicemail`,
`.wrong_number`, `.not_interested`, `telephony.notes.label`, `telephony.notes.save`,
`telephony.missed.title`, `telephony.page.title`,
`telephony.page.filter_disposition`. fr-CA tutoiement / fr-FR vouvoiement.
**Manager-C les CONSOMME, n'en AJOUTE PAS** (i18n GELÉ Phase A). ⚠ **NE PAS
modifier les 17 clés `telephony.*` existantes.** Source VIVANTE = `src/lib/i18n/*.ts`
(PAS `.json` legacy).

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned : **`src/worker/telephony.ts` UNIQUEMENT** —
  - **`handleSetCallDisposition`** (corps réel du stub) : `resolveClientId`
    (serveur, JAMAIS body) ; parse `{ disposition?, notes? }` ; `disposition`
    **VALIDÉE HANDLER** (whitelist JS : `interested|callback|voicemail|
    wrong_number|not_interested|…`, hors whitelist ⇒ ignorer/400) ; `notes` via
    `sanitizeInput` ; `UPDATE call_logs SET disposition = ?, notes = ? WHERE id = ?
    AND client_id = ?` (**borné tenant** ; admin non borné, calque `resolveClientId`).
    best-effort (colonne seq 116 absente / row absente → réponse propre, jamais
    500 brut). `json({ data: { success: true } })`.
  - **ÉTENDRE `handleGetCallLogs`** : exposer `disposition`/`notes` (déjà `cl.*`)
    + AJOUTER filtre `?disposition=` (`sanitizeInput(.,32)`, `+ AND cl.disposition = ?`).
    **NE PAS retirer** les filtres `lead_id`/`direction`, NI changer le bornage.
  - **« manqué→tâche »** dans `handleCallStatusCallback` : si `CallStatus ∈
    {'no-answer','failed','busy'}` → `INSERT tasks` best-effort (`title` NOT NULL
    fourni ; `client_id`/`lead_id` issus du `SELECT … FROM call_logs WHERE
    twilio_sid = ?`) **OU** `activity_log` `call_missed` (user_id null dans le
    webhook public). **GARDER la réponse 200 TOUJOURS**, try/catch silencieux,
    jamais throw.
  - (optionnel, flag `ANTHROPIC_API_KEY`) résumé Claude de la `transcription`
    (best-effort, n'altère pas la réponse 200).
  - **NE PAS casser** `placeCall` (flag inactif) / `handlePlaceCall` / IVR TwiML /
    `handleCallStatusCallback` status existant / `logCall` / `resolveClientId`.
    Jamais 500 brut. + tests `__tests__/`.
- **Manager-C (frontend)** owned :
  - **`src/pages/LeadDetail.tsx`** : sur CHAQUE call_log du journal — sélecteur
    **disposition** (`telephony.disposition.*`) + champ **notes**
    (`telephony.notes.label` / `.save`) → `setCallDisposition(id, { disposition,
    notes })` ; afficher la `disposition`/`notes` persistées. **Additif — NE PAS
    casser le journal/click-to-call existants.**
  - **`src/pages/Telephonie.tsx`** (NEUF) : journal global filtrable
    direction/disposition/lead via `getCallLogs` (+ `apiFetch('/calls?disposition=…')`
    pour le filtre). i18n `telephony.page.*`.
  - **`src/App.tsx`** : route `/telephonie` (additif).
  - **`src/components/.../Sidebar.tsx`** : entrée « Téléphonie » (`telephony.page.title`).
  - (optionnel) **`src/components/Inbox/MessageThread.tsx`** : click-to-call canal
    voice via `placeCall`.
- **INTERDITS aux deux** : migration, manifest, **`src/lib/api.ts`** (CallLog +
  `setCallDisposition` FIGÉS), **`src/lib/types.ts`**, **`src/worker.ts`**,
  **i18n ×4**, **`src/index.css`** ; **`src/worker/voice.ts`** (voicemail) /
  **`src/worker/messages.ts`** / **`src/worker/twilio-verify.ts`** /
  **`src/worker/conversations.ts`** (lecture/import SEULEMENT — `findOrCreateConversation`).
  **`telephony.ts` = Manager-B** (Manager-C ne le touche PAS) ;
  `LeadDetail.tsx` / `Telephonie.tsx` / `App.tsx` / `Sidebar.tsx` /
  `MessageThread.tsx` = **Manager-C** (Manager-B ne les touche PAS).
  **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **`ALTER TABLE … ADD COLUMN`, PAS de rebuild.** Colonnes NULLABLES, sans
   DEFAULT non-NULL, sans CHECK, sans FK ⇒ ajout in-place (zéro rebuild
   `call_logs`). **JAMAIS `CREATE TABLE call_logs`.**
2. **Manifest seq 116 — chemin MANIFEST-DRIVEN.** Entrée seq 116 posée Phase A
   (NE PAS la modifier). `scripts/migrate.ts` FIGÉ. ✔ vérifié : virgule seq 115
   ajoutée, JSON valide.
3. **CHECK / FK INTERDITS** dans la migration (`disposition` validé HANDLER).
   Zéro DROP / RENAME.
4. **Twilio flag INACTIF** maintenu : `placeCall` garde le garde credentials
   (mock sans secrets). **NE PAS activer.** `verifyTwilioSignature` existe ;
   E4/E6 inactifs.
5. **NE PAS casser** : `telephony.ts` (placeCall/handlePlaceCall/IVR/status),
   `voice.ts` (voicemail), IVR TwiML, SMS Sprint 3 (`messages.ts`/`twilio-verify.ts`).
6. **`handleCallStatusCallback` garde la réponse 200 TOUJOURS** (webhook Twilio).
   Le « manqué→tâche » est best-effort try/catch, jamais throw, n'altère pas le 200.
7. **`tasks.title` est NOT NULL** + CHECK sur `priority`/`status` → INSERT
   « manqué→tâche » fournit un `title` non-NULL, valeurs CHECK whitelistées (ou
   DEFAULT). best-effort.
8. **`recording_url`/`transcription` existent DÉJÀ** (seq 102) — **NE PAS les
   re-ajouter** dans la migration.
9. **BORNAGE TENANT depuis l'AUTH** (`resolveClientId`), JAMAIS le body/URL.
   UPDATE `WHERE id = ? AND client_id = ?`.
10. **Capability** : `leads.write` (click-to-call/disposition), `settings.manage`
    (IVR). **ZÉRO ajout à `ALL_CAPABILITIES`** (PAS de `telephony.*` capability).
11. **Alias relatifs worker** (`./...`), front `@/`. Routes worker = import
    dynamique (calque `/api/calls`).
12. **i18n `.ts` (PAS `.json`)** — `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, parité
    stricte (11 clés ×4), GELÉE Phase A. **Les 17 clés `telephony.*` existantes
    INTOUCHÉES.**

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-22)

Fichiers **créés** :
1. `migration-telephony-disposition-seq116.sql` — 2 `ALTER TABLE call_logs ADD
   COLUMN disposition/notes` (NULLABLES, sans DEFAULT/CHECK) + index
   `idx_call_logs_disposition(client_id, disposition)`, ADDITIF (calque en-tête
   seq 102). Zéro CHECK/FK/DROP/RENAME/rebuild. `recording_url`/`transcription`
   NON re-ajoutées. Ne touche NI ivr_menus NI leads NI tasks.
3. `docs/LOT-TELEPHONY-DISPOSITION.md` — ce document (§6 FIGÉ).

Fichiers **modifiés** (rigoureusement ADDITIFS) :
1. `docs/migrations-manifest.json` — entrée seq 116 (virgule seq 115 ajoutée,
   JSON valide vérifié, `depends_on:["migration-reporttemplates-seq115.sql"]`,
   objects `["alter:call_logs","index:call_logs"]`, risk low).
2. `src/lib/api.ts` — `CallLog` ÉTENDU (`+disposition` `+notes`) ;
   `setCallDisposition(callLogId, { disposition?, notes? })` NEUF (POST
   `/calls/:id/disposition`). `getCallLogs` documenté (filtre disposition optionnel
   worker-side). apiFetch/ApiResponse INCHANGÉS. AUCUN client_id envoyé.
3. `src/worker.ts` — 1 route `POST /api/calls/:id/disposition` →
   `handleSetCallDisposition` (import dynamique, capGuard côté handler,
   anti-shadowing path exact APRÈS `/api/calls`). Routes existantes INTOUCHÉES.
4. `src/worker/telephony.ts` — stub `handleSetCallDisposition(request, env, auth,
   id)` en fin de fichier (signature FIGÉE, capGuard leads.write, corps stub
   `json({ data: { success: true } })` + `// Manager-B: corps réel`). RÉUTILISE
   `requireCapability` / `resolveClientId` existants. Reste du fichier INTOUCHÉ.
5. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 11 clés `telephony.*` ADDITIVES (après
   `telephony.transcription`), parité stricte ×4 vérifiée, clés AVANT usage,
   fr-CA tutoiement / fr-FR vouvoiement. Les 17 clés existantes INTOUCHÉES.

**Migration** : seq 116 ADDITIVE, manifestée (manifest-driven). **Build** : non
vérifié (VMware sans bun/node) — **délégué côté hôte**.

### Confirmations garde-fous
- **Migration ADDITIVE** : 2 `ALTER ADD COLUMN` (NULLABLES) + 1 index, zéro
  CHECK/FK/DROP/RENAME/rebuild, zéro `CREATE TABLE call_logs`, zéro re-ajout
  recording_url/transcription. Manifest seq 116 (depends_on seq 115) valide.
- **Existant INTOUCHÉ** : `placeCall` (flag inactif), `handlePlaceCall`,
  `handleGetCallLogs`, `handleCallStatusCallback` (200), IVR TwiML, `voice.ts`,
  SMS Sprint 3 — lecture/réutilisation.
- **ApiResponse INCHANGÉ** (`{ data }` / `{ error }`, jamais `code`).
- **Capabilities** `leads.write` (disposition) / `settings.manage` (IVR)
  RÉUTILISÉES — **ZÉRO ajout à `ALL_CAPABILITIES`**.
- **Twilio flag INACTIF** maintenu (mock sans secrets).
- **i18n** : source VIVANTE `src/lib/i18n/*.ts`, parité 11 clés ×4, 17 clés
  existantes intouchées.

### Écarts CODE > brief
- **`call_logs.id` = TEXT** (seq 102, `lower(hex(randomblob(16)))` ; `logCall`
  utilise `crypto.randomUUID()`) — cohérent : `setCallDisposition(callLogId:
  string)` et la route `/:id/disposition` traitent l'id en string.
- **`handleGetCallLogs` n'a PAS de capGuard** (lecture journal bornée tenant) —
  inchangé ; Manager-B AJOUTE seulement le filtre `?disposition=`, pas de garde.
- **Webhook public `handleCallStatusCallback` sans `user_id`** : l'`activity_log`
  `call_missed` (option) doit passer `user_id = null` (pas d'auth dans le webhook).
- **`tasks.title` NOT NULL + CHECK priority/status** : l'INSERT « manqué→tâche »
  fournit un `title` non-NULL et des valeurs CHECK whitelistées (ou DEFAULT).
- **Stub `handleSetCallDisposition` retourne 200** (`{ data: { success: true } }`,
  pas 201 — MAJ d'un call_log existant, pas une création).
