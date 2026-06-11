# LOT E-COMMERCE B2 ENRICHI — coupons/promos + abonnements produit + multi-devise + analytics

Sprint 4 (2026-05-19). Enrichit l'e-commerce B2 (déjà profond ~21k LOC) SANS
jamais activer de paiement réel (E4/E6 régulés `payments_live_enabled=0`
JAMAIS activés/touchés).

Phase A SOLO = ce document + tout le socle partagé FIGÉ (migration seq 85,
manifest, injection chirurgicale `createOrderCore`, routes worker.ts, stubs
handlers, helpers api.ts, i18n ×4, routes App.tsx, pages stubs). Phase B
(Manager-B coupons) ∥ Phase C (Manager-C abonnements) implémentent les corps
sur fichiers DISJOINTS (matrice §6.H).

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS

`apiFetch<T>` (src/lib/api.ts:62) et `ApiResponse<T>` (src/lib/types.ts:510 =
`{ data?: T; error?: string; success?: boolean }`) sont **INCHANGÉS**. JAMAIS
de champ `code` : la discrimination d'erreur est un **string-match** sur
`error`. Tous les helpers ajoutés sont ADDITIFS (bloc « Sprint 4 — Coupons/
promos + Abonnements produit » de api.ts, append-only, AVANT `// ── Leads`) :

- `getEcommerceCoupons` / `getEcommerceCoupon` / `createEcommerceCoupon` /
  `updateEcommerceCoupon` / `deleteEcommerceCoupon` / `validateCoupon`
- `getEcommerceSubscriptions` / `getEcommerceSubscription` /
  `createEcommerceSubscription` / `updateEcommerceSubscription` /
  `deleteEcommerceSubscription` / `runDueSubscriptions`
- types figés : `Coupon`, `CouponInput`, `CouponValidation`,
  `ProductSubscription`, `ProductSubscriptionInput`

Phase B/C consomment ces signatures TELLES QUELLES (ne les modifient pas).

### §6.B — DDL seq 85 (`migration-promo-seq85.sql`)

`depends_on: migration-booking-seq84.sql` (seq 84 = dernière du manifest ;
chaînage SÉQUENTIEL, aucune dépendance de schéma réelle). Entrée manifest
`{ "seq": 85, "file": "migration-promo-seq85.sql", "depends_on":
["migration-booking-seq84.sql"], "objects": ["alter:coupons",
"table:product_subscriptions"], "risk": "low" }`.

**`coupons` (table EXISTE seq 18, `migration_p3_8.sql:16-23`) — ALTER ADDITIF
uniquement.** Schéma legacy réel : `id TEXT PK` (PAS randomblob — PK
applicative), `client_id TEXT NOT NULL`, `code TEXT NOT NULL`,
`discount_amount REAL`, `discount_percent REAL`, `created_at DATETIME`.
Colonnes ajoutées (toutes nullable / DEFAULT) :

| Colonne | Type / défaut |
|---|---|
| `discount_type` | `TEXT DEFAULT 'percent'` |
| `min_order_cents` | `INTEGER DEFAULT 0` |
| `starts_at` | `TEXT` |
| `expires_at` | `TEXT` |
| `usage_limit` | `INTEGER` |
| `times_used` | `INTEGER DEFAULT 0` |
| `is_active` | `INTEGER DEFAULT 1` |
| `currency` | `TEXT` |
| `agency_id` | `TEXT` |

+ `CREATE INDEX IF NOT EXISTS idx_coupons_client_code ON coupons(client_id,
code)`. **Colonnes LEGACY `discount_amount` / `discount_percent`
CONSERVÉES** : la résolution code→montant Phase B les lit (un coupon
`percent` utilise `discount_percent` ; un coupon `fixed` un montant en cents).

**`product_subscriptions` (table NEUVE)** — `CREATE TABLE IF NOT EXISTS`,
id `lower(hex(randomblob(16)))`, timestamps `datetime('now')`. Colonnes :
`client_id, agency_id, customer_id, variant_id, quantity (DEFAULT 1),
interval_unit (DEFAULT 'month'), interval_count (DEFAULT 1),
unit_price_cents (DEFAULT 0), currency (DEFAULT 'CAD'), status (DEFAULT
'active' — SANS CHECK), next_run_at, last_run_at, cycles_completed
(DEFAULT 0), created_at, updated_at`. Index `(client_id)` + `(status,
next_run_at)`. **AUCUNE colonne paiement.**

