# LOT COPILOT V2 — actions sûres + contexte page (Sprint 11 : le Copilot G8 LIT déjà le CRM → on lui ajoute des ACTIONS SÛRES exécutables avec confirmation humaine + le contexte de la page courante, 100% ADDITIF, RÉUTILISANT le chat G8 COMPLET)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-SITE-BUILDER.md` /
> `docs/LOT-AICHAT-G8.md`. **Phase B/C ne lisent QUE ce document** (+ le CODE des
> fichiers RÉUTILISÉS, jamais le brief).

Sprint resserré, **100% ADDITIF, SANS migration recommandée**. Le Copilot
conversationnel (module **G8**, `src/worker/ai-chat.ts`) est **COMPLET et à
RÉUTILISER (NE PAS reconstruire le chat)** : chat multi-tour Claude haiku-4-5,
8 tools de LECTURE CRM bornés tenant via `scopeClientId(auth)`, flag
`isAiChatMockMode`, capGuard `ai.use`, rate-limit, routes `/api/ai/chat/*`,
frontend `AiAssistantPanel.tsx` + `AiChatThread.tsx`, 24 clés `assistant.*` ×4,
tables `ai_chat_threads`/`ai_chat_messages` (seq 91). Il **LIT** le CRM.

**GAP comblé :**
1. **AGIR** — actions SÛRES/réversibles exécutables avec **confirmation humaine
   UI OBLIGATOIRE** (le chat est draft-only aujourd'hui).
2. **CONTEXTE de page courante** — la page active (route/entité) injectée dans
   le system prompt pour des réponses contextualisées.

Rails RÉUTILISÉS (par IMPORT/LECTURE — **JAMAIS modifiés** sauf ai-chat.ts qui
est l'unique fichier de travail de Manager-B) :
- `src/worker/ai-chat.ts` : `scopeClientId(auth)`, `tenantClause`, `runChatLoop`,
  `executeTool`, `TOOL_SCHEMAS` (format tools ai-chat.ts:225-308), `callLLMChatTurn`,
  `isAiChatMockMode`, `buildSystemPrompt`/`buildTenantSummary`, `capGuard('ai.use')`,
  signature de `handleSendAiMessage`. **Le chat G8.**
- Handlers MÉTIER EXISTANTS à RÉUTILISER pour l'EXÉCUTION (§6.C — signatures
  vérifiées dans le code) : `handleCreateTask` (tasks.ts), `handlePatchLead`
  (leads.ts, statut), `handleAddTag` (leads.ts).
- `src/worker/proactive-ai.ts` : alertes proactives en **LECTURE SEULE** (§6.G).
- `src/components/assistant/AiChatThread.tsx` + `AiAssistantPanel.tsx` : UI chat.
- `src/components/layout/AppLayout.tsx` : montage du panel + cmd+/ (contexte page).

Alias : imports worker **RELATIFS** (`./...`, `./lib/...`, `../lib/...`),
JAMAIS `@/`. Front `@/`.

---

## §0 — AUDIT DISQUE (le code fait foi)

- **Copilot G8 COMPLET** (`ai-chat.ts`, 887 L AVANT Sprint 11) : 8 tools READ/
  DRAFT-only (`query_leads`, `get_revenue`, `get_lead_stats`, `get_calendar`,
  `draft_email`, `explain_lead_score`, `summarize`, `draft_workflow`), tous bornés
  `WHERE client_id=?` via `scopeClientId(auth)` (jamais le LLM). `runChatLoop`
  max 3 tours. Mock fallback `isAiChatMockMode` (`USE_MOCKS==='true' ||
  !ANTHROPIC_API_KEY`). 5 handlers `(request, env, auth[, id])` + capGuard `ai.use`.
- **Tables** `ai_chat_threads`/`ai_chat_messages` (seq 91) : la colonne
  `tool_calls TEXT` (JSON) sert déjà la transparence Loi 25 → **réutilisée pour
  l'audit des actions (AUCUNE nouvelle table requise)**.
- **`ai_conversations`/`ai_messages` (seq 7)** = bot lead-répondeur INTOUCHABLE.
- **`ai.ts`** (11 handlers AI legacy) = READ-ONLY (non modifié, le helper LLM est
  LOCAL dans ai-chat.ts).
- **`proactive-ai.ts`** (seq 99) : `proactive_alerts` du tenant, handlers de
  lecture/seen/dismiss + générateurs déterministes. LECTURE SEULE pour Sprint 11.
- **Capability** `ai.use` ∈ ALL_CAPABILITIES (réutilisée, ZÉRO ajout).
- **i18n** : `assistant.*` (24 clés ×4 G8). `assistant.action.*` LIBRE (posées ici).
- **Migration** : seq 111 dernière (sitebuilder). seq 112 LIBRE — **mais NON
  utilisée** (zéro DDL, voir §1).

## §1 — PAS DE MIGRATION (zéro DDL — confirmé)

**AUCUN DDL n'est requis pour Sprint 11.** L'audit des actions exécutées réutilise
la colonne **`tool_calls` JSON existante** des `ai_chat_messages` (seq 91) : la
proposition d'action est tracée dans le message assistant qui la porte, et
l'exécution est journalisée par les handlers métier existants (activity_log /
webhooks task.created, déjà câblés). Les `proposed_actions` sont reconstruites
depuis `tool_calls` du thread pour valider l'`action_id`.

