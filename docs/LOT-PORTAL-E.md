# LOT PORTAL-E — Portail client final (Sprint E)

> Document de contrat FIGÉ (Chaman READ-ONLY recopié par Manager Phase A SOLO).
> Phase B/C ne lisent QUE ce document + le CODE. Les signatures (params,
> Response, contrat de contexte) NE CHANGENT PAS.

## Vue d'ensemble

Portail authentifié 100% SÉPARÉ du CRM où le **client final** d'un pro (lead
converti) consulte SES factures / devis / RDV / documents / tickets, demande un
RDV, crée un ticket et signe un document. Auth distincte de l'admin
(`admin_sessions`/`users`) ET de l'espace membre (`member_sessions`/`members`).

## §0 audit

- Patron auth séparée `member-auth.ts` : extractMemberToken (Bearer→?token=),
  resolveSiteTenant (slug→membership_sites→client_id), requireMember
  (member_sessions JOIN members WHERE token+expires_at>datetime('now'), jamais
  users/admin_sessions, 401 propre), finishMemberLogin (token randomUUID, INSERT
  session, json({data:{token,member}})), hashPassword/verifyPassword de
  crypto.ts. Câblage worker.ts bloc membre publiques pré-requireAuth +
  requireMember en amont, anti-shadowing, réponses {data}/{error} sans code,
  503 si table absente.
- **5 entités ont TOUTES lead_id + client_id** (bornage double natif zéro ALTER) :
  invoices (seq18, lead_id ✓, timestamps CURRENT_TIMESTAMP legacy), quotes
  (seq82, lead_id ✓), appointments (seq4, lead_id ✓), documents (seq11, lead_id ✓
  + token UNIQUE + signature_data + status), support_tickets (seq89, lead_id ✓,
  timestamps unixepoch + handlePublicSubmitTicket public anonyme).
- **lead_id = pivot universel.** seq 100 dernière → 101 libre. billing.view ∈
  ALL_CAPABILITIES. handleMembershipSites = patron config PRO. App.tsx /m/$slug
  lazy hors LazyGuard. Token distinct intralys_member_token.

## §6.A archi (tranché)

- **Q1 identité** : entité dédiée `portal_users(email, password_hash, client_id,
  lead_id, status)`. lead_id (au provisioning) = clé agrégation. PAS de
  réutilisation members, PAS de promotion lead.
- **Q2 auth** : `requirePortalUser` calque EXACT requireMember, table
  `portal_sessions` SEULE (jamais users/admin_sessions/members/member_sessions).
  Token distinct `intralys_portal_token`. Tenant via slug `portal_sites` (calque
  membership_sites).
- **Q3 données v1** : factures+devis+RDV+documents+tickets, chaque SELECT borné
  `WHERE lead_id=ctx.leadId AND client_id=ctx.clientId` (les 2 de la session,
  JAMAIS body/query). **Isolation DOUBLE.**
- **Q4 actions v1** : LECTURE + créer ticket (INSERT borné lead_id/client_id
  source='portal') + demander RDV (lien booking public existant) + signer doc
  (flux token existant exposé en lecture statut). **AUCUN paiement E4** (facture
  lecture seule).
- **Q5 provisioning** : admin invite (POST /api/portal-users capGuard, choisit
  lead → crée portal_users + email/lien set-password). Pas d'auto-création.
- billing.view réutilisée. Isolation cross-lead+cross-tenant.

## §6.B migration seq 101 (`migration-portal-seq101.sql`, depends 100)

En-tête garde-fous calque seq 100. Timestamps `datetime('now')`. Zéro
FK/CHECK/ALTER. 3 tables `portal_users` / `portal_sessions` / `portal_sites` +
4 index (token, (client_id,email), slug, lead_id).

Manifest : `{ "seq": 101, "file": "migration-portal-seq101.sql", "depends_on":
["migration-attribution-cohort-seq100.sql"], "objects":
["table:portal_users","table:portal_sessions","table:portal_sites",
"index:portal_sessions","index:portal_users","index:portal_sites"], "risk":
"low" }`.

## §6.C backend

