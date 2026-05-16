# Sprint 43 M3 — Backend wiring AI utilities

Date : 2026-05-15
Auteur : Manager M3 — Sprint 43

## Vue d'ensemble

Wirage des 4 utilities AI/cache frontend qui étaient sur stubs localStorage / heuristiques locales :

| Lib client                       | Backend                       | Status      | Cache       |
| -------------------------------- | ----------------------------- | ----------- | ----------- |
| `src/lib/reactions.ts`           | `worker/reactions.ts`         | OK wired    | localStorage + D1 |
| `src/lib/quickReplies.ts`        | `worker/quick-replies.ts`     | OK wired    | localStorage + D1 |
| `src/lib/aiDrafts.ts`            | `worker/ai.ts::handleAiDrafts`| OK wired    | none (LLM live) |
| `src/lib/leadScoreExplain.ts`    | `worker/lead-score.ts`        | OK wired    | D1 1h TTL |

API publique **100% préservée** — toutes les signatures existantes restent intactes.
Nouvelles fonctions async ajoutées (`syncReactions`, `syncQuickReplies`,
`generateDraftsAsync`, `fetchExplainScore`) — opt-in, callers existants non impactés.

## Endpoints Workers ajoutés (6)

```
GET    /api/messages/:id/reactions                         → Reaction[]
POST   /api/messages/:id/reactions      { emoji }          → Reaction[] (idempotent)
DELETE /api/messages/:id/reactions/:emoji                  → Reaction[]

GET    /api/leads/:id/quick-replies                        → string[]
POST   /api/leads/:id/quick-replies     { content }        → string[] (FIFO 3)

GET    /api/leads/:id/score                                → { score, signals[], computed_at, cached }

POST   /api/ai/drafts                   { lead_id?, last_message, conversation_context?, tones? }
                                                           → { drafts: DraftOption[] }
```

Tous les endpoints sont **protégés par auth** (passent par `requireAuth` standard
via le router `routeProtected`). Audit log écrit pour reactions add/remove.

## Migration D1

Fichier : `migration-sprint43.sql` (racine repo, conforme convention existante).

3 tables créées :

- `message_reactions` (id, message_id, user_id, emoji, created_at)
  - UNIQUE(message_id, user_id, emoji) → idempotence INSERT OR IGNORE
  - Index : message_id, user_id
- `quick_replies` (id, lead_id, user_id, content, created_at)
  - Index composite : (lead_id, user_id, created_at DESC) → top-3 par user/lead
- `lead_score_cache` (lead_id PK, score, signals JSON, computed_at)
  - Index : computed_at (pour purge globale future si besoin)

**À déployer** :
```bash
wrangler d1 execute intralys-db --remote --file=migration-sprint43.sql
# ou en local
wrangler d1 execute intralys-db --local --file=migration-sprint43.sql
```

## Claude Haiku 4.5 wirage

Le module `worker/ai.ts` contient déjà `callLLM()` qui pointe sur
`https://api.anthropic.com/v1/messages` avec `model: 'claude-haiku-4-5'`.
Pas de nouveau wiring nécessaire — `handleAiDrafts` réutilise `callLLM` avec
3 system prompts spécifiques (short / detailed / awaiting) en français
québécois informel.

**Env vars requises** (déjà présentes dans `Env` type) :
- `ANTHROPIC_API_KEY` — clé Anthropic (secret Cloudflare Worker)
- `USE_MOCKS` — `'true'` en dev pour bypass LLM réel

Si `ANTHROPIC_API_KEY` absent ou `USE_MOCKS=true` → fallback mock heuristique
côté serveur (cf `generateMockContent` dans `ai.ts`). Si la requête LLM échoue,
fallback mock automatique également. Le client lib `aiDrafts.ts` a SON propre
fallback heuristique local (`generateDrafts`) si le fetch HTTP échoue.

## Optimistic UI préservé

