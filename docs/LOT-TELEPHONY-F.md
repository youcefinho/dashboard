# LOT TELEPHONY-F — Téléphonie 2-way (fondations)

Sprint F. Module NEUF `telephony.ts` : call_logs structurés + IVR config + génération
TwiML + click-to-call sortant. **voice.ts (voicemail entrant prod) INTOUCHÉ.**

Méthode : Chaman READ-ONLY → **Phase A SOLO (Manager-A)** → Phase B (Manager-B
backend corps complets ∥ Manager-C pages). Build délégué Antigravity (VM sans
bun/node).

---

## §0 — Audit (état initial vérifié)

- `voice.ts` = voicemail entrant SEUL (TwiML `<Record>` + Whisper + `findOrCreateConversation`
  + INSERT `messages` voice inbound). Pas d'appel sortant / IVR / call_logs.
- Credentials Twilio : `types.ts` `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` /
  `TWILIO_PHONE_NUMBER`. **`helpers.ts:sendSms:90-123` = PATTERN FLAG de référence**
  (`if (!ACCOUNT_SID||!AUTH_TOKEN||!PHONE_NUMBER) return {success:false}` early-return,
  appel API Basic-auth gardé). CALQUE EXACT pour `placeCall`.
- `sub_accounts.twilio_phone` (numéro par tenant) + `clients.phone` fallback = clé de
  résolution tenant (déjà dans voice.ts:10,44).
- `call_logs` / `ivr_menus` ABSENTS. Routes webhook publiques worker.ts ~709-711
  `/api/voice/twiml` + `/api/voice/webhook/record` (NE PAS écraser).
- Dernière migration manifest = **seq 101** (`migration-portal-seq101.sql`) → **seq 102 libre**.
- `leads.write` ∈ ALL_CAPABILITIES (capabilities.ts:38) / `settings.manage` ∈ (capabilities.ts:47).
- Bornage tenant de référence : `conversations.ts:27` (`auth.role !== 'admin'` → lookup
  `users.client_id` → `WHERE c.client_id = ?`).
- Choke-point capabilities worker.ts:943 (`resolveCapabilities` → `authCtx.capabilities`).
- `findOrCreateConversation(env, leadId, clientId, channel)` = conversations.ts:287
  (réutilisé par le wiring CRM Phase B).

---

## §6.A — Archi (tranché)

- **MODULE NEUF `telephony.ts`** (voice.ts intouché, pas de régression voicemail prod).
- 2 tables : `call_logs` (entrants + sortants, lead_id/conversation_id nullable, zéro FK)
  + `ivr_menus` (config_json sérialisé, is_active).
- v1 = (a) call_logs structurés [socle] + (b) IVR config + TwiML [codable] + (c) click-to-call
  sortant [logique codée, appel API gardé flag]. **(d) power dialer = v2 (HORS scope).**
- **Flag inactif** : tout appel Twilio réel précédé du garde `sendSms` (`if !credentials
  return {success:false, mock:true}`) → **call_log créé QUAND MÊME** (status 'mock'/'queued').
  Logique testable sans credentials.
- Wiring CRM (Phase B) : call_log → `findOrCreateConversation(env, leadId, clientId, 'voice')`
  + INSERT `messages` + activity `call_logged`. lead_id résolu par `leads.phone` lookup
  (calque voice.ts:50-61).
- Capability : `leads.write` (click-to-call) / `settings.manage` (IVR config) réutilisées.
  **ZÉRO ajout ALL_CAPABILITIES.** Bornage tenant strict (client_id partout).

---

## §6.B — Migration seq 102 (`migration-telephony-seq102.sql`, depends 101)

2 `CREATE TABLE IF NOT EXISTS` + 4 `CREATE INDEX IF NOT EXISTS`. Zéro FK / CHECK / ALTER.
Timestamps `datetime('now')`, id `lower(hex(randomblob(16)))`. En-tête garde-fous calque seq 101.

