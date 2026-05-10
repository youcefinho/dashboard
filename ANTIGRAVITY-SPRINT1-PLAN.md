# ANTIGRAVITY-SPRINT1-PLAN.md — Sprint 1 Foundations

> Rédigé le 2026-05-10 par Antigravity après lecture complète de :
> `ANTIGRAVITY-GHL-COMPLETENESS.md` (§0→§17), `ANTIGRAVITY-GHL-INVENTORY.md`, `ANTIGRAVITY-PHASE3-CATCHUP.md` (§7).
>
> **Objectif Sprint 1 :** Rochdi peut migrer Mathis Guimont depuis GHL et fermer le sub-account.

---

## A. Pré-requis infra Cloudflare

| # | Pré-requis | Status | Action |
|---|---|---|---|
| 1 | D1 database `intralys-crm` + `database_id` dans `wrangler.jsonc` | ✅ déjà fait | `ee9da52c-0e09-4d03-8819-dfc5b033cd18` configuré |
| 2 | R2 bucket `intralys-files` | ⬜ à faire | `npx wrangler r2 bucket create intralys-files` — **Rochdi doit exécuter** (ou me donner accès Cloudflare) |
| 3 | R2 binding dans `wrangler.jsonc` | ⬜ à faire | J'ajoute `r2_buckets: [{ binding: "FILES", bucket_name: "intralys-files" }]` après création bucket |
| 4 | Cloudflare Queue `ghl-migration` | ⬜ à faire | `npx wrangler queues create ghl-migration` — pour jobs migration background |
| 5 | Queue consumer binding dans `wrangler.jsonc` | ⬜ à faire | J'ajoute après création queue |
| 6 | Durable Objects namespace `WEBCHAT_ROOMS` | ⬜ à faire | J'ajoute le binding dans `wrangler.jsonc` + classe DO dans le code |
| 7 | Domaine Resend `noreply@intralys.com` vérifié | ❓ à confirmer | Rochdi : est-ce que Resend envoie déjà depuis `noreply@intralys.com` sans problème ? |
| 8 | Variable `GHL_PIT_TOKEN` pour Mathis | ❓ à confirmer | Rochdi doit fournir le Private Integration Token du sub-account Mathis (`ytI1qjzrNF56XD7IeTcq`). **Sans ça, migration impossible.** |
| 9 | KV namespace pour cache | 🟡 optionnel Sprint 1 | Requis Sprint 4 pour cache GBP reviews. Pas bloquant maintenant. |
| 10 | Variable `MAPBOX_TOKEN` | 🟡 optionnel | Pour différenciateurs futurs (carte leads). Pas Sprint 1. |

### Actions bloquantes Rochdi AVANT que je code :

1. **Créer le R2 bucket** : `npx wrangler r2 bucket create intralys-files`
2. **Créer la Queue** : `npx wrangler queues create ghl-migration`
3. **Fournir le GHL PIT token** de Mathis Guimont (dans le Dashboard Cloudflare comme secret `GHL_PIT_TOKEN_MATHIS`)
4. **Confirmer Resend** : email de test depuis `noreply@intralys.com` fonctionne ?

---

## B. Auto-audit sprints précédents — honnêteté brutale

### 3 endroits où la qualité est en-dessous

| # | Fichier | Problème | Sévérité |
|---|---|---|---|
| 1 | `src/worker/workflows.ts` — `executeStep()` | Le SMS/email sont fire-and-forget sans retry. Si Twilio/Resend timeout → le step est perdu. Pas de dead-letter queue. | 🟠 |
| 2 | `src/worker/messages.ts` — `handleInboundSms()` | Le matching lead par téléphone fait un `LIKE %cleanPhone` — fragile avec les formats internationaux. Faux positifs possibles sur des numéros partiels. | 🟠 |
| 3 | `src/worker/sub-accounts.ts` — `handleApplySnapshot()` | Le snapshot restore fait des `INSERT OR IGNORE` en boucle séquentielle sans transaction. Sur 500+ rows, ça peut timeout le Worker (30s). | 🟡 |

### 3 endroits non testés en prod réelle

| # | Feature | Raison |
|---|---|---|
| 1 | **Broadcast email CASL** (compliance.ts) | Jamais testé avec Resend en prod — le footer CASL et le lien unsubscribe n'ont été vérifiés qu'en local |
| 2 | **Google Calendar OAuth + sync** (gcal.ts) | OAuth flow complet jamais testé avec un vrai compte Google — les tokens refresh/expiry non validés en conditions réelles |
| 3 | **Workflow cron processor** (workflows.ts) | Le `scheduled()` handler est configuré toutes les 5min dans `wrangler.jsonc` mais jamais exécuté en prod — les deadlines de steps et le queue processing sont théoriques |

