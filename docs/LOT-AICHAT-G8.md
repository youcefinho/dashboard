# LOT G8 — AI Workspace conversationnel (assistant global cmd+/)

> Source de vérité figée Phase A SOLO. Le code fait foi ; ce doc recopie le §6
> tranché par le Chaman (READ-ONLY, audit disque) + le log d'implémentation
> Phase A + les 2 FLAGS sécurité transmis à Phase B Manager-B.

---

## §0 — AUDIT DISQUE (confirmé Chaman, le code fait foi)

- **Provider AI** = Anthropic API directe (`src/worker/ai.ts:29-42` : `fetch('https://api.anthropic.com/v1/messages')`, `x-api-key: env.ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`, modèle **`claude-haiku-4-5`**, max_tokens 1024). Fallback mock si `isAiMockMode(env)` (`USE_MOCKS==='true' || !ANTHROPIC_API_KEY`). `callLLM(systemPrompt, userPrompt)` = **MONO-TOUR, ne passe ni messages[] ni tools**. → G8 crée un **helper local dans ai-chat.ts** (fetch Anthropic multi-tour + tools), NE MODIFIE PAS `ai.ts` (gros, 11 handlers legacy).
- **Primitives "nlQuery/aiCompose/etc." sont FRONTEND** (`src/lib/`, fallbacks heuristiques offline), PAS worker. `src/worker/nlQuery.ts` N'EXISTE PAS. Le vrai AI worker = `ai.ts`. Le "nl-query" worker = `handleAiNlQuery` (ai.ts:1035) renvoie des `filters` structurés, PAS du SQL.
- **FLAG SÉCURITÉ existant** : les 11 endpoints AI legacy sont `handleAiX(request, env)` SANS `auth`, n'enforcent NI `ai.use` NI bornage tenant (ex `handleAiSummarizeLeads` ai.ts:460 `WHERE id IN (...)` sans `client_id`). **G8 NE reproduit PAS ce pattern : ai-chat.ts handlers reçoivent `auth` + bornent tenant.**
- **`ai_conversations`/`ai_messages` existent (seq 7) mais INCOMPATIBLES** (FK `lead_id NOT NULL REFERENCES leads`, channel sms/web/email = bot lead-répondeur). **NE PAS réutiliser ni ALTER.** → tables NEUVES préfixe **`ai_chat_threads`/`ai_chat_messages`**.
- **Streaming** : `apiFetch` JSON-only. Pas d'infra SSE générique. → **v1 JSON simple.**
- **Command palette** : `src/components/CommandPalette.tsx` ouverte cmd+K (`AppLayout.tsx:396` handler + monté ~782). **cmd+/ LIBRE.** Aucune route `/assistant`/`/ai`/`/chat` (pas de collision — vérifié quand même, voir log).
- **Capability** `ai.use` ∈ ALL_CAPABILITIES (capabilities.ts:48). `authCtx.capabilities` injecté worker.ts:741.
- **Tenant** : `auth.clientId`, `auth.tenant.accessibleClientIds[]`, `agencyId`. Bornage `WHERE client_id=?` (auth, JAMAIS body/LLM).
- **i18n** : 4 catalogues plats dot-notation. `ai.*` = 3 clés (ai.mock.*). `assistant.*` LIBRE.
- **seq 90 dernière → seq 91 LIBRE.**

## §6.A — ARCHITECTURE (tranché)

- Anthropic Haiku 4.5 réutilisé (helper local ai-chat.ts, ai.ts intouché).
- **Option B+** : prompt-stuffing (résumé tenant déterministe calculé en SQL borné, SANS LLM) dans system prompt + tools tool-calling Anthropic READ-ONLY exécutés worker-side. **Le LLM ne touche JAMAIS D1 ; les tools reçoivent client_id depuis `auth`, jamais du LLM.**
- **v1 READ-ONLY + DRAFT-ONLY strict** : LLM lit/calcule/rédige brouillons (email, workflow JSON) mais AUCUNE mutation. "Crée un workflow" → renvoie JSON draft + bouton "Créer" → confirmation humaine → POST /api/workflows normal. Actions auto = v2.
- Mémoire `ai_chat_threads`+`ai_chat_messages` bornées client_id+user_id. v1 persistance simple.
- Tools v1 (§6.H). JSON simple (Q6). Panel slide-over global cmd+/ (Q7). `ai.use` réutilisée garde mode-agence-only. Rate-limit N msg/min/user via COUNT ai_chat_messages role='user' created_at>now-60s.

