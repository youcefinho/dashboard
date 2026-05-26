# BINDINGS-SECRETS-S10 — Inventaire exhaustif bindings & secrets Worker

> Sprint S10 « Production-readiness & go-live » — Manager C (Phase B, ∥ Manager B).
> **Doc d'inventaire uniquement, à exécuter par Rochdi sur la machine hôte.**
> **Rien n'a été exécuté ici (VM VMware : aucune commande `wrangler`/`bun`/`git`).**
> Source de vérité = `src/worker/types.ts` interface `Env` (lignes 4-58, lues
> ligne-à-ligne). Aucune valeur de secret n'apparaît dans ce document — uniquement
> les **noms** de bindings et la commande de configuration `wrangler secret put <NAME>`.

---

## ✅ SPRINT R — RÉSOLU 2026-05-17

Les 6 pages cœur CRM (`Leads`, `Dashboard`, `LeadDetail`, `Tasks`,
`Pipeline`, `Clients`) restaurées par Antigravity (commit `5764096` →
réparation `7846e72`), 0 `t()` orphelin vérifié, FR hardcodé restauré,
build vert. R ne bloque plus le go-live. Restent les prérequis infra
ci-dessous (bindings) + 5 gates + PCI/légale E4/E6.

> Configurer parfaitement tous les bindings ci-dessous ne lève PAS R. R valide
> que l'app est utilisable ; les bindings valident l'infra. Les deux sont requis.

---

## 1. Lecture du tableau

- **Binding** : nom EXACT de la propriété `Env` (`src/worker/types.ts`).
- **Type** : `D1` | `R2` | `Durable Object` | `Queue` | `KV` | `secret (string)` | `var (string)`.
  - `secret (string)` = à fournir via `wrangler secret put <NAME>` (jamais en repo/base).
  - `var (string)` = variable non sensible déclarée dans `wrangler.jsonc` `"vars"`.
- **Obligatoire/Conditionnel/Interdit-prod** : criticité go-live (incl. catégorie
  *Régulé NON configuré E4/E6* pour les zones paiement/omnicanal régulées).
- **Commande config** : commande exacte Rochdi (machine hôte). Pour D1/R2/DO/
  Queue/KV : « binding `wrangler.jsonc` » (déclaration infra, pas un `secret put`).
- **Source (types.ts:ligne)** : ligne réelle vérifiée dans `src/worker/types.ts`.
- **Note** : impact si absent / décision Rochdi / contrainte régulée.

---

## 2. Inventaire — OBLIGATOIRES (go-live impossible sans)

| Binding | Type | Obligatoire/Conditionnel/Interdit-prod | Commande config | Source (types.ts:ligne) | Note |
|---|---|---|---|---|---|
| `DB` | D1 | Obligatoire | binding `wrangler.jsonc` (`d1_databases`, déjà déclaré `wrangler.jsonc:10-16`, base `intralys-crm`) | types.ts:5 | Base de prod. Cible des 77 migrations (Gate 3/4) et du `SELECT COUNT(*) FROM _migrations` (champ health `migrations_count`, Gate 5). Sans DB → 503. |
| `ADMIN_PASSWORD` | secret (string) | Obligatoire | `wrangler secret put ADMIN_PASSWORD` | types.ts:6 | Auth admin. Jamais en clair dans le repo. |
| `WEBHOOK_SECRET` | secret (string) | Obligatoire | `wrangler secret put WEBHOOK_SECRET` | types.ts:9 | Vérification de signature des webhooks entrants. |
| `NOTIFICATION_EMAIL` | secret (string) | Obligatoire | `wrangler secret put NOTIFICATION_EMAIL` | types.ts:10 | Adresse destinataire des notifications système. |
| `ALLOWED_ORIGINS` | var (string) | Obligatoire | `var` dans `wrangler.jsonc` `"vars"` (déjà déclaré `wrangler.jsonc:38` = `https://crm.intralys.com,https://intralys-dashboard.pages.dev`) | types.ts:11 | CORS. Aligner avec le domaine de prod réel (cf décision SEO canonical, `LAUNCH-CHECKLIST.md`). |
| `FILES` | R2 | Obligatoire | binding `wrangler.jsonc` (`r2_buckets`, déjà déclaré `wrangler.jsonc:17-22`, bucket `intralys-files`) | types.ts:19 | Stockage fichiers/pièces jointes. |
| `WEBCHAT_ROOMS` | Durable Object | Obligatoire | binding `wrangler.jsonc` (`durable_objects` + `migrations` `new_classes:["WebchatRoom"]`, déjà déclaré `wrangler.jsonc:23-35`) | types.ts:20 | Salles webchat temps réel (DO). |
| `BROADCAST_QUEUE` | Queue | Obligatoire | binding `wrangler.jsonc` (`queues.producers`/`consumers`, déjà déclaré `wrangler.jsonc:41-44`, queue `intralys-broadcast`) | types.ts:24 | File de diffusion (cron `*/5 * * * *`, `wrangler.jsonc:45-47`). |

