# LOT G1 — Helpdesk & Tickets de support (Sprint 8)

CRM/e-commerce SaaS multi-tenant Intralys. Système de support client : tickets
multi-canaux (form public / email) + base de connaissances (KB) publique simple.

Méthode : Chaman READ-ONLY (audit disque) → **Phase A SOLO** (squelette : migration
seq 89 + stubs handlers + routes worker.ts + helpers api.ts + i18n ×4 + stubs pages
+ routes App.tsx + ce doc) → **Phase B** (2 Managers parallèles : Manager-B backend
exclusif `tickets.ts`/`kb.ts` ; Manager-C front exclusif pages).

---

## §0 — AUDIT DISQUE (confirmé par Chaman + Manager-A)

- ABSENT confirmé : zéro `ticket|helpdesk|support_ticket|kb_article` dans worker/pages.
  Namespace i18n `ticket.*`/`kb.*` inexistant AVANT ce lot (`kbd.*` = raccourcis
  clavier, 24 clés ×4 catalogues, AUCUNE collision — confirmé grep).
- seq 89 LIBRE (dernière = `migration-reports-d-seq88.sql` seq 88 ; manifest seq 88
  depends 87). Confirmé : manifest se termine à seq 88.
- `leads.write` confirmé dans `ALL_CAPABILITIES` (`capabilities.ts:38`). Aucun ajout
  requis. `requireCapability(caps, cap)` + type `CapAuth` confirmés.
- **ÉCART STRUCTUREL MAJEUR** : `conversations` (Inbox) est lead-centric obligatoire
  (`conversations.lead_id` requis, INSERT échoue sans lead). Un ticket support s'ouvre
  par visiteur anonyme → **l'Inbox NE PEUT PAS être réutilisée telle quelle**.
  Réutilisation = patterns (forms.ts pipeline, capGuard, public route), PAS le schéma
  conversations.

### Écarts CODE > brief tracés par Manager-A

- **Types Ticket/KB → `src/lib/api.ts`** (PAS `src/lib/types.ts`). Le code disque
  porte déjà les types `Funnel`/`FunnelStep`/`MembershipSite` dans `api.ts` (à côté
  des helpers), PAS dans `types.ts`. Calque suivi : types ADDITIFS en fin de `api.ts`.
- **Garde mode-agence-only** : le brief la nomme « calque LOT B-bis ». Le pattern
  textuel EXACT existe dans `dashboards.ts:reportsCapGuard` (lignes 70-74) :
  `if (!auth?.tenant || agencyId == null) return undefined; if (!auth.capabilities)
  return undefined; return requireCapability(...)`. `helpdeskCapGuard` le calque
  verbatim. NB : `funnels.ts:capGuard` N'EST PAS mode-agence-only (appelle
  requireCapability inconditionnellement) — on suit dashboards.ts conformément au
  brief §6.C.
- **authCtx injecte déjà `capabilities`** au choke-point worker.ts:714-715 ; le type
  `routeProtected` (worker.ts:796) porte déjà `capabilities?: Set<string>`. Aucun
  changement choke-point requis.

---

## §6.A — ARCHITECTURE (décisions tranchées)

- **Q1 → tables NEUVES `support_tickets` + `ticket_messages`** (zéro ALTER, calque
  `funnels` qui porte client_id/agency_id en colonnes directes). `lead_id` nullable.
- **Q2 → KB publique simple** (table `kb_articles` + page publique `/help/$slug`,
  calque PublicFunnel SPA hydraté).
- **Q3 → statuts v1 : `ouvert | en_cours | attente_client | resolu | escale` (5)**,
  PAS de CHECK SQL. SLA v1 = enum applicatif `sla_level TEXT` ∈ `none|1h|4h|24h|72h`
  (validé handler, pas de CHECK SQL). `sla_due_at INTEGER` epoch calculé création.
