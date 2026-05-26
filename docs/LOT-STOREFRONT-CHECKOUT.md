# LOT STOREFRONT CHECKOUT — tunnel acheteur public (Sprint 7 : storefront par slug → panier anonyme par token → checkout adresse/livraison/récap taxes+frais → paiement MOCK → confirmation)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-MEMBERSHIP-ENROLL.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE, jamais le brief).

Sprint resserré, **100% ADDITIF**. Le backend e-commerce E1-E9 est **COMPLET**
mais **100% back-office** : toutes les routes `/boutique/*` sont admin-only, les
handlers cart/order (`ecommerce-cart.ts` / `ecommerce-orders.ts`) exigent
`auth.userId` (clientId résolu via `getClientModules(auth.userId)`). **Gap =
AUCUN tunnel acheteur public.** Ce lot ouvre : vitrine publique par slug →
panier anonyme (token) → checkout → paiement **MOCK** → confirmation, en
**RÉUTILISANT** les cœurs existants (zéro duplication). Calque EXACT du pattern
public booking (`/api/book/:slug/*` + `PublicBooking.tsx`) et funnel
(`/api/p/:slug` + `PublicFunnel.tsx`).

Architecture figée (NE PAS réinventer) :
- Migration seq **108** = STRICTEMENT ADDITIVE : `clients` n'avait NI `store_slug`
  NI slug boutique (vérifié : seul `products.slug` existe, + un catalogue public
  API-key-scopé `handlePublicListProducts` — PAS de slug niveau client). On AJOUTE
  `store_slug TEXT` + `store_settings_json TEXT` (défaut NULL) + 1 index. Zéro
  table/CHECK/FK/DROP/RENAME/rebuild. `ADD COLUMN` NULL sans contrainte = pas de
  rebuild SQLite.
- **CHECK e-commerce INTOUCHABLES** (rebuild INTERDIT) : `orders.status`,
  `orders.financial_status`, `orders.fulfillment_status`, `payments.status`. Le
  checkout public produit EXACTEMENT les statuts que `createOrderCore` produit
  DÉJÀ (`pending` / `unpaid` / `unfulfilled`) — **n'invente AUCUN statut**.
- **E4/E6 PAIEMENT INACTIF IMPÉRATIF** : `payment_provider_config.payments_live_enabled`
  défaut 0 ⇒ MOCK ; pas de credentials ⇒ MOCK. **ZÉRO stockage de carte**
  (PAN/CVV) — PCI/RGPD, revue légale (Rochdi) requise avant prod.
- Routes publiques = AUCUNE auth, **AUCUNE capability** (publiques par slug,
  bornage STRICT par `client_id` résolu du slug). **ZÉRO ajout à
  `ALL_CAPABILITIES`.** Settings PRO = capability EXISTANTE `settings.manage`
  (réutilisée — calque SMS/WhatsApp/IVR/OAuth).
- NE PAS casser / NE PAS modifier : `ecommerce-orders.ts` (`createOrderCore`
  contrat figé), `ecommerce-cart.ts`, `ecommerce-payments.ts`,
  `ecommerce-refunds.ts`, `ecommerce-cart-recovery.ts`, le wiring
  `order_created` / `order_paid` (déjà câblé DANS `createOrderCore` /
  `commitOrderSale` — marchera AUTOMATIQUEMENT). Réutilisés PAR IMPORT seulement.