### Refactor P3.0 — status

| Question | Réponse |
|---|---|
| P3.0 refactor worker.ts fait ? | ✅ **OUI — terminé cette session** |
| worker.ts actuel | **266 lignes** (routeur pur, 0 logique métier) |
| Modules extraits | **23 fichiers** dans `src/worker/` (3 095 lignes) |
| Build | ✅ `bun run build` = 0 erreurs |
| Commits | `711a363` → routeur léger + 6 commits refactor batch |

**Le P3.0 n'est plus un bloquant.** On peut attaquer directement la Phase 1.1.

---

## C. Plan détaillé Sprint 1 — ordre + sous-tâches

### Phase 1.0 — Refactor worker.ts ✅ DÉJÀ FAIT

- ~~Extraction 23 modules~~ → **fait** (711a363)
- ~~Build vert~~ → **fait**
- **Estimation : 0j restant** (économie de 3j sur le Sprint)

---

### Phase 1.1 — Quick wins infra (1.5j)

#### Q.1 — DND par canal (1j)

**Fichiers à modifier :**
- `migrations/migration-phase10.sql` [NEW] — `ALTER TABLE leads ADD COLUMN dnd INTEGER DEFAULT 0; ALTER TABLE leads ADD COLUMN dnd_settings TEXT DEFAULT '{}';`
- `src/worker/leads.ts` — PATCH handler ajoute `dnd` + `dnd_settings`
- `src/worker/messages.ts` — `handleSendMessage()` vérifie DND avant envoi
- `src/worker/workflows.ts` — `executeStep('send_email'|'send_sms')` vérifie DND
- `src/worker/broadcast.ts` — filtre DND dans la query broadcast
- `src/components/LeadDetail.tsx` — toggle DND par canal (email/sms)

**Tests manuels :**
1. Activer DND email sur un lead
2. Tenter un broadcast email → le lead ne doit PAS recevoir
3. Envoyer un SMS direct → le lead ne doit PAS recevoir
4. Désactiver DND → les envois passent

**Commit :** `feat(q1-dnd): do not disturb par canal — filtre dans send_email/sms/broadcast`

#### Q.5 — Champs contact étendus (0.5j)

**Fichiers à modifier :**
- `migrations/migration-phase10.sql` — dans le même fichier :
  ```sql
  ALTER TABLE leads ADD COLUMN additional_emails TEXT DEFAULT '[]';
  ALTER TABLE leads ADD COLUMN date_of_birth TEXT;
  ALTER TABLE leads ADD COLUMN country TEXT DEFAULT 'CA';
  ALTER TABLE leads ADD COLUMN timezone TEXT DEFAULT 'America/Toronto';
  ```
- `src/worker/leads.ts` — PATCH handler accepte ces champs
- `src/components/LeadDetail.tsx` — affichage + édition inline

**Tests manuels :** Ajouter un lead avec 2 emails, une date de naissance, timezone `America/Montreal`. Vérifier persistence.

**Commit :** `feat(q5-fields): champs contact étendus — additionalEmails, dateOfBirth, country, timezone`

---

### Phase 1.2 — MVP Phase 4 (11j)

#### P4.3 — Documents + e-sign (5j)

**Pré-requis :** R2 bucket `intralys-files` créé.

**Jour 1-2 : Storage R2 + tables**

Fichiers :
- `wrangler.jsonc` — ajout binding R2 `FILES`
- `src/worker/types.ts` — ajout `FILES: R2Bucket` dans `Env`
- `migrations/migration-phase11.sql` [NEW] :
  ```sql
  CREATE TABLE files (
    id TEXT PRIMARY KEY, client_id TEXT, lead_id TEXT,
    name TEXT NOT NULL, size INTEGER, mime TEXT,
    r2_key TEXT NOT NULL UNIQUE, uploaded_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE document_templates (
    id TEXT PRIMARY KEY, client_id TEXT,
    name TEXT NOT NULL, body_html TEXT NOT NULL,
    variables TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE documents (
    id TEXT PRIMARY KEY, template_id TEXT, lead_id TEXT, client_id TEXT,
    status TEXT DEFAULT 'draft', -- draft|sent|viewed|signed|expired
    token TEXT UNIQUE, -- token pour accès public /sign/:token
    signed_at TEXT, signature_data TEXT, signed_html TEXT,
    audit_trail TEXT DEFAULT '[]', -- JSON [{action, ip, ua, timestamp, hash}]
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  ```
- `src/worker/documents.ts` [NEW] — handlers CRUD :
  - `POST /api/files` → presigned upload URL R2
  - `GET /api/files/:id` → presigned download
  - `GET /api/document-templates` / `POST` / `PATCH /:id` / `DELETE /:id`
  - `POST /api/documents` — créer doc depuis template + interpoler variables
  - `GET /api/documents` / `GET /:id`
  - `POST /api/documents/:id/send` — envoie email au lead avec lien `/sign/:token`

