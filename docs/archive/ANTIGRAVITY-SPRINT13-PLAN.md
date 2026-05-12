# Sprint 13 — API publique + Webhooks OUT + Zapier app (~10j)

> **Objectif :** Ouvrir Intralys aux intégrations externes. API REST documentée OpenAPI 3.0,
> webhooks sortants signés HMAC, app Zapier publiée. Préparer le terrain pour le Sprint 14
> (importer GHL qui consommera la même API).
> Ref : ROADMAP.md Sprint 13, migration-phase32.sql (tables `api_keys` + `webhook_subscriptions` déjà existantes Sprint 8).

---

## Phase A — API publique foundation (~3j)

**A.1 — Middleware auth API key (1j)** 🔴
- Détection `Authorization: ApiKey <token>` ou `X-Intralys-Key`
- Hash compare avec `api_keys.key_hash` (PBKDF2 même algo que password)
- Charger scopes (`read`, `write`, `webhook`, `admin`) → injection `auth.scopes`
- Update `api_keys.last_used_at`
- Rate limit per-key : 1000 req/h (KV store `rate:<key_id>:<hour>`)
- Réponse 401 si invalide, 403 si scope manquant, 429 si rate limit
- Routes existantes (admin auth) restent prioritaires ; nouveau préfixe `/api/public/*`

**A.2 — OpenAPI 3.0 spec (1j)** 🟠
- Fichier `src/worker/openapi-spec.ts` — generate JSON spec
- Couvrir endpoints publics : `GET /public/leads`, `POST /public/leads`, `GET /public/leads/:id`, `PATCH /public/leads/:id`, `GET /public/tasks`, `POST /public/tasks`, `GET /public/appointments`, `POST /public/appointments`
- Schemas : Lead, Task, Appointment, Client (subset public-safe)
- Auth scheme : ApiKey header
- Servi via `GET /api/openapi.json`

