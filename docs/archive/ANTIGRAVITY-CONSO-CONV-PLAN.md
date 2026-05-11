# ANTIGRAVITY-CONSO-CONV-PLAN

## A. Auto-audit honnête des smells §6 RECTIFICATION

| # | Smell | Fichier | Confirmé ? (Ligne) | Sévérité |
|---|---|---|---|---|
| **1** | Mélange Anthropic + OpenAI dans même file | `src/worker/ai.ts` | Oui (Précédemment L6, L19) | 🔴 Critique (Dépendances doubles + factures) |
| **2** | Boucle séquentielle 500 emails | `src/worker/broadcast.ts` | Oui (Précédemment L32-48) | 🔴 Critique (Timeout worker + perte d'emails) |
| **3** | Google Business Profile en API key (vrai = OAuth) | `src/worker/gbp.ts` | Oui (Précédemment l.1-25) | 🟠 Élevée (Stub mort) |
| **4** | Google Calendar 76 lignes (vraie sync = 500+ lignes) | `src/worker/gcal.ts` | Oui (Précédemment l.1-76) | 🟠 Élevée (Stub incomplet) |
| **5** | Migration prod GHL livrée mais pas demandée maintenant | `src/worker/migrate.ts` | Oui | 🟠 Élevée (Hors scope) |
| **11**| Score lead castré en string : `bind(String(parsed.score))` | `src/worker/ai.ts` | Oui (Précédemment L72) | 🟡 Moyenne (Type mismatch SQLite) |

*(Note: Ces smells ont été confirmés. Certains ont déjà été fixés dans les commits récents, d'autres comme le #2 nécessitent une implémentation complète via Cloudflare Queues).*

---

## B. Plan détaillé Phase A — Consolidation minimale (3.5j)

**A.1 — Disable migrate.ts (0.5j)**
- Créer `src/worker/_v2-backlog/` (dossier)
- Déplacer `src/worker/migrate.ts` → `src/worker/_v2-backlog/migrate.ts`
- Retirer toutes les routes `/api/migrate/*` du router `src/worker.ts`
- Créer `src/worker/_v2-backlog/README.md`
- Vérifier `bun run build` passe
- Commit : `chore(scope): move migrate.ts to v2-backlog (out of scope)`

**A.2 — Fix ai.ts contradictions (1j)**
- Aligner sur Claude uniquement
- Retirer tout code OpenAI dans `ai.ts`
- Une seule helper `callClaude(env, systemPrompt, userMessage, maxTokens=500)` utilisant `claude-haiku-4-5-20251001`
- Réécrire `handleAiChat` avec Claude (au lieu de gpt-4o-mini)
- Retirer `OPENAI_API_KEY` de `src/worker/types.ts` Env interface
- Grep `OPENAI\|gpt-4o-mini` dans tout le projet → 0 occurrence après fix
- Fix smell #11 : `bind(parsed.score)` (number, pas String(parsed.score))
- Commit : `fix(ai): align on Claude only, remove OpenAI deps`

**A.3 — Refactor broadcast.ts en Cloudflare Queue (1.5j)**
- Migration phase14 : Création table `broadcasts`
- Binding Queue dans `wrangler.jsonc` (`intralys-broadcast`)
- Refactor `broadcast.ts` : 
  - `POST /api/broadcast/email` → valide payload, INSERT `broadcasts` row avec `status='queued'`, enqueue jobs (1 job = 50 emails)
- Handler queue dans `src/worker.ts` (export queue) qui consume : pull batch de 50 destinataires, envoie via `mockOrRealResend()`, UPDATE `broadcasts.sent/failed/status`
- Filter unsubscribe AVANT count `recipient_count` (smell #13)
- Lire `text_content` aussi (smell #9)
- Garde cross-tenant : `client_id` obligatoire si `filters.tags` présent (smell #10)
- Endpoint `GET /api/broadcasts/:id` retourne progress
- Endpoint `GET /api/broadcasts` liste paginée
- Commit : `refactor(broadcast): Cloudflare Queue async + progress tracking`

**A.4 — Disable stubs gbp.ts + gcal.ts (0.5j)**
- Déplacer `src/worker/gbp.ts` → `src/worker/_v2-backlog/gbp.ts`
- Déplacer `src/worker/gcal.ts` → `src/worker/_v2-backlog/gcal.ts`
- Retirer routes `/api/gbp/*` et `/api/google-calendar/*` du router
- Retirer `GBP_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` de Env interface
- Frontend `src/pages/Reviews.tsx` : remplacer section GBP par fixtures statiques (5 reviews fictives) + badge "Données démo" en haut
- Frontend `src/pages/Calendar.tsx` : retirer/masquer CTA "Connect Google Calendar"
- Frontend `src/pages/Integrations.tsx` : marquer Google Business Profile et Google Calendar comme "Coming soon" (CTA disabled)
- Commit : `chore(scope): disable GBP + Google Calendar stubs (v2-backlog)`

---

## C. Plan détaillé Phase B — Sprint 3 Vertical Conversations (14j)

**B.1 — P4.2 Webchat widget live (3j)**
- Migration phase15 : tables `webchat_widgets`, `webchat_sessions`
- Vérifier `webchat.ts` (Durable Objects) et endpoint `/widget/init`
- Snippet JS embeddable `public/widget/v1.js` (Vanilla JS standalone)
- Persistence : INSERT `messages` avec `channel='webchat'`
- Page test : `public/widget/test.html`
- Commit : `feat(p4.2-webchat): Durable Object WebSocket + widget JS embed`

**B.2 — P4.9 FB Messenger + IG DM (3j) — avec mock fallback**
- Migration phase16 : table `meta_connections`
- Meta Graph API OAuth flow (`/api/meta/oauth/start`, `/api/meta/oauth/callback`)
- Webhook `POST /api/webhook/meta` avec validation X-Hub-Signature-256 HMAC
- Outbound : `POST /api/messages/send` avec `channel='facebook'`
- Mock fallback : via `mockMeta.sendMessage()`
- Commit : `feat(p4.9-meta): FB Messenger + IG DM with mock fallback`

**B.3 — Enrichissement Inbox features (5j)**
- Composer "New conversation" (1j) : modal, channel selector, autocomplete, template dropdown.
- Saved replies / Snippets (0.5j) : Migration phase17, CRUD, slash command.
- Email signatures per user (0.5j) : `users.email_signature_html`, UI dans profile.
- Schedule send (0.5j) : Migration phase18 (`scheduled_messages`), Cron `*/1 * * * *`, datetime picker.
- Bulk actions threads (0.5j) : Checkbox, assign, archive, mark spam, snooze.
- Snooze conversations (0.5j) : Migration phase19 (`conversations.snoozed_until`), Cron refresh.
- Conversation tags + Followers + Mentions (1j) : Migration phase20, UI right panel.
- Attachments (0.5j) : R2 binding, upload via paperclip.
- Commit : `feat(inbox): composer, snippets, snooze, schedule and tags`

**B.4 — Mocks externes (1j)**
- Créer `src/worker/mocks/mock-meta.ts`, `mock-resend.ts`, `mock-twilio.ts`.
- Wrapper `getMessageSender(env, channel)`.
- Commit : `feat(mocks): mock-meta + mock-resend + mock-twilio for dev mode`

**B.5 — Tests E2E manual (1j)**
- Valider le workflow complet : `bun run dev`, envoyer message mocké, snippet `/welcome`, schedule send, snooze, assignation bulk, webchat live, Meta mock webhook, toggle DND.
- Commit : `docs(test): manual e2e testing successful`

---

## D. Risques techniques

- **R1 :** Refactor `broadcast.ts` en Queue = nouveau pattern Cloudflare. Le test local avec `wrangler dev` et `--queue-consumer` peut être fragile, ce qui pourrait ralentir le dev en localhost.
- **R2 :** Durable Objects pour le webchat = composant d'infrastructure complexe. Une PoC simple (echo server) doit être validée avant l'intégration frontend complète pour éviter les deadlocks WebSocket.
- **R3 :** Meta OAuth callback nécessite un domaine vérifié HTTPS pour Facebook Dev. Mocker en mode dev est réalisable mais tester le real OAuth sur prod uniquement pose un risque de régression au déploiement.
- **R4 :** 13 migrations SQL nouvelles (phase 14 à 26). Il y a un fort risque de conflit d'index et de schema lock avec les migrations existantes si D1 est mal purgé ou synchronisé. Numérotation séquentielle stricte exigée.
- **R5 :** Inbox refondu en D2.2 mais les features du Sprint 3 ajoutent 5 nouveaux éléments UI. Il y a un risque d'éclatement visuel. Maintenir les tokens et la charte Intralys est impératif.

---

## E. Estimation finale

| Phase | Effort | Cumul |
|-------|--------|-------|
| **Phase A — Consolidation minimale** | | |
| A.1 Disable migrate.ts | 0.5j | 0.5j |
| A.2 Fix ai.ts Claude only | 1j | 1.5j |
| A.3 Refactor broadcast Queue | 1.5j | 3j |
| A.4 Disable gbp + gcal stubs | 0.5j | 3.5j |
| **Phase B — Sprint 3 Conversations** | | |
| B.1 Webchat live Durable Object | 3j | 6.5j |
| B.2 FB Messenger + IG DM | 3j | 9.5j |
| B.3 Inbox features enrichis | 5j | 14.5j |
| B.4 Mocks externes | 1j | 15.5j |
| B.5 Tests E2E manual | 1j | 16.5j |
| **TOTAL** | **~17j** | **—** |