**Jour 3 : Page signature publique**
- `src/worker/documents.ts` — route publique `GET /api/sign/:token`
  - Vérifie token valide + non expiré
  - Retourne HTML du document
- `src/components/PublicSign.tsx` [NEW] — page `/sign/:token` :
  - Affiche document HTML
  - Canvas signature (HTML5 Canvas touch-friendly)
  - Bouton "Signer" → `POST /api/sign/:token` avec signature base64
- `src/worker/documents.ts` — `POST /api/sign/:token` :
  - Capture IP, user-agent, timestamp
  - Hash SHA-256 du document HTML
  - UPDATE status = 'signed', audit_trail append

**Jour 4-5 : PDF generation + intégration**
- Installer `pdf-lib` : `bun add pdf-lib`
- `src/worker/documents.ts` — `generateSignedPdf()` :
  - Crée PDF avec `pdf-lib` (header, body HTML→text, signature image, footer audit)
  - Upload PDF sur R2
  - Email PDF au lead + au courtier via Resend
- `src/components/Documents.tsx` [NEW] — page `/documents` dans le dashboard
- `src/worker.ts` — ajout routes documents dans routeur

**Risques :**
- `pdf-lib` sur Workers : testé compatible, mais pas de HTML→PDF natif. On fait du text layout. Si insuffisant, fallback `@cloudflare/puppeteer` (plus lourd).
- R2 presigned URLs : nécessite le binding correct, vérifier avec `wrangler dev`.

**Commits :**
- `feat(p4.3-docs): tables files + document_templates + documents + R2 binding`
- `feat(p4.3-docs): CRUD documents + templates + upload R2`
- `feat(p4.3-docs): page publique /sign/:token + canvas signature`
- `feat(p4.3-docs): PDF generation pdf-lib + email signé`
- `feat(p4.3-docs): UI Documents.tsx + routes dashboard`

---

#### P4.6 — Reviews & Reputation (3j)

**Jour 1 : Tables + workflow trigger**

Fichiers :
- `migrations/migration-phase12.sql` [NEW] :
  ```sql
  CREATE TABLE review_requests (
    id TEXT PRIMARY KEY, lead_id TEXT, client_id TEXT,
    channel TEXT DEFAULT 'email', -- email|sms
    template_id TEXT, -- email template pour la demande
    status TEXT DEFAULT 'pending', -- pending|sent|clicked|reviewed
    review_url TEXT, -- URL Google Business review du client
    sent_at TEXT, clicked_at TEXT, reviewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reviews_cache (
    id TEXT PRIMARY KEY, client_id TEXT,
    source TEXT DEFAULT 'google', -- google|facebook
    author_name TEXT, rating INTEGER, comment TEXT,
    review_date TEXT, reply TEXT, reply_date TEXT,
    external_id TEXT UNIQUE,
    fetched_at TEXT DEFAULT (datetime('now'))
  );
  ```
- `src/worker/reviews.ts` [NEW] — handlers :
  - `POST /api/reviews/request` — envoie email/SMS demande avis
  - `GET /api/reviews` — liste reviews (cache D1 + fetch GBP si stale)
  - `GET /api/reviews/stats` — aggregateRating, count par étoile
  - `POST /api/reviews/:id/reply` — suggestion AI reply

**Jour 2 : Intégration GBP API + workflow**
- `src/worker/gbp.ts` — enrichir le module existant :
  - Fetch reviews depuis Google Business Profile API
  - Cache dans `reviews_cache` (refresh toutes les heures)
  - Stats agrégées
- `src/worker/workflows.ts` — nouveau trigger `deal_signed` :
  - Quand `lead.status = 'signed'` → auto-enqueue review request (délai 7j configurable)

