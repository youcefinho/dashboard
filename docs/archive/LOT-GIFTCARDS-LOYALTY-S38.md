# LOT Gift cards + Loyalty programs — Sprint 38

> Doc contrat §6 figé. Migration : seq133 — `migration-giftcards-loyalty-seq133.sql`.
> Compagnons : `LOT-POS-S37.md` (calque structure §6 + pattern handler stubs),
> `LOT-TEAM-BC.md` (capabilities figées seq80 — réutilisation `clients.manage` +
> `settings.manage` + `reports.view`), `LOT-CHAT-WIDGET-S36.md` (calque pattern
> i18n + manifest).

## §1 Contexte

L'e-commerce B2 et le POS retail (seq132) **EXISTENT DÉJÀ**. Le moteur de coupons
(`src/worker/ecommerce-coupons.ts`) fournit le pattern de référence pour la
génération de code et la résolution code→montant. Sprint 38 ajoute deux
modules opérationnels NEUFS au-dessus :

1. **Gift cards** : émission de cartes-cadeaux avec code unique tenant, soldes
   en cents, statut (`active|redeemed|expired|voided`), expiration optionnelle,
   ledger complet (`issue|credit|debit|refund|expire|void`) avec idempotency_key
   pour ancrer chaque mouvement à un order_id.
2. **Loyalty programs** : programmes fidélité par tenant (taux earn/redeem
   configurables, tiers et benefits JSON), ledger points
   (`earn|redeem|adjust|expire|tier_bonus`) avec snapshot tier au moment de
   l'écriture, table `loyalty_customer_state` pour balance/lifetime/tier
   matérialisés.

**Régression-zéro QC garantie** : les handlers `redeem` (gift card) et
`earn`/`redeem` (loyalty) ne RECALCULENT JAMAIS la TPS/TVQ. La résolution
discount/credit passe en AMONT du contrat `createOrderCore` (Phase B). Aucun
touch des tables paiement E4/E6 régulées. Aucun touch de `ecommerce-orders.ts`,
`ecommerce-tax-engine.ts`, `ecommerce-payments.ts`, `ecommerce-inventory.ts`.

## §2 Migration — seq133 (DDL résumé)

Fichier racine : `migration-giftcards-loyalty-seq133.sql`. Manifest entrée
seq133, `depends_on: ["migration-pos-seq132.sql"]` (chaînage strict).

100 % ADDITIF, zéro CHECK / FK destructrice / DROP / RENAME :

- `CREATE TABLE IF NOT EXISTS gift_cards` : id PK, client_id, agency_id, code
  TEXT, initial_value_cents, current_balance_cents, currency (DEFAULT `'CAD'`),
  expires_at NULL, issued_to_customer_id NULL, issued_to_email NULL,
  issued_by_user_id, issued_at DEFAULT `datetime('now')`, last_used_at NULL,
  status (enum HANDLER `active|redeemed|expired|voided`, DEFAULT `'active'`),
  notes, created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS gift_card_transactions` : id PK, gift_card_id,
  client_id (dénormalisé), order_id NULL, amount_cents (signé),
  type (enum HANDLER `issue|credit|debit|refund|expire|void`),
  balance_after_cents, idempotency_key NULL, created_by_user_id, created_at.
- `CREATE TABLE IF NOT EXISTS loyalty_programs` : id PK, client_id NOT NULL,
  agency_id, name DEFAULT `''`, currency DEFAULT `'CAD'`,
  earn_rate_per_dollar INTEGER DEFAULT 1, redeem_rate_cents_per_point INTEGER
  DEFAULT 1, min_redeem_points INTEGER DEFAULT 100, points_expiry_days NULL,
  tier_thresholds_json TEXT, tier_benefits_json TEXT, is_active INTEGER DEFAULT 1,
  created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS loyalty_ledger` : id PK, program_id, client_id,
  customer_id NOT NULL, points (signé),
  type (enum HANDLER `earn|redeem|adjust|expire|tier_bonus`), source_order_id NULL,
  idempotency_key NULL, tier_snapshot, balance_after, expires_at NULL,
  created_by_user_id, created_at.
