# LOT FUNNEL — builder landing pages / funnels (niveau GHL / Systeme.io)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> disjoints — §6.H). Non exécuté (VM VMware sans bun/node) — Antigravity
> buildera côté hôte. Modèle : `docs/LOT-INVOICE.md`. **Phase B/C ne lisent
> QUE ce document** (+ le CODE, jamais le brief).

Architecture figée par le Chaman (NE PAS réinventer) :
- Rendu page publiée = **SPA hydraté front**, PAS de SSR React. Route SPA
  publique `/p/$slug` (calque EXACT `publicFormRoute /f/$slug`) → fetch
  `GET /api/p/:slug`. Crawler = snapshot méta/OG-only `maybeServeFunnelSsr`.
- Modèle blocs = **JSON array dans `funnel_pages.blocks`** (PAS de table
  `funnel_blocks` normalisée — page = lecture/écriture atomique, zéro FK).
- Funnel v1 = **liste d'étapes ordonnée dnd-kit** (PAS @xyflow ; branché = v2).
- Capability = **RÉUTILISE `workflows.manage`** (déjà dans `ALL_CAPABILITIES`).
  NE PAS ajouter `funnels.manage` (liste FIGÉE seq 80).
- Submit→lead = **RÉUTILISE le pipeline `src/worker/forms.ts`** (helpers
  cités §6.F). NE PAS dupliquer la logique dedup.

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS (rappel)

`src/lib/api.ts:62-112` (`apiFetch`) + le type `ApiResponse<T>` (forme
`{ data?, error? }`) sont **GELÉS**. Phase A ne les a PAS modifiés ; Phase B/C
ne les touchent PAS. Décision **DÉFINITIVE** :

- Réponses succès = **`json({ data: ... })`** ; erreurs =
  **`json({ error: '...' }, status)`**. **JAMAIS de champ `code`** — la
  discrimination front est string-match sur `error`.
- Helpers PROTÉGÉS : via `apiFetch` (auth Bearer + `X-Sub-Account` injectés).
- Helpers PUBLICS (`/p/:slug`) : via `fetch` brut `${API_BASE}/p/...`
  (calque EXACT `src/pages/PublicForm.tsx:48,80` — pas d'auth, retour
  normalisé `{ data } | { error }`, `t('api.unavailable')` sur exception).

Helpers ADDITIFS créés Phase A dans `src/lib/api.ts` (fin de fichier,
section « LOT FUNNEL ») — signatures FIGÉES, Phase C les CONSOMME tels quels :

```
getFunnels(): ApiResponse<Funnel[]>                                  GET  /funnels
getFunnel(id): ApiResponse<Funnel>                                   GET  /funnels/:id
createFunnel(data): ApiResponse<{id}>                                 POST /funnels
updateFunnel(id, updates): ApiResponse<{success}>                     PUT  /funnels/:id
deleteFunnel(id): ApiResponse<{success}>                              DELETE /funnels/:id
saveFunnelPage(funnelId, stepId, data): ApiResponse<{success}>        PUT  /funnels/:id/pages/:stepId
publishFunnel(funnelId, data?): ApiResponse<{slug,url}>               POST /funnels/:id/publish
getFunnelStats(funnelId): ApiResponse<FunnelStats>                    GET  /funnels/:id/stats
getPublicFunnel(slug): ApiResponse<{funnel,steps}>                    GET  /p/:slug        (public)
submitPublicFunnel(slug, {step_id?,data}): ApiResponse<{id,success_message?,redirect_url?}>  POST /p/:slug/submit (public)
```

Types ADDITIFS figés `src/lib/api.ts` (section LOT FUNNEL) : `FunnelBlock`,
`FunnelPage`, `FunnelStep`, `Funnel`, `FunnelStats` — voir le fichier (gelés,
Phase C les importe, NE crée AUCUN type concurrent).

### §6.B — DDL seq 83 + conventions

Fichier : `migration-funnel-seq83.sql` — seq **83**,
`depends_on: migration-invoice-real-seq82.sql`. Entrée manifest ajoutée
(`docs/migrations-manifest.json` seq 83, risk `low`).

Conventions (calque seq 82) : id `TEXT PK DEFAULT (lower(hex(randomblob(16))))`,
timestamps `TEXT DEFAULT (datetime('now'))`, **zéro FK**, `IF NOT EXISTS`
idempotent, CHECK inline, PAS d'unixepoch/INTEGER autoincrement. STRICTEMENT
additif : que des `CREATE TABLE/INDEX IF NOT EXISTS`, AUCUN ALTER/DROP/RENAME.
AUCUN touch `users`/CHECK seq 59/tables E4-E6. Tolérance duplicate / best-effort
(header du fichier verbatim).