- `src/worker/portal-auth.ts` (calque member-auth.ts) : `PortalContext
  {portalUserId, leadId, clientId, agencyId}`, extractPortalToken,
  resolvePortalSiteTenant (slug→portal_sites), `requirePortalUser`
  (portal_sessions JOIN portal_users, injecte leadId+clientId, 401 propre),
  finishPortalLogin, handlePortalLogin/handlePortalSetPassword/handlePortalLogout.
  hashPassword/verifyPassword RÉUTILISÉS crypto.ts. **Phase A = handlers auth
  corps réels (calque member) ; les 5 agrégateurs = stubs (portal.ts).**
- `src/worker/portal.ts` : handlePortalInvoices/Quotes/Appointments/Documents/
  Tickets (STUBS Phase A, corps Phase B : SELECT WHERE lead_id=? AND client_id=?)
  + handlePortalCreateTicket (stub) + handlePortalSites/handlePortalUsers (config
  PRO, capGuard billing.view).
- Routes worker.ts (APRÈS bloc member, AVANT /l/:id) publiques :
  `/api/portal/:slug/{login,set-password,logout}` POST + requirePortalUser amont
  pour `/api/portal/:slug/{invoices,quotes,appointments,documents,tickets}` GET +
  `/api/portal/:slug/tickets` POST. Anti-shadowing. Côté PRO (bloc requireAuth) :
  `/api/portal-sites`, `/api/portal-users`.

## §6.D api.ts

Token EXPLICITE `intralys_portal_token` (jamais apiFetch admin) : portalLogin/
portalSetPassword/portalLogout, getPortalInvoices/Quotes/Appointments/Documents/
Tickets(slug,token), createPortalTicket. Types PortalAuthResult/PortalInvoice/
etc. PRO via apiFetch : getPortalSites/createPortalSite, getPortalUsers/
invitePortalUser. ApiResponse INCHANGÉ (jamais code).

## §6.E i18n `portal.*` ×4

login.*/invoices.*/quotes.*/appointments.*/documents.*/tickets.*/nav.*/empty.*/
admin.*. 4 catalogues parité stricte (56 clés chacun : fr-CA, fr-FR, en, es).

## §6.F pages

`src/pages/PortalSpace.tsx` (stub Phase A, export PortalSpacePage figé, page
publique calque MemberSpace, token intralys_portal_token) → route
`/portal/$slug` (calque /m/$slug hors LazyGuard, collision /portal vérifiée
libre). `src/pages/PortalSettings.tsx` (stub, config PRO sous LazyGuard/auth) →
route protégée `/portal-settings`. Phase A = stubs + routes.

## §6.G découpage

- **Phase A SOLO** : migration+manifest + portal-auth.ts (auth corps réels calque
  member + agrégateurs stubs) + portal.ts (stubs) + routes worker.ts + api.ts +
  i18n ×4 + stubs PortalSpace.tsx/PortalSettings.tsx + routes App.tsx + doc.
- **Phase B Manager-B** : corps 5 agrégateurs portal.ts (SELECT bornés
  lead_id+client_id) + handlePortalCreateTicket + config PRO portal_users/sites.
- **Phase B Manager-C** : PortalSpace.tsx (login + dashboard 360 onglets) +
  PortalSettings.tsx (config PRO).

## §6.I garde-fous

Additif (3 tables IF NOT EXISTS) · CHECK59/E4-E6-paiement JAMAIS (facture lecture
seule) · auth 100% séparée (requirePortalUser lit portal_sessions UNIQUEMENT,
token distinct) · **ISOLATION DOUBLE (lead_id ET client_id depuis session,
jamais body/query)** · zéro ajout ALL_CAPABILITIES (billing.view) · ApiResponse
inchangé · zéro FK · datetime('now') (sauf INSERT ticket = unixepoch cohérence
support_tickets) · best-effort (table absente 401/503) · jamais git.

---

## État Phase A (livré)