- `CREATE TABLE IF NOT EXISTS loyalty_customer_state` : id PK, program_id,
  client_id, customer_id, current_balance DEFAULT 0, lifetime_earned DEFAULT 0,
  current_tier DEFAULT `'bronze'`, tier_updated_at, last_earn_at, last_redeem_at,
  created_at, updated_at.

**11 indexes** :
- `uniq_gift_cards_client_code` (UNIQUE client_id, code),
  `idx_gift_cards_status_expires` (status, expires_at).
- `idx_gc_tx_card`, `idx_gc_tx_order`, `idx_gc_tx_client_created`.
- `idx_loyalty_programs_client`.
- `idx_loyalty_ledger_customer` (program_id, customer_id),
  `idx_loyalty_ledger_expires` (type, expires_at),
  `idx_loyalty_ledger_client_created` (client_id, created_at).
- `uniq_loyalty_state_prog_cust` (UNIQUE program_id, customer_id),
  `idx_loyalty_state_client_tier` (client_id, current_tier).

Validation enums (`status`, `type`, `current_tier`) SIDE-HANDLER
(`gift-cards.ts` / `loyalty.ts` / `lib/gift-card-engine.ts` /
`lib/loyalty-engine.ts`) — calque LOT-POS-S37 §6 (pas de CHECK = pas de rebuild
SQLite jamais).

## §3 Routes (1 PUBLIC + 18 AUTHED)

### PUBLIC (1 route, rate-limited au choke-point amont)

| Méthode | Chemin                                              | Handler                       | Fichier         |
|--------:|-----------------------------------------------------|-------------------------------|-----------------|
| GET     | `/api/public/gift-cards/:code/balance`              | `handleGetBalanceByCode`      | gift-cards.ts   |

### AUTHED — Gift cards (8 routes)

| Méthode | Chemin                                          | Handler                          | Capability         | Fichier         |
|--------:|-------------------------------------------------|----------------------------------|--------------------|-----------------|
| GET     | `/api/gift-cards`                               | `handleListGiftCards`            | `clients.manage`   | gift-cards.ts   |
| POST    | `/api/gift-cards`                               | `handleIssueGiftCard`            | `clients.manage`   | gift-cards.ts   |
| POST    | `/api/gift-cards/cron/expire`                   | `handleRunGiftCardExpiryCron`    | `settings.manage`  | gift-cards.ts   |
| GET     | `/api/gift-cards/:id`                           | `handleGetGiftCard`              | `clients.manage`   | gift-cards.ts   |
| POST    | `/api/gift-cards/:id/redeem`                    | `handleRedeemGiftCard`           | `clients.manage`   | gift-cards.ts   |
| POST    | `/api/gift-cards/:id/void`                      | `handleVoidGiftCard`             | `clients.manage`   | gift-cards.ts   |
| POST    | `/api/gift-cards/:id/refund`                    | `handleRefundToGiftCard`         | `clients.manage`   | gift-cards.ts   |
| GET     | `/api/gift-cards/:id/transactions`              | `handleListTransactions`         | `clients.manage`   | gift-cards.ts   |

### AUTHED — Loyalty (10 routes)

| Méthode | Chemin                                            | Handler                       | Capability         | Fichier      |
|--------:|---------------------------------------------------|-------------------------------|--------------------|--------------|
| GET     | `/api/loyalty/programs`                           | `handleListPrograms`          | `clients.manage`   | loyalty.ts   |
| POST    | `/api/loyalty/programs`                           | `handleCreateProgram`         | `settings.manage`  | loyalty.ts   |
| POST    | `/api/loyalty/cron/expire-points`                 | `handleRunExpiryCron`         | `settings.manage`  | loyalty.ts   |
| GET     | `/api/loyalty/programs/:id`                       | `handleGetProgram`            | `clients.manage`   | loyalty.ts   |
| PATCH   | `/api/loyalty/programs/:id`                       | `handleUpdateProgram`         | `settings.manage`  | loyalty.ts   |
| DELETE  | `/api/loyalty/programs/:id`                       | `handleDeleteProgram`         | `settings.manage`  | loyalty.ts   |
| GET     | `/api/loyalty/customers/:id/balance`              | `handleGetCustomerBalance`    | `clients.manage`   | loyalty.ts   |
| GET     | `/api/loyalty/customers/:id/ledger`               | `handleListLedger`            | `clients.manage`   | loyalty.ts   |
| POST    | `/api/loyalty/earn`                               | `handleEarnPoints`            | `clients.manage`   | loyalty.ts   |
| POST    | `/api/loyalty/redeem`                             | `handleRedeemPoints`          | `clients.manage`   | loyalty.ts   |
| POST    | `/api/loyalty/adjust`                             | `handleAdjustPoints`          | `settings.manage`  | loyalty.ts   |