## §6.B — MIGRATION seq 91 (`migration-aiworkspace-seq91.sql`, depends 90)

En-tête garde-fous style seq 90. Timestamps `datetime('now')`. **Préfixe `ai_chat_*` IMPÉRATIF (ne JAMAIS toucher ai_conversations/ai_messages seq 7).**

```sql
CREATE TABLE IF NOT EXISTS ai_chat_threads (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  user_id TEXT NOT NULL,
  title TEXT DEFAULT 'Nouvelle conversation',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  thread_id TEXT NOT NULL,
  client_id TEXT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  tokens_used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aichat_thread_user ON ai_chat_threads(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_aichat_msg_thread ON ai_chat_messages(thread_id, created_at);
```

Zéro FK, zéro CHECK (rôle validé HANDLER), zéro NOT NULL sur client_id (legacy NULL). Manifest : `{ "seq": 91, "file": "migration-aiworkspace-seq91.sql", "depends_on": ["migration-segment-abtest-seq90.sql"], "objects": ["table:ai_chat_threads","table:ai_chat_messages","index:ai_chat_threads","index:ai_chat_messages"], "risk": "low" }`.

## §6.C — ROUTES worker.ts (nouveau module `src/worker/ai-chat.ts`, handlers `(request, env, auth)` AVEC auth)

Bloc après les routes AI existantes. Garde `requireCapability(auth.capabilities, 'ai.use')` mode-agence-only (calque LOT B-bis) en tête de chaque handler. Anti-shadowing (sous-routes avant génériques).

- `GET /api/ai/chat/threads` → handleListAiThreads (WHERE user_id=auth.userId AND (client_id=? OR client_id IS NULL))
- `POST /api/ai/chat/threads` → handleCreateAiThread (client_id=auth.clientId)
- `GET /api/ai/chat/threads/:id` → handleGetAiThread (ownership user_id=auth.userId)
- `DELETE /api/ai/chat/threads/:id` → handleDeleteAiThread (+ messages applicatif)
- `POST /api/ai/chat/threads/:id/message` → handleSendAiMessage (CŒUR : insert user msg, charge historique cap 20, system prompt résumé tenant borné + tools schema, boucle tool-calling worker-side max 3 tours tools AVEC auth injecté, insert assistant msg, rate-limit en tête). Ordonner `/message` AVANT `/:id` générique.

## §6.D — API helpers (api.ts) + types (types.ts) — ApiResponse INCHANGÉ jamais code

Types dans `src/lib/types.ts` :

```ts
export interface AiChatThread { id:string; title:string; created_at:string; updated_at:string }
export interface AiChatMessage { id:string; role:'user'|'assistant'; content:string; tool_calls?:string; created_at:string }
```

Helpers dans `src/lib/api.ts` (réutilise apiFetch, ApiResponse INCHANGÉ, jamais code ; API_BASE se termine par `/api` ⇒ chemins `/ai/chat/...`) :

```ts
listAiThreads(): Promise<ApiResponse<AiChatThread[]>>
createAiThread(): Promise<ApiResponse<AiChatThread>>
getAiThread(id:string): Promise<ApiResponse<{thread:AiChatThread; messages:AiChatMessage[]}>>
deleteAiThread(id:string): Promise<ApiResponse<{success:boolean}>>
sendAiMessage(threadId:string, content:string): Promise<ApiResponse<{message:AiChatMessage}>>
```

JSON simple, pas de streaming v1.

## §6.E — i18n `assistant.*` (24 clés) ×4 catalogues parité STRICTE