---

## 3. Inventaire — CONDITIONNELS (fonctionnalité dégradée / no-op si absent)

| Binding | Type | Obligatoire/Conditionnel/Interdit-prod | Commande config | Source (types.ts:ligne) | Note |
|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | secret (string) | Conditionnel | `wrangler secret put ANTHROPIC_API_KEY` | types.ts:15 | IA. Si absent → exige `USE_MOCKS="true"` (`types.ts:16`), actuellement `"true"` (`wrangler.jsonc:39`). **Décision Rochdi** : passer en IA réelle = configurer cette clé ET basculer `USE_MOCKS`. |
| `USE_MOCKS` | var (string) | Conditionnel | `var` dans `wrangler.jsonc` `"vars"` (déjà = `"true"`, `wrangler.jsonc:39`) | types.ts:16 | **Décision Rochdi** : `"true"` = réponses IA simulées (état actuel). Passer `"false"` impose `ANTHROPIC_API_KEY` configurée. À trancher avant beta. |
| `RESEND_API_KEY` | secret (string) | Conditionnel | `wrangler secret put RESEND_API_KEY` | types.ts:7 | Envoi d'emails (Resend). Absent → envoi email indisponible. |
| `OPENAI_API_KEY` | secret (string) | Conditionnel | `wrangler secret put OPENAI_API_KEY` | types.ts:8 | **Écart vs §6** : présent dans `Env` actif (`:8`) mais NON listé au classement §6.3 ; doublon commenté V2 backlog (`types.ts:53`). Legacy/optionnel — laisser non configuré sauf besoin explicite. Aucun impact go-live. |
| `TWILIO_ACCOUNT_SID` | secret (string) | Conditionnel | `wrangler secret put TWILIO_ACCOUNT_SID` | types.ts:12 | SMS/téléphonie. Absent → fonctions SMS no-op. |
| `TWILIO_AUTH_TOKEN` | secret (string) | Conditionnel | `wrangler secret put TWILIO_AUTH_TOKEN` | types.ts:13 | Idem `TWILIO_ACCOUNT_SID` (les 3 Twilio vont ensemble). |
| `TWILIO_PHONE_NUMBER` | secret (string) | Conditionnel | `wrangler secret put TWILIO_PHONE_NUMBER` | types.ts:14 | Numéro émetteur SMS. |
| `META_APP_ID` | secret (string) | Conditionnel | `wrangler secret put META_APP_ID` | types.ts:17 | Intégration Meta (Lead Ads). Absent → connecteur Meta inerte. |
| `META_APP_SECRET` | secret (string) | Conditionnel | `wrangler secret put META_APP_SECRET` | types.ts:18 | Idem `META_APP_ID`. |
| `NOTIFICATION_ROOMS` | Durable Object | Conditionnel | binding `wrangler.jsonc` (`durable_objects`, NON déclaré actuellement) | types.ts:23 | Push WebSocket notifications par user (Sprint 46 M3.4). Non bindé → broadcast skip silencieux (commentaire `types.ts:21-22`). |
| `BROADCAST_QUEUE` (rappel) | Queue | Obligatoire (cf §2) | — | types.ts:24 | Listé Obligatoire §2 ; rappelé ici car la file webhook conditionnelle `WEBHOOK_QUEUE` est distincte. |
| `WEBHOOK_QUEUE` | Queue | Conditionnel | binding `wrangler.jsonc` (`queues`, NON déclaré actuellement) | types.ts:25 | File webhooks optionnelle. Non bindée → traitement webhook synchrone/dégradé. |
| `RATE_LIMITER` | KV | Conditionnel | binding `wrangler.jsonc` (`kv_namespaces`, NON déclaré actuellement) | types.ts:26 | Rate limiting. Non bindé → limitation de débit dégradée. Recommandé en prod. |
| `GHL_CLIENT_ID` | secret (string) | Conditionnel | `wrangler secret put GHL_CLIENT_ID` | types.ts:27 | OAuth GoHighLevel. Absent → connecteur GHL inerte. |
| `GHL_CLIENT_SECRET` | secret (string) | Conditionnel | `wrangler secret put GHL_CLIENT_SECRET` | types.ts:28 | Idem `GHL_CLIENT_ID`. |
| `GHL_REDIRECT_URI` | secret (string) | Conditionnel | `wrangler secret put GHL_REDIRECT_URI` | types.ts:29 | URL de redirection OAuth GHL. Aligner avec le domaine de prod. |
| `TOKEN_KEY` | secret (string) | Conditionnel (**fortement recommandé prod**) | `wrangler secret put TOKEN_KEY` | types.ts:30 | **S7 secret-store** : chaîne 32 car. AES-GCM des tokens d'intégration. **Si absent → fallback identité = tokens d'intégration STOCKÉS EN CLAIR** (parité dev uniquement, `SECRET-STORE-S7.md:16-17,92`). À configurer AVANT d'activer Shopify/Woo en prod (cf `docs/SECRET-STORE-S7.md` Activation). |
| `STATE_STORE` | KV | Conditionnel | binding `wrangler.jsonc` (`kv_namespaces`, NON déclaré actuellement) | types.ts:31 | KV nonces CSRF OAuth (TTL 10 min). Requis pour les flux OAuth (Shopify/Woo/GHL) sécurisés (`SECRET-STORE-S7.md:93`). Sans lui → no-op KV-absent (push connecteur no-op). |
| `SHOPIFY_CLIENT_ID` | secret (string) | Conditionnel | `wrangler secret put SHOPIFY_CLIENT_ID` | types.ts:46 | Omnicanal E8 Shopify. Non configuré → canal inerte (no-op). Token chiffré via S7 (`TOKEN_KEY`). |
| `SHOPIFY_CLIENT_SECRET` | secret (string) | Conditionnel | `wrangler secret put SHOPIFY_CLIENT_SECRET` | types.ts:47 | Idem `SHOPIFY_CLIENT_ID`. |
| `SHOPIFY_WEBHOOK_SECRET` | secret (string) | Conditionnel | `wrangler secret put SHOPIFY_WEBHOOK_SECRET` | types.ts:48 | Signature webhook Shopify. |
| `WOO_CLIENT_ID` | secret (string) | Conditionnel | `wrangler secret put WOO_CLIENT_ID` | types.ts:49 | Omnicanal E8 WooCommerce. Non configuré → canal inerte (no-op). |
| `WOO_CLIENT_SECRET` | secret (string) | Conditionnel | `wrangler secret put WOO_CLIENT_SECRET` | types.ts:50 | Idem `WOO_CLIENT_ID`. |
| `WOO_WEBHOOK_SECRET` | secret (string) | Conditionnel | `wrangler secret put WOO_WEBHOOK_SECRET` | types.ts:51 | Signature webhook Woo. |

