# LOT 3 — Sprint 31 : Billing Stripe live activation (E4 marchand + SaaS)

> Doc contrat §6 figé. Migration : seq126 — `migration-billing-stripe-live-seq126.sql`.
> Compagnons : `LOT-BILLING-STRIPE-MOCK.md` (Sprint 22 fondations SaaS mock), `PCI-SAQ-A.md`, `STRIPE-DATA-FLOW.md`.

## Objectif

Activer les paiements Stripe **réels** sur les deux périmètres simultanément, avec activation **graduée par tenant** (feature flag `BILLING_LIVE_ENABLED`) et garde-fous PCI-DSS SAQ-A :

- **E4 marchand** (vente produits côté tenant) : `payment_methods` clients + `stripe_connect_accounts` agences (Stripe Connect Express/Standard/Custom).
- **SaaS Intralys** (abo agence → Intralys) : pose les colonnes `stripe_customer_id` / `stripe_subscription_id` exploitables sur l'`subscriptions` Sprint 22.

Tant que `STRIPE_SECRET_KEY` absente ou flag tenant non levé → tous les endpoints conservent l'idiome `mock:true` introduit Sprint 22.

## Distinction critique Sprint 22 mock vs Sprint 31 live

| Aspect | Sprint 22 (`seq120`) | Sprint 31 (`seq126`) |
|---|---|---|
| Périmètre | SaaS Intralys uniquement (abo agence) | E4 marchand **+** SaaS Intralys |
| Stripe API | Aucun appel (`api.stripe.com` interdit) | Appels réels via `STRIPE_SECRET_KEY` |
| Tables ajoutées | `billing_plans`, `billing_events`, `billing_invoices_mock` | `payment_methods`, `stripe_connect_accounts` |
| Alter `subscriptions` | 10 colonnes nullable (customer/price/period/cancel/etc.) | Index complémentaires sur colonnes Sprint 22 |
| Card data | Aucune (factures mock) | **Jamais persistée** — Stripe.js → SetupIntent → Stripe (cf. STRIPE-DATA-FLOW §3) |
| PCI scope | Hors scope (mock) | **SAQ-A** (redirect/hosted fields uniquement) |
| Activation | Globale (V1 = `live_branch_locked`) | Tenant-by-tenant (`BILLING_LIVE_ENABLED` flag) |
| Webhook | `verifyStripeWebhookSignatureSaas` mock | Vérification signature `STRIPE_WEBHOOK_SECRET` réelle |

Le Sprint 22 a posé les **rails** SaaS sans toucher au marchand. Le Sprint 31 **active** les rails + ajoute le marchand. Aucun rollback Sprint 22 nécessaire — extension chirurgicale uniquement.

## Hors-scope

- **ACH / SEPA / wires bancaires** → backlog (PCI SAQ-D requis, hors scope SAQ-A)
- **POS / Stripe Terminal** → backlog (hardware + PCI P2PE)
- **Stripe Tax (auto tax computation)** → backlog E6 (déjà mentionné LOT-BILLING-STRIPE-MOCK)
- **Stripe Issuing (cartes émises)** → hors roadmap
- **Stripe Treasury** → hors roadmap
- **Multi-currency dynamic** → backlog E6
- **Subscription proration custom UI** → V1 = Stripe portal redirect
- **Dunning runner custom** → V1 = Stripe Smart Retries
- **3DS challenge UI custom** → V1 = Stripe.js redirect natif
- **Apple Pay / Google Pay domain registration auto** → backlog ops (manuel pour V1)
- **Connect Custom KYC UI** → V1 = Express + Standard onboarding hosted uniquement
- **Saved payment method update form (CVV re-collect)** → V1 = supprimer + ajouter
- **Refunds UI marchand** → réutilise pipeline E6 existant (seq65), aucun ajout

## §6 Contrats figés

### 6.1 Migration SQL

Fichier racine : `migration-billing-stripe-live-seq126.sql`. Manifest entrée seq126 (`docs/migrations-manifest.json`).

Pattern 100 % ADDITIF :

- `ALTER TABLE subscriptions` — index complémentaires sur `stripe_subscription_id` (UNIQUE partial WHERE NOT NULL) + `stripe_customer_id`.
- `CREATE TABLE IF NOT EXISTS payment_methods` — modes de paiement clients (`client_id`, `stripe_payment_method_id` UNIQUE, `type`, `brand`, `last4`, `exp_month`, `exp_year`, `is_default`, `created_at`). **Card data full PAN/CVV jamais stockée** — seulement les 4 derniers chiffres + brand + exp (PCI SAQ-A compliant, cf. PCI-SAQ-A §2.3).
- `CREATE TABLE IF NOT EXISTS stripe_connect_accounts` — comptes vendeurs Stripe Connect (`client_id`, `stripe_account_id` UNIQUE, `account_type`, `charges_enabled`, `payouts_enabled`, `details_submitted`, `capabilities_json`, `requirements_json`, `onboarding_completed_at`, `created_at`, `updated_at`).
- Index `idx_payment_methods_client`, `idx_payment_methods_default`, `idx_stripe_connect_client`, `idx_stripe_connect_account`.

