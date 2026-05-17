# Couverture de tests — Module Boutique (e-commerce)

> Sprint **S5** (Lot 2 renforcement plateforme). Tests **écrits, NON exécutés**
> sur la VM (VMware Shared Folder — pas de bun/node). Exécution réelle +
> validation `vitest run` : **Rochdi via Antigravity**.
>
> Sections : **M1** (ce doc, cœur transactionnel) — **M2** (payments/refunds
> sandbox) et **M3** (channel-sync / inventory-cart-returns) amenderont leurs
> propres sections ci-dessous.

---

## ⚠️ Limite structurelle du mock D1 (`_helpers.ts`, figé S2)

Le mock D1 (`createMockD1`) est volontairement minimal et **ne simule PAS** :

- contraintes **UNIQUE** / **FOREIGN KEY** ;
- `INSERT OR IGNORE` (toujours traité comme un INSERT réussi) ;
- `meta.changes` réel — **`.run()` renvoie toujours `{ changes: 1 }`** ;
- la **persistance d'état** entre requêtes (ex. `inventory.reserved`
  incrémenté par `reserveStock` n'est PAS relu par l'appel suivant — la
  résolution se fait par **sous-chaîne SQL, 1er-match**, sur les `seed()`).

**Conséquence** : l'**idempotence garantie par la DB** (clé d'idempotence
unique paiement/refund, compteur de numéro de commande concurrent-safe,
double-`commitSale` bloqué par `paid_at IS NULL` dans le `WHERE`) **n'est pas
prouvable en test unitaire ici**.

**Ce qu'on prouve à la place** : la **logique applicative défensive** — *le
code relit-il l'état existant (`paid_at`, `cancelled_at`, lookup
`idempotency_key`) AVANT d'agir, et saute-t-il l'effet de bord si déjà
concrétisé ?* On matérialise l'état « déjà présent » via les fixtures
(`seedOrderState` avec `paidAt`/`cancelledAt` non nuls) et on vérifie l'absence
de l'effet de bord (`commitSale` / `releaseStock`) dans `db.calls`.

**Garde-fou** : un **run d'intégration réel** (D1 réel, contraintes actives)
reste **requis** pour valider l'idempotence niveau DB et la sécurité
concurrentielle. À planifier Lot 3 / pré-prod par Rochdi.

> Rappel scope S5 : **E4/E6 testés en SANDBOX uniquement**, ne JAMAIS poser
> `payments_live_enabled=1`.

---

## Fixtures partagées — `__tests__/_ecommerce-fixtures.ts` (M1, signature FIGÉE)

API consommée par M2/M3 (ne pas dévier) :

| Helper | Sous-chaîne SQL réelle ciblée (relevée VERBATIM en prod) |
|---|---|
| `ecomEnv(db)` | — (env minimal `{ DB }`) |
| `seedTenant(db, clientId?)` | `from users where id` + `modules_json from clients` (`modules.ts` getClientModules) |
| `seedVariant(db, {...})` | `from product_variants v` + `from inventory where variant_id` |
| `seedOrder(db, {...})` | `from orders where id` |
| `seedPayment(db, {...})` | `from payments where` (`ecommerce-payments.ts`) |
| `seedRefund(db, {...})` | `from refunds where` (`ecommerce-refunds.ts`) |
| `seedOrderState` (additif) | `from orders where id` (état idempotence : paid_at/cancelled_at) |
| `seedOrderItems` (additif) | `from order_items where order_id` |

`createOrderCore` reçoit `clientId` en **argument** → `seedTenant` n'est requis
que pour les **wrappers HTTP** (`handleCreateOrder`, `handleUpdateOrderStatus`)
qui appellent `resolveClientId`.

---

## ✅ Couvert S5 — M1 (cœur transactionnel)

### `ecommerce-tax-engine.ts` — `computeTax` (pur, zéro I/O)

- **QC** : TPS 5 % + TVQ 9,975 % arrondies **séparément** (jamais en cascade).
  Vecteur de 7 sous-totaux ; cas-clé `10000¢ → TPS 500 / TVQ 998 / total 1498` ;
  non-cascade `333¢ → 17 / 33` ; bornage négatif/NaN → 0.
- **EU** : tax-**inclusive** par défaut `round(sub − sub/(1+rate))` ; override
  `taxInclusive=false` ; table pays (FR/DE/LU/HU/SE/FI…) ; pays inconnu/absent
  → défaut **20 %**, label `TVA (UE)`.
- **DZ** : TVA 19 % exclusive, **TAP désactivé** (1 seule ligne).
- **exempt** : 0 taxe, `lines: []`.
- **Régime inconnu** : `default → computeExempt()` (sécurité défensive
  documentée prod ~:205 — jamais de taxe fantôme).

