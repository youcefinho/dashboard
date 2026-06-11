# LOT G7 — Marketplace de templates partageables

Squelette transverse posé par **Phase A SOLO**. Corps réels Phase B (handlers
`marketplace.ts`) + Phase C (page `Marketplace.tsx` réelle). seq migration = **96**.

## §0 — audit (READ-ONLY)

- `packs.ts` : `handleInstallPack` (admin-only) parse `industry_packs.snapshot_json`
  et clone `custom_fields` / `email_templates` / `workflows(+steps)` / `smart_lists`
  chez un `client_id`. Installeur **top-down**, PAS marketplace cross-tenant.
  **Réutilisé EN LECTURE comme calque de clone, JAMAIS modifié.**
- Marketplace **ABSENT** avant ce lot (zéro table/route/page/i18n `marketplace.*`). Greenfield.
- Briques exportables (READ-ONLY) :
  - **Funnel** — `funnels.ts:756 handlePublicFunnelGet` expose DÉJÀ
    `{funnel, steps[{page:{blocks}}]}` SANS `agency_id`/`client_id` (= strip PROUVÉ).
    Import via `handleCreateFunnel` + `handleSaveFunnelPage`.
  - **Workflow** — `handleCreateWorkflow` accepte `{name, trigger_type, steps[{step_order, step_type, config}]}`.
  - **Séquence** — `handleCreateSequence` délègue à `handleCreateWorkflow` (`is_sequence=1`).
- Capability **`workflows.manage`** (déjà dans `ALL_CAPABILITIES`). Choke-point auth
  worker.ts (`authCtx` enrichi `capabilities`). `requireCapability(caps, cap)`.
- Manifest dernière migration = **95** (OAuth G4). **seq 96 libre.**

## §6.A — archi (tranché)

- **3 tables** :
  - `marketplace_listings(id, publisher_client_id, publisher_agency_id, kind,
    title, description, category, content_json, status 'draft'|'published',
    install_count INTEGER DEFAULT 0, rating_avg REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0, price_cents INTEGER DEFAULT 0 [INACTIF v2],
    created_at, updated_at)`
  - `marketplace_reviews(id, listing_id, reviewer_client_id, rating, comment, created_at)`
    — unicité **1/tenant/listing APPLICATIVE** (pas de UNIQUE SQL).
  - `marketplace_installs(id, listing_id, installer_client_id, installed_kind, installed_id, created_at)`
- **template = UNE entité typée** `kind ∈ {'funnel','workflow','sequence'}` (PAS de bundle — v2).
- Snapshot **FIGÉ au publish** (copie morte). Install = **CLONE** chez `installer_client_id`
  via la create-logic existante (zéro réécriture moteur).
