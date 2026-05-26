# LOT G2 — Programme d'affiliation natif

Contrat figé (Chaman READ-ONLY a audité disque, code fait foi). Méthode 18
agents : Chaman → Phase A SOLO (squelette + transverses + 2 hooks leads.ts) →
Phase B B∥C (Manager-B backend `affiliates.ts` ∥ Manager-C front `Affiliates.tsx`).

---

## §0 — AUDIT DISQUE (confirmé Chaman, code fait foi)

- **trigger-links.ts réutilisable ~40%** (pattern, PAS table) : `trigger_links` +
  `trigger_link_clicks` (seq 31) + `handleTriggerLinkClick` route publique
  `/l/:id` (worker.ts:517) = MODÈLE click→log→302 à calquer. → **table NEUVE
  `affiliate_clicks` + route publique NEUVE `/r/:code`** (calque `/l/:id`), zéro
  ALTER trigger_links.
- **ABSENT confirmé** : `affiliate|commission|payout|parrain` = ZÉRO. `referral`
  existe UNIQUEMENT comme source de lead (NE PAS toucher). Namespace `affiliate.*`
  libre.
- **⚠️ PIÈGE attribution** : `ATTRIBUTION_ALIASES.referrer` inclut déjà l'alias
  `'ref'` (lead-mapping.ts:47) → un param `?ref=` serait avalé par `referrer`. →
  **utiliser `?aff=CODE`** (PAS `?ref=`), zéro collision.
- **Attribution lead = pipeline `ingestLead` (leads.ts:813)** partagé
  (mapping→dedup→merge→insert), colonne `leads.referrer` existe.
- **seq libre = 92** (manifest dernière = 91 aiworkspace).
- **Collisions routes** : App.tsx → AUCUN `/affiliate`/`/parrain`/`/aff` (libre).
  worker.ts → `/l/:id`, `/api/p/:slug` pris ; `/r/...` LIBRE.
- **Capabilities** : `workflows.manage` + `leads.write` dans ALL_CAPABILITIES
  (12 figées). `helpdeskCapGuard` (tickets.ts:87, mode-agence-only) = template exact.

## §6.A — ARCHITECTURE (tranché)

- **Q1** : entité dédiée **`affiliates`** (email + code unique + nom, borné
  client_id). Pas de 2e auth. Promotion lead→affilié = v2.
- **Q2** : table NEUVE `affiliate_clicks` + route publique `/r/:code` (calque
  `/l/:id`). Set cookie `aff_attr=<code>` Max-Age=cookie_window_days×86400, log
  clic, 302 vers `target_url` du programme.