> Note `SHOPIFY_*` / `WOO_*` : conditionnels omnicanal. Leur configuration
> n'a de sens qu'avec `TOKEN_KEY` (`:30`) + `STATE_STORE` (`:31`) actifs (S7).

---

## 4. Inventaire — RÉGULÉ NON CONFIGURÉ (E4/E6 — `payments_live_enabled=0`)

> Ces bindings restent **non configurés** tant que la revue PCI (SAQ-A) + légale
> E4/E6 n'est pas signée et que `payments_live_enabled` n'est pas levé de 0 à 1.
> Conditions de levée : cf `docs/PCI-RGPD-GOLIVE-checklist.md` § « Conditions de
> levée `payments_live_enabled` ».

| Binding | Type | Obligatoire/Conditionnel/Interdit-prod | Commande config | Source (types.ts:ligne) | Note |
|---|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | secret (string) | Régulé NON configuré (E4/E6) | `wrangler secret put STRIPE_SECRET_KEY` — **NE PAS configurer** tant que `payments_live_enabled=0` | types.ts:38 | Clé secrète Stripe marchand (E4, M2). Zone régulée. Non bindé → init/webhook paiement inoffensif (provider non branché → refus/no-op, `types.ts:34-37`). |
| `STRIPE_WEBHOOK_SECRET` | secret (string) | Régulé NON configuré (E4/E6) | `wrangler secret put STRIPE_WEBHOOK_SECRET` — **NE PAS configurer** tant que `payments_live_enabled=0` | types.ts:39 | Secret signature webhook Stripe (E4, M2). Idem ci-dessus. |

---

## 5. Inventaire — INTERDIT-PROD