- **Q4 → `assigned_to TEXT` = user_id simple** (calque conversations.assigned_to/tasks).
- **Q5 → wiring CRM calque forms.ts** : `applyLeadMapping` + `resolveDedup` +
  `mergeIntoLead` → `support_tickets.lead_id` rempli si match email/phone, sinon NULL
  (PAS de création de lead forcée).
- **Q6 → v1 manuel** : réponse via aiCompose.ts manuel (calque Inbox aiDrafts).
  Auto-catégorisation v2.
- **Q7 → v1 email Resend auto** (création + réponse) calque `workflows.ts sendResend`,
  notif équipe via cloche in-app existante. SMS v2.
- **Q8 → RÉUTILISER `leads.write`**. ZÉRO ajout `ALL_CAPABILITIES`.
- Modèle data : `support_tickets(id PK)` 1—N `ticket_messages(ticket_id)` (jointure
  APPLICATIVE, zéro FK) ; `kb_articles(id PK)` indépendant. Bornage tenant
  client_id/agency_id (calque funnels seq 83). Timestamps INTEGER unixepoch().

## §6.B — MIGRATION seq 89 (`migration-helpdesk-seq89.sql`, depends 88)

En-tête garde-fous calque seq 88. SQL exact (3 tables NEUVES + 6 index, AUCUN ALTER,
AUCUNE FK, AUCUN CHECK) :

```sql
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  client_id TEXT, agency_id TEXT,
  lead_id TEXT,
  subject TEXT, body TEXT,
  requester_name TEXT, requester_email TEXT, requester_phone TEXT,
  status TEXT DEFAULT 'ouvert',
  priority TEXT DEFAULT 'normal',
  sla_level TEXT DEFAULT 'none', sla_due_at INTEGER,
  assigned_to TEXT,
  source TEXT DEFAULT 'form',
  last_message_at INTEGER DEFAULT (unixepoch()),
  created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  client_id TEXT,
  direction TEXT,
  author_id TEXT, author_name TEXT,
  body TEXT, is_internal INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS kb_articles (
  id TEXT PRIMARY KEY,
  client_id TEXT, agency_id TEXT,
  slug TEXT, title TEXT, body_md TEXT, category TEXT,
  status TEXT DEFAULT 'draft',
  view_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_client_status ON support_tickets(client_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_agency ON support_tickets(agency_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kb_articles_client_status ON kb_articles(client_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_articles_slug ON kb_articles(slug);
```

Manifest : `{ "seq": 89, "file": "migration-helpdesk-seq89.sql", "depends_on":
["migration-reports-d-seq88.sql"], "objects": ["table:support_tickets",
"table:ticket_messages","table:kb_articles","index:support_tickets",
"index:ticket_messages","index:kb_articles"], "risk": "low" }`. Slug KB = unicité
APPLICATIVE (slugify + suffixe collision calque funnels), PAS de UNIQUE SQL.

## §6.C — ROUTES worker.ts

**Publiques (pré-requireAuth, bloc ~440)** — tenant résolu par slug côté handler :
- `POST /api/public/tickets` → `handlePublicSubmitTicket(request, env)` (calque
  handlePublicFormSubmit)
- `GET /api/public/kb/:slug` → `handlePublicGetKBArticle(env, slug)` (calque
  handlePublicFunnelGet)

**PRO (routeProtected, bloc ~1147, auth injecté)** — `leads.write` mode-agence-only :
- `GET/POST /api/tickets`, `GET/PATCH /api/tickets/:id`, `POST /api/tickets/:id/reply`
  (sous-route `/reply` AVANT `/:id` générique pour éviter shadowing)
- `GET/POST /api/kb`, `GET/PUT/DELETE /api/kb/:id`

Guard inline (calque dashboards.ts:reportsCapGuard / LOT B-bis explicite
mode-agence-only) :

```typescript
export function helpdeskCapGuard(auth: TicketAuth): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, 'leads.write');
}
```

Bornage tenant via `loadTicketInTenant`/`loadKBInTenant` (calque
`funnels.ts:loadFunnelInTenant` : legacy → row ; mode agence → client_id ∈
accessibleClientIds || agency_id === tenant.agencyId, sinon 404).

