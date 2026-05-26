# LOT CATALOG — Catalogue de services + sélecteur devis (Sprint 18 : le CATALOGUE PRODUITS e-commerce existe DÉJÀ — `ecommerce-products.ts` (`handleListProducts` CRUD/variants/catégories/recherche, `products` status CHECK `draft/active/archived`, `base_price` en CENTS INTEGER, gated `requireModule('ecommerce')`) ; les DEVIS existent DÉJÀ — `quotes.ts` seq 82 (`handleCreateQuote`/`handleUpdateQuote`/`handleGetQuote`/`handleAcceptQuote`, `quote_items` `label/qty/unit_price` en DOLLARS REAL, `computeTotals` TPS/TVQ). GAPS : (1) aucun catalogue de SERVICES sans stock utilisable SANS Boutique ; (2) les devis ne piochent dans AUCUN catalogue (lignes en saisie libre). On COMBLE les deux, 100% ADDITIF, en RÉUTILISANT l'existant — PAS de reconstruction de `products`)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-PROPOSALS-ESIGN.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE des fichiers RÉUTILISÉS,
> jamais le brief).

Sprint **100% ADDITIF**, **migration `migration-catalog-seq118.sql`**
(1 `CREATE TABLE IF NOT EXISTS catalog_items` NEUVE + 1 `ALTER TABLE quote_items
ADD COLUMN catalog_item_id` NULLABLE + 2 index). Le catalogue produits ET les
devis existent DÉJÀ — **à RÉUTILISER, NE PAS reconstruire** :

- `src/worker/ecommerce-products.ts` (Sprint E2) — owned **lecture/import** (PAS
  modifié par ce lot). Pièces RÉUTILISÉES (en LECTURE par Manager-B) :
  - **`resolveClientId(env, auth)`** (l.31) : `const { clientId } = await
    getClientModules(env, auth.userId); return clientId;`. **Pattern CALQUÉ** dans
    `catalog.ts` (déjà posé Phase A).
  - **`handleListProducts`** (l.104) : filtre `search` = `p.title LIKE ?` (+ SKU
    variante). **Pattern de recherche CALQUÉ** pour `handleSearchCatalogItems`
    (`name LIKE ? OR description LIKE ?`).
  - **schéma `products`** (Sprint E1) : `base_price INTEGER -- cents`,
    `product_type TEXT`, `status CHECK (draft/active/archived)`, `currency`. Pour
    l'**import** (Phase B) : LECTURE seule, mapping **cents → dollars (/100)**,
    `kind` selon `product_type`. ⚠ **NE TOUCHE PAS le CHECK `products.status`.**
- `src/worker/quotes.ts` (seq 82) — owned Manager-B sur d'autres lots, mais **NON
  TOUCHÉ par ce lot** (le sélecteur côté devis est purement FRONT). Pièces dont la
  LOGIQUE est CALQUÉE dans `catalog.ts` (PAS importée — code dupliqué localement,
  fichiers disjoints) :
  - **`capGuard`** (l.53) : `requireCapability('invoices.write')` mode-agence-only
    (legacy/mono-tenant/api-key/tests ⇒ skip). **CALQUÉ** dans `catalog.ts`.
  - **`isLegacy`** (l.64) : `!auth?.tenant || auth.tenant.agencyId == null`.
    **CALQUÉ** pour le bornage tenant de la liste.
  - **`loadQuoteScoped`** (l.255) : charge une row bornée tenant. **Pattern de
    bornage** repris pour charger/valider un `catalog_item` avant update/delete.
  - **`computeTotals`** (l.78) : consomme des **DOLLARS REAL** (`unit_price`). →
    c'est POURQUOI `catalog_items.unit_price` est en DOLLARS (pas cents) : un item
    de catalogue se reverse tel quel dans une ligne de devis.
  - **contrat `handleCreateQuote`** (l.133) : body `{ items: [{ label, qty,
    unit_price }] }`. **INCHANGÉ.** Le sélecteur (Manager-C) pré-remplit une ligne
    `{ label=name, unit_price, qty:1 }` — il N'ALTÈRE PAS ce contrat.
