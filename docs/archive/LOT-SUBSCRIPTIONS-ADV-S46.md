# LOT — Sprint 46 : Subscriptions avancées (trials + proration + dunning + pause/resume + MRR)

> Doc contrat §6 figé. Migration : seq141 — `migration-subscriptions-advanced-seq141.sql`.
> Compagnons : `LOT-BILLING-STRIPE-MOCK.md` (Sprint 22 fondations SaaS mock), `LOT-BILLING-STRIPE-LIVE.md` (Sprint 31 activation Stripe live).

## Objectif

Étendre les rails billing Stripe S22/S31 avec les **fonctionnalités d'abonnement avancées** attendues d'un SaaS V1.0 mature, sans toucher aux handlers existants :

- **Trials configurables** (7/14/30 jours) — paramétrables par plan via `billing_plans.trial_days`, appliqués au provisioning via `subscriptions.trial_ends_at`.
- **Proration upgrades/downgrades** — calcul pure HANDLER (`subscription-engine.computeProration`) avec préview avant mutation, audité dans `subscription_changes`.
- **Dunning smart retries** — schedule canonique 1d / 3d / 7d (`computeNextDunningAt`), stratégie par failure reason Stripe (`pickDunningStrategy`), persisté sur `subscriptions.dunning_attempts` + `next_dunning_at` + `dunning_log_json`.
- **Pause / resume** — flag `billing_plans.allow_pause` + état `subscriptions.paused_at` / `paused_until`. Pause indéfinie (resume manuel) ou planifiée (auto-resume à la date).
- **Métriques MRR / ARR / churn / growth** — table `mrr_snapshots` alimentée par cron quotidien `computeMrr`, agrégat période via `/api/billing/metrics/mrr`.
- **History audit** — toute mutation (upgrade/downgrade/pause/resume/trial_start/trial_end/dunning_attempt/cancel/reactivate) écrit une ligne dans `subscription_changes`.

Tant que `BILLING_LIVE_ENABLED` n'est pas levé pour ce tenant → tous les endpoints retournent `mock:true` + `reason:'live_branch_locked'` (idiome Sprint 22 / 31 préservé).

## Distinction critique Sprint 22 / 31 / 46

| Aspect | Sprint 22 (`seq120`) | Sprint 31 (`seq126`) | Sprint 46 (`seq141`) |
|---|---|---|---|
| Périmètre | SaaS Intralys (abo agence) — rails mock | E4 marchand + activation Stripe live | Extension trials / proration / dunning / pause / MRR |
| Tables ajoutées | `billing_plans`, `billing_events`, `billing_invoices_mock` | `payment_methods`, `stripe_connect_accounts` | `subscription_changes`, `mrr_snapshots` |
| Alter `subscriptions` | 10 colonnes nullable (customer/price/period/cancel/...) | Index complémentaires | 7 colonnes nullable (prorated_amount_cents, paused_at, paused_until, dunning_attempts, dunning_log_json, next_dunning_at, trial_ends_at idem seq120) |
| Alter `billing_plans` | — | — | 3 colonnes nullable (trial_days, allow_pause, cancellation_policy) |
| Handlers worker | `saas-billing.ts` | `stripe-live.ts` + `saas-billing-connect.ts` + `saas-billing-payment-methods.ts` | `subscriptions-advanced.ts` (NEUF, séparé) |
| Helpers lib | `lib/saas-billing-mock.ts` | `lib/saas-billing-live.ts` + `lib/stripe-live-client.ts` | `lib/subscription-engine.ts` (NEUF, séparé) |
| Capabilities | `billing.view` / `settings.manage` | `billing.view` / `settings.manage` | `settings.manage` partout (AUCUN ajout seq80) |
| Activation | Globale (V1 = `live_branch_locked`) | Tenant-by-tenant (`BILLING_LIVE_ENABLED` flag) | Hérite du flag S31 (inchangé) |

Le Sprint 46 **étend** sans toucher : aucun rollback nécessaire des sprints précédents. Les handlers `saas-billing-*.ts` / `lib/saas-billing-*.ts` restent **INTOUCHÉS** — toute la nouvelle logique vit dans `subscriptions-advanced.ts` + `lib/subscription-engine.ts`.

## Hors-scope

