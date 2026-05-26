# LOT Product Reviews + Abandoned Carts Recovery — Sprint 40

> DERNIER sprint LOT 4. Doc contrat §6 figé. Migration : seq135 —
> `migration-product-reviews-abandoned-seq135.sql`. Compagnons :
> `LOT-MULTICURRENCY-TAX-S39.md` (calque structure §6 + pattern handler stubs
> Phase A), `LOT-GIFTCARDS-LOYALTY-S38.md` (capabilities figées seq80 —
> réutilisation `reports.view` + `clients.manage`), `src/worker/reviews.ts`
> (Sprint 9 — INVITATIONS Google/FB — RÉGRESSION-ZÉRO absolue),
> `src/worker/ecommerce-cart-recovery.ts` (Sprint E7 — single-touch —
> RÉGRESSION-ZÉRO absolue).

## §1 Contexte

Le module `reviews.ts` (Sprint 9 — review_requests + reviews_cache Google/FB
invitations) **EXISTE DÉJÀ** (verbatim flux 1st-party : envoi demande d'avis
Google Business Profile / Facebook via Resend + AI suggest reply Anthropic
Haiku). Le module `ecommerce-cart-recovery.ts` (Sprint E7 — single-touch
detectAbandonedCarts + handleRecoverCart via workflow `cart_abandoned`) **EXISTE
AUSSI** (verbatim moteur idempotent + autoEnrollForTrigger Sprint 46). Sprint
40 AJOUTE deux modules NEUFS au-dessus, SANS toucher l'existant :

1. **Product Reviews** (`product-reviews.ts` + table `product_reviews` +
   `product_review_helpful_votes`) : AVIS PRODUITS clients (post-purchase
   rating + body + photos + verified_buyer) — distinct des INVITATIONS d'avis
   Google/FB de `reviews.ts`. Submit PUBLIC anti-bot (honeypot `website_url` +
   rate-limit IP + verified_buyer fast-track + spam_score auto-flag).
   Modération admin queue (cap `reports.view` lecture + `clients.manage` action).
2. **Abandoned Carts multi-touch** (`abandoned-carts.ts` + ALTERs `carts`
   recovery_*) : EXTENSION ADDITIVE du E7 single-touch. Séquence 3 touches
   (1h/24h/72h) avec discount progressif 0/5/10% via engine `coupons` existant
   (seq18 + ALTER seq85). Le code E7 ignore les nouvelles colonnes et continue
   d'utiliser `recovered_at` legacy — ZÉRO régression Phase A/B.

**Régression-zéro `reviews.ts` + `ecommerce-cart-recovery.ts` garantie** :
Sprint 40 NE TOUCHE PAS ces deux fichiers. Toute logique multi-touch est dans
`abandoned-carts.ts` (nouveau). Toute logique avis produit est dans
`product-reviews.ts` (nouveau).

## §2 Migration — seq135 (DDL résumé)

Fichier racine : `migration-product-reviews-abandoned-seq135.sql`. Manifest
entrée seq135, `depends_on: ["migration-multicurrency-tax-seq134.sql",
"migration-sprintE1-m1-ecommerce-schema.sql"]` (chaînage strict + ecommerce
base).

100 % ADDITIF, zéro CHECK / FK destructrice / DROP / RENAME :

