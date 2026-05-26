# LOT AI Chat Agent — Sprint 42

> Doc contrat §6 figé. Migration : seq137 — `migration-chat-bot-seq137.sql`.
> Compagnons : `LOT-CHAT-WIDGET-S36.md` (module parent — webchat widget + DO
> WebchatRoom + iframe sandbox + presence), `LOT-VOICE-AGENT-S41.md` (calque
> pattern handler stub Phase A + ordre anti-shadowing + i18n parité STRICTE),
> `LOT-TEAM-BC.md` (capabilities FIGÉES seq80 — réutilisation `settings.manage`).

## §1 Contexte

Le WEBCHAT + DO WebchatRoom + presence agent **EXISTENT DÉJÀ** dans Intralys
(livré Sprint 36, seq131). Composants en place :

- `src/worker/webchat.ts` — Durable Object `WebchatRoom` (WS bidirectionnel,
  typing, historique 50 msg, alarm cleanup 24h).
- `src/worker/chat-widgets.ts` — 9 handlers AUTHED CRUD widgets + sessions +
  presence (cap `settings.manage`).
- `src/worker/chat-session.ts` — 3 handlers PUBLIC start/message/poll (visiteurs).
- `src/worker/lib/chat-session-do.ts` — 5 helpers persist/notify (best-effort).
- Tables seq25 + seq131 : `webchat_widgets`, `webchat_sessions`,
  `webchat_agent_presence`.

**Sprint 42 = ENRICHISSEMENT, PAS reconstruction**. On NE TOUCHE PAS au DO,
aux handlers chat-widgets / chat-session, au helper chat-session-do, à
l'iframe `public/widget/v1.js`. On ajoute la couche **AI Chat Agent** :

1. Multi-entries knowledge base par tenant (`chat_knowledge_base` table NEUVE) —
   FAQ + extraits docs + URLs scrapées, avec `embedding_json` (vecteur computed
   Phase B via env.AI binding embeddings model si dispo).
2. Configuration globale du bot par tenant (`chat_bot_config` table NEUVE,
   UNIQUE INDEX 1 row par client_id) : system_prompt + confidence_threshold +
   escalation_message + enabled + max_messages_per_session.
3. Inférence Haiku 4.5 via Workers AI `env.AI` (FLAG INACTIF si binding absent
   → escalade systématique).
4. RAG : search KB (LIKE fallback ou cosine similarity sur embedding) →
   buildBotPrompt(system + KB context + history + question) → runBotInference
   → réponse + confidence.
5. Escalade vers humain si confidence < threshold OU demande explicite
   ("humain", "agent", "real person", "hablar con persona") → notification
   `webchat_agent_presence` (S36) → handover seamless.
6. UI dashboard (Phase C frontend) : liste KB CRUD, edit config bot, test
   sandbox preview, toggle enabled.

L'INTÉGRATION au DO WebchatRoom existant se fera Phase B via signal/poll
additive (jamais en modifiant le code DO existant). Si le tenant n'a pas
activé le bot (`enabled=0`, default), le webchat S36 reste 100 % fonctionnel
et inchangé.

## §2 Migrations — seq137 (DDL résumé)

Fichier racine : `migration-chat-bot-seq137.sql`. Manifest entrée seq137
(`docs/migrations-manifest.json`), `depends_on:
["migration-voice-agent-seq136.sql", "migration-webchat-widget-s36-seq131.sql"]`
(chaînage strict sur dernière migration LOT 4 + parent module Sprint 36).

100 % ADDITIF, zéro CHECK / FK destructrice / ALTER destructeur / DROP / RENAME :