**Jour 3 : Dashboard reviews + UI**
- `src/components/Reviews.tsx` [NEW] — page `/reviews` :
  - Note moyenne + distribution étoiles (bar chart)
  - Liste reviews avec filtre par note
  - Bouton "Demander un avis" → sélection leads signés
  - Suggestion réponse AI pour chaque review
- `src/worker.ts` — ajout routes reviews dans routeur

**Commits :**
- `feat(p4.6-reviews): tables review_requests + reviews_cache + module reviews.ts`
- `feat(p4.6-reviews): workflow trigger deal_signed + auto-request review`
- `feat(p4.6-reviews): UI Reviews.tsx + dashboard stats + AI reply`

---

#### P4.2 — Webchat widget live (3j)

**Jour 1 : Durable Object WebSocket**

Fichiers :
- `wrangler.jsonc` — ajout binding Durable Objects :
  ```jsonc
  "durable_objects": {
    "bindings": [{ "name": "WEBCHAT_ROOMS", "class_name": "WebchatRoom" }]
  },
  "migrations": [{ "tag": "v1", "new_classes": ["WebchatRoom"] }]
  ```
- `src/worker/types.ts` — ajout `WEBCHAT_ROOMS: DurableObjectNamespace` dans `Env`
- `src/worker/webchat.ts` [NEW] — classe `WebchatRoom` :
  - `fetch()` → upgrade WebSocket
  - Map de connexions actives (visiteur + agent)
  - `onMessage()` → broadcast aux participants + persist dans D1
  - Alarm API : cleanup après 24h sans message
  - Pré-chat data (name, email) envoyée au connect

**Jour 2 : Snippet JS embeddable**
- `src/worker/webchat.ts` — route `GET /api/widget/v1.js` :
  - Script auto-exécutable qui injecte un bubble chat en bas-droite
  - Pré-chat form : name + email
  - WebSocket connect vers DO
  - Persistence localStorage pour session continue
- `src/worker/messages.ts` — persistence messages webchat dans `messages` table (`channel='webchat'`)
- Notifications admins via `createNotification()` quand nouveau message webchat

**Jour 3 : UI agent + intégration inbox**
- `src/components/Inbox.tsx` — onglet "Webchat" dans inbox
  - Indicateur online/offline
  - Réponse en temps réel via WebSocket
  - Auto-création lead si pré-chat form rempli
- `src/worker.ts` — ajout routes webchat dans routeur

**Risques :**
- Durable Objects : pricing basé sur durée de vie du DO. Budget à surveiller si beaucoup de conversations actives.
- WebSocket sur Cloudflare : max 256 connexions simultanées par DO instance — suffisant pour 1-1 chat.

**Commits :**
- `feat(p4.2-webchat): Durable Object WebchatRoom + WebSocket server`
- `feat(p4.2-webchat): snippet JS embeddable + pré-chat form`
- `feat(p4.2-webchat): intégration Inbox + notifications agent`

---

### Phase 1.3 — Migration data depuis GHL (10j)

> **Architecture :** Cloudflare Queue `ghl-migration`. Worker consumer qui traite les jobs en background.
> Chaque job s'auto-relance avec le cursor suivant (pagination GHL API).
> **Règle absolue :** `INSERT OR IGNORE` + flag `migrated_from = 'ghl'` + `external_id = <ghl_id>`. Idempotent.

**Fichiers communs :**
- `src/worker/migrate.ts` [NEW] — module migration GHL central
- `src/worker/types.ts` — ajout `GHL_MIGRATION_QUEUE: Queue` dans `Env`
- `wrangler.jsonc` — ajout queue consumer binding
- Route `POST /api/migrate/ghl` — lance la migration (admin only)
- Route `GET /api/migrate/status` — progress en temps réel

#### M1 — Contacts (2j)

**API GHL :** `GET /contacts/?locationId={id}&limit=100&startAfter={cursor}`

Logique :
1. Job `{type: 'migrate-contacts', location_id, pit_token, cursor, sub_account_id}`
2. Fetch 100 contacts par batch
3. Pour chaque contact : map vers notre schéma `leads`
   - `ghl.firstName + ghl.lastName` → `leads.name`
   - `ghl.email` → `leads.email`
   - `ghl.phone` → `leads.phone`
   - `ghl.tags[]` → INSERT dans `lead_tags`
   - `ghl.customFields[]` → INSERT dans `custom_field_values` (après mapping field IDs)
   - `ghl.dnd` / `ghl.dndSettings` → `leads.dnd` + `leads.dnd_settings`
   - `ghl.source` → `leads.source`
   - `ghl.dateOfBirth` → `leads.date_of_birth`
   - `ghl.country` / `ghl.timezone` → respectifs