`assistant.title/placeholder/send/new_thread/empty_state/thinking/error/shortcut_hint/draft_action/create_workflow_cta/confirm_create/disabled_no_cap/tool.querying/delete_thread/threads_title/no_threads/retry/copy/copied/mock_notice` + `assistant.suggested.summarize_leads/draft_email/revenue/next_action`. ZÉRO collision (`ai.mock.*` distinct). Ordre fr-CA→fr-FR→en→es. fr-CA tutoiement québécois, fr-FR vouvoiement. **24 clés ×4 = 96 (vérifié grep).**

## §6.F — COMPOSANTS (panel global, PAS de page → AUCUNE route ajoutée)

- `src/components/assistant/AiAssistantPanel.tsx` (slide-over droit, stub Phase A)
- `src/components/assistant/AiChatThread.tsx` (liste messages + input, stub Phase A)
- Intégration `AppLayout.tsx` (montage panel + cmd+/) = **Phase B Manager-C exclusif** (PAS Phase A).
- 6 pages publiques R exclues.

## §6.G — DÉCOUPAGE

- **Phase A SOLO (FAIT)** : migration seq 91 + manifest + types.ts + stubs `src/worker/ai-chat.ts` (5 handlers signatures figées + capGuard helper, corps placeholder) + routes worker.ts câblées + api.ts 5 helpers + i18n ×4 + stubs composants AiAssistantPanel/AiChatThread + ce doc §6 verbatim + 2 FLAGS sécurité documentés.
- **Phase B Manager-B (backend exclusif)** : corps `ai-chat.ts` (5 handlers réels + helper LLM multi-tour local + tools READ-ONLY bornés + résumé tenant + rate-limit).
- **Phase B Manager-C (front exclusif)** : composants réels AiAssistantPanel/AiChatThread + intégration AppLayout.tsx (cmd+/ + montage).

## §6.H — DISJONCTION

- Exclusifs B : `src/worker/ai-chat.ts` (corps).
- Exclusifs C : `src/components/assistant/*`, `src/components/layout/AppLayout.tsx` (intégration cmd+/).
- PARTAGÉS Phase B = ZÉRO (worker.ts/api.ts/types.ts/i18n/migration FIGÉS Phase A).
- READ-ONLY Phase B : `src/worker/ai.ts` (11 handlers legacy + callLLM — NE PAS modifier, helper LLM est LOCAL dans ai-chat.ts), `src/lib/nlQuery.ts` + primitives `src/lib/ai*.ts` (frontend), `src/worker/workflows.ts` (moteur — réutilise au plus la logique génération JSON de handleAiSuggestWorkflow en LECTURE), `tenant-context.ts`, `capabilities.ts`, `ai_conversations`/`ai_messages` seq 7.

## 🚨 §6.H FLAG SÉCURITÉ #1 — RAG CROSS-TENANT (Phase B Manager-B IMPÉRATIF)

CHAQUE tool exécuté worker-side reçoit `client_id` depuis `auth`, JAMAIS du body ni de l'output LLM. Le LLM ne voit aucun identifiant tenant. Tools v1 tous `WHERE client_id=?` (auth) : `query_leads` (filtres validés mappés sur requête paramétrée whitelistée, PAS de SQL libre LLM), `get_revenue` (orders/invoices), `get_lead_stats`, `get_calendar` (bookings/appointments), `draft_email` (logique handleAiGenerate), `explain_lead_score`, `summarize` (texte fourni). **NE PAS réutiliser handleAiSummarizeLeads legacy tel quel (lit sans client_id) — tout tool dérivé AJOUTE `AND client_id=?`.** Aucun tool n'accepte SQL ni table name dynamique.

Helper exporté Phase A pour réutilisation : `scopeClientId(auth)` (ai-chat.ts) → résout `auth.tenant?.clientId ?? auth.clientId ?? null`, AUTH uniquement.

## 🚨 §6.H FLAG SÉCURITÉ #2 — EXÉCUTION ACTIONS (Phase B Manager-B IMPÉRATIF)