- `CREATE TABLE IF NOT EXISTS chat_knowledge_base` : id PK, client_id, title,
  content, embedding_json (TEXT NULL — JSON array du vecteur), source
  (DEFAULT 'manual' — enum HANDLER `manual|url|faq`), is_active (INTEGER
  DEFAULT 1), created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS chat_bot_config` : id PK, client_id (UNIQUE
  via index), widget_id (FK applicative → webchat_widgets.id, NULL = global
  tenant), system_prompt (TEXT NOT NULL DEFAULT 'You are a helpful
  assistant.'), confidence_threshold (REAL DEFAULT 0.7), escalation_message
  (TEXT NOT NULL DEFAULT 'Un agent va vous répondre sous peu.'), enabled
  (INTEGER DEFAULT 0 — opt-in conscient), max_messages_per_session (INTEGER
  DEFAULT 20 — hard cap anti-abuse), created_at, updated_at.
- 2 `ALTER TABLE webchat_sessions ADD COLUMN` : `bot_handled` (INTEGER
  DEFAULT 0), `bot_messages_count` (INTEGER DEFAULT 0).
- 2 indexes : `idx_chat_kb_client` (client_id, is_active),
  `uniq_chat_bot_config_client` (UNIQUE sur client_id — garantit 1 config
  par tenant + permet UPSERT via `INSERT … ON CONFLICT(client_id) DO UPDATE`).

Validation enums (`source` ∈ `manual|url|faq`) faite SIDE-HANDLER
(`chat-bot.ts` whitelist JS) — calque LOT-VOICE-AGENT-S41 §6 +
LOT-CHAT-WIDGET-S36 §6 (pas de CHECK = pas de rebuild SQLite jamais).

## §3 Routes (7 AUTHED + 0 PUBLIC Phase A)

Toutes câblées dans `src/worker.ts` à l'intérieur du bloc `routeProtected`,
APRÈS le bloc S41 voice-agent (~l.3115), AVANT le bloc Sprint 23 sécurité
(~l.3117). Garde `requireAuth` au choke-point + garde capability
**`settings.manage`** (FIGÉE seq80) appliquée DANS chaque handler.

ORDRE ANTI-SHADOWING strict : `/knowledge/:id` (paramétré) AVANT collection
`/knowledge`, `/config` seul, `/test` seul. Aucun conflit segment-wise.

| Méthode | Chemin                              | Handler                  | Fichier      |
|--------:|-------------------------------------|--------------------------|--------------|
| GET     | `/api/chat-bot/knowledge`           | `handleListKnowledge`    | chat-bot.ts  |
| POST    | `/api/chat-bot/knowledge`           | `handleCreateKnowledge`  | chat-bot.ts  |
| PATCH   | `/api/chat-bot/knowledge/:id`       | `handleUpdateKnowledge`  | chat-bot.ts  |
| DELETE  | `/api/chat-bot/knowledge/:id`       | `handleDeleteKnowledge`  | chat-bot.ts  |
| GET     | `/api/chat-bot/config`              | `handleGetConfig`        | chat-bot.ts  |
| PUT     | `/api/chat-bot/config`              | `handleUpdateConfig`     | chat-bot.ts  |
| POST    | `/api/chat-bot/test`                | `handleTestBot`          | chat-bot.ts  |

Réponses normalisées **`{ data }`** / **`{ error }`** (PAS de champ `code` —
contrat GELÉ docs/LOT-TEAM-BC.md §6.A). Phase A renvoie `501` partout
(`Phase B not yet implemented`) pour câbler la matrice routes/handlers sans
casser le worker — calque voice-agent Phase A + snapshots Phase A.

**Routes publiques /api/webchat/\* INCHANGÉES** (déjà câblées ~l.1067 par
S25 + S36) : `/ws`, `/prechat`, `/widget.js` continuent de fonctionner tel
quel via le DO existant. Sprint 42 n'ajoute AUCUNE route publique Phase A.

## §4 Handlers (signatures FIGÉES Phase A — Phase B Manager-B remplit)

### `src/worker/chat-bot.ts` (7 handlers AUTHED)

```ts
export async function handleListKnowledge(env: Env, auth: ChatBotAuth): Promise<Response>
export async function handleCreateKnowledge(request: Request, env: Env, auth: ChatBotAuth): Promise<Response>
export async function handleUpdateKnowledge(request: Request, env: Env, auth: ChatBotAuth, id: string): Promise<Response>
export async function handleDeleteKnowledge(env: Env, auth: ChatBotAuth, id: string): Promise<Response>
export async function handleGetConfig(env: Env, auth: ChatBotAuth): Promise<Response>
export async function handleUpdateConfig(request: Request, env: Env, auth: ChatBotAuth): Promise<Response>
export async function handleTestBot(request: Request, env: Env, auth: ChatBotAuth): Promise<Response>
```

### `src/worker/lib/chat-bot-engine.ts` (4 helpers stubs Phase A)

```ts
export async function searchKnowledge(env: Env, clientId: string, query: string): Promise<ChatKnowledgeBaseEntry[]>
export function buildBotPrompt(config: { system_prompt: string }, kbEntries: ChatKnowledgeBaseEntry[], conversationHistory: Array<{role:'user'|'assistant'; content:string}>, userMessage: string): string
export async function runBotInference(env: Env, prompt: string): Promise<{ response: string | null; confidence: number }>
export function shouldEscalateChat(confidence: number, threshold: number, userMessage: string): boolean
```

**Notes engine** :
- `searchKnowledge` Phase A stub retourne `[]` (Phase B remplit avec SELECT
  + LIKE/cosine). Borné tenant strict via `clientId`.
- `buildBotPrompt` Phase A stub concat naive system + KB titles + history +
  question (Phase B remplit avec template structuré `<context>...`).
- `runBotInference` Phase A FLAG INACTIF : retourne `{ response: null,
  confidence: 0 }` → caller escalade. Phase B Manager-B remplit avec appel
  `@cf/anthropic/claude-haiku-4-5` réel via `env.AI.run()`.
- `shouldEscalateChat` Phase A déjà FONCTIONNEL (pure helper, normalize +
  keyword check FR/EN/ES). Pas de modification Phase B sauf ajout langues.

## §5 Types `src/lib/api.ts` (FIGÉS Phase A)

```ts
export type ChatKnowledgeSource = 'manual' | 'url' | 'faq'