- `CREATE TABLE IF NOT EXISTS product_reviews` : id PK, client_id NOT NULL,
  product_id NOT NULL (FK applicative), customer_id NULL (FK applicative),
  order_id NULL (FK applicative), rating INTEGER DEFAULT 5 (validation
  HANDLER 1..5), title TEXT DEFAULT '', body TEXT DEFAULT '', photos_json
  TEXT NULL (JSON array URLs), verified_buyer INTEGER DEFAULT 0, status TEXT
  DEFAULT 'pending' (enum HANDLER `pending|approved|rejected|flagged`),
  moderation_notes TEXT NULL, moderator_id TEXT NULL (FK applicative users),
  moderated_at TEXT NULL, helpful_count INTEGER DEFAULT 0, spam_score INTEGER
  DEFAULT 0, submitter_ip TEXT NULL (purgée >90j Loi 25), submitter_locale
  TEXT NULL, created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS product_review_helpful_votes` : id PK,
  review_id NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE (FK
  posée car CRÉATION INITIALE = pas de rebuild SQLite), voter_ip_hash TEXT
  NOT NULL (SHA-256 hex — anonymisation Loi 25), created_at.
- `ALTER TABLE products ADD COLUMN reviews_count INTEGER DEFAULT 0`
  (régression-zéro : produits pré-existants = 0).
- `ALTER TABLE products ADD COLUMN avg_rating REAL DEFAULT 0` (idem).
- `ALTER TABLE products ADD COLUMN reviews_last_updated_at TEXT` (NULL pour
  legacy — calcul lazy à la 1re modération approuvée).
- `ALTER TABLE customers ADD COLUMN reviews_count INTEGER DEFAULT 0`.
- `ALTER TABLE customers ADD COLUMN avg_rating_given REAL DEFAULT 0`.
- `ALTER TABLE carts ADD COLUMN recovery_email_sent_count INTEGER DEFAULT 0`
  (compatible E7 — recovered_at legacy intact).
- `ALTER TABLE carts ADD COLUMN last_recovery_at TEXT` (NULL si aucune touche).
- `ALTER TABLE carts ADD COLUMN recovery_attempts_json TEXT` (NULL ou JSON
  array `[{step,channel,sent_at,coupon_code}]`).
- `ALTER TABLE carts ADD COLUMN recovery_discount_code TEXT` (code coupon
  généré via engine `coupons` existant).
- `ALTER TABLE carts ADD COLUMN recovery_completed_at TEXT` (NULL = encore
  en séquence ; non-NULL = converti via checkout ou skip manuel).

**6 indexes** :
- `idx_product_reviews_client` (client_id),
- `idx_product_reviews_product` (product_id),
- `idx_product_reviews_status` (status),
- `idx_product_reviews_customer` (customer_id),
- `uniq_product_review_helpful` UNIQUE (review_id, voter_ip_hash) — anti-rejeu
  vote utile,
- `idx_carts_recovery_state` (client_id, status, last_recovery_at) — cron scan
  séquence.

Validation enums (`status` reviews, `rating` ∈ [1..5], step ∈ {1,2,3}) SIDE-
HANDLER (`product-reviews.ts` + `abandoned-carts.ts` + libs `review-
moderation.ts` / `abandoned-cart-recovery.ts`) — calque LOT-MULTICURRENCY-TAX-
S39 §6 (pas de CHECK = pas de rebuild SQLite jamais).

## §3 Routes (4 PUBLIC + 6 AUTHED, ordre anti-shadowing strict)

### PUBLIC (4 routes, pré-requireAuth)

| Méthode | Chemin                                          | Handler                       | Fichier               |
|--------:|-------------------------------------------------|-------------------------------|-----------------------|
| GET     | `/api/products/:id/reviews`                     | `handleListProductReviews`    | product-reviews.ts    |
| POST    | `/api/products/:id/reviews`                     | `handleSubmitProductReview`   | product-reviews.ts    |
| POST    | `/api/reviews/:id/helpful`                      | `handleVoteHelpful`           | product-reviews.ts    |
| GET     | `/api/recovery/:cartToken/:step`                | `handleRecoveryLandingPage`   | abandoned-carts.ts    |

### AUTHED (6 routes)

| Méthode | Chemin                                                  | Handler                              | Capability         | Fichier               |
|--------:|---------------------------------------------------------|--------------------------------------|--------------------|-----------------------|
| GET     | `/api/reviews/moderation-queue`                         | `handleModerationQueue`              | `reports.view`     | product-reviews.ts    |
| POST    | `/api/reviews/:id/moderate`                             | `handleModerateReview`               | `clients.manage`   | product-reviews.ts    |
| DELETE  | `/api/reviews/:id`                                      | `handleDeleteReview`                 | `clients.manage`   | product-reviews.ts    |
| GET     | `/api/ecommerce/carts/abandoned/sequence`               | `handleListRecoverySequenceStates`   | `reports.view`     | abandoned-carts.ts    |
| PUT     | `/api/ecommerce/carts/:id/recovery-config`              | `handleUpdateRecoveryConfig`         | `clients.manage`   | abandoned-carts.ts    |
| POST    | `/api/recovery/cron/scan`                               | `handleCronScan`                     | `clients.manage`   | abandoned-carts.ts    |

**ORDRE ANTI-SHADOWING strict** dans `src/worker.ts` :

Public (bloc inséré après `/api/public/gift-cards/:code/balance` ~l.750) :
1. `/api/products/:id/reviews` GET puis POST (suffixe `/reviews` distinct du
   bloc `/api/products` catalogue — pas de conflit).
2. `/api/reviews/:id/helpful` POST (préfixe `/api/reviews/` — distinct du bloc
   AUTHED `/api/reviews/:id` plus loin grâce au suffixe `/helpful`).
3. `/api/recovery/:cartToken/:step` GET (préfixe `/api/recovery/` — distinct
   de `/api/recovery/cron/scan` AUTHED grâce au sous-segment `cron`).

AUTHED (bloc inséré après tax-rules ~l.3012) :
1. `/api/reviews/moderation-queue` GET (statique AVANT régex — anti-shadowing
   strict avec `/api/reviews/:id`).
2. `/api/reviews/:id/moderate` POST (suffixe `/moderate` AVANT `/:id` générique).
3. `/api/reviews/:id` DELETE (générique APRÈS tous les suffixes).
4. `/api/ecommerce/carts/abandoned/sequence` GET (statique — distinct du
   bloc E7 `/api/ecommerce/carts/abandoned` collection legacy).
5. `/api/ecommerce/carts/:id/recovery-config` PUT (régex sur `:id`).
6. `/api/recovery/cron/scan` POST (statique).

Réponses normalisées **`{ data }`** / **`{ error }`** (PAS de champ `code` —
contrat GELÉ docs/LOT-TEAM-BC.md §6.A). Phase A renvoie `501` partout SAUF :
- `handleListProductReviews` PUBLIC → `[]` (unblocking storefront).
- `handleListRecoverySequenceStates` AUTHED → `[]` (unblocking UI admin).
Calque chat-widgets Phase A + currencies Phase A `handleListCurrencies`.

## §4 Handlers (signatures FIGÉES Phase A — Phase B Manager-B remplit)

### `src/worker/product-reviews.ts` (7 handlers)

```ts
// PUBLIC
handleSubmitProductReview(request, env, productId) → Response
handleListProductReviews(request, env, productId, url) → Response
handleVoteHelpful(request, env, reviewId) → Response