ZÉRO FK, ZÉRO DROP/RENAME, ZÉRO modif de CHECK existant, AUCUN touch
`users`/`clients`/tables E4-E6. `status` SANS CHECK (énum gardée
applicativement → pas de rebuild si l'énum évolue). En-tête recopie verbatim
les avertissements + tolérance duplicate-column de
`migration-booking-seq84.sql`.

### §6.C — Contrat calcul total checkout (CONTRAT CLÉ — régression-zéro QC)

`createOrderCore` (`src/worker/ecommerce-orders.ts:186`) : **signature
INCHANGÉE** `(env, clientId, input: CreateOrderInput, createdBy?)`. Ordre de
calcul du total **BYTE-IDENTIQUE** (lignes 289-294, INTOUCHÉES) :

```
subtotal = Σ (unitPrice effectif × quantity)        [résolu, snapshots figés]
discount = max(0, round(input.discount_cents))      [résolu EN AMONT, l.199-201]
taxe     = computeTax(regime, subtotal, {country})  [moteur unique, séparé]
total    = max(0,
             tax.taxInclusive  ? subtotal + shipping - discount
                               : subtotal + tax.totalTaxCents + shipping - discount)
```

Les **promos se résolvent EN AMONT** (handler `validateCoupon` /
`ecommerce-cart.ts handleConvertCart` Phase B) et passent `discount_cents` au
contrat `CreateOrderInput` **EXISTANT** (champ déjà présent l.136, déjà
appliqué l.199-201, déjà persisté l.330). createOrderCore n'a **AUCUNE
connaissance des coupons**.

**SEULE addition Phase A** à createOrderCore : persistance de
`orders.currency`. Avant : l'INSERT n'écrivait pas `currency` (restait DEFAULT
'CAD' colonne seq 58). Maintenant, AVANT l'`INSERT INTO orders` (l.320), on
résout `resolveRegionContext(env, clientId)` (**signature réelle vérifiée :
`ecommerce-region.ts:204` → `Promise<RegionContext>` =
`{region,country,currency,tax_regime,tax_inclusive_default}`, currency ∈
`CAD|EUR|DZD`**) et on ajoute `currency` (sa valeur, **fallback `'CAD'`** sur
tout échec) à la liste de colonnes/binds de l'INSERT. La devise **n'entre dans
AUCUN calcul** (subtotal/discount/taxe/shipping/total inchangés bit-pour-bit).
AUCUN taux de change, JAMAIS sommé multi-devise. Tout tenant pré-existant
(région NULL → résolveur retourne défaut QC `'CAD'`) garde un comportement
strictement identique = **régression-zéro Québec**.

Modif exacte : ajout d'un bloc `let orderCurrency = 'CAD'; try { … } catch {}`
+ `currency` ajouté dans la liste de colonnes de l'INSERT (`…,
tax_breakdown_json, currency, placed_at`), un `?` supplémentaire, et
`orderCurrency` ajouté aux binds. Aucune autre ligne touchée.

### §6.D — Handlers / endpoints / bornage / gating

**Gating (RÉUTILISÉ, ZÉRO ajout)** : toutes les routes héritent du bloc
`if (path.startsWith('/api/ecommerce/'))` (worker.ts ~:1528) qui appelle
`requireModule(env, auth.userId, 'ecommerce')` AVANT tout handler.
**AUCUNE capability** : la liste `ALL_CAPABILITIES` (`capabilities.ts:36-49`,
12 entrées) est **FIGÉE — zéro ajout**. Mutations = garde
`auth.role !== 'admin'` DANS le handler (calque `handleUpdateRegion`
`ecommerce-region.ts:254`). Bornage tenant systématique
`WHERE client_id = ?`, clientId résolu via `getClientModules(env,
auth.userId)` (calque `ecommerce-orders.ts:76`).

Routes câblées Phase A (worker.ts, dans le bloc ecommerce, AVANT sa
fermeture `}` ~:1999, routes SPÉCIFIQUES avant génériques) :

| Méthode + path | Handler (stub Phase A) |
|---|---|
| `POST /api/ecommerce/coupons/validate` | `ecommerce-coupons.handleValidateCoupon` |
| `GET  /api/ecommerce/coupons` | `handleListCoupons` |
| `POST /api/ecommerce/coupons` | `handleCreateCoupon` (admin) |
| `GET  /api/ecommerce/coupons/:id` | `handleGetCoupon` |
| `PATCH /api/ecommerce/coupons/:id` | `handleUpdateCoupon` (admin) |
| `DELETE /api/ecommerce/coupons/:id` | `handleDeleteCoupon` (admin) |
| `POST /api/ecommerce/subscriptions/run-due` | `ecommerce-subscriptions.handleRunDueSubscriptions` (admin) |
| `GET  /api/ecommerce/subscriptions` | `handleListSubscriptions` |
| `POST /api/ecommerce/subscriptions` | `handleCreateSubscription` (admin) |
| `GET  /api/ecommerce/subscriptions/:id` | `handleGetSubscription` |
| `PATCH /api/ecommerce/subscriptions/:id` | `handleUpdateSubscription` (admin) |
| `DELETE /api/ecommerce/subscriptions/:id` | `handleDeleteSubscription` (admin) |

`/coupons/validate` **PAS de garde role admin** (calque cart, accessible aux
non-admins — la validation d'un code est consommée au checkout). Stubs Phase
A : retours `{ data }` / `{ error }` bien formés, balisés
`// STUB PHASE A → corps réel Phase B` (coupons) / `Phase C` (abonnements).
Phase B/C remplissent le corps SANS toucher les signatures ni worker.ts.