Tables : `call_logs(id, client_id, agency_id, lead_id, conversation_id, direction,
from_number, to_number, status, duration_sec INTEGER, recording_url, transcription,
twilio_sid, created_at)` + `ivr_menus(id, client_id, agency_id, name, config_json, is_active
INTEGER DEFAULT 1, created_at)`.

Index : `idx_call_logs_client(client_id, created_at)`, `idx_call_logs_lead(lead_id)`,
`idx_ivr_menus_client(client_id)`, `idx_call_logs_sid(twilio_sid)`.

**Manifest** : `{ "seq": 102, "file": "migration-telephony-seq102.sql", "depends_on":
["migration-portal-seq101.sql"], "objects": ["table:call_logs","table:ivr_menus",
"index:call_logs","index:ivr_menus"], "risk": "low" }`.

---

## §6.C — Backend (`telephony.ts`)

| Handler | Type | Capability | Phase A |
|---|---|---|---|
| `handleGetCallLogs(env, auth, url)` | protégé | (lecture bornée) | STUB liste bornée tenant simple (filtres lead_id/direction). Corps agrégation JOIN = Phase B. |
| `handlePlaceCall(request, env, auth)` | protégé | `leads.write` | STUB : pose call_log outbound `queued` (flag inactif → mock). Résolution numéro + placeCall + wiring = Phase B. |
| `handleGetIvrMenus(env, auth, url)` | protégé | `settings.manage` | **RÉEL** liste bornée tenant. |
| `handleSaveIvrMenu(request, env, auth)` | protégé | `settings.manage` | **RÉEL** INSERT/UPDATE borné tenant. |
| `handleDeleteIvrMenu(env, auth, menuId)` | protégé | `settings.manage` | **RÉEL** DELETE borné tenant. |
| `handleVoiceIvrTwiml(request, env)` | PUBLIC | — | STUB TwiML fallback sûr (Say+Hangup). Génération Gather/options depuis config_json = Phase B. |
| `handleCallStatusCallback(request, env)` | PUBLIC | — | STUB accusé 200 OK. MAJ call_logs.status/duration par CallSid = Phase B. |

Helpers (corps réels Phase A, gardés flag) :
- `placeCall(env, to, from, twiml)` — appel Twilio `Calls.json` Basic-auth gardé flag
  (calque sendSms). Sans credentials → `{success:false, mock:true}` SANS réseau.
- `logCall(env, {...})` — INSERT structuré `call_logs` best-effort (jamais throw).
- `escapeXml(input)` — anti-injection XML pour le TwiML.
- `resolveClientId(env, auth)` — bornage tenant (calque conversations.ts:28).

**Routes worker.ts** :
- PUBLIQUES (AVANT auth, après les voice webhooks ~711, NE PAS écraser) :
  `GET|POST /api/voice/ivr/:menuId`, `POST /api/voice/status-callback`.
- PROTÉGÉES (routeProtected, après `/api/messages`) : `GET /api/calls`, `POST /api/calls`,
  `GET /api/ivr-menus`, `POST /api/ivr-menus`, `DELETE /api/ivr-menus/:id`.

---

## §6.D — api.ts

`getCallLogs(leadId?)`, `placeCall(leadId)`, `getIvrMenus()`, `saveIvrMenu(data)`,
`deleteIvrMenu(id)`. Types `CallLog` / `IvrMenu`. Calque `sendSms:2074`. **ApiResponse INCHANGÉ**
(jamais de champ `code`).

---

## §6.E — i18n `telephony.*` ×4 (parité stricte)

15 clés par catalogue (fr-CA / en / fr-FR / es) : `calllog.title|empty`,
`direction.inbound|outbound`, `status.queued|ringing|completed|failed|noanswer|mock`,
`clicktocall.action`, `ivr.title|config|option`, `notconfigured`. **Parité vérifiée
(diff identique sur les 4).**

---

## §6.F — Pages (Phase B Manager-C)

- Section `call_logs` dans la fiche lead detail (page R cœur — INTOUCHÉE en Phase A).
- Config IVR dans Settings.
- Inbox = rien (les appels arrivent déjà comme messages voice via voice.ts).

---

## §6.G — Découpage

