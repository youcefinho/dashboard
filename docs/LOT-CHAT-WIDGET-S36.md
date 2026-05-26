# LOT Live chat widget — Sprint 36

> Doc contrat §6 figé. Migration : seq131 — `migration-webchat-widget-s36-seq131.sql`.
> Compagnons : `EMBED-SECURITY-S36.md` (allowlist origin + Turnstile + CSP),
> `LOT-TEAM-BC.md` (capabilities figées seq80 — réutilisation `settings.manage`),
> `LOT-SNAPSHOTS-S35.md` (calque pattern handler + i18n + manifest).

## §1 Contexte

Le webchat **EXISTE DÉJÀ** dans Intralys (livré phase 15, seq25). Composants
en place :

- `src/worker/webchat.ts` — Durable Object `WebchatRoom` (WS bidirectionnel,
  typing, historique 50 msg, alarm cleanup 24h).
- `public/widget/v1.js` + `public/widget/frame.html` — iframe sandboxée
  visiteur.
- Routes publiques `/api/webchat/ws`, `/api/webchat/prechat`,
  `/api/webchat/widget.js` câblées dans `src/worker.ts` ~l.1067.
- Tables `webchat_widgets` + `webchat_sessions` (seq25, JAMAIS lues par le
  code actuel — c'est le vrai gap).

**Sprint 36 = ENRICHISSEMENT, PAS reconstruction**. On NE TOUCHE PAS au DO,
au widget v1.js, à frame.html. On ajoute le **SOCLE** :

1. Multi-tenant agency + branding (avatar, powered_by, position).
2. Sécurité embed : allowlist `allowed_origins` + Turnstile anti-bot
   (FAIL-OPEN si `TURNSTILE_SECRET` absent — calque idiome
   `helpers.sendSms:93-95`).
3. Rate-limit visitor (réutilise `src/worker/lib/rate-limit.ts` seq121).
4. Presence agent (heartbeat online|away|offline) → UI inbox.
5. Contexte session enrichi (`page_url`, `referrer`, `user_agent`, `ip_hash`
   SHA-256 — JAMAIS IP brute, Loi 25/RGPD).
6. UI dashboard (Phase C frontend) : liste widgets, snippet copy, sessions
   history, preview live.

## §2 Migrations — seq131 (DDL résumé)

Fichier racine : `migration-webchat-widget-s36-seq131.sql`. Manifest entrée
seq131 (`docs/migrations-manifest.json`), `depends_on:
["migration-snapshots-seq130.sql", "migration-phase15.sql"]` (chaînage strict
sur la dernière migration LOT 3 + table-source seq25).

100 % ADDITIF, zéro CHECK / FK / ALTER destructeur / DROP / RENAME :

- 10 `ALTER TABLE webchat_widgets ADD COLUMN` : agency_id, name,
  allowed_origins (JSON-array), position (enum HANDLER, DEFAULT
  `bottom-right`), offline_message, bot_initial_replies_json,
  avatar_url, show_powered_by, updated_at, turnstile_enabled.
- 8 `ALTER TABLE webchat_sessions ADD COLUMN` : conversation_id, page_url,
  referrer, user_agent, ip_hash (SHA-256), last_seen_at, agent_user_id,
  unread_agent_count.
- `CREATE TABLE IF NOT EXISTS webchat_agent_presence` (id PK, user_id,
  client_id, status enum HANDLER `online|away|offline` DEFAULT `'offline'`,
  last_heartbeat_at).
- 5 indexes : `idx_webchat_widgets_client`, `idx_webchat_widgets_agency`,
  `idx_webchat_sessions_conv`, `idx_webchat_sessions_started`,
  `idx_webchat_presence_user_client` (UNIQUE).

Validation enums (`position`, `status`) faite SIDE-HANDLER
(`chat-widgets.ts`) — calque LOT-SNAPSHOTS-S35 §6 (pas de CHECK = pas de
rebuild SQLite jamais).

## §3 Routes (9 AUTHED + 0 PUBLIC nouvelles Phase A)

Toutes câblées dans `src/worker.ts` à l'intérieur du bloc `routeProtected`,
APRÈS le bloc snapshots Sprint 35 (~l.2703), AVANT le bloc Sprint 23
sécurité/conformité (~l.2705). Garde `requireAuth` au choke-point + garde
capability **`settings.manage`** (FIGÉE seq80) appliquée DANS chaque handler.

ORDRE ANTI-SHADOWING strict : `/sessions/:id` (le + spécifique) AVANT
`/sessions` AVANT `/:id` AVANT collection AVANT presence (préfixe distinct).

| Méthode | Chemin                                          | Handler                          | Fichier            |
|--------:|-------------------------------------------------|----------------------------------|--------------------|
| GET     | `/api/chat-widgets/:widgetId/sessions/:sessionId` | `handleGetChatSessionDetail`     | chat-widgets.ts    |
| GET     | `/api/chat-widgets/:widgetId/sessions`          | `handleListChatSessions`         | chat-widgets.ts    |
| GET     | `/api/chat-widgets/:id`                         | `handleGetChatWidget`            | chat-widgets.ts    |
| PATCH   | `/api/chat-widgets/:id`                         | `handleUpdateChatWidget`         | chat-widgets.ts    |
| DELETE  | `/api/chat-widgets/:id`                         | `handleDeleteChatWidget`         | chat-widgets.ts    |
| GET     | `/api/chat-widgets`                             | `handleListChatWidgets`          | chat-widgets.ts    |
| POST    | `/api/chat-widgets`                             | `handleCreateChatWidget`         | chat-widgets.ts    |
| POST    | `/api/chat-presence/heartbeat`                  | `handleChatPresenceHeartbeat`    | chat-widgets.ts    |
| GET     | `/api/chat-presence/active`                     | `handleGetActivePresence`        | chat-widgets.ts    |

Réponses normalisées **`{ data }`** / **`{ error }`** (PAS de champ
`code` — contrat GELÉ docs/LOT-TEAM-BC.md §6.A). Statut HTTP transporté
par le 2e arg de `json()`. Phase A renvoie `501` partout
(`Phase B not yet implemented`) pour câbler la matrice routes/handlers sans
casser le worker — calque snapshots Phase A.

**Routes publiques /api/webchat/\* INCHANGÉES** (déjà câblées ~l.1067) :
`/ws`, `/prechat`, `/widget.js` continuent de fonctionner tel quel via le
DO existant. Sprint 36 Phase B ajoutera optionnellement
`/api/chat-session/start|message|poll` (handlers stubs déjà créés dans
`chat-session.ts` Phase A, à câbler Phase B uniquement).

## §4 Handlers (signatures FIGÉES Phase A — Phase B Manager-B remplit)

### `src/worker/chat-widgets.ts` (9 handlers AUTHED)

```ts
export async function handleListChatWidgets(env: Env, auth: ChatWidgetsAuth): Promise<Response>
export async function handleCreateChatWidget(request: Request, env: Env, auth: ChatWidgetsAuth): Promise<Response>
export async function handleGetChatWidget(env: Env, auth: ChatWidgetsAuth, id: string): Promise<Response>
export async function handleUpdateChatWidget(request: Request, env: Env, auth: ChatWidgetsAuth, id: string): Promise<Response>
export async function handleDeleteChatWidget(env: Env, auth: ChatWidgetsAuth, id: string): Promise<Response>
export async function handleListChatSessions(env: Env, auth: ChatWidgetsAuth, widgetId: string, url: URL): Promise<Response>
export async function handleGetChatSessionDetail(env: Env, auth: ChatWidgetsAuth, widgetId: string, sessionId: string): Promise<Response>
export async function handleChatPresenceHeartbeat(request: Request, env: Env, auth: ChatWidgetsAuth): Promise<Response>
export async function handleGetActivePresence(env: Env, auth: ChatWidgetsAuth): Promise<Response>
```

### `src/worker/chat-session.ts` (3 handlers PUBLIC, Phase B câble)

```ts
export async function handlePublicChatStart(request: Request, env: Env): Promise<Response>
export async function handlePublicChatMessage(request: Request, env: Env): Promise<Response>
export async function handlePublicChatPoll(request: Request, env: Env, url: URL): Promise<Response>
```

### `src/worker/lib/chat-origin-check.ts` (3 helpers, Phase A déjà fonctionnels minimum-safe)

```ts
export function validateChatOrigin(allowedOrigins: string[] | null, origin: string | null): boolean
export async function sha256Ip(ip: string): Promise<string>  // ← prêt prod Phase A
export async function verifyTurnstile(env: Env, token: string | null, ip?: string): Promise<boolean>  // ← FAIL-OPEN si secret absent
```

### `src/worker/lib/chat-session-do.ts` (5 helpers stubs Phase A)

```ts
export async function persistSessionStart(env: Env, widgetId: string, visitorData: VisitorContext): Promise<{ sessionId: string; conversationId: string }>
export async function markSessionEnd(env: Env, sessionId: string): Promise<void>
export async function getActiveSessionForConversation(env: Env, convId: string): Promise<ChatSession | null>
export async function notifyAgentPresence(env: Env, widgetId: string, status: 'online' | 'away' | 'offline'): Promise<void>
export async function broadcastTyping(env: Env, conversationId: string, sender: 'visitor' | 'agent'): Promise<void>
```

## §5 Types `src/lib/api.ts` (FIGÉS Phase A)

```ts
export type ChatWidgetPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
export type ChatAgentPresenceStatus = 'online' | 'away' | 'offline'
export type ChatSessionStatus = 'active' | 'closed' | 'offline_form'

export interface ChatWidget        // 18 champs (cf. fichier api.ts)
export interface ChatSession       // 15 champs
export interface ChatAgentPresence // 4 champs
export interface ChatWidgetInput   // 12 champs optionnels (PATCH)
export interface ChatSessionFilters // status, from, to, limit, cursor
export interface ChatSessionDetail extends ChatSession { messages: [...] }
```

Helpers async exportés :

- `getChatWidgets()`, `createChatWidget(input)`, `updateChatWidget(id, input)`,
  `deleteChatWidget(id)`
- `getChatWidgetSessions(widgetId, filters?)`, `getChatSessionDetail(widgetId, sessionId)`
- `postChatPresenceHeartbeat(status)`, `getChatPresenceActive()`

## §6 Contrat inter-agent FIGÉ — Phase B B/C ne peuvent PAS modifier

1. **Migrations** : seq131 verrou. Aucun champ supplémentaire en Phase B sans
   nouvelle seq (132+). Aucun CHECK ajouté (rebuild SQLite interdit).
2. **Routes** : 9 chemins/méthodes AUTHED figés (§3). Aucun renommage. L'ordre
   anti-shadowing dans `worker.ts` est invariant. Routes publiques
   `/api/webchat/*` INCHANGÉES.
3. **Capabilities** : `settings.manage` (seq80) uniquement. AUCUN ajout à
   `ALL_CAPABILITIES`.
4. **Contrat réponses** : `json({ data })` succès / `json({ error }, status)`
   erreur. PAS de champ `code`. PAS de wrapping supplémentaire.
5. **Types `src/lib/api.ts`** : noms et signatures FIGÉS (§5). Manager-C peut
   ajouter des `interface` supplémentaires côté front s'il les expose, mais
   ne renomme PAS les exports listés.
6. **Bornage tenant** : `WHERE client_id = ?` dans tout SELECT/UPDATE/DELETE
   widgets et sessions (defense-in-depth IDOR sur `:id`). `resolveClientId()`
   via `getClientModules(env, auth.userId)` — calque snapshots.ts:57.
7. **Pas de modification du DO** `src/worker/webchat.ts`, du widget
   `public/widget/v1.js`, de l'iframe `public/widget/frame.html`. Si Phase B
   a besoin d'un signal vers le DO (typing, presence), passer par
   `broadcastTyping()` qui appelle le DO via `env.WEBCHAT_ROOMS.idFromName()`
   + `room.fetch()`.
8. **Sécurité Loi 25 / RGPD** : `ip_hash` SHA-256 obligatoire (helper
   `sha256Ip()` fourni). JAMAIS l'IP brute en base.
9. **Turnstile FAIL-OPEN** : `TURNSTILE_SECRET` absent ⇒ `verifyTurnstile()`
   retourne `true`. Activé uniquement si secret bindé ET
   `widget.turnstile_enabled=1`.
10. **i18n** : 29 clés ajoutées dans 4 catalogues (`fr-CA`, `fr-FR`, `en`,
    `es`), parité STRICTE. Manager-C ne change PAS le nom des clés.

## §7 Découpe Phase B (Manager-B backend ∥ Manager-C frontend)

- **Manager-B** : remplit les 9 handlers AUTHED + 3 publics + 5 helpers DO
  + branche Turnstile réel (POST siteverify) + rate-limit visitor par
  `ip_hash` + `validateChatOrigin` durci (wildcard sous-domaine).
- **Manager-C** : page `/settings/chat-widgets` (liste + form CRUD + snippet
  copy + preview iframe), inbox extension presence-aware, intégration des
  29 clés i18n. ZÉRO fichier partagé avec B (api.ts est en lecture pour C).

## §8 Doc compagnon — `EMBED-SECURITY-S36.md`

**Complété Phase B Manager-C4** ([`EMBED-SECURITY-S36.md`](EMBED-SECURITY-S36.md)). Couvre 10 sections :

1. Modèle de menace (9 threats × 5 surfaces).
2. 7 couches de défense (matrice mécanisme → implémentation).
3. Validation Origin détaillée (`validateChatOrigin()` exact-match + wildcard sous-domaine Phase B).
4. Rate-limit + IP hashing SHA-256 (Loi 25 / RGPD).
5. Turnstile (FAIL-OPEN si secret absent, FAIL-CLOSED si secret + token invalide).
6. iframe sandbox (`allow-scripts allow-same-origin allow-forms`) + postMessage strict origin check.
7. Prévention XSS (`textContent` only, CSP frame-v2.html).
8. RGPD / Loi 25 Québec (rétention, droits d'accès et oubli, consent banner).
9. Headers HTTP recommandés par endpoint.
10. Checklist de déploiement (15 items à valider avant prod).

Patterns Phase B confirmés : `handlePublicChatStart` enchaîne honeypot → rate-limit
IP-hash → widget lookup → `validateChatOrigin` → `verifyTurnstile` → `persistSessionStart`
(cf. [`src/worker/chat-session.ts`](../src/worker/chat-session.ts):31-136). 9 handlers admin
AUTHED dans [`src/worker/chat-widgets.ts`](../src/worker/chat-widgets.ts) (5 CRUD widgets + 2
sessions + 2 presence) avec `requireCapability('settings.manage')` au top de chaque handler
+ `WHERE client_id = ?` partout (bornage tenant defense-in-depth IDOR).