**ORDRE ANTI-SHADOWING strict** dans `src/worker.ts` :

Gift cards :
1. `/api/gift-cards` GET + POST (collection)
2. `/api/gift-cards/cron/expire` POST (statique — AVANT régex `:id`)
3. `/api/gift-cards/:id/redeem` POST (suffix)
4. `/api/gift-cards/:id/void` POST (suffix)
5. `/api/gift-cards/:id/refund` POST (suffix)
6. `/api/gift-cards/:id/transactions` GET (suffix)
7. `/api/gift-cards/:id` GET (générique `:id` — APRÈS suffixes)

Loyalty :
1. `/api/loyalty/programs` GET + POST (collection)
2. `/api/loyalty/cron/expire-points` POST (statique — AVANT régex `:id`)
3. `/api/loyalty/programs/:id` GET + PATCH + DELETE (générique `:id`)
4. `/api/loyalty/customers/:id/balance` GET (préfixe distinct)
5. `/api/loyalty/customers/:id/ledger` GET (préfixe distinct)
6. `/api/loyalty/earn|redeem|adjust` POST (statiques distincts)

Réponses normalisées **`{ data }`** / **`{ error }`** (PAS de champ `code` —
contrat GELÉ docs/LOT-TEAM-BC.md §6.A ; champ `meta` autorisé Sprint 35 pour
signature mismatch idempotency). Phase A renvoie `501` partout
(`Phase B not yet implemented`) pour câbler la matrice routes/handlers sans
casser le worker — calque chat-widgets Phase A.

## §4 Handlers (signatures FIGÉES Phase A — Phase B Manager-B remplit)

### `src/worker/gift-cards.ts` (9 handlers)

```ts
handleListGiftCards(env, auth, url) → ApiResponse<GiftCard[]>
handleGetGiftCard(env, auth, id) → ApiResponse<GiftCard>
handleIssueGiftCard(request, env, auth) → ApiResponse<GiftCard>
handleGetBalanceByCode(env, request, code) → ApiResponse<GiftCardBalance>  // PUBLIC
handleRedeemGiftCard(request, env, auth, id) → ApiResponse<GiftCardTransaction>
handleVoidGiftCard(env, auth, id) → ApiResponse<GiftCard>
handleRefundToGiftCard(request, env, auth, id) → ApiResponse<GiftCardTransaction>
handleListTransactions(env, auth, cardId) → ApiResponse<GiftCardTransaction[]>
handleRunGiftCardExpiryCron(request, env, auth) → ApiResponse<{ expired: number }>
```

### `src/worker/loyalty.ts` (11 handlers)

```ts
handleListPrograms(env, auth, url) → ApiResponse<LoyaltyProgram[]>
handleGetProgram(env, auth, id) → ApiResponse<LoyaltyProgram>
handleCreateProgram(request, env, auth) → ApiResponse<LoyaltyProgram>
handleUpdateProgram(request, env, auth, id) → ApiResponse<LoyaltyProgram>
handleDeleteProgram(env, auth, id) → ApiResponse<{ ok: true }>
handleGetCustomerBalance(env, auth, customerId, url) → ApiResponse<LoyaltyCustomerBalance>
handleEarnPoints(request, env, auth) → ApiResponse<LoyaltyLedgerEntry>
handleRedeemPoints(request, env, auth) → ApiResponse<LoyaltyLedgerEntry>
handleAdjustPoints(request, env, auth) → ApiResponse<LoyaltyLedgerEntry>
handleListLedger(env, auth, customerId, url) → ApiResponse<LoyaltyLedgerEntry[]>
handleRunExpiryCron(request, env, auth) → ApiResponse<{ expired: number }>
```

