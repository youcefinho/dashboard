# LOT B — Complétude fonctionnelle (S-B2 recherche globale + intégrations)

> Doc additif. Phase A SOLO (Manager A) : contrats figés transmis VERBATIM aux
> Managers B/C en Phase B. Le **§6 ci-dessous est la source de vérité**.
>
> Statut : contrats ARRÊTÉS. Tests écrits NON exécutés (VM VMware).
> Décision migration : **AUCUNE migration** (voir §6.2). 100 % additif via
> `LIKE` sur les index S9 (seq 77) existants — zéro risque FTS5/D1.

## 1. Périmètre livré (Manager A, Phase A)

| Fichier | Type | Résumé |
|---|---|---|
| `src/worker/search.ts` | NOUVEAU | `handleGlobalSearch(env, auth, url)` — recherche cross-entités leads/clients/tasks/conversations, multi-tenant strict, LIKE sur index S9. |
| `src/worker.ts` | MODIF chirurgicale | import `handleGlobalSearch` + 1 dispatch `GET /api/search` en zone authentifiée (après `/api/dashboard/stats`). |
| `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` | APPEND | 9 clés `search.*`/`export.*` après `'action.export'`, parité stricte 4 catalogues. |
| `src/worker/__tests__/search-lotB.test.ts` | NOUVEAU | q<2 / isolation tenant / whitelist types / LIMIT borné / forme réponse. |
| `docs/LOT-B.md` | NOUVEAU | présent doc + §6 figé. |
| Migration | AUCUNE | justifié §6.2. |

**Colonnes/routes réelles vérifiées (grep source) :**

- `leads` (`schema.sql:35-68`) : `id, client_id, name, email, phone, status, deleted_at, created_at`.
- `clients` (`schema.sql:19-32`) : `id, name, email, phone, city, created_at`.
- `tasks` (`migration-phase5.sql:35-48`) : `id, title, description, status, client_id, created_at`.
- `conversations` (`migration-sprint3.sql:5-21`) : `id, subject, channel, status, last_message_preview, client_id, created_at`.
- Routes front (`src/App.tsx`) : `/leads/$leadId` (194), `/clients/$clientId` (182 → convention CommandPalette `/clients/<id>/leads` réutilisée), `/tasks` (573), `/conversations` (504).
- Pattern multi-tenant : `messages.ts:194-200` (résoudre `client_id` via `SELECT client_id FROM users WHERE id=?` si `role!=='admin'`).

---

## §6 Contrats figés (transmis VERBATIM B/C)

### 6.1 `handleGlobalSearch` — signature & contrat exact

**Fichier :** `src/worker/search.ts`.
**Signature :** `export async function handleGlobalSearch(env: Env, auth: { userId: string; role: string }, url: URL): Promise<Response>`.

**Query params :**