Tables (jointures **APPLICATIVES** par colonnes TEXT, jamais de FK) :

- **`funnels`** : `id, client_id, agency_id, name, description, status
  CHECK(draft|published|archived), industry, total_views, total_submissions,
  total_conversions, created_at, updated_at`. Index : client / agency / status.
- **`funnel_steps`** : `id, funnel_id, name, step_type
  CHECK(optin|content|upsell|thankyou|generic), position, created_at,
  updated_at`. Index : funnel / (funnel_id, position).
- **`funnel_pages`** : `id, funnel_id, step_id, title, **blocks TEXT
  DEFAULT '[]'** (JSON FunnelBlock[]), settings_json TEXT DEFAULT '{}',
  seo_title, seo_description, seo_image, created_at, updated_at`. Index :
  funnel / step. Relation step→page = applicative **1:1**.
- **`funnel_publications`** : `id, funnel_id, client_id, agency_id, slug,
  **custom_domain DEFAULT NULL (INACTIF v2)**, is_active DEFAULT 1,
  published_at, created_at, updated_at`. Index : slug / funnel / client.
  **Unicité du slug = APPLICATIVE** (handler `handlePublishFunnel`), PAS de
  UNIQUE SQL.
- **`funnel_analytics`** : `id, funnel_id, step_id, event_type
  CHECK(view|submit|conversion), lead_id, ip, user_agent, created_at`. Index :
  funnel / (funnel_id, event_type) / (funnel_id, created_at).

Bornage tenant : `client_id` (calque `forms.client_id`) + `agency_id`
(calque `quotes.agency_id` seq 82).

### §6.C — Modèle de blocs (CONTRAT CLÉ)

Fichier `src/worker/funnel-blocks.ts` (calque structurel `email-blocks.ts`
mais compilateur HTML **web responsive NEUF**, PAS `<table>` email). La
**SURFACE DE TYPES est FIGÉE Phase A** — Phase C écrit UNIQUEMENT les CORPS
balisés `// CORPS PHASE C` (compileBlocksToHtml, valeurs de createDefaultBlock)
SANS changer signatures ni clés de config.

**8 `BlockType` FIGÉS** : `'hero' | 'text' | 'image' | 'video' | 'form' |
'button' | 'cta' | 'spacer'`.

`FunnelBlock = { id: string; type: BlockType; config: Record<string, unknown> }`.

Schéma `config` figé par type (interfaces exportées — NE PAS modifier les
clés) :

- **hero** `HeroBlockConfig` : `headline, subheadline, align(left|center|
  right), backgroundColor, textColor, backgroundImage`.
- **text** `TextBlockConfig` : `html, color, fontSize, align, maxWidth`.
- **image** `ImageBlockConfig` : `src, alt, width, align, link`.
- **video** `VideoBlockConfig` : `url, autoplay, align`.
- **form** `FormBlockConfig` : `fields: Array<{name,label,type(text|email|
  tel|textarea|select),required,options?}>, submitLabel, successMessage,
  redirectUrl`. ⚠ Conventions `name` calquées `forms.ts:69-73`
  (`name|nom`, `email`, `phone|telephone`, `message|note`) → mapping lead
  sans glue (§6.F).
- **button** `ButtonBlockConfig` : `text, url, backgroundColor, color,
  borderRadius, align, fullWidth`.
- **cta** `CtaBlockConfig` : `headline, text, buttonText, buttonUrl,
  backgroundColor, textColor, buttonColor, align`.
- **spacer** `SpacerBlockConfig` : `height`.

Signatures FIGÉES :
- `compileBlocksToHtml(blocks: FunnelBlock[], opts?: {slug?:string;
  title?:string}): string` — corps Phase C (rendu web responsive : container
  max-width, flex/grid, `<video>` 16:9, `<form>` postant
  `POST /api/p/:slug/submit`).
- `createDefaultBlock(type: BlockType): FunnelBlock` — corps Phase C (valeurs
  affinées ; les CLÉS de config restent celles ci-dessus).
- `BLOCK_PALETTE: Array<{type:BlockType; labelKey:string; icon:string}>` —
  FIGÉE (labelKey = clé i18n `funnel.block.*` résolue côté front via `t()` ;
  icon = nom Lucide pour la primitive `<Icon>`).