## §6.D — API helpers (api.ts) — ApiResponse INCHANGÉ, jamais `code`

Types ADDITIFS : `TicketStatus = 'ouvert'|'en_cours'|'attente_client'|'resolu'|'escale'` ;
`SlaLevel = 'none'|'1h'|'4h'|'24h'|'72h'` ; `Ticket`, `TicketMessage`, `KBArticle`.
Helpers signatures FIGÉES :
- `listTickets(params?): Promise<ApiResponse<Ticket[]>>` / `getTicket(id):
  Promise<ApiResponse<Ticket & {messages:TicketMessage[]}>>` / `createTicket(p):
  Promise<ApiResponse<{id:string}>>` / `updateTicket(id,p):
  Promise<ApiResponse<{success:true}>>` / `replyTicket(id,p):
  Promise<ApiResponse<{id:string}>>`
- `listKBArticles(params?)` / `getKBArticle(id)` / `createKBArticle(p)` /
  `updateKBArticle(id,p)` / `deleteKBArticle(id)`
- Public : `publicSubmitTicket(p): Promise<ApiResponse<{id:string}>>` /
  `publicGetKBArticle(slug): Promise<ApiResponse<KBArticle>>`

Discrimination capability front = string-match sur `error` (jamais `code`).

## §6.E — i18n `ticket.*` + `kb.*` ×4 catalogues — parité STRICTE

26 clés (statuts ×5, sla ×5, actions reply/assign/escalate/resolve ×4, colonnes
liste ×5, KB title/body/category/status/publish ×5, public form succès/erreur ×2).
Insérées en fin de catalogue (avant `};`). Parité STRICTE 4 catalogues (26 ×4 = 104,
vérifié grep). Vocabulaire calqué (fr-CA `Ticket`/`Base de connaissances` ; fr-FR id. ;
en `Ticket`/`Knowledge base` ; es `Ticket`/`Base de conocimientos`). Zéro collision
(`ticket.*`/`kb.*` absents avant lot, `kbd.*` distinct = NON touché).

## §6.F — PAGES + routes TanStack (App.tsx)

- `Tickets.tsx` → `/tickets` (liste + détail panel slide-over calque LeadDetail) ;
  détail `/tickets/$ticketId` (même page/panneau, pas de page séparée)
- `KBAdmin.tsx` → `/kb` (+ `/kb/$articleId` édition, même page)
- `PublicTicketForm.tsx` → `/support/$slug` (public, calque PublicForm, hors LazyGuard)
- `KBPublic.tsx` → `/help/$slug` (public, calque PublicFunnel)
- **6 pages R protégées (Dashboard/LeadDetail/Pipeline/Tasks/Leads/Inbox) = HORS
  PÉRIMÈTRE.**

## §6.G — DÉCOUPAGE

**Phase A SOLO (Manager-A)** : (1) migration seq 89 ; (2) manifest ; (3) routes
worker.ts (2 publiques + 8 PRO câblées vers stubs) ; (4) stubs `src/worker/tickets.ts`
+ `src/worker/kb.ts` (signatures figées + helpdeskCapGuard + loadXInTenant, corps
placeholder) ; (5) api.ts helpers + types ; (6) i18n ×4 (26 clés parité) ; (7) stubs
pages + routes App.tsx ; (8) ce doc.
**Phase B Manager-B (backend exclusif)** : corps tickets.ts + kb.ts.
**Phase B Manager-C (front exclusif)** : pages réelles.

## §6.H — DISJONCTION

- Exclusifs B : `src/worker/tickets.ts`, `src/worker/kb.ts`
- Exclusifs C : `src/pages/Tickets.tsx`, `src/pages/KBAdmin.tsx`,
  `src/pages/PublicTicketForm.tsx`, `src/pages/KBPublic.tsx`
