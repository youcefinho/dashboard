# LOT — Sprint 49 : Affiliates / Referrals (programme parrainage order-based v2)

> Doc contrat §6 figé. Migration : seq144 — `migration-affiliates-seq144.sql`.
> Compagnons : `LOT-AFFILIATE-G2.md` (Sprint G2 — module affiliation v1 lead-based,
> seq92), `LOT-B2B-BUNDLES-PREORDERS-S48.md` (Sprint 48 B2B), schéma e-commerce
> S(E1) seq58.

## Objectif

Étendre le module d'affiliation natif S(G2) (seq92, modèle lead-based avec
payout manuel CSV) vers un **programme order-based v2** avec :

- **Codes affiliés uniques par tenant** — UNIQUE INDEX (client_id, code) override
  l'unicité applicative S92. Génération via engine `generateAffiliateCode(name)`
  (slug + suffixe random 4 chars), collision check HANDLER (boucle bornée 6).
- **Tiers + commissions par tier** — `starter` (5%), `silver` (10%), `gold`
  (15%). Override possible via `affiliates.commission_pct`. Validation HANDLER
  via whitelist `AFFILIATE_TIERS_S49` (PAS de CHECK SQL).
- **Referrals order-based** — Coexistence avec le modèle lead-based S92 (colonne
  `lead_id` INTOUCHÉE). Nouveau modèle : referral lié à un `order_id`, commission
  calculée SERVEUR au order completed (Phase B câblera le webhook
  ecommerce-checkout.ts). Status enum HANDLER `pending|confirmed|paid|reversed`.
- **Link click tracking enrichi** — Visitor cookie 1st-party (`visitor_id` UUID),
  source URL + landing page, PII Loi 25 (`ip_hash` + `user_agent_hash` SHA256
  HANDLER, pas brut). La colonne legacy `ip` (clair S92) coexiste — Phase B
  migrera vers ip_hash exclusif.
- **Payouts mensuels en batch** — Table NEUVE `affiliate_payouts` regroupe N
  referrals confirmés en 1 versement. Engine `createPayoutBatch()` sélectionne
  les referrals confirmés dans la fenêtre [period_start, period_end] non
  encore batchés, groupe par affiliate_id, insère N affiliate_payouts. Cap
  `settings.manage` (escalade vs `clients.manage` courant).
- **Stripe Connect flag INACTIF V1** — Colonne `affiliate_payouts.stripe_transfer_id`
  PRÉSENTE mais flag INACTIF. V1 = payout manuel (admin marque paid + export CSV).
  Phase B câblera `payouts.stripe_transfer.create` réel.
- **PUBLIC signup + track-click anti-bot** — Rate-limit `aff_signup:<ip>` 3/3600s
  et `aff_click:<ip>` 60/60s + honeypot champ `website` HANDLER.

L'endpoint signup PUBLIC reste un **stub 501** en Phase A (la résolution du
client_id via referer/origin tracking dépend du storefront tracking — Phase B
Manager-B). L'endpoint track-click est FONCTIONNEL Phase A (hash PII + insert
affiliate_clicks anti-fingerprint).

## Distinction critique S(G2) / S49

