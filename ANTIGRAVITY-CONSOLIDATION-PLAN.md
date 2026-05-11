# ANTIGRAVITY-CONSOLIDATION-PLAN.md — Sprint Consolidation

> Rédigé par Antigravity le 2026-05-11 en réponse à l'audit RECTIFICATION.md.
> Auto-audit brutalement honnête. Aucune nouvelle feature.

---

## A. Auto-audit honnête — 13 code smells §6

| # | Smell | Confirmé ? | Path + ligne exacte | Identifié au commit ? | Sévérité |
|---|-------|------------|---------------------|----------------------|----------|
| 1 | Mélange Anthropic + OpenAI dans même file | **OUI** | `ai.ts` L6 (`env.ANTHROPIC_API_KEY \|\| env.OPENAI_API_KEY`), L19 (`env.OPENAI_API_KEY`), L36-38 (appel `api.openai.com/v1/chat/completions` avec `gpt-4o-mini`) | **Non.** J'ai laissé un fallback OpenAI dans `callClaude` et gardé `handleAiChat` entièrement sur OpenAI sans m'en rendre compte. Incohérence claire. | **HIGH** — deux factures, confusion architecturale, dépendance fantôme |
| 2 | Boucle séquentielle 500 emails | **OUI** | `broadcast.ts` L32 (`for (const lead of leads)`) — boucle `for` séquentielle dans un fetch handler. Worker free tier = 30s timeout. | **Non.** J'ai copié le pattern de `messages.ts` (1 email) sans adapter au cas broadcast. | **HIGH** — garanti crash >100 emails |
| 3 | GBP en API key simple (vrai = OAuth2) | **OUI** | `gbp.ts` L12 (`key=${env.GBP_API_KEY}`) — GBP API V4 utilise OAuth2 user-scoped, pas une API key. Ce code retournera toujours 403/401 en prod. | **Non.** J'ai pris un raccourci en supposant API key suffisante. | **HIGH** — code mort |
| 4 | GCal 76 lignes = stub | **OUI** | `gcal.ts` L1-77 — Token refresh basique (L5-25), mais manque : page callback UI, token encryption, 2-way sync, conflict resolution, expiration management robuste. | **Partiellement.** Le code est fonctionnel mais incomplet. Je savais que c'était minimal. | **MED** — fonctionne en théorie mais pas production-ready |
| 5 | Migration prod GHL livrée mais non demandée | **OUI** | `migrate.ts` 553 lignes — imports GHL API, PIT token, `/conversations/search`, etc. **Mais** : le module n'est PAS importé dans `worker.ts`, aucune route `/api/migrate/*` n'est exposée. Le fichier existe comme code mort. | **Partiellement.** J'ai écrit le module mais ne l'ai pas branché au router, donc il n'est pas accessible. Mais il n'aurait pas dû être écrit maintenant. | **LOW** — code mort (pas importé), mais confusion documentaire |
| 6 | Pas de feature flags | **OUI** | Aucun mécanisme `USE_MOCKS`, `FEATURE_GBP`, etc. nulle part. Tout est tout-ou-rien. | **Non.** Jamais pensé à ça. | **HIGH** — dev impossible sans toutes les clés |
| 7 | Pas de mode dev sans API externes | **OUI** | `types.ts` L4-22 — 15+ env vars. Sans elles : `messages.ts` crash sur Resend, `ai.ts` crash sur Anthropic/OpenAI, `gbp.ts` crash, `gcal.ts` crash. | **Non.** J'ai toujours supposé que les clés seraient dispo. Erreur fondamentale. | **HIGH** — bloquant pour Rochdi |
| 8 | Pas de tests | **OUI** | 0 fichiers `*.test.ts` ou `*.spec.ts`. `vitest` non installé. `package.json` n'a pas de script `test`. | **Oui**, identifié mais reporté. Mauvaise décision. | **HIGH** — build vert ≠ code qui marche |
| 9 | `text_content` non lu dans broadcast | **OUI** | `broadcast.ts` L12 — `body.body_text` est lu mais jamais utilisé dans le `for` loop. L45 utilise `textContent` dans `resend.emails.send({text:...})` — **en fait c'est partiellement câblé** mais `textContent` = `body.body_text || tpl.body_text` (L12,15). Le naming est confus (`body_text` vs `text_content` dans les commentaires §6) mais le code lit bien les deux. | **Partiellement confirmé.** Le code lit `body_text`, pas `text_content`. Si le frontend envoie `text_content`, ça sera ignoré. | **MED** — naming inconsistant |
| 10 | `client_id` non filtré si `filters.tags` | **OUI** | `broadcast.ts` L19-22 — la clause `AND client_id = ?` est ajoutée seulement si `body.client_id` est fourni. Si `filters.tags` est présent SANS `client_id`, la requête pourrait toucher les leads de TOUS les clients. | **Non.** Vrai risque cross-tenant. | **HIGH** — sécurité |
| 11 | Score castré en string | **OUI** | `ai.ts` L72 — `.bind(String(parsed.score), leadId)` — la colonne `score` est INTEGER dans le schema. D1 peut le convertir implicitement mais c'est incorrect. | **Non.** Erreur de typage silencieuse. | **MED** — fonctionne grâce à SQLite implicit cast mais incorrect |
| 12 | `audit_log` insert hors helper | **OUI** | `broadcast.ts` L28 — INSERT direct dans `audit_log` au lieu d'utiliser `audit()` helper de `helpers.ts`. Le format du JSON `details` peut diverger. | **Non.** Copier-coller rapide. | **LOW** — fonctionne mais pas DRY |
| 13 | `recipient_count` avant filtrage unsub | **OUI** | `broadcast.ts` L28 — `recipient_count: leads.length` est logué AVANT la boucle qui filtre `isUnsubscribed`. Le count final est dans le `audit` L50 (`total: leads.length`) qui est aussi incorrect (devrait être `sent + failed + skipped`). | **Non.** Bug de comptage. | **MED** — stats broadcast inexactes |