// AUTHED
handleModerationQueue(env, auth, url) → Response            // cap reports.view
handleModerateReview(request, env, auth, id) → Response     // cap clients.manage
handleDeleteReview(env, auth, id) → Response                // cap clients.manage

// CRON
runReviewModerationAutoFlagCron(env) → Promise<{ rescored, flagged }>
```

### `src/worker/abandoned-carts.ts` (5 handlers + 1 cron)

```ts
// AUTHED
handleListRecoverySequenceStates(env, auth) → Response      // cap reports.view
handleUpdateRecoveryConfig(request, env, auth, cartId) → Response  // cap clients.manage
handleCronScan(env, auth) → Response                        // cap clients.manage

// PUBLIC
handleRecoveryLandingPage(request, env, cartToken, step) → Response

// CRON
runRecoverySequenceCron(env) → Promise<{ processed, sent }>
```

### `src/worker/lib/review-moderation.ts` (4 helpers — 3 purs + 1 D1)

```ts
// PURS
computeSpamScore(body, locale) → SpamScore
containsBadWords(body, locale) → boolean
autoApproveDecision(rating, verified, spamScore) → 'approved'|'pending'|'flagged'

// D1
checkVerifiedBuyer(env, clientId, productId, customerId | null, email)
  → Promise<{ verified, orderId }>
```

### `src/worker/lib/abandoned-cart-recovery.ts` (4 helpers — D1/réseau)

```ts
processRecoverySequence(env) → Promise<{ processed, sent }>           // cron core
generateRecoveryCoupon(env, clientId, cartToken, step) → Promise<string>
composeRecoveryEmail(env, cartId, step, locale)
  → Promise<{ subject, html, text }>