| Aspect | S(G2) (`seq92`) | Sprint 49 (`seq144`) |
|---|---|---|
| Modèle | Lead-based (commission par lead won) | Order-based (commission par order completed) |
| Tier | Aucun (1 commission_value uniforme) | starter / silver / gold (5/10/15%) |
| Payout | Manuel (admin marque approved→paid + CSV) | Batch mensuel `createPayoutBatch` (manual V1, Stripe Connect Phase B) |
| Cap admin | `workflows.manage` (legacy mode-agence-only) | `clients.manage` (escalade) + `settings.manage` (payouts) |
| Code unicité | Applicative (HANDLER collision check) | UNIQUE INDEX SQL (client_id, code) + HANDLER fallback |
| Click tracking | IP/UA clairs (S92) | ip_hash + user_agent_hash SHA256 (Loi 25) |
| Attribution param | `?aff=CODE` (PAS `?ref=`) | Idem — réutilisé (cookie aff_attr S92 préservé) |
| PUBLIC endpoints | `/r/:code` (redirect 302) | + `/api/public/affiliates/signup` + `/api/public/affiliates/track-click` |
| Tables touchées | 5 NEUVES (affiliates, programs, clicks, referrals, commissions) | 1 NEUVE (affiliate_payouts) + 4 ALTER (affiliates +7, referrals +7, clicks +8, orders +2) |
| Stripe Connect | Aucun (E4 INTOUCHÉ) | Flag INACTIF V1 (colonne présente, pas d'appel réel) |

Le Sprint 49 **étend** sans toucher : `affiliate_commissions` (S92), les
handlers S92 (`handleGetAffiliates`, `handleCreateAffiliate`,
`handleGetAffiliateProgram`, etc.) restent FONCTIONNELS. La coexistence des
2 modèles (lead-based S92 + order-based S49) est délibérée pour permettre la
migration progressive cross-tenant.

## Hors-scope

- **UI panels admin complets** (AffiliatesManager, ReferralsList, PayoutsBatch,
  ClickAnalytics) → Manager-C Phase B.
- **Hook order completed → attributeOrderToAffiliate** (câblage dans
  ecommerce-checkout.ts au moment du POST /api/orders status='completed') →
  Phase B (Manager-B backend).
- **Webhook auto-confirm referral** (cooling period 14j → pending→confirmed
  automatique) → Phase B cron Cloudflare.
- **Stripe Connect transfer.create réel** (markPaid déclenche le payout réseau) →
  Phase B câblage Stripe Connect (compte intralys-platform).
- **Customer self-service portal** (visiteur affilié consulte ses referrals/
  payouts via magic link HMAC) → backlog V2.
- **Multi-tier dynamique** (X commissions levels selon performance) → backlog V2.
- **Anti-fraude rules engine** (auto-reverse sur patterns suspects) → backlog V2.
- **Export CSV referrals/payouts** (calque exportCommissionsCsv S92) → Phase B.
- **PUBLIC signup (résolution client_id via referer/origin)** → stub 501 Phase A.

## §6 Contrats figés

### 6.1 Migration SQL

Fichier racine : `migration-affiliates-seq144.sql`. Manifest entrée seq144
(`docs/migrations-manifest.json`).

Pattern **100 % ADDITIF** :

- `CREATE TABLE IF NOT EXISTS affiliate_payouts` — (`id`, `affiliate_id` NOT
  NULL, `client_id` NOT NULL, `period_start`, `period_end`, `total_cents`
  INTEGER DEFAULT 0, `referrals_count` INTEGER DEFAULT 0, `status` DEFAULT
  'pending', `paid_at`, `stripe_transfer_id`, `notes`, `created_at`).
- `ALTER TABLE affiliates ADD COLUMN` × 7 : `customer_id`, `tier` DEFAULT
  'starter', `commission_pct` REAL DEFAULT 0.05, `total_commissions_cents`
  INTEGER DEFAULT 0, `total_referrals_count` INTEGER DEFAULT 0, `payout_method`
  DEFAULT 'manual', `payout_account_ref`.
- `ALTER TABLE affiliate_referrals ADD COLUMN` × 7 : `order_id`, `customer_id`,
  `commission_cents` INTEGER DEFAULT 0, `status` DEFAULT 'pending',
  `confirmed_at`, `paid_at`, `payout_id`.
- `ALTER TABLE affiliate_clicks ADD COLUMN` × 8 : `visitor_id`, `source_url`,
  `landing_page`, `ip_hash`, `user_agent_hash`, `country`, `converted_order_id`,
  `converted_at`, `clicked_at`.
- `ALTER TABLE orders ADD COLUMN` × 2 : `referred_by_affiliate_id`,
  `referral_code`.
- Index : `uniq_affiliates_client_code UNIQUE (client_id, code)`,
  `idx_affiliates_client_status (client_id, status)`, `idx_affiliates_customer
  (customer_id)`, `idx_affiliate_referrals_affiliate (affiliate_id, status)`,
  `idx_affiliate_referrals_order (order_id)`,
  `idx_affiliate_payouts_affiliate_status (affiliate_id, status)`,
  `idx_affiliate_payouts_client_period (client_id, period_end)`,
  `idx_affiliate_clicks_affiliate (affiliate_id, clicked_at)`.

**Aucun CHECK** ajouté. Validation enum (`tier`, `status`, `payout_method`)
appartient au HANDLER (`affiliate-engine.ts` whitelists). Aucune FK (D1/SQLite —
FK ⇒ rebuild interdit). Aucune colonne droppée, aucun RENAME. SQLite ne
supporte PAS `IF NOT EXISTS` sur ADD COLUMN ⇒ la migration est SENSIBLE au
rejeu (D1 lèvera "duplicate column name"). MITIGATION : tracker `_migrations`
SQL bloque le rejeu (migrate.ts:applyMigration).

### 6.2 Routes API (2 PUBLIC + 11 AUTHED Sprint 49 + routes S92 préservées)

**PUBLIC** (pré-requireAuth) :

| Route | Méthode | Rate-limit | Handler |
|---|---|---|---|
| `/api/public/affiliates/signup` | POST | `aff_signup:<ip>` 3/3600s | `handlePublicAffiliateSignup` (stub 501 Phase A) |
| `/api/public/affiliates/track-click` | POST | `aff_click:<ip>` 60/60s | `handlePublicTrackClick` (fonctionnel Phase A) |

**AUTHED Sprint 49** (insertion après bloc S48 + dans bloc S92) :

| Route | Méthode | Cap | Handler |
|---|---|---|---|
| `/api/affiliates/:id/metrics` | GET | `clients.manage` | `handleGetAffiliateMetrics` (fonctionnel — engine câblé) |
| `/api/affiliates/:id` | PATCH | `clients.manage` | `handleUpdateAffiliateS49` (stub 501 Phase A) |
| `/api/affiliate-referrals` | GET | `clients.manage` | `handleListReferrals` (fonctionnel) |
| `/api/affiliate-referrals/:id/confirm` | POST | `clients.manage` | `handleConfirmReferral` (fonctionnel + agrégat) |
| `/api/affiliate-referrals/:id/reverse` | POST | `clients.manage` | `handleReverseReferral` (fonctionnel + agrégat) |
| `/api/affiliate-payouts` | GET | `settings.manage` | `handleListPayouts` (fonctionnel) |
| `/api/affiliate-payouts` | POST | `settings.manage` | `handleCreatePayoutBatch` (fonctionnel — engine câblé) |
| `/api/affiliate-payouts/:id/mark-paid` | POST | `settings.manage` | `handleMarkPayoutPaid` (fonctionnel) |

**Préservées S92** (FONCTIONNELLES — coexistence des 2 modèles) :

- `GET /api/affiliates`, `POST /api/affiliates`
- `GET|PUT|DELETE /api/affiliates/:id`
- `GET|PUT /api/affiliate-program`
- `GET /api/affiliate-commissions`, `GET /api/affiliate-commissions/export`
- `PATCH /api/affiliate-commissions/:id`
- `GET /r/:code` (redirect 302 anonyme — handleAffiliateRedirect S92)

Le `POST /api/affiliates` admin Sprint 49 (avec tier + commission_pct) est
exposé via le helper TS `createAffiliateAdmin` côté front mais l'endpoint
worker.ts reste celui de S92 (`handleCreateAffiliate`) qui accepte le
superset de champs — un alias `handleCreateAffiliateAdmin` est défini dans
affiliates.ts mais non câblé en route (Phase B Manager-B décidera de la
migration POST).

Câblage worker.ts :
- 2 PUBLIC ~ligne 800 (après `/api/public/preorders` S48).
- `/affiliates/:id/metrics` AVANT `affiliateIdMatch` dans le bloc S92 (anti-shadowing).
- PATCH `affiliateIdMatch` ajouté dans le bloc S92 (S92 PUT préservé).
- 6 routes `/affiliate-referrals` + `/affiliate-payouts` après le bloc S92.

Ordre anti-shadowing strict (suffixes `/:id/<action>` AVANT `/:id` générique).

### 6.3 Capabilities FIGÉES (AUCUN ajout ALL_CAPABILITIES seq80)

- `clients.manage` (admin/owner client) : affiliates CRUD (S49 PATCH +
  `/metrics`), referrals list + confirm + reverse. **Rationale** : opérationnel
  tenant — l'owner gère ses affiliés + valide les conversions sans intervention
  agence.
- `settings.manage` (admin/owner client — escalade) : payouts list + create
  batch + mark paid. **Rationale** : action financière sensible — distingue
  les actions courantes (CRUD affiliés) des versements monétaires (escalade
  vers settings.manage). Phase B câblera l'audit log par défaut.
- **PUBLIC** (pré-requireAuth) :
  - `POST /api/public/affiliates/signup` — opt-in PUBLIC programme affilié.
    Rate-limit `aff_signup:<ip>` 3/3600s + honeypot `website`. Stub 501 Phase A.
  - `POST /api/public/affiliates/track-click` — log click anonyme. Rate-limit
    `aff_click:<ip>` 60/60s + honeypot. PII Loi 25 (ip_hash + UA_hash SHA256).

La cap legacy `workflows.manage` (S92 `affiliateCapGuard`) reste utilisée pour
les routes S92 préservées. Aucun ajout `ALL_CAPABILITIES` seq 80.

### 6.4 PUBLIC anti-bot + PII Loi 25

- **Rate-limit signup** : `aff_signup:<cf-connecting-ip>` max 3 hits / 3600s
  (sliding window via `lib/rate-limit.checkRateLimit`). Dépassement ⇒ 429 +
  retry_after_seconds.
- **Rate-limit track-click** : `aff_click:<cf-connecting-ip>` max 60 hits / 60s
  (sliding window). Dépassement ⇒ 429.
- **Honeypot** : body inclut champ optionnel `website` (chaîne vide attendue).
  Si rempli ⇒ bot, HANDLER retourne 200 silencieux `{ data: { id: 'bot', ... } }`
  (anti-fingerprint : ne révèle pas le piège).
- **PII Loi 25** (track-click) : IP + User-Agent hashés SHA256 HANDLER
  (`sha256Hex(input)`), stockés dans `affiliate_clicks.ip_hash` /
  `user_agent_hash`. Pas d'IP brute persistée pour les nouvelles entrées V2
  (la colonne legacy `ip` S92 coexiste — Phase B migrera vers ip_hash exclusif).
- **Visitor cookie 1st-party** : `visitor_id` UUID si non transmis par le
  script tracking. Permet le tracking cross-session sans cookie tiers (Loi 25
  compliant — pas de fingerprinting).
- **Anti-fingerprint code unknown** : si le code transmis ne match aucun
  affilié actif ⇒ retour 200 silencieux `{ id: 'unknown', visitor_id }` —
  ne révèle pas l'existence ou non du code.

### 6.5 Conventions

- imports RELATIFS uniquement (`./types`, `./capabilities`, `./helpers`,
  `./lib/affiliate-engine`, `./lib/rate-limit`)
- contrat réponses : `json({ data })` succès / `json({ error }, status)` erreur —
  **JAMAIS** de champ `code`
- bornage tenant strict : `WHERE client_id = ?` (defense-in-depth IDOR) sur
  toutes les routes AUTHED. PUBLIC track-click résout `client_id` via lookup
  `affiliates.code → affiliates.client_id` (PAS d'auth context).
- garde capability au TOP de chaque handler AUTHED (`clientsManageCapGuard` ou
  `settingsManageCapGuard`)
- pas de throw HANDLER — best-effort, dégradation gracieuse
- devise locked `'CAD'` V1
- Stripe Connect flag INACTIF V1 (colonne présente, pas d'appel réel)
- i18n parité STRICTE 4 catalogues (`en`, `fr-CA`, `fr-FR`, `es`) — 22 clés

### 6.6 i18n keys (22, parité STRICTE 4 catalogues)

```
affiliates.title
affiliates.create
affiliates.signup
affiliates.empty
affiliates.code
affiliates.tier_starter
affiliates.tier_silver
affiliates.tier_gold
affiliates.commission_pct
affiliates.total_commissions
affiliates.referrals.title
affiliates.referrals.confirm
affiliates.referrals.reverse
affiliates.referrals.empty
affiliates.payouts.title
affiliates.payouts.create_batch
affiliates.payouts.mark_paid
affiliates.payouts.empty
affiliates.clicks.title
affiliates.metrics.title
affiliates.metrics.conversion_rate
affiliates.errors.duplicate_code
```

### 6.7 Phase A SOLO (Manager-A) — Livrables

- Migration `migration-affiliates-seq144.sql` (1 table NEUVE + 24 ADD COLUMN +
  8 index, 100% ADDITIF).
- Manifest entrée seq144 (`docs/migrations-manifest.json`).
- Types `src/lib/api.ts` (5 interfaces + 6 input types + ~13 helpers AUTHED +
  2 helpers PUBLIC).
- Routes worker.ts (2 PUBLIC ~l.800 + 8 AUTHED après bloc S48 ~l.3585 et dans
  bloc S92 ~l.2167).
- Engine `src/worker/lib/affiliate-engine.ts` NEUF (5 helpers — generateAffiliateCode
  pure, computeCommissionForOrder pure, computeAffiliateMetrics async D1,
  attributeOrderToAffiliate async D1, createPayoutBatch async D1).
- Handlers Sprint 49 dans `src/worker/affiliates.ts` (11 AUTHED + 2 PUBLIC + 1
  hook — 9 fonctionnels, 2 stubs 501 signup/PATCH-S49 dont signatures FIGÉES).
- i18n keys × 4 catalogues (22 clés, parité STRICTE).
- Doc `docs/LOT-AFFILIATES-S49.md` (§6 figé).

### 6.8 Phase B (Manager-B) — Suite

- Corps fonctionnel des 2 stubs 501 (`handlePublicAffiliateSignup` câblage
  résolution client_id via referer/origin storefront tracking ;
  `handleUpdateAffiliateS49` update tier/commission_pct/payout_method/status).
- Câblage `attributeOrderToAffiliate` dans `ecommerce-checkout.ts` (POST
  /api/orders avec status='completed' ou webhook payment-confirmed).
- Câblage `onOrderRefunded` → auto-reverse referral (refund → status='reversed'
  + ajustement agrégat affiliates.total_commissions_cents).
- Cron Cloudflare scheduled :
  - Auto-confirm referrals : pending → confirmed après 14j cooling period.
  - Batch payouts mensuel automatique (1er du mois → createPayoutBatch sur
    le mois précédent).
- Stripe Connect câblage réel (`markPayoutPaid` déclenche `stripe.transfers.create`,
  stocke `stripe_transfer_id`, update status='paid' OU 'failed' selon réponse).
- Email best-effort sur referral confirmed (notification affilié + invite à
  signup s'il n'a pas encore créé son compte customer).
- Export CSV referrals/payouts (calque exportCommissionsCsv S92).
- UI panels admin (Manager-C — AffiliatesManager avec tier selector,
  ReferralsList filtrable, PayoutsBatchCreator, ClickAnalyticsDashboard,
  AffiliateMetricsCard).
- Migration progressive S92 → S49 (script de bascule lead-based →
  order-based pour les tenants qui adoptent la v2).

### 6.9 Sécurité — résumé defense-in-depth

| Layer | Mécanisme |
|---|---|
| AuthZ AUTHED (CRUD) | `requireCapability('clients.manage')` AU TOP de chaque handler |
| AuthZ AUTHED (payouts) | `requireCapability('settings.manage')` (escalade) |
| AuthZ PUBLIC | Aucun auth — rate-limit `aff_signup:<ip>` 3/3600s + `aff_click:<ip>` 60/60s + honeypot `website` |
| Tenant isolation AUTHED | `WHERE client_id = ?` partout + `loadAffiliateStrictTenant` / `loadReferralInTenant` / `loadPayoutInTenant` |
| Tenant isolation PUBLIC | track-click : lookup `affiliates.code → affiliates.client_id` HANDLER, stocké denorm `affiliate_clicks.client_id` |
| Tenant isolation attribution | `attributeOrderToAffiliate` borne via `orders.client_id` ⇒ empêche cross-tenant attribution |
| Anti-IDOR | Bornage WHERE client_id appliqué AVANT toute lecture/mutation (jamais juste WHERE id =) |
| Anti-bot PUBLIC | Honeypot champ `website` — réponse 200 silencieuse si rempli (anti-fingerprint) |
| Anti-fingerprint code unknown | track-click code non trouvé ⇒ 200 silent `{ id: 'unknown' }` |
| Anti-XSS UI | `sanitizeInput` sur tous les inputs visiteur (name, email, source_url, landing_page, payout_account_ref, notes) |
| PII Loi 25 | track-click hash SHA256 IP + User-Agent (`ip_hash`, `user_agent_hash`) — pas brut |
| Cookie 1st-party | `visitor_id` UUID (pas de cookie tiers — Loi 25 compliant) |
| Anti-fraude basique | Idempotence `attributeOrderToAffiliate` (UNIQUE referral par order_id) ; reverse → ajustement agrégat |
| Stripe Connect FLAG inactif | Colonne `stripe_transfer_id` présente, JAMAIS d'appel `stripe.transfers.create` en V1 |

---

**Statut Phase A** : Livré 2026-05-25. Tests E2E + UI panels + câblage
ecommerce-checkout suivront en Phase B.