- PARTAGÉS Phase B = ZÉRO (worker.ts/api.ts/i18n/migration/App.tsx FIGÉS Phase A)
- READ-ONLY Phase B : `forms.ts`, `lead-mapping.ts`, `lead-dedup.ts`, `leads.ts`,
  `webchat.ts`, `conversations.ts`, `capabilities.ts`, `tenant-context.ts`,
  `workflows.ts`, `aiCompose.ts`(`ai.ts`), `helpers.ts`

## §6.I — GARDE-FOUS

Additif strict · CHECK seq 59 jamais touché/jamais rebuild users · E4/E6 jamais
activés · 6 pages R prudence exclues · i18n 4 catalogues parité avant usage · VMware
build délégué Antigravity · pas de SSR · ZÉRO ajout `ALL_CAPABILITIES` · ApiResponse
INCHANGÉ jamais `code` · AUCUNE FK (jointures applicatives) · AUCUN ALTER (3 tables
NEUVES) · guard mode-agence-only · JAMAIS git config/Bash destructeur.

---

## IMPLEMENTATION-LOG

### Phase A SOLO — 2026-05-20 (Manager-A)

Squelette complet posé. Fichiers créés/modifiés :

**Créés :**
- `migration-helpdesk-seq89.sql` (3 tables + 6 index, en-tête garde-fous calque seq 88)
- `src/worker/tickets.ts` (stubs : helpdeskCapGuard + loadTicketInTenant + 6 handlers
  signatures figées, corps placeholder `{data:[]}`/`{data:{id:''}}`/`{success:true}`)
- `src/worker/kb.ts` (stubs : loadKBInTenant + 6 handlers, import helpdeskCapGuard
  depuis tickets.ts)
- `src/pages/Tickets.tsx`, `src/pages/KBAdmin.tsx`, `src/pages/PublicTicketForm.tsx`,
  `src/pages/KBPublic.tsx` (stubs minimaux : titre i18n + appel helper api)
- `docs/LOT-HELPDESK-G1.md` (ce doc)

**Modifiés (FIGÉS pour Phase B) :**
- `docs/migrations-manifest.json` (+ entrée seq 89)
- `src/worker.ts` (imports tickets/kb ; 2 routes publiques bloc ~440 ; 8 routes PRO
  bloc ~1147 avec ordre anti-shadowing `/reply` avant `/:id`, `/kb` avant `/kb/:id`)
- `src/lib/api.ts` (types Ticket/TicketMessage/KBArticle/TicketStatus/SlaLevel +
  13 helpers ADDITIFS en fin de fichier — ApiResponse INCHANGÉ)
- `src/lib/i18n/fr-CA.ts` / `fr-FR.ts` / `en.ts` / `es.ts` (26 clés `ticket.*`/`kb.*`
  chacun, parité stricte vérifiée 26×4=104)
- `src/App.tsx` (4 lazy imports ; 6 routes — `/tickets`, `/tickets/$ticketId`, `/kb`,
  `/kb/$articleId` protégées sous LazyGuard ; `/support/$slug`, `/help/$slug`
  publiques hors LazyGuard ; routeTree LOT G1)

**Garde-fous respectés :** zéro ALTER, zéro FK, zéro CHECK, zéro ajout
ALL_CAPABILITIES, CHECK seq 59 / users / admin_sessions / tables E4-E6 intouchés,
6 pages R intouchées, ApiResponse jamais `code`. Build NON vérifié (VMware sans
bun/node) — **build délégué Antigravity** (vérif Phase B groupée).

### Phase B — Backend exclusif (Manager-B) — 2026-05-20

Corps RÉELS des 12 handlers backend écrits. Fichiers modifiés : `src/worker/tickets.ts`,
`src/worker/kb.ts` (+ ce log). ZÉRO autre fichier touché (worker.ts/api.ts/i18n/
migration/App.tsx/pages Manager-C/READ-ONLY tous intacts).

**`tickets.ts` (6 handlers + helpers) :**
- `handleGetTickets(env,auth,url)` — SELECT borné tenant (legacy = pas de borne ;
  agence = `agency_id=? OR client_id IN (accessibleClientIds)`). Filtres optionnels
  status/assigned_to/priority. Tri `last_message_at DESC LIMIT 200`. best-effort `[]`.