### §6.E — Abonnements = modèle / cycle via createOrderCore COD/mock

Un abonnement (`product_subscriptions` seq 85) = une variante commandée à
intervalle régulier. **Cycle Phase C** (`handleRunDueSubscriptions`) : pour
chaque abonnement échu (`status='active' AND next_run_at <= now`, borné
`client_id`), appeler `createOrderCore(env, clientId, { customer_id,
email, items:[{variant_id, quantity}], source:'subscription' }, by)` —
commande **COD/mock** : createOrderCore réserve le stock, calcule TPS/TVQ,
génère le numéro (comportement E3 strict). Puis avancer `next_run_at` (selon
`interval_unit`/`interval_count`), `last_run_at`, `cycles_completed`.

**JAMAIS** : lecture `payments_live_enabled`, touch tables E4/E6 (`payments`,
`payment_events`, `payment_provider_config`, `refunds`, `disputes`,
`return_requests`), settlement, FX. L'abonnement ne « prélève » rien : il
génère une commande au statut `pending`/`unpaid` que l'opérateur traite
manuellement (lifecycle E3 existant). **E4 INTACT.**

### §6.F — Multi-devise = stockage / affichage SANS settlement ni FX

`orders.currency` est désormais persisté (§6.C) via le résolveur EXISTANT.
`coupons.currency` / `product_subscriptions.currency` stockent la devise
indicative. **AUCUN taux de change**, **JAMAIS de somme multi-devise** (cf.
garde-fou historique `ecommerce-analytics.ts:10-14`). L'UI affiche la devise
de chaque entité telle quelle (`formatMoneyCents` + locale). Aucun calcul ne
convertit ni n'agrège entre devises. Tenant sans région configurée →
fallback `'CAD'` = comportement actuel.

### §6.G — Analytics ventes = extension additive, lecture seule

Toute extension analytics (Phase C, fichier `ecommerce-analytics.ts` =
**propriété Manager-C**) est **additive, lecture seule, zéro chiffre
fabriqué** : agrégats issus EXCLUSIVEMENT de données réelles
(commandes/abonnements/coupons existants). Respect strict du garde-fou
`ecommerce-analytics.ts:10-14` (jamais sommer multi-devise — ventilation par
devise si besoin). N'altère AUCUN endpoint analytics existant ; ajoute au
plus des champs/handlers additifs. Aucun faux KPI : EmptyState honnête si
zéro donnée.

### §6.H — Matrice de propriété Phase B/C (disjonction STRICTE)

