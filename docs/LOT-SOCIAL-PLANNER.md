# LOT SOCIAL PLANNER — rails complets, publication mock (Sprint 9 : composer texte + média + sélection réseaux + prévisualisation → file planifiée → cron de publication MOCK → génération IA de posts → connexions sociales flag-INACTIF)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-REPUTATION.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE, jamais le brief).

Sprint resserré, **100% ADDITIF**. Le module Social planner est **ENTIÈREMENT
ABSENT** (aucun module social/publish). MAIS les rails existent et sont **à
CALQUER** :
- `src/worker/oauth.ts` : OAuth tenant-borné + flag INACTIF (`providerCredentials`
  → null ⇒ authorize 400 propre, callback no-op) + `encryptToken`/`decryptToken`.
- `src/worker/broadcast.ts:runDueScheduledBroadcasts` (~474) : due-processor d'une
  file planifiée (SELECT `scheduled_at <= now AND status='queued' LIMIT 50`,
  verrou idempotence, best-effort).
- `src/worker.ts` `scheduled()` : cron best-effort (`ctx.waitUntil(import(...).
  then(m=>m.fn(env)).then(()=>undefined).catch(()=>undefined))`).
- `src/worker/reviews.ts:handleSuggestReviewReply` (~222) : client Claude (garde
  `ANTHROPIC_API_KEY`, fetch `api.anthropic.com/v1/messages`).
- `src/worker/whatsapp.ts:sendWhatsAppTemplate` (~188) : pattern mock
  `{ success:false, mock:true }` SANS appel réseau si credentials absents.

**Objectif :** composer + calendrier + file + cron de publication MOCK + IA posts
+ connexions sociales flag-INACTIF.

Architecture figée (NE PAS réinventer) :
- Migration seq **110** = STRICTEMENT ADDITIVE : 2 tables neuves (`social_accounts`,
  `social_posts`) en `CREATE TABLE IF NOT EXISTS` + 2 index de lecture
  (`idx_social_posts_due`, `idx_social_accounts_client`). **AUCUN ADD COLUMN**
  (préféré `CREATE TABLE IF NOT EXISTS`, idempotent — ADD COLUMN n'est PAS
  idempotent sur D1). **Zéro CHECK** (status/provider applicatifs sans CHECK,
  calque seq 109). Zéro FK/DROP/RENAME/rebuild.
- **CHECK / tables existants INTOUCHABLES.** Liens `client_id`/`agency_id`/
  `created_by` **APPLICATIFS** (zéro FK).
- Routes PRO = capabilities **EXISTANTES** réutilisées (`workflows.manage` posts/
  file, `ai.use` génération, `settings.manage` connexions). **ZÉRO ajout à
  `ALL_CAPABILITIES`.**
- **Publication sociale RÉELLE + analytics = MOCK / flag INACTIF IMPÉRATIF** :
  sans credentials OAuth social → `connect` renvoie `json({error},400)` propre,
  `callback` no-op, `publishToNetwork` renvoie `{success:false, mock:true}` SANS
  fetch (calque `sendWhatsAppTemplate`). E4/E6 inactifs.
- NE PAS casser : `calendar.ts`/`Calendar.tsx` (RDV — rien à voir), `community.ts`
  (forum), le cron broadcasts/reminders/RFM (Phase A n'ajoute QU'un `waitUntil`
  `.catch`). `oauth.ts`/`broadcast.ts`/`reviews.ts`/`whatsapp.ts` = réutilisés par
  LECTURE/IMPORT, **JAMAIS modifiés**.