**Score : 13/13 smells confirmés.** J'en avais identifié 0 au moment du commit (sauf #8 reporté et #4/#5 partiellement conscients).

---

## B. Verdict module par module — KEEP / DURCIR / REWRITE / DISABLE

| Module | LOC | Audit §2 | Mon verdict | Écart ? |
|--------|-----|----------|-------------|---------|
| `worker.ts` (router) | 400 | 🟢 KEEP | **KEEP** | — |
| `auth.ts` | 150 | 🟢 KEEP | **KEEP** | — |
| `crypto.ts` | 135 | 🟢 KEEP | **KEEP** | — |
| `helpers.ts` | 197 | 🟢 KEEP | **KEEP** | — |
| `compliance.ts` | 210 | 🟢 KEEP | **KEEP** | — |
| `webchat.ts` | 375 | 🟢 KEEP | **KEEP** | — |
| `documents.ts` | 437 | 🟢 KEEP | **KEEP** | — |
| `custom-fields.ts` | 246 | 🟢 KEEP | **KEEP** | — |
| `scoring.ts` | 292 | 🟢 KEEP | **KEEP** | — |
| `leads.ts` | 627 | 🟢 KEEP | **KEEP** | — |
| `conversations.ts` | 301 | — (Sprint 3) | **KEEP** | Nouveau, solide |
| `workflows.ts` | 451 | 🟡 DURCIR | **DURCIR** | — |
| `messages.ts` | 290 | 🟡 DURCIR | **DURCIR** — ajouter mocks | — |
| `pipelines.ts` | 159 | 🟡 DURCIR | **KEEP** — fonctionnel, UI basique OK pour V1 | Pas d'urgence |
| `reports.ts` | 157 | 🟡 DURCIR | **KEEP** — queries réelles, pas juste stubs | — |
| `forms.ts` | 93 | 🟡 DURCIR | **KEEP** — backend OK, UI builder = Sprint futur | — |
| `bookings.ts` | 118 | 🟡 DURCIR | **KEEP** | — |
| `notifications.ts` | 43 | 🟡 DURCIR | **KEEP** — court mais fonctionnel (CRUD + mark read) | — |
| `tasks.ts` | 82 | 🟡 DURCIR | **KEEP** — CRUD suffisant pour V1 | — |
| `templates.ts` | 102 | 🟡 DURCIR | **KEEP** | — |
| `dashboard.ts` | 177 | 🟡 DURCIR | **KEEP** | — |
| `sub-accounts.ts` | 121 | 🟡 DURCIR | **KEEP** | — |
| `appointments.ts` | 137 | 🟡 DURCIR | **KEEP** | — |
| `reviews.ts` | 264 | 🟡 DURCIR | **KEEP** — reviews internes OK, juste GBP à disable | — |
| `lead-notes.ts` | 114 | 🟡 DURCIR | **KEEP** | — |
| **`ai.ts`** | 107 | 🟠 REWRITE | **REWRITE** — aligner Claude only, retirer OpenAI | D'accord |
| **`broadcast.ts`** | 61 | 🟠 REWRITE | **REWRITE** — Queue async + batching | D'accord |
| **`gbp.ts`** | 26 | 🟠 DISABLE | **DISABLE** — code mort, mauvaise auth pattern | D'accord |
| **`gcal.ts`** | 77 | 🟠 DISABLE | **DISABLE** — stub OAuth incomplet | D'accord |
| **`migrate.ts`** | 553 | 🔴 DISABLE | **DISABLE** — hors scope. Note : **pas importé dans worker.ts** (code mort), donc déplacement = ménage. | D'accord, impact minimal |

