# PHASE 1 — PLAN MAÎTRE DE CÂBLAGE engines→handlers (2026-05-27)

> Mappé depuis la VM (recon read-only, 4 agents Explore). **À EXÉCUTER côté hôte** (bun/test dispo). Chaque ligne SAFE = à câbler + valider ; chaque DEFERRED = décision/validation avant.
> ⚠️ Les **numéros de ligne sont indicatifs** (recon agent) : l'exécutant DOIT relire le call-site avant d'éditer. Mais le classement SAFE/DEFERRED a été vérifié par lecture comparée.

## Légende
- **SAFE** = logique inline byte-identique/sur-ensemble strict → extraction sans changement de comportement. Câblable + test wire-up.
- **DEFERRED** = câbler CHANGE le runtime (validation plus stricte, format différent, policy) OU helper sans call-site (ajout de surface). Exige tests dédiés + parfois GO Rochdi.
- **ALREADY-WIRED** = handler appelle déjà le helper. Rien à faire.
- **VOID-IMPORT** = helper importé en `_nom` (satisfait TS) mais jamais appelé → câblage = remplacer la logique inline correspondante.
- **NOT-ROUTED** = fichier handler présent mais non importé dans `worker.ts` → décision de routage requise.

---

## ✅ DÉJÀ FAIT — Batch 1.1 (cette session VM, à valider hôte)
| Handler | Helper(s) | Type |
|---|---|---|
| `security-admin.ts` | `extractUserIdFromPath`, `formatAuditLogEntry` | SAFE — câblé |
| `compliance.ts` | `buildDataExport` (purpose Loi 25 explicite) | SAFE — câblé |
| `billing.ts` | `formatInvoiceNumber` (S3) + `computeTaxBreakdown` QC (S4) | SAFE byte-identique vérifié — câblé |
+ tests wire-up source-anchor : `security-admin.test.ts`, `compliance.test.ts`, `billing-wireup.test.ts`. + réactivation test webhooks rotate/revoke (Phase 0.4).

---

## 🟢 SAFE — VÉRIFIÉ ligne par ligne (⚠️ classement agent CORRIGÉ — 5/7 faux)

> ⚠️ **Le classement SAFE initial de l'agent Explore était FAUX à 5/7.** Vérification manuelle (lecture comparée des deux implémentations) effectuée. Résultat réel ci-dessous. **NE PAS se fier au libellé « SAFE » d'un agent sans relecture.**

| # | Handler | Helper | Verdict vérifié | Raison |
|---|---|---|---|---|
| S1 | `ecommerce-coupons.ts` | `computeDiscountCents` | ❌ **REJET** | Helper inexistant (engine = `computeDiscount`, signature/logique ≠). |
| S2 | `ecommerce-inventory.ts` | `computeAvailable` | ❌ **DEFERRED** | Engine clampe ≥0 + round ; handler (l.144) ne clampe pas (réservé>quantité). + l.410 = SQL. |
| **S3** | `billing.ts` | `formatInvoiceNumber` | ✅ **CÂBLÉ (VM)** | `formatInvoiceNumber(count+1, year, 4)` = `INV-${year}-${pad4}` identique (gardes engine no-op). |
| **S4** | `billing.ts` | `computeTaxBreakdown` (QC) | ✅ **CÂBLÉ (VM)** | `round2` byte-identique + taux QC identiques (0.05/0.09975) → tps/tvq inchangés. |
| S5 | `memberships.ts` | `isLessonAvailable` | ❌ **DEFERRED** | Edge-cases ≠ : `enrolledAt=""` → true vs false ; dates avec offset tz. |
| S6 | `telephony.ts` | `parseStatusCallback` | ❌ **DEFERRED** | Engine valide `status` (whitelist→null) + `duration` (NaN→null) → change écritures DB en aval. |
| S7 | `conversion-engine.ts` | `confidenceFromSampleSize` | ❌ **DEFERRED** | Seuils ≠ : handler `≥50 high / ≥10 medium` vs engine `>500 high / >50 medium`. |

**SAFE réel = S3 + S4 uniquement** → câblés en VM cette session + `billing-wireup.test.ts`. S1/S2/S5/S6/S7 reclassés DEFERRED.

**Leçon** : SAFE vs DEFERRED exige une relecture comparée manuelle des deux implémentations (un agent qui survole se trompe — ici 5/7). L'exécutant hôte doit traiter CHAQUE câblage DEFERRED comme un changement de comportement à valider par test, jamais comme une extraction triviale.

**Procédure par câblage** : (1) relire call-site + helper, (2) décider SAFE (byte-identique prouvé) ou DEFERRED (ajuster tests), (3) importer `./lib/<engine>`, (4) remplacer, (5) supprimer code mort, (6) test wire-up, (7) `bun run build && bun run test` vert avant le suivant. 1 commit/câblage.

---

## 🟡 VOID-IMPORT — câblage = remplacer l'inline (vérifier équivalence d'abord)
Helpers déjà importés en `_nom` (pattern void) mais jamais appelés. Le câblage consiste à les brancher sur la logique inline existante. **Vérifier l'équivalence comme un SAFE** ; si la logique engine diffère → DEFERRED.

| Handler | Engine | Helpers (void) |
|---|---|---|
| `scheduled-reports.ts` | `scheduled-reports-engine` | `validateCronExpression`, `parseRecipients`, `computeNextRun` |
| `reports.ts` | `reports-engine` | `validateQueryFilters`, `validateDateRange`, `formatExportCsv` |
| `dashboard.ts` | `dashboard-engine` | `validateWidgetConfig`, `validateDashboardLayout`, `computePeriod` |
| `admin-analytics.ts` | `admin-analytics-engine` | `aggregateByPeriod`, `formatChurnRate`, `formatGrowthRate` |