- **Phase A SOLO (FAIT)** : migration + manifest + `telephony.ts` (schéma + helpers
  placeCall/logCall gardés flag + CRUD ivr RÉEL + stubs agrégateurs/TwiML + types)
  + routes worker.ts (publiques + protégées) + api.ts + i18n ×4 + doc.
- **Phase B Manager-B** : corps `handleGetCallLogs` (agrégation) + `handlePlaceCall`
  (résolution numéro + placeCall + wiring CRM) + `handleVoiceIvrTwiml` (génération
  TwiML depuis config_json) + `handleCallStatusCallback` (MAJ call_logs par CallSid)
  + wiring CRM `logCall` complet. Signatures FIGÉES Phase A — NE CHANGENT PAS.
- **Phase B Manager-C** : section call_logs lead detail + config IVR settings.

---

## §6.I — Garde-fous

Additif / CHECK59 intact / E4-E6 jamais touchés · **appels Twilio réels FLAG INACTIF**
(calque sendSms, call_log mock sans credentials) · bornage tenant strict (client_id
partout, `auth.role !== 'admin'` calque conversations) · ZÉRO ajout ALL_CAPABILITIES
(leads.write / settings.manage) · ApiResponse inchangé · zéro FK · `datetime('now')` ·
routes webhook publiques sans collision (`/api/voice/twiml` + `/api/voice/webhook/record`
préservées) · **voice.ts INTOUCHÉ** · parité i18n ×4 · jamais git.

---

## §7 — IMPLEMENTATION-LOG Phase B Manager-B (backend corps complets)

Périmètre EXCLUSIF écrit : `src/worker/telephony.ts` (corps des 4 handlers stubs) +
ce doc. Signatures Phase A FIGÉES — INCHANGÉES. Manager-C (pages) DISJOINT.

### Import ajouté
- `import { findOrCreateConversation } from './conversations';` (wiring CRM click-to-call).

### `handleGetCallLogs(env, auth, url)` — agrégation
- `SELECT cl.*, l.name AS lead_name FROM call_logs cl LEFT JOIN leads l ON cl.lead_id = l.id`.
- Bornage tenant : `resolveClientId` → `AND cl.client_id = ?` (jamais body/query).
- Filtres `?lead_id=` / `?direction=` (sanitizeInput), `ORDER BY cl.created_at DESC LIMIT`.
- best-effort : table seq 102 absente → `{ data: [] }`.

### `handlePlaceCall(request, env, auth)` — click-to-call (FLAG INACTIF)
- `requireCapability(auth.capabilities, 'leads.write')` (mode-agence-only calque).
- Body `{ lead_id }` UNIQUEMENT (pas de `to` accepté du client — anti-spoof numéro).
- Lead résolu BORNÉ tenant (`WHERE id = ? AND client_id = ?`) → `to_number = leads.phone`.
- `from_number` = `sub_accounts.twilio_phone` du tenant, fallback `clients.phone` (best-effort).
- `logCall` posé QUAND MÊME (`status:'queued'`) AVANT l'appel.
- TwiML `<Dial>` (escapeXml sur le numéro). `placeCall` gardé flag : sans credentials →
  `mock:true`, AUCUN appel réseau, call_log → `status='mock'`. Avec credentials succès →
  `'ringing'` + `twilio_sid`. Échec/numéro manquant → `'failed'`.
- MAJ call_log (status/twilio_sid) best-effort. Wiring CRM : `findOrCreateConversation(
  env, leadId, tenantClientId, 'voice')` (calque voice.ts:97) + `conversation_id` lié au
  call_log + activity `call_logged` (best-effort, jamais throw).

### `handleVoiceIvrTwiml(request, env)` — PUBLIC, génération TwiML
- Menu résolu par `:menuId` OU `To → tenant (clients.phone / sub_accounts.twilio_phone)
  → ivr_menus actif`. SELECT borné `is_active = 1`.
