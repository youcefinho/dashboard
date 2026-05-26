# LOT EMAIL 5 — Email marketing & séquences pro (Sprint 5)

> Statut : **Phase A SOLO FIGÉE** (socle partagé + §6 verrouillé). Phase B
> (Manager-B backend) ∥ Phase C (Manager-C front) débloquées sur fichiers
> DISJOINTS (matrice §6.H). CODE-COMPLETE only — build/tests délégués au
> hôte Antigravity (VM sans bun/node).

Objectif produit : séquences drip multi-touch (= workflows linéaires,
moteur EXISTANT réutilisé), broadcast programmé + throttle, tracking
open/click (réutilise `tracking.ts`), builder email réutilisé tel quel.

Principe directeur : **rien à recréer**. Le moteur d'automatisation
(`processWorkflowQueue` / `advanceEnrollment` / `executeStep` /
`autoEnrollForTrigger` / `handleEnrollLead`), le builder email
(`email-blocks.ts` / `EmailBuilder.tsx` / compilateur `templates.ts:139`)
et le tracking (`tracking.ts` : pixel `/api/t/o/:id`, redirect
`/api/t/c/:id`, table `message_events` seq 31) sont COMPLETS et RÉUTILISÉS.
AUCUN nouveau scheduler.

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS

`apiFetch` / `ApiResponse` (`src/lib/api.ts:62`) INCHANGÉS — jamais de
champ `code`, contrat `{ data }` / `{ error }` strict. Helpers ADDITIFS
posés Phase A (signatures FIGÉES, Manager-C consomme tel quel) :

- `getSequences()` → `ApiResponse<Workflow[]>`
- `getSequence(id)` → `ApiResponse<Workflow & { steps; enrollments }>`
- `createSequence(seq)` → `ApiResponse<{ id }>` (POST `/sequences`)
- `updateSequence(id, updates)` → `ApiResponse<{ success }>` (PUT `/sequences/:id`)
- `deleteSequence(id)` → `ApiResponse<{ success }>` (DELETE `/sequences/:id`)
- `enrollInSequence(id, leadId)` → `ApiResponse<{ id }>` (POST `/sequences/:id/enroll`)
- `sendBroadcast(params)` ÉTENDU additivement : `filters.tags?`,
  `scheduled_at?: string|null`, `throttle_per_min?: number` (absent ⇒
  comportement legacy byte-identique).
- MICRO-FIX Sprint 4 : `getEcommerceSalesByChannel()` →
  `ApiResponse<EcommerceSalesByChannel>` (GET
  `/ecommerce/analytics/sales-by-channel`).

Types ADDITIFS dans `src/lib/types.ts` : `SalesByChannelRow`,
`EcommerceSalesByChannel` (calque du retour serveur
`ecommerce-analytics.ts:484` : `{ window_days, by_channel }`). Réutilise
`Workflow` / `WorkflowStep` / `WorkflowEnrollment` pour les séquences
(une séquence EST un workflow).

### §6.B — DDL seq 86 (`migration-emailseq-seq86.sql`)

`depends_on: ["migration-booking-seq84.sql"]` (chaînage SÉQUENTIEL ;
seq 85 `migration-promo-seq85.sql` PRISE par Sprint 4 — manifest confirmé
ligne 96 ; seq 86 réservée, manifest ligne 97 ajoutée). STRICTEMENT
ADDITIF :

- `broadcasts` : `+ scheduled_at TEXT` (NULL = immédiat legacy),
  `+ throttle_per_min INTEGER NOT NULL DEFAULT 0` (0 = pas de limite
  legacy), `+ opened INTEGER NOT NULL DEFAULT 0`,
  `+ clicked INTEGER NOT NULL DEFAULT 0`.
- `workflows` : `+ is_sequence INTEGER NOT NULL DEFAULT 0` (0 = workflow
  normal ; flag IGNORÉ par le moteur).