- `handleCreateTicket(request,env,auth)` — INSERT support_tickets (id uuid, client_id/
  agency_id du tenant, status 'ouvert', `sla_due_at` = created_at + delta SLA) + 1er
  ticket_messages 'inbound'. Wiring CRM best-effort + email confirmation Resend.
- `handleGetTicket(env,auth,id)` — loadTicketInTenant 404 → ticket + ses ticket_messages
  (ORDER BY created_at ASC). Retourne `{...ticket, messages}`.
- `handleUpdateTicket(request,env,auth,id)` — loadTicketInTenant 404 → UPDATE
  status/priority/assigned_to/sla_level (recalcul `sla_due_at` depuis created_at stocké).
  updated_at refresh. Statuts/SLA validés handler.
- `handleReplyTicket(request,env,auth,id)` — loadTicketInTenant 404 → INSERT
  ticket_messages ('outbound', ou 'internal_note' + is_internal=1 si note). UPDATE
  last_message_at. Email Resend au requester SI réponse publique (jamais note interne).
- `handlePublicSubmitTicket(request,env)` — PUBLIC. Tenant résolu par slug → `forms`
  (slug, is_active=1) → client_id (best-effort, NULL si introuvable). INSERT ticket
  source 'form' + 1er message 'inbound'. Wiring CRM best-effort. Email confirmation.
  Réponse `{id}` UNIQUEMENT (ZÉRO champ tenant exposé).
- Helpers : `loadTicketInTenant` (bornage calque funnels), `helpdeskCapGuard` (préservé
  Phase A), `sendTicketEmail` (Resend best-effort, garde RESEND_API_KEY, jamais throw),
  `resolveLeadForTicket` (wiring CRM : resolveDedup/mergeIntoLead/logIngestConsent —
  JAMAIS de création de lead, lead_id NULL si pas de match), `computeSlaDueAt`.

**`kb.ts` (6 handlers + helpers) :**
- `handleGetKBArticles` — SELECT borné tenant + filtre status optionnel. Tri
  `updated_at DESC`. best-effort `[]`.
- `handleCreateKBArticle` — INSERT (id uuid, slug applicatif unique, status 'draft'
  défaut, client_id/agency_id tenant).
- `handleGetKBArticle` — loadKBInTenant 404 → article complet.
- `handleUpdateKBArticle` — loadKBInTenant 404 → UPDATE title/body_md/category/status,
  re-slug si title change (garde unicité applicative). updated_at refresh.
- `handleDeleteKBArticle` — loadKBInTenant 404 → DELETE dur.
- `handlePublicGetKBArticle(env,slug)` — PUBLIC. SELECT slug + status='published' ;
  view_count++ best-effort. Renvoie SEULEMENT slug/title/body_md/category (ZÉRO
  client_id/agency_id/id interne). Cache-Control. 404 best-effort.
- Helpers : `loadKBInTenant`, `slugify` (calque funnels), `uniqueSlug` (collision
  suffixe court applicatif).

**Écart brief↔disque (code fait foi) :** le brief Phase B nomme `handleListTickets(
request,env,auth)` / `handleGetTicket(request,env,auth,id)` ; les signatures FIGÉES
Phase A sur disque (et câblées dans worker.ts gelé) sont `handleGetTickets(env,auth,
url)`, `handleGetTicket(env,auth,id)`, `handleUpdateTicket(request,env,auth,id)`,
`handleReplyTicket(request,env,auth,id)`. Adapté AU DISQUE (zéro touche worker.ts/
api.ts). Comportement fonctionnel identique au brief.

**Écart résolution tenant public :** support_tickets n'a PAS de table de publication
(contrairement à funnel_publications). Le slug public est résolu via la table `forms`
(formulaire de support publié, slug + is_active=1 → client_id) en lecture best-effort,
calque conforme à handlePublicFunnelSubmit. Slug absent/introuvable → client_id NULL
(ticket legacy-safe, jamais d'échec, jamais d'exposition tenant).