4. `INSERT OR IGNORE INTO leads` avec `external_id = ghl.id`, `migrated_from = 'ghl'`
5. Si `nextCursor` → re-enqueue job avec nouveau cursor

**Migration SQL :** `migration-phase13.sql` — `ALTER TABLE leads ADD COLUMN external_id TEXT; ALTER TABLE leads ADD COLUMN migrated_from TEXT;`

#### M2 — Conversations + messages (2j)

**API GHL :** `GET /conversations/search?locationId={id}` + `GET /conversations/{id}/messages`

Logique :
1. Job `{type: 'migrate-conversations', ...}`
2. Fetch conversations paginées
3. Pour chaque conversation : chercher le lead par `external_id` (GHL contact_id)
4. Fetch tous les messages de la conversation
5. INSERT dans `messages` table avec mapping :
   - `ghl.type` → `messages.channel` (TYPE_SMS→sms, TYPE_EMAIL→email, etc.)
   - `ghl.body` → `messages.body`
   - `ghl.direction` → `messages.direction`
   - `ghl.dateAdded` → `messages.created_at`

**Risque :** Quota Cloudflare D1 writes (1M/jour free). Sur 10K messages historiques, ~10K writes = OK.

#### M3 — Custom field definitions (1j)

**API GHL :** `GET /locations/{id}/customFields`

Logique :
1. Job `{type: 'migrate-custom-fields', ...}`
2. Fetch toutes les définitions de champs
3. Map vers notre schéma `custom_field_defs` :
   - `ghl.dataType` → notre `field_type` (SINGLE_OPTIONS→select, TEXT→text, etc.)
   - `ghl.picklistOptions` → `options` JSON
   - `ghl.name` / `ghl.placeholder` / `ghl.position`
4. INSERT OR IGNORE avec `external_id`
5. Stocker le mapping `ghl_field_id → our_field_id` pour M1 (custom field values)

#### M4 — Pipelines + opportunities (1j)

**API GHL :** `GET /opportunities/pipelines` + `GET /opportunities/search?location_id={id}`

Logique :
1. Fetch pipelines → INSERT dans `pipelines`
2. Fetch stages par pipeline → INSERT dans `pipeline_stages`
3. Fetch opportunities → map vers `leads` (mettre dans le bon pipeline/stage)
4. Link opportunity au lead existant via contact_id → external_id

**Note :** Chez Mathis, 0 pipelines configurés. Migration sera rapide mais le code doit gérer le cas général.

#### M5 — Calendars + appointments (1j)

**API GHL :** `GET /calendars/?locationId={id}` + `GET /calendars/events?locationId={id}`

Logique :
1. Fetch calendars → INSERT dans une table `calendars` (ou config)
2. Fetch events → INSERT dans `appointments`
3. Mapping : `ghl.title` → `title`, `ghl.startTime/endTime`, `ghl.contactId` → link via external_id

#### M7 — Workflows + steps (3j) ⚠️ GROS MORCEAU

**API GHL :** `GET /workflows/?locationId={id}`

Logique :
1. Job `{type: 'migrate-workflows', ...}`
2. Fetch workflows GHL
3. **Mapping format GHL → notre format** (le plus complexe) :
   - GHL workflow = array de actions avec conditions
   - Notre format = `workflow_steps` avec `step_type` + `config` JSON
   - Types supportés : `send_email`, `send_sms`, `wait`, `condition`, `add_tag`, `remove_tag`, `update_field`, `webhook`, `assign`
   - Types GHL non mappables → stockés comme `step_type = 'unsupported'` avec config originale (pas de perte de data)