- `src/lib/api.ts` — `CatalogItem`/`CatalogKind` + helpers `listCatalogItems`/
  `createCatalogItem`/`updateCatalogItem`/`deleteCatalogItem`/`searchCatalogItems`/
  `importCatalogFromProducts` NEUFS (FIGÉS Phase A). `createQuote`/
  `InvoiceLineInput` EXISTANTS **INCHANGÉS**. **READ/IMPORT (front).**
- `src/pages/Quotes.tsx` — éditeur de lignes EXISTANT (l.527-569 : `rows.map`,
  bouton « Ajouter une ligne » l.518-524). **POINT D'INSERTION du sélecteur
  catalogue (Manager-C).** **À ÉTENDRE — additif.**

**GAP comblé :**
- **(A)** pas de catalogue de SERVICES sans stock sans Boutique → table NEUVE
  `catalog_items` (`kind` service|product, `unit_price` DOLLARS REAL, `recurrence`
  one_time|recurring) + routes `/api/catalog/*` sous **`requireAuth` SEUL** (PAS
  `requireModule('ecommerce')`) + page `Catalog.tsx`.
- **(B)** les devis ne piochent dans aucun catalogue → **sélecteur** dans l'éditeur
  de lignes de `Quotes.tsx` (`searchCatalogItems` → pré-remplit `{ label, unit_price,
  qty:1 }`) + colonne de TRAÇABILITÉ `quote_items.catalog_item_id` (NULLABLE).

Alias : imports worker **RELATIFS** (`./...`), JAMAIS `@/`. Front `@/`.

---

## §0 — AUDIT DISQUE (le code fait foi — à RÉUTILISER)

### `src/worker/ecommerce-products.ts` — `resolveClientId` (l.31, pattern CALQUÉ)

```ts
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}
```
**Manager-B RÉUTILISE ce pattern** (déjà posé identique dans `catalog.ts` Phase A) —
`client_id`/`agency_id` résolus SERVEUR, JAMAIS depuis le body.

### `src/worker/ecommerce-products.ts` — `handleListProducts` search (l.104-134, pattern CALQUÉ)

```ts
// search filtre sur le titre (+ SKU variante) :
if (search) {
  where.push(`(p.title LIKE ? OR p.id IN (
     SELECT product_id FROM product_variants WHERE sku LIKE ?))`);
  params.push(`%${search}%`, `%${search}%`);
}
```
**Manager-B CALQUE ce pattern** pour `handleSearchCatalogItems` :
`WHERE is_active = 1 AND (name LIKE ? OR description LIKE ?)`, borné tenant.

### Schéma `products` (Sprint E1 — LECTURE/import seulement, NON modifié)

```sql
products( id, client_id, title, slug, description, status CHECK(draft/active/archived),
  product_type TEXT, base_price INTEGER /* CENTS */, currency, … )
```
⚠ Import (Phase B) : LECTURE seule, **cents → dollars (`base_price / 100`)**,
`kind` selon `product_type`, `product_id` = `products.id` (lien faible). **NE
TOUCHE PAS le CHECK `products.status`. NE MODIFIE PAS `products` / `ecommerce-
products.ts`.**

### `src/worker/quotes.ts` — `capGuard` (l.53) / `isLegacy` (l.64) / `loadQuoteScoped` (l.255) / `computeTotals` (l.78)