| Élément | Fichier | État |
|---|---|---|
| Migration seq 101 | `migration-portal-seq101.sql` | ✅ 3 tables + 4 index |
| Manifest | `docs/migrations-manifest.json` | ✅ seq 101 ajouté |
| Auth portail (corps réels) | `src/worker/portal-auth.ts` | ✅ login/set-password/logout/requirePortalUser |
| Agrégateurs + config PRO | `src/worker/portal.ts` | ✅ STUBS (corps Phase B) |
| Routes worker | `src/worker.ts` | ✅ publiques + PRO |
| Helpers + types | `src/lib/api.ts` | ✅ token explicite + apiFetch PRO |
| i18n ×4 | `fr-CA/fr-FR/en/es.ts` | ✅ 56 clés `portal.*` chacun |
| Stub page publique | `src/pages/PortalSpace.tsx` | ✅ export figé |
| Stub config PRO | `src/pages/PortalSettings.tsx` | ✅ export figé |
| Routes React | `src/App.tsx` | ✅ /portal/$slug + /portal-settings |

---

## IMPLEMENTATION-LOG Phase B Manager-B (corps réels `portal.ts`)

> Fichier écrit : `src/worker/portal.ts` UNIQUEMENT. Entités sources lues
> (invoices/quotes/appointments/documents/support_tickets/leads) NON modifiées
> (SELECT/INSERT bornés dédiés). `portal-auth.ts` non touché (IMPORTE
> `PortalContext`). worker.ts/api.ts/i18n/migration GELÉS. PortalSpace.tsx /
> PortalSettings.tsx (Manager-C) non touchés.

### Helpers ajoutés (calque memberships.ts)
- `rowInTenant(row, auth)` — bornage tenant config PRO (legacy → true ; agence →
  client_id ∈ accessibleClientIds OU agency_id == tenant.agencyId).
- `tenantIds(auth)` — client_id/agency_id POSÉS depuis le tenant à la création.
- Imports ajoutés : `sanitizeInput` (helpers), `hashPassword` (crypto.ts).

### 5 agrégateurs portail (ISOLATION DOUBLE — `WHERE lead_id=? AND client_id=?`)
Chaque SELECT borne sur `portal.leadId` ET `portal.clientId`, les DEUX issus du
`PortalContext` (session, injecté par `requirePortalUser` en amont worker.ts) —
JAMAIS body/query. Tous best-effort (catch → `{data:[]}`, jamais 500).

| Handler | Table | Colonnes exposées (projection) | E4 |
|---|---|---|---|
| `handlePortalInvoices` | invoices | id, number(invoice_number), status, total(`total ?? amount`), currency, subtotal, tax_tps, tax_tvq, issued_at(created_at), due_at(due_date), description | **payment_url / stripe_invoice_id EXCLUS de la projection** — lecture seule |
| `handlePortalQuotes` | quotes | id, number, status, total, subtotal, tax_tps, tax_tvq, valid_until, description, created_at | lecture seule |
| `handlePortalAppointments` | appointments | id, title, status, start_at(start_time), end_at(end_time), location, type — à venir + passés (ORDER BY start_time DESC) | n/a |
| `handlePortalDocuments` | documents | id, name(title), status, signed_at, sent_at, expires_at, created_at, `sign_url=/sign/:token` SI status∈{sent,viewed} — **flux token EXISTANT exposé, jamais body_html/signature_data/audit_trail** | n/a |
| `handlePortalTickets` | support_tickets + ticket_messages | id, subject, status, priority, last_message_at, created_at + messages PUBLICS (is_internal=0 uniquement) | n/a |

### Création ticket — `handlePortalCreateTicket`
- INSERT support_tickets **borné lead_id=portal.leadId, client_id=portal.clientId
  DEPUIS LA SESSION** (jamais body), `source='portal'`, `status='ouvert'`,
  agency_id NULL (calque handlePublicSubmitTicket), priority 'normal', sla 'none'.
- **Timestamps `unixepoch()`** (`Math.floor(Date.now()/1000)`) pour
  last_message_at/created_at/updated_at — cohérence support_tickets seq 89.
- 1er message inbound best-effort (try/catch interne non bloquant).
- Validation : body requis (400) sinon. Table absente → 503 propre (jamais 500).