**Résumé : 4 modules à DISABLE, 2 à REWRITE, reste KEEP.**

---

## C. Plan détaillé Sprint Consolidation — 8 phases

### Phase C.0 — README-DEV (0.5j)

Créer `README-DEV.md` à la racine :

- **Prérequis** : Bun, Wrangler CLI
- **Installation** :
  ```bash
  bun install
  bun run db:init     # Crée la DB locale, applique schema + seed + toutes migrations
  bun run dev          # Vite frontend (localhost:5173)
  bun run dev:worker   # Wrangler local (localhost:8787)
  ```
- **Script `db:init`** dans `package.json` : applique `schema.sql` + `seed.sql` + 15 migrations phase 1-13 + sprint2-0, sprint2-1, sprint3 dans l'ordre
- **Compte admin test** : `admin@intralys.com` / `Intralys2026!` (documenté, seedé)
- **Mode mock** : `USE_MOCKS=true` par défaut en dev — aucune clé externe nécessaire
- **Liste features mock vs réelles** : tableau complet
- **20 routes API testables** avec exemples curl Bearer token
- **Structure projet** : worker modules, pages, migrations

---

### Phase C.1 — Désactiver hors scope (0.5j)

1. Créer `src/worker/_v2-backlog/`
2. Déplacer `migrate.ts` → `_v2-backlog/migrate.ts`
3. Créer `_v2-backlog/README.md` : explication "Migration GHL réel — V2 dans 3-6 mois"
4. Vérifier aucune route `/api/migrate/*` dans `worker.ts` (**déjà confirmé : aucune**)
5. `bun run build` → vert
6. Commit : `chore(scope): déplacer migrate.ts hors scope construction`

---

### Phase C.2 — Mode dev avec mocks (2j)

Créer `src/worker/mocks/` avec :

| Fichier | Rôle |
|---------|------|
| `mock-resend.ts` | `mockSendEmail()` — log console + INSERT messages `status='mock-sent'` |
| `mock-twilio.ts` | `mockSendSms()` — idem SMS |
| `mock-anthropic.ts` | `mockClaude()` — réponses prédéfinies : score → `{score: 65, reason: "Lead qualifié..."}`, email → corps FR québécois, workflow → template fixé |
| `mock-gcal.ts` | Fixtures 8-10 events statiques |
| `mock-gbp.ts` | Fixtures 5 reviews fictives |

**Wiring :**
- Ajouter `USE_MOCKS: string` dans `Env` (`types.ts`)
- Chaque module externe : `const sender = env.USE_MOCKS === 'true' ? mockFn : realFn;`
- Default `wrangler.jsonc` : `vars: { USE_MOCKS: "true" }`
- Prod : `npx wrangler secret put USE_MOCKS` → `false`

**Modules à câbler :**
- `messages.ts` : email via mock-resend, SMS via mock-twilio
- `ai.ts` : Claude via mock-anthropic
- `broadcast.ts` : email via mock-resend
- `workflows.ts` : steps email/sms via mocks

Commit : `feat(mocks): mode dev avec mocks pour toutes les APIs externes`

---

### Phase C.3 — Fix contradictions (1.5j)

