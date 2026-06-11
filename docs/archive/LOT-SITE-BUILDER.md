# LOT SITE BUILDER — site multi-pages réutilisant le moteur funnel (Sprint 10 : conteneur multi-pages adressables + navigation/menu + routing public `/site/:slug/:page`, RÉUTILISANT le moteur de blocs funnel COMPLET)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-SOCIAL-PLANNER.md` /
> `docs/LOT-FUNNEL.md`. **Phase B/C ne lisent QUE ce document** (+ le CODE des
> fichiers RÉUTILISÉS, jamais le brief). **DERNIER sprint du LOT 1.**

Sprint resserré, **100% ADDITIF**. Le moteur de blocs funnel est **COMPLET et à
RÉUTILISER (NE PAS reconstruire)**. Le GAP comblé = un **conteneur multi-pages
adressables + navigation/menu + routing public `/site/:slug/:page`**.

Rails RÉUTILISÉS (par IMPORT/LECTURE — **JAMAIS modifiés**) :
- `src/worker/funnel-blocks.ts` : 8 `BlockType`, `compileBlocksToHtml`,
  `createDefaultBlock`, `BLOCK_PALETTE`, type `FunnelBlock`. **Le moteur de blocs.**
- `src/worker/funnels.ts` : pattern CRUD / publish / public + `capGuard`
  (`requireCapability(auth.capabilities, 'workflows.manage')`) + `slugify` +
  `loadFunnelInTenant` (bornage tenant) + `handlePublicFunnelSubmit` (capture→CRM).
- `src/pages/FunnelBuilder.tsx` : éditeur dnd (dnd-kit) des blocs.
- `src/pages/PublicFunnel.tsx` : rendu public hydraté (modèle de PublicSite).
- `src/worker/route-meta-ssr.ts:maybeServeFunnelSsr` : snapshot crawler SEO.
- Capture→CRM via `src/worker/forms.ts` (pipeline `applyLeadMapping` /
  `resolveDedup` / `mergeIntoLead` / `logIngestConsent` / INSERT leads /
  `autoEnrollForTrigger('form_submitted')`).

**Objectif :** sites multi-pages adressables + barre de navigation + routing
public `/site/:slug` (accueil) et `/site/:slug/:page` (page interne), RÉUTILISANT
le moteur de blocs (chaque page = `FunnelBlock[]`).

Architecture figée (NE PAS réinventer) :
- Migration seq **111** = STRICTEMENT ADDITIVE : 3 tables neuves (`sites`,
  `site_pages`, `site_publications`) en `CREATE TABLE IF NOT EXISTS` + 3 index de
  lecture (`idx_site_pages_site`, `idx_site_publications_slug`, `idx_sites_client`).
  **AUCUN ALTER sur `funnels`** (tables NEUVES). Le **seul CHECK** est
  `sites.status IN ('draft','published','archived')` (table NEUVE ⇒ pas de
  rebuild, calque EXACT `funnels.status` seq 83). **JAMAIS** de modification d'un
  CHECK existant. Zéro FK/DROP/RENAME/rebuild. `custom_domain` POSÉ mais INACTIF.
- **CHECK / tables existants INTOUCHABLES.** Liens `site_id`/`client_id`/
  `agency_id` **APPLICATIFS** (zéro FK), colonne TEXT.
- Routes PRO = capability **EXISTANTE** réutilisée (`workflows.manage`, calque
  funnels). **ZÉRO ajout à `ALL_CAPABILITIES`.**
- **Domaine custom = FLAG INACTIF** : colonnes `custom_domain` posées, **jamais
  lues v1** (calque funnels `custom_domain` seq 83 + `custom_hostnames` seq 94 flag
  `WHITELABEL_PROVISIONING_ENABLED`). E4/E6 INACTIFS.
- NE PAS modifier `funnel-blocks.ts` / `funnels.ts` / `FunnelBuilder.tsx` /
  `route-meta-ssr.ts` — RÉUTILISÉS par import/lecture. Compiler une nav → fichier
  NEUF `src/worker/site-nav.ts` (esc/safeUrl réimplémentés localement, on n'édite
  PAS le gelé). SSR site → fichier NEUF `src/worker/site-ssr.ts` (calque
  `maybeServeFunnelSsr`).
- Alias : imports worker **RELATIFS** (`./worker/...`, `../lib/...`), JAMAIS `@/`.
  Front `@/`.

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **GELÉS**.
- Succès = **`json({ data })`** ; erreur = **`json({ error }, status)`**.
  **JAMAIS de champ `code`** — discrimination front string-match sur `error` /
  absence de `data`.