`capGuard(auth, 'invoices.write')` mode-agence-only (legacy/mono-tenant/api-key/
tests ⇒ skip). `isLegacy(auth)` = `!tenant || agencyId == null`. `loadQuoteScoped`
= row bornée tenant ou null. `computeTotals(items)` consomme `unit_price` en
**DOLLARS REAL**. **Patterns CALQUÉS dans `catalog.ts` (code dupliqué localement —
fichiers disjoints, PAS d'import croisé).**

### `src/worker/quotes.ts` — contrat `handleCreateQuote` (l.133, INCHANGÉ)

```ts
// body { items: [{ label, qty, unit_price }], client_id?, lead_id?, … }
// → computeTotals(body.items) → INSERT quotes + quote_items (label, qty,
//   unit_price, line_total). Renvoie json({ data:{ id, quote_number } }, 201).
```
⚠ **CONTRAT GELÉ.** Le sélecteur (Manager-C) pré-remplit une ligne `{ label=name,
unit_price, qty:1 }` — **les lignes restent `{ label, qty, unit_price }`**.
`catalog_item_id` est OPTIONNEL (traçabilité ; transporté seulement si Manager-C
le câble, sinon NULL — la colonne est NULLABLE).

### `src/lib/api.ts` — contrat `InvoiceLineInput` / `createQuote` (INCHANGÉS)

```ts
export interface InvoiceLineInput { label: string; qty: number; unit_price: number }
export async function createQuote(data: {
  client_id?: string; lead_id?: string; description?: string; valid_until?: string;
  items: InvoiceLineInput[];
}): Promise<ApiResponse<{ id: string; quote_number?: string }>>
```
**FIGÉ.** Le sélecteur produit un `InvoiceLineInput` (`label`/`qty`/`unit_price`) —
zéro changement de signature.

### `src/pages/Quotes.tsx` — éditeur de lignes (l.527-569, POINT D'INSERTION sélecteur)

```tsx
// l.518-524 : bouton « Ajouter une ligne » (setRows(r => [...r, blankRow()]))
// l.527 :   {rows.map((row, i) => { … })}  // une ligne = Input label / qty / unit_price
```
**Manager-C insère le sélecteur catalogue ICI** (à côté du bouton « Ajouter une
ligne », l.518-524) : un picker `searchCatalogItems(q)` → à la sélection,
`setRows(r => [...r, { label: item.name, qty: '1', unit_price: String(item.unit_price) }])`
(ou pré-remplit une ligne vide existante). **Additif — NE PAS casser l'édition
manuelle de lignes existante.**

### Colonnes / objets ADDITIFS (seq 118 — manifestée)

```sql
CREATE TABLE IF NOT EXISTS catalog_items ( id … kind TEXT DEFAULT 'service',
  unit_price REAL DEFAULT 0 /* DOLLARS */, recurrence TEXT DEFAULT 'one_time',
  is_active INTEGER DEFAULT 1, product_id TEXT, … );   -- kind/recurrence SANS CHECK
ALTER TABLE quote_items ADD COLUMN catalog_item_id TEXT DEFAULT NULL;  -- NULLABLE, in-place
CREATE INDEX IF NOT EXISTS idx_catalog_items_client   ON catalog_items(client_id, is_active);
CREATE INDEX IF NOT EXISTS idx_catalog_items_category ON catalog_items(category);
```
Zéro CHECK / FK / DROP / RENAME / rebuild. **CHECK `products.status` (E1) et CHECK
`quotes.status` (seq 82) INTOUCHÉS.** `kind`/`recurrence` SANS CHECK (gardés
applicativement, calque `product_subscriptions.status` seq 85). Liens
`catalog_items↔products` et `quote_items↔catalog_items` APPLICATIFS (TEXT, PAS de
FK).

---

## §1 — MIGRATION (seq 118, ADDITIVE)

`migration-catalog-seq118.sql` (racine) — calque l'en-tête seq 117 : 1 `CREATE
TABLE IF NOT EXISTS catalog_items` (NEUVE, id randomblob, timestamps — calque
`product_subscriptions` seq 85) + 1 `ALTER TABLE quote_items ADD COLUMN
catalog_item_id TEXT DEFAULT NULL` (NULLABLE, DEFAULT constant ⇒ in-place, zéro
rebuild) + 2 `CREATE INDEX IF NOT EXISTS`. **ZÉRO CHECK, ZÉRO FK, ZÉRO
DROP/RENAME/rebuild, ZÉRO touch du CHECK `products.status`/`quotes.status`.**
Manifestée `docs/migrations-manifest.json` seq 118
(`depends_on:["migration-proposals-esign-seq117.sql"]`, objects
`["table:catalog_items","alter:quote_items","index:catalog_items"]`, risk low).
⚠ **NE touche NI products NI quotes NI leads NI clients NI invoices.**

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉ Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **INCHANGÉS**. Succès =
**`json({ data })`** ; erreur = **`json({ error }, status)`**. **JAMAIS de champ
`code`**. **AUCUN helper n'envoie de `client_id`** (tenant re-borné worker-side).

```ts
listCatalogItems(params?: { kind?: CatalogKind; category?: string; is_active?: boolean })
  : Promise<ApiResponse<CatalogItem[]>>          // → GET /catalog/items[?kind&category&is_active]
createCatalogItem(payload: CatalogItemInput)
  : Promise<ApiResponse<CatalogItem>>            // → POST /catalog/items
updateCatalogItem(id: string, payload: Partial<CatalogItemInput>)
  : Promise<ApiResponse<{ success: boolean }>>   // → PATCH /catalog/items/:id
deleteCatalogItem(id: string)
  : Promise<ApiResponse<{ success: boolean }>>   // → DELETE /catalog/items/:id
searchCatalogItems(q: string)
  : Promise<ApiResponse<CatalogItem[]>>          // → GET /catalog/search?q=encodeURIComponent(q)
importCatalogFromProducts()
  : Promise<ApiResponse<{ imported: number }>>   // → POST /catalog/import-products (optionnel)
```
**NE PAS modifier `api.ts` (FIGÉ Phase A).** `createQuote`/`InvoiceLineInput`
EXISTANTS **INCHANGÉS**.

### §6.B — Types `CatalogItem` / `CatalogKind` (`src/lib/api.ts`, FIGÉ Phase A)

```ts
export type CatalogKind = 'service' | 'product';
export interface CatalogItem {
  id: string;
  name: string;
  description?: string | null;
  kind: CatalogKind;             // gardé applicativement (pas de CHECK SQL)
  unit_price: number;            // DOLLARS REAL (aligné quote_items, PAS cents)
  currency?: string | null;
  category?: string | null;
  recurrence?: string | null;    // one_time|recurring — gardé applicativement
  is_active?: number | boolean;
  product_id?: string | null;    // lien faible → products (import)
}
export interface CatalogItemInput { name; description?; kind?; unit_price?;
  currency?; category?; recurrence?; is_active? }
```
⚠ `unit_price` en **DOLLARS** (un item se reverse tel quel dans une ligne de
devis). L'import depuis `products` (cents) convertit **/100** côté worker.

### §6.C — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

| Route | Méthode | Handler | Module | Auth | capGuard |
|---|---|---|---|---|---|
| `/api/catalog/items` | GET | `handleListCatalogItems(request, env, auth, url)` | `./worker/catalog` | requireAuth | — (lecture) |
| `/api/catalog/items` | POST | `handleCreateCatalogItem(request, env, auth)` | `./worker/catalog` | requireAuth | `invoices.write` (handler) |
| `/api/catalog/items/:id` | PATCH | `handleUpdateCatalogItem(request, env, auth, id)` | `./worker/catalog` | requireAuth | `invoices.write` (handler) |
| `/api/catalog/items/:id` | DELETE | `handleDeleteCatalogItem(request, env, auth, id)` | `./worker/catalog` | requireAuth | `invoices.write` (handler) |
| `/api/catalog/search` | GET | `handleSearchCatalogItems(request, env, auth, url)` | `./worker/catalog` | requireAuth | — (lecture) |
| `/api/catalog/import-products` | POST | `handleImportCatalogFromProducts(request, env, auth)` | `./worker/catalog` | requireAuth | `invoices.write` (handler) |

- ⚠ **Toutes sous `requireAuth` SEUL — JAMAIS `requireModule('ecommerce')`** (un
  catalogue de services vit SANS Boutique). Calque le bloc `/api/quotes` (sous
  requireAuth, import dynamique `await import('./worker/catalog')`), **PAS** le bloc
  `if (path.startsWith('/api/ecommerce/'))` (gating ecommerce — à NE PAS copier).
- **Anti-shadowing** : `/api/catalog/search` et `/api/catalog/import-products`
  (paths EXACTS) déclarées AVANT `/api/catalog/items/:id`
  (`/^\/api\/catalog\/items\/[a-zA-Z0-9_-]+$/`). `/items` (collection) avant
  `/items/:id` (élément). Aucun chevauchement.
- ⚠ Les routes `/api/quotes*`, `/api/ecommerce/*`, `/api/invoices*` sont
  **INTOUCHÉES**.

### §6.E — Stubs (owned Manager-B, posés Phase A)

Signatures **FIGÉES Phase A**, corps Phase B. `src/worker/catalog.ts` (NEUF) —
calque `resolveClientId` (ecommerce-products.ts) + `capGuard`/`isLegacy`/
`loadQuoteScoped` (quotes.ts, dupliqués localement). Corps stub
`json({ data: [] })` / `json({ data: {} })` + `// Manager-B: corps réel`.

```ts
handleListCatalogItems(request, env, auth, url): Promise<Response>          // lecture, borné tenant
handleCreateCatalogItem(request, env, auth): Promise<Response>             // capGuard invoices.write
handleUpdateCatalogItem(request, env, auth, itemId): Promise<Response>     // capGuard invoices.write
handleDeleteCatalogItem(request, env, auth, itemId): Promise<Response>     // capGuard invoices.write
handleSearchCatalogItems(request, env, auth, url): Promise<Response>       // lecture, name+description LIKE
handleImportCatalogFromProducts(request, env, auth): Promise<Response>     // capGuard invoices.write, LECTURE products
```

### §6.F — i18n (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, FIGÉ Phase A)

Namespace `catalog.*`, **13 clés ADDITIVES ×4, parité STRICTE**, insérées APRÈS
`proposal.declined` : `catalog.title`, `catalog.new`, `catalog.kind.service`,
`catalog.kind.product`, `catalog.search`, `catalog.select`, `catalog.empty`,
`catalog.name`, `catalog.price`, `catalog.category`, `catalog.recurrence.one_time`,
`catalog.recurrence.recurring`, `catalog.import_products`. fr-CA tutoiement /
fr-FR vouvoiement. **Manager-B/C les CONSOMMENT, n'en AJOUTENT PAS** (i18n GELÉ
Phase A). Source VIVANTE = `src/lib/i18n/*.ts` (PAS `.json`).

### §6.G — Import depuis `products` (cents → dollars) — CRUCIAL Manager-B

Dans `handleImportCatalogFromProducts` (catalog.ts), Manager-B :
- LECTURE seule : `SELECT id, title, description, base_price, product_type,
  currency FROM products WHERE client_id = ?` (borné tenant via `resolveClientId`) ;
- **mapping cents → DOLLARS** : `unit_price = base_price / 100` ;
- `kind` selon `product_type` (DEFAULT `'product'`) ; `name = title` ;
  `product_id = products.id` (lien faible, traçabilité) ;
- `INSERT INTO catalog_items (id, client_id, agency_id, name, description, kind,
  unit_price, currency, product_id) VALUES (…)` ;
- renvoyer `json({ data:{ imported: <n> } })`. best-effort, jamais 500 brut.
⚠ **NE MODIFIE PAS `products` / `ecommerce-products.ts` / storefront** (lecture
seule). **NE TOUCHE PAS le CHECK `products.status`.**

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned : **`src/worker/catalog.ts` UNIQUEMENT** —
  - **CRUD `catalog_items`** borné tenant (calque `resolveClientId` /
    `isLegacy` / `loadQuoteScoped`) : `handleListCatalogItems` (liste filtrée
    kind/category/is_active), `handleCreateCatalogItem`/`handleUpdateCatalogItem`/
    `handleDeleteCatalogItem` (capGuard `invoices.write`, déjà dans les stubs).
    `kind`/`recurrence` gardés applicativement (énum service|product /
    one_time|recurring, sans CHECK SQL). `unit_price` DOLLARS REAL.
  - **`handleSearchCatalogItems`** : `GET /api/catalog/search?q=` — calque
    `handleListProducts` search (`name LIKE ? OR description LIKE ?`), borné tenant,
    `is_active = 1`.
  - **`handleImportCatalogFromProducts`** (optionnel) : LECTURE `products`, mapping
    cents → dollars (/100), `kind` selon `product_type`, `INSERT catalog_items`
    (§6.G). capGuard `invoices.write`.
  - **NE TOUCHE PAS** `quotes.ts` / `ecommerce-products.ts` / storefront (LECTURE/
    import seulement). + tests `__tests__/`.
- **Manager-C (frontend)** owned :
  - **`src/pages/Catalog.tsx`** (NEUF, export `CatalogPage`) : liste + CRUD des
    items service/produit (`listCatalogItems`/`createCatalogItem`/
    `updateCatalogItem`/`deleteCatalogItem`) + bouton **import depuis la Boutique**
    (`importCatalogFromProducts`, libellé `catalog.import_products`). i18n
    `catalog.*`.
  - **route `/catalog`** dans `App.tsx` + **entrée Sidebar** (calque les autres
    pages).
  - **sélecteur catalogue dans `src/pages/Quotes.tsx`** : dans l'éditeur de lignes
    (**~l.527-569**, à côté du bouton « Ajouter une ligne » l.518-524), un picker
    appelant `searchCatalogItems(q)` → à la sélection, **pré-remplit une ligne
    `{ label: item.name, qty: '1', unit_price: String(item.unit_price) }`**. ⚠ **NE
    MODIFIE PAS le contrat `createQuote`** : les lignes restent `{ label, qty,
    unit_price }` ; `catalog_item_id` est optionnel (traçabilité, transporté
    seulement si câblé, sinon NULL — colonne NULLABLE). **Additif — NE PAS casser
    la liste/édition de devis existante.**
- **INTERDITS aux deux** : migration, manifest, **`src/lib/types.ts`** /
  **`src/lib/api.ts`** (types + helpers `catalog*` FIGÉS), **`src/worker.ts`**,
  **i18n ×4**, **`src/index.css`**, **`src/worker/ecommerce-products.ts`** /
  **storefront** (lecture/import SEULEMENT). **`catalog.ts` = Manager-B**
  (Manager-C ne le touche PAS) ; **`Catalog.tsx` + `Quotes.tsx` (sélecteur) +
  `App.tsx` (route) + Sidebar = Manager-C** (Manager-B ne les touche PAS).
  ⚠ **`Quotes.tsx` = Manager-C** (sélecteur) — **Manager-B ne touche PAS
  `Quotes.tsx`** (ni `quotes.ts`). **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **Manifest seq 118 — chemin MANIFEST-DRIVEN.** Entrée seq 118 posée Phase A (NE
   PAS la modifier). `scripts/migrate.ts` FIGÉ. ✔ vérifié : virgule seq 117
   ajoutée, JSON valide.
2. **CHECK `products.status` (E1) ET `quotes.status` (seq 82) INTOUCHABLES.** La
   migration ne recrée NI n'altère ces tables (au-delà du seul `ALTER quote_items
   ADD COLUMN`). **JAMAIS `CREATE TABLE products`/`CREATE TABLE quotes`.**
3. **MONEY — cents vs dollars REAL.** `catalog_items.unit_price` = **DOLLARS REAL**
   (aligné `quote_items` seq 82). `products.base_price` = **CENTS INTEGER**.
   L'**import convertit `/100`**. Ne JAMAIS stocker des cents dans
   `catalog_items.unit_price`.
4. **GATING — `requireAuth` SEUL, PAS `requireModule('ecommerce')`.** Un catalogue
   de services doit vivre SANS Boutique. Calquer le bloc `/api/quotes`, **PAS** le
   bloc `if (path.startsWith('/api/ecommerce/'))`.
5. **FK INTERDITES** : liens `catalog_items↔products` (`product_id`) et
   `quote_items↔catalog_items` (`catalog_item_id`) APPLICATIFS (TEXT). Zéro DROP /
   RENAME.
6. **`kind`/`recurrence` SANS CHECK** : énum (`service|product` /
   `one_time|recurring`) **gardée APPLICATIVEMENT** par le handler (calque
   `product_subscriptions.status` seq 85). Pas de rebuild possible si l'énum évolue.
7. **`ALTER TABLE quote_items ADD COLUMN catalog_item_id TEXT DEFAULT NULL`** :
   NULLABLE, DEFAULT constant ⇒ ajout in-place, **zéro rebuild `quote_items`**.
8. **RÉUTILISER, PAS DUPLIQUER `products`** : l'import LIT `products`
   (`ecommerce-products.ts` patterns), il ne reconstruit pas un second catalogue
   produits. `catalog_items` = catalogue de SERVICES (et import optionnel produits).
9. **Capability** : `invoices.write` (catalogue = pièce du domaine pré-comptable,
   même que devis). **ZÉRO ajout à `ALL_CAPABILITIES`** (`invoices.write` existe
   déjà, seq 80). Lectures (list/search) = pas de garde bloquante (bornage tenant).
10. **BORNAGE TENANT** : `resolveClientId` (jamais body) + `agency_id` scope agence.
    list/search bornés (isLegacy ⇒ scope complet ; mode agence ⇒ `agency_id` /
    `accessibleClientIds`). update/delete chargent l'item borné AVANT mutation.
11. **Alias relatifs worker** (`./...`), front `@/`. Routes worker = import
    dynamique (calque `/api/quotes`).
12. **i18n `.ts` (PAS `.json`)** — parité stricte 13 clés ×4, GELÉE Phase A. Les
    clés `sign.*`/`proposal.*` existantes INTOUCHÉES.
13. **Contrat `createQuote` INCHANGÉ** : le sélecteur (Manager-C) pré-remplit une
    ligne `{ label, qty, unit_price }` — il N'ALTÈRE PAS la signature ; `catalog_item_id`
    optionnel.

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-22)

Fichiers **créés** :
1. `migration-catalog-seq118.sql` — 1 `CREATE TABLE IF NOT EXISTS catalog_items`
   (id randomblob, `kind`/`recurrence` SANS CHECK, `unit_price` DOLLARS REAL,
   `product_id` lien faible, timestamps — calque `product_subscriptions` seq 85) +
   1 `ALTER TABLE quote_items ADD COLUMN catalog_item_id TEXT DEFAULT NULL`
   (NULLABLE, in-place) + 2 index, ADDITIF (calque en-tête seq 117). Zéro
   CHECK/FK/DROP/RENAME/rebuild. CHECK `products.status`/`quotes.status` INTOUCHÉS.
2. `src/worker/catalog.ts` (NEUF) — stubs CRUD + search + import (signatures FIGÉES,
   `capGuard('invoices.write')` sur mutations, `resolveClientId`/`isLegacy`/
   `capGuard` calqués, corps stub `json({ data: [] })`/`json({ data: {} })` +
   `// Manager-B: corps réel`). Imports RELATIFS.
3. `docs/LOT-CATALOG.md` — ce document (§6 FIGÉ).

Fichiers **modifiés** (rigoureusement ADDITIFS) :
1. `docs/migrations-manifest.json` — entrée seq 118 (virgule seq 117 ajoutée, JSON
   valide, `depends_on:["migration-proposals-esign-seq117.sql"]`, objects
   `["table:catalog_items","alter:quote_items","index:catalog_items"]`, risk low).
2. `src/lib/api.ts` — `CatalogKind`/`CatalogItem`/`CatalogItemInput` NEUFS ;
   helpers `listCatalogItems`/`createCatalogItem`/`updateCatalogItem`/
   `deleteCatalogItem`/`searchCatalogItems`/`importCatalogFromProducts` NEUFS.
   apiFetch/ApiResponse INCHANGÉS. `createQuote`/`InvoiceLineInput` INCHANGÉS. AUCUN
   client_id envoyé.
3. `src/worker.ts` — bloc `/api/catalog/*` (6 routes : GET/POST `/items`, PATCH/
   DELETE `/items/:id`, GET `/search`, POST `/import-products`) sous **requireAuth
   SEUL** (PAS requireModule), import dynamique `./worker/catalog`, anti-shadowing
   (`/search` + `/import-products` + `/items` avant `/items/:id`). Routes existantes
   INTOUCHÉES.
4. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 13 clés ADDITIVES `catalog.*` après
   `proposal.declined`, parité stricte ×4, fr-CA tutoiement / fr-FR vouvoiement.
   Clés existantes INTOUCHÉES.

**Migration** : seq 118 ADDITIVE, manifestée (manifest-driven). **Build** : non
vérifié (VMware sans bun/node) — **délégué côté hôte**.

### Confirmations garde-fous
- **Migration ADDITIVE** : 1 `CREATE TABLE IF NOT EXISTS` + 1 `ALTER ADD COLUMN`
  (NULLABLE) + 2 index, zéro CHECK/FK/DROP/RENAME/rebuild, zéro `CREATE TABLE
  products`/`quotes`, CHECK `products.status`/`quotes.status` INTOUCHÉS. Manifest
  seq 118 (depends_on seq 117) valide.
- **Existant INTOUCHÉ** : `ecommerce-products.ts` / `products` / storefront
  (lecture/import) ; `quotes.ts` / `computeTotals` / contrat `createQuote`
  `{label,qty,unit_price}` (réutilisation/lecture).
- **ApiResponse INCHANGÉ** (`{ data }` / `{ error }`, jamais `code`).
- **Capability** `invoices.write` RÉUTILISÉE — **ZÉRO ajout à `ALL_CAPABILITIES`**.
- **Money** : `catalog_items.unit_price` DOLLARS REAL, import products `/100`.
- **Gating** : `/api/catalog/*` sous `requireAuth` SEUL (PAS `requireModule
  ('ecommerce')`) — catalogue de services vivable sans Boutique.
- **i18n** : source VIVANTE `src/lib/i18n/*.ts`, parité 13 clés ×4.

### Écarts CODE > brief
- **`capGuard`/`isLegacy`/`resolveClientId` DUPLIQUÉS localement dans `catalog.ts`**
  (PAS importés de `quotes.ts`/`ecommerce-products.ts`) : ces helpers sont des
  fonctions de module privées (non exportées). Pour garder les fichiers DISJOINTS
  (catalog.ts = Manager-B exclusif, zéro import croisé qui créerait un couplage
  inter-lots), le pattern est CALQUÉ byte-équivalent localement. CODE > brief
  (« calque » = pattern, pas import).
- **Helper `importCatalogFromProducts` posé Phase A (optionnel)** : le brief le
  marque optionnel ; il est inclus (helper + route + stub) pour que le contrat soit
  complet et que Manager-C puisse câbler le bouton import dès Phase C. Le corps réel
  reste à la discrétion de Manager-B (stub renvoie `{ imported: 0 }`).
- **`is_active` typé `number | boolean` côté `CatalogItem`** : la colonne SQL est
  `INTEGER` (0/1) ; le helper input accepte `boolean`. Tolérance de typage assumée
  (le worker normalise).