- `messages` : `+ campaign_id TEXT`, `+ campaign_kind TEXT` (NULL =
  hors-campagne legacy ; `campaign_kind` applicatif ∈ {broadcast,sequence},
  PAS de CHECK).
- Index : `idx_messages_campaign`, `idx_broadcasts_scheduled`,
  `idx_workflows_is_sequence` (tous `IF NOT EXISTS`).

**CHECK status `broadcasts` seq 24
(`queued|processing|completed|failed`) INTOUCHABLE** : un broadcast
PROGRAMMÉ = status `queued` (valeur existante) + `scheduled_at` futur ⇒
AUCUNE valeur de statut neuve ⇒ ZÉRO rebuild. Tables `workflows` /
`workflow_steps` / `workflow_enrollments` (CHECK/PK rebuild seq 73)
INTOUCHÉES. **Zéro FK / DROP / RENAME / modif-CHECK.** Aucun touch
`users` / CHECK role seq 59. Aucun touch tables E4/E6 régulées
(`payments`, `payment_events`, `payment_provider_config`, `refunds`,
`disputes`, `return_requests`). En-tête garde-fous + tolérance
duplicate-column recopiés verbatim de `migration-booking-seq84.sql`.

### §6.C — Contrat séquence (moteur EXISTANT, AUCUN code moteur neuf)

Une **séquence = `workflows{is_sequence:1}` + `workflow_steps` linéaires**
(`step_type` ∈ {`send_email`, `wait`}). Exécution intégralement portée
par le moteur EXISTANT, READ-ONLY :

- `processWorkflowQueue(env)` (`workflows.ts:341`) — balayage des
  `workflow_enrollments` `status='active'` + `next_action_at <= now`,
  LIMIT 50. **NE LIT JAMAIS `is_sequence`.**
- `advanceEnrollment(env, e)` (`workflows.ts:427`) — avance step suivant
  via `parent_step_id` + branche. Inchangé.
- `executeStep(env, step, lead, enrollmentId)` (`workflows.ts:533`) —
  case `wait` (`:542`) et case `send_email` (`:561-591`). Inchangé Phase A.
- Enrôlement : `handleEnrollLead` (`workflows.ts:204`) /
  `autoEnroll` (`:298`) / `autoEnrollForTrigger` (`:328`) — RÉUTILISÉS
  tels quels (anti-doublon par entité, premier step, `next_action_at`
  selon `wait`). Le wrapper `sequences.ts` DÉLÈGUE à ces fonctions.

`is_sequence` = drapeau de **classement UI uniquement** :
`handleGetWorkflows` (`SELECT w.*` sans filtre) et le moteur l'ignorent
totalement ⇒ zéro régression cron / @xyflow. Le filtrage
`is_sequence = 1` n'a lieu QUE dans `sequences.ts:handleGetSequences`
(liste UI séquences). AUCUN nouveau scheduler, AUCune nouvelle table
d'exécution, AUCune duplication du moteur.

### §6.D — Handlers / endpoints / bornage / capability

Routes câblées Phase A dans `worker.ts` (juste après le bloc broadcast
`:1006`, AVANT « Booking Pages ») :

| Méthode + path | Handler (`sequences.ts`) |
|---|---|
| `GET /api/sequences` | `handleGetSequences(env, auth, url)` |
| `POST /api/sequences` | `handleCreateSequence(request, env, auth)` |
| `POST /api/sequences/:id/enroll` | `handleEnrollSequence(request, env, auth, id)` |
| `GET /api/sequences/:id` | `handleGetSequenceDetail(env, auth, id)` |
| `PUT /api/sequences/:id` | `handleUpdateSequence(request, env, auth, id)` |
| `DELETE /api/sequences/:id` | `handleDeleteSequence(env, auth, id)` |

(Route `/enroll` matchée AVANT `/:id` générique — ordre voulu, calque du
pattern workflows `worker.ts:872-877`.)

