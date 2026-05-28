# GIGA-PLAN RENFORCEMENT V2 DEEP — Handoff Claude #N+1

> Doc canonique handoff post-session 2026-05-26.
> **NE PAS exécuter sans lire la section "RÈGLES STRICTES" en bas.**
> Cible : passer du "depth in tests" au "depth in runtime" + combler les blind spots.

---

## 🎯 Mission

La session 2026-05-26 a livré :
- ~85 engines purs (`lib/*-engine.ts`) avec validation/edge cases/error codes
- ~105 UI components/pages renforcés (loading/empty/error/a11y/i18n/confirm)
- +3558 tests (1715 → 5273), 0 TS errors, i18n parité STRICT 6407 keys × 4

**MAIS** : la majorité des engines sont créés en **mode 100% additif** (helpers exportés mais NON CÂBLÉS dans les handlers). Concrètement, les handlers exécutent toujours leur logique d'origine, pas la nouvelle validation/sécurité.

**Mission V2** : câbler effectivement la profondeur dans le runtime + combler les ~127 handlers/modules non touchés + préparer la prod live (migrations, bindings, bundle) + tests E2E réels.

---

## 📊 État actuel (au commit `921d3b3`)

| Métrique | Valeur |
|---|---|
| TS errors | 0 |
| Tests | 5273 pass (2 skipped, 3 todo) sur 253 fichiers |
| i18n | 6407 keys × 4 catalogues (STRICT parity) |
| Engines lib/*-engine.ts | ~85 fichiers |
| Migrations LOCAL D1 | seq103-145 toutes appliquées |
| Migrations PROD D1 | seq103-135 SEULEMENT (LOT 1-4) |
| UI components/pages renforcés | ~105 |
| Build | clean ~1s |
| Bundle size delta | **NON MESURÉ** |
| Wrangler bindings audit | **NON FAIT** |

---

## 🚨 5 CATÉGORIES DE GAPS À COMBLER

### CATÉGORIE A — Câblage engines → handlers (le gap #1 le plus important)

**Constat** : ~95% des engines créés ne sont pas appelés par les handlers. Validation, error codes stables, sécurité Loi 25, rate-limit — tout cela existe dans les engines mais n'est pas EXÉCUTÉ en prod runtime.

**Handlers déjà câblés (11 sur ~80 candidats)** : `community-forum, voice-agent, surveys, chat-bot, lms, subscription, pricing, funnel, warehouse, affiliate, custom-domains`.

**Handlers à câbler** : tous les autres dont les engines existent (~70 handlers).

### CATÉGORIE B — Prod readiness (CRITIQUE avant que prod prenne du trafic LOT 5)

1. Appliquer migrations seq136-145 sur D1 prod
2. Auditer `wrangler.jsonc` pour tous les bindings LOT 5 (R2, KV, AI, Queues, DOs)
3. Mesurer bundle size delta vs commit précédent
4. Smoke E2E sur staging (pas dev bypass)

### CATÉGORIE C — Modules worker NON couverts (~127)

Phase 2 V1 a couvert 68/195 handlers. Reste 127. Liste à inventorier avec `ls src/worker/*.ts` minus déjà fait (voir batches Phase 2 V1 dans `HANDOFF-2026-05-26.md`).

### CATÉGORIE D — UI components partagés + E2E réels

- Composants partagés (ui/Modal, ui/SlidePanel, ui/Toast, ui/EmptyState, ui/Skeleton, ui/ConfirmDialog, ui/Input, ui/Button, ui/Tag, ui/Card, ui/DataTable, etc.) — pas auditésen V1
- Composants secondaires (CommandPalette, Sidebar, MobileBottomNav, AppLayout, etc.) — partial
- Tests E2E Playwright sur les nouvelles routes LOT 5 — non existants

### CATÉGORIE E — Quality verification (la zone d'ombre)

- 2 tests skipped + 3 todo : qu'est-ce que c'est ?
- i18n usage check : grep `t('...')` pour détecter clés dead (jamais référencées)
- Perf bench : latence handlers wire-up vs non-wire-up
- 2e opinion (Gemini/Codex) sur quelques engines au hasard pour calibrer

---

## 📋 BATCHES STRUCTURÉS — Plan exécution V2

### 🔥 PHASE 0 — Préflight CRITIQUE (faire AVANT tout autre batch)

#### Batch 0.1 — Audit wrangler bindings + .dev.vars vs prod
**Cible** : `wrangler.jsonc` + secrets.

**Action** :
```bash
cd C:/Users/rochdi/.gemini/antigravity-ide/scratch/intralys-dashboard
cat wrangler.jsonc
grep -rE "env\.(AI|R2|RATE_LIMITER|STORAGE_R2|KV_|QUEUE_|DO_)" src/worker/ src/worker/lib/ | sort -u | head -60
```

Pour chaque binding référencé dans le code, vérifier sa déclaration dans `wrangler.jsonc`. Si manquant, le déclarer (ne PAS modifier les secrets prod sans GO user).

**Livrable** : `docs/AUDIT-BINDINGS-2026-05-27.md` listant chaque binding utilisé + déclaration matching.

#### Batch 0.2 — Mesurer bundle size delta
```bash
bun run build 2>&1 | tee bundle-after.txt
# Comparer manuellement à un build avant session (git stash + rebuild + restore)
# OU utiliser bun run check:bundle si défini
git diff HEAD~1 HEAD -- bundle-after.txt # si on commit le bundle-after
```

**Livrable** : `docs/BUNDLE-DELTA-2026-05-27.md` avec :
- Chunks > 600KB (warnings)
- Delta vs target +150KB
- Top 5 contributeurs au delta

**Action si delta > 500KB** : tree-shake `lib/*-engine.ts` (vérifier `sideEffects: false` dans package.json), audit imports lourds.

#### Batch 0.3 — Migrations prod (DEMANDER GO USER AVANT EXÉCUTION)
**NE PAS exécuter sans confirmation explicite Rochdi.**

```bash
# Vérifier état prod
wrangler d1 execute intralys-crm --remote --command="SELECT MAX(seq) FROM _migrations"
# Si < 145, appliquer manquantes
bun run db:migrate:prod
```

#### Batch 0.4 — Investiguer tests skipped/todo
```bash
grep -rn "it.skip\|test.skip\|it.todo\|test.todo" src/ | head -20
```
Pour chaque skip/todo : décider de l'activer, l'unskip, ou documenter pourquoi (raison technique + ticket).

---

### 🔌 PHASE 1 — Câblage engines → handlers (le BIG WIN qualité)

**Pattern par handler** :
1. Identifier engine correspondant (`lib/<module>-engine.ts`)
2. Lister helpers exportés
3. Pour chaque call site du handler qui fait validation/parsing/sanitize inline → remplacer par appel engine
4. Ajouter tests wire-up qui prouvent que l'engine est exécuté (mock l'engine + assert called)

**Cibles prioritaires (par impact business)** :

#### Batch 1.1 — Auth/Security câblage
- `auth.ts` → câbler `auth-engine` (PBKDF2, password validation, session tokens)
- `security.ts` → câbler `security-engine` (TOTP, password reset)
- `security-admin.ts` → câbler `security-admin-engine` (capability overrides, audit filters)
- `compliance.ts` → câbler `compliance-engine` (consent records, GDPR requests)

**Critique** : tests existants doivent passer après wire-up. Si régression, c'est que le helper engine a une signature différente de l'inline → adapter.

#### Batch 1.2 — Core CRM câblage
- `leads.ts` → câbler `leads-engine` (validateEmail/Phone/LeadInput, computeInitialScore)
- `appointments.ts` + `bookings.ts` + `booking-public.ts` → câbler `booking-engine` (validateSlot, isWithinBusinessHours, isCancellable)
- `conversations.ts` → câbler `conversation-engine` (validateThreadStatus, clampLimit, parseCursor)
- `messages.ts` → câbler `messaging-engine` (sanitizeBody XSS, validateMessageInput, validateAttachments)

#### Batch 1.3 — E-commerce câblage
- `ecommerce-products.ts` → câbler `products-engine` (validateSku, validateProductInput, normalizePriceCents)
- `ecommerce-orders.ts` → câbler `orders-engine` (computeOrderTotals, validateOrderTransition, canCancelOrder)
- `ecommerce-cart.ts` → câbler `cart-engine` (generateCartToken, isCartExpired, validateCartItem)
- `ecommerce-payments.ts` → câbler `payments-engine` (verifyStripeSignature, validatePaymentAmount, parseStripeWebhook)

#### Batch 1.4 — E-commerce ops câblage
- `ecommerce-shipments.ts` → câbler `shipments-engine` (validateTrackingNumber, computeETA)
- `ecommerce-returns.ts` → câbler `returns-engine` (isWithinReturnWindow, validateReturnItems, computeReturnRefund)
- `ecommerce-refunds.ts` → câbler `refunds-engine` (validateRefundAmount, idempotencyKey)
- `ecommerce-disputes.ts` → câbler `disputes-engine` (isWithinEvidenceWindow, validateEvidenceFields, parseStripeDispute)

#### Batch 1.5 — E-commerce ops 2 câblage
- `ecommerce-coupons.ts` → câbler `coupons-engine`
- `ecommerce-inventory.ts` → câbler `inventory-engine`
- `ecommerce-inventory-strategy.ts` → câbler `inventory-strategy-engine` (allocateFifo/Lifo/Fefo)
- `ecommerce-import.ts` → câbler `import-engine` (parseCsvRow, validateImportRow, dryRunImport)

#### Batch 1.6 — SaaS billing/admin câblage
- `saas-billing.ts` → câbler `saas-billing-engine` (computeProration, getDunningSchedule, validatePlanTransition, computeMrr, computeChurnRate)
- `billing.ts` → câbler `invoice-engine` (formatInvoiceNumber, computeTaxBreakdown)
- `clients-admin.ts` → câbler `clients-engine` (validateClientInput, validateSlug, provisionClientPayload)
- `onboarding.ts` → câbler `onboarding-engine` (computeProgress, validateSkipReason, mergeChecklistItems)

#### Batch 1.7 — Workflows/AI câblage
- `workflows.ts` → câbler `workflow-engine` (validateStepInput, validateBranchCondition, isWithinQuietHours, parseWaitDuration, interpolateTemplate)
- `ai.ts` → câbler `ai-engine` (validatePromptInput, sanitizePromptForLog, truncateContext, estimateTokens)
- `ai-chat.ts` → câbler `ai-chat-engine` (parseIntent, truncateHistory, extractEntities)
- `proactive-ai.ts` → câbler `proactive-ai-engine` (detectInactivity, detectMilestone, rankSuggestions)

#### Batch 1.8 — Sites/Forms/Memberships câblage
- `sites.ts` → câbler `sites-engine` (validateSiteSlug, validatePageNav, canPublishSite)
- `forms.ts` → câbler `forms-engine` (validateFieldDefinition, sanitizeFieldValue, detectBotSubmission)
- `memberships.ts` → câbler `memberships-engine` (validateDripSchedule, isLessonAvailable, computeMemberProgress)
- `storefront-public.ts` → câbler `storefront-engine` (validateCheckoutInput, computeShippingCost, detectStorefrontBot)

#### Batch 1.9 — Communication câblage
- `telephony.ts` → câbler `telephony-engine` (validatePhoneE164, parseStatusCallback, formatTwimlResponse, validateIvrConfig)
- `calls-outbound.ts` → câbler `calls-outbound-engine` (validateOutboundRequest, shouldRecordCall, computeRetrySchedule)
- `voicemails.ts` → câbler `voicemails-engine` (buildR2VoicemailKey, isWithinRetention, formatVoicemailExport)
- `chat-widgets.ts` → câbler `chat-widgets-engine` (validateWidgetConfig, validateColorHex, generateEmbedSnippet)

#### Batch 1.10 — Reports/Analytics câblage
- `scheduled-reports.ts` → câbler `scheduled-reports-engine` (validateCronExpression, parseRecipients, computeNextRun)
- `reports.ts` → câbler `reports-engine` (validateQueryFilters, validateDateRange, formatExportCsv)
- `dashboard.ts` → câbler `dashboard-engine` (validateWidgetConfig, validateDashboardLayout, computePeriod)
- `admin-analytics.ts` → câbler `admin-analytics-engine` (aggregateByPeriod, formatChurnRate, formatGrowthRate)

#### Batch 1.11 — Marketing câblage
- `broadcast.ts` → câbler `broadcast-engine` (validateBroadcastInput, validateAbVariants, computeThrottleSchedule, assignVariantBucket)
- `templates.ts` → câbler `templates-engine` (validateTemplateInput, extractTemplateVariables, sanitizeHtmlBody)
- `conversion-engine.ts` → câbler `conversion-helpers-engine` (clampScore, computeWeightedScore, confidenceFromSampleSize)
- `forecast-engine.ts` → câbler `forecast-helpers-engine` (applyScenario, bucketDealByStage, validateForecastQuery)

#### Batch 1.12 — Utils câblage
- `catalog.ts` → câbler `catalog-engine`
- `marketplace.ts` → câbler `marketplace-engine`
- `tickets.ts` → câbler `tickets-engine`
- `quotes.ts` → câbler `quotes-engine`
- `documents.ts` → câbler `documents-engine`
- `cookies-consent.ts` → câbler `cookies-consent-engine`
- `data-reconcile.ts` → câbler `data-reconcile-engine`
- `currencies.ts` → câbler `currencies-engine`
- `snapshots.ts` → câbler `snapshots-list-engine`
- `snapshot-import.ts` → câbler `snapshot-import-engine`
- `meta.ts` → câbler `meta-engine`
- `oauth.ts` + `ghl-oauth.ts` → câbler `oauth-engine`
- `social-publish.ts` + `social-accounts.ts` → câbler `social-engine`
- `webhooks-dispatch.ts` + `webhooks-queue.ts` → câbler `webhooks-engine`
- `audit.ts` ou `audit-log.ts` → câbler `audit-engine` (validateAuditAction, sanitizeMetadata)
- `gbp.ts` → câbler `gbp-engine`
- `ecommerce-analytics.ts` → câbler `ecommerce-analytics-engine`
- `ecommerce-rfm.ts` → câbler `ecommerce-rfm-engine`
- `ecommerce-reco.ts` → câbler `ecommerce-reco-engine`
- `ecommerce-channel-sync.ts` → câbler `channel-sync-engine`

**Total Phase 1 : 12 batches × 3-4 handlers = ~70 handlers câblés**

---

### 🆕 PHASE 2 — Modules worker NON couverts (~127 restants)

#### Batch 2.1 — Inventaire fin
```bash
cd C:/Users/rochdi/.gemini/antigravity-ide/scratch/intralys-dashboard
ls src/worker/*.ts | wc -l   # total
# Comparer à la liste des modules déjà engine'd dans Phase 2 V1
# Cibles probables non couvertes : ecommerce-cart-recovery (E7 distinct), ecommerce-consumer-policy, ecommerce-customer-metrics, ecommerce-channel-shopify, ecommerce-channel-woo, ecommerce-channel-rotation, ecommerce-region, ecommerce-shipping-zones, ecommerce-tax-engine (legacy QC/EU/DZ), telemetry, tracking, twilio-twiml, twilio-stream, twilio-verify, mock-meta, meta-leadgen, customer-reconcile (déjà reconcile-engine?), conversion-baselines, dashboards, beta, team, calendar-integrations, ghl-oauth (vs oauth-engine), chat-session, ecommerce-invoice (vs invoice-engine), ecommerce-disputes (covered), etc.
```

**Livrable** : `docs/PHASE2-V2-UNTOUCHED-INVENTORY.md` avec liste exhaustive.

#### Batch 2.2 → 2.N — Renforcement par groupes thématiques
Pattern identique à Phase 2 V1 (4 modules par batch, 1 agent par batch, anti-throttle max 4 simultanés). Créer engine pur + tests + (optionnel) wire-up.

---

### 🎨 PHASE 3 — UI components partagés + E2E

#### Batch 3.1 — Composants UI partagés (`src/components/ui/`)
Liste avec `ls src/components/ui/*.tsx`. Priorité :
- `Modal.tsx`, `SlidePanel.tsx`, `ConfirmDialog.tsx`, `Toast.tsx`, `EmptyState.tsx`, `Skeleton.tsx`
- `Input.tsx`, `Textarea.tsx`, `Select.tsx`, `Checkbox.tsx`, `Radio.tsx`, `Switch.tsx`
- `Button.tsx`, `Tag.tsx`, `Badge.tsx`, `Avatar.tsx`, `Card.tsx`
- `DataTable.tsx`, `Tabs.tsx`, `Tooltip.tsx`, `Popover.tsx`, `Dropdown.tsx`

**Audit** : a11y (role, aria-*), keyboard nav (Tab, Esc, Enter), focus trap (Modal/SlidePanel), theming, i18n des messages internes.

#### Batch 3.2 — Composants layout
- `AppLayout.tsx`, `Sidebar.tsx`, `MobileBottomNav.tsx`, `CommandPalette.tsx`
- `QuickAddFab.tsx`, `KeyboardShortcuts.tsx`, `InstallPrompt.tsx`
- `LazyGuard.tsx`, `ModuleGuard.tsx`, `RoleGuard.tsx`, `CapabilityGuard.tsx`

#### Batch 3.3 — Composants Inbox (déjà partial dans V1)
- `Inbox/ConversationsList.tsx`, `Inbox/MessageBubble.tsx`, `Inbox/MessageThread.tsx`, `Inbox/NewConversationPane.tsx`

#### Batch 3.4 — Tests E2E Playwright pour LOT 5
Créer `tests/e2e/lot5-smoke.spec.ts` qui :
1. Signup nouveau compte (provisionne tenant)
2. Navigate vers `/lms` → vérifie page rend + créer un cours OK
3. Navigate vers `/funnels` → créer un funnel + ajouter step OK
4. Navigate vers `/community` → créer thread + commenter OK
5. Navigate vers `/b2b` → créer customer group + bundle OK
6. Navigate vers `/warehouse` → créer warehouse + transfert OK
7. Navigate vers `/affiliates` → créer programme + référral OK
8. Navigate vers `/settings/voice-agent` → config IVR OK
9. Navigate vers `/settings/chat-bot` → config bot + test OK
10. Navigate vers `/settings/surveys-and-dns` → créer survey + domaine custom OK

Pattern : utiliser `bun run dev` + `bun run dev:worker` lancés en background, puis `npx playwright test tests/e2e/lot5-smoke.spec.ts`.

---

### 🔍 PHASE 4 — Quality verification

#### Batch 4.1 — i18n dead keys
```bash
# Pour chaque clé dans fr-CA.ts, grep si elle est référencée dans src/
node scripts/i18n-dead-keys-audit.cjs > docs/I18N-DEAD-KEYS-2026-05-27.md
```
**Livrable** : nouveau script `scripts/i18n-dead-keys-audit.cjs` + rapport.

#### Batch 4.2 — Perf bench handlers wire-up
Créer `scripts/bench-handlers.cjs` qui :
- Lance worker local
- Pour chaque handler wire-up (Phase 1), benchmarke 1000 req avec autocannon ou similaire
- Compare latence p50/p99 vs commit pré-wire-up (`git stash` + bench + restore)

#### Batch 4.3 — 2e opinion Gemini/Codex sur 5 engines au hasard
Sélectionner 5 engines (ex: `leads-engine`, `payments-engine`, `compliance-engine`, `webhooks-engine`, `lms-engine`) et demander :
- `gemini-3.1-pro-preview` review code quality + security
- `codex-cli --reasoning high` review correctness vs production usage

Livrable : `docs/SECOND-OPINION-2026-05-27.md` avec findings + actions.

#### Batch 4.4 — Audit handleSetSplitPct + handleVisitorAssignVariant non câblés au router
Grep tous les handlers créés mais non routés :
```bash
grep -rE "^export (async )?function handle[A-Z]" src/worker/*.ts | awk '{print $4}' | sed 's/(.*//' | sort -u > /tmp/all-handlers.txt
grep -oE "m\.handle[A-Za-z]+" src/worker.ts | sort -u | sed 's/m\.//' > /tmp/routed-handlers.txt
diff /tmp/all-handlers.txt /tmp/routed-handlers.txt | grep "^<" | head -50
```

Pour chaque handler non routé : câbler dans worker.ts router.

---

## 🚫 RÈGLES STRICTES (NE PAS DÉVIER)

1. **100% additif** sur les contrats §6 figés (signatures handlers existants, formats de réponse `{data}/{error}`)
2. **Capabilities seq80 figées** (12 caps, JAMAIS ajouter de 13e)
3. **Imports relatifs côté worker** (jamais `@/`)
4. **Pas de champ `code` au top-level** de la réponse (codes dans `error` string ou `meta`)
5. **Anti-throttle agents** : MAX 4 simultanés (sinon stuck silencieux comme S34)
6. **i18n parité STRICT** : utiliser `scripts/i18n-parity-audit.cjs` après chaque batch d'ajout de clés
7. **DEMANDER GO USER** avant :
   - Toute migration prod (`db:migrate:prod`)
   - Tout push prod (`git push` est OK, mais wrangler deploy non sans GO)
   - Toute modification de `wrangler.jsonc` ou `.dev.vars`
   - Tout changement de capability ou contrat figé
8. **Vérifier après chaque batch** :
   ```bash
   bun run build 2>&1 | grep "error TS" | head -5
   bun run test 2>&1 | grep -E "Test Files|Tests  " | tail -3
   node scripts/i18n-parity-audit.cjs 2>&1 | tail -5
   ```
   Si TS errors ou tests fail → STOP + diagnose + fix avant batch suivant
9. **Commits par phase** (pas un commit massif comme V1) :
   - 1 commit après Phase 0 (préflight)
   - 1 commit par batch Phase 1 (12 commits)
   - 1 commit par batch Phase 2-3
   - Permet `git bisect` si bug introduit
10. **Mocks FLAG INACTIF préservés** : ne PAS activer Stripe Connect / OpenAI / Cloudflare API token / ElevenLabs sans creds confirmés par Rochdi

---

## ✅ Critères de validation par batch

Chaque batch doit cocher minimum :
- [ ] Build TS 0 erreur
- [ ] Tests baseline préservés (5273+)
- [ ] i18n parité STRICT maintenue
- [ ] Rapport agent <400 mots avec : gaps trouvés, patches appliqués, lignes avant/après, tests ajoutés
- [ ] Si nouveau handler routé : test wire-up qui prouve l'appel à l'engine
- [ ] Si nouveau composant UI : `data-testid` + a11y (`role`, `aria-*`, keyboard nav)
- [ ] Si nouvelle migration : entry dans `docs/migrations-manifest.json` + `depends_on` chaîné

---

## 🎯 Critères de validation GLOBAUX (fin de mission V2)

- [ ] **Phase 0 done** : bindings audités, bundle delta mesuré, migrations prod appliquées, skipped tests investigués
- [ ] **Phase 1 done** : 70+ handlers câblés sur leurs engines (tests wire-up prouvent le câblage)
- [ ] **Phase 2 done** : ~127 modules non couverts triés (engine créé OU explicitement skip avec raison documentée)
- [ ] **Phase 3 done** : composants UI partagés + layout + Inbox audités, tests E2E LOT 5 verts
- [ ] **Phase 4 done** : i18n dead keys nettoyées, perf bench documenté, 2e opinion sur 5 engines, handlers non routés câblés
- [ ] **HANDOFF-2026-05-27.md** créé avec bilan final
- [ ] **Bundle size delta < +500KB gzip** (idéal ≤+300KB)
- [ ] **Tests pass : 5273 → 5500+ probablement (avec tests wire-up + E2E)**
- [ ] **Smoke E2E sur staging OK** avant push prod
- [ ] **PROPOSER commit par phase** (pas un mega-commit comme V1)

---

## 📚 Lectures obligatoires AVANT de commencer

1. **`docs/HANDOFF-2026-05-26.md`** — état complet session V1
2. **`docs/GIGA-PLAN-RENFORCEMENT-A-Z.md`** — plan V1 exécuté
3. **`docs/NEXT-STEPS-POST-COMPACT.md`** — quick reference
4. **`CHANGELOG.md`** entry "SESSION RENFORCEMENT 2026-05-26"
5. **`docs/GIGA-PLAN-LOT5-SPRINTS-41-50.md`** — méta-plan LOT 5 + apprentissages
6. **CE doc (`GIGA-PLAN-RENFORCEMENT-V2-DEEP.md`)** — Mission V2

---

## 🚀 Day 1 — Checklist self-contained pour Claude #N+1

1. Lire HANDOFF-2026-05-26.md (15 min)
2. Lire ce doc en entier (10 min)
3. `cd C:/Users/rochdi/.gemini/antigravity-ide/scratch/intralys-dashboard`
4. `git status` (doit être clean sur master `921d3b3` ou plus)
5. `git pull` (au cas où des commits Rochdi sont passés)
6. `bun install` (au cas où package.json a évolué)
7. `bun run build` (vérifier 0 TS error baseline)
8. `bun run test 2>&1 | tail -5` (vérifier 5273+ pass baseline)
9. `node scripts/i18n-parity-audit.cjs 2>&1 | tail -5` (vérifier parité STRICT)
10. **DEMANDER À USER** : par quelle Phase commencer ? (Phase 0 préflight recommandée si pas encore fait)
11. Lancer dispatch agents par batch (anti-throttle max 4 simultanés)
12. Après chaque batch : vérif build + tests + i18n + commit

---

## 🎁 Bonus — Quick wins faciles à dispatcher

Pour démarrer rapide avec gain immédiat :
- **Câbler `audit-engine.sanitizeMetadata` dans tous les call sites `audit(env, userId, action, ...)`** (PII scrub auto sur audit log = quick win Loi 25)
- **Câbler `payments-engine.verifyStripeSignature` dans tous les webhook handlers Stripe** (sécurité prod)
- **Câbler `webhooks-engine.verifySignature` dans tous les webhook outbound** (anti-replay)
- **Investiguer les 3 todo tests** : probablement triviaux à activer

---

## 📊 Estimation effort V2

- **Phase 0** : 4 batches, ~30-60 min compute
- **Phase 1** : 12 batches × ~5-10 min = ~2h compute
- **Phase 2** : ~30 batches × ~5-10 min = ~4-5h compute
- **Phase 3** : ~8 batches × ~10-15 min = ~2h compute
- **Phase 4** : 4 batches × ~10-30 min = ~1-2h compute

**Total estimé** : ~10-12h compute parallèle (sur plusieurs sessions Claude post-compact friendly).

---

## 🛡 Safety nets

- **`git tag pre-renforce-v2`** AVANT de commencer Phase 1 (rollback instantané si bug)
- **Push prod uniquement** après que la totalité V2 soit verte ET smoke E2E staging OK ET GO Rochdi explicite
- **NEVER `git push --force`** sur master
- **NEVER skip hooks** (`--no-verify`)
- **NEVER modify `.dev.vars`** sans GO user
- **NEVER apply `db:migrate:prod`** sans GO user

---

Bonne mission Claude #N+1 🚀

Doc handoff complet self-contained. État au commit `921d3b3` sur branch `master`, origin `github.com/youcefinho/dashboard`.
