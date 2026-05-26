# LOT Multi-currency + Tax engine multi-région — Sprint 39

> Doc contrat §6 figé. Migration : seq134 — `migration-multicurrency-tax-seq134.sql`.
> Compagnons : `LOT-GIFTCARDS-LOYALTY-S38.md` (calque structure §6 + pattern handler
> stubs Phase A), `LOT-TEAM-BC.md` (capabilities figées seq80 — réutilisation
> `settings.manage`), `ecommerce-tax-engine.ts` (moteur LEGACY 'qc'/'eu'/'dz'/
> 'exempt' — RÉGRESSION-ZÉRO absolue).

## §1 Contexte

Le moteur fiscal `ecommerce-tax-engine.ts` (régimes 'qc'/'eu'/'dz'/'exempt')
**EXISTE DÉJÀ** (Sprint E-R M1, verbatim TPS 0.05 + TVQ 0.09975 — rétro-compat
totale Québec). La couche région tenant (`clients.region/country/default_currency/
tax_regime/legal_flags_json` + `orders.tax_region/tax_breakdown_json`) **EXISTE
AUSSI** (Sprint E-R M2). Sprint 39 AJOUTE deux couches NEUVES au-dessus :

1. **Multi-currency** : cache `currency_rates` (fetch ECB Frankfurter API +
   override manuel admin) + colonnes audit `orders.currency_rate_used` +
   `orders.currency_base` (montant total dans la devise pivot tenant). Devises
   supportées étendues : CAD/EUR/DZD (existant) + USD + MAD (neufs).
2. **Tax engine multi-région** : régimes admin-managed via `tax_regions` (code,
   country, type ∈ {vat|gst_pst|sales_tax|tva_dz|exempt}, rates_json,
   tax_inclusive) + règles par catégorie produit via `tax_rules` (rate, compound,
   applies_from). Nouveau régime fiscal `us_sales_tax` (state + county + city
   aggregation) implémenté Phase B. Catégorie produit ajoutée :
   `products.tax_category` (DEFAULT 'standard' — régression-zéro).

**Régression-zéro QC/EU/DZ garantie** : `tax-engine-multi.ts` DÉLÈGUE à
`computeTax()` legacy pour tout régime existant. Pour tout `subtotalCents` en
régime 'qc', la sortie reste IDENTIQUE bit-pour-bit à l'ancien code (verbatim
TPS 5% + TVQ 9.975%, chacune arrondie séparément). Aucun touch de
`ecommerce-tax-engine.ts`, `ecommerce-orders.ts`, `ecommerce-payments.ts`,
`ecommerce-region.ts`, `ecommerce-invoice.ts`.

## §2 Migration — seq134 (DDL résumé)

Fichier racine : `migration-multicurrency-tax-seq134.sql`. Manifest entrée
seq134, `depends_on: ["migration-giftcards-loyalty-seq133.sql",
"migration-sprintER-m1.sql"]` (chaînage strict).

100 % ADDITIF, zéro CHECK / FK destructrice / DROP / RENAME :

- `CREATE TABLE IF NOT EXISTS currency_rates` : id PK, base_currency TEXT,
  quote_currency TEXT, rate REAL DEFAULT 1, source TEXT DEFAULT 'ecb'
  (enum HANDLER `ecb|frankfurter|manual`), fetched_at DEFAULT `datetime('now')`,
  created_at.