v1 READ-ONLY/DRAFT-ONLY strict. AUCUN tool mutant (pas INSERT/UPDATE/DELETE, pas envoi email/SMS). Actions = brouillon → confirmation humaine → endpoint mutant existant normal. Actions auto = v2.

## §6.I — GARDE-FOUS

Additif pur · CHECK59/E4-E6 jamais touchés · users/admin_sessions intouchés · 6 pages R exclues · i18n 4 catalogues parité avant usage · SPA pas SSR · ZÉRO ajout ALL_CAPABILITIES (ai.use réutilisée) · ApiResponse inchangé jamais code · zéro FK zéro CHECK SQL (validation handler) · primitives AI + workflows moteur + ai.ts READ-ONLY Phase B · préfixe ai_chat_* (jamais ai_conversations seq 7) · bornage RAG = auth uniquement le LLM n'injecte jamais de tenant · jamais git config.

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-20)

Fichiers **créés** :
1. `migration-aiworkspace-seq91.sql` — 2 tables (`ai_chat_threads`, `ai_chat_messages`) + 2 index, additif pur, zéro FK/CHECK, préfixe `ai_chat_*`, depends_on seq 90.
2. `src/worker/ai-chat.ts` — module stub : `AiChatAuth` type, `capGuard` (ai.use), `scopeClientId` (export), 5 handlers signatures figées corps placeholder (`{data:[]}` pour list, `{error:'stub'},501` pour le reste), 2 FLAGS sécurité documentés en tête.
3. `src/components/assistant/AiAssistantPanel.tsx` — stub slide-over (SlidePanel) montant AiChatThread, props `{open,onOpenChange}` figées.
4. `src/components/assistant/AiChatThread.tsx` — stub fil, props `{threadId?}` figées, empty_state i18n.
5. `docs/LOT-AICHAT-G8.md` — ce document.

Fichiers **modifiés** :
1. `docs/migrations-manifest.json` — entrée seq 91 ajoutée après seq 90.
2. `src/lib/types.ts` — 2 interfaces `AiChatThread` / `AiChatMessage` après `ApiResponse` (INCHANGÉ).
3. `src/lib/api.ts` — 5 helpers (`listAiThreads`/`createAiThread`/`getAiThread`/`deleteAiThread`/`sendAiMessage`) + 2 types ajoutés à l'import. Chemins `/ai/chat/...` (API_BASE inclut `/api`). apiFetch/ApiResponse INCHANGÉS.
4. `src/worker.ts` — import du module ai-chat + 5 routes câblées dans `routeProtected` (auth injecté), anti-shadowing `/:id/message` AVANT `/:id`.
5. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 24 clés `assistant.*` ×4 (parité stricte vérifiée : 96 occurrences).

**Build** : non vérifié (VMware sans bun/node) — **build délégué Antigravity**.

### Écarts CODE > brief
- Le brief annonçait "~20-26 clés assistant.*" : posées **24** (incluant `delete_thread/threads_title/no_threads/retry/copy/copied/mock_notice` pour couvrir les états réels du panel Phase B Manager-C). Dans la fourchette.
- `api.ts` utilise des chemins `/ai/chat/...` (PAS `/api/ai/chat/...`) car `API_BASE` (api.ts:14-16) se termine déjà par `/api` — calque exact des helpers AI existants (`/ai/suggest-workflow`, etc.). Le worker matche bien `/api/ai/chat/...`.
- Le type `auth` de `routeProtected` (worker.ts:823) est inline `{userId; role; clientId?; tenant?; capabilities?}` — compatible avec `AiChatAuth = CapAuth & {capabilities?}` passé aux handlers (aucun cast requis, calque segments.ts).