recordRecoveryAttempt(env, cartId, step, channel, couponCode) → Promise<boolean>
```

## §5 Types `src/lib/types.ts` + `src/lib/api.ts` (FIGÉS Phase A)

Dans `src/lib/types.ts` (append après TaxRule) :

- `type ProductReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged'`.
- `interface ProductReview` (16 champs typés).
- `interface ProductReviewSubmitInput` (rating, title?, body, email, name?,
  photos?, website_url? **honeypot**, order_id?).
- `interface RecoverySequenceState` (cart_id, cart_token,
  recovery_email_sent_count, last_recovery_at, next_recovery_due_at,
  recovery_discount_code, recovery_completed_at, attempts[]).
- Constantes `RECOVERY_DELAYS_MIN = { 1: 60, 2: 1440, 3: 4320 }`.
- Constantes `RECOVERY_DISCOUNT_PCT = { 1: 0, 2: 5, 3: 10 }`.

Dans `src/lib/api.ts` (append après deleteTaxRule) :

- 3 helpers product reviews PUBLIC : `getProductReviews(productId, filters?)`,
  `submitProductReview(productId, input)`, `voteReviewHelpful(reviewId)`.
- 3 helpers moderation AUTHED : `getModerationQueue(filters?)`,
  `moderateReview(id, input)`, `deleteReview(id)`.
- 2 helpers recovery AUTHED : `getRecoverySequenceStates()`,
  `updateRecoveryConfig(cartId, input)`.
- 4 inputs : `ProductReviewFilters`, `ModerationQueueFilters`,
  `ModerateReviewInput`, `UpdateRecoveryConfigInput`.

## §6 Contrat inter-agent FIGÉ — Phase B/C ne peuvent PAS modifier

### Règles dures

1. **100% ADDITIF, ZÉRO CHECK**. Aucun rebuild SQLite. seq135 verrou. Aucun
   champ supplémentaire en Phase B sans nouvelle seq (136+). Aucune FK
   destructrice ajoutée. SEULE EXCEPTION : la FK
   `product_review_helpful_votes.review_id ON DELETE CASCADE` est posée à la
   création (pas de rebuild) + cascade applicative redondante côté
   `handleDeleteReview`.