- `CREATE TABLE IF NOT EXISTS tax_regions` : id PK, client_id NOT NULL,
  code TEXT NOT NULL, name TEXT, country TEXT NOT NULL, country_subdiv TEXT
  NULL, type TEXT DEFAULT 'exempt' (enum HANDLER `vat|gst_pst|sales_tax|tva_dz|
  exempt`), rates_json TEXT DEFAULT `'{}'`, tax_inclusive INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1, created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS tax_rules` : id PK, region_id NOT NULL (FK
  APPLICATIVE vers `tax_regions.id` ON DELETE CASCADE — gérée côté handler),
  product_category TEXT DEFAULT 'standard', rate REAL DEFAULT 0, compound
  INTEGER DEFAULT 0, applies_from TEXT DEFAULT `datetime('now')`, created_at.
- `ALTER TABLE products ADD COLUMN tax_category TEXT DEFAULT 'standard'`
  (régression-zéro : tout produit pré-existant = 'standard').
- `ALTER TABLE orders ADD COLUMN currency_rate_used REAL` (audit taux change
  appliqué — NULL = mono-devise legacy CAD).
- `ALTER TABLE orders ADD COLUMN currency_base REAL` (montant total dans la
  devise pivot tenant — NULL = mono-devise legacy).

**6 indexes** :
- `idx_currency_rates_pair` (base_currency, quote_currency, fetched_at),
  `idx_currency_rates_fetched` (fetched_at).
- `idx_tax_regions_client` (client_id),
  `idx_tax_regions_code` (client_id, code).
- `idx_tax_rules_region` (region_id),
  `idx_tax_rules_category` (region_id, product_category).

Validation enums (`type` régions, `source` rates, currencies ∈ CAD|USD|EUR|
DZD|MAD) SIDE-HANDLER (`currencies.ts` / `tax-regions.ts` / `lib/currency-
converter.ts` / `lib/tax-engine-multi.ts`) — calque LOT-GIFTCARDS-LOYALTY-S38 §6
(pas de CHECK = pas de rebuild SQLite jamais).

## §3 Routes (12 AUTHED, ordre anti-shadowing strict)

### AUTHED — Currencies (4 routes, statiques uniquement)

| Méthode | Chemin                                          | Handler                | Capability         | Fichier         |
|--------:|-------------------------------------------------|------------------------|--------------------|-----------------|
| GET     | `/api/currencies`                               | `handleListCurrencies` | `settings.manage`  | currencies.ts   |
| GET     | `/api/currencies/rates`                         | `handleListRates`      | `settings.manage`  | currencies.ts   |
| POST    | `/api/currencies/rates/refresh`                 | `handleRefreshRates`   | `settings.manage`  | currencies.ts   |
| POST    | `/api/currencies/rates/override`                | `handleSetManualRate`  | `settings.manage`  | currencies.ts   |

### AUTHED — Tax regions (5 routes) + Tax rules (3 routes)

| Méthode | Chemin                                          | Handler                       | Capability         | Fichier         |
|--------:|-------------------------------------------------|-------------------------------|--------------------|-----------------|
| GET     | `/api/tax-regions`                              | `handleListTaxRegions`        | `settings.manage`  | tax-regions.ts  |
| POST    | `/api/tax-regions`                              | `handleCreateTaxRegion`       | `settings.manage`  | tax-regions.ts  |
| GET     | `/api/tax-regions/:id/rules`                    | `handleListTaxRules`          | `settings.manage`  | tax-regions.ts  |
| POST    | `/api/tax-regions/:id/rules`                    | `handleCreateTaxRule`         | `settings.manage`  | tax-regions.ts  |
| PUT     | `/api/tax-regions/:id`                          | `handleUpdateTaxRegion`       | `settings.manage`  | tax-regions.ts  |
| DELETE  | `/api/tax-regions/:id`                          | `handleDeleteTaxRegion`       | `settings.manage`  | tax-regions.ts  |
| DELETE  | `/api/tax-rules/:id`                            | `handleDeleteTaxRule`         | `settings.manage`  | tax-regions.ts  |

**ORDRE ANTI-SHADOWING strict** dans `src/worker.ts` (bloc inséré après loyalty
vers l.2949) :

Currencies (statiques pures — pas de :id) :
1. `/api/currencies` GET (collection)
2. `/api/currencies/rates` GET (sous-collection statique)
3. `/api/currencies/rates/refresh` POST (statique)
4. `/api/currencies/rates/override` POST (statique)

Tax regions / rules (régex :id présent) :
1. `/api/tax-regions` GET + POST (collection statique AVANT régex)
2. `/api/tax-regions/:id/rules` GET + POST (suffix `/rules` AVANT `:id` générique)
3. `/api/tax-regions/:id` PUT + DELETE (générique `:id` APRÈS suffixes)
4. `/api/tax-rules/:id` DELETE (préfixe distinct — pas de conflit shadowing)

Réponses normalisées **`{ data }`** / **`{ error }`** (PAS de champ `code` —
contrat GELÉ docs/LOT-TEAM-BC.md §6.A). Phase A renvoie `501` partout (sauf
`handleListCurrencies` qui retourne la liste statique pour câbler la matrice
routes/handlers sans casser le worker — calque chat-widgets Phase A.

## §4 Handlers (signatures FIGÉES Phase A — Phase B Manager-B remplit)

### `src/worker/currencies.ts` (4 handlers)

```ts
handleListCurrencies(env, auth) → ApiResponse<SupportedCurrencyExt[]>
handleListRates(env, auth, url) → ApiResponse<CurrencyRate[]>
handleRefreshRates(request, env, auth) → ApiResponse<{ refreshed: number }>
handleSetManualRate(request, env, auth) → ApiResponse<CurrencyRate>
```

### `src/worker/tax-regions.ts` (7 handlers)

```ts
handleListTaxRegions(env, auth, url) → ApiResponse<TaxRegion[]>
handleCreateTaxRegion(request, env, auth) → ApiResponse<TaxRegion>
handleUpdateTaxRegion(request, env, auth, id) → ApiResponse<TaxRegion>
handleDeleteTaxRegion(env, auth, id) → ApiResponse<{ ok: true }>
handleListTaxRules(env, auth, regionId) → ApiResponse<TaxRule[]>
handleCreateTaxRule(request, env, auth, regionId) → ApiResponse<TaxRule>
handleDeleteTaxRule(env, auth, ruleId) → ApiResponse<{ ok: true }>
```

### `src/worker/lib/currency-converter.ts` (3 helpers — 1 pur + 2 DB/réseau)

```ts
// PUR
convertCents(amountCents, fromCur, toCur, rate): number