### Confirmations garde-fous
- `ai_conversations` / `ai_messages` (seq 7) : **INTOUCHÉS** (tables neuves préfixe `ai_chat_*`).
- `users` / `admin_sessions` / CHECK role seq 59 / E4-E6 (`payments`,`refunds`,`disputes`,etc.) : **INTOUCHÉS** (aucun ALTER, additif pur).
- 6 pages publiques R : **EXCLUES** (aucune route publique ajoutée — panel only).
- **Zéro collision route** `/assistant` `/ai` `/chat` dans `src/App.tsx` (grep = no match) — piège G1 clear, aucune route ajoutée.
- `src/worker/ai.ts` : **NON modifié** (helper LLM multi-tour sera LOCAL dans ai-chat.ts en Phase B).
- ZÉRO ajout `ALL_CAPABILITIES` (`ai.use` réutilisée).

---

## IMPLEMENTATION-LOG — Phase B Manager-B (backend, 2026-05-20)

Fichiers **modifiés** :
1. `src/worker/ai-chat.ts` — stubs Phase A remplacés par les CORPS RÉELS (signatures + capGuard + scopeClientId PRÉSERVÉS verbatim).
2. `docs/LOT-AICHAT-G8.md` — cette section (uniquement).

### Helper LLM multi-tour LOCAL
- `callLLMChatTurn(env, systemPrompt, messages[], tools[])` : fetch `https://api.anthropic.com/v1/messages` via `fetchWithTimeout`, `x-api-key: env.ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`, model `claude-haiku-4-5`, `max_tokens 1500`, passe `system`/`messages[]`/`tools[]` (format tool-use Anthropic). Parse les blocs `text` + `tool_use`, agrège `usage` (tokens). **NE THROW JAMAIS** (catch → tour texte de repli `stopReason 'error'`).
- `isAiChatMockMode(env)` : **réplique EXACTE** de `isAiMockMode` ai.ts (`USE_MOCKS==='true' || !ANTHROPIC_API_KEY`) — répliquée, PAS importée (ai.ts READ-ONLY). Mock → `mockAssistantReply(messages)` déterministe (revenu/lead/agenda/email/défaut), aucun tool-calling, aucun crash offline.
- `runChatLoop` : boucle tool-calling worker-side **MAX 3 tours** ; rejoue le tour assistant (`tool_use`) puis pousse les `tool_result` ; collecte `toolCalls` (audit) + `tokensUsed`.

### Les 5 handlers réels
- `handleListAiThreads` : `SELECT … WHERE user_id=auth.userId AND (client_id=? OR client_id IS NULL) ORDER BY updated_at DESC LIMIT 100`. capGuard préservé.
- `handleCreateAiThread` : `INSERT ai_chat_threads (client_id=scopeClientId, user_id, title)` ; title du body optionnel ou défaut ; retourne le thread (201).
- `handleGetAiThread` : ownership `user_id=auth.userId` (404 sinon) + messages `ORDER BY created_at ASC`.
- `handleDeleteAiThread` : ownership 404 → `DELETE ai_chat_messages WHERE thread_id` PUIS `DELETE ai_chat_threads` (cascade applicatif, zéro FK).
- `handleSendAiMessage` (CŒUR) : (1) rate-limit COUNT user msgs <60s ≥15 → 429 ; (2) ownership 404 ; (3) INSERT user msg ; (4) historique cap 20 chrono ; (5) system prompt = instructions + `buildTenantSummary` (SQL borné `client_id`, SANS LLM : leads par statut + factures payées 30j par devise + RDV 14j) ; (6) `runChatLoop` (3 tours) ; (7) INSERT assistant msg (`tool_calls` JSON transparence Loi 25 + `tokens_used`) ; (8) UPDATE `updated_at` + title auto (1ʳᵉ phrase si défaut) ; (9) retourne `{ data: { message } }`.