- Helpers PRO via `apiFetch` (token admin + capability worker) ; helpers PUBLICS
  via `fetch` brut (calque `getPublicFunnel` — pas d'auth).

Helpers ADDITIFS posés Phase A dans `src/lib/api.ts` — **FIGÉS**, signatures
EXACTES (Phase C les CONSOMME tels quels, Phase B câble les corps des routes) :

```ts
// PRO (apiFetch)
getSites(): ApiResponse<Site[]>
createSite(payload: Partial<Site> & { pages? }): ApiResponse<{ id: string }>
getSite(id): ApiResponse<Site>
updateSite(id, payload: Partial<Site>): ApiResponse<{ success: boolean }>
deleteSite(id): ApiResponse<{ success: boolean }>
getSitePages(siteId): ApiResponse<SitePage[]>
createSitePage(siteId, payload: Partial<SitePage>): ApiResponse<{ id: string }>
saveSitePage(siteId, pageId, { blocks, title?, slug?, settings_json?, seo_*, position?, is_home?, in_nav? }): ApiResponse<{ success: boolean }>
deleteSitePage(siteId, pageId): ApiResponse<{ success: boolean }>
publishSite(id, data?: { slug? }): ApiResponse<{ slug: string; url: string }>
// PUBLIC (fetch brut)
getPublicSite(slug): ApiResponse<{ site: Site; pages: SitePage[]; nav: SiteNavItem[] }>
getPublicSitePage(slug, pageSlug): ApiResponse<{ site: Site; page: SitePage; nav: SiteNavItem[] }>
```

### §6.B — Types (`src/lib/api.ts`, FIGÉS Phase A)

- **`SiteNavItem`** = `{ label: string; page_slug?: string | null; url?: string | null }`
  (lien interne `page_slug` prioritaire sur lien externe `url`).
- **`SitePage`** = `{ id, site_id, slug, title?, blocks: FunnelBlock[],
  settings_json?, seo_title?, seo_description?, seo_image?, position, is_home,
  in_nav, created_at?, updated_at? }`. **`blocks` RÉUTILISE le type `FunnelBlock`
  existant** (`src/lib/api.ts` / `funnel-blocks.ts`) — NE PAS redéfinir les blocs.
- **`Site`** = `{ id, client_id?, agency_id?, name, description?, status
  ('draft'|'published'|'archived'), theme_json?, nav_json? (SiteNavItem[]
  sérialisé), custom_domain? (INACTIF), total_views, pages?, publication?,
  created_at?, updated_at? }`.

### §6.C — Moteur de blocs RÉUTILISÉ (CRUCIAL Manager-B + Manager-C — signatures EXACTES vérifiées dans le CODE)

`src/worker/funnel-blocks.ts` est **GELÉ et RÉUTILISÉ** (import/lecture). Phase B/C
consomment ces SIGNATURES EXACTES, ne réimplémentent PAS le moteur :

```ts
export type BlockType = 'hero' | 'text' | 'image' | 'video' | 'form' | 'button' | 'cta' | 'spacer';
export interface FunnelBlock { id: string; type: BlockType; config: Record<string, unknown>; }
export function compileBlocksToHtml(blocks: FunnelBlock[], opts?: { slug?: string; title?: string }): string;
export function createDefaultBlock(type: BlockType): FunnelBlock;
export const BLOCK_PALETTE: Array<{ type: BlockType; labelKey: string; icon: string }>;
```

- `compileBlocksToHtml` renvoie un **document HTML complet** (`<!DOCTYPE html>…`,
  CSS inline, classes `fb-*`). Tout contenu utilisateur est ÉCHAPPÉ (esc/safeUrl
  privés). Le bloc `form` poste vers `POST /api/p/:slug/submit` (data-attrs
  `data-fb-form`/`data-fb-success`/`data-fb-redirect`) — **Manager-B Site Builder
  doit adapter la cible** (cf. §6.F.submit) ou réutiliser le pipeline forms.ts.
- `createDefaultBlock(type)` renvoie un `FunnelBlock` valide (`id` =
  `crypto.randomUUID()` + `config` par défaut typée conforme aux `*BlockConfig`).

### §6.D — Pattern publish/slug RÉUTILISÉ (CRUCIAL Manager-B — calque funnels.ts)

`src/worker/funnels.ts` est **GELÉ et RÉUTILISÉ comme MODÈLE** (calque, pas import
des handlers funnels) :

1. **`capGuard`** (funnels.ts:47) = `requireCapability(auth.capabilities,
   'workflows.manage')`. `import { requireCapability } from './capabilities'` ;
   `import type { CapAuth }`. **RÉUTILISE 'workflows.manage'**, AUCUN ajout à
   ALL_CAPABILITIES. (Stub `sites.ts` câble déjà ce `capGuard`.)
2. **Bornage tenant** = calque `loadFunnelInTenant` (funnels.ts:59) :
   legacy/mono-tenant (`!tenant || agencyId == null`) → pas de garde ; mode agence
   → `client_id ∈ accessibleClientIds OU agency_id === auth.tenant.agencyId`, sinon
   `json({ error:'Site introuvable' }, 404)`. (Stub `sites.ts:loadSiteInTenant` déjà
   posé.)
3. **`slugify`** = calque funnels.ts:94 (NFD + `[^a-z0-9]+`→`-`, slice 60, fallback
   `'site'`). (Déjà posé dans `sites.ts`.)
4. **`handlePublishSite`** = calque EXACT `handlePublishFunnel` (funnels.ts:541) :
   - slug souhaité (`body.slug`) ou dérivé de `site.name` → `slugify`.
   - Unicité **APPLICATIVE** : collision = `SELECT 1 FROM site_publications WHERE
     slug=? AND site_id<>? LIMIT 1`. Si `body.slug` explicite ET pris → **`json({
     error:'Cette adresse est déjà utilisée' }, 409)`** ; sinon régénère un slug
     libre (suffixe court `-xxxx`, ≤5 essais). **PAS de UNIQUE SQL.**
   - Upsert `site_publications` (1 ligne active/site, `is_active=1`) ; `client_id`/
     `agency_id` depuis la row site (fallback auth). `UPDATE sites SET
     status='published'`. Retour `json({ data: { slug, url: '/site/' + slug } })`.
5. **best-effort** : table seq 111 absente / panne D1 → réponse propre (404 /
   `{data:[]}`), **JAMAIS de 500/throw**.

### §6.E — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

**PUBLIQUES** (no-auth, AVANT `requireAuth` — calque `/api/p/:slug`). ⚠ **`/:slug/:page`
AVANT `/:slug`** (anti-shadowing) :

| Route | Méthode | Handler (`./worker/sites`) |
|---|---|---|
| `/api/site/:slug/:page` | GET | `handlePublicSitePageGet(env, url)` |
| `/api/site/:slug` | GET | `handlePublicSiteGet(env, url)` |

**PROTÉGÉES** `/api/sites/*` (capability `workflows.manage` appliquée DANS les
handlers via `capGuard`). Sous-routes SPÉCIFIQUES (`/pages`, `/pages/:pageId`,
`/publish`) AVANT `/:id` générique :

| Route | Méthode | Handler |
|---|---|---|
| `/api/sites` | GET | `handleGetSites(env, auth, url)` |
| `/api/sites` | POST | `handleCreateSite(request, env, auth)` |
| `/api/sites/:id/pages` | GET | `handleGetSitePages(env, auth, id)` |
| `/api/sites/:id/pages` | POST | `handleCreateSitePage(request, env, auth, id)` |
| `/api/sites/:id/pages/:pageId` | PUT | `handleSaveSitePage(request, env, auth, id, pageId)` |
| `/api/sites/:id/pages/:pageId` | DELETE | `handleDeleteSitePage(env, auth, id, pageId)` |
| `/api/sites/:id/publish` | POST | `handlePublishSite(request, env, auth, id)` |
| `/api/sites/:id` | GET | `handleGetSite(env, auth, id)` |
| `/api/sites/:id` | PUT | `handleUpdateSite(request, env, auth, id)` |
| `/api/sites/:id` | DELETE | `handleDeleteSite(env, auth, id)` |

**SSR** (`fetch()`, après `maybeServeFunnelSsr`) : `import('./worker/site-ssr')` →
`maybeServeSiteSsr(request, env, url)` (best-effort, null ⇒ traverse au SPA).

**Domaine custom INACTIF** : `sites.custom_domain` / `site_publications.custom_domain`
posés mais **jamais lus v1**. Aucun routing par hostname custom ce sprint.

### §6.F — Handlers (NEUFS — owned Manager-B)

Stubs Phase A (signatures FIGÉES, corps réels Manager-B) :
- **`src/worker/sites.ts`** : CRUD sites (`handleGetSites`/`handleCreateSite`/
  `handleGetSite`/`handleUpdateSite`/`handleDeleteSite`) + pages
  (`handleGetSitePages`/`handleCreateSitePage`/`handleSaveSitePage`/
  `handleDeleteSitePage`) + `handlePublishSite` (slug unicité applicative calque
  §6.D) + **`handlePublicSiteGet`** (accueil : résout `site_publications`(slug,
  is_active=1) → site + nav + page `is_home=1`, compile blocks via
  `compileBlocksToHtml` **IMPORTÉ de funnel-blocks** + nav via `compileNavToHtml`)
  + **`handlePublicSitePageGet`** (page interne par `site_pages.slug`, même
  compilation). `capGuard` = `requireCapability(auth.capabilities,
  'workflows.manage')` ; `client_id`/`agency_id` résolus depuis l'auth/row (JAMAIS
  body) ; re-bornage strict sur update/delete/save/publish.
  - **submit form de page** : RÉUTILISE le pipeline `forms.ts` (calque
    `funnels.ts:handlePublicFunnelSubmit` — `applyLeadMapping`/`resolveDedup`/
    `mergeIntoLead`/`logIngestConsent`/INSERT leads/`autoEnrollForTrigger`),
    `source='site'`, `client_id` résolu depuis `site_publications`. Zéro dup dedup.