- **Dunning runner custom complet** (boucle scheduled queue + retry exponentiel beyond 7d) → backlog V2 (V1 = 3 attempts max, 1d/3d/7d puis abandon `past_due`).
- **Multi-currency dynamic** → backlog E6 (V1 = devise locked 'CAD').
- **Add-ons / quantity-based pricing** (Stripe `quantity`) → backlog V2 (V1 = flat price par tier).
- **Métriques cohorte / LTV / CAC** → backlog Sprint analytics dédié (V1 = MRR/ARR/churn/growth period-window simples).
- **UI panel admin complet** (BillingMetricsPanel, SubscriptionHistoryPanel, ProrationPreviewModal) → Manager-C Phase B.
- **Webhooks dunning Stripe** (`invoice.payment_failed`, `invoice.payment_succeeded` → trigger handler) → réutilise pipeline `billing-events` seq120 + dispatch Manager-B Phase B.
- **Stripe Tax integration** → déjà hors-scope S31 (référence : `LOT-BILLING-STRIPE-LIVE.md`).
- **Subscription portal redirect Stripe** (déjà câblé S22 via `/billing/portal-session`) — non rééditer.
- **Cron Cloudflare scheduled** déclenchement automatique → infra setup `wrangler.jsonc` séparé (Manager-Ops, hors scope code S46). Phase A expose les endpoints, Phase B les câble au scheduled.

## §6 Contrats figés

### 6.1 Migration SQL

Fichier racine : `migration-subscriptions-advanced-seq141.sql`. Manifest entrée seq141 (`docs/migrations-manifest.json`).

Pattern **100 % ADDITIF** :

- `ALTER TABLE subscriptions` — 7 colonnes nullable (`trial_ends_at` idem seq120 NO-OP rejeu, `prorated_amount_cents`, `paused_at`, `paused_until`, `dunning_attempts`, `dunning_log_json`, `next_dunning_at`).
- `ALTER TABLE billing_plans` — 3 colonnes nullable (`trial_days`, `allow_pause`, `cancellation_policy`).
- `CREATE TABLE IF NOT EXISTS subscription_changes` — history audit toutes mutations (`id`, `subscription_id`, `client_id`, `change_type`, `from_plan_id`, `to_plan_id`, `prorated_amount_cents`, `effective_at`, `reason`, `metadata_json`, `created_at`).
- `CREATE TABLE IF NOT EXISTS mrr_snapshots` — snapshot quotidien MRR/ARR/churn (`id`, `client_id`, `agency_id`, `snapshot_date`, `mrr_cents`, `arr_cents`, `active_subscriptions`, `new_subscriptions`, `churned_subscriptions`, `currency`, `created_at`).
- Index `idx_subscription_changes_sub`, `idx_subscription_changes_client_created`, `uniq_mrr_snapshots_date` (UNIQUE upsert cron).

**Aucun CHECK** ajouté. Validation enum (`change_type`, `cancellation_policy`) appartient au HANDLER (`subscription-engine.ts` whitelists). Aucune FK (D1/SQLite — FK ⇒ rebuild interdit). Aucune colonne droppée. Migration `seq141` réversible logiquement (`DROP TABLE IF EXISTS`) — mais pas en prod si données présentes.

Dépendances déclarées : `migration-community-seq140.sql` (chaînage SÉQUENTIEL manifest) + `migration-billing-stripe-mock-seq120.sql` (subscriptions + billing_plans existants) + `migration-billing-stripe-live-seq126.sql` (rails Stripe live optionnels).

### 6.2 Types TypeScript

Ajoutés à `src/lib/api.ts` (append, après bloc LOT COMMUNITY S45) :

- `SubscriptionChangeType` = enum union 9 valeurs (`upgrade|downgrade|pause|resume|trial_start|trial_end|dunning_attempt|cancel|reactivate`)
- `SubscriptionCancellationPolicy` = `'immediate' | 'end_of_period'`
- `DunningLogEntry` — `{ attempt, attempted_at, failure_reason, next_retry_at }`
- `SubscriptionChange` — ligne audit (id, subscription_id, client_id, change_type, from_plan_id, to_plan_id, prorated_amount_cents, effective_at, reason, metadata_json, created_at)
- `MrrSnapshot` — snapshot quotidien (id, client_id, agency_id, snapshot_date, mrr_cents, arr_cents, active_subscriptions, new_subscriptions, churned_subscriptions, currency, created_at)
- `ProrationPreview` — `{ from_plan_id, to_plan_id, prorated_amount_cents, currency, is_upgrade, days_remaining, period_days, mock? }`
- `MrrMetrics` — `{ mrr_cents, arr_cents, churn_rate, growth_rate, currency, snapshots[] }`

### 6.3 API front