### Tools READ-ONLY/DRAFT-ONLY (8) — FLAG #1 + #2
Schémas exposés au LLM **SANS aucun champ client_id**. Dispatcher `executeTool(env, auth, name, input)` ; `client_id` toujours résolu via `scopeClientId(auth)` côté worker. Helper `tenantClause(col, clientId)` ajoute `AND <col>=?` si tenant connu, skip sinon (legacy strict — calque handleGetInvoices).
- `query_leads` : requête PARAMÉTRÉE whitelistée (`status` ∈ liste fermée, `source`/`tag` bindés, `score_min` clampé, `limit` 1-50) `WHERE 1=1 AND client_id=?`. Tag via sous-requête `lead_tags`. **Aucun SQL libre.**
- `get_revenue` : `SUM(amount)` invoices `status='paid'` + `SUM(total_cents)` orders payées, **GROUP BY devise** (jamais cross-devise), bornés `client_id`. orders en try/catch (compte CRM-only sans table orders).
- `get_lead_stats` : `COUNT … GROUP BY status WHERE client_id=?`.
- `get_calendar` : appointments `start_time` entre now et now+N jours (1-60), borné `client_id`.
- `draft_email` : RÉPLIQUE la logique brand_voice/lead de `handleAiGenerate` MAIS lead `SELECT … WHERE id=? AND client_id=?` (le legacy lit SANS client_id — corrigé ici). DRAFT only, n'envoie RIEN.
- `explain_lead_score` : lead borné `client_id`, 5 signaux déterministes (score/source/valeur/statut/récence).
- `summarize` : passthrough texte fourni (aucun D1).
- `draft_workflow` : RÉPLIQUE la logique JSON de `handleAiSuggestWorkflow` (`VALID_TYPES` filtrés) via le LLM local, fallback workflow par défaut. DRAFT only, ne crée RIEN.