`POST /api/broadcast` (`worker.ts:1005` → `handleEmailBroadcast`) :
route INCHANGÉE. L'enrichissement scheduled_at / throttle / tags est un
ENRICHISSEMENT ADDITIF du **corps** de `handleEmailBroadcast`
(`broadcast.ts`) en Phase B (lecture additive de `body.scheduled_at` /
`body.throttle_per_min` / `body.filters.tags` ; absent ⇒ legacy). Aucun
nouveau endpoint broadcast requis.

Capability : **RÉUTILISE `workflows.manage`** (`capabilities.ts:45`) via
le `capGuard` CONDITIONNEL (`workflows.ts:12` — enforce seulement si
`auth.tenant.agencyId != null && auth.capabilities` ; legacy/mono-tenant ⇒
skip byte-identique). Les handlers `sequences.ts` (corps Phase B) posent
`capGuard(auth, 'workflows.manage')` sur create/update/delete/enroll,
calqué sur `handleCreateWorkflow` (`workflows.ts:87`). **ZÉRO ajout à
`ALL_CAPABILITIES`.** Bornage tenant `client_id` (calque `broadcast.ts:31`
`AND client_id = ?` / `workflows.ts:105` INSERT `client_id`).

### §6.E — Tracking (RÉUTILISE `tracking.ts`, READ-ONLY)

`tracking.ts` est **READ-ONLY** (pixel `handleTrackOpen:93` →
`/api/t/o/:id`, redirect `handleTrackClick:131` → `/api/t/c/:id?url=`,
INSERT `message_events` open/click + `messages.opened_at`/`clicked_at`,
routes déjà branchées `worker.ts`). Contrat Phase B :

1. **Chaque envoi de campagne réel** (broadcast réel ET séquence) **INSERT
   un row `messages`** avec `campaign_id` + `campaign_kind`
   (`'broadcast'` | `'sequence'`). Gap actuel confirmé :
   `broadcast.ts:168-179` (branche Resend réelle) n'INSERT PAS `messages`
   (seul le mock `:142-145` le fait) → Phase B aligne la branche réelle
   sur le mock (INSERT `messages` avec status `sent`, `campaign_id`,
   `campaign_kind='broadcast'`).
2. **Pixel injecté** : `<img src="{origin}/api/t/o/{messageId}">` ajouté
   au HTML avant envoi (le `messageId` = id du row `messages` créé en 1).
3. **Liens réécrits** : chaque `href` sortant → `/api/t/c/{messageId}?url={encoded}`.
4. **Agrégation** `broadcasts.opened` / `broadcasts.clicked` : COUNT
   distinct `message_events` (`event_type='open'`/`'click'`) joint sur
   `messages.campaign_id = broadcast.id` (index `idx_messages_campaign`).
   Calculée à la complétion (calque `broadcast.ts:187-191`) ou à la
   lecture détail.

L'`autoEnrollForTrigger(env, 'email_opened'|'link_clicked', leadId)` déjà
appelé par `tracking.ts:111`/`:156` continue de fonctionner inchangé
(triggers CRM existants — orthogonaux au flag séquence).

### §6.F — Envoi (Resend RÉUTILISÉ, throttle réel, mock honnête)

Phase B : RÉUTILISE le chemin Resend EXISTANT
(`processBroadcastQueueJob` `broadcast.ts:106`, import dynamique
`resend`, footers CASL/AMF `compliance.ts`). **Throttle réel** :
`throttle_per_min > 0` ⇒ remplacer le `Promise.all(promises)` aveugle
(`broadcast.ts:180`) par un débit borné (chunks de `throttle_per_min`
avec attente inter-chunk, OU enqueue espacé) ; `throttle_per_min = 0` ⇒
comportement legacy `Promise.all` strictement identique. **Mock
honnête** : si `!env.RESEND_API_KEY` (et hors `USE_MOCKS`), status
`mock-sent` (calque `broadcast.ts:144`) — **JAMAIS de faux `sent`**. La
séquence (`executeStep` case `send_email` `:561`) garde DÉJÀ
`if (!env.RESEND_API_KEY) return 'main'` (pas d'envoi factice) — la SEULE
modif tolérée Phase B sur `workflows.ts` est l'injection tracking dans ce
case (cf. §6.H).

### §6.G — Segmentation (corriger le gap filtre, garde cross-tenant)

Gap confirmé : `broadcast.ts:11` déclare `filters.source` + `filters.tags`
mais `:32-33` n'applique QUE `status` + `type` (source/tags JAMAIS
appliqués). Phase B (corps `broadcast.ts`) :