| Binding | Type | Obligatoire/Conditionnel/Interdit-prod | Commande config | Source (types.ts:ligne) | Note |
|---|---|---|---|---|---|
| `DEV_BYPASS_AUTH` | secret (string) | **Interdit-prod** | **NE JAMAIS configurer en prod.** Dev local uniquement via `.dev.vars` | types.ts:32 | `'true'` = bypass login + rate limit + password. **JAMAIS en prod** (commentaire explicite `types.ts:32`). Vérifier qu'aucun `wrangler secret`/`var` `DEV_BYPASS_AUTH` n'existe sur l'environnement de prod avant go-live. |

---

## 6. Rappel des 5 gates Rochdi (source : `docs/GOLIVE-S10.md` §6.2)

Référencés par numéro + intitulé court figé. À franchir **dans l'ordre**, sur la
machine hôte (jamais sur la VM). Un gate échoué = STOP.

1. **Gate 1 — Build & tests** (`bun run build` 0 err TS ; `bun run test`).
2. **Gate 2 — Backup D1 prod** (`bun run db:backup:prod`, AVANT migration).
3. **Gate 3 — Dry-run migrations** (`migrate.ts --remote --dry-run` ; ordre
   seq 1-77 ; garde E9 non déclenchée).
4. **Gate 4 — Migration prod + vérif anti-régression** (`db:migrate:prod` ;
   colonnes leads post-sprint51-m2 présentes — conflit C1 ; index seq 77 ;
   `_migrations` cohérent).
5. **Gate 5 — Non-régression analytics multi-tenant** (suites
   `ecommerce-multitenant.*` ; `GET /api/health` → `200` avec champ
   `migrations_count` ajouté par Manager B — cf `GOLIVE-S10.md` §6.4 ;
   isolation `client_id`).

> Préalable transverse aux 5 gates : le bloc 🔴 R ci-dessus — non levé par les gates.

---

## Sprint 32 — GBP scope addition

`GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (déjà posés Sprint G4 seq95) sont RÉUTILISÉS pour GBP avec scope additionnel :
- `https://www.googleapis.com/auth/business.manage`

**Prérequis Google Cloud Console** :
1. Activer "My Business Account Management API" + "My Business Business Information API" + "Business Profile Performance API"
2. Demander la verification d'app pour le scope `business.manage` (review Google obligatoire, peut prendre 4-6 semaines)
3. Domaine vérifié (`app.intralys.io`) requis pour pouvoir publier

En attendant la verification :
- Mode dev/test : Google permet 100 users test sans verification (à ajouter manuellement dans Google Cloud Console → OAuth consent screen → Test users)
- Mode prod : Brand Verification requise avant rollout client beta

---

## Sprint 33 — Calendar Sync bindings

- `MS_OAUTH_CLIENT_ID` (NEW) : Azure App registration client ID
- `MS_OAUTH_CLIENT_SECRET` (NEW) : Azure App registration secret
- `MS_OAUTH_TENANT` (NEW, défaut 'common') : Azure tenant ID ou 'common' multi-tenant
- `GCAL_SYNC_OAUTH_CLIENT_ID` (NEW optionnel) : si app Google dédiée pour calendar sync (sinon fallback GOOGLE_OAUTH_CLIENT_ID)
- `GCAL_SYNC_OAUTH_CLIENT_SECRET` (NEW optionnel) : idem

Setup :
- Outlook : voir `docs/OUTLOOK-OAUTH-SETUP-S33.md`
- GCal write : ajouter scope `https://www.googleapis.com/auth/calendar` à l'app existante OU créer nouvelle app

---

## 7. Renvois

- `docs/GOLIVE-S10.md` — source de vérité des 5 gates (§1, §6.2) + synthèse
  finale plateforme + ordre d'activation Rochdi.
- `docs/PCI-RGPD-GOLIVE-checklist.md` — conditions de levée
  `payments_live_enabled` (`STRIPE_*` régulés § 4 ci-dessus) + revue PCI/légale
  E4/E6.
- `docs/SECRET-STORE-S7.md` — Activation : `wrangler secret put TOKEN_KEY`
  (sinon tokens d'intégration en clair) + KV `STATE_STORE` + secrets
  `SHOPIFY_*` / `WOO_*`.
- `docs/ONBOARDING-S8.md` — Activation : migration seq 76 `onboarding_state`
  (aucun nouveau binding requis).
- `docs/PERF-S9.md` — Activation : migration seq 77 (8 index + `web_vitals`),
  endpoint `POST /api/telemetry/web-vitals` (aucun nouveau binding requis).
- `docs/LOT-GBP-S32.md` — Sprint 32 GBP integration : réutilise
  `GOOGLE_OAUTH_CLIENT_ID/SECRET` Sprint G4 avec scope `business.manage` distinct
  (provider `google_business`). Verification Google Cloud Console requise avant prod.

> Statut : inventaire écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.
