# LOT MARKETPLACE — Sprint 19 « activation UI + recherche » (le Marketplace G7 — `marketplace.ts` 745l : publication snapshot strippé + catalogue public cross-tenant + install par clone + reviews/rating ; `Marketplace.tsx` 928l, 4 vues ; route `/marketplace` ; 14 clés `marketplace.*` ×4 — existe DÉJÀ et est COMPLET backend+frontend, mais **INVISIBLE** : aucune entrée nav. GAPS : (1) entrée Sidebar manquante ; (2) recherche texte serveur absente ; (3) filtres serveur `kind`/`category` non exploités (filtrage client) + tri non pilotable. On COMBLE les trois, **100% ADDITIF**, en RÉUTILISANT tout — PAS de reconstruction, **AUCUNE migration**.)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-CATALOG.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE des fichiers RÉUTILISÉS,
> jamais le brief).

Sprint **100% ADDITIF**, **AUCUNE migration** (le schéma seq 96 suffit : la
recherche se fait par `LIKE` sur des colonnes EXISTANTES `title`/`description`, le
tri par `ORDER BY` sur des colonnes EXISTANTES `install_count`/`created_at`/
`rating_avg`/`rating_count`). **Manifest INCHANGÉ** (dernière migration reste
seq 118 — catalogue). **PAS de fichier migration « pour la forme ».** Le
Marketplace G7 existe DÉJÀ — **à RÉUTILISER, NE PAS reconstruire** :

