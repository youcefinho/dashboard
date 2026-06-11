# GIGA-PLAN RENFORCEMENT A-Z — intralys-dashboard

> Plan exhaustif renforcement TOUS les modules du projet (LOT 1-5, S1-S50).
> Créé 2026-05-26 après instruction Rochdi : *"vrai audit A-Z + giga plan, renforcer toutes les fonctionnalités déjà présentes"*.

## 🎯 Mission

Pas d'ajout de features. Renforcer en PROFONDEUR chaque fonction existante :
- Validation stricte (Zod-like, RFC standards, bornes)
- Error codes stables exportés
- Edge cases couverts (null/NaN/empty/overflow/div0)
- Mocks FLAG INACTIF réalistes
- Sécurité (Loi 25 PII scrub, XSS, rate-limit, anti-replay, bornage tenant)
- Tests edge cases (>10 par helper)
- UI states production-grade (loading + empty + error + a11y + confirm + i18n complet)

## 📊 Inventaire global (2026-05-26)

| Catégorie | Total | Renforcés | Restants |
|---|---|---|---|
| Handlers worker (`src/worker/*.ts`) | 195 | ~20 (LOT 4-5) | **~175** |
| Engines lib (`src/worker/lib/*-engine.ts`) | 45 | 19 (LOT 4-5) | **~26** |
| UI components (`src/components/**/*.tsx`) | 248 | 27 (LOT 5) | **~221** |
| Pages (`src/pages/*.tsx`) | 79 | ~0 | **~79** |
| Tests | 203 fichiers | +52 cette session | continue |

## 🏷 Catégorisation par groupes thématiques

### Group A — Core CRM (LOT 1, ~15 modules)
**Modules critiques user-facing tenant** :
- `leads.ts` (1149L) — CRUD leads + filters + import
- `pipeline.ts` (legacy or worker?) — stages + move + automation triggers
- `conversations.ts` — inbox unifiée
- `appointments.ts` — calendrier RDV
- `bookings.ts`, `booking-public.ts` (1281L) — public booking + reminders
- `customer-reconcile.ts` — dedupe
- `custom-fields.ts` — schema custom
- `auth.ts`, `api-public-auth.ts`, `capabilities.ts` — RBAC core
- `users.ts` (si existe) — team management

**Priorité : P0** (core, used everywhere)

### Group B — E-commerce (LOT 1-2 + S31-40, ~25 modules)
**Modules vente en ligne** :
- `ecommerce-products.ts` (1111L), `ecommerce-orders.ts` (768L), `ecommerce-cart.ts`
- `ecommerce-cart-recovery.ts` (E7 single-touch, distinct S40)
- `ecommerce-payments.ts`, `ecommerce-invoice.ts`
- `ecommerce-shipments.ts`, `ecommerce-shipping-zones.ts`, `ecommerce-returns.ts`
- `ecommerce-refunds.ts`, `ecommerce-disputes.ts`
- `ecommerce-coupons.ts`, `ecommerce-inventory.ts`, `ecommerce-inventory-strategy.ts`
- `ecommerce-region.ts`, `ecommerce-rfm.ts`, `ecommerce-reco.ts`
- `ecommerce-analytics.ts`, `ecommerce-customer-metrics.ts`
- `ecommerce-channel-shopify.ts`, `ecommerce-channel-woo.ts`, `ecommerce-channel-sync.ts`, `ecommerce-channel-rotation.ts`
- `ecommerce-import.ts`, `ecommerce-consumer-policy.ts`
- `ecommerce-tax-engine.ts` (legacy, distinct multicurrency S39)

**Priorité : P0** (revenue-critical)

### Group C — Marketing & Automation (LOT 2-3, ~10 modules)
**Workflows + IA + reporting** :
- `workflows.ts` (1437L) — automation engine, 20+ step types
- `ai.ts` (1075L), `ai-chat.ts` (1325L), `ai-content.ts`, `proactive-ai.ts` (735L)
- `conversion-engine.ts` (688L) — scoring + baselines
- `scoring.ts`, `forecast-engine.ts` (S14)
- `funnels.ts` (1042L) legacy distinct `funnels-builder.ts` (S44)
- `scheduled-reports.ts` (1039L), `reports.ts` (1052L)
- `broadcast.ts` (834L), `templates.ts`, `sms-templates.ts`