2. **Imports worker RELATIFS** : `import { json } from './helpers'` (pas
   d'alias `@/`). `import { RECOVERY_DELAYS_MIN } from '../../lib/types'`
   dans lib/abandoned-cart-recovery.ts (relatif up-two-levels).
3. **`json({ data })` / `json({ error }, status)`**, pas de champ `code`
   (contrat GELÉ docs/LOT-TEAM-BC.md §6.A — discrimination string-match
   côté apiFetch).
4. **Capabilities FIGÉES seq80** : `clients.manage` (mutations moderation +
   delete + recovery-config + cron-scan) + `reports.view` (lecture
   moderation-queue + sequence-states). ZÉRO ajout à `ALL_CAPABILITIES`
   (calque gift-cards.ts / loyalty.ts / tax-regions.ts).
5. **PUBLIC submit = anti-bot strict** : honeypot `website_url` (non vide ⇒
   202 silencieux) + rate-limit IP (3 req/60s via `rate_limit_buckets`
   seq121) + verified_buyer fast-track + spam_score auto-flag (>50 ⇒
   'flagged' automatique, >80 ⇒ rejet silencieux 202).
6. **Cron idempotent** : `recordRecoveryAttempt` incrémente
   `recovery_email_sent_count` ATOMICALLY (UPDATE conditional WHERE
   recovery_email_sent_count = ? AND recovery_completed_at IS NULL) — calque
   `ecommerce-cart-recovery.ts:detectAbandonedCarts` claim atomique.
   Batch borné LIMIT 50 par run (pattern `processWorkflowQueue` Sprint 46).
7. **i18n parité STRICTE 4 catalogues** (`fr-CA`, `fr-FR`, `en`, `es`) —
   31 clés exactement, identiques noms cross-catalogue. fr-CA tutoiement,
   fr-FR vouvoiement (calque MULTILANG-B). Manager-C ne change PAS les
   noms de clés. `};` final PRÉSERVÉ.
8. **Régression-zéro `reviews.ts` ABSOLUE** : Sprint 9 (review_requests +
   reviews_cache Google/FB invitations) NE DOIT JAMAIS être modifié par
   Sprint 40. Tout nouveau code va dans `product-reviews.ts` distinct.
9. **Régression-zéro `ecommerce-cart-recovery.ts` ABSOLUE** : Sprint E7
   (detectAbandonedCarts + handleRecoverCart single-touch via `recovered_at`
   legacy) NE DOIT JAMAIS être modifié. Sprint 40 lit/écrit EXCLUSIVEMENT
   les nouvelles colonnes (recovery_email_sent_count etc.) dans
   `abandoned-carts.ts` distinct.
10. **Bornage tenant strict** : `WHERE client_id = ?` sur tout
    SELECT/UPDATE/DELETE `product_reviews` (defense-in-depth IDOR sur `:id`).
    Pour `product_review_helpful_votes` via review_id : JOIN
    product_reviews garantit la borne. Pour `carts.recovery_*` : JOIN
    `carts.client_id = ?` (calque ecommerce-cart-recovery.ts:resolveClientId).
11. **Money & rating convention** : amounts EN CENTS INTEGER partout (pas de
    float pour discounts). Rating INTEGER 1..5 (validation HANDLER pas de
    CHECK). Spam score 0..100 INTEGER. Discount PCT INTEGER (5, 10 dans
    `RECOVERY_DISCOUNT_PCT`).

### Vérifications avant remise Phase A

- [x] Manifest JSON valide (parse + seq135 entry présente).
- [x] Migration `migration-product-reviews-abandoned-seq135.sql` créée à la racine.
- [x] Pas de doublons routes (10 nouvelles, anti-shadowing respecté).
- [x] i18n 4 fichiers MÊME nombre de clés (31 ajoutées, vérifié `grep -c`).
- [x] `};` final i18n PRÉSERVÉ dans chacun des 4 catalogues.
- [x] NE TOUCHE PAS `src/worker/reviews.ts` (Sprint 9 invitations Google/FB).
- [x] NE TOUCHE PAS `src/worker/ecommerce-cart-recovery.ts` (Sprint E7 single-touch).
- [x] Capabilities FIGÉES seq80 (`reports.view` + `clients.manage`) — ZÉRO
      ajout à `ALL_CAPABILITIES`.

## §7 RGPD / Conformité Loi 25 (Québec)

- **Anonymisation IP votes utiles** : `product_review_helpful_votes.voter_ip_hash`
  stocke EXCLUSIVEMENT un SHA-256 hex de l'IP du voter (calque
  `cookies-consent.ts` Loi 25). Aucune IP brute persistée.
- **submitter_ip purge automatique 90 jours** : `product_reviews.submitter_ip`
  est conservée brièvement pour modération anti-fraude. Cron à câbler Phase B
  via `runReviewModerationAutoFlagCron` : `UPDATE product_reviews SET
  submitter_ip = NULL WHERE created_at < datetime('now', '-90 days')`.
  Calque `audit_log` purge seq121 (security-compliance).
- **PII dans body avis** : le corps libre peut contenir des PII volontaires
  (nom, adresse). Pas de modération automatique PII Phase A. Phase B :
  ajouter détection email/téléphone via regex côté `computeSpamScore` (flag
  + masquage côté handler avant approve).
- **Consent explicit submit** : le formulaire frontend (Phase C) DOIT afficher
  un disclaimer Loi 25 ("Votre commentaire et votre prénom seront publiés
  publiquement") + checkbox consent explicite (calque
  `feedback_intralys_consent_loi25.md`).
- **Right-to-delete** : `handleDeleteReview` purge la ligne + helpful_votes
  cascadés. Customers peuvent demander purge via `/api/me/delete-account`
  existant (seq121) — Phase B câblera la suppression cross-table dans
  `me-privacy.ts` (HORS SCOPE Phase A — figé `clients.manage` admin only).
- **Recovery emails** : la séquence multi-touch déclenche jusqu'à 3 emails
  marketing en 72h. Respect du DND (`isLeadDnd`) OBLIGATOIRE côté
  `processRecoverySequence` Phase B — calque `reviews.ts:handleCreateReviewRequest`.
  Le customer peut demander unsubscribe via lien `/u/:token` existant.