- Alias : imports worker **RELATIFS** (`./worker/...`, `../lib/...`), JAMAIS `@/`.
  Front `@/`.

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` (`src/lib/types.ts`) **GELÉS**.
- Succès = **`json({ data })`** ; erreur = **`json({ error }, status)`**.
  **JAMAIS de champ `code`** — discrimination front string-match sur `error` /
  absence de `data` (calque `PublicBooking.tsx` / `PublicFunnel.tsx`).
- ⚠ Les helpers **STOREFRONT PUBLICS** utilisent **`fetch` BRUT** contre
  `${API_BASE}/...` (calque EXACT `getPublicFunnel` / `submitPublicFunnel` :
  retour normalisé `{ data } | { error }`, `t('api.unavailable')` sur exception).
  **JAMAIS `apiFetch`** (qui injecte le token ADMIN — fuite d'auth interdite sur
  des routes publiques). Le `cart_token` est passé EXPLICITEMENT (query/body),
  persisté front en `localStorage`. Les helpers **PRO** (`getStoreSettings` /
  `saveStoreSettings`) utilisent `apiFetch` (token admin, capability worker).

Helpers ADDITIFS posés Phase A dans `src/lib/api.ts` — **FIGÉS**, signatures
EXACTES (Phase C les CONSOMME tels quels, Phase B câble les corps des routes) :

```ts
// PUBLICS — fetch BRUT, sans auth (calque getPublicFunnel).
getStoreProducts(slug): ApiResponse<{ store: StoreSettings; products: StorefrontProduct[] }>
getStoreProduct(slug, pslug): ApiResponse<StorefrontProduct>
getStoreCart(slug, cartToken: string|null): ApiResponse<PublicCart>
addStoreCartItem(slug, cartToken: string|null, { product_id, variant_id?, qty }): ApiResponse<PublicCart>
updateStoreCartItem(slug, cartToken, itemId, qty): ApiResponse<PublicCart>
removeStoreCartItem(slug, cartToken, itemId): ApiResponse<PublicCart>
getStoreShippingQuote(slug, cartToken, address): ApiResponse<{ shipping_cents, shipping_name, tax_cents, subtotal_cents, total_cents, currency? }>
storeCheckout(slug, payload: CheckoutInput): ApiResponse<CheckoutResult>
getStoreOrder(slug, orderId): ApiResponse<CheckoutResult & { items?: [...] }>
// PRO — apiFetch (auth CRM, capability 'settings.manage' worker).
getStoreSettings(): ApiResponse<StoreSettings>
saveStoreSettings(payload: Partial<StoreSettings>): ApiResponse<StoreSettings>
```

### §6.B — Types (`src/lib/types.ts`, FIGÉS Phase A)

`StorefrontProduct` (id, slug, name, description, price_cents, currency?, image,
in_stock, variants?[{ variant_id, title, price_cents, in_stock }]) ·
`PublicCart` (token, items[{ id?, product_id?, variant_id?, name, price_cents,
qty }], subtotal_cents, currency?) · `StoreSettings` (slug, name, currency,
enabled) · `CheckoutInput` (email, name, phone?, address{ line1, line2?, city,
region?, postal_code?, country }, shipping_method?, coupon_code?, cart_token) ·
`CheckoutResult` (order_id, order_number, total_cents, status).
**Money TOUJOURS en cents (INTEGER).** Aucun type existant modifié.

### §6.C — Cœurs e-commerce RÉUTILISÉS PAR IMPORT (signatures RÉELLES, intouchables)

Manager-B câble les corps réels de `storefront-public.ts` en appelant ces cœurs
EXISTANTS **par import** (JAMAIS modifiés — calque booking-public.ts↔forms.ts) :

```ts
// ecommerce-orders.ts (l.186) — CONTRAT FIGÉ. Produit DÉJÀ
//   status='pending', financial_status='unpaid', fulfillment_status='unfulfilled'.
//   Devise persistée via resolveRegionContext (best-effort, fallback 'CAD').
//   Câble DÉJÀ autoEnrollForTrigger(env,'order_created',...) (wiring intact).
createOrderCore(
  env: Env,
  clientId: string,
  input: CreateOrderInput,   // { email, items:[{variant_id, quantity}], shipping_cents?,
                             //   discount_cents?, note?, source?, tax_region?, tax_country? }
  createdBy?: string,
): Promise<CreateOrderResult>  // { id, order_number, subtotal_cents, tps_cents, tvq_cents, total_cents }
//   ⚠ items = [{ variant_id, quantity }] (PAS product_id). customer_id OPTIONNEL
//     (guest = email sans customer_id). source = 'storefront'. tax_region/
//     tax_country PASSÉS depuis address (sinon défaut régime 'qc' = rétro-compat).

// ecommerce-shipping-zones.ts (l.513) — défensif, JAMAIS de throw.
resolveShippingRate(
  env: Env, clientId: string,
  opts: { country?: string|null; weight_grams?: number|null; subtotal_cents?: number|null; currency?: string|null },
): Promise<ShippingRateResult>  // { zone_id, rate_id, name, price_cents, matched }
//   matched=false ⇒ price_cents=0 (repli marchand). price_cents → shipping_cents.

// ecommerce-tax-engine.ts (l.186) — moteur fiscal unique. QC: TPS round(sub*0.05)
//   + TVQ round(sub*0.09975), arrondies séparément (régression-zéro bit-pour-bit).
computeTax(
  regime: TaxRegime,         // 'qc' | 'eu' | 'dz' | 'exempt'
  subtotalCents: number,
  opts?: { country?: string; taxInclusive?: boolean; lineItems?: { totalCents: number }[] },
): TaxResult                 // { lines, totalTaxCents, taxInclusive }
//   ⚠ Pour l'APERÇU shipping-quote uniquement. Au CHECKOUT, la taxe RÉELLE est
//     recalculée par createOrderCore (NE PAS la repasser en discount_cents).