- Alias : imports worker **RELATIFS** (`./worker/...`, `../lib/...`), JAMAIS `@/`.
  Front `@/`.

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` (`src/lib/types.ts`) **GELÉS**.
- Succès = **`json({ data })`** ; erreur = **`json({ error }, status)`**.
  **JAMAIS de champ `code`** — discrimination front string-match sur `error` /
  absence de `data`.
- Tous les helpers Social sont **PRO** (`apiFetch` — token admin, capability
  worker). Aucun helper public ce sprint.

Helpers ADDITIFS posés Phase A dans `src/lib/api.ts` — **FIGÉS**, signatures
EXACTES (Phase C les CONSOMME tels quels, Phase B câble les corps des routes) :

```ts
getSocialAccounts(): ApiResponse<SocialAccount[]>
connectSocialAccount(provider: SocialProvider): ApiResponse<{ url: string }>      // URL OAuth ou erreur flag-inactif (400)
disconnectSocialAccount(id): ApiResponse<{ deleted: boolean }>
getSocialPosts(params?: { status?: string }): ApiResponse<SocialPost[]>
createSocialPost(payload: { content; media?; networks?; scheduled_at? }): ApiResponse<SocialPost>
updateSocialPost(id, payload: Partial<{ content; media; networks; scheduled_at; status }>): ApiResponse<SocialPost>
deleteSocialPost(id): ApiResponse<{ deleted: boolean }>
scheduleSocialPost(id, scheduled_at): ApiResponse<SocialPost>
generateSocialPost(payload: { prompt; network? }): ApiResponse<{ content: string }>
```

### §6.B — Types (`src/lib/types.ts`, FIGÉS Phase A)

- `SocialProvider` = `'facebook' | 'instagram' | 'linkedin' | 'google_business'`
  (valeur APPLICATIVE, PAS de CHECK en base).
- `SocialAccount` (id, client_id?, agency_id?, provider, account_name?,
  account_external_id?, status?, scopes?, expires_at?, created_at?, updated_at?).
  **Tokens JAMAIS exposés au front** (projection serveur sans `access_token`/
  `refresh_token` — calque `oauth.ts:handleListOauthConnections`).
- `SocialPost` (id, client_id?, **content**, **media: string[]**, **networks:
  SocialProvider[]**, **scheduled_at?**, **status**, **published_at?**, **error?**,
  created_by?, created_at?, updated_at?). `media`/`networks` sérialisés
  `media_json`/`networks_json` en base ; status applicatif
  `draft|queued|processing|published|failed` (SANS CHECK).

### §6.C — Patterns RÉUTILISÉS (CRUCIAL Manager-B — vérifiés dans le CODE)

1. **`publishToNetwork` MOCK** = calque EXACT `whatsapp.ts:sendWhatsAppTemplate`
   l.188 : `if (!credentials) return { success:false, mock:true, error:'…' };`
   **SANS appel réseau**. (`socialProviderCredentials(env, provider)` renvoie
   `null` ce sprint ⇒ toujours mock.)
2. **`processDueSocialPosts` cron** = calque EXACT
   `broadcast.ts:runDueScheduledBroadcasts` l.474 :
   ```sql
   SELECT id, client_id, content, media_json, networks_json
   FROM social_posts
   WHERE scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')
     AND status = 'queued'
   ORDER BY scheduled_at ASC LIMIT 50
   ```
   puis, par post : `UPDATE … status='processing' WHERE id=? AND status='queued'`
   (verrou idempotence) → `publishToNetwork` MOCK par réseau de `networks_json` →
   `UPDATE … status='published'` (ou `'failed'`, `error=…`) `+ published_at=
   datetime('now')`. **try/catch par post ; jamais throw** (best-effort, le
   worker.ts l'appelle en `.catch(()=>undefined)`).
3. **Connexions OAuth flag-INACTIF** = calque EXACT `oauth.ts` :
   `socialProviderCredentials(env, provider)` (calque `providerCredentials` l.74)
   → `null` ⇒ `connect` renvoie `json({ error:'Intégration sociale non
   configurée' }, 400)` (PAS 500, calque l.233-236) ; tokens chiffrés via
   `encryptToken`/`decryptToken` (signature : `encryptToken(plaintext: string,
   env: Env): Promise<string>` ; `decryptToken(ciphertextB64: string, env: Env):
   Promise<string>` — `src/worker/migration-ghl-oauth.ts`) ; state CSRF via
   `env.STATE_STORE` (KV, TTL 600s, le state porte le tenant — JAMAIS le body).
4. **Génération IA** = calque EXACT `reviews.ts:handleSuggestReviewReply` l.222 :
   garde `if (!env.ANTHROPIC_API_KEY) return json({ error:'Clé API Anthropic non
   configurée' }, 500);` → `fetch('https://api.anthropic.com/v1/messages', {
   method:'POST', headers:{ 'x-api-key': env.ANTHROPIC_API_KEY,
   'anthropic-version':'2023-06-01', 'Content-Type':'application/json' }, body:…
   model:'claude-haiku-4-5-20250401' })` → `result.content?.[0]?.text` →
   `json({ data: { content } })`. try/catch best-effort.

### §6.D — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

**PROTÉGÉES** (capability EXISTANTE appliquée DANS le handler via `capGuard` =
`requireCapability(auth.capabilities, …)`). Bloc `/api/social/*` neuf, AVANT
`// Reviews`. Ordre anti-shadowing : `/generate`, `/accounts*`, `/posts`,
`/posts/:id/schedule` AVANT `/posts/:id` générique.

| Route | Méthode | Handler | Capability |
|---|---|---|---|
| `/api/social/posts` | GET | `handleListSocialPosts(request, env, auth, url)` | `workflows.manage` |
| `/api/social/posts` | POST | `handleCreateSocialPost(request, env, auth)` | `workflows.manage` |
| `/api/social/posts/:id` | PATCH | `handleUpdateSocialPost(request, env, auth, id)` | `workflows.manage` |
| `/api/social/posts/:id` | DELETE | `handleDeleteSocialPost(request, env, auth, id)` | `workflows.manage` |
| `/api/social/posts/:id/schedule` | POST | `handleScheduleSocialPost(request, env, auth, id)` | `workflows.manage` |
| `/api/social/accounts` | GET | `handleListSocialAccounts(request, env, auth)` | `settings.manage` |
| `/api/social/accounts/connect` | POST | `handleConnectSocialAccount(request, env, auth)` | `settings.manage` |
| `/api/social/accounts/:id` | DELETE | `handleDeleteSocialAccount(request, env, auth, id)` | `settings.manage` |
| `/api/social/generate` | POST | `handleGenerateSocialPost(request, env, auth)` | `ai.use` |

Imports : posts depuis `./worker/social-posts`, accounts depuis
`./worker/social-accounts`, generate depuis `./worker/social-ai`.

**Cron** (`scheduled()`, ~après booking-reminders) : `ctx.waitUntil(import(
'./worker/social-publish').then(m=>m.processDueSocialPosts(env)).then(()=>
undefined).catch(()=>undefined));` (calque EXACT des autres jobs best-effort).

### §6.E — Handlers (NEUFS — owned Manager-B)

Stubs Phase A (signatures FIGÉES, corps réels Manager-B) :
- **`social-posts.ts`** : `handleListSocialPosts` · `handleCreateSocialPost` ·
  `handleUpdateSocialPost` · `handleDeleteSocialPost` · `handleScheduleSocialPost`.
  `capGuard` = `requireCapability(auth.capabilities, 'workflows.manage')` ;
  `client_id` résolu via `auth.tenant?.clientId ?? auth.clientId` (JAMAIS body) ;
  re-bornage strict sur PATCH/DELETE/schedule.
- **`social-accounts.ts`** : `socialProviderCredentials(env, provider)` (FIGÉ
  Phase A : renvoie `null` ⇒ flag INACTIF) · `handleListSocialAccounts`
  (projection SANS tokens) · `handleConnectSocialAccount` (credentials null ⇒
  `json({error},400)`) · `handleDeleteSocialAccount` (re-bornage). `capGuard` =
  `settings.manage`.
- **`social-ai.ts`** : `handleGenerateSocialPost`. `capGuard` = `ai.use`.
- **`social-publish.ts`** : `processDueSocialPosts(env)` (cron, FIGÉ dans le
  dispatch) + `publishToNetwork(env, account, post)` (MOCK).

### §6.F — Pages (NEUVES — owned Manager-C)

Routes PROTÉGÉES `src/App.tsx` (FIGÉ Phase A, calque `reviewsRoute` +
`LazyGuard`/`AuthGuard`) :
- `/social` → `SocialPage` (export nommé FIGÉ).
- `/social/calendar` → `SocialCalendarPage` (export nommé FIGÉ ; déclaré AVANT
  `/social` dans `addChildren`).

i18n 100% `t('social.*')` (clés FIGÉES Phase A — **AUCUNE création Phase C**,
parité stricte ×4).

### §6.G — Migration & manifest

`migration-social-seq110.sql` (racine) : `CREATE TABLE IF NOT EXISTS
social_accounts` / `social_posts` + `CREATE INDEX IF NOT EXISTS
idx_social_posts_due ON social_posts(scheduled_at, status)` /
`idx_social_accounts_client ON social_accounts(client_id)`. **AUCUN ADD COLUMN,
AUCUN CHECK, zéro FK/DROP/RENAME.** Entrée manifest seq 110
(`docs/migrations-manifest.json`, `depends_on:["migration-reputation-seq109.sql"]`,
objects `["table:social_accounts","table:social_posts","index:social_posts",
"index:social_accounts"]`, risk low).

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned :
  - **`src/worker/social-publish.ts`** — corps `processDueSocialPosts` calque
    `runDueScheduledBroadcasts` (SELECT `social_posts scheduled_at<=now AND
    status='queued' LIMIT 50` → `status='processing'` → `publishToNetwork` MOCK
    par réseau → `status='published'/'failed'` + `published_at` ; best-effort).
  - **`src/worker/social-posts.ts`** — CRUD réels + schedule (`status='queued'`).
    Capability `workflows.manage`, bornage `client_id` strict.
  - **`src/worker/social-accounts.ts`** — connexions OAuth flag-INACTIF (calque
    `oauth.ts` + `encryptToken`).
  - **`src/worker/social-ai.ts`** — génération Claude (calque
    `handleSuggestReviewReply`).
  - Tests `__tests__/`.
- **Manager-C (frontend)** owned :
  - **`src/pages/Social.tsx`** (NEUF, export `SocialPage`) : composer texte +
    média + sélection réseaux + prévisualisation par réseau + bouton générer IA.
  - **`src/pages/SocialCalendar.tsx`** (NEUF, export `SocialCalendarPage`) :
    calendrier visuel de planification des posts.
  - **`src/components/social/*`** (NEUF).
  - **NE PAS toucher** `Calendar.tsx`/`calendar.ts` (RDV — sans rapport).
- **INTERDITS aux deux** : migration, manifest, `src/lib/types.ts`,
  `src/lib/api.ts`, `src/worker.ts`, `src/App.tsx`, i18n×4, `index.css`,
  `oauth.ts`/`broadcast.ts`/`reviews.ts`/`whatsapp.ts` (réutilisés par
  LECTURE/IMPORT). `social-*.ts` (worker) = **Manager-B** ; `Social.tsx` /
  `SocialCalendar.tsx` / `components/social` = **Manager-C**. **Zéro fichier
  partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **CHECK / tables existants INTOUCHABLES** — status/provider applicatifs SANS
   CHECK (calque seq 109). N'ajoute AUCUN CHECK. AUCUN rebuild.
2. **Manifest seq 110 OBLIGATOIRE** — sinon le runner peut sauter la migration.
   Tables neuves en `CREATE TABLE IF NOT EXISTS` (idempotent — préféré à ADD
   COLUMN qui n'est PAS idempotent sur D1).
3. **FK INTERDITES** (rebuild SQLite) — liens `client_id`/`agency_id`/`created_by`
   restent APPLICATIFS (bornés serveur).
4. **Publication MOCK IMPÉRATIVE** — `publishToNetwork` renvoie
   `{success:false, mock:true}` SANS fetch (calque `sendWhatsAppTemplate`) ;
   `connect` sans credentials → `json({error},400)` propre (calque `oauth.ts`,
   PAS 500) ; callback no-op. Analytics = MOCK / flag. E4/E6 INACTIFS.
5. **Cron best-effort** — `processDueSocialPosts` ne throw JAMAIS (try/catch par
   post) ; le `waitUntil` worker.ts est en `.catch(()=>undefined)`. Ne casse PAS
   les crons existants (broadcasts/reminders/RFM).
6. **Capability EXISTANTE réutilisée** — `workflows.manage` (posts/file) /
   `ai.use` (génération) / `settings.manage` (connexions). **ZÉRO ajout à
   `ALL_CAPABILITIES`.**
7. **Alias relatifs worker** (`./...`, `../lib/...`), front `@/`.
8. **Ne PAS casser le calendrier RDV ni le cron existant** — `calendar.ts`/
   `Calendar.tsx` (RDV) et `community.ts` (forum) sont SANS rapport. Le Social
   planner a son PROPRE calendrier (`SocialCalendar.tsx`).
9. **Bornage tenant STRICT** — `client_id` depuis l'auth (JAMAIS body) ;
   re-bornage sur PATCH/DELETE/schedule (calque
   `oauth.ts:handleDeleteOauthConnection`). Tokens JAMAIS renvoyés au front.
10. **Réutiliser oauth/Claude/mock patterns** — `oauth.ts:providerCredentials` +
    `encryptToken`/`decryptToken`, `runDueScheduledBroadcasts`,
    `handleSuggestReviewReply` (Claude fetch), `sendWhatsAppTemplate` (mock).