- `filters.source` → `AND source IN (...)` (colonne `leads.source`).
- `filters.tags` → jointure `lead_tags` (calque
  `EXISTS (SELECT 1 FROM lead_tags WHERE lead_id = leads.id AND tag IN (...))`).
- **Garde cross-tenant CONSERVÉE** : `broadcast.ts:25-27` (`client_id`
  OBLIGATOIRE si `filters.tags` fourni) reste en place mot pour mot.
- Filtrage unsubscribe (`broadcast.ts:41-48`) + DND (`:29`) inchangés.

### §6.H — Matrice de propriété Phase B/C (disjonction STRICTE)

| Fichier | Propriétaire | Règle |
|---|---|---|
| `src/worker/broadcast.ts` (corps : programmation/throttle/tracking/filtres source+tags) | **Manager-B** | corrige gaps §6.E/F/G ; aligne branche Resend réelle sur INSERT messages |
| `src/worker/sequences.ts` (corps des stubs) | **Manager-B** | wrapper réel sur moteur workflows EXISTANT (DÉLÈGUE handleEnrollLead/autoEnroll) |
| `processScheduledBroadcasts` (corps) | **Manager-B** | dans `sequences.ts` (signature figée) ; Manager-B PEUT déplacer le corps réel dans `broadcast.ts` si cohésion l'exige — signature + call site `worker.ts` restent FIGÉS |
| `src/worker/workflows.ts` — case `send_email` `:561-591` UNIQUEMENT | **Manager-B SEUL** | **UNIQUE modif tolérée** : injection pixel + réécriture liens + INSERT `messages` avec `campaign_id`/`campaign_kind`, **derrière une garde ADDITIVE `if (campaignKind)`** ; le chemin legacy (campaign_kind absent) reste BYTE-IDENTIQUE. AUCun autre case, AUCune autre ligne de `workflows.ts` touchée. AUCun autre agent n'y touche. |
| `src/pages/Sequences.tsx` (corps) | **Manager-C** | corps réel du stub lazy (`SequencesPage`) |
| `src/pages/Campaigns.tsx` (corps) | **Manager-C** | corps réel du stub lazy (`CampaignsPage`) |
| `src/worker.ts` · `src/lib/api.ts` · `src/lib/types.ts` · `src/App.tsx` · `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` · `docs/migrations-manifest.json` · `migration-emailseq-seq86.sql` · `docs/LOT-EMAIL5.md` | **Phase A — GELÉS** | B/C ne les modifient PAS |
| `src/worker/tracking.ts` · `src/worker/email-blocks.ts` · `src/pages/EmailBuilder.tsx` · compilateur `templates.ts` | **READ-ONLY** | **INTERDITS en écriture** à B ET C (réutilisés tels quels) |
| Les 6 pages « R » (Leads/LeadDetail/Pipeline/Tasks/Inbox/Calendar refaites) | — | **INTERDITES** hors scope |

Disjonction stricte : Manager-B et Manager-C n'ont **aucun fichier en
commun**. `workflows.ts` = Manager-B SEUL et UNIQUEMENT le case
`send_email` derrière garde `if(campaignKind)` (chemin legacy intact) —
Manager-C n'y touche jamais. `tracking.ts` reste READ-ONLY pour TOUS :
l'instrumentation se fait côté émetteur (broadcast/séquence ajoutent
pixel + liens + INSERT messages), `tracking.ts` ne fait que recevoir.