- **`recovery_attempts_json` retention** : conservé jusqu'à
  `recovery_completed_at` + 1 an (calque rétention orders). Cron purge Phase
  future (HORS SCOPE Phase A).

## §8 Sécurité

- **Validation enums STRICTE side-handler** : `status` ∈
  {pending|approved|rejected|flagged}, `rating` ∈ [1..5], `action` modération
  ∈ {approve|reject|flag}, `channel` recovery ∈ {email|sms}, `step` ∈ {1,2,3}.
  Toute valeur hors-enum ⇒ `{ error: 'Champ invalide' }` 400 (calque
  ecommerce-region.ts handler PUT / tax-regions.ts).
- **Bornage tenant defense-in-depth** : tous les SELECT/UPDATE/DELETE incluent
  `WHERE client_id = ?` même sur lookup par `:id` (anti-IDOR). Pour
  helpful_votes via review_id : JOIN product_reviews. Pour carts via cartId :
  JOIN carts.client_id (calque ecommerce-cart-recovery.ts:resolveClientId).
- **Honeypot `website_url`** : champ caché frontend (visibility:hidden + label
  off-screen). Toute valeur ≠ '' ⇒ response 202 `{ data: { ok: true } }`
  silencieux (anti-bot scrap qui croit avoir réussi). Calque pattern
  `intralys-form-honeypot` skill.
- **Rate-limit submit** : 3 req / IP / 60s via `rate_limit_buckets` seq121
  (HMAC bucket = `submit:${ip_hash}`). Dépassement ⇒ 429 `{ error: 'Trop de
  tentatives, réessayez plus tard' }`.
- **HMAC `cartToken`** : généré par `composeRecoveryEmail` via
  `env.RECOVERY_SECRET` (à provisionner Phase B — calque `env.JWT_SECRET`).
  Format : `${cart_id}.${signature_8_chars}`. Vérification côté
  `handleRecoveryLandingPage` AVANT toute lecture cart.
- **Cap `reports.view` lecture / `clients.manage` mutations** : strict — pas
  de fallback role===admin (calque tax-regions.ts:requireSettingsManage
  pattern). Auth viewer ne peut PAS modérer/supprimer.

## §9 Régression-zéro paiements + flux GHL

- **Sprint 40 = no-touch paiements régulés** : aucun écrit dans `payments`,
  `payment_events`, `payment_provider_config`, `refunds`, `disputes`,
  `return_requests` (tables E4/E6 régulées). Le coupon généré côté recovery
  est validé EN AMONT du checkout existant (calque `ecommerce-coupons.ts`
  Sprint 4) — `createOrderCore` reste INCHANGÉ.
- **`reviews.ts` (Sprint 9) inchangé** : invitations Google/FB +
  `review_requests` + `reviews_cache` + `handleSuggestReviewReply` Anthropic
  Haiku — TOUT INTACT. Sprint 40 n'utilise ni table ni helper de ce fichier.
- **`ecommerce-cart-recovery.ts` (Sprint E7) inchangé** :
  `detectAbandonedCarts` + `handleRecoverCart` + `detectWinBackCustomers` +
  `handleListAbandonedCarts` — TOUT INTACT. La colonne `recovered_at` legacy
  reste utilisée par E7 ; Sprint 40 utilise EXCLUSIVEMENT les nouvelles
  colonnes `recovery_*`.

## §10 Crons (admin-trigger Phase A, scheduled() Phase future)

- **`POST /api/recovery/cron/scan`** (`clients.manage`) :
  - Délègue à `processRecoverySequence(env)` (lib/abandoned-cart-recovery.ts).
  - Itère paniers `status='abandoned' AND recovery_completed_at IS NULL AND
    recovery_email_sent_count < 3` LIMIT 50 (batch borné).
  - Pour chaque cart éligible : génère coupon (si step≥2) + compose email +
    record attempt atomiquement.
  - Idempotent : `recordRecoveryAttempt` UPDATE conditional anti-rejeu.
  - Réponse : `{ data: { processed: number, sent: number } }`.