- Parse `config_json {greeting, options:[{digit, action, target}]}` best-effort.
- Premier passage (aucun `Digits`) → `<Gather numDigits=1 action=<pathname>><Say>greeting`.
- Réponse digit → option : `dial` → `<Dial>target` ; `voicemail` → `<Record
  action="/api/voice/webhook/record">` (réutilise le flux voice.ts). Digit inconnu →
  `<Redirect>` rejoue le menu.
- **escapeXml sur TOUTES les valeurs dynamiques** (greeting, target, pathname) — anti-injection.
- Menu absent / config illisible → `<Say>` fallback sûr. Réponse `text/xml`.

### `handleCallStatusCallback(request, env)` — PUBLIC, webhook Twilio
- formData `CallSid` / `CallStatus` / `CallDuration` (+ `RecordingUrl` éventuel).
- `UPDATE call_logs SET status, duration_sec WHERE twilio_sid = CallSid` — **borné par le
  SID** (corrèle au call_log déjà créé côté tenant ; pas d'auth applicative — webhook).
- `RecordingUrl` présent → `recording_url` + transcription Whisper (calque voice.ts:64-94)
  si `OPENAI_API_KEY`, sinon URL seule. best-effort, réponse 200 toujours.

### Confirmations garde-fous
- **Flag inactif** : `placeCall` garde credentials (helpers.ts:sendSms calque) ; call_log
  posé `mock`/`queued` SANS appel réel tant que les secrets Twilio sont absents.
- **Bornage tenant** : `client_id` résolu serveur (`resolveClientId` / `lead.client_id`),
  JAMAIS depuis le body ; status-callback borné par `twilio_sid`.
- **voice.ts INTOUCHÉ** (zéro édition ; uniquement réutilisation du webhook `/record`).
- **escapeXml** sur toutes les valeurs TwiML dynamiques (anti-injection).
- best-effort partout (jamais 500 sur les chemins publics/lecture).
- Zéro ajout `ALL_CAPABILITIES` (leads.write / settings.manage réutilisées).
- `ApiResponse` inchangé (jamais de champ `code`). Pages Manager-C : zéro touch.

---

## §8 — IMPLEMENTATION-LOG Phase B Manager-C (front : LeadDetail + IVR settings)

Périmètre EXCLUSIF écrit : `src/pages/LeadDetail.tsx` (section Appels ultra-ciblée
additive) + `src/pages/Settings.tsx` (tab `telephonie` + composant inline
`TelephonySettings`) + ce doc. **`src/index.css` NON touché** (aucune classe neuve —
réutilisation des tokens existants + utilitaires Tailwind). Backend / worker / api.ts /
types.ts / i18n / migration / 5 autres pages R : ZÉRO touch.

### `LeadDetail.tsx` — section « Journal d'appels » (ultra-ciblé additif)
- Imports : ajout `getCallLogs, placeCall, type CallLog` (lib/api) + `PhoneIncoming,
  PhoneOutgoing` (lucide). Pattern d'import existant préservé.
- State additif : `callLogs: CallLog[]` + `isCalling`. Chargé dans le `useEffect` existant
  (`getCallLogs(leadId)` best-effort `.catch(()=>{})`, calque getLeadMessages).
- Handler `handlePlaceCall` → `placeCall(leadId)` :
  - **Cas non-configuré géré** : `res.error` string-match `not configured` / `non config`
    → toast discret `t('telephony.notconfigured')` (ApiResponse inchangé, string-match).
  - **Cas mock** : `res.data?.mock` → toast `clicktocall.action · status.mock`.
  - Succès réel → toast `clicktocall.action`. Rafraîchit le journal après l'appel.
- **Carte « Appels »** insérée dans la colonne latérale, APRÈS la carte « RDV liés », AVANT
  « Score visuel » (calque la carte appointments) : titre `telephony.calllog.title` +
  bouton « Appeler » (`telephony.clicktocall.action`). Liste des call_logs :
  - direction → icône `PhoneIncoming` (success) / `PhoneOutgoing` (brand-primary) + numéro
    (from si inbound, to si outbound),
  - durée formatée `m:ss` (tabular-nums),
  - date `toLocaleString('fr-CA')` (gestion suffixe Z calque appointments),
  - status `Badge` color-coded (completed→success / failed|no-answer→danger /
    ringing|queued→warning / autre→muted) + libellé i18n `telephony.status.*` (clé
    normalisée `no-answer`→`noanswer` ; fallback statut réel si clé absente),
  - `recording_url` → `<audio controls preload="none">`,
  - `transcription` → `<details>` expand.
  - Empty → `telephony.calllog.empty`.
- **FLAG : autres champs / layout / hooks / onglets de LeadDetail INTACTS.** Aucune
  modification des sections existantes (hero, tabs, statut, deal, tags, DND, RDV, score,
  tâches, infos, Loi 25). Seuls les 4 points ci-dessus (import, state, useEffect+handler,
  1 carte) sont additifs.

### `Settings.tsx` — config IVR (section dans page settings existante)
- **Choix d'emplacement** : `App.tsx` GELÉ Phase A et **aucune route IVR posée** (vérifié :
  grep `ivr|telephony` dans App.tsx = 0 match ; pas de `src/pages/Ivr*.tsx`). → section
  dans la page Settings existante (pattern observé : tab + composant inline, calque
  `PacksSettings`). Pas de page neuve / pas de route ajoutée.