**Priorité : P1** (high-impact)

### Group D — Sites/Forms/Memberships (LOT 1-2, ~8 modules)
- `sites.ts` (1067L) — site builder
- `forms.ts` — form builder
- `memberships.ts` (1210L), `members.ts` — courses + drip + member auth
- `storefront-public.ts` (919L), `storefront-checkout.ts`

**Priorité : P1**

### Group E — Communication (LOT 2-3, ~12 modules)
- `telephony.ts` (857L), `calls-outbound.ts`, `voicemails.ts`
- `twilio.ts`, `twilio-verify.ts`, `twilio-twiml.ts`, `twilio-stream.ts`
- `chat-session.ts`, `chat-widgets.ts` (694L), `webchat.ts`
- `meta.ts`, `meta-webhook.ts`

**Priorité : P1** (high engagement)

### Group F — Admin & SaaS (LOT 3, ~10 modules)
- `saas-billing.ts` (1596L), `billing.ts`
- `clients-admin.ts`, `admin.ts`, `admin-analytics.ts`
- `security.ts`, `security-admin.ts`
- `onboarding.ts` (825L), `oauth.ts`, `ghl-oauth.ts`
- `audit.ts`, `audit-log.ts`

**Priorité : P0** (cross-cutting + revenue)

### Group G — Reports/Analytics (LOT 2-3, ~7 modules)
- `dashboard.ts`, `dashboards.ts`
- `reports.ts`, `scheduled-reports.ts`
- `admin-analytics.ts`
- `conversion-baselines.ts` (si existe)

**Priorité : P2** (read-only mostly)

### Group H — Misc utilities (LOT 1-3, ~15 modules)
- `catalog.ts`, `marketplace.ts` (770L)
- `tickets.ts` (690L), `quotes.ts` (728L), `documents.ts` (809L)
- `compliance.ts`, `cookies-consent.ts`
- `data-reconcile.ts`, `currencies.ts`
- `snapshots.ts` (482L) — distinct snapshot-engine S35
- `crypto.ts`, `beta.ts`
- `customer-reconcile.ts`

**Priorité : P2** (existing, lower critical)

### Group I — Legacy modules (à dépoussiérer ou archiver)
- `pos-transactions.ts` (717L), `loyalty.ts` (1073L) — vs S37-38 récents
- `gbp.ts` (1212L) — vs gbp-engine S32 récent
- `community.ts` (LOT G10) vs `community-forum.ts` S45

**Priorité : P2** (audit + dedup ou archive)

## ✅ Déjà renforcé cette session (2026-05-26)

### Engines (19 modules)
**LOT 5 (11)** : dns, community, survey, voice-agent, lms, subscription, chat-bot, pricing, funnel, warehouse, affiliate
**LOT 4 (8 NEW extraits)** : snapshot, cart-recovery, product-reviews, calendar, pos, loyalty, multicurrency, gbp

### Handlers wire-up (10)
community-forum, voice-agent, surveys, chat-bot, courses-lms, subscriptions-advanced, b2b-bundles-preorders, funnels-builder, warehouse-dropship, affiliates, custom-domains

### UI (27 composants LOT 5)
Tous les composants `voice-agent/chat-bot/lms/funnels/community/b2b/warehouse/affiliates/surveys/dns/billing` LOT 5

## 🚀 Plan d'exécution (batches structurés)

### Phase 1 : Audit inventaire fin (1 batch parallèle 4 agents)
- Agent A1 : grep tous les TODO/FIXME/XXX + stubs résiduels
- Agent A2 : audit i18n coverage par module (hardcoded strings count)
- Agent A3 : audit tests coverage par handler (test files vs handler files mapping)
- Agent A4 : audit a11y (aria-* count + missing per component)

**Livrable** : `docs/AUDIT-FINDINGS-2026-05-26.md` avec gaps cartographiés.

### Phase 2 : Renforcement par groupe (12 batches × 4 modules)