| Fichier | Propriétaire | Règle |
|---|---|---|
| `src/worker/ecommerce-coupons.ts` (corps) | **Manager-B** | corps réel des stubs |
| `src/pages/boutique/Coupons.tsx` (corps) | **Manager-B** | corps réel du stub lazy |
| `src/worker/ecommerce-cart.ts` (`handleConvertCart` modif ciblée) | **Manager-B SEUL** | branche résolution coupon → `discount_cents` l.417 ; AUCUN autre agent n'y touche |
| `src/worker/ecommerce-subscriptions.ts` (corps) | **Manager-C** | corps réel des stubs |
| `src/pages/boutique/Abonnements.tsx` (corps) | **Manager-C** | corps réel du stub lazy |
| `src/worker/ecommerce-analytics.ts` (extension) | **Manager-C** | extension additive lecture seule (§6.G) |
| `src/worker/ecommerce-orders.ts` | **Phase A EXCLUSIF** | **INTERDIT à B ET C** (createOrderCore figé §6.C) |
| `src/worker.ts` · `src/lib/api.ts` · `src/App.tsx` · `src/lib/i18n/*` · `docs/migrations-manifest.json` · `migration-promo-seq85.sql` · `docs/LOT-ECOM4.md` | **Phase A — GELÉS** | B/C ne les modifient PAS |
| Les 6 pages « R » (Leads/LeadDetail/Pipeline/Tasks/Inbox/Calendar refaites) | — | **INTERDITES** hors scope |

Disjonction stricte : Manager-B et Manager-C n'ont **aucun fichier en
commun**. `ecommerce-cart.ts` = Manager-B SEUL (Manager-C n'y touche jamais).
`ecommerce-orders.ts` = verrouillé Phase A (le contrat createOrderCore est
figé ; B passe par `discount_cents`, C passe par appel createOrderCore sans
le modifier).

### §6.I — Garde-fous + suites à ne pas régresser

Garde-fous DURS : strictement ADDITIF ; createOrderCore signature gelée +
calcul total byte-identique (SEULE modif = persist `currency`) ; zéro
FK/DROP/modif-CHECK ; aucun touch `users`/CHECK seq 59 ; **E4/E6 régulés
JAMAIS activés/touchés** (abonnements = COD/mock via createOrderCore) ; AUCUN
taux de change, JAMAIS sommé multi-devise ; ZÉRO ajout à `ALL_CAPABILITIES` ;
`apiFetch`/`ApiResponse` GELÉS (jamais `code`) ; i18n parité STRICTE ×4.

Suites à NE PAS régresser (Phase B/C build côté hôte Antigravity) :
`ecommerce-multitenant.*` (isolation tenant), `ecommerce-tax-engine.test.ts`
(TPS/TVQ QC bit-pour-bit), `ecommerce-payments-sandbox.test.ts`,
`ecommerce-refunds-sandbox.test.ts` (E4/E6 régulés inoffensifs tant que
`payments_live_enabled=0`). Le calcul total checkout (§6.C) DOIT rester
byte-identique pour le régime QC sur toute commande sans coupon (= comportement
E3 strict).

---

## État Phase A (livré 2026-05-19)

CODE-COMPLETE (PAS de build/test — VM VMware sans bun/node ; Antigravity
buildera côté hôte).

**Fichiers créés :**
- `migration-promo-seq85.sql` (ALTER coupons additif ×9 + index ; table
  `product_subscriptions` + 2 index)
- `src/worker/ecommerce-coupons.ts` (6 stubs : List/Create/Get/Update/Delete
  + Validate)
- `src/worker/ecommerce-subscriptions.ts` (6 stubs : List/Create/Get/Update/
  Delete + RunDue)
- `src/pages/boutique/Coupons.tsx` (stub lazy `CouponsPage`)
- `src/pages/boutique/Abonnements.tsx` (stub lazy `AbonnementsPage`)
- `docs/LOT-ECOM4.md` (ce fichier — §6 A→I)

**Fichiers modifiés (additif) :**
- `docs/migrations-manifest.json` (entrée seq 85)
- `src/worker/ecommerce-orders.ts` (injection chirurgicale `currency` à
  l'INSERT — signature + calcul total INCHANGÉS, fallback `'CAD'`)
- `src/worker.ts` (12 routes câblées dans le bloc ecommerce, avant `}`)
- `src/lib/api.ts` (bloc helpers + types Coupons/Subscriptions, append-only)
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (53 clés `ecommerce.*` chacun —
  parité stricte ×4)
- `src/App.tsx` (2 lazy imports + 2 routes + addChildren)

Phase B (Manager-B coupons) ∥ Phase C (Manager-C abonnements + analytics)
peuvent démarrer sur fichiers DISJOINTS (matrice §6.H).