**Garde-fous respectés :** additif strict, rétro-compat byte-équivalente legacy (set
caps LARGE + bornage neutralisé hors mode agence) ; bornage tenant sur TOUS les
SELECT/UPDATE/DELETE en mode agence ; anti-leak public vérifié (handlePublicGetKBArticle
+ handlePublicSubmitTicket n'exposent aucun champ tenant) ; wiring CRM ne crée JAMAIS
de lead (lead_id NULL si pas de match) ; email Resend best-effort (garde RESEND_API_KEY,
jamais throw) ; jointures applicatives (zéro FK) ; ZÉRO ajout ALL_CAPABILITIES
('leads.write' réutilisé) ; ApiResponse jamais `code` ; CHECK seq 59/users/E4-E6
intouchés ; worker.ts/api.ts/i18n/migration/App.tsx/pages Manager-C/READ-ONLY intacts.
Build NON vérifié (VMware sans bun/node) — **build délégué Antigravity**.

### Phase B — Front exclusif (Manager-C) — 2026-05-20

Corps RÉELS des 4 pages front écrits. Fichiers modifiés : `src/pages/Tickets.tsx`,
`src/pages/KBAdmin.tsx`, `src/pages/PublicTicketForm.tsx`, `src/pages/KBPublic.tsx`,
`src/index.css` (bloc append-only `=== LOT G1 Helpdesk ===`) + ce log. ZÉRO autre
fichier touché (tickets.ts/kb.ts Manager-B, worker.ts/api.ts/i18n/migration/App.tsx
gelés Phase A, 6 pages R, tout `src/worker/*` intacts).

**`Tickets.tsx` (route `/tickets` + `/tickets/$ticketId`) :**
- Liste = table grille CSS (`.ticket-table`/`.ticket-row`) : sujet / demandeur /
  statut (`<Tag>` color-coded `STATUS_VARIANT` ouvert→info, en_cours→warning,
  attente_client→neutral, resolu→success, escale→danger + `statusIcon`) / assigné /
  SLA (badge urgence `<Tag dot pulse>` "SLA dépassé"/"SLA proche" via `slaUrgency`
  sur `sla_due_at`, sinon libellé `ticket.sla.*`) / dernière activité (relatif).
- Filtres `<Select size="sm">` statut/assigné/priorité (options dérivées data).
- Détail = `<SlidePanel size="lg">` (primitive existante, calque conceptuel
  LeadDetail) : header statut Tag + actions ; body = bloc actions (Select statut /
  Select SLA / boutons Escalader+Résoudre → `updateTicket` optimistic+rollback) +
  demande initiale (`ticket.body`) + fil `messages` via `<MessageRow>` (note interne
  = encadré ambre dashed `is_internal`, inbound = gauche neutre, outbound = droite
  primary-soft) ; footer = `<Textarea>` réponse + checkbox note interne + bouton
  `replyTicket`.
- URL `/tickets/$ticketId` → ouvre panneau (useParams `ticketId`) ; fermeture
  navigate `/tickets` (calque `navigate({to:'/clients/$clientId'})` existant).

**`KBAdmin.tsx` (route `/kb` + `/kb/$articleId`) :**
- Liste = table grille (`.kb-table`/`.kb-row`) : titre / catégorie / statut
  (`<Tag>` published→success / draft→neutral) / vues / actions (lien "voir public"
  `/help/$slug` si publié + suppression).
- Éditeur = `<SlidePanel size="lg">` : `<Input>` titre + `<Select>` catégorie +
  `<Textarea rows=14>` body markdown (v1 textarea simple, pas d'éditeur riche) ;
  footer 2 boutons "Enregistrer brouillon" (`status:'draft'`) / "Publier"
  (`status:'published'`). Create→`createKBArticle`, edit→`updateKBArticle`.
- Suppression via `useConfirm({danger:true})` → `deleteKBArticle`.
- `/kb/$articleId` (useParams `articleId`) ouvre l'éditeur ; fermeture → `/kb`.

**`PublicTicketForm.tsx` (route `/support/$slug`, PUBLIC) :**
- Calque `PublicForm.tsx` : page standalone (pas de chrome app), `<Card>` épurée,
  champs nom / courriel* / téléphone / sujet* / message* → `publicSubmitTicket({slug,
  requester_name/email/phone, subject, body})`. Écran de confirmation succès
  (`ticket.public.success`) ; erreur inline (`ticket.public.error`).

**`KBPublic.tsx` (route `/help/$slug`, PUBLIC) :**
- Calque `PublicFunnel.tsx` : fetch `publicGetKBArticle(slug)` (string-match `error`,
  jamais `code`), spinner loading, 404 propre si introuvable/non publié. Rendu
  Markdown via `ReactMarkdown` + `remark-gfm` (renderer maison du projet, cf.
  `HelpArticle.tsx` — ZÉRO dépendance nouvelle), prose `.kb-prose`. Page standalone.

**i18n :** clés Phase A câblées telles quelles (`grep t('ticket.` / `t('kb.`) :
status.* ×5, sla.* ×5, action.reply/assign/escalate/resolve, col.subject/requester/
status/assigned/updated, public.success/error, kb.title/body/category/status/publish.
**Fallbacks inline tracés (clés absentes Phase A, i18n NON touché)** : libellés
"Brouillon", "Note interne", "Demande", "Vues", "Priorité", "Courriel", "Téléphone",
"Voir public", "Supprimer", relatifs temps, descriptions empty-states — tous en dur
FR raisonnable (aucune création de clé i18n).

**Écarts brief↔CODE (code fait foi) :**
- Brief dit "calque LeadDetail slide-over" : LeadDetail utilise `usePanelStack`/
  `openPanel` (panel registry global). J'ai utilisé la primitive `<SlidePanel>`
  directement (props réelles `open`/`onOpenChange`/`size`/`title`/`headerActions`/
  `footer`) — même UX slide-over droite, couplage moindre (dégradation acceptable
  prévue au brief). Pas de `usePanelStack` pour rester autonome page.
- `<Card>` n'a PAS de prop `padding` → table rendue via `className="!p-0 overflow-hidden"`.
- `TicketMessage.direction` typé `'inbound'|'outbound'` côté front ; Manager-B insère
  aussi `'internal_note'`. MessageRow teste `is_internal` EN PREMIER → rendu correct
  quelle que soit la valeur `direction` (note interne prioritaire).

**⚠ RISQUE Phase A signalé (hors périmètre Manager-C, App.tsx gelé) :** collision de
route — `helpArticleRoute` (App.tsx:308) ET `kbPublicRoute` (App.tsx:747) déclarent
TOUS DEUX `path: '/help/$slug'`. Dans `routeTree.addChildren`, `kbPublicRoute` (934)
précède `helpArticleRoute` (963). TanStack ne garantit pas la résolution par ordre
pour deux paths identiques → l'une des deux pages risque de masquer l'autre. À
arbitrer Phase A/intégration (ex : déplacer KBPublic sous `/kb-help/$slug` ou
`/support-article/$slug`). La page `KBPublic.tsx` elle-même est correcte ; seul le
mapping de route est en conflit. **Je n'ai PAS touché App.tsx (gelé).**

**Garde-fous respectés :** additif strict, rétro-compat ; i18n GELÉ (zéro clé créée) ;
types Ticket/TicketMessage/KBArticle utilisés tels quels ; ApiResponse string-match
`error` jamais `code` ; CSS append-only Stripe-sober + `prefers-reduced-motion` ;
ZÉRO modification tickets.ts/kb.ts (Manager-B)/worker.ts/api.ts/i18n/migration/
App.tsx/6 pages R/`src/worker/*`. Build NON vérifié (VMware sans bun/node) —
**build délégué Antigravity**.