### Config PRO (auth admin séparée — `auth: PortalAuth`, PAS PortalContext)
- `handlePortalSites` : GET liste bornée `rowInTenant` / POST crée portal_sites
  (client_id+agency_id du TENANT), **slug unicité APPLICATIVE** (SELECT préalable
  → 409 ; pas d'index UNIQUE seq 101). `portalCapGuard` = **billing.view**.
- `handlePortalUsers` : GET liste bornée (password_hash JAMAIS projeté) / POST
  invite : email + lead_id du body, le **lead_id est VALIDÉ appartenir au tenant**
  (SELECT leads + rowInTenant → 404 sinon) ; client_id/agency_id POSÉS du tenant
  (jamais body) ; anti-doublon (client_id,email) → 409 ; `hashPassword` (pbkdf2
  crypto.ts) si password ≥6 fourni (status 'active') SINON placeholder `'!'`
  non-vérifiable + status 'pending' (force le flux set-password de portal-auth.ts,
  qui exige `startsWith('pbkdf2$')`). `portalCapGuard` = **billing.view**.

### Conformité garde-fous
- ISOLATION DOUBLE : OUI — les 5 agrégateurs + INSERT ticket bornent lead_id ET
  client_id depuis la session. Config PRO borne via tenant + valide lead_id ∈ tenant.
- E4 jamais : OUI — invoices lecture seule, projection sans payment_url/stripe_*.
- Auth séparée : OUI — ctx portail (requirePortalUser) pour les 6 handlers
  portail ; auth admin (CapAuth+capabilities) pour les 2 handlers config PRO.
- billing.view : OUI — ZÉRO ajout ALL_CAPABILITIES.
- best-effort : OUI — tout try/catch, jamais 500 ; tables absentes → {data:[]}/503.
- ApiResponse inchangé : OUI — uniquement {data}/{error}, jamais `code`.
- Entités sources READ-ONLY : OUI — SELECT dédiés + INSERT support_tickets/
  portal_sites/portal_users uniquement (tables propres au lot + cible ticket).

---

## IMPLEMENTATION-LOG Phase B Manager-C (front — `PortalSpace.tsx` + `PortalSettings.tsx`)

> Fichiers écrits : `src/pages/PortalSpace.tsx`, `src/pages/PortalSettings.tsx`,
> `src/index.css` (bloc sentinellé `/* === Sprint E Portail === */` … `/* === Fin
> Sprint E === */` en fin de fichier), ce doc. READ-ONLY tenu : worker/*,
> api.ts/types.ts/i18n/migration/App.tsx/worker.ts (Phase A gelés), portal.ts/
> portal-auth.ts (Manager-B), 6 pages R cœur, autres pages.

### PortalSpace.tsx — portail client PUBLIC (route `/portal/$slug`)
- **Token portail DISTINCT** : `intralys_portal_token` (localStorage), JAMAIS
  `intralys_token` (admin) NI `intralys_member_token` (membre). Lecture/écriture
  via `readPortalToken` / `persistToken` — calque EXACT MemberSpace.
- **Écran auth** (pas de token) : 2 modes `login` / `set` (activation
  set-password sur invitation) → `portalLogin` / `portalSetPassword(slug, {email,
  password})` → stocke `res.data.token`. Discrimination erreur = `res.error ||
  !res.data` (JAMAIS de `code`). Toggle login↔activation.
- **Dashboard 360** (token valide) : 5 onglets nav (`portal.nav.*`) chargés à la
  demande via `loadTab` (token portail EXPLICITE passé à chaque helper). Token
  invalide/expiré (`res.error`) → purge + retour login. Spinner pendant chargement.
  - **Factures** : `getPortalInvoices` — numéro/montant/statut/date. **LECTURE
    SEULE — AUCUN bouton payer** (E4 jamais). Montant via `Intl.NumberFormat`
    devise localisée (cents/100).
  - **Devis** : `getPortalQuotes` — numéro/montant/statut/date.
  - **RDV** : `getPortalAppointments` — à venir/passés (titre/statut/dates) +
    bouton « demander un RDV » (`portal.appointments.request`) → lien booking
    public `/book/${slug}` (route `publicBookingRoute` vérifiée, `_blank`).
  - **Documents** : `getPortalDocuments` — nom/statut/signé le. Lien
    `portal.documents.sign` affiché SI le backend renvoie `sign_url` (flux token
    EXISTANT, lu défensivement par cast — type figé non modifié) ET status ∈
    {sent, viewed}. Aucun token fabriqué côté front.
  - **Tickets** : `getPortalTickets` liste + bouton « nouveau ticket »
    (`portal.tickets.new`) dépliant un form sujet+message → `createPortalTicket`.
- **Empty states** par onglet (`portal.empty.*`). **Logout** (`portalLogout`)
  purge UNIQUEMENT le token portail. Page standalone épurée (calque MemberSpace,
  hors chrome app). Footer « Propulsé par Intralys ».

### PortalSettings.tsx — config PRO (route protégée `/portal-settings`)
- Auth CRM via les helpers `apiFetch` Phase A (capability `billing.view` enforced
  côté worker). `AppLayout title={t('portal.admin.title')}`.
- **Portails** : `getPortalSites` liste (nom + chip slug + dot statut actif +
  lien externe `/portal/${slug}`) / `createPortalSite({slug, name, is_active:1})`
  via modale (`portal.admin.new_site`).
- **Clients invités** : `getPortalUsers` liste (nom/courriel + Tag statut
  active/pending — password JAMAIS exposé) / `invitePortalUser({lead_id, email,
  name})` via modale. **Provisioning par choix de lead** (`getLeads` →
  `<Select>` `portal.admin.choose_lead`) ; sélection pré-remplit courriel/nom du
  lead (best-effort, modifiable). Bouton invite désactivé tant que lead+email
  absents. Pas d'auto-inscription.
- Primitives réutilisées (calque CoursesAdmin) : Card / Button / Tag / Modal /
  Input / Select / Skeleton / EmptyState / useToast.

### CSS (bloc Sprint E sentinellé)
- `.portal-tab` / `.portal-tab--active` (calque `.community-tab` Stripe-sober :
  soft tint primary 8 %, border 20 %, pill) + `@media (prefers-reduced-motion)`
  neutralise transition + `.portal-spinner` animation. Zéro orb/glow/gradient.

### Conformité garde-fous
- Token portail DISTINCT : OUI — `intralys_portal_token` seul (jamais admin/membre).
- Facture LECTURE SEULE : OUI — aucun bouton/lien de paiement (E4 jamais).
- i18n GELÉ : OUI — 100 % `t('portal.*')` clés Phase A câblées, **AUCUNE créée**.
  (Note : statuts bruts factures/devis/RDV/docs/tickets affichés tels que renvoyés
  par le backend — données, pas des libellés UI.)
- Types figés : OUI — `sign_url` lu par cast local sans modifier `PortalDocument`.
- ApiResponse inchangé : OUI — discrimination `res.error || !res.data`, jamais `code`.
- Disjonction : OUI — zéro touch worker/api/types/i18n/migration/App.tsx/worker.ts/
  portal.ts/portal-auth.ts/6 pages R. CSS = bloc sentinellé append-only.

### Écarts / notes
- **Booking public** : route réelle = `/book/$slug` (`publicBookingRoute`), pas
  `/b/$slug` ni Calendly — lien câblé sur `/book/${slug}`.
- **Document sign_url** : exposé par Manager-B (`/sign/:token`, status sent|viewed)
  mais ABSENT du type figé `PortalDocument` (id/name/status/signed_at). Lu via cast
  `(doc as { sign_url?: string|null })` — le lien n'apparaît que si le backend le
  fournit ; aucun token reconstruit côté front.
- **Set-password** : la spec mentionne un « lien invitation avec token/param ».
  Le helper figé `portalSetPassword(slug, {email, password})` n'accepte PAS de
  token de paramètre d'URL — l'activation passe donc par email+nouveau mot de
  passe (le worker, via placeholder `'!'` non vérifiable + status pending, force
  ce flux). UI = toggle « Définir mon mot de passe » sur l'écran de connexion.