**3.3a — ai.ts aligner Claude only :**
- Réécrire `handleAiChat` avec `callClaude()` au lieu d'appeler OpenAI directement
- Retirer le fallback `env.OPENAI_API_KEY` de `callClaude()` L6
- Fix L72 : `bind(parsed.score, leadId)` (pas `String(...)`)
- Retirer `OPENAI_API_KEY` de `types.ts`
- Vérifier 0 mention OpenAI/gpt-4o dans tout `src/worker/`
- Commit : `fix(ai): align on Claude only, remove OpenAI deps`

**3.3b — broadcast.ts refactor Queue :**
- Ajouter bindings Queue dans `wrangler.jsonc` (`[[queues.producers]]`, `[[queues.consumers]]`)
- POST `/api/broadcast/email` → enqueue job config (subject, body, filters, client_id, broadcast_id)
- Consumer `processBroadcastQueue()` : batch 50 emails, log progress dans table `broadcasts`
- Migration `migration-phase14.sql` : table `broadcasts (id, status, sent, failed, total, started_at, completed_at)`
- Fix smell #10 : `client_id` obligatoire
- Fix smell #13 : `recipient_count` après filtrage unsubscribe
- Fix smell #12 : utiliser `audit()` helper
- Commit : `refactor(broadcast): Cloudflare Queue async + batching + progress tracking`

---

### Phase C.4 — Couper stubs non viables (1.5j)

| Module | Action |
|--------|--------|
| `gbp.ts` | **DISABLE** — déplacer en `_v2-backlog/gbp.ts`, retirer import + routes L50,334-335 de `worker.ts`, retirer `GBP_API_KEY` de `types.ts`, sur `Reviews.tsx` marquer GBP section "Coming soon" |
| `gcal.ts` | **DISABLE** — déplacer en `_v2-backlog/gcal.ts` (note: **déjà pas importé dans worker.ts**, aucune route exposée). Retirer `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` de `types.ts`. Sur `Calendar.tsx` si CTA "Connect Google" existe → "Coming soon". |
| `ai.ts` | **KEEP-PARTIAL** — déjà fixé en C.3 |
| `broadcast.ts` | **REWRITE** — déjà fait en C.3 |

Commits :
- `chore(scope): disable Google Business Profile stub (V2 backlog)`
- `chore(scope): disable Google Calendar OAuth stub (V2 backlog)`

---

### Phase C.5 — Smoke tests (2j)

**Setup (0.5j) :**
- `bun add -D vitest @cloudflare/vitest-pool-workers`
- Créer `vitest.config.ts` avec pool Workers
- Ajouter `"test": "vitest run"` dans `package.json`

**Tests (1.5j) — 30-50 minimum :**

| Fichier test | Tests |
|-------------|-------|
| `auth.test.ts` | Login admin → token, bad password → 401, session expirée → 401, change password |
| `leads.test.ts` | POST webhook crée lead, GET liste pagination, PATCH update, DELETE, bulk action |
| `workflows.test.ts` | Create + enroll lead + step exécuté (mock email) |
| `compliance.test.ts` | Unsubscribe token sign/verify, footer CASL, AMF disclaimer |
| `webchat.test.ts` | POST /widget/init crée session, message persisté |
| `documents.test.ts` | Upload R2 mock, signature recorded |
| `ai.test.ts` | Scoring retourne 0-100 (mock), generate retourne template |
| `compliance-honeypot.test.ts` | Webhook lead honeypot rempli → silently dropped |
| `crypto.test.ts` | Hash + verify password |
| `helpers.test.ts` | sanitizeInput SQL injection, XSS |

Commit : `test: smoke tests Vitest sur les modules critiques`

---

### Phase C.6 — Seed data réaliste (1j)

Refondre `seed.sql` :

| Entité | Quantité | Détails |
|--------|----------|---------|
| Clients | 3 | Mathis Gatineau (cyan), Serujan Montréal (orange), Gatineau Premier (purple) — données fictives |
| Leads | 30 | 10/client, variés en statut/source/score/budget/type propriété |
| Conversations | 15 | Mix email/sms/internal_note avec messages historiques |
| Workflows | 8 | Relance J+1/J+3/J+7, RDV reminder, lead chaud, etc. |
| Custom fields | 5 | Budget, Délai, Type propriété, Adresse, Référé par |
| Smart lists | 3 | "Leads chauds", "Sans réponse 7j", "RDV cette semaine" |
| Templates | 15 | 10 email + 5 SMS |
| Tasks | 12 | Overdue, today, this week, done |
| Appointments | 8 | Passés confirmés, à venir, no-show |
| Documents | 5 | Avec audit trail mock |
| Score profiles | 3 | Seedés |
| Admin user | 1 | `admin@intralys.com` / `Intralys2026!` |