- **`src/worker/site-nav.ts`** : `compileNavToHtml(navItems: SiteNavItem[], opts?:
  { siteSlug?; activeSlug? }): string` — rendu `<nav>` XSS-safe. `esc`/`safeUrl`
  **réimplémentés localement** (calque EXACT funnel-blocks.ts — n'importe PAS le
  gelé). Lien interne = `/site/:siteSlug/:page_slug`.
- **`src/worker/site-ssr.ts`** : `maybeServeSiteSsr(request, env, url): Promise<
  Response | null>` — calque EXACT `maybeServeFunnelSsr` : garde crawler + match
  `/site/:slug[/:page]` → lit `site_pages.seo_*` (page `is_home=1` ou ciblée) →
  snapshot méta/OG. best-effort, NE THROW JAMAIS.

### §6.G — Pages (NEUVES — owned Manager-C)

Routes `src/App.tsx` (FIGÉ Phase A) :
- **PROTÉGÉES** (sous `LazyGuard`, calque `funnelsRoute`/`funnelBuilderRoute`) :
  `/sites` → `SitesPage` ; `/sites/$siteId` → `SiteBuilderPage`.
- **PUBLIQUES** (hors LazyGuard/auth, `Suspense`+`PageLoader`, calque EXACT
  `publicFunnelRoute`) : `/site/$slug` → `PublicSitePage` ; `/site/$slug/$page` →
  `PublicSitePage`. Exports nommés FIGÉS (`SitesPage`/`SiteBuilderPage`/
  `PublicSitePage`).