### Écarts CODE > brief
- `get_revenue` : invoices utilise la colonne **`amount`** (REAL, migration_p3_8.sql), PAS `total` — vérifié disque. orders utilise `total_cents` (÷100) + statuts payés `paid/fulfilled/completed`.
- `tenantClause` : en legacy/mono-tenant (`scopeClientId`=null) AUCUN filtre n'est ajouté (comportement byte-identique aux handlers legacy non bornés — handleGetInvoices ne filtre que si `auth.clientId`). En mode agence, le filtre est TOUJOURS présent. Le LLM ne voit jamais `client_id`.
- `mockAssistantReply` ajouté (non détaillé au brief) pour garantir une réponse plausible offline sans tool-calling (les tools nécessitent l'API réelle).
- `callLLMChatTurn` ne throw jamais (renvoie un tour de repli) — évite tout 500 si Anthropic est down ; le message assistant de repli est inséré normalement.

### Confirmations garde-fous
- **Check stub Phase A** : 0 occurrence `'stub'` / `501` dans ai-chat.ts (tous corps réels).
- **FLAG #1** : les 8 tools bornent `client_id` via `scopeClientId(auth)` UNIQUEMENT (jamais args/LLM) ; schémas tools sans champ tenant ; zéro SQL libre, zéro nom de table dynamique. `buildTenantSummary` = 3 sous-requêtes bornées `client_id`. handleAiSummarizeLeads legacy NON réutilisé.
- **FLAG #2** : ZÉRO tool mutant métier. Seuls INSERT/UPDATE/DELETE = `ai_chat_threads`/`ai_chat_messages` (la conversation) + `updated_at`/`title`. draft_email/draft_workflow = brouillons, aucun envoi/création.
- `src/worker/ai.ts` : **NON modifié** (helper LLM multi-tour LOCAL ; isAiMockMode RÉPLIQUÉE, pas importée).
- Mock fallback (`isAiChatMockMode`) présent → pas de crash sans `ANTHROPIC_API_KEY`.
- ApiResponse `{ data }` / `{ error }` (jamais `code`). Préfixe `ai_chat_*` exclusivement (ai_conversations/ai_messages seq 7 intouchés). Aucun fichier READ-ONLY / exclusif Manager-C modifié.

**Build** : non vérifié (VMware sans bun/node) — **build délégué Antigravity**.

## IMPLEMENTATION-LOG — Phase B Manager-C (front, 2026-05-20)

### Fichiers modifiés (3 + CSS)
- `src/components/assistant/AiChatThread.tsx` — corps réel : fil de messages (bulles user droite / assistant gauche), input `<textarea>` auto-submit (Enter envoie, Shift+Enter = saut de ligne), indicateur thinking (3 dots), erreur+retry, rendu markdown léger maison (gras/italique/code/paragraphes — PAS de react-markdown pour ne pas alourdir le bundle assistant), bloc DRAFT-ONLY (workflow/email) lecture seule + copier / créer-après-confirmation.
- `src/components/assistant/AiAssistantPanel.tsx` — corps réel : sidebar threads (liste `listAiThreads` + « Nouvelle conversation » `createAiThread` + suppression `deleteAiThread` via `useConfirm`) + zone principale `<AiChatThread threadId prefill>` + état vide avec 4 prompts suggérés cliquables (pré-remplissent l'input) + shortcut hint. SlidePanel `size="lg"` + `bodyClassName="!p-0"`.
- `src/components/layout/AppLayout.tsx` — intégration chirurgicale additive : import `AiAssistantPanel`, state `assistantOpen`, raccourci **Cmd+/ (Meta/Ctrl+Slash)** ajouté DANS le handler `handleGlobalKeyDown` existant (calque cmd+K, ne le casse pas), montage `<AiAssistantPanel>` à côté de `<CommandPalette>`.
- `src/index.css` — bloc append-only `/* === LOT G8 AI Workspace === */` (~360 L) Stripe-sober, classes `aichat-*`, `prefers-reduced-motion` géré.

### i18n câblé (clés Phase A — AUCUNE créée)
`assistant.title/placeholder/send/new_thread/empty_state/thinking/error/shortcut_hint/draft_action/create_workflow_cta/confirm_create/disabled_no_cap/delete_thread/threads_title/no_threads/retry/copy/copied/mock_notice/suggested.{summarize_leads,draft_email,revenue,next_action}`. Toutes consommées via `t('assistant.…')`. `assistant.tool.querying` non câblé v1 (JSON simple sans tool-stream visible — pas d'état intermédiaire à afficher) ; clé conservée, aucune création.

### Écarts CODE > brief (props UI réelles)
- `getAiThread(id)` retourne `{ thread, messages }` (PAS messages seul) → on lit `res.data.messages`.
- `sendAiMessage` retourne `{ message }` → on append `res.data.message`.
- `useConfirm()` retourne `{ confirm, prompt }` (pas un appelable direct) → `const { confirm } = useConfirm()`.
- `SlidePanel` : props réelles `size`/`bodyClassName`/`title`/`onOpenChange` (pas de prop `onClose`). Utilisé `size="lg"` + `bodyClassName="!p-0"` pour layout pleine surface.
- `AiChatThread` : prop optionnelle additive `prefill?: string` ajoutée (rétro-compat, contrat Phase A `{threadId?}` préservé) pour câbler les prompts suggérés.
- Capability `ai.use` : `useAuth()` n'expose PAS de capabilities → détection `disabled_no_cap` par **string-match sur `res.error`** (best-effort, dégradation gracieuse), conforme « ApiResponse INCHANGÉ, jamais code ».
- Message user affiché en **optimiste** (id `local-…`) avant réponse serveur ; retiré au retry.

### Confirmations garde-fous
- **AppLayout préservé** : cmd+K INTACT (la branche `e.key === 'k'` est inchangée, la branche `e.key === '/'` est ajoutée APRÈS dans le même handler). Modif strictement additive (4 inserts : import, state, branche keydown, montage). Reste du fichier byte-identique.
- **DRAFT-ONLY front** : AUCUNE mutation auto depuis une sortie LLM. Le bloc draft ne propose que (1) Copier le brouillon, (2) « Créer ce workflow » → `confirm()` humain obligatoire → dépose le draft en `sessionStorage` + navigue vers `/workflows` (aucune création serveur côté assistant). Zéro `createWorkflow`/`updateLead`/etc. appelé depuis une réponse assistant.
- **Disjonction** : ZÉRO modification de `ai-chat.ts` / `worker.ts` / `worker/*` / `api.ts` / `types.ts` / `i18n/*` / migration / doc §6 / 6 pages R. Écriture limitée aux 3 fichiers + index.css du périmètre Manager-C.

**Build** : non vérifié (VMware sans bun/node) — **build délégué Antigravity**.
