# GIGA-PLAN ENRICHISSEMENT — Renforcer & enrichir CHAQUE section (2026-05-27)

> Objectif Rochdi : « renforcer chaque petite section et grande, l'enrichir ». Plan ancré sur l'inventaire RÉEL (pas générique). Exécution côté hôte (bun/test), méthode « 18 agents », 100% additif, validation par batch.

## 0. Inventaire réel (au commit `921d3b3`+)
| Surface | Compte |
|---|---|
| Handlers worker (`src/worker/*.ts`) | **195** |
| Engines purs (`lib/*-engine.ts`) | **87** |
| Pages (`src/pages/**`) | **131** |
| Composants (`src/components/**`) | **297** |
| Fichiers de test | **271** (~5273 tests) |
| Clés i18n × 4 catalogues | **~6404** |
| Migrations | seq103→145 (local), seq103→135 (prod) |

## 1. Les 10 AXES DE PROFONDEUR (= ce que « enrichir » veut dire, concrètement)
Chaque section est évaluée et renforcée sur ces 10 axes. Un module n'est « riche » que quand les 10 sont couverts.

1. **Runtime depth** — la logique des engines est EXÉCUTÉE par les handlers (validation, error codes stables, calculs), pas seulement testée. (cf. `PHASE1-WIRING-MASTER-PLAN`.)
2. **Sécurité & conformité** — Loi 25 / CASL / RGPD : scrub PII, consentement, rate-limit, RBAC fin, validation d'entrée stricte, anti-bot, HMAC/signatures, idempotence.
3. **UX states** — loading (Skeleton + aria-busy), empty (EmptyState first-time/filtered), error inline (role=alert + retry), confirm destructif, optimistic update, validation inline.
4. **a11y WCAG 2.2 AA→AAA** — rôles ARIA, focus management/trap, navigation clavier, contrastes, reduce-motion, labels lecteur d'écran.
5. **i18n** — parité STRICTE 4 catalogues (fr-CA tutoiement / fr-FR vouvoiement / en / es), zéro littéral en dur, nettoyage dead-keys.
6. **Tests** — unitaires (engine), wire-up (handler↔engine), isolation multi-tenant, E2E Playwright des flux critiques.
7. **Observabilité** — logs structurés, métriques par module, traces, `request_id`, dashboard santé/erreurs, alerting.
8. **Perf** — bundle/chunks (<600KB), index D1, requêtes optimisées, cache, lazy-load, web-vitals.
9. **Intégrité données** — bornage multi-tenant (resolveClientId/scopeClientId), idempotence, migrations chaînées, réconciliation.
10. **Activation flags** — rails posés mock-inactif ; activation (Stripe/Twilio/OAuth/CF) = main Rochdi + creds + revue PCI/RGPD.