### `src/worker/lib/gift-card-engine.ts` (5 helpers purs + 4 helpers DB-touching)

```ts
// PURS
generateGiftCardCode(): string
normalizeCode(input: string): string
validateCodeFormat(code: string): boolean
computeNewBalance(current, txType, amount): { newBalance, ok, error? }
isExpired(card): boolean
pickIdempotencyKey(giftCardId, orderId, type): string

// DB-touching (stubs Phase A)
findCardByCode(db, clientId, code) → Promise<GiftCardRow | null>
issueGiftCard(db, clientId, agencyId, initialValueCents, currency, opts) → Promise<{ ok, cardId?, code?, error? }>
applyTransaction(db, cardId, type, amountCents, orderId, userId, idempKey) → Promise<ApplyTransactionResult>
recomputeBalance(db, cardId) → Promise<{ ok, balanceCents?, error? }>
```

### `src/worker/lib/loyalty-engine.ts` (5 helpers purs + 4 helpers DB-touching)

```ts
// PURS
computeEarnedPoints(subtotalCents, earnRatePerDollar, tierMultiplier): number
computeRedeemValueCents(points, redeemRateCentsPerPoint): number
deriveTier(lifetimeEarned, thresholds): string
pickTierMultiplier(tier, benefitsJson): number
computeExpiryDate(now, expiryDays): string | null
pickIdempotencyKey(programId, customerId, orderId, type): string

// DB-touching (stubs Phase A)
getOrCreateState(db, programId, clientId, customerId) → Promise<LoyaltyStateRow | null>
recordLedgerEntry(db, input) → Promise<{ ok, entryId?, newBalance?, error? }>
expirePendingPoints(db, programId, asOf) → Promise<{ ok, expiredEntries?, error? }>
recomputeState(db, programId, customerId) → Promise<{ ok, balance?, tier?, error? }>
```

## §5 Types `src/lib/api.ts` (FIGÉS Phase A)

- `interface GiftCard` (12 champs).
- `interface GiftCardTransaction` (7 champs).
- `interface GiftCardBalance` (4 champs).
- `interface LoyaltyProgram` (10 champs).
- `interface LoyaltyLedgerEntry` (9 champs).
- `interface LoyaltyCustomerBalance` (7 champs).
- Enums : `GiftCardStatus`, `GiftCardTransactionType`, `LoyaltyLedgerType`.
- Helpers async (1 par route) : `getGiftCards`, `issueGiftCard`,
  `getGiftCardBalance` (PUBLIC), `redeemGiftCard`, `voidGiftCard`,
  `refundToGiftCard`, `getGiftCardTransactions`, `getLoyaltyPrograms`,
  `getLoyaltyProgram`, `createLoyaltyProgram`, `updateLoyaltyProgram`,
  `deleteLoyaltyProgram`, `getCustomerLoyaltyBalance`, `earnLoyaltyPoints`,
  `redeemLoyaltyPoints`, `adjustLoyaltyPoints`, `getLoyaltyLedger`.

## §6 Contrat inter-agent FIGÉ — Phase B B/C ne peuvent PAS modifier

1. **Migrations** : seq133 verrou. Aucun champ supplémentaire en Phase B sans
   nouvelle seq (134+). Aucun CHECK ajouté (rebuild SQLite interdit). Aucune
   FK ajoutée (rebuild interdit). Les colonnes `idempotency_key` sont NULLable
   par construction — l'unicité applicative est gardée par les handlers via
   `SELECT ... WHERE idempotency_key = ?` avant INSERT (pattern coupons).
2. **Routes** : 1 PUBLIC + 18 AUTHED figées (§3). Aucun renommage. L'ordre
   anti-shadowing dans `worker.ts` est invariant.
3. **Capabilities** : `clients.manage` (toutes routes opérationnelles read +
   write) + `settings.manage` (CRUD programmes + adjust + crons) +
   `reports.view` (lecture optionnelle ledger côté UI, Phase C). AUCUN ajout
   à `ALL_CAPABILITIES` (seq80 figée).