**Sérialisation** : `FunnelBlock[]` stocké tel quel JSON dans
`funnel_pages.blocks` (`TEXT DEFAULT '[]'`). Lecture/écriture **ATOMIQUE** de
la page entière (`saveFunnelPage` remplace `blocks` intégralement).

### §6.D — Contrats handlers backend (`src/worker/funnels.ts`)

Fichier owned **Manager-B** Phase B. Signatures FIGÉES Phase A (stubs
`// STUB PHASE A → corps réel Phase B Manager-B`) — worker.ts (gelé) câble
déjà :

| Handler | Signature | Endpoint |
|---|---|---|
| `handleGetFunnels` | `(env, auth, url)` | `GET /api/funnels` |
| `handleCreateFunnel` | `(request, env, auth)` | `POST /api/funnels` |
| `handleGetFunnel` | `(env, auth, funnelId)` | `GET /api/funnels/:id` |
| `handleUpdateFunnel` | `(request, env, auth, funnelId)` | `PUT /api/funnels/:id` |
| `handleDeleteFunnel` | `(env, auth, funnelId)` | `DELETE /api/funnels/:id` |
| `handleSaveFunnelPage` | `(request, env, auth, funnelId, stepId)` | `PUT /api/funnels/:id/pages/:stepId` |
| `handlePublishFunnel` | `(request, env, auth, funnelId)` | `POST /api/funnels/:id/publish` |
| `handleGetFunnelStats` | `(env, auth, funnelId)` | `GET /api/funnels/:id/stats` |
| `handlePublicFunnelGet` | `(env, url)` | `GET /api/p/:slug` (PUBLIC) |
| `handlePublicFunnelSubmit` | `(request, env, slug)` | `POST /api/p/:slug/submit` (PUBLIC) |
| `handleTrackFunnelEvent` | `(request, env, slug)` | `POST /api/p/:slug/track` (PUBLIC) |

`auth` = `CapAuth & { capabilities?: Set<string> }` (forme injectée au
choke-point `worker.ts` — `userId/role/clientId/tenant/capabilities`).

Règles que le CORPS Phase B DOIT respecter :
- **Capability** : en tête des handlers PROTÉGÉS,
  `const denied = requireCapability(auth.capabilities, 'workflows.manage');
  if (denied) return denied;` (import depuis `./capabilities`). RÉUTILISE
  `workflows.manage` (déjà dans `ALL_CAPABILITIES`) — **NE PAS** ajouter
  `funnels.manage`. En legacy/mono-tenant le set est LARGE ⇒ pas de
  régression ; bridage viewer actif seulement en mode agence.
- **Bornage tenant** : calque EXACT `clients-admin.ts:assertClientInTenant`
  (`isLegacy(auth)` → pas de garde nouvelle, endpoints NEUFS ;
  mode agence `agencyId != null` → l'objet ciblé doit avoir
  `agency_id == auth.tenant.agencyId` OU `client_id ∈ accessibleClientIds`,
  sinon `json({error:'Funnel introuvable'}, 404)`). Les writes posent
  `client_id` + `agency_id` depuis le tenant à la création.
- **Réponses** : `json({data})` / `json({error}, status)` UNIQUEMENT (§6.A).
- **best-effort** : table/colonne absente (seq 83 non jouée) → réponse propre
  (`404` / `{data:[]}`), JAMAIS de 500/throw non maîtrisé.

### §6.E — Publication (SPA hydraté + endpoint public + crawler SSR)

- Publication : `handlePublishFunnel` génère/valide un **slug** (unicité
  APPLICATIVE : `SELECT 1 FROM funnel_publications WHERE slug=? AND funnel_id<>?`
  → si pris, `json({error: t-side 'funnel.error.slug_taken'... }, 409)` côté
  worker = `json({error:'Cette adresse est déjà utilisée'},409)`), upsert
  `funnel_publications` (`is_active=1`, `client_id`/`agency_id` du tenant),
  passe `funnels.status='published'`. Retour `{ slug, url }`
  (`url = '/p/'+slug`).
- Rendu : route SPA publique **`/p/$slug`** (App.tsx `publicFunnelRoute`,
  HORS LazyGuard/auth, calque EXACT `publicFormRoute`). `PublicFunnelPage`
  (Phase C) fait `getPublicFunnel(slug)` → rend les blocs hydratés.
  **PAS de SSR React.**