### §6.I — Garde-fous + suites à ne pas régresser

Garde-fous DURS : strictement ADDITIF ; moteur workflows / tracking /
builder email READ-ONLY (SEULE modif = injection tracking case
`send_email` derrière garde additive, §6.H) ; `is_sequence` IGNORÉ par
le moteur (zéro régression cron/@xyflow) ; CHECK status `broadcasts`
seq 24 INTOUCHABLE (broadcast programmé = `queued`+`scheduled_at`) ;
zéro FK/DROP/modif-CHECK ; aucun touch `users`/CHECK seq 59 ; **E4/E6
régulés JAMAIS activés/touchés** ; ZÉRO ajout à `ALL_CAPABILITIES`
(`workflows.manage` réutilisée) ; `apiFetch`/`ApiResponse` GELÉS (jamais
`code`) ; mock honnête (status `mock-sent`, jamais faux `sent`) ; i18n
parité STRICTE ×4 (41 clés `seq.*`/`campaign.*` ×4, zéro doublon, zéro
modif existant) ; rétro-compat byte-identique (scheduled_at NULL /
throttle 0 / is_sequence 0 / campaign_id NULL ⇒ legacy strictement
identique).

Suites à NE PAS régresser (Phase B/C, build côté hôte Antigravity) :
`workflows.*` (moteur d'automatisation — `is_sequence` ne doit RIEN
changer), `broadcast.*` (pipeline d'envoi + queue), `trigger-links.*` /
`message_events` (tracking — `tracking.ts` inchangé), `tenant-context.*`
(isolation `client_id`), + nouvelles suites `sequences.*` /
`broadcast-scheduled.*` éventuelles. Le chemin d'envoi workflow
`send_email` sans `campaign_kind` DOIT rester byte-identique au
comportement actuel (= aucun row de tracking, aucun pixel — exactement
comme `workflows.ts:579-582` aujourd'hui).

## Écarts CODE vs cadrage

Aucun écart structurel. Précisions issues de la lecture du CODE :

1. **`broadcast.ts` branche Resend réelle (`:168-179`) n'INSERT PAS
   `messages`** — seul le mock (`:142-145`) le fait. Le cadrage le
   pressentait (« broadcast réel n'INSERT pas `messages` `:168` ») :
   confirmé. Phase B doit aligner la branche réelle sur le mock pour que
   le tracking (§6.E) fonctionne sur les envois réels. Documenté §6.E/§6.H.
2. **`workflow_steps` n'a PAS de CHECK sur `step_type`** (vérifié : INSERT
   libre `workflows.ts:112`/`:159`) → `send_email`/`wait` pour les
   séquences ne nécessitent AUCUN DDL. Confirmé : seq 86 ne touche pas
   `workflow_steps`.
3. **Route `/api/sequences/:id` en `PUT`** (pas `PATCH`) — le cadrage dit
   « GET/PUT/DELETE » ; les workflows utilisent `PATCH` (`worker.ts:874`).
   J'ai suivi le cadrage (PUT) ; api.ts `updateSequence` aligné en PUT.
   Disjoint de la route workflows existante (zéro conflit).
4. **`messages` rebuild seq 49** (`migration-phase41.sql`) : les ALTER
   ADD COLUMN seq 86 sur `messages` s'appliquent sur la table
   reconstruite — additif pur, aucun conflit (post-rebuild).
5. **`processScheduledBroadcasts` placé dans `sequences.ts`** (pas
   `broadcast.ts`) pour garder `broadcast.ts` focalisé sur l'envoi ;
   tranché proprement, Manager-B peut migrer le corps vers `broadcast.ts`
   sans changer la signature ni le call site `worker.ts` (§6.H).