**Si Manager-B juge une table strictement nécessaire** (NON recommandé) → seq 112
`CREATE TABLE IF NOT EXISTS` manifestée (`depends_on:["migration-sitebuilder-seq111.sql"]`),
zéro FK/CHECK/ALTER. **PRÉFÉRER zéro DDL.**

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **INCHANGÉS**. Succès =
**`json({ data })`** ; erreur = **`json({ error }, status)`**. **JAMAIS de champ
`code`** — discrimination front string-match sur `error` / absence de `data`.

Helpers (FIGÉS Phase A — Phase C les CONSOMME tels quels, Phase B câble le corps
de la route `/action`) :

```ts
// MODIFIÉ (additif, rétro-compat) — 3ᵉ argument optionnel :
sendAiMessage(threadId: string, content: string, pageContext?: AiPageContext)
  : Promise<ApiResponse<{ message: AiChatMessage }>>
// body = { content } si pageContext absent (byte-identique v1),
//        { content, page_context } sinon. AUCUN client_id envoyé (FLAG #1).

// NOUVEAU :
confirmAiAction(threadId: string, actionId: string)
  : Promise<ApiResponse<{ executed: boolean; result?: string }>>
//  → apiFetch('/ai/chat/threads/'+threadId+'/action', {method:'POST', body:{action_id}})
```

### §6.B — Types (`src/lib/types.ts`, FIGÉS Phase A) — ApiResponse INCHANGÉ

```ts
// NOUVEAU — action sûre proposée (jamais auto-exécutée). args SANS champ tenant.
export interface AiProposedAction {
  id: string;
  tool: 'create_task' | 'update_lead_status' | 'add_lead_tag';
  args: Record<string, unknown>;
  label: string; // phrase de confirmation FR
}

// MODIFIÉ (additif) — AiChatMessage transporte les actions proposées du tour :
export interface AiChatMessage {
  id: string; role: 'user' | 'assistant'; content: string;
  tool_calls?: string; created_at: string;
  proposed_actions?: AiProposedAction[]; // additif, optionnel
}

// NOUVEAU — contexte de page courante (RE-VALIDÉ + RE-BORNÉ worker-side) :
export interface AiPageContext {
  route?: string; entity_type?: string; entity_id?: string;
}
```

### §6.C — Handlers MÉTIER EXISTANTS RÉUTILISÉS pour l'EXÉCUTION (CRUCIAL Manager-B — signatures EXACTES vérifiées dans le CODE)