Ajoutés à `src/lib/api.ts` (append) — 10 helpers :

- `previewProration(subscriptionId, { to_plan_id })` → `GET /api/subscriptions/:id/proration-preview`
- `upgradeSubscription(subscriptionId, { to_plan_id })` → `POST /api/subscriptions/:id/upgrade`
- `downgradeSubscription(subscriptionId, { to_plan_id })` → `POST /api/subscriptions/:id/downgrade`
- `pauseSubscription(subscriptionId, { until? })` → `POST /api/subscriptions/:id/pause`
- `resumeSubscriptionAdv(subscriptionId)` → `POST /api/subscriptions/:id/resume`
- `cancelSubscriptionAdv(subscriptionId, { policy? })` → `POST /api/subscriptions/:id/cancel`
- `runDunningCron()` → `POST /api/subscriptions/cron/dunning`
- `getSubscriptionHistory(subscriptionId)` → `GET /api/subscriptions/:id/history`
- `getMrrMetrics({ period_days? })` → `GET /api/billing/metrics/mrr`
- `runMrrSnapshotCron()` → `POST /api/billing/cron/mrr-snapshot`

⚠ `resumeSubscriptionAdv` / `cancelSubscriptionAdv` suffixés `Adv` pour ne PAS shadow `resumeSubscription` / `cancelSubscription` Sprint 22 existants (préfixe-namespace V1).

### 6.4 i18n

**Parité STRICTE 4 catalogues** (`src/i18n/fr-CA.json`, `src/i18n/fr-FR.json`, `src/i18n/en.json`, `src/i18n/es.json`) :

- 22 clés `subscriptions_adv.*` ajoutées en bloc :
  - `subscriptions_adv.trial.{days,ends_at}` (2)
  - `subscriptions_adv.proration.{preview,amount,upgrade,downgrade}` (4)
  - `subscriptions_adv.pause.{cta,until,indefinitely}` (3)
  - `subscriptions_adv.resume.cta` (1)
  - `subscriptions_adv.dunning.{attempts,next_retry,failed}` (3)
  - `subscriptions_adv.metrics.{title,mrr,arr,churn_rate,growth_rate,new_subs,churned_subs}` (7)
  - `subscriptions_adv.history.{title,empty}` (2)

fr-CA tutoiement implicite (style intralys) — fr-FR vouvoiement plus formel — en/es neutres. fr-FR.json + es.json sont **créés** par ce sprint (catalogues stub pour parité contrat). Phase B Manager-C ajoutera traductions UX-ready quand les composants frontend seront codés.

### 6.5 Handlers worker (Manager-B Phase B)

`src/worker/subscriptions-advanced.ts` — 10 handlers Phase A (stubs 501) :

- `handlePreviewProration(env, auth, subscriptionId, url)` — GET (lit ?to_plan_id=)
- `handleUpgrade(request, env, auth, subscriptionId)` — POST
- `handleDowngrade(request, env, auth, subscriptionId)` — POST
- `handlePause(request, env, auth, subscriptionId)` — POST (body : `{ until? }`)
- `handleResume(env, auth, subscriptionId)` — POST (pas de body)
- `handleCancel(request, env, auth, subscriptionId)` — POST (body : `{ policy? }`)
- `handleGetHistory(env, auth, subscriptionId)` — GET
- `handleRunDunningCron(env, auth)` — POST
- `handleGetMrrMetrics(env, auth, url)` — GET (lit ?period_days=)
- `handleRunMrrSnapshotCron(env, auth)` — POST

Manager-B Phase B remplira les corps : persistance D1 + capGuard `settings.manage` (FIGÉE) + idiome graduel `if (!isLiveEnabledForTenant(env, auth.clientId)) return mock:true reason:'live_branch_locked'` pour les handlers Stripe-dépendants (upgrade/downgrade/cancel/dunning).

### 6.6 Helpers stubs (Manager-B Phase B)

`src/worker/lib/subscription-engine.ts` :

- `computeProration(currentPlan, newPlan, daysRemaining, periodDays)` → `ProrationResult` (pure)
- `computeNextDunningAt(attempt)` → `string | null` (1d/3d/7d schedule, ISO date ou NULL si abandon)
- `computeMrr(env, clientId, asOfDate)` → `Promise<MrrAggregate>` (async D1, best-effort)
- `pickDunningStrategy(failureReason)` → `DunningStrategy` (pure, whitelist failure codes Stripe)