- `src/worker/marketplace.ts` (seq 96, 745l) — owned **Manager-B** ce lot. Pièces
  RÉUTILISÉES / ÉTENDUES :
  - **`handleGetMarketplaceListings(env, url)`** (l.295) — signature `(env, url)`
    **FIGÉE** (worker.ts y est déjà câblé, route GET publique). Gère DÉJÀ les
    filtres `?kind=` (validé via `KINDS.has`) et `?category=` (via
    `sanitizeInput(category, 80)`). `LIMIT 200`, `status='published'`, projection
    SANS `content_json` ni `publisher_*_id`, best-effort (table absente ⇒
    `{data:[]}`). **Manager-B ajoute `?q=` (LIKE) + `?sort=` (whitelisté) ICI.**
  - **`handleGetMarketplaceListing(env, id)`** (l.332) — détail public, `content_json`
    strippé sous `content` + reviews. **INTOUCHÉ ce lot.**
  - `handlePublishMarketplaceListing` / `handleInstallMarketplaceListing` /
    `handleReviewMarketplaceListing` / `handleGetMyMarketplaceListings` — protégés
    `capGuard('workflows.manage')`. **INTOUCHÉS ce lot.**
  - **`stripContentForPublish` / strip cross-tenant (FLAG #1)** — **INTOUCHÉ**.
  - **reviews / agrégat rating** — **INTOUCHÉS**.
- `src/pages/Marketplace.tsx` (928l, 4 vues) — owned **Manager-C** ce lot. Pièce
  ÉTENDUE : le **filtrage 100% CLIENT** (`useMemo` l.~424-430 : `listings.filter`
  sur `kindFilter`/`categoryFilter`) → bascule vers un appel SERVEUR
  `getMarketplaceListings({ q, kind, category, sort })`. FilterChip kind +
  Select catégorie EXISTANTS (l.~491-507) RÉUTILISÉS ; ajoute un Input recherche
  débouncé + un Select tri. **Additif — NE PAS casser les 4 vues ni l'install/review.**
- `src/components/layout/Sidebar.tsx` — owned **Manager-C** ce lot. `Store`
  **DÉJÀ importé** (l.11). `grep marketplace` sur les layouts = **0 entrée** ⇒
  GAP (1). Manager-C ajoute UNE entrée nav `/marketplace` dans le groupe Marketing.
- `src/lib/api.ts` — `MarketplaceListing`/`MarketplaceKind`/`MarketplaceReview`
  EXISTANTS ; type `MarketplaceListQuery` NEUF + helper `getMarketplaceListings`
  ÉLARGI (param OPTIONNEL) — **FIGÉS Phase A**. **READ (front).**
- `src/worker.ts` — **INTOUCHÉ.** La route `GET /api/marketplace/listings` existe
  DÉJÀ ; Manager-B lit juste de NOUVEAUX `url.searchParams` dans le handler.

**GAP comblé :**
- **(1)** Marketplace invisible (zéro nav) → entrée Sidebar `/marketplace`
  (Manager-C), label `t('marketplace.nav')` (existante), icône `Store` (déjà
  importée), groupe Marketing, **PAS de `moduleRequired`** (G7 non gated).
- **(2)** recherche texte serveur absente → `?q=` LIKE sur `title`/`description`
  (Manager-B) + Input recherche débouncé (Manager-C).
- **(3)** filtres serveur `kind`/`category` non exploités + tri figé → appel
  serveur `getMarketplaceListings({q,kind,category,sort})` (Manager-C) + `?sort=`
  whitelisté `popular|recent|rating` (Manager-B).

Alias : imports worker **RELATIFS** (`./...`), JAMAIS `@/`. Front `@/`.

---

## §0 — AUDIT DISQUE (le code fait foi — à RÉUTILISER)

### `src/worker/marketplace.ts` — `handleGetMarketplaceListings(env, url)` (l.295, signature FIGÉE, ÉTENDUE par Manager-B)

```ts
export async function handleGetMarketplaceListings(env: Env, url: URL): Promise<Response> {
  try {
    const conds: string[] = ["status = 'published'"];
    const binds: unknown[] = [];
    const kind = url.searchParams.get('kind');
    if (kind && KINDS.has(kind)) { conds.push('kind = ?'); binds.push(kind); }
    const category = url.searchParams.get('category');
    if (category) { conds.push('category = ?'); binds.push(sanitizeInput(category, 80)); }
    const sql = `SELECT id, kind, title, description, category, install_count,
         rating_avg, rating_count, created_at
       FROM marketplace_listings
       WHERE ${conds.join(' AND ')}
       ORDER BY install_count DESC, created_at DESC
       LIMIT 200`;
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: results || [] });
  } catch { return json({ data: [] }); }
}
```

- **Signature `(env, url)` FIGÉE** — worker.ts câblé, NE PAS la changer.
- **Projection liste ACTUELLE** (à GARDER) : `id, kind, title, description,
  category, install_count, rating_avg, rating_count, created_at`. **PAS de
  `content_json` (lourd), PAS de `publisher_client_id`/`publisher_agency_id`
  (données tenant).**
- `KINDS` = `Set(['funnel','workflow','sequence'])` ; `sanitizeInput` (import
  RELATIF déjà en place). `json({data})` succès / `json({error},status)` erreur,
  **JAMAIS `code`**. best-effort (catch ⇒ `{data:[]}`, pas de 500/throw).

### `src/pages/Marketplace.tsx` — filtrage CLIENT actuel (l.~424-430, POINT DE BASCULE Manager-C)

```tsx
const filtered = useMemo(() => {
  return listings.filter((l) => {
    if (kindFilter !== 'all' && l.kind !== kindFilter) return false;
    if (categoryFilter !== 'all' && l.category !== categoryFilter) return false;
    return true;
  });
}, [listings, kindFilter, categoryFilter]);
```

L'appel actuel est `getMarketplaceListings()` SANS argument (l.~261). Manager-C
remplace le filtrage client par un appel SERVEUR paramétré (debounce sur `q`),
en RÉUTILISANT `kindFilter`/`categoryFilter` existants comme `kind`/`category`.

### `src/lib/api.ts` — types EXISTANTS (l.6295-6325, RÉUTILISÉS)

```ts
export type MarketplaceKind = 'funnel' | 'workflow' | 'sequence';
export interface MarketplaceListing {
  id; publisher_client_id?; publisher_agency_id?; kind: MarketplaceKind;
  title; description?; category?; content_json?; status: 'draft'|'published';
  install_count; rating_avg; rating_count; price_cents /* INACTIF v1 */;
  reviews?; created_at?; updated_at?;
}
export interface MarketplaceReview { id; listing_id; reviewer_client_id?; rating; comment?; created_at? }
```

### `src/components/layout/Sidebar.tsx` — pattern item nav + `Store` importé (l.11, l.46-55)

`Store` est **DÉJÀ importé** (l.11, lucide-react) — utilisé par `/boutique`
(gated `moduleRequired:'ecommerce'`). Le groupe Marketing (l.46-55) :

```tsx
{
  label: t('nav.marketing'),
  items: [
    { path: '/templates', label: t('nav.templates'), icon: <Icon as={Mail} size={18} /> },
    { path: '/workflows', label: t('nav.automations'), icon: <Icon as={Zap} size={18} /> },
    { path: '/trigger-links', label: t('nav.trigger_links'), icon: <Icon as={Link2} size={18} /> },
    { path: '/forms/builder/new', label: t('nav.forms'), icon: <Icon as={ClipboardList} size={18} /> },
    { path: '/funnels', label: t('funnel.nav'), icon: <Icon as={LayoutTemplate} size={18} /> },
  ],
},
```

**Pattern item Sidebar (à CALQUER, Manager-C)** — UNE entrée à AJOUTER dans ce
groupe, à côté de `/funnels`/`/workflows` :

```tsx
{ path: '/marketplace', label: t('marketplace.nav'), icon: <Icon as={Store} size={18} /> },
```

⚠ **PAS de `moduleRequired`** (G7 `/marketplace` non gated ≠ `/boutique`
e-commerce gated). **PAS de `adminOnly`.** `marketplace.nav` EXISTE déjà
(`marketplace.nav` = « Marketplace » ×4) — **NE PAS la redéfinir.**

### i18n `marketplace.*` EXISTANTES (14 clés, INTOUCHÉES) + 5 NEUVES (Phase A)

14 existantes (INTOUCHÉES, NE PAS redéfinir) : `nav`, `title`, `subtitle`,
`empty`, `publish`, `install`, `installed`, `free`, `reviews`,
`category.{funnel,workflow,sequence}`, `status.{draft,published}`.

---

## §1 — MIGRATION : **AUCUNE** (confirmation explicite)

**AUCUN DDL n'est requis pour ce sprint.** Le schéma seq 96 (`marketplace_listings`)
porte DÉJÀ toutes les colonnes nécessaires :
- recherche `?q=` → `LIKE` sur `title` / `description` (colonnes EXISTANTES) ;
- tri `?sort=` → `ORDER BY` sur `install_count` / `created_at` / `rating_avg` /
  `rating_count` (colonnes EXISTANTES) ;
- filtres `?kind=` / `?category=` → DÉJÀ gérés (colonnes EXISTANTES).

⇒ **ZÉRO `CREATE TABLE`, ZÉRO `ALTER`, ZÉRO index, ZÉRO fichier
`migration-*.sql`, ZÉRO entrée manifest.** Le **manifest reste à seq 118**
(LOT-CATALOG, INCHANGÉ). **PAS de migration « pour la forme ».** `index` seq 96
`idx_marketplace_listings_status(status, created_at)` couvre déjà le tri par
date ; les autres tris restent best-effort (LIMIT 200, dataset borné).

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helper élargi (FIGÉ Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **INCHANGÉS**. Succès =
**`json({ data })`** ; erreur = **`json({ error }, status)`**. **JAMAIS de champ
`code`**. **AUCUN helper n'envoie de `client_id`** (GET public, pré-auth).

Helper **ÉLARGI rétro-compatible** (param OPTIONNEL) :

```ts
export interface MarketplaceListQuery {
  q?: string;
  kind?: MarketplaceKind;
  category?: string;
  sort?: 'popular' | 'recent' | 'rating';
}

export async function getMarketplaceListings(
  params?: MarketplaceListQuery,
): Promise<ApiResponse<MarketplaceListing[]>>
//   → GET /marketplace/listings[?q&kind&category&sort]  (champs vides OMIS)
//   → SANS argument : `/marketplace/listings` BYTE-IDENTIQUE à avant (rétro-compat)
```

⚠ **Sérialisation** : `URLSearchParams`, champs vides/absents SKIPPÉS (`q`/`category`
trimés, ignorés si vides). Un appel SANS argument ⇒ pas de querystring du tout
(URL nue, comme l'appelle déjà `Marketplace.tsx`). `getMarketplaceListing(id)` /
`publishToMarketplace` / `installMarketplaceListing` / `reviewMarketplaceListing` /
`getMyMarketplaceListings` **INCHANGÉS**. **NE PAS modifier `api.ts` (FIGÉ Phase A).**

### §6.B — Types (`src/lib/api.ts`, FIGÉS Phase A)

`MarketplaceKind` / `MarketplaceListing` / `MarketplaceReview` **EXISTANTS,
INCHANGÉS**. `MarketplaceListQuery` **NEUF** (§6.A). **NE PAS toucher `types.ts`
ni les types existants.**

### §6.C — Routes worker (`src/worker.ts`, INTOUCHÉ — AUCUNE nouvelle route)

| Route | Méthode | Handler | Auth |
|---|---|---|---|
| `/api/marketplace/listings` | GET | `handleGetMarketplaceListings(env, url)` | **PUBLIC** (pré-`requireAuth`) |

La route GET EXISTE DÉJÀ ; Manager-B lit juste de nouveaux `url.searchParams`
(`q`, `sort`) DANS le handler. **`src/worker.ts` n'est PAS touché ce lot.**
`getMarketplaceListings` reste **PUBLIC** (pré-auth). Mutations existantes
(`workflows.manage`) **INTOUCHÉES**. **ZÉRO ajout à `ALL_CAPABILITIES`.**

### §6.E — i18n (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, FIGÉ Phase A)

Namespace `marketplace.*`, **5 clés ADDITIVES ×4, parité STRICTE**, insérées
APRÈS `marketplace.status.published` (avant le bloc BOOKING) :
`marketplace.search` (placeholder), `marketplace.sort.label`,
`marketplace.sort.popular`, `marketplace.sort.recent`, `marketplace.sort.rating`.
fr-CA tutoiement / fr-FR vouvoiement. **Zéro collision avec les 14 existantes ;
`marketplace.nav` NON redéfinie.** **Manager-B/C les CONSOMMENT, n'en AJOUTENT
PAS** (i18n GELÉ Phase A). Source VIVANTE = `src/lib/i18n/*.ts` (PAS `.json`).

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned : **`src/worker/marketplace.ts` UNIQUEMENT** —
  DANS `handleGetMarketplaceListings(env, url)` (signature `(env, url)` **INCHANGÉE**) :
  - **`?q=`** : `const q = url.searchParams.get('q');` → si présent (non vide),
    ajouter `conds.push('(title LIKE ? OR description LIKE ?)')` et
    `binds.push(\`%${sanitizeInput(q, 120)}%\`, \`%${sanitizeInput(q, 120)}%\`)`.
    LIKE param-bindé (jamais d'interpolation). `sanitizeInput` (import RELATIF
    déjà présent).
  - **`?sort=`** : `const sort = url.searchParams.get('sort');` → **`ORDER BY`
    WHITELISTÉ** (mapping en dur, JAMAIS d'interpolation de `sort` dans le SQL) :
    - `recent` → `ORDER BY created_at DESC`
    - `rating` → `ORDER BY rating_avg DESC, rating_count DESC`
    - `popular` / défaut / inconnu → `ORDER BY install_count DESC, created_at DESC`
      (tri ACTUEL — comportement par défaut PRÉSERVÉ).
  - **GARDER** : `LIMIT 200`, `status='published'`, best-effort (catch ⇒
    `{data:[]}`), projection liste ACTUELLE (PAS de `content_json` ni
    `publisher_*_id`). RÉUTILISER les filtres `kind`/`category` DÉJÀ gérés.
  - **NE TOUCHE PAS** : `handleGetMarketplaceListing`, le strip cross-tenant
    (FLAG #1), publish/install/reviews, la signature des handlers.
- **Manager-C (frontend)** owned :
  - **`src/pages/Marketplace.tsx`** — REMPLACE le filtrage 100% client par un
    appel SERVEUR `getMarketplaceListings({ q, kind, category, sort })` (debounce
    sur `q`, ~250-350ms). RÉUTILISE les FilterChip `kind` + Select `category`
    EXISTANTS (mappés sur les params) ; AJOUTE un Input recherche (placeholder
    `t('marketplace.search')`) + un Select tri (`t('marketplace.sort.label')`,
    options `popular`/`recent`/`rating`). **Additif — NE PAS casser les 4 vues,
    l'install, les reviews, le détail inline.**
  - **`src/components/layout/Sidebar.tsx`** — AJOUTE UNE entrée nav `/marketplace`
    dans le groupe **Marketing** (à côté de `/funnels`/`/workflows`), label
    `t('marketplace.nav')` (EXISTANTE), icône `Store` (DÉJÀ importée).
    **PAS de `moduleRequired`** (G7 non gated), **PAS de `adminOnly`**.
  - **`src/index.css`** — UNIQUEMENT si des classes recherche/tri neuves sont
    nécessaires (bloc append-only en fin de fichier) ; sinon RÉUTILISER les
    classes existantes (le bloc G7 `.mk-*` existe déjà). Optionnel.
- **INTERDITS aux deux** : **`src/lib/api.ts`** (helper + `MarketplaceListQuery`
  FIGÉS A), **i18n ×4** (5 clés FIGÉES A), **`src/lib/types.ts`** (gelé A),
  **`src/worker.ts`** (AUCUNE route), **`App.tsx`** (route `/marketplace` existe),
  **migration / manifest** (AUCUNE — voir §1). **`marketplace.ts` = Manager-B**
  (Manager-C ne le touche PAS) ; **`Marketplace.tsx` + `Sidebar.tsx` (+`index.css`
  optionnel) = Manager-C** (Manager-B ne les touche PAS). **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **AUCUNE migration** (§1) : schéma seq 96 suffit (LIKE/ORDER BY sur colonnes
   existantes). **Manifest INCHANGÉ** (reste seq 118). **NE PAS créer de fichier
   `migration-*.sql` « pour la forme »** ni d'entrée manifest.
2. **CHECK `marketplace_*` INEXISTANT** : seq 96 n'a NI CHECK NI FK. **NE PAS en
   ajouter.** `kind`/`status` gardés applicativement (`KINDS.has`, `status='published'`).
3. **FK INTERDITES** : zéro FK ce lot (et zéro DDL tout court).
4. **`getMarketplaceListings` param OPTIONNEL — rétro-compat STRICTE** : un appel
   SANS argument DOIT cibler `/marketplace/listings` URL nue (byte-identique). Les
   champs vides sont SKIPPÉS du querystring. (Vérifié : `URLSearchParams` vide ⇒
   pas de `?`.)
5. **`ORDER BY` WHITELISTÉ — anti-injection** : `sort` est mappé en dur vers une
   clause `ORDER BY` constante (`popular`/`recent`/`rating`). **JAMAIS interpoler
   `sort` (ni aucune valeur user) dans le SQL.** Inconnu/absent ⇒ tri par défaut
   (`install_count DESC, created_at DESC`).
6. **`q` param-bindé** : `LIKE ?` avec `%${sanitizeInput(q,120)}%` en `bind()`,
   JAMAIS d'interpolation de chaîne dans le SQL.
7. **GET PUBLIC** : `handleGetMarketplaceListings` reste pré-`requireAuth`
   (catalogue public cross-tenant). **ZÉRO ajout à `ALL_CAPABILITIES`** ;
   mutations gardent `workflows.manage`.
8. **`/marketplace` (G7) NON gated ≠ `/boutique` (e-commerce) gated** : l'entrée
   Sidebar `/marketplace` n'a **PAS** de `moduleRequired`. NE PAS la confondre
   avec les 4 entrées `/boutique*` (`moduleRequired:'ecommerce'`).
9. **`price_cents` INACTIF** : jamais lu, jamais trié dessus, zéro paiement/E4/E6.
10. **RÉUTILISER, PAS RECONSTRUIRE** : `marketplace.ts` (745l), `Marketplace.tsx`
    (928l), le strip, les reviews, la route, les 14 clés i18n, les FilterChip/Select
    EXISTANTS — tout est RÉUTILISÉ. On AJOUTE `q`/`sort` + recherche + tri + nav.
11. **Alias** : imports worker **RELATIFS** (`./...`), front `@/`. `worker.ts`
    INTOUCHÉ (la route existe).
12. **i18n `.ts` (PAS `.json`)** — parité stricte **5 clés ×4**, GELÉE Phase A.
    Les 14 clés `marketplace.*` existantes + `marketplace.nav` INTOUCHÉES (NON
    redéfinies).
13. **Ne PAS exposer `publisher_*_id` / `content_json` (lourd) en liste** :
    la projection liste ACTUELLE les EXCLUT déjà. Manager-B GARDE cette projection
    (n'ajoute que des conditions WHERE + ORDER BY whitelisté).

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-22)

Fichiers **créés** :
1. `docs/LOT-MARKETPLACE-SPRINT19.md` — ce document (§6 FIGÉ).

Fichiers **modifiés** (rigoureusement ADDITIFS) :
1. `src/lib/api.ts` — type `MarketplaceListQuery` NEUF (à côté de
   `MarketplaceListing`) + `getMarketplaceListings` ÉLARGI (param OPTIONNEL
   `MarketplaceListQuery`, sérialisation `URLSearchParams` champs vides skippés,
   appel sans-arg byte-identique). `apiFetch`/`ApiResponse` INCHANGÉS ; autres
   helpers marketplace INCHANGÉS ; aucun `client_id` envoyé.
2. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 5 clés ADDITIVES `marketplace.*`
   (`search`, `sort.label`, `sort.popular`, `sort.recent`, `sort.rating`) après
   `marketplace.status.published`, parité stricte ×4, fr-CA tutoiement / fr-FR
   vouvoiement. Les 14 clés existantes + `marketplace.nav` INTOUCHÉES.

Fichiers **NON touchés** (volontairement) :
- **AUCUNE migration**, **manifest INCHANGÉ** (reste seq 118) — voir §1.
- `src/worker.ts` — AUCUNE nouvelle route (GET existe).
- `src/worker/marketplace.ts` — owned Manager-B (Phase B).
- `src/pages/Marketplace.tsx` + `src/components/layout/Sidebar.tsx`
  (+`src/index.css`) — owned Manager-C (Phase B).
- `src/lib/types.ts`, `App.tsx` — gelés/inchangés.

**Migration** : **AUCUNE** (DDL non requis). **Build** : non vérifié (VMware sans
bun/node) — **délégué côté hôte**.

### Confirmations garde-fous
- **AUCUNE migration** : ZÉRO DDL, ZÉRO fichier `migration-*.sql`, ZÉRO entrée
  manifest, manifest reste seq 118. Schéma seq 96 suffit (LIKE/ORDER BY sur
  colonnes existantes).
- **Existant INTOUCHÉ** : `marketplace.ts` (handlers + strip + reviews),
  `Marketplace.tsx`, route `/marketplace`, `worker.ts`, les 14 clés i18n +
  `marketplace.nav`.
- **ApiResponse INCHANGÉ** (`{ data }` / `{ error }`, jamais `code`).
- **Capability** : `getMarketplaceListings` reste PUBLIC ; mutations gardent
  `workflows.manage` — **ZÉRO ajout à `ALL_CAPABILITIES`**.
- **Rétro-compat** : `getMarketplaceListings()` sans arg = URL nue byte-identique.
- **Anti-injection** : `ORDER BY` whitelisté (mapping en dur), `q` param-bindé.
- **`/marketplace` non gated** (PAS de `moduleRequired`) ≠ `/boutique` gated.
- **`price_cents` INACTIF** ; **`content_json`/`publisher_*_id` NON exposés en liste**.
- **i18n** : source VIVANTE `src/lib/i18n/*.ts`, parité 5 clés ×4.

### Écarts CODE > brief
- **Helper sérialise via `URLSearchParams`** (et non concat manuelle) : garantit
  l'encodage correct de `q`/`category` et l'omission stricte des champs vides ;
  `qs.toString()` vide ⇒ URL nue sans `?` (rétro-compat byte-identique prouvée).
- **`q`/`category` trimés côté helper** (skip si vide après trim) : évite un
  `?q=` parasite quand l'Input débouncé renvoie une chaîne d'espaces. Le worker
  re-`sanitizeInput` de toute façon (défense en profondeur).