4. **Contrat réponses** : `json({ data })` succès / `json({ error }, status)`
   erreur. PAS de champ `code` ; champ `meta` autorisé pour signature mismatch
   idempotency (calque Sprint 35). Money TOUJOURS en cents INTEGER. Points
   TOUJOURS en INTEGER signé.
5. **Types `src/lib/api.ts`** : noms et signatures FIGÉS (§5). Manager-C peut
   ajouter des `interface` supplémentaires côté front s'il les expose, mais
   ne renomme PAS les exports listés.
6. **Bornage tenant** : `WHERE client_id = ?` dans tout SELECT/UPDATE/DELETE
   gift_cards / gift_card_transactions / loyalty_programs / loyalty_ledger /
   loyalty_customer_state (defense-in-depth IDOR sur `:id` ET sur
   `:customer_id`). `resolveClientId()` via `getClientModules(env, auth.userId)`
   — calque pos-registers.ts:22 / chat-widgets.ts:26.
7. **Idempotence ABSOLUE** : tout `redeem` / `earn` / `refund` lié à un
   `order_id` doit poser `idempotency_key = pickIdempotencyKey(...)` AVANT
   l'INSERT. Phase B doit `SELECT ... WHERE idempotency_key = ?` et retourner
   l'entrée existante (ou `{ data: existing, meta: { duplicate: true } }`)
   plutôt que générer un doublon.
8. **Pas de modification de `ecommerce-orders.ts`, `ecommerce-tax-engine.ts`,
   `ecommerce-payments.ts`, `ecommerce-inventory.ts`**. Si Phase B a besoin
   d'un comportement nouveau (ex: appliquer un crédit gift card sur un order),
   RÉUTILISER les exports existants. Régression-zéro QC = invariant.
9. **Sécurité Loi 25 / RGPD** : `created_by_user_id` = user_id, JAMAIS le nom
   en clair. `issued_to_email` est PII (consentement requis avant envoi). Les
   reçus email gift card = données client minimales (pas d'IP, pas d'UA).
   `code` carte-cadeau = secret (jamais loggé en clair côté audit). Le
   `code` ne quitte le tenant que via email tenant→destinataire (CASL/CAN-SPAM
   compliant Phase C).
10. **i18n** : 31 clés ajoutées dans 4 catalogues (`fr-CA`, `fr-FR`, `en`,
    `es`), parité STRICTE. Manager-C ne change PAS le nom des clés.

## §7 RGPD / Conformité Loi 25

- **Pas de PII dans les codes gift cards** : `generateGiftCardCode()` tire 80 bits
  d'entropie via `crypto.getRandomValues` sur un alphabet randomisé (pas de
  séquence devinable, pas d'horodatage embarqué, pas de nom client encodé).
- **Endpoint public minimal** : `GET /api/public/gift-cards/:code/balance`
  retourne EXCLUSIVEMENT `{ balance_cents, currency, expires_at, status }`.
  JAMAIS `issued_to_email`, JAMAIS `issued_to_customer_id`, JAMAIS `notes`,
  JAMAIS `created_by_user_id`. Un porteur de code anonyme ne peut PAS énumérer
  l'identité du destinataire ni du tenant émetteur.
- **Audit log mutations obligatoire** : toute mutation de solde émet un événement
  via `audit-log.ts` :
  - `gc.issue` (gift card émise — montant + currency, sans code en clair)
  - `gc.redeem` (gift card débitée — order_id + amount + balance_after)
  - `gc.refund` (gift card recréditée — order_id + amount)
  - `gc.void` (gift card annulée — reason si fournie)
  - `loyalty.earn` (points gagnés — order_id + points + tier_snapshot)
  - `loyalty.redeem` (points utilisés — points + value_cents)
  - `loyalty.adjust` (ajustement manuel — points + reason OBLIGATOIRE,
    `settings.manage` requis, traçabilité user_id)