- Crawler : `maybeServeFunnelSsr(request, env)` (`route-meta-ssr.ts`,
  ajouté Phase A, branché `worker.ts` à côté de `maybeServeSsrMeta`,
  try/catch non bloquant). Sert un snapshot HTML **méta/OG-only** (titre/
  description/image depuis `funnel_pages.seo_*` + `funnels.name/description`)
  UNIQUEMENT si UA = crawler connu ET slug actif ; sinon `null` ⇒ traverse
  au SPA. `escapeHtml` + `renderSnapshotHtml` réutilisés.
- **`custom_domain`** : colonne posée, **INACTIVE en v1** (jamais lue/routée).
  Routing domaine custom = lot v2 ultérieur.

### §6.F — Wiring funnel → CRM (RÉUTILISE forms.ts, zéro dup dedup)

`handlePublicFunnelSubmit(request, env, slug)` (Phase B) DOIT calquer
`src/worker/forms.ts:handlePublicFormSubmit:16-143`, en RÉUTILISANT les mêmes
helpers (imports dynamiques identiques) :

1. Résoudre la publication : `SELECT funnel_id, client_id FROM
   funnel_publications WHERE slug = ? AND is_active = 1` (404 sinon).
   `client_id` du lead = **celui de `funnel_publications`** (PAS du payload).
2. Enregistrer la soumission (analytics) + incrémenter compteur :
   `INSERT INTO funnel_analytics (funnel_id, step_id, event_type, ip,
   user_agent) VALUES (?, ?, 'submit', ?, ?)` puis
   `UPDATE funnels SET total_submissions = total_submissions + 1 WHERE id=?`
   (calque `forms.ts:34-36`).
3. Mapping + dedup + lead — **réutilise EXACTEMENT** (cf. `forms.ts:78-131`) :
   - `const { applyLeadMapping } = await import('./lead-mapping');`
   - `const { logIngestConsent } = await import('./leads');`
   - `const { resolveDedup, mergeIntoLead } = await import('./lead-dedup');`
   - `const { autoEnrollForTrigger } = ...` (déjà importé statiquement
     `forms.ts:4` — réimport dynamique OK ou import statique).
   - Champs depuis le payload du bloc `form` : `name|nom`, `email`,
     `phone|telephone`, `message|note` (mêmes clés que `forms.ts:69-73` →
     mapping sans glue), via `sanitizeInput` (`./helpers`).
   - `resolveDedup(env, 'email_phone', { clientId, email, phone })` →
     merge/skip/create ; `INSERT INTO leads (... source ...)` avec
     **`source = 'funnel'`** (≠ `'form'`), `status='new'`,
     `pipeline_id='pipeline-default'`, `stage_id='stage-new'`, colonnes
     attribution + `consent_status` IDENTIQUES à `forms.ts:106-113`.
   - `await autoEnrollForTrigger(env, 'form_submitted', leadId);` (le funnel
     déclenche le MÊME trigger workflow que les forms — adjacence voulue).
4. Réponse : `json({ data: { id: subId, success_message, redirect_url } },
   201)` (forme calquée `forms.ts:134-142`, sans quiz).
5. **NE PAS** réécrire la logique dedup/merge — appeler les helpers ci-dessus.

`handleTrackFunnelEvent` : `INSERT funnel_analytics (... 'view')` +
`UPDATE funnels SET total_views = total_views + 1` (calque
`handleTrackFormView` `forms.ts:147-165`).

### §6.G — Analytics

- Table `funnel_analytics` (events bruts) + compteurs **dénormalisés** sur
  `funnels.total_views / total_submissions / total_conversions`
  (UPDATE += 1, calque `forms.total_submissions`).
- `handleGetFunnelStats` : calque `handleGetFormStats` `forms.ts:169-200` —
  lit les compteurs, `conversion_rate = total_views>0 ?
  ((total_submissions/total_views)*100).toFixed(1) : '0.0'`,
  `views_by_day` via `SELECT date(created_at) as day, COUNT(*) as count
  FROM funnel_analytics WHERE funnel_id=? AND event_type='view'
  GROUP BY date(created_at) ORDER BY day DESC LIMIT 30`. Retour forme
  `FunnelStats` (§6.A).

### §6.H — Matrice de propriété des fichiers Phase B (disjonction STRICTE)