### `ecommerce-orders.ts` — `createOrderCore` (création)

- Calculs QC exacts au cent : `subtotal / tps / tvq / total` =
  `sub + total_tax + shipping − discount` (exclusive).
- `price_override ?? base_price` (override **0** prime — code teste `!= null`).
- Snapshots figés écrits dans `order_items` (product/variant/sku) +
  `INSERT INTO orders`.
- Erreurs : commande vide → **400** ; article invalide → **400** ; variante
  absente → **404** ; stock insuffisant → **409** + non-écriture de la
  commande (échec avant `INSERT INTO orders`).

### `ecommerce-orders.ts` — `handleUpdateOrderStatus` (machine à états)

- Transitions valides : `pending→paid` (commitSale + `paid_at`),
  `paid→cancelled` (releaseStock + `cancelled_at`), `delivered→refunded`.
- **Gardes applicatives idempotentes** : `paid_at` déjà posé ⇒ pas de
  re-`commitSale` ; `cancelled_at` déjà posé ⇒ pas de re-`releaseStock`
  (prouve la logique `if (... && !order.paid_at)`, **pas** l'idempotence DB).
- Transitions invalides : `current === next` → **409** « Aucun changement » ;
  transition non permise → **409** « Transition invalide » (message FR) ;
  état terminal (`cancelled`) → **409** « état terminal » ;
  commande introuvable → **404**.

| Module | Statut S5 |
|---|---|
| `ecommerce-tax-engine.ts` | ✅ couvert (M1) |
| `ecommerce-orders.ts` (createOrderCore + machine à états) | ✅ couvert (M1) |
| `modules.ts` (getClientModules, via fixtures) | ◑ indirect (fixtures) |

---

## ✅ Couvert S5 — M2 (payments / refunds sandbox)

### `ecommerce-payments.ts` (SANDBOX)

- `resolvePaymentProvider` : DZD→`dz_gateway`, CAD/EUR→`stripe`, config `cod`, COD injecté universel.
- **Garde-fou sandbox prouvé sur 4 cas** : config absente / `payments_live_enabled=0` explicite / `mode='live'` mais flag=0 → reste **test** / flag NULL → test. `live=1` jamais posé.
- `handleInitPayment` : idempotence applicative (paiement existant non-`failed` relu → renvoyé, **0 INSERT payments**) ; COD→`pending_cod` jamais payé ; 409 payée / 409 annulée / 404 introuvable / 400 hors capabilities / 503 provider absent ; stub stripe assert `mode=test`.
- `recordPaymentTransition` : `paid`→commit, **garde `!paid_at`** (paid_at présent → no-op), `pending_cod`/`failed`→pas de commit, pas de ligne→`committed=false` sans UPDATE.
- `handlePaymentWebhook` : provider inconnu 404, non branché 200 ignored, null 200 ignored, exception 400, nominal → `INSERT payment_events` avant le pont (dédup applicative).

### `ecommerce-refunds.ts` (SANDBOX)

- `handleCreateRefund` : anti double-refund (refund existant clé → renvoyé, **provider.refund jamais rappelé, 0 INSERT refunds**) ; garde montant `engaged+requested>paid`→409 ; 422 provider sans `refund?` ; restock garde `restocked=1`→pas de re-UPDATE ; COD no-op `cod:offline` succeeded ; 404 commande/paiement.
- `recordRefundTransition` : somme 0 / partially / refunded / **rejeu déterministe = même résultat** / commande absente unpaid.
- Garde-fou transverse `payments_live_enabled=0` + `mode=test` asserté dans les 2 suites. **Jamais live=1.**

| Module | Statut S5 |
|---|---|
| `ecommerce-payments.ts` (resolveProvider + initPayment + transition + webhook, sandbox) | ✅ couvert (M2) |
| `ecommerce-refunds.ts` (createRefund + recordRefundTransition, sandbox) | ✅ couvert (M2) |
| `payments/cod-provider.ts` | ◑ indirect (via flux COD) |

---

## ✅ Couvert S5 — M3 (channel-sync / inventory / cart / returns)

### `ecommerce-channel-sync.ts`

- `ingestProductEvent` : map déjà présent → UPDATE prix/stock + **0 ré-INSERT** produit/variant/map ; map sans quantité → pas d'UPDATE inventory ; map absent → INSERT complet ; `external_id` produit manquant → conflict+log.
- `ingestOrderEvent` : commande dup (`orders.external_id` seedé) → **`createOrderCore` non rappelé (0 INSERT orders)** ; external_id manquant → conflict ; lignes non mappées → conflict sans createOrderCore ; attribution `source = channel.type`.
- `syncProductOut` : anti-echo (event entrant récent → **pushFn JAMAIS appelé** + log skipped + pas de maj `last_synced_at`) ; push OK → `last_synced_at` ; push throw → pas de crash, error loggée ; variant non mappé → pushed false.

### `ecommerce-inventory.ts` / `ecommerce-cart.ts` / `ecommerce-returns.ts`

- Séquence NOUVELLE (non-dupliquée S2) `reserveStock`(reserved+, mvt `reservation`)→`commitSale`(quantity−, reserved−, mvt `sale`)→`releaseStock`(reserved−, mvt `return`, borné ≥0) + insufficient.
- Garde multi-tenant S2 cas **nouveaux** (commit/release) : clientId mismatch → `tenant_mismatch` sans écriture / propriétaire passe / absent → rétro-compat OK.
- `handleConvertCart` : succès→201 `converted` / introuvable→404 / déjà converti→409 / vide→400 / sans email→400.
- `handleCreateReturn` : valide→201 `pending` **sans refund** (anti-abus vérifié) / introuvable→404 / vide→400 / hors commande→404 / non livré→409.

| Module | Statut S5 |
|---|---|
| `ecommerce-channel-sync.ts` (ingestProduct/ingestOrder/syncOut) | ✅ couvert (M3) |
| `ecommerce-inventory.ts` (séquence reserve/commit/release + garde S2 nouveaux cas) | ✅ couvert (M3) |
| `ecommerce-cart.ts` (`handleConvertCart`) | ✅ couvert (M3) |
| `ecommerce-returns.ts` (`handleCreateReturn`) | ✅ couvert (M3) |

---

## ⏳ Backlog NON couvert → Lot 3

Modules `ecommerce-*` / connexes sans couverture S5 (≈ 22) — run intégration
réel D1 recommandé en complément :

| Module | Domaine |
|---|---|
| `ecommerce-disputes.ts` | Litiges / chargebacks |
| `ecommerce-shipments.ts` | Expéditions / fulfillment |
| `ecommerce-shipping-zones.ts` | Zones & tarifs livraison |
| `ecommerce-region.ts` | Mapping région → régime fiscal |
| `ecommerce-analytics.ts` | Analytics boutique |
| `ecommerce-rfm.ts` | Segmentation RFM |
| `ecommerce-customer-metrics.ts` | LTV / agrégats client |
| `ecommerce-reco.ts` | Reco produits (panier croisé) |
| `ecommerce-import.ts` | Import catalogue / commandes |
| `ecommerce-invoice.ts` | Génération factures |
| `ecommerce-cart-recovery.ts` | Relance panier abandonné |
| `ecommerce-products.ts` | CRUD produits / variantes |
| `ecommerce-channel-shopify.ts` | Connecteur Shopify (HTTP) |
| `ecommerce-channel-woo.ts` | Connecteur WooCommerce (HTTP) |
| `ecommerce-inventory-strategy.ts` | Stratégies de stock |
| `ecommerce-consumer-policy.ts` | Politiques conso (Loi 25 / retours) |
| `ecommerce-orders.ts` (list/get enrichis) | Pagination / réconciliation client |
| `ecommerce-inventory.ts` (adjust / shape / low-stock) | Hors helpers stock testés indirectement S5 |
| `ecommerce-cart.ts` | Panier (hors conversion testée M3) |
| `ecommerce-returns.ts` | Retours (hors flux testé M3) |
| `ecommerce-payments.ts` (live / disputes bridge) | Hors sandbox M2 |
| `ecommerce-refunds.ts` (live) | Hors sandbox M2 |

> Connecteurs Shopify/Woo : tests HTTP nécessitent un mock `fetch` (hors mock
> D1) — à cadrer Lot 3.

---

## Récap

| Bloc | Fichiers | État |
|---|---|---|
| Fixtures | `_ecommerce-fixtures.ts` | ✅ M1 (signature figée) |
| Tax engine | `ecommerce-tax-engine.test.ts` | ✅ M1 |
| Orders (création + états) | `ecommerce-orders.test.ts` | ✅ M1 |
| Payments/Refunds sandbox | `ecommerce-payments-sandbox.test.ts` / `ecommerce-refunds-sandbox.test.ts` | ✅ M2 |
| Channel-sync / inv / cart / returns | `ecommerce-channel-sync.test.ts` / `ecommerce-inventory-cart-returns.test.ts` | ✅ M3 |
| ~22 modules restants | — | ⏳ Lot 3 |

**0 modification de code de prod.** Tests déterministes (aucun `Date.now` /
`random` non contrôlé exploité dans les assertions ; `datetime('now')` côté SQL
n'est jamais évalué par le mock). Exécution `vitest` à faire par Rochdi.
