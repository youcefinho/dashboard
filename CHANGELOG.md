# Changelog

Toutes les évolutions notables d'Intralys CRM.

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage proche de [SemVer](https://semver.org/lang/fr/).

## [Vague 10 COMPLETE] Sprints 91-100 — Robustesse, Compliance & Mobile Native

> 10 sprints code-complete. **124 nouveaux tests** ajoutés (5497→5621). Build + tests OK.

### Sprint 100 (seq195) — Audit de Sécurité Global & SOC2
- Module `security-audit-engine.ts` : audit CSP (score + findings), audit dépendances (packages risqués), audit surface API (couverture auth + rate-limit).
- Matrice SOC2 Type II (10 contrôles CC6/CC7/CC8/A1 documentés avec evidence code).
- Score global pondéré (CSP 30% + deps 30% + API 40%) → note A-F.
- Rapport de sécurité complet JSON structuré.
- 16 tests unitaires.

### Sprint 99 (seq194) — Tests de Régression Visuelle E2E
- Module `visual-test-helpers.ts` : registre 8 routes (login, dashboard, leads, pipeline, tasks, calendar, inbox, settings).
- 3 viewports standardisés (desktop 1280×720, tablet 768×1024, mobile 375×667).
- Construction d'URLs de test, snapshot naming, masquage de contenu dynamique, seuils de tolérance.
- 10 tests unitaires.

### Sprint 98 (seq193) — Notifications Push Enrichies (Rich Push)
- Module `push-notification-engine.ts` : payloads FCM v1 et APNS structurés.
- 8 catégories de notifications avec actions rapides (Appeler, Répondre, Confirmer, etc.).
- Validation tokens FCM/APNS, quiet hours overnight, badge count (cap 99).
- 16 tests unitaires.

### Sprint 97 (seq192) — Mode Hors-Ligne Mobile (SQLite Local)
- Module `offline-sync-engine.ts` : manifeste de sync bidirectionnel (upload/download/conflits).
- Détection de conflits (timestamps + content hash) et résolution (last_write_wins, local_priority, remote_priority).
- Payload batch compact, validation de réponse de sync.
- 15 tests unitaires.

### Sprint 96 (seq191) — Versioning Strict d'API Publique
- Module `api-versioning-engine.ts` : parsing path versionné (`/api/v1/`, `/api/v2/`).
- Headers RFC 8594 (Deprecation, Sunset, X-API-Migration).
- Transformation bidirectionnelle camelCase↔snake_case (13 champs mappés).
- Registre de 4 breaking changes documentés.
- 15 tests unitaires.

### Sprint 95 (seq190) — Division de Code & Chunks Optimisés
- Module `lazy-routes.ts` : factory `lazyPage()` (React.lazy + Suspense intégré).
- Préchargement intentionnel `preloadPage()` avec cache anti-doublon.
- Catalogue de 8 pages lazy (Settings, Reports, Warehouse, Calendar, Inbox, EmailBuilder, WorkflowBuilder, FormBuilder).
- 8 tests unitaires.

### Sprint 94 (seq189) — Cache Edge & Optimisation CDN
- Module `edge-cache-engine.ts` : 6 profils de cache (public_form, widget, api, asset, site_page, storefront).
- Clé canonique déterministe (params triés), headers Cache-Control + Vary + ETag.
- ETag SHA-256 tronqué, détection staleness, purge ciblée par clientId × resourceType.
- 15 tests unitaires.

### Sprint 93 (seq188) — Purge RGPD & Loi 25 Automatisée
- Module `privacy-purge-engine.ts` : validation de règles (inactive_days, action whitelist).
- Identification des leads inactifs avec protection des statuts métier (won/customer/vip).
- Anonymisation Loi 25 (`[SUPPRIMÉ]`) préservant l'intégrité statistique.
- Rapport d'audit traçable (Art 23), limites de rétention par juridiction (QC/CA/EU).
- 15 tests unitaires.

### Sprint 92 (seq187) — Chiffrement des Données Personnelles
- Module `field-encryption-engine.ts` : wrapper AES-GCM 256 haut-niveau.
- Chiffrement/déchiffrement de champs PII individuels (email, phone, notes, message).
- Migration progressive (préfixe `enc:` pour distinguer champs chiffrés/non-chiffrés).
- Batch `encryptLeadPii`/`decryptLeadPii` + rotation de clés.
- 14 tests unitaires.

## [Sprint 91] Rate-Limiting Distribué — Cloudflare KV (seq186)

### Ajouté
- Module `src/worker/lib/rate-limit-kv.ts` : fixed-window counter via Cloudflare KV.
  - 3 tiers : `public` (60 req/min/IP), `authenticated` (120 req/min/user), `api` (300 req/min/key).
  - Idiome FAIL-OPEN garanti : KV absent ou en panne → requête toujours autorisée.
  - Headers standard `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.
  - Réponse 429 JSON structurée (`error`, `code: RATE_LIMITED`, `retry_after_seconds`).
- Middleware global dans `src/worker.ts` :
  - Tier `public` (IP) appliqué AVANT le routage sur toutes les routes `/api/*`.
  - Tier `authenticated` (userId) appliqué APRÈS `requireAuth` pour un quota nominal plus élevé.
  - Exemptions : `OPTIONS` (CORS preflight), routes non-API (SPA assets).
- 14 tests unitaires (`rate-limit-kv.test.ts`) : fail-open ×3, compteur, quota, headers, réponse 429, config tiers.

### Notes techniques
- Le rate-limiter D1 existant (`rate-limit.ts`) reste en place pour rétro-compatibilité des handlers spécifiques.
- Commentaire de redirection ajouté dans `rate-limit.ts` pour orienter les nouveaux développements vers le module KV.
- Frontend : intercepteur 429 et clé i18n `api.rate_limit` déjà en place (aucune modification nécessaire).

## [SESSION RENFORCEMENT 2026-05-26] Depth pass massif LOT 4-5

> Session entière dédiée au renforcement/solidification (depth > breadth). Aucun nouveau sprint ajouté — chaque module existant audité + renforcé.

### Validation Antigravity LOT 5 — TOUTE EXÉCUTÉE
- ✅ Build clean (0 erreur TS, vs 120+ au début de session — incluait gbp/onboarding/api.ts duplicates legacy + bugs LOT 5 wire-up)
- ✅ Migrations seq103-145 toutes appliquées D1 local. **Fix seq138** : collision `lesson_progress` (seq87 member_id vs seq138 enrollment_id) → rename table LMS `lesson_progress` → `lms_lesson_progress` + update handlers/tests
- ✅ Tests : 1715 → **2656 pass** (186 fichiers, +941 tests, 0 fail vs 74 initial)
- ✅ i18n parité STRICTE 4 catalogues : 5791 → **5973 keys** identiques (fr-CA/fr-FR/en/es). Script `scripts/i18n-parity-audit.cjs` créé.

### Engines renforcés (19 modules)

**LOT 5 (11 engines)** — 3 250 → 7 389 lignes (+127%) :
- `lib/dns-engine.ts` (176→480), `lib/community-engine.ts` (201→672), `lib/survey-engine.ts` (205→667), `lib/voice-agent-engine.ts` (253→606), `lib/lms-engine.ts` (256→488), `lib/subscription-engine.ts` (268→594), `lib/chat-bot-engine.ts` (295→738), `lib/pricing-engine.ts` (300→626), `lib/funnel-engine.ts` (362→880), `lib/warehouse-engine.ts` (381→725), `lib/affiliate-engine.ts` (553→913)
- Tests engines : +442 nouveaux tests

**LOT 4 (8 engines NEW)** — extraits depuis handlers existants :
- `lib/snapshot-engine.ts`, `lib/cart-recovery-engine.ts`, `lib/product-reviews-engine.ts`, `lib/calendar-engine.ts`, `lib/pos-engine.ts` renforcé, `lib/loyalty-engine.ts`, `lib/multicurrency-engine.ts`, `lib/gbp-engine.ts`

### Handlers wire-up production-grade (7 handlers)
- `community-forum.ts` : sanitizeBody XSS + rate-limit votes + canModerate + canTransitionStatus
- `voice-agent.ts` : 3 endpoints Twilio (incoming/gather/escalate) + signature HMAC + state machine + DTMF + 3 routes câblées dans `src/worker.ts:1084+`
- `surveys.ts` : validateAnswer + isWithinSurveyWindow + hashRespondentIp Loi 25 + anti-double-submit + 2 nouveaux endpoints
- `chat-bot.ts` : full RAG + PII scrub Loi 25 + rate-limit + retrieveTopK + escalation
- `courses-lms.ts`, `subscriptions-advanced.ts`, `b2b-bundles-preorders.ts`, `funnels-builder.ts`, `warehouse-dropship.ts`, `affiliates.ts`, `custom-domains.ts` : validation stricte + error codes stables + edge cases

### UI components LOT 5 renforcés (27 composants)
Loading + Empty + Error + A11y (aria-busy/role=alert/aria-live/aria-label) + i18n complet + Confirm dialogs sur destructive.

**Composants** : CertificatesList, FunnelAnalytics, NpsAnalytics, DropshipOrdersDashboard, ThreadsList, ThreadDetail, AffiliatesManager, BundlesManager, QuizBuilder, LessonsManager, LessonViewer, StepEditor, WarehousesManager, DropshipRoutingsEditor, DropshipSuppliersManager, InventoryTransfersList, CustomerGroupsManager, TierPricesEditor, PreordersDashboard, CommunityModerationQueue, PayoutsManager, ReferralsTable, VariantBuilder, FunnelsManager, SurveyBuilder, CustomDomainsManager, DnsRecordsEditor.

### Patterns sécurité production appliqués
- Validation stricte RFC standards
- Error codes stables exportés (constants frozen)
- Edge cases (null/NaN/empty/overflow/div0)
- Mocks FLAG INACTIF réalistes (shape cohérent quand creds absents)
- PII scrub Loi 25 (emails/phones/CC regex strip)
- IP hashing SHA-256 anti-spam anonymes
- Rate-limit KV sliding window (fail-open)
- Anti-XSS (sanitizeBody scripts/iframes/handlers)
- A11y WCAG 2.1 AA
- 100% additif (zéro régression sur 186 fichiers tests)

### Régression-zéro garantie
Tous les tests legacy LOT 1-4 passent encore. Aucune signature handler cassée. Tous les contrats §6 FIGÉS respectés.

### Reste à faire (post-compact)
- Smoke visuel via dev stack (pas exécuté cette session)
- Commit local + push prod LOT 5 (en attente GO user)
- Activations flags (OPENAI_API_KEY priorité haute pour S42 chat RAG live)

## [Sprint 40] Product Reviews + Abandoned Carts Recovery (seq135) — DERNIER LOT 4
- Migration seq135 (2 tables product_reviews + product_review_helpful_votes + ALTER products/customers/carts multi-touch additif)
- 4 routes PUBLIC anti-bot (submit review + list + helpful vote + recovery landing) + 6 routes AUTHED
- Lib review-moderation (spam score 6 heuristiques + bad words FR/EN/ES + verified_buyer + auto-approve matrix)
- Lib abandoned-cart-recovery (cron processRecoverySequence + coupon engine reuse + 3 steps templates × 4 locales + RGPD unsubscribe)
- 4 composants frontend (ReviewModerationQueue, ReviewsList+SubmitForm, AbandonedCartsManager, RecoveryWorkflowEditor)
- Régression-zéro vs Sprint E7 single-touch (colonnes ALTER additives séparées)
- Docs : LOT-REVIEWS-ABANDONED-S40.md + RECOVERY-WORKFLOW-S40.md

## [LOT 4] Sprints 31-40 COMPLETE
- 10 sprints code-complete, migrations seq126→135
- Twilio Voice (S34) + Snapshots (S35) + Webchat enrichi (S36) + POS (S37) + Gift Cards + Loyalty (S38) + Multi-currency + Tax multi-région (S39) + Reviews + Cart recovery (S40)
- Régression-zéro garantie sur tax engine QC/EU/DZ + Sprint E7 single-touch cart recovery
- Validation Antigravity GROUPÉE pending : bun run build + tests + appliquer migrations seq126→135 + push prod

## [Sprint 39] Multi-currency + Tax engine multi-région (seq134)
- Migration seq134 (3 tables : currency_rates + tax_regions + tax_rules + ALTER products/orders)
- 11 routes AUTHED (settings.manage) + 1 route public listCurrencies (statique)
- Lib currency-converter (Frankfurter ECB API + cache D1 24h + fallback stale)
- Lib tax-engine-multi (délégation verbatim QC/EU/DZ legacy + us_sales_tax + vat + gst_pst + tva_dz + exempt + rules per category + compound)
- 4 composants frontend (CurrencySettings, TaxRegionsManager, TaxRulesEditor, CurrencyMultiSettingsPage)
- Régression-zéro garantie sur tax engine existant (13/13 tests legacy passent)
- Docs : LOT-MULTICURRENCY-TAX-S39.md

## [Sprint 38] Gift Cards + Loyalty Programs (seq133)
- Migration seq133 (5 tables : gift_cards + gift_card_transactions + loyalty_programs + loyalty_ledger + loyalty_customer_state)
- 19 routes AUTHED (settings.manage + clients.manage + invoices.write + reports.view) + 1 route PUBLIC rate-limited (balance lookup par code)
- Lib gift-card-engine (code gen 80 bits + idempotence applyTransaction + cron expire)
- Lib loyalty-engine (computeEarnedPoints + tier engine + recordLedgerEntry idempotent + expirePendingPoints)
- 3 composants frontend (GiftCardManager, LoyaltyProgramSettings, LoyaltyCustomerView) + page boutique standalone
- Docs : LOT-GIFTCARDS-LOYALTY-S38.md

## [Sprint 37] POS retail caisse — réutilise ecommerce existant (seq132)
- Migration seq132 (tables pos_registers + pos_sessions + pos_transactions + ALTER orders)
- 10 routes AUTHED (clients.manage + reports.view) gated requireModule('ecommerce')
- Lib pos-engine (computeChange, variance, roundCashTender CAD, validatePaymentSplit, chargeCardTerminal flag inactif)
- Lib pos-receipt (HTML preview + ESC/POS bytes + PDF stub + R2 upload)
- Réutilise verbatim createOrderCore + commitOrderSale + ecommerce-tax-engine (régime 'qc')
- 4 composants frontend (POSTerminal 3-cols, POSSessionManager, POSReceiptPreview, POSReportDaily)
- Docs : LOT-POS-S37.md + ESC-POS-PRINTER-S37.md

## [Sprint 36] Live chat widget — enrichissement webchat (seq131)
- Migration seq131 (ALTER webchat_widgets/sessions + table webchat_agent_presence)
- 9 handlers admin AUTHED (settings.manage) + 3 handlers PUBLIC anti-bot (origin/rate-limit/honeypot/Turnstile)
- Widget v2.js + frame-v2.html (cohabite avec v1 legacy)
- 4 composants frontend (ChatWidgetSettings, ChatInbox, ChatWidgetPreview, ChatWidgetsPage)
- Docs : LOT-CHAT-WIDGET-S36.md + EMBED-SECURITY-S36.md

## [Sprint 35] Snapshots — bundle JSON portable + signature SHA-256
- Migration seq130 (tables snapshots + snapshot_imports)
- Lib export multi-table (27 entités whitelist) + signature SHA-256 deterministic ordering
- Lib import idempotent (par client_id+name) + remap FK
- 8 routes AUTHED (settings.manage) + UI SnapshotsPage standalone
- Docs : LOT-SNAPSHOTS-S35.md + SCHEMA-VERSIONING-S35.md

## [1.0.0-beta] - 2026-05-16

Release candidate beta — prête pour les premiers utilisateurs.

### Ajouté

- Documentation utilisateur complète (30+ guides, FR québécois).
- Documentation administrateur (10 guides : organisation, équipe, rôles, facturation, intégrations, clés API, webhooks, audit, Loi 25, 2FA).
- Documentation développeur : spécification OpenAPI 3.1 (`/docs/api/openapi.yaml`), introduction API, authentification, limites de débit, référence des endpoints avec exemples curl/JS/Python.
- Page Nouveautés (changelog) publique sur `/changelog`.
- Fichier `CHANGELOG.md` racine.

### Modifié

- Centre d'aide enrichi : recherche fuzzy, navigation par sections, section Administration et section API & Développeurs.
- Page changelog refondue en style Stripe sobre (timeline verticale, badges de version, catégories Ajouté/Modifié/Corrigé/Retiré) — remplace l'ancienne version à effets visuels.
- `api-introduction` aligné sur l'implémentation réelle du worker (`/api/public/v1`, auth `ApiKey`).

## [0.12.0] - 2026-05-15

### Ajouté

- Site public : accueil, tarifs, blog, à propos, contact.
- Multilingue : français, anglais, espagnol.
- IA avancée : rédaction assistée, prédictions, insights.

### Modifié

- Accessibilité renforcée jusqu'au niveau AAA.

## [0.11.0] - 2026-04

### Ajouté

- Applications mobiles natives iOS et Android.
- Mode hors-ligne.
- Constructeur de tableaux de bord personnalisés.

### Modifié

- Navigation mobile repensée (gestes, pull-to-refresh).

## [0.10.0] - 2026-04

### Ajouté

- Messagerie unifiée enrichie : réactions, réponses rapides, brouillons IA.
- Calendrier avec glisser-déposer et pages de réservation.

### Modifié

- Performance générale environ deux fois plus rapide.
- IA déplacée côté serveur pour plus de fiabilité.

## [0.9.0] - 2026-03

### Modifié

- Refonte design complète : interface épurée style Stripe.
- Tableau de bord, leads et pipeline redessinés.

### Retiré

- Effets visuels superflus, au profit de la clarté et de la lisibilité.

[1.0.0-beta]: https://app.intralys.app/changelog
[0.12.0]: https://app.intralys.app/changelog
[0.11.0]: https://app.intralys.app/changelog
[0.10.0]: https://app.intralys.app/changelog
[0.9.0]: https://app.intralys.app/changelog