Aucun CHECK ajouté. Validation appartient au handler `stripe-live.ts`. Aucune colonne droppée. Migration `seq126` réversible logiquement (DROP TABLE IF EXISTS) — mais pas en prod si données présentes.

Dépendances déclarées : `migration-billing-stripe-mock-seq120.sql` (colonnes SaaS) + `migration-sprintE4-m1.sql` (payment_provider_config marchand).

### 6.2 Types TypeScript

Ajoutés à `src/lib/types.ts` (append, après `ReleaseGatesRun`) :

- `PaymentMethodBrand` = `'visa'|'mastercard'|'amex'|'discover'|'diners'|'jcb'|'unionpay'|'unknown'`
- `PaymentMethodType` = `'card'|'apple_pay'|'google_pay'`
- `StripePaymentMethod` — mode de paiement client (id, stripePaymentMethodId, type, brand, last4, expMonth, expYear, isDefault, createdAt).
- `StripeSetupIntent` — `{ clientSecret, setupIntentId }` retourné au front pour confirmer la carte côté Stripe.js (aucune donnée carte ne transite par notre worker).
- `StripeConnectAccount` — état compte Connect (chargesEnabled, payoutsEnabled, detailsSubmitted, capabilities, requirements, onboardingCompletedAt).
- `StripeConnectOnboardingLink` — `{ url, expiresAt }` lien onboarding hosted Stripe.

### 6.3 Schemas zod

Ajoutés à `src/lib/schemas.ts` (append) :

- `BillingConnectOnboardSchema` `{ refreshUrl?, returnUrl? }` — URLs callback hosted onboarding.
- `BillingSetupIntentSchema` — `z.object({}).optional()` (POST sans body).
- `BillingPaymentMethodIdSchema` `{ paymentMethodId }` — Stripe PaymentMethod ID (`pm_xxx`).
- `BillingSetDefaultPaymentMethodSchema` — `z.object({}).optional()` (POST sans body, ID dans le path).

### 6.4 API front

Ajoutées à `src/lib/api.ts` (append) :

- `getStripeConnectStatus()` → `GET /api/billing/connect/status`
- `createStripeConnectOnboarding(body)` → `POST /api/billing/connect/onboard`
- `listStripePaymentMethods()` → `GET /api/billing/payment-methods`
- `createStripeSetupIntent()` → `POST /api/billing/payment-methods/setup-intent`
- `setDefaultStripePaymentMethod(pmId)` → `POST /api/billing/payment-methods/:pmId/default`
- `deleteStripePaymentMethod(pmId)` → `DELETE /api/billing/payment-methods/:pmId`

### 6.5 i18n

~30 clés `billing.real.*` ajoutées en bloc dans les 4 catalogues (fr-CA, fr-FR, en, es). Parité stricte. fr-CA tutoiement (`Active`, `Reçois`, `Réessaye`, `ton compte`), fr-FR vouvoiement (`Activez`, `Recevez`, `Réessayez`, `votre compte`). Namespaces : `billing.real.activation.*`, `billing.real.payment_method.*`, `billing.real.connect.*`, `billing.real.error.*`.

Clé `billing.real.payment_method.pci_notice` = mention légale PCI obligatoire à afficher sous tout formulaire carte (cf. PCI-SAQ-A §4 + RGPD-STRIPE-LIVE §2).

### 6.6 Handlers worker (Manager-B)

`src/worker/stripe-live.ts` — handlers Phase A (stubs) :

- `handleGetConnectStatus(env, auth)`
- `handleCreateConnectOnboarding(request, env, auth)`
- `handleListPaymentMethods(env, auth)`
- `handleCreateSetupIntent(env, auth)`
- `handleSetDefaultPaymentMethod(request, env, auth, pmId)`
- `handleDeletePaymentMethod(env, auth, pmId)`

Manager-B remplira les corps : persistance D1 + capGuard `billing.view` (lectures) / `settings.manage` (mutations) + idiome graduel `if (!isLiveEnabledForTenant(env, auth.clientId)) return { success:true, mock:true, reason:'live_branch_locked' }`.

### 6.7 Helpers stubs

`src/worker/lib/stripe-live-client.ts` :

- `isLiveEnabledForTenant(env, clientId): boolean` — combinaison flag global `STRIPE_SECRET_KEY` présent + flag tenant `BILLING_LIVE_ENABLED` levé pour ce `clientId`.
- `getStripeClient(env)` — initialise le SDK Stripe (lazy import, server-side only).
- `verifyStripeWebhookSignatureLive(env, rawBody, sigHeader) → { verified, reason? }` — vraie vérification avec `STRIPE_WEBHOOK_SECRET` (distinct du mock SaaS Sprint 22).