L'exécution d'une action confirmée passe **TOUJOURS** par un handler métier
existant — **JAMAIS un nouveau chemin mutant, JAMAIS d'exécution dans la boucle
LLM**. Deux stratégies possibles (au choix de Manager-B, documenter le choix) :
(a) **appeler le handler HTTP existant** en lui passant une `Request` synthétique
(`new Request(url, { method, body })`) + l'`auth` courant ; ou (b) **factoriser
en réutilisant le même INSERT/UPDATE borné** que le handler (calque exact). Quelle
que soit la voie, le **`client_id` / l'ownership est RE-BORNÉ via `scopeClientId(auth)`**
et l'entité ciblée est RE-VALIDÉE appartenir au tenant courant.

```ts
// tasks.ts — création de tâche (lit le body via createTaskSchemaS3, retourne {data:{id}},201)
export async function handleCreateTask(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response>;
//  Body utile : { title (requis), description?, due_date?, priority?, status?,
//    lead_id?, client_id?, assigned_to?, ... }. created_by = auth.userId.
//  ⚠ created_task : `client_id` du body est utilisé tel quel par ce handler →
//    Manager-B DOIT le forcer à scopeClientId(auth) (jamais depuis le LLM/args).

// leads.ts — changement de statut (PATCH lead). ⚠ EXIGE auth.role 'admin' OU 'api'
//   ET capGuard('leads.write'). Valide status ∈ {new,contacted,qualified,won,closed,lost}.
//   Retourne {data:{...}}. Borné par leadId ; PAS de filtre client_id interne →
//   Manager-B RE-VALIDE que le lead appartient au tenant AVANT d'appeler.
export async function handlePatchLead(
  request: Request, env: Env,
  auth: { role: string; userId: string; clientId?: string }, leadId: string
): Promise<Response>;
//  Body utile pour update_lead_status : { status }.

// leads.ts — ajout d'étiquette. ⚠ EXIGE auth.role 'admin'. INSERT lead_tags
//   (tag.toLowerCase()) + activity_log 'tag_added'. ⚠ Retourne json({success:true})
//   (PAS {data}) — Manager-B NORMALISE en {data:{executed,result}} dans le
//   handler /action (ne PAS propager la forme {success} brute).
export async function handleAddTag(
  request: Request, env: Env, auth: { role: string; userId: string }, leadId: string
): Promise<Response>;
//  Body utile pour add_lead_tag : { tag }.
```