| Param | Règle |
|---|---|
| `q` | string. `q.trim().length < 2` → `{ data:{ results:[], total:0 } }` immédiat (200, **pas d'erreur**, aucune query SQL). |
| `limit` | entier `[1..50]`, défaut `20`, clampé (hors borne/NaN → clamp). Appliqué **par type**. |
| `types` | CSV optionnel parmi `leads,clients,tasks,conversations`. Valeurs invalides ignorées ; si rien de valide → tous les types. Défaut : tous. |

**Multi-tenant STRICT** (pattern `messages.ts:194-200`) : si `auth.role !== 'admin'`,
`SELECT client_id FROM users WHERE id = ?` (`auth.userId`) ; le `client_id`
résolu filtre **CHAQUE** entité (`leads.client_id`, `tasks.client_id`,
`conversations.client_id`, `clients.id`). Non-admin sans `client_id` → sentinelle
`'__no_tenant__'` (aucune fuite cross-tenant). Admin → aucun filtre (tout).

**Recherche par entité (LIKE `%q%`, index S9) :**

- `leads` : `name|email|phone LIKE ?`, `WHERE deleted_at IS NULL`.
- `clients` : `name|email|phone|city LIKE ?`.
- `tasks` : `title|description LIKE ?`.
- `conversations` : `subject|last_message_preview LIKE ?`.

Chaque requête : `ORDER BY created_at DESC LIMIT ?` (le `limit` clampé). Pas de N+1.

**Forme de réponse (rétro-compat — le front lit `data`) :**

```json
{ "data": { "results": [ { "type": "lead", "id": "...", "title": "...", "subtitle": "...", "url": "/leads/..." } ], "total": 1 } }
```

`type` ∈ `lead|client|task|conversation`. `url` :
`lead → /leads/<id>`, `client → /clients/<id>/leads`, `task → /tasks`,
`conversation → /conversations`. `total` = `results.length`.

**Format erreur (le front lit `data.error` string brute) :**

```json
{ "error": "Erreur lors de la recherche. Réessaie plus tard.", "code": "SEARCH" }
```

Status `500`. JAMAIS `{error:{...}}` objet.

### 6.2 Route `GET /api/search` + décision migration

**Route :** `GET /api/search` — **AUTHENTIFIÉE**, dispatch `src/worker.ts`
dans `routeProtected` juste après `/api/dashboard/stats` :

```ts
if (path === '/api/search' && method === 'GET') return handleGlobalSearch(env, auth, url);
```

`auth` est déjà résolu par `routeProtected` (même `auth` que les routes voisines).

**Décision migration : AUCUNE.** Justification : la recherche s'appuie sur
`LIKE '%'||?||'%'` couvert par les index S9 seq 77 (`idx_leads_client_id`,
`idx_leads_client_created`, `idx_tasks_client_id`, etc.). Un index FTS5 sur D1
serait non-additif et risqué ; `LIKE` sur volumes PME est suffisant et 100 %
sans risque. Prochaine seq libre = 78 (non utilisée par LOT B Phase A).

### 6.3 INSTRUCTION Manager B — SMS réel non-mock (`messages.ts:132-142`)

**Fichier EXCLUSIF Manager B : `src/worker/messages.ts`.**

Dans `handleSendMessage`, branche `channel === 'sms'`, sous-branche **non-mock**
(`messages.ts:140-142`, le `else { status = 'sent'; }` no-op) : remplacer le
no-op par un appel `sendSms` réel.

- `sendSms` est **déjà importé** (`messages.ts:4`).
- Signature (`helpers.ts:90-123`) : `sendSms(env, to, body) => Promise<{ success: boolean; sid?: string; error?: string }>`.
- Remplacement (verbatim cible) :

```ts
} else {
  const r = await sendSms(env, lead.phone as string, messageBody);
  status = r.success ? 'sent' : 'failed';
  externalId = r.sid || '';
}
```

- 🚫 **NE PAS toucher** la branche mock `messages.ts:133-139`
  (`env.USE_MOCKS === 'true'` → `mockSendSms`, `status='mock-sent'`).
- Préserver TOUT le reste : insert `messages`, `activity_log`, conversation
  (`findOrCreateConversation`), notifications — INTOUCHÉS.
- `lead.phone` / `messageBody` existent déjà dans le scope (`messages.ts:46-61`).

### 6.4 INSTRUCTION Manager C — export configurable + front search

**Fichiers EXCLUSIFS Manager C : `src/worker/exports-extra.ts` (NOUVEAU),
`src/worker.ts` (1 dispatch — coordonner zone admin, Manager A ne touche QUE
`/api/search`), `src/components/CommandPalette.tsx`, `src/lib/api.ts`.**

(a) **`src/worker/exports-extra.ts`** NOUVEAU :
`export async function handleConfigurableExport(env: Env, auth: { role: string }, url: URL): Promise<Response>`.

- `?entity=` ∈ `leads|orders|conversations` (whitelist stricte ; autre → 400).
- `?columns=` CSV — **whitelist par entité** (rejeter toute colonne hors liste,
  jamais d'interpolation de nom de colonne brut côté SQL — construire la liste
  SELECT depuis la whitelist uniquement).
- **Admin-only** : `if (auth.role !== 'admin') return json({ error: 'Accès réservé aux administrateurs' }, 403);`
  (copie EXACTE de `leads.ts:701`).
- Escaping CSV identique `leads.ts:725` : `\`"${String(v ?? '').replace(/"/g, '""')}"\``.
- Réponse : `new Response(csv, { status:200, headers:{ 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':\`attachment; filename="..."\`, ...corsHeaders() } })`.
- Erreurs : `{ error:<string FR>, code:'EXPORT' }`.
- Dispatch dans `src/worker.ts` zone authentifiée admin (près de
  `/api/leads/export` `worker.ts:658`) — route distincte ex.
  `GET /api/exports/configurable`.

(b) **Front `CommandPalette.tsx`** : consommer `/api/search` au lieu de charger
tous les leads/clients client-side. Nouvelle fn `src/lib/api.ts` :
`globalSearch(q: string, opts?: { limit?: number; types?: string[] }): Promise<ApiResponse<{ results: SearchResult[]; total: number }>>`
(lit `.data`, rétro-compat ; ne JAMAIS toucher le fallback `api.ts` mock gated).
Appel **debounced ≥ 250 ms**, déclenché seulement si `q.trim().length >= 2`,
**fallback local conservé** (si l'appel échoue ou hors-ligne → comportement
client-side actuel préservé, jamais de régression). Le `SearchResult` côté front
mappe sur le contrat §6.1 (`{ type, id, title, subtitle, url }`).

(c) **i18n** : utiliser les clés `search.*` créées par Manager A (§6.5) — NE PAS
les recréer ni renommer. Placeholder = `t('search.placeholder')`, état vide =
`t('search.no_results')`, chargement = `t('search.searching')`, libellés de
section = `t('search.section_leads'|'search.section_clients'|'search.section_tasks'|'search.section_conversations')`.

### 6.5 Clés i18n FIGÉES (créées par Manager A, parité 4 catalogues)

Ajoutées après `'action.export'` dans `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` :

| Clé | fr-CA |
|---|---|
| `search.placeholder` | Rechercher des leads, clients, tâches, conversations… |
| `search.no_results` | Aucun résultat |
| `search.searching` | Recherche en cours… |
| `search.section_leads` | Leads |
| `search.section_clients` | Clients |
| `search.section_tasks` | Tâches |
| `search.section_conversations` | Conversations |
| `export.columns_label` | Colonnes à exporter |
| `export.download` | Télécharger |

Parité stricte fr-FR/en/es livrée. 🚫 Aucun Manager B/C ne supprime/renomme
une clé i18n — AJOUT uniquement, parité 4 catalogues obligatoire.

### 6.6 Interdits (rappel B/C — non négociable)

- 🚫 Écriture interdite : `src/pages/{Leads,Dashboard,LeadDetail,Tasks,Pipeline,Clients}.tsx`.
- 🚫 Aucune clé i18n sous `leads.*/dashboard.*/tasks.*/pipeline.*/clients.*/leadDetail.*` ; aucune clé supprimée/renommée.
- 🚫 Helpers figés intouchés : `schemas.ts`+`validate()`, `validate-response.ts`,
  `error-response.ts`, `logger.ts`, `audit()`, `secret-store.ts`, `webVitals.ts`,
  `telemetry.ts`, `migrate.ts`, `_helpers.ts`, mock D1, fallback `api.ts`,
  `mockData.ts`.
- 🚫 E4/E6 paiement (`stripe-provider*`, `ecommerce-payments/refunds/disputes*`,
  `payments_live_enabled`), `ecommerce-channel-*.ts`, migrations 1-77,
  `wrangler.jsonc` : INTOUCHÉS.
- 🚫 Manager B ne touche QUE `messages.ts` (branche non-mock SMS).
  Manager C ne touche QUE `exports-extra.ts` / `CommandPalette.tsx` / `api.ts` /
  son dispatch `worker.ts` admin. `search.ts` + dispatch `/api/search` =
  Manager A figé, NE PAS réécrire.
- Le front lit `data.error` string brute → erreurs `{ error:<string>, code:<string> }`,
  jamais objet.

---

## 7. Activation (Rochdi — VM, rien joué ici)

1. `bun run build` — 0 erreur TS (nouveau `search.ts`, modifs `worker.ts`, 4 i18n).
2. `bun run test src/worker/__tests__/search-lotB.test.ts` (écrits, non exécutés).
3. Aucune migration à jouer (LOT B Phase A 100 % additif code, index S9 seq 77 suffisent).
4. Post-deploy : `GET /api/search?q=ab` authentifié → `{ data:{ results, total } }` ;
   `GET /api/search?q=a` → `{ data:{ results:[], total:0 } }` ;
   non-admin → résultats filtrés sur son `client_id` uniquement (non-régression Loi 25/RGPD).