- **Cron auto-flag reviews** : `runReviewModerationAutoFlagCron(env)` — pas
  d'endpoint admin Phase A (HORS SCOPE). À câbler dans `scheduled()` worker.ts
  Phase future (trigger horaire `0 * * * *`).
- **À câbler dans `scheduled()` worker.ts** (TODO Phase B) : trigger
  quart-horaire `*/15 * * * *` (toutes les 15 min) pour `runRecoverySequenceCron`.
  Pour Phase A : déclenche manuel via UI admin (`/api/recovery/cron/scan`).

## §11 Découpe Phase B (Manager-B backend ∥ Manager-C frontend)

- **Manager-B** :
  - Remplit les 3 handlers PUBLIC `product-reviews.ts` (submit anti-bot,
    list approved, vote helpful) + 3 handlers AUTHED moderation (queue,
    moderate, delete).
  - Remplit les 4 helpers `lib/review-moderation.ts` (computeSpamScore,
    containsBadWords, checkVerifiedBuyer, autoApproveDecision).
  - Remplit les 3 handlers AUTHED `abandoned-carts.ts` (list sequence,
    update config, cron scan) + 1 PUBLIC (landing page HMAC).
  - Remplit les 4 helpers `lib/abandoned-cart-recovery.ts`
    (processRecoverySequence, generateRecoveryCoupon, composeRecoveryEmail,
    recordRecoveryAttempt) — RÉUTILISE engine `coupons` existant
    (seq18 + ALTER seq85) pour discount progressif 0/5/10%.
  - Câble `runReviewModerationAutoFlagCron` + `runRecoverySequenceCron` dans
    `scheduled()` worker.ts (toutes les 15 min).
  - ZÉRO fichier partagé avec C.

- **Manager-C** :
  - Pages `/products/:id` (composant `ProductReviewsList` + `SubmitReviewForm`
    avec honeypot + checkbox Loi 25), `/admin/reviews/queue` (queue
    modération avec actions approve/reject/flag + filtres status/product),
    `/ecommerce/carts/abandoned/sequence` (timeline 3 touches + skip/resend/
    pause per cart).
  - Composants : `StarRating`, `VerifiedBadge`, `HelpfulButton`,
    `ModerationQueueRow`, `RecoverySequenceTimeline`, `RecoveryDiscountPill`.
  - Intégration des 31 clés i18n (parité 4 catalogues).
  - ZÉRO fichier partagé avec B (api.ts en lecture pour C).

- **Hooks intégration** : Phase C (Sprint 41+) câblera l'affichage
  `avg_rating` + `reviews_count` sur storefront product cards (calque
  Storefront S7 existant) — hors scope Phase A.

## §11 Métriques (KPIs recovery + reviews)

### Reviews KPIs

- **Submission rate** : `count(product_reviews) / count(orders WHERE
  status='paid')` — cible >5 % post-purchase.
- **Approval rate** : `count(status='approved') / count(submissions)` —
  cible >70 % (verified_buyer fast-track auto-approve).
- **Spam catch rate** : `count(status='flagged' OR 'rejected') /
  count(submissions)` — cible <15 % (au-delà = trop strict, fastidieux
  pour modérateur).
- **Helpful engagement** : `sum(helpful_count) / count(status='approved')`
  — proxy qualité contenu, cible >0.5 vote/avis.
- **Photo enrichment** : `count(photos_json IS NOT NULL) /
  count(status='approved')` — cible >20 %.
- **Avg rating drift** : monitoring `avg_rating` par produit sur
  rolling 30j — alerte si chute >0.5 étoile.

### Recovery KPIs (par step)

| KPI                           | Formule                                                                 | Cible step 1 | Cible step 2 | Cible step 3 |
|-------------------------------|-------------------------------------------------------------------------|--------------|--------------|--------------|
| **Sent rate**                 | `count(attempts WHERE step=N) / count(eligible carts at step N)`        | >95 %        | >90 %        | >85 %        |
| **Open rate**                 | `count(opened_at IS NOT NULL AT step=N) / sent at step N`               | >40 %        | >35 %        | >25 %        |
| **Click rate**                | `count(clicked_at IS NOT NULL AT step=N) / sent at step N`              | >8 %         | >12 %        | >15 %        |
| **Recovery rate (per step)**  | `count(completed via step=N) / sent at step N`                          | >3 %         | >5 %         | >8 %         |
| **Cumulative recovery rate**  | `count(recovery_completed_at NOT NULL) / count(abandoned carts last 30d)` | n/a       | n/a          | >12 % global |
| **Unsubscribe rate**          | `count(customers SET dnd=1 via recovery link) / sent total`             | <0.5 %       | <1 %         | <2 %         |
| **DND skip rate**             | `count(attempts WHERE status='skipped_dnd') / eligible`                 | tracker      | tracker      | tracker      |