**Pièges d'intégration (Manager-B) :**
- `handlePatchLead` et `handleAddTag` exigent `auth.role === 'admin'` (+ `'api'`
  pour PATCH). Si l'utilisateur du Copilot n'est pas admin, l'action DOIT
  retourner `{ data: { executed:false, result } }` proprement (pas de 403 brut
  remonté à l'UI sans message). Documenter le comportement choisi.
- `create_task` accepte `client_id` dans le body → **le forcer** à
  `scopeClientId(auth)` (FLAG #1). Idem `lead_id` re-validé tenant.
- `handleAddTag` renvoie `{success:true}` ⇒ **normaliser** en
  `{ data: { executed:true, result } }` côté handler `/action`.

### §6.D — Format runChatLoop / tools « propose » (CRUCIAL Manager-B)

Le chat G8 (RÉUTILISÉ, ai-chat.ts) :
- **`TOOL_SCHEMAS: ToolSchema[]`** (ai-chat.ts:225-308) — schémas Anthropic
  tool-use, **AUCUN champ `client_id`/tenant exposé au LLM (FLAG #1)**. Format :
  `{ name, description, input_schema: { type:'object', properties, required? } }`.
- **`runChatLoop(env, auth, systemPrompt, history)`** : boucle tool-calling
  worker-side **MAX 3 tours** ; pour chaque `tool_use`, exécute `executeTool(env,
  auth, name, input)` puis pousse le `tool_result`. Collecte `toolCalls` (audit)
  + `tokensUsed`. Retour `{ text, toolCalls, tokensUsed }`.
- **`executeTool`** : dispatcher `switch(name)`. `client_id` TOUJOURS via
  `scopeClientId(auth)`, jamais des args.

**Mode « propose » des 3 tools action (Manager-B) :** ajouter `create_task`,
`update_lead_status`, `add_lead_tag` à `TOOL_SCHEMAS` (schémas SANS champ tenant)
et à `executeTool`. Le tool **N'EXÉCUTE RIEN** dans `runChatLoop` : il retourne
une **PROPOSITION** `{ tool, args, label }` (objet sérialisable). Le résultat du
tour (message assistant inséré par `handleSendAiMessage`) porte ces propositions
en **`proposed_actions`** (et en trace dans `tool_calls` JSON pour l'audit /
revalidation ultérieure de l'`action_id`). C'est l'unique source des actions que
le handler `/action` acceptera d'exécuter.

### §6.E — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

Nouvelle route PROTÉGÉE (capability `ai.use` appliquée DANS le handler). Placée
**AVANT** le `/:id` générique (anti-shadowing, calque l'ordre `/message` AVANT
`/:id`, worker.ts ~1964-1968) :

| Route | Méthode | Handler (`./worker/ai-chat`) |
|---|---|---|
| `/api/ai/chat/threads/:id/action` | POST | `handleConfirmAiAction(request, env, auth, threadId)` |

(Routes G8 existantes INCHANGÉES : `/threads` GET/POST, `/threads/:id/message`
POST, `/threads/:id` GET/DELETE.)

### §6.F — Handler confirmation (ai-chat.ts — owned Manager-B, stub posé Phase A)

`handleConfirmAiAction(request, env, auth, threadId)` — **signature/capGuard
FIGÉS Phase A** (stub `json({ data:{ executed:false } })` + `// Manager-B: corps
réel`). Corps réel Manager-B :
1. `capGuard('ai.use')` (déjà câblé) ;
2. Ownership thread `user_id = auth.userId` (404 sinon) ;
3. Lire `action_id` du body, le VALIDER contre les `proposed_actions`
   effectivement émises pour CE thread (reconstruites depuis `tool_calls` JSON
   des `ai_chat_messages`) — ne JAMAIS exécuter une action non proposée ;
4. RE-BORNER le tenant via `scopeClientId(auth)` UNIQUEMENT ; RE-VALIDER que
   l'entité (lead_id / task client_id) appartient au tenant courant ;
5. Exécuter via le handler MÉTIER EXISTANT (§6.C) — `create_task` / `update_lead_status`
   / `add_lead_tag` — actions SÛRES/réversibles uniquement (PAS d'email/SMS, PAS
   de DELETE) ;
6. Retour `json({ data: { executed, result? } })` (jamais `code`).

### §6.G — Contexte page + alertes proactives (Manager-B)

- **`page_context`** : `handleSendAiMessage` lit `body.page_context`
  (`{ route?, entity_type?, entity_id? }`) — **additif, optionnel**. RE-VALIDÉ
  + RE-BORNÉ tenant worker-side (ex : si `entity_type='lead'` + `entity_id`, ne
  confirmer/injecter que si le lead appartient à `scopeClientId(auth)` ; sinon
  ignorer silencieusement). Injecté dans le system prompt (calque
  `buildSystemPrompt` : ajouter une ligne « Page courante : … » DÉTERMINISTE).
  Le LLM ne reçoit JAMAIS de client_id.
- **`proactive_alerts`** : surfacer en **LECTURE SEULE** dans le résumé/contexte
  (calque `buildTenantSummary` — SELECT borné `client_id`, status != 'dismissed',
  best-effort try/catch). NE PAS muter les alertes depuis ai-chat.ts (les
  handlers seen/dismiss restent dans proactive-ai.ts, intouché).

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned : **`src/worker/ai-chat.ts` UNIQUEMENT** —
  (a) ajouter les 3 tools action en mode **« propose »** (le tool retourne une
  PROPOSITION `{ tool, args, label }`, n'exécute RIEN dans `runChatLoop` ; le LLM
  propose, le résultat de tour porte `proposed_actions`) ;
  (b) corps réel `handleConfirmAiAction` : valide l'`action_id` contre les
  propositions du thread, exécute via le handler MÉTIER EXISTANT (create_task /
  update_lead_status / add_lead_tag) avec `client_id` re-borné `scopeClientId(auth)`,
  retourne `{ executed, result }` ;
  (c) injecter le `page_context` (validé + re-borné) dans le system prompt ;
  (d) surfacer les `proactive_alerts` du tenant en LECTURE dans le résumé/contexte.
  + tests `__tests__/`.
- **Manager-C (frontend)** owned : **`src/components/assistant/AiChatThread.tsx`**
  + **`AiAssistantPanel.tsx`** (+ **`AppLayout.tsx`** pour passer le contexte de
  page + **`src/index.css`** pour le style des cartes d'action — **Manager-C est
  le SEUL à toucher `index.css` ce sprint**) :
  - UI carte d'action proposée (lit `message.proposed_actions`) avec bouton
    « Exécuter » → **confirmation HUMAINE** → `confirmAiAction(threadId, actionId)`
    → affichage du résultat (executing/executed/failed via `assistant.action.*`) ;
  - passer le contexte de page courante (route/entité) à l'envoi de message
    (`sendAiMessage(threadId, content, pageContext)`), pageContext dérivé de la
    route active dans `AppLayout` ;
  - (optionnel) afficher les alertes proactives dans le panneau.
- **INTERDITS aux deux** : migration (AUCUNE), manifest, **`src/lib/types.ts`**,
  **`src/lib/api.ts`**, **`src/worker.ts`**, **i18n ×4** (tous GELÉS Phase A),
  **`src/worker/ai.ts`**, **`src/worker/proactive-ai.ts`** (LECTURE SEULE),
  `ai_conversations`/`ai_messages` (seq 7). `ai-chat.ts` = **Manager-B** ;
  `components/assistant/*` + `AppLayout.tsx` + `index.css` = **Manager-C**.
  **Zéro fichier partagé B/C.** Les handlers métier `tasks.ts`/`leads.ts` sont
  RÉUTILISÉS par import/appel — **NON modifiés**.

### §6.I — Pièges (à relire AVANT de coder)

1. **PAS de DDL** — réutiliser `tool_calls` JSON (seq 91) pour l'audit/revalidation.
   Zéro migration recommandée (§1).
2. **`scopeClientId(auth)` OBLIGATOIRE** — `client_id` TOUJOURS depuis l'auth,
   JAMAIS du LLM/args/body. Schémas des 3 tools action SANS champ tenant. Le
   `page_context` du front est RE-VALIDÉ + RE-BORNÉ worker-side.
3. **Confirmation HUMAINE OBLIGATOIRE** — toute action mutante = proposée par le
   LLM → carte UI → clic « Exécuter » → `confirmAiAction` → exécution worker-side.
   JAMAIS d'exécution directe dans la boucle LLM (`runChatLoop`/`executeTool`).
4. **Actions SÛRES seulement** — `create_task`, `update_lead_status`,
   `add_lead_tag` (réversibles). PAS d'envoi email/SMS auto, PAS de DELETE.
5. **RÉUTILISER les handlers métier, pas dupliquer** — create_task (tasks.ts),
   update status / add tag (leads.ts). RE-BORNER tenant + RE-VALIDER l'entité.
   Attention : `handleAddTag` retourne `{success:true}` → NORMALISER en
   `{data:{executed,result}}` ; `handlePatchLead`/`handleAddTag` exigent role
   admin (`handlePatchLead` aussi `'api'`) — gérer le refus proprement.
6. **Ne PAS casser le chat G8** — `runChatLoop`/`callLLMChatTurn`/mock
   (`isAiChatMockMode`) préservés ; flag `ANTHROPIC_API_KEY` absent → mock propre,
   E4/E6 inactifs. Signatures des 5 handlers existants INCHANGÉES.
7. **Capability `ai.use` réutilisée** (capGuard existant) — ZÉRO ajout à
   ALL_CAPABILITIES.
8. **Alias relatifs worker** (`./...`, `../lib/...`), front `@/`.
9. **`/:id/action` AVANT `/:id`** — anti-shadowing (déjà câblé Phase A worker.ts).
10. **`proactive-ai.ts` LECTURE SEULE** — surfacer les alertes en lecture, ne
    JAMAIS muter depuis ai-chat.ts (seen/dismiss restent dans proactive-ai.ts).

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-22)

Fichiers **créés** :
1. `docs/LOT-COPILOT-V2.md` — ce document (§6 FIGÉ).

Fichiers **modifiés** (rigoureusement ADDITIFS) :
1. `src/lib/types.ts` — `AiProposedAction` + `AiPageContext` (NEUFS) ;
   `AiChatMessage.proposed_actions?` (additif optionnel). `ApiResponse` INCHANGÉ.
2. `src/lib/api.ts` — `sendAiMessage` étendu d'un 3ᵉ argument optionnel
   `pageContext?: AiPageContext` (rétro-compat : body byte-identique v1 si absent) ;
   `confirmAiAction(threadId, actionId)` NEUF (POST `/ai/chat/threads/:id/action`).
   Import `AiPageContext` ajouté. apiFetch/ApiResponse INCHANGÉS.
3. `src/worker.ts` — import `handleConfirmAiAction` + route POST
   `/api/ai/chat/threads/:id/action` câblée AVANT `/:id` générique (anti-shadowing).
4. `src/worker/ai-chat.ts` — **stub UNIQUEMENT** `handleConfirmAiAction(request,
   env, auth, threadId)` en fin de fichier (signature FIGÉE, capGuard `ai.use`,
   corps `json({data:{executed:false}})` + `// Manager-B: corps réel`). Zone A
   documentée en commentaire. Reste du fichier (chat G8) INTOUCHÉ.
5. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 9 clés `assistant.action.*`
   (`propose/confirm/cancel/executing/executed/failed/create_task/update_status/
   add_tag`) ×4, parité stricte (36 occurrences vérifiées), clés AVANT usage,
   fr-CA tutoiement / fr-FR vouvoiement.

**Migration** : AUCUNE (zéro DDL — réutilise `tool_calls` JSON seq 91, §1).

**Build** : non vérifié (VMware sans bun/node) — **build délégué côté hôte**.

### Confirmations garde-fous
- **PAS de migration / manifest** touchés (zéro DDL).
- **ApiResponse INCHANGÉ** (`{ data }` / `{ error }`, jamais `code`).
- **`ai-chat.ts`** : seul le stub `handleConfirmAiAction` ajouté en fin de fichier ;
  signatures des 5 handlers G8 + `scopeClientId`/`capGuard`/`runChatLoop`/tools
  PRÉSERVÉS verbatim.
- **`ai.ts`** / **`proactive-ai.ts`** / `ai_conversations`/`ai_messages` (seq 7) :
  INTOUCHÉS.
- **`ai.use`** réutilisée — ZÉRO ajout à ALL_CAPABILITIES.
- **FLAG #1 (cross-tenant)** : aucun helper front n'envoie de client_id ; le
  worker re-borne via `scopeClientId(auth)` ; schémas des 3 tools action SANS
  champ tenant (à respecter Manager-B) ; `page_context` re-validé worker-side.
- **FLAG #2 (actions)** : action mutante = proposée → confirmation humaine UI →
  exécution worker-side via handler métier existant. Actions limitées à 3
  opérations sûres/réversibles. PAS d'email/SMS/DELETE.

### Écarts CODE > brief
- `confirmAiAction` envoie `{ action_id }` (snake_case) dans le body conformément
  au contrat ; le helper expose `actionId` (camelCase) côté TS — calque les
  helpers existants.
- `sendAiMessage` : le `page_context` n'est ajouté au body QUE s'il est fourni
  (sérialisation conditionnelle) afin de garantir l'identité byte-à-byte avec les
  appels v1 existants (zéro régression sur le chat G8).
- §6.C documente que `handleAddTag` retourne `{success:true}` (pas `{data}`) et
  que `handlePatchLead`/`handleAddTag` exigent le rôle admin — points
  d'intégration cruciaux pour Manager-B (normalisation + gestion du refus).