4. Active enrollments : noter les leads enrollés mais **ne pas réactiver** (risque d'actions doubles). Flag `paused_after_migration = true`.

**Risque technique :** Le mapping GHL→Intralys workflow steps sera imparfait. Certains steps GHL (voicemail drop, Facebook action, custom webhook avec OAuth) n'ont pas d'équivalent. On les stocke avec un flag `unsupported` et on log pour review manuelle.

---

## D. Réponses aux questions stratégiques §16 COMPLETENESS

| # | Question | Recommandation |
|---|---|---|
| Q1 | Fermer GHL ou juste compléter le clone ? | **Fermer GHL** — Sprint 1 rend ça possible pour Mathis. Économie $297/mois immédiate. Les 4 autres sprints (Agency, Polish, API, Différenciateurs) sont du nice-to-have qu'on construit pendant la vente des premiers clients. |
| Q2 | Premier sub-account à migrer ? | **Mathis Guimont** — 11 contacts, 1 conversation, 5 custom fields, 0 pipelines. Faible risque, validation rapide. Intralys agency pivot = plus risqué (plus de data, SaaS config en cours). |
| Q3 | Budget infra Sprint 1 ? | **~$5-15/mois** : R2 free tier (10GB), Queues free tier (1M messages), Durable Objects (~$0.50/mois pour webchat faible volume). Resend free 100 emails/jour. Twilio SMS déjà configuré. Pas de Sentry/Logflare Sprint 1 (Sprint 2). |
| Q4 | Combien clients avant Stripe ? | **Ne touche pas Sprint 1.** Recommandation : 5e client signé → activer Stripe Connect. D'ici là, facturation manuelle (virement/chèque). |
| Q5 | Monorepo vs split ? | **Ne touche pas Sprint 1.** Rester monorepo `intralys-dashboard` pour l'instant. Split quand on aura un mobile app repo séparé (Sprint 2+). |

---

## E. Risques techniques Sprint 1

| # | Risque | Sévérité | Mitigation |
|---|---|---|---|
| R1 | **GHL API rate limits** — quota inconnu sur le PIT token, risque de 429 pendant migration | 🟠 HIGH | Retry avec backoff exponentiel (1s→2s→4s→8s). Limiter à 5 req/sec. Job Queue se re-enqueue avec délai. |
| R2 | **pdf-lib limitations** — pas de HTML→PDF natif, layout text seulement | 🟠 MEDIUM | Fallback : générer un PDF simple (header, paragraphes, signature image). Si client demande HTML riche → évaluer `@cloudflare/puppeteer` en Sprint 2. |
| R3 | **Durable Objects cold start** — latence 50-200ms au premier message webchat | 🟡 LOW | Acceptable pour chat. Si problème, pré-warm via health check toutes les 5min. |
| R4 | **D1 write quota** — migration bulk peut consommer beaucoup de writes | 🟠 MEDIUM | Mathis = ~50 rows total. Mais si un futur client a 50K contacts, il faut batching. Implémenter batch INSERT (50 rows par statement). |
| R5 | **Workflow mapping GHL→Intralys incomplet** — certains steps GHL n'ont pas d'équivalent | 🟠 HIGH | Stocker les steps non mappés avec `step_type='unsupported'` + log. Dashboard alerte "X steps nécessitent une config manuelle". Pas de perte de data. |

---

## F. Estimation finale

| Phase | Effort | Cumul | Status |
|---|---|---|---|
| ~~1.0 Refactor worker~~ | ~~3j~~ → **0j** | 0j | ✅ déjà fait |
| 1.1 Quick wins (Q.1 DND + Q.5 champs) | 1.5j | 1.5j | ⬜ todo |
| 1.2a P4.3 Documents + e-sign | 5j | 6.5j | ⬜ todo |
| 1.2b P4.6 Reviews & Reputation | 3j | 9.5j | ⬜ todo |
| 1.2c P4.2 Webchat widget live | 3j | 12.5j | ⬜ todo |
| 1.3 Migration GHL (M1→M7) | 10j | 22.5j | ⬜ todo |
| **Total Sprint 1** | **~22.5j** | — | — |

> **Gain de 3.5j** vs estimation originale (26j) grâce au P3.0 déjà terminé.
> Ordre recommandé : 1.1 → 1.2a → 1.2b → 1.2c → 1.3

---

## G. Ordre d'attaque proposé

```
Semaine 1 : Q.1 DND + Q.5 champs étendus (1.5j) + P4.3 Documents début (3.5j)
Semaine 2 : P4.3 Documents fin (1.5j) + P4.6 Reviews (3j) + début P4.2 (0.5j)
Semaine 3 : P4.2 Webchat (2.5j) + M3 Custom fields migration (1j) + M1 début (1.5j)
Semaine 4 : M1 Contacts fin (0.5j) + M2 Conversations (2j) + M4 Pipelines (1j) + M5 Calendar (1j)
Semaine 5 : M7 Workflows (3j) + tests migration end-to-end (2j)
```

---

_En attente de validation Rochdi avant de commencer. Pré-requis infra bloquants : R2 bucket, Queue, GHL PIT token Mathis._