### Source des KPIs

- Reviews : agrégations `SELECT status, COUNT(*) FROM product_reviews
  GROUP BY status` par client_id.
- Recovery : parsing `recovery_attempts_json` côté UI admin
  (`RecoverySequenceTimeline` Manager-C). Phase B optionnel :
  matérialiser dans `cart_events` (`type='recovery_opened|clicked|
  converted'`) pour requêtes SQL natives plus rapides.

## §12 Hors-scope v2 (TODO Phase future)

### Reviews

- **Visual editor templates email moderation** : actuellement le notif
  modérateur "Nouvel avis à modérer" est un template fixe TS. v2 : table
  `review_moderation_templates` + WYSIWYG admin.
- **Bulk moderation** : actions batch (select N reviews → approve all)
  via shift+click. UI Manager-C Phase A : action ligne-par-ligne.
- **A/B testing copy** : variant SubmitReviewForm CTA copy + placement
  (post-purchase email vs storefront vs in-app) avec tracking conversion.
- **AI moderation Anthropic Haiku** : remplacer `containsBadWords` regex
  par classifier IA contextualisé (sarcasm, threats, PII détection
  nuancée). Hors-scope v1 — coût + latence cron.
- **Reviews video upload** : actuellement `photos_json` array URLs R2.
  v2 : `videos_json` avec transcodage HLS (R2 + Cloudflare Stream).
- **Reviews translation auto** : afficher avis traduits dans la locale
  visiteur via Anthropic Haiku + cache D1 (`reviews_translations` table).
- **Reviews aggregation Schema.org** : injecter `AggregateRating` JSON-LD
  sur product pages (déjà schéma `<Product>` storefront — TODO ajouter
  `aggregateRating: { ratingValue, reviewCount }`).

### Recovery

- **A/B testing templates** : variant A/B par customer_id hash, tracking
  per-variant recovery rate (cf. §10 RECOVERY-WORKFLOW-S40.md).
- **SMS channel actif** : déjà cf. §10 RECOVERY-WORKFLOW-S40.md.
- **Recovery analytics dashboard** : composant
  `RecoveryAnalyticsDashboard` per-client agrégeant KPIs §11 ci-dessus.
- **Personnalisation IA subject lines** : Anthropic Haiku reformule
  subject par segment customer (`vip` / `cold` / `at_risk` /
  `new_customer`).
- **Multi-channel séquence mixte** : step 1 email + step 2 SMS fallback
  si email bounce + step 3 push notification (PWA installed).
- **Win-back séquence post-recovery** : si customer convertit via
  recovery step 3 (donc gros discount nécessaire), trigger séquence
  follow-up 30j plus tard pour fidélisation.
- **Cooldown configurable** : `RecoveryConfig.cooldown_days` per-client
  (default 7) avant de re-trigger une séquence sur le même customer.
- **Webhook out** : POST `customer.recovered_cart` vers URL configurée
  client (calque `outbound-webhooks.ts` existant Sprint 24).

## §13 Doc compagnon — (à venir Phase C)

Conventions UX submit avis (mobile-first, photo upload R2 5 max), modération
batch (bulk approve via shift+click — calque admin patterns), recovery
landing page (cart reconstruit + coupon auto-appliqué + tracking
`cart.recovery_clicked`) documentés dans `REVIEWS-ABANDONED-UX-S41.md` Sprint
41+.

Doc compagnon technique recovery workflow (séquence multi-touch, idempotence
cron, templates × 4 locales × 3 steps, RGPD opt-out, exemple
`attempts_json`) : **`RECOVERY-WORKFLOW-S40.md`** (créé Phase A, mis à
jour Phase B au câblage `scheduled()`).