**Politique** : pas de CHECK SQL (enums whitelist HANDLER), best-effort sur D1 (panne réseau ⇒ dégradation gracieuse, JAMAIS throw — calque `lib/community-engine.ts` / `lib/review-moderation.ts`).

### 6.7 Routes worker

10 routes câblées dans `src/worker.ts` après le bloc Sprint 45 community (`/api/community/comments/:id`), AVANT le bloc Sprint 23 sécurité :

```
GET    /api/subscriptions/:id/proration-preview
POST   /api/subscriptions/:id/upgrade
POST   /api/subscriptions/:id/downgrade
POST   /api/subscriptions/:id/pause
POST   /api/subscriptions/:id/resume
POST   /api/subscriptions/:id/cancel
GET    /api/subscriptions/:id/history
POST   /api/subscriptions/cron/dunning
GET    /api/billing/metrics/mrr
POST   /api/billing/cron/mrr-snapshot
```

Style dynamique `await import('./worker/subscriptions-advanced')` — calque le bloc S45 community voisin.

**Ordre anti-shadowing strict** : tous suffixes spécifiques `/subscriptions/:id/X` (proration-preview, upgrade, downgrade, pause, resume, cancel, history) sont câblés AVANT toute route générique `/subscriptions/:id` (qui doit être ailleurs, **hors scope S46** — ne JAMAIS ajouter ici une route `/subscriptions/:id` générique sans déplacer ce bloc après).

### 6.8 Composants frontend (Manager-C Phase B)

Skeletons à créer dans `src/components/billing/` (Phase B) :

- `ProrationPreviewModal.tsx` — preview prorata avant upgrade/downgrade (computeProration HANDLER)
- `SubscriptionPauseDialog.tsx` — formulaire pause (until? date picker)
- `SubscriptionHistoryPanel.tsx` — timeline `subscription_changes` (chronologique inverse)
- `BillingMetricsPanel.tsx` — dashboard MRR/ARR/churn/growth + sparkline `mrr_snapshots`
- `DunningStatusBadge.tsx` — badge avertissement si `dunning_attempts > 0` + countdown `next_dunning_at`
- `TrialBanner.tsx` — bannière trial actif avec countdown jusqu'à `trial_ends_at`

Manager-C remplira les corps Phase B.

### 6.9 Garde-fous

**100 % ADDITIF — règles bloquantes** :

- ZÉRO CHECK SQL (enums whitelist HANDLER `subscription-engine.ts`)
- ZÉRO FK (D1/SQLite — rebuild risk au moindre ALTER)
- ZÉRO DROP / RENAME / rebuild
- Imports RELATIFS uniquement côté worker (`./types`, `./capabilities`, `./helpers`, `./lib/subscription-engine`) — pas d'alias `@/`
- Contrat réponses STRICT : `json({ data })` succès / `json({ error }, status)` erreur — JAMAIS de champ `code`
- Capabilities FIGÉES : `settings.manage` partout (admin only S46) — AUCUN ajout à `ALL_CAPABILITIES` seq80
- Stripe live INACTIF par défaut — flag `BILLING_LIVE_ENABLED` tenant-by-tenant (idiome Sprint 22 / 31 préservé, retour `mock:true reason:'live_branch_locked'`)
- i18n parité STRICTE 4 catalogues (fr-CA, fr-FR, en, es) — fr-FR.json + es.json créés par ce sprint
- **NE TOUCHE PAS** aux handlers `src/worker/saas-billing*.ts` ni `src/worker/lib/saas-billing-*.ts` existants — extension chirurgicale par module séparé `subscriptions-advanced.ts` + `lib/subscription-engine.ts`

### 6.10 Rollback path

- Désactiver via flag tenant : retour idiome mock instantané (handlers retournent `mock:true reason:'live_branch_locked'`)
- Tables `subscription_changes` et `mrr_snapshots` jamais droppées en prod (perte audit). Idempotent `IF NOT EXISTS`.
- ALTER additifs jamais reversés (colonnes nullable n'impactent pas le legacy).
- Si bug critique : suffit de désactiver le routing dans `worker.ts` (commenter le bloc S46) sans rollback DB.

## Cross-references

- `LOT-BILLING-STRIPE-MOCK.md` — Sprint 22 fondations SaaS billing
- `LOT-BILLING-STRIPE-LIVE.md` — Sprint 31 activation Stripe live (E4 marchand + SaaS)
- `LOT-COMMUNITY-S45.md` — pattern référent (calque additif strict)
- `migrations-manifest.json` seq141 — ordre canonique migration