- **Q3** : **table de jonction `affiliate_referrals`** (PAS de colonne
  `leads.affiliate_id` — zéro ALTER leads). Hook best-effort dans `ingestLead` :
  si payload porte `data.aff` → résoudre code→affiliate_id (borné client_id) →
  INSERT jonction. try/catch avalant (échec n'échoue JAMAIS la création lead).
- **Q4** : commission **v1 = par CONVERSION (lead→won)**, `commission_type` ∈
  `fixed|percent` (fixed=montant ; percent=% de `leads.deal_value`). Calcul
  SERVEUR, statut `pending|approved|paid|rejected`. Base e-comm/facture = v2.
- **Q5** : `affiliate_programs` (1 par tenant : commission_type, commission_value,
  cookie_window_days, target_url, status). Paliers = v2 (taux unique v1).
- **Q6** : **payout v1 = MANUEL** (admin marque approved→paid + export CSV).
  **ZÉRO Stripe, E4 `payments_live_enabled=0` JAMAIS touché.** Payout auto = v2.
- **Q7** : **`workflows.manage` réutilisée** (zéro ajout ALL_CAPABILITIES).
- **Q8** : v1 = côté PRO (`Affiliates.tsx`) + redirect public `/r/:code`. Portail
  self-service affilié = v2.
- Modèle data : 5 tables bornées `client_id` nullable. **Cross-tenant : tout
  SELECT/INSERT borné `client_id ∈ accessibleClientIds OU agency_id ==
  tenant.agencyId` (calque loadTicketInTenant).**

## §6.B — MIGRATION seq 92 (`migration-affiliate-seq92.sql`, depends 91)

En-tête garde-fous style seq 91. **Timestamps `datetime('now')`** (calque
seq 90/91, PAS unixepoch). Zéro FK, zéro CHECK (statuts validés HANDLER), zéro
ALTER leads. 5 CREATE TABLE (affiliates, affiliate_programs, affiliate_clicks,
affiliate_referrals, affiliate_commissions) + 4 CREATE INDEX (idx_aff_code,
idx_aff_referral_lead, idx_aff_commission_affiliate, idx_aff_clicks_code).
Manifest seq 92 risk:low, depends_on seq 91. Code unicité APPLICATIVE
(slugify+collision, PAS UNIQUE SQL).

## §6.C — ROUTES worker.ts

**Publique (pré-requireAuth, calque `/l/:id`)** : `/r/:code` GET →
`handleAffiliateRedirect(request, env, code)` (résout code→programme borné
client_id du code, set cookie aff_attr, log affiliate_clicks, 302 vers
target_url ; anonyme).
**Protégées (routeProtected, calque funnels + tickets capGuard)** — garde
`affiliateCapGuard(auth)` mode-agence-only (`workflows.manage`), bornage client_id :
- `/api/affiliates` GET/POST ; `/api/affiliates/:id` GET/PUT/DELETE
- `/api/affiliate-program` GET/PUT (singleton tenant)
- `/api/affiliate-commissions` GET ; `/api/affiliate-commissions/export` GET (CSV,
  AVANT /:id) ; `/api/affiliate-commissions/:id` PATCH (status)
Anti-shadowing (export avant :id, /r/:code distinct de /l/:id).

## §6.D — API helpers (api.ts) + types — ApiResponse INCHANGÉ jamais code

Types `Affiliate`, `AffiliateProgram`, `AffiliateCommission`. Helpers (calque bloc
trigger-links api.ts) : `getAffiliates()`, `createAffiliate(b)`,
`updateAffiliate(id,b)`, `deleteAffiliate(id)`, `getAffiliateProgram()`,
`updateAffiliateProgram(b)`, `getAffiliateCommissions(params?)`,
`updateCommissionStatus(id,status)`, `exportCommissionsCsv()`. apiFetch/ApiResponse
GELÉS.

## §6.E — i18n `affiliate.*` ×4 catalogues parité STRICTE avant usage

`affiliate.title` + `.program.*` (type/value/cookie_window/target_url/status) +
`.list.*` + `.commission.status.{pending,approved,paid,rejected}` +
`.action.{mark_paid,reject,export}` + `.public.landing.*`. Conserver
`labels.source.referral` INTACT. Ordre fr-CA→fr-FR→en→es. **30 clés ×4 (vérifié
diff identique).**

## §6.F — PAGES (App.tsx)

- `Affiliates.tsx` PRO NEUF (stub Phase A) → route `/affiliates` (LazyGuard),
  libre confirmé. Onglets Programme/Affiliés/Commissions = Phase B.
- Redirect public `/r/:code` = 100% worker (302), AUCUNE page React.
- 6 pages R exclues.

## §6.G — DÉCOUPAGE

Phase A SOLO (Manager-A) : migration seq 92 + manifest + stubs
`src/worker/affiliates.ts` (handlers signatures figées + affiliateCapGuard +
loadAffiliateInTenant + stubs `onLeadWon(env, leadId)` + `attributeReferral(env,
leadId, affCode, clientId)` corps placeholder) + routes worker.ts + api.ts
helpers/types + i18n ×4 + stub Affiliates.tsx + route App.tsx + **2 hooks
best-effort dans leads.ts** + `docs/LOT-AFFILIATE-G2.md` §6.
Phase B Manager-B (backend exclusif) : corps `affiliates.ts` (redirect/clicks,
CRUD, capGuard, bornage, onLeadWon commission, attributeReferral, export CSV).
Phase B Manager-C (front exclusif) : `Affiliates.tsx` 3 onglets.

## §6.H — DISJONCTION

- Exclusifs B : `src/worker/affiliates.ts` (corps).
- Exclusifs C : `src/pages/Affiliates.tsx`.
- Gelés Phase A (INTOUCHÉS Phase B) : worker.ts, api.ts, App.tsx, i18n ×4,
  migration, manifest, **leads.ts (les 2 hooks posés Phase A)**.
- READ-ONLY Phase B (pattern only) : trigger-links.ts, forms.ts, lead-mapping.ts,
  capabilities.ts, tenant-context.ts, tickets.ts.

## §6.I — GARDE-FOUS

Additif strict (5 CREATE TABLE + 4 idx, zéro ALTER, zéro FK, zéro CHECK) ·
**E4-E6 JAMAIS activés, payout MANUEL v1** · cross-tenant borné client_id ·
CHECK59 intouché · 6 pages R exclues · i18n 4 catalogues parité avant usage · SPA
pas SSR · ZÉRO ajout ALL_CAPABILITIES (workflows.manage) · ApiResponse inchangé
jamais code · jamais git config.

---

## IMPLEMENTATION-LOG — Phase A SOLO (Manager-A, 2026-05-20)

### Fichiers CRÉÉS
- `migration-affiliate-seq92.sql` — 5 tables + 4 index, additif strict, en-tête
  garde-fous calqué seq 91, timestamps `datetime('now')`.
- `src/worker/affiliates.ts` — stubs : `affiliateCapGuard` (mode-agence-only
  'workflows.manage'), `loadAffiliateInTenant` (calque loadTicketInTenant),
  11 handlers signatures figées (redirect public + CRUD + program singleton +
  commissions GET/export/PATCH), + 2 hooks `attributeReferral` / `onLeadWon`
  (corps no-op Phase A). Constantes statuts exportées (validation HANDLER).
- `src/pages/Affiliates.tsx` — stub `AffiliatesPage` (AppLayout + EmptyState).
- `docs/LOT-AFFILIATE-G2.md` — ce fichier.

### Fichiers MODIFIÉS (transverses, gelés Phase A)
- `docs/migrations-manifest.json` — entrée seq 92 (depends_on seq 91, risk low,
  9 objects).
- `src/worker.ts` — import bloc affiliates ; route publique `/r/:code` (après
  `/l/:id`) ; 9 routes protégées (anti-shadowing : `/export` AVANT `/:id`,
  singleton `/affiliate-program` distinct de `/affiliates/:id`).
- `src/lib/api.ts` — 3 types + 9 helpers (apiFetch GELÉ ; `exportCommissionsCsv`
  fetch brut text/csv avec token, hors apiFetch puisque réponse non-JSON).
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 30 clés `affiliate.*` ×4, parité
  diff-identique vérifiée ; `labels.source.referral` INTACT.
- `src/App.tsx` — lazy import + `affiliatesRoute` `/affiliates` (LazyGuard) +
  entrée addChildren. Redirect public = worker-only, AUCUNE route React.
- `src/worker/leads.ts` — **2 hooks best-effort additifs** (détails ci-dessous).

### HOOKS leads.ts — emplacements EXACTS (Manager-B NE TOUCHE PAS leads.ts)
1. **`ingestLead`** : hook posé APRÈS l'INSERT du lead réussi + audit +
   logIngestConsent + createNotification, AVANT le bloc autoEnroll workflows
   `lead_created`. Résout le code affilié depuis le payload `body` : `data.aff`
   (si `body.data` objet, calque la double-arrivée forms.ts) sinon `body.aff`.
   Si code non vide → `import('./affiliates')` + `attributeReferral(env, id,
   affCode, clientId)`. **try/catch TOTAL avalant** : un échec n'échoue JAMAIS
   l'ingestion. `id` = nouveau lead, `clientId` = du contexte ingestLead.
2. **`handlePatchLead`** : hook posé immédiatement APRÈS le bloc existant
   `if (body.status === 'won' && autoEnrollFn) { ...deal_won workflows... }`,
   toujours dans le `if (body.status !== undefined ...)` parent. `if (body.status
   === 'won')` → `import('./affiliates')` + `onLeadWon(env, leadId)`. **try/catch
   TOTAL avalant**. Additif pur : aucune ligne existante modifiée.

Les deux hooks sont strictement additifs ; le reste de leads.ts est
byte-identique. Manager-B implémente UNIQUEMENT les corps `attributeReferral` /
`onLeadWon` (et les autres handlers) DANS `affiliates.ts` — il ne rouvre PAS
leads.ts.

### Écarts CODE > brief
- Aucun écart structurel. Le brief listait `affiliateCapGuard` avec garde
  conditionnelle ; calqué EXACTEMENT sur `tickets.ts:helpdeskCapGuard`
  (mode-agence-only : retourne undefined si !tenant || agencyId==null || !caps,
  sinon requireCapability). funnels.ts:capGuard est plus court (toujours
  requireCapability) — j'ai retenu le pattern tickets (plus prudent legacy).
- `exportCommissionsCsv` : réponse text/csv non-JSON → impossible via apiFetch
  (qui parse JSON). Helper dédié fetch brut avec token+X-Sub-Account, ApiResponse
  enveloppé manuellement, apiFetch INTOUCHÉ (§6.D respecté à la lettre).
- `affiliate.action.approve` ajouté en plus de mark_paid/reject/export (cohérence
  workflow approved→paid). 30 clés ×4 au lieu de ~28-34 annoncé — dans la borne.

### CONFIRMATIONS garde-fous
- **E4-E6 INTOUCHÉS** : aucune référence payments/payment_events/refunds/disputes.
  Payout manuel v1 (export CSV + PATCH status). Zéro Stripe.
- **CHECK59 / rebuild:users INTOUCHÉ** : aucun ALTER users, aucun touch seq 59.
- **6 pages R intouchées** : seules pages NEUVE Affiliates.tsx.
- **Zéro collision route (piège G1)** : `/r/:code` distinct de `/l/:id` ;
  `/affiliates` libre dans App.tsx (grep confirmé) ; `/affiliate-program`
  singleton distinct de `/affiliates/:id` ; `/export` avant `/:id`.
- **Attribution `?aff=`** (PAS `?ref=`) : 'ref' avalé par referrer confirmé.
- **i18n parité STRICTE** : 30 clés identiques ×4 (diff vérifié), referral intact.
- **ZÉRO ajout ALL_CAPABILITIES** : 'workflows.manage' réutilisée.

> **Build délégué Antigravity** (VMware sans bun/node — pas de claim build OK).

---

## IMPLEMENTATION-LOG — Phase B Manager-B (backend exclusif, 2026-05-20)

### Fichier MODIFIÉ (exclusif B)
- `src/worker/affiliates.ts` — stubs Phase A → CORPS RÉELS. AUCUN autre fichier
  de code touché (worker.ts / api.ts / i18n / leads.ts / migration GELÉS, lus
  seulement). Helpers ajoutés en privé : `loadCommissionInTenant`, `slugify`
  (calque funnels.ts), `tenantFilter` (calque funnels.ts:115-127), `csvCell`
  (échappement CSV). Import `sanitizeInput` ajouté depuis ./helpers.

### Handlers / fonctions réécrits (11 handlers + 2 hooks)
1. **handleAffiliateRedirect** (PUBLIC) — résout code→affilié actif, SELECT
   programme du tenant du code, log `affiliate_clicks` (ip/UA best-effort), set
   cookie `aff_attr=<code>` (Max-Age = cookie_window_days×86400, Path=/, HttpOnly,
   SameSite=Lax), 302 vers `target_url` (ou `/`). Code introuvable / panne → 302
   `/` (JAMAIS de 500). Calque trigger-links.ts:handleTriggerLinkClick.
2. **handleGetAffiliates** — SELECT borné `tenantFilter` (legacy → pas de borne ;
   agence → agency_id OR client_id IN accessibleClientIds), tri created_at DESC.
3. **handleCreateAffiliate** — INSERT avec code unique APPLICATIF (slugify + suffixe
   collision borné tenant), client_id/agency_id POSÉS depuis le tenant, status
   validé HANDLER. 201 { id, code }.
4. **handleGetAffiliate** — loadAffiliateInTenant → 404, sinon row + stats
   best-effort (clics / referrals / commissionsTotal hors rejected).
5. **handleUpdateAffiliate** — loadAffiliateInTenant → UPDATE partiel
   name/email/status (status validé HANDLER), updated_at.
6. **handleDeleteAffiliate** — loadAffiliateInTenant → DELETE affilié + nettoyage
   applicatif clicks/referrals/commissions (pas de FK/cascade).
7. **handleGetAffiliateProgram** — SELECT singleton `client_id IS ?` ; absent →
   defaults (fixed/0/30j/active). Table absente → defaults (jamais 500).
8. **handleUpdateAffiliateProgram** — UPSERT applicatif (UPDATE si singleton
   existe sinon INSERT). commission_type/value (≥0), cookie_window_days (>0,
   défaut 30), target_url, status — tous validés/bornés HANDLER.
9. **handleGetAffiliateCommissions** — SELECT borné tenant + filtres optionnels
   status (validé) / affiliate_id, tri created_at DESC, jointure applicative
   nom/email affilié (1 SELECT par id distinct).
10. **handleExportAffiliateCommissions** — CSV text/csv (header affilie/email/
    lead_id/montant/devise/statut/date) borné tenant + filtre status, cellules
    échappées `csvCell`. Table absente → header seul.
11. **handleUpdateCommissionStatus** — loadCommissionInTenant (borné client_id) →
    404, sinon UPDATE status ∈ pending|approved|paid|rejected (validé HANDLER),
    updated_at.

Hooks CRM (corps réels, appelés best-effort par leads.ts NON modifié) :
- **attributeReferral(env, leadId, affCode, clientId)** — résout affCode→affilié
  actif BORNÉ `client_id === clientId` (legacy clientId==null → affiliés
  client_id IS NULL ; FLAG cross-tenant : clientId vient de l'appelant, jamais
  arbitraire), idempotent (skip si referral déjà posé pour ce lead_id), INSERT
  affiliate_referrals. catch total → ne throw JAMAIS.
- **onLeadWon(env, leadId)** — SELECT referral du lead → idempotent (skip si
  commission déjà sur ce referral_id) → SELECT lead.deal_value + programme du
  tenant (referral.client_id) → calcul SERVEUR amount (fixed=value ;
  percent=value% de deal_value, arrondi 2 déc.) → INSERT affiliate_commissions
  status 'pending', currency 'CAD'. AUCUN paiement réel. catch total → jamais throw.

### Écarts CODE > brief
- `handleGetAffiliate` enrichi de `stats` (clics/referrals/commissionsTotal) —
  utile à la page détail, additif non-breaking (l'objet affilié reste sous `data`).
- `handleDeleteAffiliate` nettoie les tables liées (clics/referrals/commissions)
  vu l'absence de FK/cascade SQLite — évite des lignes orphelines.
- `loadCommissionInTenant` privé ajouté (le brief mentionnait
  `loadCommissionInTenant` pour le PATCH — implémenté, bornage client_id).
- En-tête CSV en français lisible (affilie/email/lead_id/montant/devise/statut/
  date) plutôt que les noms de colonnes SQL bruts du stub Phase A — payout admin.

### CONFIRMATIONS garde-fous
- **Signatures attributeReferral/onLeadWon EXACTES** : confirmé en lisant leads.ts
  (NON modifié) — `attributeReferral(env, id, affCode, clientId)` (ingestLead:949)
  et `onLeadWon(env, leadId)` (handlePatchLead:379). Corps adaptés à ces appels.
- **Cross-tenant borné client_id** : tout SELECT/INSERT borne le tenant —
  `tenantFilter` (agency_id OR client_id IN accessible) sur les listes/export/
  create-collision ; `loadAffiliateInTenant`/`loadCommissionInTenant` sur les
  accès par id ; attributeReferral exige affilié.client_id === clientId du lead ;
  onLeadWon calcule sur le lead réel + programme du client_id du referral. Un
  affilié d'un tenant ne touche JAMAIS les leads d'un autre.
- **E4-E6 INTOUCHÉS** : zéro Stripe/payments/payout réel. Commission = calcul +
  status only (pending/approved/paid/rejected), payout manuel (export CSV + PATCH).
- **Rétro-compat legacy byte-équivalent** : legacy/mono-tenant (agencyId==null) →
  `tenantFilter` clause vide (pas de borne, comme l'absence historique),
  affiliateCapGuard undefined (aucun bridage nouveau), affiliés/programme résolus
  sur client_id NULL.
- **leads.ts NON modifié** : hooks Phase A intacts, je n'ai écrit que les corps
  DANS affiliates.ts.
- **Best-effort** : les 2 hooks + tous les SELECT de liste avalent les erreurs
  (table seq 92 absente → liste vide / defaults / CSV header / 302 fallback),
  JAMAIS de 500/throw non maîtrisé.
- **ApiResponse / apiFetch INTOUCHÉS** : réponses `json({data})`/`json({error},status)`,
  jamais de champ `code`. Export = text/csv brut (hors apiFetch, calque Phase A).

> **Build délégué Antigravity** (VMware sans bun/node — pas de claim build OK).

---

## IMPLEMENTATION-LOG — Phase B Manager-C (front exclusif, 2026-05-20)

### Fichier MODIFIÉ (exclusif C)
- `src/pages/Affiliates.tsx` — stub Phase A → page PRO réelle 3 onglets
  (`AffiliatesPage` export FIGÉ préservé). AUCUN autre fichier touché.
  `src/index.css` NON appended : la page n'utilise que des classes utilitaires
  existantes (`prop-label`, `text-muted`, `border-subtle`, `t-h1`,
  `tabular-nums`, `font-mono`) + primitives UI — zéro nouvelle classe requise.

### UI — 3 onglets (`<Tabs>` Radix, state local `tab`)
1. **Programme** — `getAffiliateProgram()` → form `<Card>` : Select type
   (percent/fixed), Input value (number), Input cookie_window_days (number),
   Input target_url (url), `<Switch variant="success">` statut. Save →
   `updateAffiliateProgram` + toast + reload. 2e Card explicative du lien public
   `https://<origin>/r/<code>` (icône Link2).
2. **Affiliés** — `getAffiliates()` → `<table>` (nom/email/code mono/lien
   copiable/statut Tag). Bouton "Nouvel affilié" → `<Modal>` form nom+email+Switch
   statut → `createAffiliate`/`updateAffiliate`. Éditer (Pencil) / Supprimer
   (Trash2 + `useConfirm` danger → `deleteAffiliate`). Copier lien : clipboard +
   icône Copy↔Check feedback 1.8s.
3. **Commissions** — `getAffiliateCommissions(params?)` → `<table>` (affilié résolu
   via Map id→nom / lead_id / montant `Intl.NumberFormat` / statut Tag color-coded
   / date). FilterChip statut (all/pending/approved/paid/rejected) → reload param
   `{status}`. Actions par ligne : pending→Approuver/Refuser, approved→Marquer
   payée (`updateCommissionStatus`). Export CSV (Download).

### Check i18n — clés `t('affiliate.*')` câblées (toutes Phase A, ZÉRO création)
`affiliate.title` · `.program.{title,type,type.percent,type.fixed,value,cookie_window,target_url,status,save}` ·
`.list.{title,empty,add,name,email,code,link}` ·
`.commission.{title,amount,status.pending,status.approved,status.paid,status.rejected}` ·
`.action.{approve,reject,mark_paid,export}` · `.public.landing.title`.
Clés communes existantes réutilisées : `action.{save,cancel,delete,edit}`,
`common.lead`, `common.enrolled_on`. **Aucune clé manquante → aucun fallback inline.**

### Mapping statut commission → variant Tag (Stripe-sober)
pending→warning · approved→info · paid→success · rejected→danger
(statut affilié active→success / inactive→neutral).

### Download CSV
`exportCommissionsCsv()` retourne `ApiResponse<string>` (CSV brut, helper Phase A
fetch text/csv). Front : `new Blob([res.data], {type:'text/csv'})` →
`URL.createObjectURL` → `<a download="commissions-YYYY-MM-DD.csv">.click()` →
`revokeObjectURL` (pattern identique à Leads.tsx export batch). Discrimination via
`res.data` présent / `res.error`, jamais `code`.

### Écarts CODE > brief (props UI réelles observées, non devinées)
- `<FilterChip>` n'a PAS de prop `active` booléenne → utilise `variant`
  ('active'|'available') (vérifié FilterChip.tsx). Câblé `commFilter===f.key ?
  'active' : 'available'`.
- `<Switch>` props réelles : `checked`/`onCheckedChange`/`variant`('brand'|
  'success'|'danger')/`label` — pas de variante 'inactive', statut affilié géré
  via `c ? 'active' : 'inactive'` dans le handler.
- `<Tabs>` = Radix (`value`/`onValueChange`, `TabsList`/`TabsTrigger`/`TabsContent`)
  — calqué pattern existant, pas de tabs maison.
- Statut affilié n'a pas de clé i18n dédiée `active/inactive` → réutilise
  `affiliate.commission.status.{approved,rejected}` comme libellé proche (choix
  pragmatique sans création de clé ; alternative documentée pour Phase A future).

### Check DISJONCTION (ZÉRO modification hors périmètre C)
- `src/worker/affiliates.ts` + tout `src/worker/*` : INTOUCHÉS (Manager-B).
- `src/worker.ts`, `src/lib/api.ts`, `src/lib/i18n/*`, `src/lib/types.ts`,
  migration, manifest, `src/App.tsx` : INTOUCHÉS (gelés Phase A).
- 6 pages R (Dashboard/LeadDetail/Pipeline/Tasks/Leads/Inbox) : INTOUCHÉES.
- Types `Affiliate`/`AffiliateProgram`/`AffiliateCommission` importés depuis
  `@/lib/api` tels quels (figés Phase A).

> **Build délégué Antigravity** (VMware sans bun/node — pas de claim build OK).