---

## 🔴 DEFERRED — changement de comportement / policy / helper sans call-site
Ne câbler qu'avec tests dédiés (et GO Rochdi si policy). Raison résumée par groupe.

### Auth/Security (Batch 1.1 reste)
- `auth.ts`/`auth-engine` : `validatePassword` (min 6/8 → **12** = policy), `parseAuthHeader` (signature `{token,error,code}` ≠ string), `normalizeEmail`/`validateEmailLogin` (lookup). `hashPassword`/`verifyPassword` = **crypto.ts est la source**, ne pas dupliquer.
- `auth.ts`/`security-engine` : `generateBackupCodes` (hex8 → `XXXX-XXXX` = **format/données**), `generatePwdResetToken` (UUID → hex48 = **format/liens**), TOTP/MFA = pas de call-site (P0-8 futur).
- `compliance.ts`/`compliance-engine` : `validateConsentInput` (allowlist 5→9 types), `validateGdprRequest`/`isWithinGdprWindow`/`redactPii` (pas de call-site).
- **audit** : `audit()` (helpers.ts) redige DÉJÀ les PII par **clés** (`audit-redact.ts`). `audit-engine.sanitizeMetadata` redige par **valeur** → stratégie différente, **ne pas brancher sans décision** (risque double-redaction / casse tests Sprint 23).

### E-commerce (1.3/1.4/1.5)
- products (`validateSku`/`validateProductInput`/`normalizePriceCents`), orders (`computeOrderTotals`/`validateOrderTransition`/`canCancelOrder`), cart (`generateCartToken`/`isCartExpired`/`validateCartItem`), payments (`verifyStripeSignature`/`validatePaymentAmount`/`parseStripeWebhook`), shipments, returns, refunds, disputes : **tous DEFERRED** — validation plus stricte que l'inline ou pas de call-site. `payments.verifyStripeSignature` = sécurité, à câbler en priorité côté hôte AVEC tests.
- coupons `validateCouponCode`/`validateCouponType` (enum/regex strict), inventory `validateStockAdjustment` (enum reasons), inventory-strategy `allocateFifo/Lifo/Fefo` (nouvelle API), import `parseCsvRow`/`validateImportRow` (refactor).

### SaaS/Admin (1.6)
- saas-billing : `computeProration`/`getDunningSchedule`/`validatePlanTransition`/`computeMrr`/`computeChurnRate` — **⚠️ E4 LIVE flag inactif** (mock préféré). DEFERRED jusqu'à GO Stripe + PCI.
- clients-admin (`validateClientInput`/`validateSlug`/`provisionClientPayload`), onboarding (`computeProgress`/`validateSkipReason`/`mergeChecklistItems`) : validation plus stricte / pas de call-site.

### Workflows/AI (1.7)
- workflows (`validateStepInput`/`validateBranchCondition`/`isWithinQuietHours`/`parseWaitDuration`/`interpolateTemplate`), ai (`validatePromptInput`/`sanitizePromptForLog`/`truncateContext`/`estimateTokens`), ai-chat (`parseIntent`/`truncateHistory`/`extractEntities`), proactive-ai (`detectInactivity`/`detectMilestone`/`rankSuggestions`) : ajout de surface (guards/budgeting) sans call-site actuel.

### Sites/Forms/Comm (1.8/1.9)
- sites (`validateSiteSlug`/`validatePageNav`/`canPublishSite`), forms (`validateFieldDefinition`/`sanitizeFieldValue`/`detectBotSubmission`), storefront-public (`validateCheckoutInput`/`computeShippingCost`/`detectStorefrontBot`) : validation/guards nouveaux.
- telephony : `validatePhoneE164`/`formatTwimlResponse`/`validateIvrConfig` (DEFERRED ; `parseStatusCallback` = SAFE, voir S6).
- **NOT-ROUTED** : `calls-outbound.ts`, `voicemails.ts`, `chat-widgets.ts` — non importés dans worker.ts. Décider du routage AVANT câblage (sinon code mort). `telephony.ts` = import dynamique partiel (vérifier).

### Marketing/Utils (1.11/1.12)
- broadcast, templates, forecast, conversion (`clampScore`/`computeWeightedScore`), catalog, marketplace, tickets, quotes, documents, cookies-consent, data-reconcile, currencies, snapshots/snapshot-import, meta, oauth, social, webhooks, gbp, ecommerce-analytics/rfm/reco/channel-sync : **DEFERRED overall** (validation plus stricte / patterns différents). ⚠️ Le routage de plusieurs (1.12) est marqué « INFERRED » par l'agent → **vérifier `worker.ts` avant** de toucher.

---

## Validation hôte (par batch)
```bash
cd C:/Users/rochdi/.gemini/antigravity-ide/scratch/intralys-dashboard
bun run build 2>&1 | grep "error TS" | head -5
bun run test  2>&1 | grep -E "Test Files|Tests  " | tail -3
node scripts/i18n-parity-audit.cjs 2>&1 | tail -5
```

## Ordre d'exécution recommandé (hôte)
1. **Valider Batch 1.1** (déjà câblé VM) → commit.
2. **SAFE S1→S7** (un par un, build+test entre chaque) → commits.
3. **VOID-IMPORT** (vérifier équivalence ; câbler les équivalents, garder DEFERRED sinon).
4. **DEFERRED sécurité d'abord** : `payments.verifyStripeSignature`, `webhooks.verifySignature` (avec tests) — gros gain prod.
5. Reste DEFERRED par valeur business, avec tests + décisions policy.

## Caveats recon
- Certains routages « INFERRED » (batch 1.12) et quelques line-ranges sont à confirmer côté hôte avant édition.
- `ghl-oauth.ts` : seul un stub migration existe (pas de handler actif).