Chaque batch : 4 modules en parallèle (max anti-throttle), 5-10 min par module.

**Batch P0-1 — Core CRM auth/leads** :
1. `leads.ts` — validation lead input, scoring init, segments
2. `auth.ts` — sessions, tokens, password hashing
3. `capabilities.ts` — RBAC strict, 12 caps frozen
4. `api-public-auth.ts` — anti-bot, rate-limit

**Batch P0-2 — Core CRM appointments/bookings** :
5. `appointments.ts` — slots, conflicts, cancel/reschedule
6. `bookings.ts` — invariants tenant
7. `booking-public.ts` — anti-bot, honeypot, rate-limit IP
8. `booking-reminders.ts` — cron, SMS/email send

**Batch P0-3 — Conversations/inbox** :
9. `conversations.ts` — unified inbox
10. `messages.ts` — send/receive
11. `custom-fields.ts` — schema custom validation
12. `customer-reconcile.ts` — dedupe heuristics

**Batch P0-4 — E-commerce core** :
13. `ecommerce-products.ts` (1111L) — SKU validation, variants, pricing
14. `ecommerce-orders.ts` (768L) — totals, taxes, fulfillment
15. `ecommerce-cart.ts` — anti-replay, expiry
16. `ecommerce-payments.ts` — Stripe live + mocks

**Batch P0-5 — E-commerce ops** :
17. `ecommerce-shipments.ts` — providers
18. `ecommerce-returns.ts` — RMA flow
19. `ecommerce-refunds.ts` — partial/full
20. `ecommerce-disputes.ts` — Stripe dispute webhook

**Batch P0-6 — E-commerce ops 2** :
21. `ecommerce-coupons.ts` — codes, usage limits, expiry
22. `ecommerce-inventory.ts` — stock multi-warehouse
23. `ecommerce-inventory-strategy.ts` — FIFO/LIFO/allocation
24. `ecommerce-import.ts` — CSV/JSON import validation

**Batch P0-7 — SaaS/Admin** :
25. `saas-billing.ts` (1596L) — tiers, dunning, proration
26. `billing.ts` — invoices, taxes
27. `clients-admin.ts` — multi-tenant ops
28. `onboarding.ts` (825L) — checklist state, item validation

**Batch P0-8 — Security/Audit** :
29. `security.ts` — sessions, password reset, 2FA
30. `security-admin.ts` — capability overrides, audit log
31. `audit.ts` / `audit-log.ts` — immutability, retention
32. `compliance.ts` — Loi 25 / RGPD

**Batch P1-1 — Workflows/Automation** :
33. `workflows.ts` (1437L) — 20+ step types, branching, quiet hours
34. `ai.ts` (1075L) — AI calls, prompt templating
35. `ai-chat.ts` (1325L) — copilot v2
36. `proactive-ai.ts` (735L) — proactive suggestions

**Batch P1-2 — Funnels/Pages/Sites** :
37. `funnels.ts` (1042L) legacy — distinct S44, audit + archive ou unify
38. `sites.ts` (1067L) — site builder validation
39. `forms.ts` — form builder validation
40. `memberships.ts` (1210L) — courses + lessons + drip

**Batch P1-3 — Storefront/Public** :
41. `storefront-public.ts` (919L) — anti-bot, SEO, cache
42. `storefront-checkout.ts` — checkout flow
43. `members.ts` — member auth distinct admin
44. `meta-webhook.ts` — Meta/FB events

**Batch P1-4 — Communication** :
45. `telephony.ts` (857L) — IVR, status callbacks
46. `calls-outbound.ts` — Twilio outbound
47. `voicemails.ts` — R2 streaming, RGPD
48. `chat-widgets.ts` (694L), `chat-session.ts` — webchat infra

**Batch P1-5 — Reports** :
49. `scheduled-reports.ts` (1039L) — cron, email rendering
50. `reports.ts` (1052L) — query builder
51. `dashboard.ts`, `dashboards.ts` — widgets, snapshots
52. `admin-analytics.ts` — usage metrics