Fichiers (NEUFS) :
- **`src/pages/Sites.tsx`** (export `SitesPage`) : liste/CRUD sites.
- **`src/pages/SiteBuilder.tsx`** (export `SiteBuilderPage`) : éditeur multi-pages
  (sélecteur de page + dnd des blocs RÉUTILISANT `BLOCK_PALETTE`/`createDefaultBlock`/
  `compileBlocksToHtml` importés de `@/worker/funnel-blocks`) + gestion de la
  navigation (`nav_json` = `SiteNavItem[]`). ⚠ **`SortableBlock`/`BlockProperties`
  de FunnelBuilder.tsx NE SONT PAS exportés** (seul `FunnelBuilderPage` l'est) ⇒
  **CALQUER** ces composants (copier le pattern dnd-kit), PAS importer.
- **`src/pages/PublicSite.tsx`** (export `PublicSitePage`) : calque
  `PublicFunnel.tsx` ; lit `slug` (+ `page` optionnel) des params de route ;
  appelle `getPublicSite`/`getPublicSitePage` ; rend la barre nav + le HTML compilé
  serveur (hydratation, interception du submit form). 404 → `t('site.public.not_found')`.
- **`src/pages/site-templates.ts`** (NEUF) : templates de site multi-pages (calque
  `funnel-templates.ts` — `{ name, industry, pages: [{ slug, title, is_home,
  in_nav, blocks: FunnelBlock[] }], nav: SiteNavItem[] }`). Importe `type
  FunnelBlock` / `SiteNavItem` / `SitePage` depuis `@/lib/api`.

i18n 100% `t('site.*')` (clés FIGÉES Phase A — **AUCUNE création Phase C**, parité
stricte ×4, 27 clés posées).

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned :
  - **`src/worker/sites.ts`** — CRUD réels + `handlePublishSite` (slug unicité
    applicative calque `funnels.ts` §6.D) + `handlePublicSiteGet` /
    `handlePublicSitePageGet` (charge site+pages, compile blocks via
    `compileBlocksToHtml` **IMPORTÉ** de funnel-blocks + nav via `compileNavToHtml` ;
    submit form de page RÉUTILISE le pipeline forms.ts, `source='site'`).
  - **`src/worker/site-nav.ts`** — `compileNavToHtml` réel (`<nav>` XSS-safe).
  - **`src/worker/site-ssr.ts`** — `maybeServeSiteSsr` réel (calque
    `maybeServeFunnelSsr` lisant `site_pages.seo_*`).
  - Tests `__tests__/`.
- **Manager-C (frontend)** owned :
  - **`src/pages/Sites.tsx`** (export `SitesPage`) — liste/CRUD sites.
  - **`src/pages/SiteBuilder.tsx`** (export `SiteBuilderPage`) — éditeur
    multi-pages + gestion nav, RÉUTILISE les blocs/dnd (CALQUE FunnelBuilder car
    `SortableBlock`/`BlockProperties` NON exportés ; `BLOCK_PALETTE`/
    `createDefaultBlock`/`compileBlocksToHtml` importables).
  - **`src/pages/PublicSite.tsx`** (export `PublicSitePage`) — calque
    `PublicFunnel.tsx`, rend page par slug + barre nav.
  - **`src/pages/site-templates.ts`** — templates site multi-pages (calque
    `funnel-templates.ts`).
- **INTERDITS aux deux** : migration, manifest, `src/lib/api.ts` (+ types),
  `src/worker.ts`, `src/App.tsx`, i18n×4, `index.css`, **`funnel-blocks.ts` /
  `funnels.ts` / `FunnelBuilder.tsx` / `route-meta-ssr.ts`** (RÉUTILISÉS par
  import/lecture, **JAMAIS modifiés**). `sites.ts` / `site-nav.ts` / `site-ssr.ts`
  = **Manager-B** ; `Sites.tsx` / `SiteBuilder.tsx` / `PublicSite.tsx` /
  `site-templates.ts` = **Manager-C**. **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **CHECK / tables existants INTOUCHABLES** — seul CHECK NEUF =
   `sites.status` (calque funnels seq 83). N'ajoute AUCUN autre CHECK, AUCUN ALTER
   sur `funnels`/`funnel_pages`. AUCUN rebuild.
2. **Manifest seq 111 OBLIGATOIRE** — `depends_on:["migration-social-seq110.sql"]`.
   Tables neuves en `CREATE TABLE IF NOT EXISTS` (idempotent — PAS d'ADD COLUMN).
3. **FK INTERDITES** (rebuild SQLite) — `site_id`/`client_id`/`agency_id` restent
   APPLICATIFS (bornés serveur), colonne TEXT.
4. **RÉUTILISER, pas reconstruire le moteur de blocs** — `compileBlocksToHtml` /
   `createDefaultBlock` / `FunnelBlock` / `BLOCK_PALETTE` IMPORTÉS de
   `funnel-blocks.ts` (worker) / `@/worker/funnel-blocks` (front). Une page de site
   = `FunnelBlock[]`, format IDENTIQUE à `funnel_pages.blocks`.
5. **Page publique calque `PublicFunnel.tsx`** — rendu hydraté, interception du
   submit form, barre nav en plus.
6. **Domaine custom = FLAG INACTIF** — `custom_domain` posé, **jamais lu v1**
   (calque funnels seq 83 + custom_hostnames seq 94). E4/E6 INACTIFS.
7. **SEO calque `maybeServeFunnelSsr`** — `site-ssr.ts` lit `site_pages.seo_*`
   (page `is_home=1` ou ciblée par `:page`), snapshot méta/OG-only, best-effort.
8. **`/:slug/:page` AVANT `/:slug`** — anti-shadowing (worker `/api/site/*`).
9. **Alias relatifs worker** (`./...`, `../lib/...`), front `@/`.
10. **`SortableBlock`/`BlockProperties` NON exportés** de FunnelBuilder.tsx ⇒
    Manager-C **CALQUE** (copie le pattern dnd-kit), n'importe PAS ces composants.
    Seul `FunnelBuilderPage` est exporté.
11. **Capability EXISTANTE réutilisée** — `workflows.manage` (calque funnels
    capGuard). **ZÉRO ajout à `ALL_CAPABILITIES`.**
12. **Slug unicité APPLICATIVE** — calque `handlePublishFunnel` : 409 si slug
    explicite pris, sinon suffixe court. PAS de UNIQUE SQL. Slug de page unique
    PAR site (handler).