**A.3 — Page Swagger UI (0.5j)** 🟡
- Route publique `/docs/api` (pas d'auth)
- Embed Swagger UI v5 via CDN (script + lien CSS)
- Charge `/api/openapi.json`
- Stylisé palette Intralys (cyan/orange) via classe override

**A.4 — Routes `/api/public/*` (0.5j)** 🟠
- Wrapper qui valide scope + délègue aux handlers existants
- Sous-ensemble curé (pas d'endpoints admin/team/billing)
- Tous les payloads passent par sanitize côté backend

---

## Phase B — Webhooks OUT (~3j)

**B.1 — Migration phase 30 (0.25j)** 🔴
- Fichier `migration-phase30.sql`
- Table `webhook_deliveries (id, subscription_id, event_type, payload_json, status, response_code, response_body, attempt, scheduled_at, delivered_at, created_at)`
- Index sur `subscription_id`, `status`

**B.2 — Event dispatcher (0.5j)** 🔴
- Helper `src/worker/webhooks-dispatch.ts` : `publishEvent(env, clientId, eventType, payload)`
- Charge `webhook_subscriptions` actifs filtrés par event dans `events`
- Pour chaque subscription : enqueue dans Cloudflare Queue `WEBHOOK_QUEUE`
- Si pas de queue : POST direct (fallback dev)

**B.3 — HMAC signature (0.25j)** 🔴
- Header `X-Intralys-Signature: sha256=<hmac>`
- Secret = `webhook_subscriptions.secret` (généré à la création)
- Body = payload JSON brut
- Tests : verify signature on receiver side

**B.4 — Hooks dans les modules (1j)** 🟠
- `lead.created` → après INSERT dans handleCreateLead (et handleWebhookLead public form/Meta)
- `lead.status_changed` → après UPDATE status dans handlePatchLead
- `task.created`, `task.completed` → after handleCreateTask, handlePatchTask
- `appointment.created`, `appointment.cancelled`
- `message.received` → after inbound SMS/email/webchat
- Payload : `{ event, client_id, timestamp, data: { ...resource } }`

**B.5 — Retry queue (0.5j)** 🟡
- Worker Queue consumer `processWebhookDelivery`
- 5xx → retry avec exponential backoff (1m, 5m, 30m, 2h, 12h, dead-letter)
- 4xx → dead-letter immédiat (config invalide côté client)
- Update `webhook_subscriptions.fail_count` ; désactive si > 100

**B.6 — UI Settings > Webhooks (0.5j)** 🟡
- Composant `WebhooksSettings.tsx` dans Settings
- Liste subscriptions (URL, events activés, status, last triggered, fail count)
- Bouton "+ Ajouter webhook" : URL + checkboxes events + génère secret
- Bouton "Tester" : POST event sample → affiche réponse
- Modal "Voir livraisons" : table des 50 derniers `webhook_deliveries`

---

## Phase C — Zapier app (~2j)

**C.1 — Scaffold `zapier-app/` (0.5j)** 🟠
- Repo dans dossier `zapier-app/` (ignoré dans build front)
- `npx @zapier/cli init intralys-crm --template typescript`
- `package.json` indépendant
- `.gitignore` les artefacts Zapier

**C.2 — Authentification (0.25j)** 🟠
- Custom auth type : API key
- Champ `apiKey` (input texte) + URL backend (default https://crm.intralys.com)
- Test endpoint : `GET /api/public/me` (à créer — retourne `{ client_id, scopes }`)

**C.3 — Triggers (0.5j)** 🟠
- `new_lead` : GET /api/public/leads?since=<cursor>&limit=100, dedupe sur `id`
- `lead_status_changed` : GET /api/public/leads?status=<status>&since=<cursor>
- `new_task` : GET /api/public/tasks?since=<cursor>
- `new_appointment` : GET /api/public/appointments?since=<cursor>
- Polling toutes les 5 min côté Zapier (par défaut)

**C.4 — Actions (0.5j)** 🟠
- `create_lead` : POST /api/public/leads (champs : nom, email, phone, source, message, type)
- `send_sms` : POST /api/public/leads/:id/messages (channel=sms)
- `send_email` : POST /api/public/leads/:id/messages (channel=email)
- `add_tag` : POST /api/public/leads/:id/tags

**C.5 — README + soumission sandbox (0.25j)** 🟡
- `zapier-app/README.md` : install local + npm run test + zapier push
- Screenshots à inclure dans la soumission Zapier (5 min via dashboard Zapier)
- Statut : sandbox (review formel Zapier = 1-2 sem, post-sprint)

---

## Phase D — Tests + Validation (~1j)

**D.1 — Tests middleware auth API key**
- Fichier `src/worker/__tests__/api-public-auth.test.ts`
- 401 sans header, 401 hash invalide, 403 scope insuffisant, 429 rate limit, 200 happy path
- Vérifier update `last_used_at`

**D.2 — Tests HMAC signature**
- Fichier `src/worker/__tests__/webhooks-hmac.test.ts`
- Sign / verify roundtrip, payload modifié → signature mismatch

**D.3 — Tests event dispatcher**
- Fichier `src/worker/__tests__/webhooks-dispatch.test.ts`
- Mock env.WEBHOOK_QUEUE.send, vérifier enqueue par subscription
- Vérifier filtrage par events (skip subscription qui n'a pas l'event)

**D.4 — Build vert + 145+ tests**
- `bun run build` → 0 erreurs
- `npx vitest run` → 145+ tests (vs 134 actuels)

---

## Phase E — Docs + Clôture (~1j)

**E.1 — docs/API-PUBLIC.md**
- Quickstart (créer API key dans Settings, premier appel curl)
- Authentification, scopes, rate limits
- Tableau endpoints (lien vers /docs/api Swagger pour les détails)
- Exemples curl + JavaScript fetch

**E.2 — docs/ZAPIER-INTEGRATION.md**
- Lien marketplace Zapier (post-review)
- Triggers/Actions disponibles
- Template Zaps populaires

**E.3 — Update README.md**
- Section "Intégrations" mentionnant API publique + Zapier

**E.4 — Nettoyer doublon backup codes**
- Tables `backup_codes` (migration-phase28) ET `totp_backup_codes` (migration-phase32) coexistent
- Garder `backup_codes` (utilisé par handleGenerateBackupCodes Sprint 12)
- DROP TABLE `totp_backup_codes` via migration-phase31.sql (verif aucun usage)

---

## Résumé effort

| Phase | Effort | Items |
|---|---|---|
| A — API publique foundation | 3j | Auth middleware, OpenAPI spec, Swagger UI, public routes |
| B — Webhooks OUT | 3j | Migration, dispatcher, HMAC, hooks, retry queue, UI |
| C — Zapier app | 2j | Scaffold, auth, 4 triggers, 4 actions, README |
| D — Tests | 1j | Auth, HMAC, dispatcher, build vert 145+ tests |
| E — Docs + cleanup | 1j | API + Zapier docs, README, dedup backup codes |
| **Total** | **~10j** | **5 phases, ~25 items** |

---

## Critères de succès Sprint 13

- [ ] Un utilisateur peut créer une API key dans Settings + l'utiliser avec curl pour créer un lead
- [ ] La page /docs/api affiche un Swagger UI fonctionnel
- [ ] Un webhook OUT enregistré reçoit un POST signé HMAC à la création d'un lead
- [ ] Une livraison qui échoue (500) est retentée selon backoff exponentiel
- [ ] L'app Zapier locale (`zapier validate`) passe sans erreur, triggers + actions définis
- [ ] Build vert + 145+ tests
- [ ] Doublon `backup_codes` vs `totp_backup_codes` résolu

---

_Plan créé le 2026-05-12. Sera archivé dans docs/archive/ à la fin du sprint._