- Listing GET **public** cross-tenant ; install/review **bornés** (`installer_client_id`
  depuis l'auth, JAMAIS le body).
- **Monétisation HORS v1** : `price_cents` INACTIF (jamais lu pour un paiement, zéro Stripe/E4).
- Capability `workflows.manage` (publish/install/review). GET public = pré-`requireAuth`.
  **ZÉRO ajout à `ALL_CAPABILITIES`.**

### ⚠ FLAG #1 — CROSS-TENANT CRITIQUE (Phase B Manager-B)

`content_json` est exposé **PUBLIQUEMENT** (tout tenant lit le détail d'un listing
publié). Il ne doit contenir **QUE la STRUCTURE** : blocs funnel, étapes workflow
(`step_type`+`config` template), libellés. **JAMAIS** : `client_id`/`agency_id`,
lead/email/enrollment réel, id interne réutilisable. **Strip allowlist au publish** :

- **Funnel** → calque EXACTEMENT `funnels.ts:756 handlePublicFunnelGet` (prouve le strip :
  `{name, description, industry, steps[{name, step_type, position, page:{title, blocks, seo}}]}`).
  Re-générer les ids à l'install.
- **Workflow/séquence** → sérialiser QUE `{name, trigger_type, trigger_config,
  steps[{step_order, step_type, config}]}`. Inspecter `config` des steps email/sms :
  garder QUE `subject`/`body` TEMPLATE (placeholders `{{}}`), JAMAIS adresse/lead réel.
  `trigger_config` neutralisé (pas d'ids de listes tenant).

Fonction `stripContentForPublish(kind, sourceData)` dédiée **au publish** ; l'install
consomme le JSON déjà nettoyé.

## §6.B — migration seq 96

`migration-marketplace-seq96.sql`, `depends_on: migration-oauth-connections-seq95.sql`.
3 `CREATE TABLE IF NOT EXISTS` (id `lower(hex(randomblob(16)))`, `*_client_id`/`*_agency_id`
NULLABLE) + 3 index (`idx_marketplace_listings_status(status, created_at)`,
`idx_marketplace_reviews_listing(listing_id)`, `idx_marketplace_installs_listing(listing_id)`).
Zéro FK / CHECK / ALTER. Timestamps `datetime('now')`. Manifest seq 96 risk `low`.

## §6.C — routes worker.ts

- **PUBLIC** (avant `requireAuth`) :
  - `GET /api/marketplace/listings` (liste publiés cross-tenant, sans `content_json` lourd)
  - `GET /api/marketplace/listings/:id` (détail public : `content_json` STRIPPÉ + reviews)
- **PROTÉGÉ** (`routeProtected`, capGuard `workflows.manage`, sous-routes spécifiques AVANT génériques) :
  - `POST /api/marketplace/listings` (publier ; build snapshot strippé depuis `kind`+`source_id`)
  - `POST /api/marketplace/listings/:id/install` (clone chez `auth.tenant.clientId`)
  - `POST /api/marketplace/listings/:id/reviews` (review, unicité applicative)
  - `GET  /api/marketplace/my-listings` (mes publications)

Anti-shadowing : `/my-listings`, `/install`, `/reviews` enregistrés AVANT le `/:id`
générique. Le `GET /:id` public est dans le bloc pré-auth (pas de collision avec le protégé).

## §6.D — api.ts

`getMarketplaceListings()`, `getMarketplaceListing(id)`,
`publishToMarketplace({kind, source_id, title, description, category})`,
`installMarketplaceListing(id)`, `reviewMarketplaceListing(id, {rating, comment})`,
`getMyMarketplaceListings()`. Types `MarketplaceListing` / `MarketplaceReview` /
`MarketplaceKind`. **`ApiResponse` INCHANGÉ.**

## §6.E — i18n `marketplace.*` ×4

14 clés (parité EN / fr-CA / fr-FR / es) : `nav`, `title`, `subtitle`, `empty`,
`publish`, `install`, `installed`, `free`, `reviews`, `category.{funnel,workflow,sequence}`,
`status.{draft,published}`. Namespace neuf, zéro collision.

## §6.F — pages

`Marketplace.tsx` (lazy `MarketplacePage`, calque structurel `FunnelsPage`). Route
`/marketplace` (LazyGuard, calque `funnelsRoute`) — zéro collision (vérifiée).
Phase A = stub fonctionnel (liste publique) ; Phase C Manager-C = page réelle
(Listing public / Détail / Publier / Mes publications).

## §6.G — découpage

- **Phase A SOLO (FAIT)** : migration seq 96 + manifest + stubs `marketplace.ts`
  (handlers signatures figées + `stripContentForPublish` signature + capGuard, corps
  placeholder) + routes worker.ts (public + protégé) + api.ts helpers + types + i18n ×4
  + stub `Marketplace.tsx` + route App.tsx + ce doc.
- **Phase B Manager-B** : corps `marketplace.ts` (strip allowlist FLAG #1, install
  clone via create-logic existante, reviews unicité + agrégat rating).
- **Phase C Manager-C** : `Marketplace.tsx` réel (4 vues).

## §6.I — garde-fous

Monétisation hors v1 (`price_cents` inactif) · FLAG #1 `content_json` STRUCTURE seule
(strip allowlist, zéro donnée tenant) · install clone via create-logic existante
(`installer_client_id` depuis auth jamais body) · E4-E6/CHECK59 jamais · zéro ajout
`ALL_CAPABILITIES` · `ApiResponse` inchangé · zéro FK · `datetime('now')` ·
`packs.ts`/`funnels.ts`/`sequences.ts`/`workflows.ts` READ-ONLY · git jamais.

## IMPLEMENTATION-LOG — Phase B Manager-B (corps réels `marketplace.ts`)

**Fichier écrit (EXCLUSIF)** : `src/worker/marketplace.ts` — corps réels des 6 handlers
+ `stripContentForPublish` + 2 helpers privés (`stripWorkflowStepConfig`,
`loadSourceForPublish`, `synthRequest`, `tenantClientId`). Signatures Phase A FIGÉES,
zéro changement de contrat worker.ts.

### FLAG #1 — strip allowlist (choke-point cross-tenant) ✅
`stripContentForPublish(kind, sourceData)` construit l'objet CHAMP PAR CHAMP
(allowlist, JAMAIS de spread d'objet brut) :
- **funnel** → `{name, description, industry, steps[{name, step_type, position,
  page:{title, blocks, seo_title, seo_description, seo_image}}]}` — calque EXACT de
  `funnels.ts:756 handlePublicFunnelGet`. AUCUN `id`/`funnel_id`/`step_id`/`client_id`/
  `agency_id` (re-générés à l'install par `handleCreateFunnel`/`handleSaveFunnelPage`).
- **workflow|sequence** → `{name, trigger_type, trigger_config:{}, steps[{step_order,
  step_type, config}]}`. `trigger_config` NEUTRALISÉ en `{}` (purge ids listes/tags/
  quiet_hours tenant). Chaque `config` de step passe par `stripWorkflowStepConfig` :
  GARDE QUE `subject`/`body`/`message` (templates `{{}}`), `delay_minutes`/`wait_type`/
  `wait_time`, `field`/`operator`/`value`, `tag`/`status`/`title`/`description`/
  `priority`. SUPPRIME EXPLICITEMENT `template_id`, `to_email`, `url`, `workflow_id`,
  `field_id`, `assigned_to`, `stage_id`, `pipeline_id`, `deal_value`, tout id
  réutilisable référençant la base du tenant.

### Install clone via create-logic EXISTANTE ✅
ZÉRO réécriture de moteur. `handleInstallMarketplaceListing` construit un `Request`
synthétique (`synthRequest`, body = content_json strippé) et DÉLÈGUE :
- funnel → `handleCreateFunnel` (+ `handleSaveFunnelPage` par étape, stepIds neufs
  relus depuis `funnel_steps`).
- workflow → `handleCreateWorkflow`.
- sequence → `handleCreateSequence`.
funnels/workflows/sequences importés en LECTURE, NON modifiés.

### Bornage strict ✅
- `publisher_client_id`/`publisher_agency_id` (publish), `installer_client_id`
  (install), `reviewer_client_id` (review) ⟵ TOUJOURS `tenantClientId(auth)` /
  `auth.tenant.agencyId`, JAMAIS le body.
- Publish : `loadSourceForPublish` vérifie l'APPARTENANCE de `source_id` au tenant
  (legacy/mono-tenant ⇒ pas de garde nouvelle ; mode agence ⇒ `client_id ∈
  accessibleClientIds` OU `agency_id == tenant`), sinon 404. Le `kind` demandé doit
  correspondre au flag `is_sequence` (workflow ≠ sequence).
- Install : `client_id` forcé au tenant courant dans le body synthétique workflow/
  sequence (jamais une valeur d'un autre tenant).

### Autres invariants ✅
- `price_cents` JAMAIS lu (zéro paiement, zéro E4/E6).
- GET listings/listing PUBLICS sans `publisher_*_id` ni `content_json` lourd (liste) ;
  détail expose `content_json` STRIPPÉ (déjà nettoyé au publish) sous `content`.
- Reviews : unicité 1/tenant/listing APPLICATIVE (UPDATE l'existante via `IS ?` qui
  gère le NULL legacy) + recalcul agrégats `rating_avg`/`rating_count`.
- `capGuard('workflows.manage')` sur les 4 handlers protégés (aucun ajout
  ALL_CAPABILITIES). best-effort partout (table seq 96 absente ⇒ `{data:[]}`/404, jamais
  de 500/throw).
- `Marketplace.tsx` (Manager-C) NON touché. Réponses `{data}`/`{error}` (jamais `code`).

### Écarts vs spec
- Noms de handlers réels = `handlePublishMarketplaceListing` (≠ `…ToMarketplace` du
  brief) et ordre params réel = `handleGetMarketplaceListings(env, url)` /
  `handleGetMarketplaceListing(env, id)` : on respecte les signatures FIGÉES Phase A
  (worker.ts y est déjà câblé) plutôt que la formulation du brief.
- `description` d'install workflow/sequence remise à `''` (la description n'est pas
  conservée au strip pour workflow ; cohérent avec l'allowlist).

## IMPLEMENTATION-LOG — Phase B Manager-C (front exclusif `Marketplace.tsx`)

> La spec §6.G nomme cette phase « Phase C ». Brief Manager-C ⇒ « Phase B
> Manager-C ». Même livrable : la page `Marketplace.tsx` réelle (4 vues).

### Fichiers écrits (périmètre exclusif)
1. `src/pages/Marketplace.tsx` — corps réel (remplace le stub Phase A).
2. `src/index.css` — bloc `/* === LOT G7 Marketplace === */ … /* === Fin LOT G7 === */`
   en fin de fichier (après `/* === Fin LOT G4 === */`). Append-only, 9 classes neuves.
3. `docs/LOT-MARKETPLACE-G7.md` — cette section.

### Vues livrées (4) — onglets `Tabs` (calque Affiliates.tsx)
- **Catalogue** (`browse`) : grid de cards via `getMarketplaceListings()` — titre,
  badge kind (color-code info/brand/neutral), catégorie, description (clamp 2 lignes),
  Stars(`rating_avg`)+count, compteur installs, Tag « Gratuit », bouton « Voir ».
  Filtres : FilterChips kind (all/funnel/workflow/sequence) + Select catégorie
  (dérivée des listings).
- **Détail** (overlay INLINE dans l'onglet Catalogue, state `detailId` — pas de
  route /:id, routes gelées Phase A) : `getMarketplaceListing(id)` → titre, kind,
  catégorie, rating inline, description, **aperçu LISIBLE de la structure**
  (`structureSummary()` parse `content_json` défensivement, compte
  steps/blocks/pages/nodes, jamais le JSON brut), liste reviews (`listing.reviews`),
  bouton **Installer** (`installMarketplaceListing` + toast `marketplace.installed`
  + incrément local install_count + désactivation post-install), **formulaire avis**
  (Stars 1-5 interactif + Textarea → `reviewMarketplaceListing` + reload détail).
- **Publier** (`publish`) : Select kind → charge entités source du tenant
  (`getFunnels`/`getWorkflows`/`getSequences` mappées id+name) dans un 2e Select +
  titre (Input) + description (Textarea) + catégorie (Input) → `publishToMarketplace`.
  Confirm avant. Tag « Gratuit ». Succès → reset + reload + bascule onglet `mine`.
- **Mes publications** (`mine`) : `getMyMarketplaceListings()` → table premium
  (titre / kind / statut draft|published statusIcon / installs / note).

### Helpers consommés (FIGÉS — api.ts:5231-5309, signatures vérifiées)
`getMarketplaceListings` · `getMarketplaceListing(id)` ·
`publishToMarketplace({kind, source_id, title, description?, category?})` ·
`installMarketplaceListing(id)` · `reviewMarketplaceListing(id, {rating, comment?})` ·
`getMyMarketplaceListings`. Source picker : `getFunnels` (Funnel.name) /
`getWorkflows` (Workflow.name) / `getSequences` (Workflow.name) — existants, READ.

### i18n — clés Phase A câblées (AUCUNE création)
`marketplace.{nav,title,subtitle,empty,publish,install,installed,free,reviews}`,
`marketplace.category.{funnel,workflow,sequence}`,
`marketplace.status.{draft,published}`. Communes : `action.view` (fr-CA:149),
`action.save` (fr-CA:103) — vérifiées présentes. Zéro fallback inline requis.

### CSS bloc G7 (9 classes, vars existantes)
`.mk-stars` `.mk-star` `.mk-star--on` `.mk-star-btn` (notation) · `.mk-card`
(lift hover sober) · `.mk-clamp-2` · `.mk-structure` · `.mk-cat-select`. Vars
réutilisées : `--shadow-md` `--border-strong` `--primary-ring` `--warning`
`--bg-subtle` `--radius-sm/md` `--border` (toutes vérifiées présentes).

### Disjonction (zéro touch hors périmètre)
`src/worker/*` (dont `marketplace.ts` Manager-B), `worker.ts`, `api.ts`, `types.ts`,
`App.tsx`, i18n, migration : READ-ONLY. `ApiResponse` inchangé (discrimination
`res.data` / `res.error`, jamais `res.code`). Export `MarketplacePage` conservé.
6 pages R cœur intouchées.

### Écarts / notes
- `content_json` forme non figée (Manager-B parallèle) → `structureSummary()`
  défensif (try/catch + comptage collections) ⇒ dégrade en `null` (aperçu masqué) si
  forme inattendue, sans planter. Compatible avec le strip Manager-B (steps[]/blocks).
- Détail rendu inline (state `detailId` + bouton retour), pas de route dédiée.
- `installedIds` = état session (Set local) ; install_count incrémenté localement
  pour feedback immédiat, persistance réelle backend.
- Build délégué Antigravity (VM sans bun/node).