Commit : `feat(seed): dataset démo réaliste 30 leads / 8 workflows / 15 conversations`

---

### Phase C.7 — Frontend audit + fix câblages (1j)

20 pages, 15-30 min chacune :

1. Lancer `bun run dev`
2. Tester chaque bouton, formulaire, filtre, action
3. Documenter dans `FRONTEND-WIRING-AUDIT.md` : tableau page → actions OK / KO
4. Fix bugs **CRITIQUES** inline (crash, formulaire qui submit pas)
5. Bugs UX mineurs → note dans `DESIGN-DEFER.md`

**Pages :** Dashboard, Leads, LeadDetail, Pipeline, Inbox, Calendar, Templates, Workflows, WorkflowDetail, WorkflowBuilder, Tasks, Settings, Reports, Documents, Reviews, Integrations, Login, ChangePassword, Clients, ClientLeads

Commit : `fix(frontend): wire câblages manquants + audit complet 20 pages`

---

## D. Risques techniques

| # | Risque | Mitigation |
|---|--------|-----------|
| R1 | Refactor broadcast.ts en Queue = nouveau pattern. `wrangler dev --queue-consumer` peut être instable en local. | Tester avec `wrangler dev` local d'abord. Si Queue non supportée en dev local, fallback sur boucle batch avec `waitUntil()` et limit 50. |
| R2 | Disabling gbp/gcal peut casser des composants UI. | Vérifié : **aucune page frontend** ne référence `gbp` ou `gcal` directement. `Reviews.tsx` et `Calendar.tsx` n'appellent pas ces APIs. Risque minime. |
| R3 | Mocks doivent retourner format identique aux vraies APIs. Resend → `{data: {id}}`, Twilio → `{sid}`, Anthropic → `{content: [{type, text}]}`. | Écrire les mocks avec le même type de retour. Tester swap local `USE_MOCKS=false` avec vraie clé Resend si disponible. |
| R4 | Setup Vitest + `@cloudflare/vitest-pool-workers` = 0.5j de config avant le premier test. | Compté dans l'estimation C.5. Si bloqué, fallback sur `vitest` standard sans pool Workers (tests unitaires purs sans D1 bindings). |
| R5 | Seed data élargie (30 leads, 15 conversations, 8 workflows) → grossit D1 local. | Utiliser `INSERT OR IGNORE` pour protéger les re-runs. Script `db:init` drop + recreate la DB locale. |

---

## E. Estimation finale

| Phase | Effort | Cumul |
|-------|--------|-------|
| C.0 README-DEV | 0.5j | 0.5j |
| C.1 Désactiver hors scope | 0.5j | 1j |
| C.2 Mocks + mode dev | 2j | 3j |
| C.3 Fix contradictions | 1.5j | 4.5j |
| C.4 Couper stubs | 1.5j | 6j |
| C.5 Smoke tests | 2j | 8j |
| C.6 Seed data réaliste | 1j | 9j |
| C.7 Frontend audit | 1j | 10j |
| **Total Sprint Consolidation** | **~10j** | — |

---

## F. Notes supplémentaires

1. **migrate.ts (553 lignes)** n'est PAS branché dans le router — aucune route `/api/migrate/*` n'est exposée. Le déplacement en `_v2-backlog/` est du ménage, pas un fix sécurité.
2. **gcal.ts** n'est PAS non plus importé dans `worker.ts` — même situation que migrate. Code mort.
3. **Sprint 3 Conversations** (4 commits ce matin) : à garder. Le modèle conversations first-class est solide et n'entre pas en conflit avec la consolidation.
4. **worker.ts.backup** (5000+ lignes) : fichier résiduel du monolithe pré-refactor. À supprimer en C.1.
5. **12 docs ANTIGRAVITY-*.md** à la racine : nettoyer/archiver les obsolètes en C.1.