### 6.8 Routes worker

6 routes câblées dans `src/worker.ts` après le bloc Sprint 22 `/api/billing/webhook-config` :

```
GET    /api/billing/connect/status
POST   /api/billing/connect/onboard
GET    /api/billing/payment-methods
POST   /api/billing/payment-methods/setup-intent
POST   /api/billing/payment-methods/:pmId/default
DELETE /api/billing/payment-methods/:pmId
```

Style dynamique `await import('./worker/stripe-live')` — calque le bloc SaaS billing voisin.

### 6.9 Composants frontend (Manager-C)

Skeletons à créer dans `src/components/billing/` :

- `StripeConnectPanel.tsx` — statut compte vendeur + CTA onboarding (lien hosted Stripe)
- `PaymentMethodsList.tsx` — liste cartes existantes + default badge + delete confirm
- `AddPaymentMethodForm.tsx` — wrapper Stripe.js Elements (SetupIntent → confirmCardSetup côté client)
- `BillingPciNotice.tsx` — bandeau PCI réutilisable (clé `billing.real.payment_method.pci_notice`)

Manager-C remplira les corps. **Interdit** : tout composant qui collecte directement PAN/CVV — uniquement Stripe Elements hosted ou Payment Element.

## Garde-fous PCI + activation graduée

### PCI-DSS SAQ-A (cf. PCI-SAQ-A.md)

- **Card data full jamais persistée** : seuls `last4` + `brand` + `exp_month/year` stockés dans `payment_methods`. Le full PAN/CVV transite **uniquement** entre le navigateur du client et `api.stripe.com` via Stripe.js iframes ou Payment Element.
- **SetupIntent pattern obligatoire** : worker crée le `clientSecret`, front confirme côté Stripe.js. Aucun endpoint worker ne reçoit jamais de PAN/CVV en body. Schema `BillingPaymentMethodIdSchema` accepte seulement `pm_xxx` (PaymentMethod ID post-tokenization).
- **PCI notice obligatoire** : afficher `billing.real.payment_method.pci_notice` sous chaque formulaire d'ajout de carte (cf. STRIPE-DATA-FLOW §2.4).
- **Webhook signature obligatoire** : `verifyStripeWebhookSignatureLive` doit retourner `{ verified: true }` avant tout traitement event. Sinon `403`.
- **HTTPS-only** : worker rejette tout payload `setup-intent` reçu en HTTP (déjà géré par CF Workers).
- **Logs sanitization** : aucun log ne doit contenir `pm_xxx` ou `seti_xxx` en clair (cf. audit_log seq121 — utiliser `[REDACTED]`).

### Activation graduée par tenant

- V1 = `STRIPE_SECRET_KEY` posée côté infra **mais** `BILLING_LIVE_ENABLED` levée tenant-by-tenant via override admin (table `clients.metadata_json.billing_live_enabled = 1`).
- Tant que flag tenant absent → tous les endpoints retournent `{ success: true, mock: true, reason: 'live_branch_locked' }` même si infra Stripe configurée.
- Webhook `/api/webhook/stripe` extension chirurgicale Manager-B : route les events Connect vers `stripe-live.ts`, events SaaS billing vers `saas-billing.ts` Sprint 22, fallback inchangé. **Aucun dédoublonnage** entre les 3 handlers.
- `ALL_CAPABILITIES` réutilise `billing.view` + `settings.manage` Sprint 22 — aucune nouvelle capability ajoutée.
- Imports worker relatifs (`./lib/stripe-live-client`, `../lib/types`) — pas d'alias `@/` côté worker.
- `STRIPE_SECRET_KEY?` et `STRIPE_WEBHOOK_SECRET?` déjà déclarés dans `src/worker/types.ts:48-49` — non rééditer.

### Rollback path

- Désactiver tous tenants : DELETE flag `billing_live_enabled` sur tous les `clients.metadata_json` → retour idiome mock instantané.
- Désactiver infra : `wrangler secret delete STRIPE_SECRET_KEY` → `isLiveEnabledForTenant` retourne `false` → retour idiome mock.
- Tables `payment_methods` et `stripe_connect_accounts` jamais droppées en prod (perte historique). Idempotent `IF NOT EXISTS`.

## Cross-references

- `LOT-BILLING-STRIPE-MOCK.md` — Sprint 22 fondations SaaS billing
- `PCI-SAQ-A.md` — Self-Assessment Questionnaire A (Manager-B2)
- `STRIPE-DATA-FLOW.md` — diagramme flux carte navigateur → Stripe (Manager-B2)
- `RGPD-STRIPE-LIVE.md` — analyse RGPD activation paiements (Manager-B3)
- `BINDINGS-SECRETS-S10.md` — déclaration `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- `migrations-manifest.json` seq126 — ordre canonique migration