## 2. Méthode par sprint (« 18 agents » — NE PAS dévier)
1. **Chaman** (agent Plan, READ-ONLY) : audit de la section sur disque → scope §6 FIGÉ ciblant le vrai gap par axe (le module existe déjà → enrichir/activer, pas reconstruire).
2. **Phase A SOLO** (general-purpose) : socle = migration `seqN` (+ manifest) + types + helpers + routes + stubs + i18n×4 + doc contrat `docs/LOT-<sprint>.md`. Gèle les fichiers partagés.
3. **Phase B** : Manager-B (backend) ∥ Manager-C (frontend), même message, `run_in_background`, fichiers DISJOINTS. **Anti-throttle : MAX 4 agents simultanés.**
4. **Passe de cohérence** Claude : câblage routes↔handlers↔engines↔manifest↔front + relecture comparée (NE PAS faire confiance au label SAFE d'un agent — vérifier l'équivalence, taux d'erreur observé 5/7).
5. Validation hôte (`build`+`test`+i18n) + commit par batch.

---

## 3. ENRICHISSEMENT PAR DOMAINE (14 domaines = « chaque section »)

> Pour chaque domaine : modules concernés + maturité actuelle + items d'enrichissement (référencés aux axes 1-10).

### D1 — Auth & Identité 🔐
**Modules** : auth, security-admin, capabilities, crypto, team, sub-accounts, portal-auth, member-auth, api-public-auth, me-privacy, provisioning, tenant-context, oauth. **Pages** : Login, Signup, Forgot/Reset/ChangePassword, MagicLink(Request/Verify), AcceptInvitation.
**Maturité** : solide (PBKDF2 210k, sessions, capabilities seq80). **Gaps** :
- (Ax2) Activer MFA/TOTP : `security-engine` a TOTP+backup-codes complets MAIS aucun endpoint MFA câblé → créer routes enroll/verify/disable + UI (décision : format backup codes/token = migration, voir DEFERRED master-plan).
- (Ax2) Politique mot de passe : engine `validatePassword` min 12 vs handler 6/8 → décision Rochdi + migration douce (forcer au prochain reset).
- (Ax2) Rate-limit login/reset (sliding window KV `RATE_LIMITER` — binding à déclarer).
- (Ax6) Tests isolation : un sub-account ne voit jamais un autre tenant (audit systématique).
- (Ax3/4) Pages auth : états erreur réseau, focus, lecteur d'écran sur erreurs de validation.

### D2 — CRM Core (Leads / Pipeline / Contacts) 👥
**Modules** : leads, lead-dedup, lead-mapping, lead-notes, lead-predict, lead-score, lead-sources, pipelines, pipeline-insights, segments, custom-fields, properties, touchpoints, customer-reconcile, scoring, conversion-engine. **Pages** : Leads, LeadDetail, Pipeline, Segments, Properties, ClientLeads.
**Maturité** : très mature (leads-engine déjà câblé). **Gaps** :
- (Ax1) `conversion-engine` confidence câblé (fait VM) → étendre : exposer score + facteurs explicables dans LeadDetail.
- (Ax2) Dédup : fusion idempotente + audit trail des merges.
- (Ax3) Pipeline : drag-drop optimiste + rollback erreur + bulk actions.
- (Ax8) Index D1 sur leads(client_id, status, created_at) + segments dynamiques (requêtes lourdes).
- (Ax6) Tests calibration scoring sur historique tenant réel.

### D3 — Inbox & Conversations 💬
**Modules** : conversations, messages, quick-replies, reactions, notifications, notifications-ws, search. **Pages** : Inbox, ChatInbox.
**Maturité** : conversations/messages engines câblés (clampLimit, sanitizeBody). **Gaps** :
- (Ax1) `messaging-engine.validateAttachments` + `validateMessageInput` à câbler (DEFERRED).
- (Ax7) `NOTIFICATION_ROOMS` (DO) à déclarer → notifications temps réel actuellement OFF en prod.
- (Ax3) Inbox : virtualisation liste, typing indicator, optimistic send + retry.
- (Ax2) Anti-XSS sur tous les rendus de message (déjà sanitizeBody — étendre aux pièces jointes/aperçus liens).

### D4 — Calendrier & Réservation 📅
**Modules** : appointments, bookings, booking-public, booking-reminders, calendar, calendar-integrations, calendar-sync, gcal-oauth, outlook-oauth. **Pages** : Calendar, BookingSettings, PublicBooking.
**Maturité** : booking-engine câblé (validateSlot). **Gaps** :
- (Ax1) `isWithinBusinessHours` + `isCancellable` non câblés → fenêtres horaires + politique annulation.
- (Ax10) Activer sync bi-directionnel Google/Outlook (OAuth rails posés, creds).
- (Ax9) Anti double-booking concurrent (verrou/transaction).
- (Ax3) PublicBooking : fuseaux horaires, états slots indisponibles, confirmation accessible.

### D5 — Automation (Workflows / Sequences / Funnels) ⚙️
**Modules** : workflows, workflow-templates, sequences, trigger-links, funnels, funnels-builder, funnel-blocks. **Pages** : Workflows, WorkflowBuilder/Detail, Sequences, TriggerLinks, Funnels, FunnelBuilder.
**Maturité** : engines riches NON câblés. **Gaps** :
- (Ax1) `workflow-engine` : `validateStepInput`, `validateBranchCondition`, `isWithinQuietHours`, `parseWaitDuration`, `interpolateTemplate` → exécuter la validation par type de nœud + quiet-hours réels.
- (Ax1) `funnel-engine` : assignVariant/split-pct câblés (LOT 5) → étendre analytics drop-off.
- (Ax6) Tests E2E : créer workflow multi-branches + simuler exécution.
- (Ax3) Builder : undo/redo, validation visuelle des nœuds, preview exécution.

### D6 — Marketing (Campagnes / Email / Social / Réputation) 📣
**Modules** : broadcast, templates, email-blocks, social-publish/accounts/posts/ai, reputation/reputation-public, reviews, product-reviews, gbp/gbp-sync/gbp-oauth, meta/meta-leadgen. **Pages** : Campaigns, EmailBuilder, Social, SocialCalendar, Reviews, Templates.
**Maturité** : large surface, engines parallèles non câblés. **Gaps** :
- (Ax1/2) `broadcast-engine` (throttle, A/B variants) + `templates-engine.sanitizeHtmlBody` (anti-XSS email) à câbler avec tests.
- (Ax10) Activer OAuth FB/IG/LinkedIn/GBP (rails mock posés).
- (Ax2) CASL : footer désabonnement + double opt-in vérifiés sur tous les envois.
- (Ax3) EmailBuilder : preview multi-client, test d'envoi, variables interpolées sûres.

### D7 — Formulaires & Sites 📝🌐
**Modules** : forms, sites, site-nav, site-ssr, route-meta-ssr, funnel-blocks. **Pages** : Forms, FormBuilder, Sites, SiteBuilder, PublicForm, PublicSite.
**Maturité** : forms-engine/sites-engine non câblés. **Gaps** :
- (Ax1/2) `forms-engine` : `validateFieldDefinition`, `sanitizeFieldValue` (par type), `detectBotSubmission` (au-delà du honeypot) + fix Loi 25 consentement.
- (Ax1) `sites-engine` : `validateSiteSlug`, `validatePageNav` (profondeur), `canPublishSite` (home+SEO requis).
- (Ax8) SSR sites : cache + web-vitals des pages publiques.
- (Ax4) PublicForm/Site : a11y formulaires (labels, erreurs, fieldset).

### D8 — E-commerce / Boutique 🛒
**Modules** (le plus gros) : ecommerce-products/orders/cart/payments/shipments/returns/refunds/disputes/coupons/inventory(+strategy)/import/analytics/rfm/reco/region/shipping-zones/tax-engine/subscriptions/invoice/consumer-policy/customer-metrics/cart-recovery/channel-(shopify/woo/sync/rotation), catalog, gift-cards, loyalty, pos-(registers/sessions/transactions), abandoned-carts, tax-regions, currencies, marketplace, packs. **Pages** : boutique/*, Catalog, Marketplace, PublicStore, PublicCheckout.
**Maturité** : énorme, engines majoritairement non câblés. **Gaps prioritaires** :
- (Ax2) **`payments-engine.verifyStripeSignature`** sur tous les webhooks Stripe = sécurité prod #1.
- (Ax1) orders (`computeOrderTotals`/`validateOrderTransition`/`canCancelOrder`), cart (`isCartExpired`), products (`validateSku`/`normalizePriceCents`) à câbler AVEC tests (monétaire → prudence, cf. coupons : engine diverge du legacy).
- (Ax9) Idempotence refunds + bornage tenant strict sur toute la chaîne.
- (Ax10) POS terminal, Stripe Connect, multi-devise (Frankfurter) — activation creds.
- (Ax3) PublicCheckout : tunnel d'achat états d'erreur paiement, panier persistant.

### D9 — Facturation & SaaS 💳
**Modules** : billing (câblé S3/S4), saas-billing(+connect/payment-methods), saas, subscriptions-advanced, plans, quotes, documents, ecommerce-invoice. **Pages** : Invoices, Quotes, Documents.
**Maturité** : billing QC câblé. **Gaps** :
- (Ax1) `invoice-engine.computeTaxBreakdown` multi-région (CA/US/EU) — actuellement QC only.
- (Ax10) **E4 Stripe LIVE flag inactif** : proration/dunning/plan-transition/MRR/churn = DEFERRED jusqu'à GO + PCI.
- (Ax6) Tests : 3 `.todo` saas-billing LIVE à activer quand voie live câblée.
- (Ax3) Quotes→e-sign→facture : pont complet + statuts.

### D10 — IA 🤖
**Modules** : ai, ai-chat, ai-content, proactive-ai, chat-bot, voice-agent, llm-common, lead-predict. **Pages** : AiContent, ChatBotPage, VoiceAgentPage.
**Maturité** : chat-bot/voice-agent câblés (LOT 5). **Gaps** :
- (Ax1/2) `ai-engine` : `validatePromptInput`, `sanitizePromptForLog` (PII), `truncateContext`, `estimateTokens` → budgeting + logs sûrs.
- (Ax1) `ai-chat-engine` : `parseIntent` (fast-path avant LLM), `extractEntities`, `truncateHistory`.
- (Ax2) Scrub PII Loi 25 avant tout envoi LLM tiers (vérifier sur TOUS les call-sites).
- (Ax10) Activer OPENAI_API_KEY (RAG chat-bot) — priorité haute.

### D11 — Téléphonie & Voix 📞
**Modules** : telephony, calls-outbound, voicemails, voice, twilio-twiml/verify, whatsapp. **Pages** : Telephonie.
**Maturité** : telephony partiel. **Gaps** :
- (Ax1) `telephony-engine` : `validatePhoneE164`, `formatTwimlResponse`, `validateIvrConfig` + `parseStatusCallback` (DEFERRED — élargir whitelist statuts avant câblage).
- (Ax setup) **NOT-ROUTED** : `calls-outbound.ts`, `voicemails.ts` non importés dans worker.ts → décider routage AVANT enrichissement (sinon code mort).
- (Ax10) Activer Twilio (SMS/voice), enregistrements + rétention RGPD.

### D12 — Membership / LMS / Community / Surveys / B2B 🎓
**Modules** : memberships (câblé S5), courses-lms, community/community-forum, surveys, b2b-bundles-preorders, affiliates, warehouse-dropship. **Pages** : MemberSpace, CoursesAdmin, CommunityPage, SurveysAndDnsPage, B2BPage, WarehousePage, Affiliates.
**Maturité** : LOT 5 câblé (forum/lms/surveys/b2b/warehouse/affiliates). **Gaps** :
- (Ax1) memberships : `validateDripSchedule`, `computeMemberProgress` (UI progression).
- (Ax3) MemberSpace/LMS : reprise de cours, certificats, quiz a11y.
- (Ax6) Tests E2E des parcours apprenant + modération communauté.

### D13 — Rapports & Analytics 📊
**Modules** : reports, report-templates, scheduled-reports, dashboard, dashboards, admin-analytics, exports-extra, ecommerce-analytics/rfm/reco, pipeline-insights. **Pages** : Reports, SharedDashboard, Dashboard.
**Maturité** : engines importés en VOID (`_helper`) non appelés. **Gaps** :
- (Ax1) Câbler les VOID-IMPORT : reports (`validateQueryFilters`/`validateDateRange`/`formatExportCsv`), dashboard (`validateWidgetConfig`/`computePeriod`), admin-analytics (`aggregateByPeriod`/`formatChurnRate`) — vérifier équivalence avant.
- (Ax3) Dashboard builder : widgets configurables, drag-drop, planif d'envoi.
- (Ax8) Export CSV streaming (gros volumes) + cache agrégats.

### D14 — Plateforme / Ops / Conformité 🛠️
**Modules** : compliance (câblé buildDataExport), cookies-consent, observability-admin/ops, telemetry, tracking, health, release-gates, perf-budget-log, webhooks-dispatch/queue, snapshots(+import), data-reconcile, modules, settings, mobile, push, kb, feedback, beta, custom-domains. **Pages** : Settings, ComplianceSettings, ObservabilityPanel, KBAdmin, Trash, Integrations, GettingStarted, help/*.
**Maturité** : socle présent. **Gaps** :
- (Ax2) `audit()` : décider stratégie scrub (par clé `audit-redact` vs par valeur `audit-engine` — NE PAS double-rédiger).
- (Ax2) `webhooks-engine.verifySignature` (anti-replay) sur webhooks sortants.
- (Ax7) Observabilité serveur : étendre logs structurés + métriques par domaine + alerting.
- (Ax8) `WEBHOOK_QUEUE` (Queue) à déclarer → dispatch async actuellement OFF.
- (Ax10) custom-domains : activer Cloudflare for SaaS (CF token).

---

## 4. SPRINTS TRANSVERSES (toute la plateforme)
| # | Sprint | Axe | Contenu |
|---|---|---|---|
| T1 | **Câblage runtime** | 1 | Exécuter `PHASE1-WIRING-MASTER-PLAN` : SAFE → VOID-IMPORT → DEFERRED (avec tests). ~70 handlers. |
| T2 | **Sécurité hardening** | 2 | Déclarer bindings KV/DO/Queue ; rate-limit ; verifyStripeSignature/webhooks ; RBAC fin ; audit scrub unifié ; Loi25/CASL/RGPD consolidé. |
| T3 | **i18n convergence** | 5 | Dead-keys audit (script) ; extraire littéraux en dur restants ; parité STRICTE 4 catalogues. |
| T4 | **a11y AAA** | 4 | Focus/ARIA/contrastes/reduce-motion sur 297 composants + 131 pages ; primitives ui/ auditées. |
| T5 | **E2E Playwright** | 6 | Flux critiques : signup→provision, lead→pipeline→facture, checkout boutique, LMS, funnels, chat-bot. |
| T6 | **Perf** | 8 | Bundle delta (<+300KB), chunks, index D1, cache, lazy-load, web-vitals cibles. |
| T7 | **Observabilité** | 7 | Logs structurés + métriques par domaine + traces + dashboard santé + alerting. |
| T8 | **Tests depth** | 6 | Wire-up tests pour chaque handler câblé + isolation multi-tenant systématique. |

## 5. ORDONNANCEMENT (lots)
- **LOT A — Préflight & Sécurité** : Phase 0 (fait VM) + T2 bindings/sécurité (GO Rochdi bindings + migrations prod). *Débloque la prod.*
- **LOT B — Câblage runtime** : T1 (SAFE→VOID→DEFERRED) par domaine D2/D3/D4/D5/D8/D13 prioritaires. *La grosse profondeur.*
- **LOT C — Domaines fonctionnels** : D1,D6,D7,D9,D10,D11,D12,D14 enrichis un par un (1 sprint/domaine, méthode 18 agents).
- **LOT D — Transverses qualité** : T3 i18n, T4 a11y, T5 E2E, T6 perf, T7 observabilité, T8 tests.
- **LOT E — Release candidate** : gates go-live, activation flags documentée (Rochdi), beta, dette résiduelle.

## 6. Definition of Done par sprint (chaque section « riche »)
- [ ] Build TS 0 erreur, tests baseline préservés + nouveaux verts.
- [ ] Engine(s) du domaine EXÉCUTÉ(s) par les handlers (pas juste testés) — wire-up test le prouve.
- [ ] Sécurité/Loi25 couverte (PII, consentement, rate-limit, RBAC) sur le domaine.
- [ ] UX states (loading/empty/error/confirm) + a11y sur toutes les pages du domaine.
- [ ] i18n parité STRICTE 4 catalogues, zéro littéral en dur.
- [ ] Bornage multi-tenant testé.
- [ ] Doc contrat `docs/LOT-<sprint>.md` + note de sprint.

## 7. Garde-fous (rappels durs)
- 100% additif (jamais DROP/RENAME/CHECK modifié) ; capabilities seq80 FIGÉES (12) ; imports worker relatifs ; `{data}`/`{error}` sans champ `code` top-level ; flags paiement/régulé INACTIFS ; anti-throttle MAX 4 agents ; **relecture comparée avant tout câblage** (label SAFE d'un agent ≠ sûr) ; validation hôte par batch ; commits par batch ; jamais `push --force` / `--no-verify`.