- **Suppression cascade Loi 25 (droit à l'effacement)** : `DELETE customer` →
  `UPDATE gift_cards SET issued_to_customer_id = NULL, issued_to_email = NULL
  WHERE issued_to_customer_id = ?` (la carte reste valable sous son code, le
  lien identitaire est rompu). Pour la fidélité : `loyalty_customer_state` et
  `loyalty_ledger` sont SUPPRIMÉS en cascade (les points appartiennent au
  client supprimé — aucune fuite cross-customer). Documenté pour le DPO dans
  l'export Loi 25 (Sprint 30).
- **Consentement marketing** : `issued_to_email` ne déclenche AUCUN envoi
  automatique. L'envoi du reçu/code par courriel est une action explicite du
  tenant (consentement CASL/CAN-SPAM avant trigger).

## §8 Sécurité

- **Entropie codes** : 80 bits via `crypto.getRandomValues(new Uint8Array(10))`
  encodé sur alphabet 32 caractères (anti-confusion `0/O/1/I/L` exclus). Espace
  collision ≈ 2⁸⁰. Brute-force online inopérant (rate-limit 10/min/IP côté
  endpoint balance).
- **Unicité tenant** : `UNIQUE INDEX uniq_gift_cards_client_code (client_id, code)`.
  En cas de collision lors de `issueGiftCard` : retry max **5 tentatives** avec
  nouveau code regénéré ; au-delà → `{ error: "code_generation_exhausted" }`
  (jamais atteint en pratique avec 2⁸⁰ d'espace).
- **Rate-limit endpoint public** : `GET /api/public/gift-cards/:code/balance`
  → 10 requêtes/minute/IP via le middleware rate-limit existant
  (`src/worker/lib/rate-limit.ts`). Bucket clé : `gc:balance:${ip}`.
  Réponse 429 + header `Retry-After`. Anti-énumération.
- **Idempotence stricte gift cards** : `applyTransaction(db, cardId, type,
  amount, orderId, userId, idempKey)` calcule
  `idempKey = pickIdempotencyKey(giftCardId, orderId, type)` puis :
  `SELECT id, amount_cents, balance_after_cents FROM gift_card_transactions
  WHERE gift_card_id = ? AND idempotency_key = ? LIMIT 1`. Si trouvé →
  retourne l'entrée existante avec `meta: { duplicate: true }`. Sinon INSERT
  dans transaction SQLite avec UPDATE balance atomique. Anti double-débit
  garanti même en cas de retry réseau.
- **Idempotence stricte loyalty** : `recordLedgerEntry` calcule
  `idempKey = pickIdempotencyKey(programId, customerId, sourceOrderId, type)`.
  Même pattern SELECT-AVANT-INSERT. Anti double-earn (rejeu webhook
  e-commerce) et anti double-redeem (double-clic UI).
- **Bornage tenant defense-in-depth** : tous les SELECT/UPDATE/DELETE incluent
  `WHERE client_id = ?` même sur lookup par `:id` (anti-IDOR). Calque
  pos-registers.ts:22 / chat-widgets.ts:26.
- **Code gift card en clair = secret** : ne JAMAIS logguer dans audit-log ni
  dans erreurs serveur. Stockage SQLite uniquement. Affichage UI tenant
  une seule fois après émission (calque coupons existants).

## §9 E4 Stripe flag inactif (régression-zéro paiements externes)

- **Gift cards = instrument INTERNE** : aucune écriture dans `payments`
  (table régulée E4), aucun `intent_id` Stripe, aucun rapprochement bancaire.
  Le ledger `gift_card_transactions` est autoportant — solde reconstructible
  par `SUM(amount_cents)` au besoin (`recomputeBalance`).
- **Loyalty = points abstraits** : aucun lien Stripe, aucune unité monétaire
  externe. La conversion points→cents s'opère UNIQUEMENT au moment du redeem
  via `computeRedeemValueCents(points, redeemRateCentsPerPoint)` et le crédit
  résultant transite par `createOrderCore` (Phase B) — pas de mouvement
  monétaire indépendant.
- **Aucun touch des fichiers régulés** : `ecommerce-payments.ts`,
  `ecommerce-orders.ts`, `ecommerce-tax-engine.ts`, `ecommerce-inventory.ts`
  restent intacts (vérifié `git diff` Phase A). QC TPS/TVQ non recalculée par
  Sprint 38 — invariant régression-zéro.

## §10 Crons (admin-trigger Phase A, scheduled() Phase future)

- **`POST /api/gift-cards/cron/expire`** (`settings.manage`) :
  - `UPDATE gift_cards SET status = 'expired' WHERE status = 'active' AND
    expires_at IS NOT NULL AND expires_at < datetime('now')`
  - Pour chaque carte expirée : `INSERT INTO gift_card_transactions (type
    = 'expire', amount_cents = -current_balance_cents, balance_after_cents
    = 0, idempotency_key = 'expire:${cardId}:${expires_at}')` (idempotent —
    re-run safe).
  - Réponse : `{ data: { expired: number } }`.
- **`POST /api/loyalty/cron/expire-points`** (`settings.manage`) :
  - Itère `SELECT id, client_id FROM loyalty_programs WHERE is_active = 1`.
  - Pour chaque programme : `expirePendingPoints(db, programId, asOf)`
    sélectionne les entrées `loyalty_ledger` `type = 'earn'` avec
    `expires_at < now` non encore expirées → INSERT entry `type = 'expire'`
    avec `points = -remaining_points` (idempotency_key
    `expire:${programId}:${customerId}:${sourceEntryId}`).
  - `recomputeState(db, programId, customerId)` après chaque expiration.
  - Réponse : `{ data: { expired: number } }`.
- **À câbler dans `scheduled()` worker.ts** (TODO Sprint 39+) : trigger
  quotidien `0 3 * * *` (3h AM Montréal = 8h UTC). Pour l'instant : déclenche
  manuel via UI admin ou cron externe (Cloudflare Triggers). Aucune
  dépendance bloquante Phase B.

## §11 Workflow automation trigger (consommables existants)

- Les événements `audit_log` suivants sont émis par les handlers Phase B et
  consommables par le moteur workflow automation existant (`src/worker/
  workflows.ts`) :
  - `loyalty.points_earned` — payload : `{ customerId, points, newBalance,
    sourceOrderId }`. Trigger d'email de remerciement, push notif, etc.
  - `loyalty.tier_changed` — payload : `{ customerId, oldTier, newTier,
    lifetimeEarned }`. Trigger d'email de félicitation upgrade.
  - `gift_card_balance_low` — payload : `{ cardId, balanceCents, threshold
    = 500 }` (émis si `applyTransaction` laisse un solde < 5$ CAD).
    Trigger de rappel "il vous reste X$ sur votre carte".
- **TODO future (Sprint 39+)** : workflow templates pré-configurés —
  `loyalty_tier_upgrade` (email automatique), `gift_card_expiry_warning`
  (rappel 30 jours avant expiration), `gift_card_issued`
  (envoi automatique du code par courriel après émission si consentement).
- Sprint 38 émet UNIQUEMENT les événements — le câblage UI workflow templates
  est hors scope (réutilise le pattern Sprint 33 webhooks).

## §12 Découpe Phase B (Manager-B backend ∥ Manager-C frontend)

- **Manager-B** : remplit les 9 handlers gift-cards + 11 handlers loyalty + 9
  helpers `gift-card-engine` + 9 helpers `loyalty-engine`. Branche
  `createOrderCore` en amont si lien order. Implémente `applyTransaction`
  idempotent (anti-rejeu via `idempotency_key`). Implémente CRON
  `expire-points` (best-effort, batch limité). ZÉRO fichier partagé avec C.
- **Manager-C** : pages `/gift-cards` (liste + émission + détails),
  `/gift-cards/lookup` (saisie code + balance publique),
  `/loyalty/programs` (CRUD), `/loyalty/customers/:id` (balance + ledger +
  redeem manuel). Composants `GiftCardCodeDisplay`, `LoyaltyPointsBadge`,
  `TierBadge`. Intégration des 31 clés i18n. ZÉRO fichier partagé avec B
  (api.ts est en lecture pour C).
- **Hooks intégration** : Phase C (Sprint 39+) câblera l'auto-earn sur
  `commitOrderSale` (loyalty) et l'application auto d'un crédit gift card
  avant le calcul de paiement (POS) — hors scope Phase A.

## §13 Doc compagnon — (à venir Phase C)

Conventions checkout (UX redeem caisse), email templates gift card, ESC/POS
extension reçu fidélité (tier badge + points earned) — documentés dans
`ESC-POS-PRINTER-S37.md` Sprint 39.