### Reactions
- `toggleReaction` commit local **immédiatement** (cache localStorage + retour Promise)
- Fetch backend en arrière-plan (POST ou DELETE selon état)
- Si serveur OK → reconcile cache local avec la vérité serveur (override silencieux)
- Si serveur KO → garde l'optimistic (mode dégradé offline)

### QuickReplies
- `recordReply` commit local **immédiatement** (FIFO 3 + dedup)
- Fetch POST en arrière-plan
- Reconcile cache avec retour serveur si OK
- Cap server-side également (DELETE des entrées au-delà du top-3 par lead × user)

### AI Drafts
- `generateDrafts()` (sync) reste l'API instant — UX recommandée : afficher
  immédiatement les drafts heuristiques locaux, puis swap pour les drafts
  backend Haiku quand `generateDraftsAsync()` résout.
- Les 3 tones sont générés **en parallèle** worker-side (3 appels Haiku
  concurrents via `Promise.all`) — latence ≈ 1 appel Haiku ≈ 1-3s.

### Lead Score
- `explainScore(lead)` (sync) reste disponible — heuristique 100% locale.
- `fetchExplainScore(leadId)` (async) → backend cache D1 1h TTL.
- UX recommandée : appeler les 2 ; afficher `explainScore` instant tant que
  la promesse fetch n'est pas résolue.

## Modifications worker.ts

Routes ajoutées dans `routeProtected()` après les routes AI existantes (Sprint 21).
Imports ajoutés en haut du fichier (3 modules + 1 fonction depuis ai.ts).
Aucune route existante modifiée — additif pur.

## Préservations critiques

- **API publique frontend** : 0 breaking change. Toutes les signatures Sprint 32/33
  préservées. Nouvelles fonctions optionnelles uniquement.
- **Optimistic UI** : préservé partout (commit local d'abord, sync backend ensuite).
- **Loi 25 / CASL** : 0 modification — pas de PII supplémentaire stockée.
- **TPS/TVQ** : N/A (zone Invoices non touchée).
- **Composants Inbox** (`MessageBubble`, `MessageReactions`, `MessageComposer`) :
  aucune modification rendering.
- **FR québécois** : system prompts Claude rédigés en français québécois
  informel pro CRM PME (cf `buildDraftSystemPrompt` dans `ai.ts`).

## TODO futurs (hors scope M3)

- SSE streaming pour `/api/ai/drafts` (actuellement JSON unique réponse) —
  upgrade trivial : remplacer `Promise.all` par `ReadableStream` avec event
  par draft. Préservation parallel-gen possible avec `for await`.
- Purge périodique `lead_score_cache` (cron déjà actif via `scheduled` —
  ajouter `DELETE FROM lead_score_cache WHERE computed_at < unixepoch() - 86400`).
- Sync per-user pour reactions (actuellement la `reacted` flag dépend du
  `auth.userId` Bearer — bug-free) mais cross-device sync nécessite WebSocket
  ou polling (out-of-scope).
- Backfill `last_activity_at` pour leads pré-existants si computeSignals
  retourne `daysSince = 999` sur la majorité (signal activity dominé négatif).

## Vérification post-deploy

```sql
-- Smoke test migration
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('message_reactions', 'quick_replies', 'lead_score_cache');
-- Doit retourner 3 lignes

-- Smoke test endpoints (avec token Bearer admin)
curl -H "Authorization: Bearer $TOK" https://crm.intralys.com/api/messages/MSG_ID/reactions
curl -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{"emoji":"👍"}' https://crm.intralys.com/api/messages/MSG_ID/reactions
curl -H "Authorization: Bearer $TOK" https://crm.intralys.com/api/leads/LEAD_ID/quick-replies
curl -H "Authorization: Bearer $TOK" https://crm.intralys.com/api/leads/LEAD_ID/score
curl -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"last_message":"Combien ça coûte?","tones":["short"]}' https://crm.intralys.com/api/ai/drafts
```
