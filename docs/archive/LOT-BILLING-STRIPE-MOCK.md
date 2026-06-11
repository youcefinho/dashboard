# LOT 3 — Sprint 22 : Billing Stripe prod (E4 flag mock)

> Doc contrat §6 figé. Migration : seq120 — `migration-billing-stripe-mock-seq120.sql`.

## Objectif

Poser les rails complets de billing/abonnement SaaS (plans, quotas, portail, webhooks) en mode MOCK total — aucun appel `api.stripe.com`. L'activation réelle = revue PCI/RGPD/légale Rochdi post-RC.

## Distinction critique

- E4 marchand (seq62/65) `payments`/`payment_events`/`refunds` = vente produits côté tenant via Stripe Connect ⇒ **NON RÉUTILISÉ**.
- SaaS Intralys (seq120) `billing_plans`/`billing_events`/`billing_invoices_mock` = abo agence → Intralys ⇒ DISTINCT.

## Hors-scope (renvoyé)

- Activation paiement réel → revue PCI Rochdi
- Édition admin CRUD plans → backlog
- Analytics revenus MRR/ARR → Sprint 24
- Tax/multi-currency → backlog E6
- Coupons/discounts → backlog
- Dunning runner → backlog

## §6 Contrats figés

### 6.1 Migration SQL

Fichier racine : `migration-billing-stripe-mock-seq120.sql`. Manifest entrée seq120 (`docs/migrations-manifest.json`).

Pattern 100 % ADDITIF :

- `ALTER TABLE subscriptions ADD COLUMN` × 10 colonnes nullable (stripe_customer_id, stripe_price_id, billing_period, trial_ends_at, cancel_at_period_end DEFAULT 0, canceled_at, current_period_start, provider, metadata_json, updated_at).
- `CREATE TABLE IF NOT EXISTS billing_plans` (catalogue 4 tiers seedés idempotent : free, starter, pro, unlimited — prices CAD).
- `CREATE TABLE IF NOT EXISTS billing_events` (log webhook Stripe SaaS, DISTINCT de payment_events E4, UNIQUE (provider, provider_event_id) pour idempotence).
- `CREATE TABLE IF NOT EXISTS billing_invoices_mock` (factures SaaS en mode démo, is_mock DEFAULT 1).

Aucun CHECK n'est ajouté ni modifié. Validation appartient au handler `saas-billing.ts`.

### 6.2 Types TypeScript

Ajoutés à `src/lib/types.ts` (append) :

- `PlanTier` = `'free' | 'starter' | 'pro' | 'unlimited'`
- `BillingPeriod` = `'monthly' | 'yearly'`
- `SubscriptionStatus` = `'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused'`
- `BillingProvider` = `'stripe' | 'mock'`
- `BillingPlanLimits`, `BillingPlanCatalog`, `ClientSubscription`, `BillingUsage`, `BillingPortalSession`, `BillingInvoiceMock`, `BillingWebhookConfig`, `StripeWebhookEventMock`.

### 6.3 Schemas zod

Ajoutés à `src/lib/schemas.ts` (append) :

- `BillingSubscriptionChangeSchema` `{ planTier, billingPeriod? }`
- `BillingPortalSessionSchema` `{ returnUrl? }`
- `BillingCancelSchema` `{ reason?, atPeriodEnd:boolean=true }`

### 6.4 API front

Ajoutées à `src/lib/api.ts` (append) :

- `getBillingPlans()` → `GET /api/billing/plans`
- `getCurrentSubscription()` → `GET /api/billing/subscription`
- `changeSubscriptionPlan(body)` → `POST /api/billing/subscription/change`
- `cancelSubscription(body)` → `POST /api/billing/subscription/cancel`
- `resumeSubscription()` → `POST /api/billing/subscription/resume`
- `createBillingPortalSession(body)` → `POST /api/billing/portal-session`
- `getBillingUsage()` → `GET /api/billing/usage`
- `listBillingInvoices()` → `GET /api/billing/invoices`
- `getBillingWebhookConfig()` → `GET /api/billing/webhook-config`

### 6.5 i18n

~60 clés `billing.*` ajoutées en bloc dans les 4 catalogues (fr-CA, fr-FR, en, es). Parité stricte. fr-CA tutoiement, fr-FR vouvoiement. Namespaces : `billing.plans.*`, `billing.subscription.*`, `billing.action.*`, `billing.portal.*`, `billing.invoices.*`, `billing.mock.*`, `billing.webhook.*`.

### 6.6 Handlers worker

`src/worker/saas-billing.ts` — 10 stubs handlers (Phase A) :

- `handleListBillingPlans(env, auth)`
- `handleGetCurrentSubscription(env, auth)`
- `handleChangeSubscriptionPlan(request, env, auth)`
- `handleCancelSubscription(request, env, auth)`
- `handleResumeSubscription(env, auth)`
- `handleCreatePortalSession(request, env, auth)`
- `handleGetBillingUsage(env, auth)`
- `handleListBillingInvoices(env, auth)`
- `handleGetWebhookConfig(env, auth)`

Manager-B remplira les corps (persistance D1 + capGuard `billing.view` lectures / `settings.manage` mutations + idiome mock `live_branch_locked`).

### 6.7 Helpers stubs

`src/worker/lib/saas-billing-mock.ts` :

- `isStripeConfigured(env): boolean`
- `buildMockStripeCustomer(clientId: string): string`
- `buildMockPortalUrl(agencyId: string): string`
- `verifyStripeWebhookSignatureSaas(env, rawBody, sigHeader) → { verified, mock, reason? }`

### 6.8 Routes worker

9 routes câblées dans `src/worker.ts` après le bloc `/api/agency/plan` (LOT 3 SaaS M2, ligne ~2270) :

```
GET    /api/billing/plans
GET    /api/billing/subscription
POST   /api/billing/subscription/change
POST   /api/billing/subscription/cancel
POST   /api/billing/subscription/resume
POST   /api/billing/portal-session
GET    /api/billing/usage
GET    /api/billing/invoices
GET    /api/billing/webhook-config
```

Style dynamique `await import('./worker/saas-billing')` — calque le bloc `/api/agency/plan` voisin.

### 6.9 Composants frontend

6 skeletons créés dans `src/components/billing/` :

- `BillingPlanPanel.tsx`
- `PlanSelector.tsx`
- `BillingPortalButton.tsx`
- `BillingInvoicesList.tsx`
- `BillingMockBanner.tsx`
- `WebhookConfigPanel.tsx`

Manager-C remplira corps.

## Garde-fous

- Idiome mock systématique : `if (!env.STRIPE_SECRET_KEY) return { success:true, mock:true }`
- V1 = `live_branch_locked` même si clés posées (E4 marchand intouché, SaaS reste démo)
- Webhook `/api/webhook/stripe` (billing.ts) EXTENSION chirurgicale par Manager-B, pas dupliqué
- `ALL_CAPABILITIES` figées : `billing.view` + `settings.manage` seulement
- Imports worker relatifs (`./lib/saas-billing-mock`, `../lib/types`) — pas d'alias `@/` côté worker
- `STRIPE_SECRET_KEY?` et `STRIPE_WEBHOOK_SECRET?` déjà déclarés dans `src/worker/types.ts:48-49` — non rééditer