- Type `SettingsTab` étendu `| 'telephonie'`. Entrée `TABS` (groupe AVANCÉ, adminOnly,
  icône `PhoneCall`, label `telephony.ivr.title`, desc `telephony.ivr.config`). Case
  `renderContent` → `<TelephonySettings />`. Imports ajoutés : `getIvrMenus, saveIvrMenu,
  deleteIvrMenu, type IvrMenu` (api) + `PhoneCall, Plus, Trash2, Check` (lucide).
- Composant inline `TelephonySettings` :
  - `getIvrMenus()` → liste (loading skeleton calque PacksSettings).
  - Créer / éditer : `name` (Input) + `config_json` (textarea JSON v1, monospace,
    validation `JSON.parse` côté client avant envoi, erreur `JSON invalide`) →
    `saveIvrMenu({ id?, name, config })`.
  - Activer / désactiver : toggle `is_active` via `saveIvrMenu` (re-parse config existante).
  - Supprimer : `useConfirm` (danger) → `deleteIvrMenu(id)`.
  - Empty state → `telephony.notconfigured`.
  - Tag statut actif/inactif réutilise `telephony.status.completed|queued`.

### Vérifications i18n (clés Phase A câblées, AUCUNE créée)
- LeadDetail : `calllog.title`, `calllog.empty`, `clicktocall.action`, `notconfigured`,
  `status.*` (queued/ringing/completed/failed/noanswer/mock), `direction.inbound|outbound`.
- Settings : `ivr.title`, `ivr.config`, `ivr.option`, `notconfigured`, `status.completed`,
  `status.queued`.
- Libellés non couverts par une clé telephony (« Transcription », « Supprimer », « OK »,
  « × ») laissés en littéral neutre (pas de clé inventée, pas de réutilisation trompeuse).

### Confirmations garde-fous
- **LeadDetail ultra-ciblé additif** : autres champs/sections/hooks INTACTS (FLAG confirmé).
- **Config IVR** : section dans `Settings.tsx` (tab `telephonie`), pas de page/route neuve
  (App.tsx gelé, aucune route IVR posée Phase A).
- **i18n** : uniquement clés `telephony.*` posées Phase A câblées, ZÉRO clé créée.
- **Click-to-call gère le cas non-configuré** : string-match `res.error` →
  `telephony.notconfigured` ; cas mock via `res.data.mock` → `status.mock`.
- **Disjonction** : zéro touch worker/telephony.ts/api.ts/types.ts/i18n/migration/voice.ts
  ni 5 autres pages R cœur. `src/index.css` NON modifié (aucune classe neuve).
- SUBTLE Stripe-grade, primitives réutilisées (Card/Button/Badge/Tag/Input/Icon/useConfirm/
  useToast). ApiResponse inchangé (string-match). Build délégué Antigravity.