// ecommerce-coupons.ts (l.118) — best-effort, JAMAIS de throw.
resolveCouponDiscount(
  env: Env, clientId: string, code: string, subtotalCents: number, currency?: string|null,
): Promise<{ valid: boolean; discount_cents: number; code?: string; reason?: string; couponId? string }>
//   discount_cents → discount_cents de createOrderCore. Au succès,
//   incrementCouponUsage(env, clientId, couponId) (best-effort, calque cart).
```

Logique **cart à porter en public** (calque `ecommerce-cart.ts` :
`findActiveCart` l.145 / `shapeCart` l.82 / `handleAddCartItem` /
`handleUpdateCartItem` / `handleDeleteCartItem`) MAIS **clientId via
`resolveStoreClientId(slug)`**, **SANS** `getClientModules(auth.userId)`. Tables
`carts` / `cart_items` réutilisées telles quelles (id DEFAULT SQL E1). Token =
`cart_<uuid>` si absent. Variante vérifiée ∈ tenant (borne `client_id`).

### §6.D — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

**PUBLIQUES (AVANT `requireAuth`)** — slug résolu côté handler, AUCUNE auth :
- `GET /api/store/:slug/products` → `handleStoreProducts(env, slug, url)`
- `GET /api/store/:slug/products/:pslug` → `handleStoreProduct(env, slug, pslug)`
- `GET /api/store/:slug/cart` → `handleStoreGetCart(env, slug, url)` (token via `?token=`)
- `POST /api/store/:slug/cart` → `handleStoreAddCartItem(request, env, slug)`
- `PATCH /api/store/:slug/cart/:itemId` → `handleStoreUpdateCartItem(request, env, slug, itemId)`
- `DELETE /api/store/:slug/cart/:itemId` → `handleStoreDeleteCartItem(env, slug, itemId, url)`
- `POST /api/store/:slug/shipping-quote` → `handleStoreShippingQuote(request, env, slug)`
- `POST /api/store/:slug/checkout` → `handleStoreCheckout(request, env, slug)`
- `GET /api/store/:slug/order/:id` → `handleStoreGetOrder(env, slug, id)`

Sous-routes SPÉCIFIQUES câblées AVANT les génériques (anti-shadowing :
`/products/:pslug` avant `/products`, `/cart/:itemId` avant `/cart`).

**PRO (PROTÉGÉES, capability `settings.manage` DANS le handler)** :
- `GET /api/store-settings` → `handleGetStoreSettings(env, auth)`
- `POST /api/store-settings` → `handleSaveStoreSettings(request, env, auth)`

### §6.E — Handlers (`src/worker/storefront-public.ts`, NEUF — owned Manager-B)

Helper de bornage tenant **FIGÉ Phase A** (le SEUL point d'entrée tenant public) :
```ts
resolveStoreClientId(env: Env, slug: string): Promise<string | null>
//   SELECT id FROM clients WHERE store_slug = ?. null ⇒ 404 (anti-fuite
//   cross-tenant). Manager-B vérifie aussi store_settings_json.enabled.
```
Stubs Phase A (signatures FIGÉES, corps réels Manager-B) :
`handleStoreProducts` · `handleStoreProduct` · `handleStoreGetCart` ·
`handleStoreAddCartItem` · `handleStoreUpdateCartItem` ·
`handleStoreDeleteCartItem` · `handleStoreShippingQuote` · `handleStoreCheckout`
· `handleStoreGetOrder` · `handleGetStoreSettings` · `handleSaveStoreSettings`.
Chaque route publique borne `resolveStoreClientId(slug)` (404 si null) AVANT
toute requête. `capGuard(auth)` = `requireCapability(auth.capabilities,
'settings.manage')` pour les 2 PRO.

### §6.F — Pages (`src/pages/PublicStore.tsx` / `PublicCheckout.tsx`, NEUVES — owned Manager-C)

Routes publiques `src/App.tsx` (FIGÉ Phase A) HORS `LazyGuard`/auth (calque EXACT
`publicBookingRoute` / `publicFunnelRoute`) :
- `/store/$slug` → `PublicStorePage` (export nommé FIGÉ) : vitrine + fiche produit
  + ajout panier.
- `/store/$slug/checkout` → `PublicCheckoutPage` (export nommé FIGÉ) : panier →
  adresse/livraison → récap taxes+frais → paiement MOCK → confirmation.

Modèle : `PublicBooking.tsx` (spinner loading, écran succès, discrimination
erreur = absence `data` / champ `error`, JAMAIS de `code`). i18n 100%
`t('store.*')` / `t('checkout.*')` (clés FIGÉES Phase A — AUCUNE création Phase
C). Panier persisté via token `localStorage`. `src/components/storefront/*`
(NEUF) si besoin. Le front n'invente JAMAIS prix/taxes/frais — tout vient du
backend.

### §6.G — Migration & manifest

`migration-storefront-seq108.sql` (racine) : `ADD COLUMN clients.store_slug` +
`ADD COLUMN clients.store_settings_json` + `CREATE INDEX IF NOT EXISTS
idx_clients_store_slug`. Entrée manifest seq 108 (`docs/migrations-manifest.json`,
depends_on seq 107, objects `["alter:clients","index:clients"]`, risk low).
⚠ `ADD COLUMN` non idempotent — jouer UNE SEULE FOIS.

### §6.H — Répartition DISJOINTE (zéro fichier partagé B/C)

- **Manager-B (backend)** owned : **`src/worker/storefront-public.ts` UNIQUEMENT**
  — corps réels. Cart public par token (logique calquée `ecommerce-cart.ts` MAIS
  `clientId = resolveStoreClientId(slug)`, SANS `getClientModules(auth.userId)`).
  Checkout = `createOrderCore` (guest via email, `source:'storefront'`,
  `tax_region`/`tax_country` passés depuis l'adresse), paiement **MOCK** (flag
  off — JAMAIS d'init paiement réel, ZÉRO carte). Réutilise
  `resolveShippingRate` / `computeTax` / `resolveCouponDiscount` /
  `incrementCouponUsage` par IMPORT (ne les modifie pas). Settings PRO
  (`store_slug` / `store_settings_json`). (Test optionnel
  `src/worker/__tests__/storefront-public.test.ts`.)
- **Manager-C (frontend)** owned : **`src/pages/PublicStore.tsx`** (NEUF, export
  `PublicStorePage`) ; **`src/pages/PublicCheckout.tsx`** (NEUF, export
  `PublicCheckoutPage`) ; **`src/components/storefront/*`** (NEUF). Panier
  persisté via token `localStorage`.
- **INTERDITS aux deux** : migration, manifest, `src/lib/types.ts`,
  `src/lib/api.ts`, `src/worker.ts`, `src/App.tsx`, i18n×4, `index.css`, et TOUS
  les `ecommerce-*.ts` existants (réutilisés par import seulement, JAMAIS
  modifiés). `storefront-public.ts` = Manager-B ; pages/components storefront =
  Manager-C. **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **CHECK orders/payments INTOUCHABLES** — checkout = `createOrderCore` →
   `pending`/`unpaid`/`unfulfilled`. N'invente AUCUN statut, n'ajoute AUCUN CHECK.
2. **Manifest seq 108 OBLIGATOIRE** — sinon le runner peut sauter la migration.
3. **FK INTERDITES** (rebuild SQLite) — liens `client_id` restent applicatifs.
4. **E4/E6 PAIEMENT MOCK IMPÉRATIF** — `payments_live_enabled=0` / pas de
   credentials ⇒ MOCK. JAMAIS d'init paiement réel sur la route publique.
5. **PCI — ZÉRO carte** (PAN/CVV) ne transite/stocke nulle part. Revue légale prod.
6. **Bornage STRICT `client_id` par slug** (anti-fuite cross-tenant) — TOUTE
   route publique borne `resolveStoreClientId(slug)` AVANT toute requête ; null ⇒
   404. Order/cart/produit toujours `WHERE client_id = <résolu>`.
7. **Ne PAS casser `createOrderCore` / cart / wiring `order_created`** — câblé DÉJÀ
   dans le cœur, marche automatiquement. Réutilisé par import, jamais modifié.
8. **Taxes région PASSÉES à `createOrderCore`** (`tax_region`/`tax_country` depuis
   l'adresse) — sinon défaut 'qc'. L'aperçu `shipping-quote` peut appeler
   `computeTax` directement, MAIS le checkout laisse `createOrderCore` recalculer
   (NE PAS double-compter la taxe dans `discount_cents`).
9. **Alias relatifs worker** (`./...`, `../lib/...`), front `@/`.
10. **Helpers publics = `fetch` BRUT** (calque `getPublicFunnel`), JAMAIS
    `apiFetch` (token admin). Helpers PRO = `apiFetch`.