**GELÉS Phase A — Phase B/C NE LES TOUCHENT PAS** :
`migration-funnel-seq83.sql`, `docs/migrations-manifest.json`,
`src/worker.ts` (routes câblées), `src/worker/route-meta-ssr.ts`
(`maybeServeFunnelSsr`), `src/lib/api.ts` (helpers + types LOT FUNNEL),
`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (clés `funnel.*`), `src/App.tsx`
(routes + lazy imports), `src/components/layout/Sidebar.tsx` (nav item),
**+ les SIGNATURES de `src/worker/funnels.ts` et la SURFACE DE TYPES /
`BLOCK_PALETTE` de `src/worker/funnel-blocks.ts`**.

**Manager-B (Phase B) ⊂ { `src/worker/funnels.ts` }** — UNIQUEMENT les CORPS
des handlers (signatures intouchées). Aucun autre fichier.

**Manager-C (Phase B) ⊂ {**
- `src/worker/funnel-blocks.ts` — UNIQUEMENT les CORPS `// CORPS PHASE C`
  (compileBlocksToHtml / valeurs createDefaultBlock) ; types/palette GELÉS.
- `src/pages/Funnels.tsx` (stub Phase A → liste réelle)
- `src/pages/FunnelBuilder.tsx` (stub Phase A → éditeur dnd-kit)
- `src/pages/PublicFunnel.tsx` (stub Phase A → SPA hydraté public)
- `src/pages/funnel-templates.ts` (NOUVEAU — gabarits par industrie ;
  Manager-C le crée Phase C)
**}**

Disjonction : Manager-B ∩ Manager-C = ∅ (fichiers distincts ;
`funnel-blocks.ts` est owned C, jamais B). Aucun des deux ne touche un
fichier GELÉ. **6 pages R INTERDITES** (`Leads/Dashboard/LeadDetail/Tasks/
Pipeline/Clients`). `src/i18n/*.json` (mort) INTERDIT. Tables/code E4-E6
régulés INTERDITS.

### §6.I — Garde-fous + suites à ne pas régresser

- Strictement ADDITIF. Rétro-compat byte-identique legacy. Aucun touch
  `users`/CHECK seq 59. Aucune FK. Aucun DROP/RENAME. E4/E6 régulés JAMAIS
  touchés/activés. `apiFetch`/`ApiResponse` GELÉS (jamais `code`). PAS d'ajout
  à `ALL_CAPABILITIES` (réutilise `workflows.manage`). PAS de dup dedup/lead
  (réutilise helpers forms.ts §6.F).
- `maybeServeFunnelSsr` + le branchement worker.ts sont best-effort
  try/catch : une panne D1 / seq 83 non jouée ⇒ `null` ⇒ SPA prend le relais
  (aucune régression du rendu public existant ni des forms `/f/$slug`).
- Suites à ne PAS régresser (Antigravity, côté hôte) : **forms** (pipeline
  submit→lead réutilisé, inchangé), **leads** (INSERT borné `client_id`,
  attribution/consent), **tenant-context** (resolveTenantContext best-effort),
  **capabilities** (resolveCapabilities / requireCapability — set legacy
  large, pas de nouvelle garde au choke-point), **ecommerce-multitenant**
  (isolation), **teamA-*** (invitations), + nouvelles suites funnel
  éventuelles. Le câblage worker.ts ajoute uniquement des branches `path`
  NEUVES (`/api/funnels*`, `/api/p/*`) — aucune route existante modifiée
  (ordre : sous-routes spécifiques avant `/:id`, comme l'existant
  forms/clients).
- Pas de build/test côté VM (VMware sans bun/node) — Antigravity buildera
  côté hôte. **Ne JAMAIS prétendre « buildé/testé vert ».**

---

## État Phase A (livré)

Fichiers créés : `migration-funnel-seq83.sql`, `src/worker/funnel-blocks.ts`,
`src/worker/funnels.ts` (stubs), `src/pages/Funnels.tsx` (stub),
`src/pages/FunnelBuilder.tsx` (stub), `src/pages/PublicFunnel.tsx` (stub),
`docs/LOT-FUNNEL.md`.
Fichiers modifiés (gelés pour Phase B/C) : `docs/migrations-manifest.json`
(seq 83), `src/worker.ts` (import + routes publiques/protégées + hook SSR),
`src/worker/route-meta-ssr.ts` (`maybeServeFunnelSsr`), `src/lib/api.ts`
(helpers + types), `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (84 clés `funnel.*`
chacun, parité stricte), `src/App.tsx` (3 routes + 3 lazy imports),
`src/components/layout/Sidebar.tsx` (nav item + import `LayoutTemplate`).