export interface ChatKnowledgeBaseEntry  // 8 champs : id, client_id, title, content, source, is_active, created_at
export interface ChatBotConfig            // 9 champs : id, client_id, widget_id, system_prompt, confidence_threshold,
                                          //            escalation_message, enabled, max_messages_per_session
export interface ChatKnowledgeBaseInput   // 4 champs optionnels (POST/PATCH)
export interface ChatBotConfigInput       // 6 champs optionnels (PUT upsert)
export interface ChatBotTestResult        // 4 champs : response, confidence, would_escalate, matched_kb_entries
```

Helpers async exportés :

- `listChatKnowledge()`, `createChatKnowledge(input)`, `updateChatKnowledge(id, input)`,
  `deleteChatKnowledge(id)`
- `getChatBotConfig()`, `updateChatBotConfig(input)`
- `testChatBot(input)`

## §6 Contrat inter-agent FIGÉ — Phase B B/C ne peuvent PAS modifier

1. **Migrations** : seq137 verrou. Aucun champ supplémentaire en Phase B sans
   nouvelle seq (138+). Aucun CHECK ajouté (rebuild SQLite interdit). 100 %
   ADDITIF.
2. **Routes** : 7 chemins/méthodes AUTHED figés (§3). Aucun renommage.
   L'ordre anti-shadowing dans `worker.ts` est invariant. Routes publiques
   `/api/webchat/*` INCHANGÉES (S36 verrou).
3. **Capabilities** : `settings.manage` (seq80) uniquement. AUCUN ajout à
   `ALL_CAPABILITIES`. Capabilities FIGÉES seq80.
4. **Contrat réponses** : `json({ data })` succès / `json({ error }, status)`
   erreur. PAS de champ `code`. PAS de wrapping supplémentaire.
5. **Types `src/lib/api.ts`** : noms et signatures FIGÉS (§5). Manager-C peut
   ajouter des `interface` supplémentaires côté front s'il les expose, mais
   ne renomme PAS les exports listés.
6. **Bornage tenant** : `WHERE client_id = ?` dans tout SELECT/UPDATE/DELETE
   sur `chat_knowledge_base` et `chat_bot_config` (defense-in-depth IDOR sur
   `:id`). `resolveClientId()` via `getClientModules(env, auth.userId)` —
   calque `voice-agent.ts:32` + `chat-widgets.ts:26`.
7. **Imports RELATIFS** : `import type { Env } from './types'` /
   `from '../types'` — JAMAIS d'alias `@/`. Calque voice-agent.ts +
   chat-widgets.ts.
8. **NE TOUCHE PAS S36 existants** :
   - `src/worker/webchat.ts` (DO WebchatRoom) — INCHANGÉ
   - `src/worker/chat-widgets.ts` (9 handlers S36) — INCHANGÉ
   - `src/worker/chat-session.ts` (3 handlers publics S36) — INCHANGÉ
   - `src/worker/lib/chat-session-do.ts` (5 helpers S36) — INCHANGÉ
   - `public/widget/v1.js` / `public/widget/frame.html` — INCHANGÉS
   Si Phase B a besoin d'un signal vers le DO (réponse bot dans le flux WS),
   passer par un **nouveau** helper additif (ex `lib/chat-bot-bridge.ts`)
   qui appelle `env.WEBCHAT_ROOMS.idFromName()` + `room.fetch()` — sans
   modifier le DO.
9. **AI ENGINE — env.AI FLAG INACTIF** : `runBotInference` retourne
   `{ response: null, confidence: 0 }` si `env.AI` absent → caller
   `handleTestBot` (et Phase B `handleBotReply`) escaladent
   systématiquement. JAMAIS d'erreur jetée. JAMAIS d'API key externe.
10. **i18n** : 16 clés ajoutées dans 4 catalogues (`fr-CA`, `fr-FR`, `en`,
    `es`), parité STRICTE (même nombre de clés, mêmes noms). Manager-C ne
    change PAS le nom des clés. `};` final de chaque catalogue PRÉSERVÉ.

### Vérifications inter-agent (à valider AVANT Phase B kickoff)

- [x] Manifest JSON valide (`python -m json.tool docs/migrations-manifest.json`)
- [x] 4 catalogues i18n MÊME nombre de clés `chat_bot.*` (16 chacun)
- [x] `};` final de chaque catalogue PRÉSERVÉ (fr-CA, fr-FR, en, es)
- [x] Routes câblées dans `worker.ts` après bloc S41 voice-agent (~l.3115)
- [x] Aucun touch sur `webchat.ts`, `chat-widgets.ts`, `chat-session.ts`,
      `chat-session-do.ts` (vérifier `git status` Phase A end)
- [x] `chat-bot.ts` + `chat-bot-engine.ts` créés en NOUVEAUX fichiers
- [x] Imports relatifs uniquement (`./types`, `../types`, `../../lib/api`)
- [x] `json({ data })` / `json({ error }, status)` partout — pas de `code`
- [x] `requireCapability(auth.capabilities, 'settings.manage')` top de chaque handler

## §7 Découpe Phase B (Manager-B backend ∥ Manager-C frontend)

- **Manager-B** : remplit les 7 handlers AUTHED + 4 helpers engine. Branche
  `env.AI` réel (Workers AI Haiku 4.5 via `@cf/anthropic/claude-haiku-4-5`)
  + embeddings KB optionnels via `@cf/baai/bge-large-en-v1.5` (computed à
  l'INSERT/UPDATE). Implémente `handleTestBot` flow complet : resolveClientId
  → load config → searchKnowledge → buildBotPrompt → runBotInference →
  shouldEscalateChat → renvoie ChatBotTestResult.
- **Manager-C** : page `/settings/chat-bot` (liste KB CRUD + form upsert
  config + test sandbox preview + toggle enabled), intégration des 16 clés
  i18n. ZÉRO fichier partagé avec B (api.ts est en lecture pour C).

## §8 Sécurité & Loi 25 / RGPD

- **PII visiteur** : aucun nouveau champ PII en seq137 (seuls
  `bot_handled` + `bot_messages_count` ADD COLUMN, deux compteurs binaires).
  IP hash + email Loi 25 conformité déjà couverte par S36 (`webchat_sessions.ip_hash`
  SHA-256 + `visitor_email` opt-in prechat).
- **Abuse / rate-limit** : `chat_bot_config.max_messages_per_session`
  (default 20) appliqué HANDLER Phase B dans `handleBotReply` (équivalent
  Phase B de `handleTestBot`) — count `webchat_sessions.bot_messages_count`
  incrémenté à chaque réponse bot, refuse si >= max.
- **Anti-jailbreak** : `buildBotPrompt` ne fait JAMAIS d'eval / innerHTML /
  String.raw — concat textuelle stricte uniquement. Le system_prompt est
  contrôlé par le tenant via `settings.manage` (pas d'injection via visiteur).
- **No external API key** : Workers AI uniquement (`env.AI`). Aucun appel
  Anthropic SDK / OpenAI / Replicate. Si `env.AI` absent → FLAG INACTIF
  → escalade systématique vers humain (via S36 `webchat_agent_presence`).

---

**Tableau de bord Phase A — état Manager-A SOLO** :

| Livrable                                             | Statut |
|------------------------------------------------------|:------:|
| Migration `migration-chat-bot-seq137.sql` (additif)  |   ✅   |
| Manifest entry seq137 (depends seq136 + seq131)      |   ✅   |
| Types `src/lib/api.ts` (5 interfaces + 7 helpers)    |   ✅   |
| Routes `worker.ts` (7 routes après bloc S41)         |   ✅   |
| Stubs `chat-bot.ts` (7 handlers, 501)                |   ✅   |
| Stubs `chat-bot-engine.ts` (4 helpers)               |   ✅   |
| i18n × 4 catalogues (16 clés parité STRICTE)         |   ✅   |
| Doc `docs/LOT-CHAT-BOT-S42.md` §6 FIGÉ               |   ✅   |