**Batch P1-6 — Marketing extras** :
53. `broadcast.ts` (834L) — email/SMS mass send, A/B, throttle
54. `templates.ts` — email templates
55. `conversion-engine.ts` (688L) — scoring formula
56. `forecast-engine.ts` (S14) — pipeline forecast

**Batch P2-1 — Misc utilities** :
57. `catalog.ts` — items CRUD
58. `marketplace.ts` (770L) — listings
59. `tickets.ts` (690L) — support
60. `quotes.ts` (728L) — devis

**Batch P2-2 — Documents/Compliance** :
61. `documents.ts` (809L) — e-signature, storage
62. `compliance.ts` — Loi 25
63. `cookies-consent.ts` — banner state
64. `data-reconcile.ts` — orphans

**Batch P2-3 — Currencies/Snapshots** :
65. `currencies.ts` — FX rates
66. `snapshots.ts` (482L) — snapshot list distinct S35
67. `snapshot-import.ts` — validation bundle
68. `crypto.ts` — encryption helpers

**Batch P2-4 — Legacy audit** :
69. `pos-transactions.ts` (717L) — vs S37 audit
70. `loyalty.ts` (1073L) — vs S38 audit
71. `gbp.ts` (1212L) — vs S32 engine audit
72. `community.ts` legacy — vs S45 audit

### Phase 3 : Renforcement UI components (~10 batches × 4 components)

~221 composants UI restants à auditer. Priorité :
- Pages user-facing principales (Leads, Pipeline, Inbox, Orders, Products, Sites, etc.)
- Pages admin (Billing, Snapshots, Security, Onboarding)
- Composants partagés (FormBuilder, FunnelBuilder, SiteBuilder)

### Phase 4 : Validation finale
- Build clean
- Tests all pass
- i18n parité STRICT
- Smoke visuel
- Bundle size check (delta < +500KB gzip vs initial)

## ⚠️ Règles strictes d'exécution

1. **Anti-throttle** : MAX 4 agents simultanés. Jamais plus.
2. **Engines = lib/*-engine.ts purs** : zéro side-effect, zéro I/O, testable
3. **100% additif** : zéro régression sur tests existants
4. **Capabilities figées seq80** : aucun ajout
5. **i18n parité STRICT** : utiliser `scripts/i18n-parity-audit.cjs` avant commit batch
6. **Imports relatifs** côté worker
7. **`json({data})` / `json({error}, status)`** : pas de champ `code` top-level
8. **Validation entre batches** : `bun run build` + `bun run test` après chaque batch (vérif clean)
9. **Commit checkpoint** suggéré toutes les 4-5 batches (pas auto, demander user GO)

## 📈 Estimation effort

- **Phase 1** (audit inventaire) : 1 batch, ~10 min
- **Phase 2** (72 modules / 18 batches × 4) : ~3-4h compute parallèle
- **Phase 3** (UI ~55 batches × 4 components) : ~5-6h
- **Phase 4** (validation finale) : ~30 min

**Total estimé : 8-10h compute parallèle**. Realistic : sur plusieurs sessions Claude (post-compact friendly avec ce doc + handoff).

## 🎯 Critères de validation par module renforcé

Chaque module doit cocher au minimum :
- [ ] Validation input (Zod-like ou manuel strict)
- [ ] Error codes constants exportés (`<MODULE>_ERROR_CODES`)
- [ ] Edge cases couverts (null/NaN/empty/overflow/div0)
- [ ] Bornage tenant strict (WHERE client_id = ?)
- [ ] Capability guard appliquée
- [ ] Audit log après mutations (best-effort)
- [ ] Mocks FLAG INACTIF shape réaliste (si applicable)
- [ ] Helpers extraits dans `lib/*-engine.ts` si logique réutilisable
- [ ] Tests edge cases (>10 par helper exporté)
- [ ] i18n 100% via t() (zéro string hardcoded)

## 📚 Sources

- Inventaire `find src -name "*.ts"` + `wc -l` du 2026-05-26
- État engines/handlers/UI dans `HANDOFF-2026-05-26.md`
- Règles strictes héritées `GIGA-PLAN-LOT5-SPRINTS-41-50.md`
- Script audit i18n `scripts/i18n-parity-audit.cjs`
