# AUDIT BINDINGS — Phase 0.1 (2026-05-27)

> Mission RENFORCEMENT V2 DEEP — Batch 0.1. Audit `wrangler.jsonc` vs bindings référencés dans le code worker.
> Méthode : `grep -rhoE "env\.[A-Z][A-Z0-9_]+" src/` croisé avec `wrangler.jsonc`.
> ⚠️ AUCUNE modif `wrangler.jsonc` appliquée (règle #7 : GO user requis). Ce doc = recommandations.

## ✅ Bindings infra DÉCLARÉS dans wrangler.jsonc

| Binding | Type | Déclaration | Refs code |
|---|---|---|---|
| `DB` | D1 | `intralys-crm` (id ee9da52c…) | 5079 |
| `FILES` | R2 | `intralys-files` | 81 |
| `WEBCHAT_ROOMS` | Durable Object | class `WebchatRoom` (migration v1) | 12 |
| `BROADCAST_QUEUE` | Queue (producer+consumer) | `intralys-broadcast` | 6 |
| `ALLOWED_ORIGINS` | var | CSV origins | 4 |
| `USE_MOCKS` | var | `"true"` | 30 |
| cron | trigger | `*/5 * * * *` | — |

## 🚨 Bindings infra RÉFÉRENCÉS mais NON DÉCLARÉS

**Tous gardés** (`if (env.X)` / `if (!env.X) return`) → pas de crash runtime, MAIS la fonctionnalité est **silencieusement OFF en prod** tant que le binding n'est pas déclaré. À trancher avec Rochdi.

| Binding | Type probable | Refs | Garde | Impact si non déclaré | Reco |
|---|---|---|---|---|---|
| `STATE_STORE` | **KV namespace** | 84 | ✅ `if (!env.STATE_STORE) return` | OAuth nonces / state cache non persistés (Shopify OAuth, etc.) | **Déclarer KV** — priorité HAUTE |
| `RATE_LIMITER` | **KV namespace** | 24 | ✅ `if (env.RATE_LIMITER)` | Rate-limit sliding window inopérant (anti-abus, anti-bot) | **Déclarer KV** — priorité HAUTE (sécurité) |
| `NOTIFICATION_ROOMS` | **Durable Object** | 14 | ✅ `if (!env.NOTIFICATION_ROOMS) return` | Notifications temps réel (idFromName/get) OFF | **Déclarer DO + migration** — priorité MOYENNE |
| `WEBHOOK_QUEUE` | **Queue (producer)** | 4 | ✅ `if (env.WEBHOOK_QUEUE)` | Dispatch webhooks outbound non queué (perte/retry) | **Déclarer queue producer (+consumer)** — priorité MOYENNE |
| `AI` | Workers AI | 34 | n/a | **Aucune** | **Optionnel / basse priorité** — voir note ci-dessous |

### Note `env.AI` — binding vestigial
Aucune invocation `.run()` nulle part. `env.AI` n'apparaît que dans commentaires, types (`api.ts`), et tests (`env.AI = opts.ai`). L'IA réelle passe par `ANTHROPIC_API_KEY` (36 refs) + `OPENAI_API_KEY` (16 refs) via `fetch`, PAS via le binding Workers AI. Test prouve le fallback : *"env.AI undefined → keyword score only, pas d'exception"*. → Déclaration non nécessaire au runtime actuel.

## 🔑 Secrets (attendus HORS wrangler.jsonc — `wrangler secret put` / `.dev.vars`)

Référencés et **normaux** en tant que secrets (ne PAS mettre dans `vars`) :
`RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `ANTHROPIC_API_KEY`, `TOKEN_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_TERMINAL_*`, `OPENAI_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI`, `WEBHOOK_SECRET`, `SHOPIFY_CLIENT_ID/SECRET`, `SHOPIFY_WEBHOOK_SECRET`, `WOO_WEBHOOK_SECRET`, `META_APP_ID/SECRET`, `GBP_API_KEY`, `CLOUDFLARE_API_TOKEN`, `WHATSAPP_VERIFY_TOKEN/ACCESS_TOKEN/PHONE_NUMBER_ID`, `GHL_CLIENT_ID/SECRET/REDIRECT_URI`, `TURNSTILE_SECRET`, `SLACK_CLIENT_ID/SECRET`, `MS_OAUTH_TENANT/CLIENT_ID/CLIENT_SECRET`, `COMMUNITY_SALT`, `ADMIN_PASSWORD`, `SENDGRID_API_KEY`.

> Tous en **FLAG INACTIF** (mocks réalistes quand absents) conformément aux règles. Activation = main Rochdi + revue PCI/RGPD pour Stripe.

## ⚙️ Vars de config (candidates à `vars` ou laissées en secret/env)

`DEV_BYPASS_AUTH`, `DEV`, `LOG_LEVEL`, `START_TIME`, `PUBLIC_ORIGIN`, `NOTIFICATION_EMAIL`, `WHITELABEL_PROVISIONING_ENABLED`, `WHITELABEL_DKIM_ENABLED`. Pas bloquant — comportement par défaut sain si absent.

## 🚫 Hors scope worker (frontend Vite, build-time)
`VITE_DEV_BYPASS_AUTH`, `VITE_API_URL` — injectés par Vite, PAS des bindings worker. Ignorer.

## 📋 Reco wrangler.jsonc (À APPLIQUER SEULEMENT APRÈS GO ROCHDI)

```jsonc
// kv_namespaces — créer via `wrangler kv namespace create STATE_STORE` puis copier l'id
"kv_namespaces": [
  { "binding": "STATE_STORE",  "id": "<à créer>" },
  { "binding": "RATE_LIMITER", "id": "<à créer>" }
],
// durable_objects — ajouter NOTIFICATION_ROOMS (+ entrée migrations new_classes)
"durable_objects": { "bindings": [
  { "name": "WEBCHAT_ROOMS",      "class_name": "WebchatRoom" },
  { "name": "NOTIFICATION_ROOMS", "class_name": "NotificationsRoom" }  // ✅ classe exportée: worker.ts:341 (NotificationsRoom, avec un 's')
]},
// + ajouter une entrée migrations DO :
"migrations": [
  { "tag": "v1", "new_classes": ["WebchatRoom"] },
  { "tag": "v2", "new_classes": ["NotificationsRoom"] }
],
// queues — ajouter WEBHOOK_QUEUE producer (+ consumer si traitement async voulu)
"queues": { "producers": [
  { "binding": "BROADCAST_QUEUE", "queue": "intralys-broadcast" },
  { "binding": "WEBHOOK_QUEUE",   "queue": "intralys-webhooks" }
]}
```

✅ **Pré-requis `NOTIFICATION_ROOMS` VÉRIFIÉ** : la classe `NotificationsRoom` (avec un `s`) est définie dans `src/worker/notifications-ws.ts:33` ET ré-exportée depuis `worker.ts:341`. Déclarer le binding est donc sûr — ne pas oublier l'entrée `migrations` DO (tag v2). ⚠️ Le binding D1/DO migration `new_classes` est requis sinon le deploy échoue.

## ✅ Verdict Phase 0.1
- **Pas de blocker prod immédiat** (tout gardé → pas de crash).
- **4 bindings à déclarer** pour activer en prod : `STATE_STORE`, `RATE_LIMITER` (sécurité, HAUTE), `NOTIFICATION_ROOMS`, `WEBHOOK_QUEUE` (MOYENNE).
- `AI` : ignorer (vestigial).
- **Action requise Rochdi** : GO pour créer les KV/queue + vérifier la classe DO `NotificationRoom` avant modif `wrangler.jsonc`.