// RÉSEAU / DB (stubs Phase A)
fetchEcbRates(base): Promise<Record<string, number>>           // Phase B : fetch ECB
getRate(env, from, to): Promise<{ rate, source, fetched_at }>  // Phase B : cache D1 + fallback fetch
```

### `src/worker/lib/tax-engine-multi.ts` (1 helper FIGÉ — délégation legacy)

```ts
computeTaxMulti(regime, subtotalCents, opts): TaxResult
// Phase A : délègue à computeTax() legacy pour 'qc'/'eu'/'dz'/'exempt'.
// Stub 'us_sales_tax' renvoie {lines:[], totalTaxCents:0} (Phase B implémente).
```

## §5 Types `src/lib/types.ts` + `src/lib/api.ts` (FIGÉS Phase A)

Dans `src/lib/types.ts` (append après CalendarConflict, NE PAS modifier
SupportedCurrency / TaxRegime existants) :

- `type SupportedCurrencyExt = 'CAD' | 'USD' | 'EUR' | 'DZD' | 'MAD'`.
- `type TaxRegimeExt = TaxRegime | 'us_sales_tax'`.
- `interface CurrencyRate` (5 champs : id, base_currency, quote_currency, rate,
  source, fetched_at).
- `interface TaxRegion` (10 champs : id, client_id, code, name, country,
  country_subdiv, type, rates_json, tax_inclusive, active).
- `interface TaxRule` (6 champs : id, region_id, product_category, rate,
  compound, applies_from).

Dans `src/lib/api.ts` (append après getLoyaltyLedger) :

- 4 helpers currencies : `getCurrencies`, `listCurrencyRates`,
  `refreshCurrencyRates`, `setManualCurrencyRate`.
- 7 helpers tax regions/rules : `listTaxRegions`, `createTaxRegion`,
  `updateTaxRegion`, `deleteTaxRegion`, `listTaxRules`, `createTaxRule`,
  `deleteTaxRule`.
- 3 inputs : `CurrencyRateFilters`, `SetManualCurrencyRateInput`,
  `CreateTaxRegionInput`, `UpdateTaxRegionInput`, `CreateTaxRuleInput`.

## §6 Contrat inter-agent FIGÉ — Phase B B/C ne peuvent PAS modifier

1. **Migrations** : seq134 verrou. Aucun champ supplémentaire en Phase B sans
   nouvelle seq (135+). Aucun CHECK ajouté (rebuild SQLite interdit). Aucune
   FK ajoutée (rebuild interdit). `tax_rules.region_id → tax_regions.id ON
   DELETE CASCADE` est APPLICATIVE (handler `handleDeleteTaxRegion` DELETE
   rules AVANT region).
2. **Routes** : 12 AUTHED figées (§3). Aucun renommage. L'ordre anti-shadowing
   dans `worker.ts` est invariant (statiques AVANT régex, `/:id/rules` AVANT
   `/:id` générique).
3. **Capabilities** : `settings.manage` partout (admin-managed). AUCUN ajout à
   `ALL_CAPABILITIES` (seq80 figée). Réutilisation stricte.
4. **Contrat réponses** : `json({ data })` succès / `json({ error }, status)`
   erreur. PAS de champ `code`. Money TOUJOURS en cents INTEGER. Rate REAL >0
   (currency) ou ∈ [0..1] (tax rate).
5. **Types `src/lib/types.ts` + `src/lib/api.ts`** : noms et signatures FIGÉS
   (§5). PRÉSERVATION ABSOLUE de `SupportedCurrency` ('CAD'|'EUR'|'DZD') et
   `TaxRegime` ('qc'|'eu'|'dz'|'exempt') existants — les types `Ext` sont des
   SUR-ensembles consommés uniquement par les nouveaux modules.
6. **Bornage tenant** : `WHERE client_id = ?` dans tout SELECT/UPDATE/DELETE
   `tax_regions` (defense-in-depth IDOR sur `:id`). Pour `tax_rules` : JOIN
   tax_regions ON region_id WHERE tax_regions.client_id = ? (anti-IDOR cross-
   tenant via rule_id). `currency_rates` partagé (taux globaux, pas de
   client_id) — seul l'override manuel est borné `settings.manage` admin.
   `resolveClientId()` via `getClientModules(env, auth.userId)` — calque
   pos-registers.ts:22 / gift-cards.ts.
7. **Régression-zéro QC/EU/DZ ABSOLUE** : `ecommerce-tax-engine.ts` PAS TOUCHÉ.
   `tax-engine-multi.ts` DÉLÈGUE à `computeTax()` legacy pour tout régime
   existant. Pour `regime='qc'` ⇒ sortie IDENTIQUE bit-pour-bit (verbatim TPS
   0.05 + TVQ 0.09975, chacune arrondie séparément sur le sous-total).
   `ecommerce-orders.ts`, `ecommerce-payments.ts`, `ecommerce-region.ts`,
   `ecommerce-invoice.ts` JAMAIS modifiés par Sprint 39.
8. **Imports worker RELATIFS** : `import { json } from './helpers'` (pas
   d'alias `@/`). `import { computeTax } from '../ecommerce-tax-engine'` dans
   lib/tax-engine-multi.ts (relatif up-one-level).
9. **i18n** : 23 clés ajoutées dans 4 catalogues (`fr-CA`, `fr-FR`, `en`,
   `es`), parité STRICTE. fr-CA tutoiement, fr-FR vouvoiement. Manager-C ne
   change PAS le nom des clés. `};` final PRÉSERVÉ.
10. **Money & rate convention** : amounts EN CENTS INTEGER partout. Currency
    rate REAL >0 (1 base = rate quote). Tax rate REAL ∈ [0..1]. JAMAIS de
    float pour montants finaux.

## §7 RGPD / Conformité Loi 25

- **Pas de PII dans `currency_rates`** : table 100% technique (taux change),
  aucun lien tenant ni customer. Cache global partagé.
- **`tax_regions` / `tax_rules` = config tenant** : `client_id` est l'unique
  lien — aucune PII personnelle. Pas de cascade Loi 25 nécessaire.
- **Audit log mutations admin** : Phase B émet via `audit-log.ts` :
  - `tax_region.create` (region créée — code, country, type)
  - `tax_region.update` (region modifiée — diff champs)
  - `tax_region.delete` (region supprimée — code + rules cascadées)
  - `tax_rule.create` / `tax_rule.delete` (règle modifiée — region_id, category, rate)
  - `currency_rate.override` (taux manuel admin — base/quote/rate)
- **`currency_rate_used` / `currency_base` sur orders** : audit-trail
  multi-devise — montants pivot tenant pour reporting cross-currency. Pas
  de PII (juste deux REAL).

## §8 Sécurité

- **Validation enums STRICTE side-handler** : `type` ∈ {vat|gst_pst|sales_tax|
  tva_dz|exempt}, `source` ∈ {ecb|frankfurter|manual}, currencies ∈ CAD|USD|
  EUR|DZD|MAD. Toute valeur hors-enum ⇒ `{ error: 'Type invalide' }` 400
  (calque ecommerce-region.ts handler PUT).
- **Bornage tenant defense-in-depth** : tous les SELECT/UPDATE/DELETE incluent
  `WHERE client_id = ?` même sur lookup par `:id` (anti-IDOR). Pour `tax_rules`
  via region_id : JOIN tax_regions garantit la borne. Calque gift-cards.ts.
- **Override manuel rate = admin uniquement** : `settings.manage` cap requis
  (PAS `clients.manage` — anti-fraude marchand qui veut tricher le taux
  appliqué). Audit log obligatoire avec user_id.
- **Tax inclusive override** : `tax_inclusive=1` pour UE (prix TTC), `=0`
  pour US/CA (prix HT). Validation enum côté handler (0 ou 1 uniquement).
- **Compound tax** : `compound=1` pour cascade (rare — QC pré-2013). Phase B
  doit alerter dans le handler si compound activé sur région moderne
  (UI warning admin).

## §9 E4 Stripe flag inactif (régression-zéro paiements externes)

- **Multi-currency = NOTIONAL ONLY Phase A/B** : `orders.currency_rate_used`
  + `orders.currency_base` sont des colonnes AUDIT uniquement. Aucun écrit
  dans `payments` (table régulée E4), aucun `intent_id` Stripe modifié, aucun
  rapprochement bancaire impacté. Le moteur Stripe Live (seq126) reste en CAD
  (régression-zéro paiements E6).
- **Phase C future (Sprint 40+)** : intégration Stripe multi-currency via
  `payment_intent.currency` (Stripe natif) — câblage HORS SCOPE Sprint 39.
- **Aucun touch des fichiers régulés** : `ecommerce-payments.ts`,
  `ecommerce-orders.ts`, `ecommerce-tax-engine.ts`, `ecommerce-inventory.ts`,
  `ecommerce-region.ts`, `ecommerce-invoice.ts` restent intacts (vérifié
  `git diff` Phase A). QC TPS/TVQ non recalculée par Sprint 39 — invariant
  régression-zéro.

## §10 Crons (admin-trigger Phase A, scheduled() Phase future)

- **`POST /api/currencies/rates/refresh`** (`settings.manage`) :
  - Itère devises supportées (CAD/USD/EUR/DZD/MAD) → pour chaque base ≠
    base pivot tenant : `fetchEcbRates(base)` → INSERT `currency_rates`
    (source='ecb', fetched_at=now()).
  - Idempotent : ré-INSERT laisse historique (lookup ORDER BY fetched_at DESC
    LIMIT 1 sert le dernier). Pas de UPSERT (pas d'unique sur paire).
  - Réponse : `{ data: { refreshed: number } }`.
- **À câbler dans `scheduled()` worker.ts** (TODO Sprint 40+) : trigger
  quotidien `0 4 * * *` (4h AM Montréal). Pour Phase A : déclenche manuel via
  UI admin. Aucune dépendance bloquante Phase B.

## §11 Découpe Phase B (Manager-B backend ∥ Manager-C frontend)

- **Manager-B** : remplit les 4 handlers currencies + 7 handlers tax-regions
  + 2 helpers `currency-converter` (fetchEcbRates + getRate) +
  `tax-engine-multi.ts` stratégie `us_sales_tax` (aggregation state+county+
  city sales tax via lookup `tax_regions` + `tax_rules` JOIN). Implémente
  cascade applicative DELETE region → DELETE rules. ZÉRO fichier partagé
  avec C.
- **Manager-C** : pages `/settings/currencies` (liste devises + override
  manuel admin + bouton refresh), `/settings/tax-regions` (CRUD régions +
  rules par catégorie produit), composants `CurrencyRatePill`, `TaxRegionForm`,
  `TaxRuleTable`. Intégration des 23 clés i18n. ZÉRO fichier partagé avec B
  (api.ts en lecture pour C).
- **Hooks intégration** : Phase C (Sprint 40+) câblera le moteur
  `computeTaxMulti()` dans `ecommerce-orders.ts` (createOrderCore) en
  remplacement progressif de l'appel `computeTax()` direct quand
  `tax_regions.code` est résolu pour la commande — hors scope Phase A.

## §12 Doc compagnon — (à venir Phase C)

Conventions checkout multi-currency (devise détectée vs override customer),
UX picker tax region admin (autocomplete country + subdivision), patterns
formatage `Intl.NumberFormat` pour devises ≠ CAD — documentés dans
`MULTICURRENCY-CHECKOUT-S40.md` Sprint 40+.

---

## §13 Procédure refresh FX (cron / manuel)

- **`POST /api/currencies/rates/refresh`** (cap `settings.manage`) : trigger
  manuel admin — fetch Frankfurter API (proxy ECB public, sans clé) avec
  `EUR` en base → upsert toutes les paires `EUR→{CAD,USD,DZD,MAD}` dans
  `currency_rates` (source='ecb' ou 'frankfurter', `fetched_at=now()`).
  Pour servir `CAD→USD` ou autre pair non-EUR : calcul via pivot EUR
  côté `getRate()` (rate_AB = rate_EUR_B / rate_EUR_A).
- **Cache D1 fresh 24h (TTL)** : `getRate(env, from, to)` lit
  `currency_rates ORDER BY fetched_at DESC LIMIT 1`. Si entrée
  `< 24h` ⇒ servir cache (source d'origine préservée). Sinon ⇒ refetch
  + INSERT nouvelle ligne (historique conservé).
- **Fallback si Frankfurter down** : `getRate()` retombe sur la dernière
  entrée cache STALE (any-age) avec `source='cached_stale'` (warning UI
  admin pour rafraîchir manuellement). Si aucun cache jamais peuplé ⇒
  throw `'rate_unavailable'` (caller décide : 503 ou erreur métier).
- **Cron scheduled à câbler (TODO Sprint Observabilité)** : trigger
  quotidien `0 4 * * *` (4h AM Montréal — hors heures business) dans
  `worker.ts:scheduled()` appellera `handleRefreshRates()` automatiquement.
  Phase A/B : refresh manuel UI admin uniquement (bouton dans
  `CurrencyMultiSettingsPage`).

## §14 Régression-zéro QC/EU/DZ

- **`computeTaxMulti(regime, subtotalCents, opts)` SANS `opts.region`
  DÉLÈGUE verbatim à `computeTax()` legacy** (`ecommerce-tax-engine.ts`).
  Pour `regime='qc'` ⇒ TPS 0.05 + TVQ 0.09975, chacune `Math.round`
  séparément sur le sous-total — sortie IDENTIQUE bit-pour-bit à E-R M1.
- **Tests legacy `ecommerce-tax-engine.test.ts` (13/13 pass)** garantissent
  zéro changement de comportement. Sprint 39 N'A PAS MODIFIÉ une seule
  ligne de `ecommerce-tax-engine.ts` (vérifié `git diff` Phase A).
  Phase B ajoute `tax-engine-multi.test.ts` qui re-roule les 13 cas legacy
  via délégation pour preuve cross-module.
- **Nouveau régime `'us_sales_tax'`** : activé UNIQUEMENT via `opts.region`
  explicite (`{ type: 'sales_tax' }`). Sans région ⇒ délégation legacy
  fallback `'exempt'` (sortie vide, pas de tax fantôme).
- **Fichiers régulés intacts** : `ecommerce-orders.ts`,
  `ecommerce-payments.ts`, `ecommerce-region.ts`, `ecommerce-invoice.ts`
  JAMAIS touchés. Le câblage `computeTaxMulti()` dans `createOrderCore()`
  reste HORS SCOPE Sprint 39 (Phase C / Sprint 40+).

## §15 US Sales Tax — exemples

- **Région NY 8%** :
  ```json
  {
    "code": "NY-US",
    "name": "New York State Sales Tax",
    "type": "sales_tax",
    "country": "US",
    "country_subdiv": "NY",
    "rates_json": { "sales_tax": 0.08 }
  }
  ```
- **Région CA 8.875%** :
  ```json
  {
    "code": "CA-US",
    "name": "California Combined Sales Tax",
    "type": "sales_tax",
    "country": "US",
    "country_subdiv": "CA",
    "rates_json": { "sales_tax": 0.08875 }
  }
  ```
- **Override par catégorie produit** : `tax_rules` enregistre
  `{ region_id: NY-US, product_category: 'food', rate: 0, compound: 0 }`
  → ventes catégorie `food` à 0% (alimentaire NY exempté). Le `rates_json`
  de la région est NON UTILISÉ pour les lignes matchant une rule
  catégorie-spécifique (rule prime sur fallback région).
- **Pattern lookup `computeTaxMulti()`** : pour chaque ligne, résoudre
  `tax_rules.find(r => r.product_category === line.category)`. Si match ⇒
  appliquer `r.rate`. Sinon ⇒ fallback `region.rates_json.sales_tax`.

## §16 Rules cascade & compound

- **`Rule.compound = true`** : la taxe s'applique sur `sub + taxes
  précédentes` (tier-2 / compound tax) au lieu de `sub` seul.
  Algorithmiquement, ordre des règles importe : tier-1 (compound=0) calculé
  d'abord sur `sub`, tier-2 (compound=1) calculé ensuite sur `sub + Σ(tier-1)`.
- **Use case Québec pré-2013** : QST (TVQ) historique appliquée sur
  `sub + GST (TPS)` ⇒ rule TVQ avec `compound=1`. Régression-zéro :
  régime `'qc'` MODERNE (post-2013) reste verbatim non-compound dans
  legacy `ecommerce-tax-engine.ts` (TPS + TVQ séparées sur sub).
- **Compound rare en 2026** : la plupart des juridictions ont aboli la
  cascade. Phase B affiche un warning UI admin si `compound=1` activé
  sur région créée après 2014 (`applies_from > '2014-01-01'`).
- **Ordre déterministe** : `tax_rules` triés par `(compound ASC, id ASC)`
  pour appliquer non-compound avant compound (résultat reproductible).

## §17 Multi-currency : display vs storage

- **Storage : TOUJOURS en cents native currency** :
  - `orders.total_cents` reste en cents de la devise de vente (ex : si
    vente effectuée en EUR ⇒ `total_cents` en cents EUR, PAS en CAD pivot).
  - `orders.currency` (existant E-R M2) identifie la devise native.
- **Audit multi-devise** :
  - `orders.currency_rate_used` : snapshot du taux change appliqué AU
    MOMENT de la commande (frozen — pas de recalc rétroactif si taux
    bouge ensuite). Type REAL.
  - `orders.currency_base` : montant total converti dans la devise
    COMPTABLE du tenant (pivot reporting cross-currency). Type REAL —
    pas re-arrondi en cents car usage analytique uniquement.
- **Display : `convertCents()` à la volée** :
  - UI dashboard / facturation affiche soit native, soit pivot tenant
    (toggle utilisateur). `convertCents(total_cents, native, target,
    getRate().rate)` PUR — aucune persistance.
  - Reporting cross-tenant : utilise `currency_base` (snapshot frozen)
    pour comparabilité historique (pas de re-conversion live).
- **Invariant** : ne JAMAIS overwriter `currency_rate_used` après
  création commande. Si rate change ⇒ nouvelle ligne `currency_rates`,
  ancien snapshot orders intact (audit trail comptable).

## §18 Limitations connues (Sprint 39)

- **Pas de cron auto refresh** : `POST /api/currencies/rates/refresh`
  est manuel uniquement (UI admin). Câblage `scheduled()` worker.ts
  reporté Sprint Observabilité (cron `0 4 * * *` quotidien).
- **US sales tax flat par région** : pas de distinction origin-based vs
  destination-based (NEXUS rules complexes US). Sprint 39 traite toute
  vente NY comme NY 8%, quel que soit l'origine du marchand. Câblage
  destination-based via `tax_rules` + customer ZIP lookup HORS SCOPE
  (Sprint 41+ si demande client US confirmée).
- **MAD currency : storage only** : `currency_rates` supporte EUR→MAD
  et conversion `convertCents()` fonctionne, MAIS pas de régime fiscal
  `'ma'` natif. Pour vente Maroc ⇒ utiliser régime `'eu'`-like
  (TVA 20% standard MA) configuré via `tax_regions` admin-managed avec
  `type='vat'` + `rates_json: { vat: 0.20 }`. Régime spécifique
  `'tva_ma'` ajoutable Sprint futur si volume justifie.
- **Pas de rounding 5¢ pour CAD** dans `tax-engine-multi.ts` : le POS
  Sprint 37 (`pos-engine.ts:roundCashTender`) gère le cas spécifique
  cash CAD (arrondi au 5¢ nickel). `computeTaxMulti()` reste round-cent
  standard. Câblage POS multi-currency reporté Sprint 40+.
- **Compound nesting limité à 2 tiers** : `compound=1` empile sur tier-1
  agrégé. Pas de tier-3 (compound sur compound). Cas extrême théorique
  non rencontré dans juridictions modernes (2026).
- **Override manuel rate = audit-log seul** : pas de workflow
  d'approbation 2-eyes pour `handleSetManualRate`. Anti-fraude via
  capability `settings.manage` (admin only) + audit-log `currency_rate.
  override` obligatoire. Workflow approval reporté si demande compliance.
