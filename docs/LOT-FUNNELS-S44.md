# LOT Funnels Builder — Sprint 44

> Doc contrat §6 figé. Migration : seq139 — `migration-funnels-seq139.sql`.
> Compagnons : `LOT-FUNNEL.md` (Sprint 1, seq83 — funnels legacy distincts),
> `LOT-SITE-BUILDER.md` (Sprint 10, seq111 — sites multi-pages distincts),
> `LOT-FORMS-XL.md` (Sprint 5, seq106 — forms single-step distincts),
> `LOT-COURSES-LMS-S43.md` (calque pattern handler stub Phase A + ordre
> anti-shadowing + i18n parité STRICTE), `LOT-TEAM-BC.md` (capabilities
> FIGÉES seq80 — réutilisation `settings.manage` admin CRUD).

## §1 Contexte

**Sprint 44 = MODULE NEUF**. Pages multi-step builder avec :

- **Multi-step linéaire** : lead capture → upsell → thank you (ou variations
  par tenant).
- **A/B testing par étape** : 1+ variantes (A, B, C…) par étape, résolution
  déterministe par `visitor_id` hash (FNV-1a) modulo `traffic_pct` cumulé.
  Un même visiteur voit TOUJOURS la même variante (pas de contamination
  analytics).
- **Analytics conversion par étape** : `fb_step_views` + `fb_step_conversions`
  tables dédiées. Breakdown par step + variant + top performers.
- **Anonyme + Loi 25** : `visitor_id` = UUID v4 cookie 1st-party
  `_intralys_fid` (pas d'IP brute), `user_agent_hash` = SHA-256 tronqué 32
  chars, `country` = header CF-IPCountry (non-PII).

**DISTINCT de** :

- **Sprint 1 LOT FUNNEL (seq83)** — `funnels` / `funnel_steps` /
  `funnel_pages` / `funnel_publications` / `funnel_analytics` legacy : un
  funnel = liste ordonnée d'étapes + 1 page JSON `blocks` par étape, SANS
  A/B testing. Routes `/api/funnels/*` (AUTHED) + `/api/p/:slug/*` (PUBLIC).
  Reste INCHANGÉ.
- **Sprint 10 LOT SITE BUILDER (seq111)** — `sites` / `site_pages` /
  `site_publications` : sites multi-pages classiques navigables, pas de
  flow conversion linéaire ni A/B testing par variante.
- **Sprint 5 LOT FORMS XL (seq106)** — `forms` / `form_fields` /
  `form_submissions` : forms single-step, pas de chaînage d'étapes.

Phase A FIGE le contrat — Phase B Manager-B remplit l'engine
(`computeFunnelAnalytics` SELECT + GROUP BY, `recordView` / `recordConversion`
INSERT best-effort, `handlePublicRenderStep` lookup + render HTML),
Phase C Manager-C construit le frontend (`/admin/funnels-builder`
liste + édition + variantes + analytics).

## §2 Migrations — seq139 (DDL résumé)

Fichier racine : `migration-funnels-seq139.sql`. Manifest entrée seq139
(`docs/migrations-manifest.json`), `depends_on:
["migration-courses-lms-seq138.sql"]` (chaînage strict sur dernière migration
LOT 4 S43).

**⚠ COLLISION NOMMAGE seq83** — `funnels` / `funnel_steps` existent déjà
(seq83 LOT FUNNEL S1 avec schémas incompatibles : `status` enum CHECK,
`industry`, `total_*` compteurs, sans `slug` / `primary_goal` /
`is_published`). Pour rester STRICTEMENT ADDITIF et ne pas no-op silencieusement
sur `CREATE TABLE IF NOT EXISTS funnels`, ce lot UTILISE LE PRÉFIXE `fb_`
(« funnel builder » Sprint 44) pour les 5 tables neuves. Côté handlers
(`funnels-builder.ts`) et types (`src/lib/api.ts`) les **alias logiques**
sont conservés (`Funnel`, `FunnelStep`, `FunnelStepVariant`) — la mapping
SQL ↔ TS est faite dans le handler (`SELECT * FROM fb_funnels`). Aucune
confusion runtime puisque le contexte est distinct (S1 = `/api/funnels/*`
legacy, S44 = `/api/funnels-builder/*` + `/api/public/funnels/*`).

100 % ADDITIF, zéro CHECK / FK destructrice / ALTER destructeur / DROP / RENAME :

- `CREATE TABLE IF NOT EXISTS fb_funnels` : id PK, client_id NOT NULL, name
  NOT NULL, slug NOT NULL, description (TEXT NULL), primary_goal (TEXT
  DEFAULT `'lead_capture'` — enum HANDLER `lead_capture|sale|webinar|other`),
  is_published (INTEGER DEFAULT 0), published_at (TEXT NULL), created_at,
  updated_at.
- `CREATE TABLE IF NOT EXISTS fb_steps` : id PK, funnel_id NOT NULL, name
  NOT NULL, step_type (TEXT DEFAULT `'landing'` — enum HANDLER
  `landing|optin|upsell|downsell|thank_you|custom`), order_index (INTEGER
  DEFAULT 0), redirect_after_url (TEXT NULL), created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS fb_step_variants` : id PK, step_id NOT NULL,
  variant_name NOT NULL (TEXT libre — convention `A|B|C…`), content_html
  (TEXT NULL — HTML page complète), traffic_pct (REAL DEFAULT 0.5),
  is_control (INTEGER DEFAULT 0), created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS fb_step_views` : id PK, step_id NOT NULL,
  variant_id NOT NULL, visitor_id NOT NULL (UUID v4 cookie 1st-party),
  client_id (TEXT NULL — dénormalisé), viewed_at, user_agent_hash (TEXT NULL
  — SHA-256 tronqué 32 chars HANDLER), country (TEXT NULL — CF-IPCountry).
- `CREATE TABLE IF NOT EXISTS fb_step_conversions` : id PK, step_id NOT NULL,
  variant_id NOT NULL, visitor_id NOT NULL, client_id (TEXT NULL —
  dénormalisé), next_step_id (TEXT NULL), conversion_value_cents (INTEGER
  DEFAULT 0), converted_at.
- 7 indexes : `uniq_fb_funnels_client_slug` (UNIQUE composite client_id +
  slug — unicité tenant), `idx_fb_funnels_client` (client_id, is_published),
  `idx_fb_steps_funnel` (funnel_id, order_index), `idx_fb_step_variants_step`
  (step_id), `idx_fb_step_views_step` (step_id, viewed_at),
  `idx_fb_step_views_variant` (variant_id), `idx_fb_step_conversions_step`
  (step_id, converted_at).

Validation enums (`fb_funnels.primary_goal` ∈
`lead_capture|sale|webinar|other`, `fb_steps.step_type` ∈
`landing|optin|upsell|downsell|thank_you|custom`, `fb_funnels.is_published` ∈
`0|1`, `fb_step_variants.is_control` ∈ `0|1`) faite SIDE-HANDLER
(`funnels-builder.ts` whitelist JS) — calque LOT-COURSES-LMS-S43 §6 +
LOT-CHAT-BOT-S42 §6 (pas de CHECK = pas de rebuild SQLite jamais).

## §3 Routes (14 AUTHED + 3 PUBLIC)

Toutes câblées dans `src/worker.ts` :

- **AUTHED** : à l'intérieur du bloc `routeProtected`, APRÈS le bloc S43
  courses-lms (~l.3157), AVANT le bloc Sprint 23 sécurité (~l.3158). Garde
  `requireAuth` au choke-point + garde capability **`settings.manage`**
  (FIGÉE seq80 — réutilisée) DANS chaque handler.
- **PUBLIC** : pré-`requireAuth`, après le bloc LOT FUNNEL S1 PUBLIC
  (~l.667). Anti-bot rate-limit + honeypot patterns Sprint 5 forms — best-effort
  côté handler (toute INSERT erreur swallow, JAMAIS d'erreur révélée
  au client).

ORDRE ANTI-SHADOWING strict :

- `/funnels-builder/:id/analytics` AVANT `/funnels-builder/:id/steps` AVANT
  `/funnels-builder/:id/publish` AVANT `/funnels-builder/:id`
- `/funnels-builder/steps/:id/variants` AVANT `/funnels-builder/steps/:id`
- `/funnels-builder/variants/:id` seul
- `/api/public/funnels/track-view` + `/track-conversion` (collections)
  AVANT `/api/public/funnels/:slug/render` (paramétrique)

| Méthode | Chemin                                                  | Handler                          | Cap                | Fichier               |
|--------:|---------------------------------------------------------|----------------------------------|--------------------|-----------------------|
| GET     | `/api/funnels-builder`                                  | `handleListFunnels`              | settings.manage    | funnels-builder.ts    |
| POST    | `/api/funnels-builder`                                  | `handleCreateFunnel`             | settings.manage    | funnels-builder.ts    |
| PATCH   | `/api/funnels-builder/:id`                              | `handleUpdateFunnel`             | settings.manage    | funnels-builder.ts    |
| DELETE  | `/api/funnels-builder/:id`                              | `handleDeleteFunnel`             | settings.manage    | funnels-builder.ts    |
| POST    | `/api/funnels-builder/:id/publish`                      | `handlePublishFunnel`            | settings.manage    | funnels-builder.ts    |
| GET     | `/api/funnels-builder/:id/steps`                        | `handleListSteps`                | settings.manage    | funnels-builder.ts    |
| POST    | `/api/funnels-builder/:id/steps`                        | `handleCreateStep`               | settings.manage    | funnels-builder.ts    |
| PATCH   | `/api/funnels-builder/steps/:id`                        | `handleUpdateStep`               | settings.manage    | funnels-builder.ts    |
| DELETE  | `/api/funnels-builder/steps/:id`                        | `handleDeleteStep`               | settings.manage    | funnels-builder.ts    |
| GET     | `/api/funnels-builder/steps/:id/variants`               | `handleListVariants`             | settings.manage    | funnels-builder.ts    |
| POST    | `/api/funnels-builder/steps/:id/variants`               | `handleCreateVariant`            | settings.manage    | funnels-builder.ts    |
| PATCH   | `/api/funnels-builder/variants/:id`                     | `handleUpdateVariant`            | settings.manage    | funnels-builder.ts    |
| DELETE  | `/api/funnels-builder/variants/:id`                     | `handleDeleteVariant`            | settings.manage    | funnels-builder.ts    |
| GET     | `/api/funnels-builder/:id/analytics`                    | `handleGetAnalytics`             | settings.manage    | funnels-builder.ts    |
| POST    | `/api/public/funnels/track-view`                        | `handlePublicTrackView`          | (public)           | funnels-builder.ts    |
| POST    | `/api/public/funnels/track-conversion`                  | `handlePublicTrackConversion`    | (public)           | funnels-builder.ts    |
| GET     | `/api/public/funnels/:slug/render?step=N&variant=A`     | `handlePublicRenderStep`         | (public)           | funnels-builder.ts    |

Réponses normalisées **`{ data }`** / **`{ error }`** (PAS de champ `code` —
contrat GELÉ docs/LOT-TEAM-BC.md §6.A). Phase A renvoie `501` partout sur les
handlers AUTHED (`Phase B not yet implemented: <handler_name>`) pour câbler la
matrice routes/handlers sans casser le worker — calque chat-bot Phase A +
voice-agent Phase A + courses-lms Phase A. Handlers PUBLIC retournent `{ data:
{ success: true } }` (best-effort, ne révèlent jamais d'erreur — anti-énumération).

**Routes existantes `/api/funnels/*` (S1) / `/api/p/:slug/*` (S1) / `/api/site/*`
(S10) INCHANGÉES** (seq83 + seq111 verrou). Sprint 44 NE TOUCHE PAS aux
modules existants.

## §4 Handlers (signatures FIGÉES Phase A — Phase B Manager-B remplit)

### `src/worker/funnels-builder.ts` (17 handlers : 14 AUTHED + 3 PUBLIC)

```ts
// 5 Funnels admin CRUD (cap settings.manage)
export async function handleListFunnels(env: Env, auth: FunnelsBuilderAuth, url: URL): Promise<Response>
export async function handleCreateFunnel(request: Request, env: Env, auth: FunnelsBuilderAuth): Promise<Response>
export async function handleUpdateFunnel(request: Request, env: Env, auth: FunnelsBuilderAuth, id: string): Promise<Response>
export async function handleDeleteFunnel(env: Env, auth: FunnelsBuilderAuth, id: string): Promise<Response>
export async function handlePublishFunnel(request: Request, env: Env, auth: FunnelsBuilderAuth, id: string): Promise<Response>

// 4 Steps admin CRUD (cap settings.manage)
export async function handleListSteps(env: Env, auth: FunnelsBuilderAuth, funnelId: string): Promise<Response>
export async function handleCreateStep(request: Request, env: Env, auth: FunnelsBuilderAuth, funnelId: string): Promise<Response>
export async function handleUpdateStep(request: Request, env: Env, auth: FunnelsBuilderAuth, id: string): Promise<Response>
export async function handleDeleteStep(env: Env, auth: FunnelsBuilderAuth, id: string): Promise<Response>

// 4 Variants admin CRUD (cap settings.manage)
export async function handleListVariants(env: Env, auth: FunnelsBuilderAuth, stepId: string): Promise<Response>
export async function handleCreateVariant(request: Request, env: Env, auth: FunnelsBuilderAuth, stepId: string): Promise<Response>
export async function handleUpdateVariant(request: Request, env: Env, auth: FunnelsBuilderAuth, id: string): Promise<Response>
export async function handleDeleteVariant(env: Env, auth: FunnelsBuilderAuth, id: string): Promise<Response>

// 1 Analytics (cap settings.manage)
export async function handleGetAnalytics(env: Env, auth: FunnelsBuilderAuth, funnelId: string): Promise<Response>

// 3 PUBLIC (anti-bot rate-limit + honeypot worker-level)
export async function handlePublicTrackView(request: Request, env: Env): Promise<Response>
export async function handlePublicTrackConversion(request: Request, env: Env): Promise<Response>
export async function handlePublicRenderStep(request: Request, env: Env, slug: string): Promise<Response>
```

### `src/worker/lib/funnel-engine.ts` (4 helpers stubs Phase A)

```ts
export function pickVariantForVisitor(variants: FunnelStepVariant[], visitorId: string): FunnelStepVariant | null
export async function computeFunnelAnalytics(env: Env, funnelId: string): Promise<FunnelStepAnalytics>
export async function recordView(env: Env, stepId: string, variantId: string, visitorId: string, request: Request): Promise<void>
export async function recordConversion(env: Env, stepId: string, variantId: string, visitorId: string, nextStepId: string | null, valueCents: number): Promise<void>
```

**Notes engine** :

- `pickVariantForVisitor` Phase A **FONCTIONNEL** (pure helper, FNV-1a hash
  déterministe modulo `traffic_pct` cumulé). Garantit qu'un même `visitor_id`
  voit TOUJOURS la même variante. Stable sort par `id` ASC. Normalisation
  automatique si somme `traffic_pct` != 1.
- `computeFunnelAnalytics` Phase A stub retourne `{steps_breakdown:[],
  conversion_rate:0, top_variants:[]}`. Phase B remplit avec SELECT D1
  COUNT GROUP BY step_id + variant_id + ratio conversions/views.
- `recordView` Phase A stub no-op. Phase B remplit avec calcul
  `user_agent_hash` (crypto.subtle.digest SHA-256 truncated 32 chars) +
  lecture `CF-IPCountry` header + INSERT `fb_step_views` best-effort.
- `recordConversion` Phase A stub no-op. Phase B remplit avec INSERT
  `fb_step_conversions` best-effort + validation `visitor_id` matche un
  `fb_step_views` existant (tolère orphan si cookie cleared).

## §5 Types `src/lib/api.ts` (FIGÉS Phase A)

⚠ **COLLISION NOMMAGE TS** — Sprint 1 (S1, seq83) exporte déjà `Funnel`,
`FunnelStep`, `createFunnel`, `updateFunnel`, `deleteFunnel`, `publishFunnel`.
Sprint 44 utilise donc le suffixe `Builder` pour éviter le shadowing TS (mais
les ALIAS LOGIQUES restent `Funnel` / `FunnelStep` / `FunnelStepVariant` dans
la doc + UI Phase C — c'est uniquement la couche TS export qui distingue).

```ts
export type FunnelPrimaryGoal = 'lead_capture' | 'sale' | 'webinar' | 'other'
export type FunnelStepType = 'landing' | 'optin' | 'upsell' | 'downsell' | 'thank_you' | 'custom'

export interface FunnelBuilder              // 10 champs : id, client_id, name, slug, description, primary_goal, is_published, published_at, created_at, updated_at
export interface FunnelBuilderStep          // 8 champs : id, funnel_id, name, step_type, order_index, redirect_after_url, created_at, updated_at
export interface FunnelStepVariant          // 8 champs : id, step_id, variant_name, content_html, traffic_pct, is_control, created_at, updated_at
export interface FunnelStepAnalytics        // 3 champs : steps_breakdown[], conversion_rate, top_variants[]
export interface FunnelInput                // 4 champs optionnels (POST/PATCH)
export interface FunnelStepInput            // 4 champs optionnels (POST/PATCH)
export interface FunnelStepVariantInput     // 4 champs optionnels (POST/PATCH)
export interface FunnelTrackViewInput       // 3 champs : step_id, variant_id, visitor_id
export interface FunnelTrackConversionInput // 5 champs : step_id, variant_id, visitor_id, next_step_id?, conversion_value_cents?
```

Helpers async exportés (18 helpers : 15 AUTHED + 3 PUBLIC, paritaire avec
routes worker.ts) :

- AUTHED : `listFunnels`, `createFunnelBuilder`, `updateFunnelBuilder`,
  `deleteFunnelBuilder`, `publishFunnelBuilder(id, publish)`,
  `listFunnelSteps(funnelId)`, `createFunnelStep(funnelId, input)`,
  `updateFunnelStep(id, input)`, `deleteFunnelStep(id)`,
  `listStepVariants(stepId)`, `createStepVariant(stepId, input)`,
  `updateStepVariant(id, input)`, `deleteStepVariant(id)`,
  `getFunnelAnalytics(funnelId)`.
- PUBLIC : `trackFunnelStepView({step_id, variant_id, visitor_id})`,
  `trackFunnelConversion({step_id, variant_id, visitor_id, next_step_id?,
  conversion_value_cents?})`, `renderFunnelStep(slug, step?, variant?)`.

## §6 Contrat inter-agent FIGÉ — Phase B/C ne peuvent PAS modifier

1. **Migrations** : seq139 verrou. Tables préfixées `fb_*` (anti-collision
   seq83). Aucun champ supplémentaire en Phase B sans nouvelle seq (140+).
   Aucun CHECK ajouté (rebuild SQLite interdit). 100 % ADDITIF. NE TOUCHE
   PAS aux tables existantes `funnels` / `funnel_steps` / `funnel_pages` /
   `funnel_publications` / `funnel_analytics` (seq83) ni aux autres tables
   régulées.
2. **Routes** : 17 chemins/méthodes figés (§3). Aucun renommage. L'ordre
   anti-shadowing dans `worker.ts` est invariant. Routes existantes
   `/api/funnels/*` (S1) / `/api/p/:slug/*` (S1) / `/api/site/*` (S10)
   INCHANGÉES.
3. **Capabilities** : `settings.manage` UNIQUEMENT (admin CRUD + analytics).
   AUCUN ajout à `ALL_CAPABILITIES`. Capabilities FIGÉES seq80. Routes
   PUBLIC = pré-`requireAuth`, anti-bot rate-limit + honeypot worker-level.
4. **Contrat réponses** : `json({ data })` succès / `json({ error }, status)`
   erreur. PAS de champ `code`. PAS de wrapping supplémentaire. Handlers
   PUBLIC retournent `{ data: { success: true } }` même en erreur
   (anti-énumération).
5. **Types `src/lib/api.ts`** : noms et signatures FIGÉS (§5). Manager-C
   peut ajouter des `interface` supplémentaires côté front s'il les expose,
   mais ne renomme PAS les exports listés. Les alias logiques `Funnel` /
   `FunnelStep` / `FunnelStepVariant` mappent vers `fb_funnels` / `fb_steps`
   / `fb_step_variants` côté SQL.
6. **Bornage tenant** : `WHERE client_id = ?` dans tout SELECT/UPDATE/DELETE
   bornable. Toutes les tables nouvelles ont une colonne `client_id` directe
   (sauf `fb_steps` et `fb_step_variants` qui héritent via jointure
   applicative `fb_funnels.client_id`). Le bornage est DEFENSE-IN-DEPTH IDOR.
   `resolveClientId()` via `getClientModules(env, auth.userId)` — calque
   `chat-bot.ts:33` + `voice-agent.ts:32` + `courses-lms.ts:31`. Les routes
   PUBLIC résolvent `client_id` depuis `fb_funnels.slug` (lookup serveur,
   JAMAIS depuis le body).
7. **Imports RELATIFS** : `import type { Env } from './types'` /
   `from '../types'` — JAMAIS d'alias `@/`. Calque chat-bot.ts +
   voice-agent.ts + courses-lms.ts.
8. **NE TOUCHE PAS aux modules existants** :
   - `src/worker/funnels.ts` (LOT FUNNEL S1) — INCHANGÉ
   - `src/worker/funnel-blocks.ts` (LOT FUNNEL S1) — INCHANGÉ
   - `src/worker/sites.ts` (LOT SITE BUILDER S10) — INCHANGÉ
   - `src/worker/forms.ts` (LOT FORMS XL S5) — INCHANGÉ
   - Tables seq83 (`funnels`, `funnel_steps`, `funnel_pages`,
     `funnel_publications`, `funnel_analytics`) — INCHANGÉES
   - `migration-funnel-seq83.sql` / `migration-sitebuilder-seq111.sql` /
     `migration-forms-xl-seq106.sql` — INCHANGÉS
   Si Phase B a besoin d'intégrer le funnel builder au pipeline lead
   (track-view → lead capture), passer par un **nouveau** helper additif
   (ex `lib/funnel-bridge.ts`) qui appelle `applyLeadMapping` /
   `resolveDedup` / `mergeIntoLead` (forms.ts) — sans modifier `funnels.ts`
   ni `forms.ts`.
9. **A/B TESTING DÉTERMINISTE** :
   - `pickVariantForVisitor` est PURE — pas de dépendance D1, FNV-1a hash
     déterministe. Phase B peut wrapper avec un cache mémoire mais NE
     modifie PAS l'algorithme (cross-call stabilité visiteur garantie).
   - `traffic_pct` validation HANDLER : si somme < 1 ou > 1, normalisation
     automatique côté engine. PAS de CHECK SQL, PAS de transaction de
     rebalance.
   - `is_control` = flag UI uniquement (analytics breakdown). PAS de
     filtrage automatique côté render.
10. **TRACKING ANONYME + LOI 25** :
    - `visitor_id` = UUID v4 client-side (cookie 1st-party `_intralys_fid`,
      max-age 1 an). PAS d'IP brute. PAS de PII.
    - `user_agent_hash` = SHA-256 du UA tronqué 32 chars (HANDLER Phase B
      via crypto.subtle.digest). Bucket UA pour debug (mobile vs desktop)
      mais anonymisé.
    - `country` = header CF-IPCountry (2 lettres ISO). Non-PII.
    - Routes PUBLIC track-* = pré-`requireAuth` SANS authentification mais
      AVEC anti-bot rate-limit + honeypot (patterns Sprint 5 forms).
      Best-effort : toute INSERT erreur swallow, JAMAIS d'erreur révélée
      au client (anti-énumération).
    - Audit redaction déjà couverte par `audit-redact.ts` (S23).
11. **i18n** : 21 clés ajoutées dans 4 catalogues (`fr-CA`, `fr-FR`, `en`,
    `es`), parité STRICTE (même nombre de clés `funnels.*`, mêmes noms).
    Manager-C ne change PAS le nom des clés. `};` final de chaque catalogue
    PRÉSERVÉ.

### Vérifications inter-agent (à valider AVANT Phase B kickoff)

- [x] Manifest JSON valide (`python -m json.tool docs/migrations-manifest.json`)
- [x] 4 catalogues i18n MÊME nombre de clés `funnels.*` (21 chacun)
- [x] `};` final de chaque catalogue PRÉSERVÉ (fr-CA, fr-FR, en, es)
- [x] Routes câblées dans `worker.ts` après bloc S43 courses-lms (~l.3157)
- [x] Routes PUBLIC câblées dans `worker.ts` après bloc LOT FUNNEL S1 PUBLIC (~l.667)
- [x] Aucun touch sur `funnels.ts` (S1) / `funnel-blocks.ts` (S1) / `sites.ts` (S10)
      / `forms.ts` (S5) (vérifier `git status` Phase A end)
- [x] `funnels-builder.ts` + `lib/funnel-engine.ts` créés en NOUVEAUX fichiers
- [x] Imports relatifs uniquement (`./types`, `../types`, `../../lib/api`)
- [x] `json({ data })` / `json({ error }, status)` partout — pas de `code`
- [x] `requireCapability(auth.capabilities, 'settings.manage')` top de chaque
      handler AUTHED
- [x] Tables `fb_*` (préfixe anti-collision seq83) — UNIQUE composite
      client_id + slug
- [x] Aucun CHECK SQL (enums validés HANDLER whitelist JS)

## §7 Découpe Phase B (Manager-B backend ∥ Manager-C frontend)

- **Manager-B** : remplit les 14 handlers AUTHED + 3 handlers PUBLIC + 3
  helpers engine non-stub (`computeFunnelAnalytics` SELECT + GROUP BY,
  `recordView` / `recordConversion` INSERT best-effort,
  `handlePublicRenderStep` lookup `fb_funnels.slug` → render HTML avec
  tracking pixel injecté + cookie set). Implémente la validation enums
  whitelist JS (`primary_goal`, `step_type`, `is_control`). Implémente le
  rate-limit + honeypot sur routes PUBLIC (patterns Sprint 5 forms via
  `lib/rate-limit.ts`). Gère la collision si seq83 `funnels` table existe
  (pas de problème puisque tables `fb_*` distinctes).
- **Manager-C** : pages `/admin/funnels-builder` (liste + édition + drag-drop
  étapes + éditeur variantes HTML + dashboard analytics + bouton publish).
  Intégration des 21 clés i18n `funnels.*`. ZÉRO fichier partagé avec B
  (api.ts est en lecture pour C). Le rendu PUBLIC HTML (`/api/public/funnels/
  :slug/render`) est un endpoint de bout en bout serveur — Manager-C ne
  touche pas (les pages publiques sont rendues serveur, pas client).

## §8 Sécurité & Loi 25 / RGPD

- **PII visiteur** : `visitor_id` = UUID v4 client-side (cookie 1st-party).
  PAS d'IP brute stockée. PAS d'email/nom/téléphone dans `fb_step_views` ni
  `fb_step_conversions`. Le visiteur peut clear son cookie à tout moment et
  les compteurs futurs partent à zéro (orphan tolérés).
- **Abuse / rate-limit** : routes PUBLIC track-* + render = anti-bot rate-limit
  côté handler Phase B (calque Sprint 5 forms — DO `RateLimitDO` 60 req/min
  par IP). Honeypot field optionnel sur form de tracking custom (Phase B
  validation HANDLER).
- **Anti-énumération** : routes PUBLIC retournent TOUJOURS `{ data: {
  success: true } }` même en erreur (slug inexistant, step inexistant,
  variant inexistant). JAMAIS de 404/500 révélé. Permet à l'attaquant de
  fuzz les slugs sans signal.
- **A/B testing transparence** : `pickVariantForVisitor` déterministe par
  `visitor_id` → un même utilisateur voit toujours la même variante
  (cohérence UX + analytics non-contaminées). Si l'utilisateur clear son
  cookie, il devient un nouveau visiteur (compteurs view + conversion
  redémarrent à zéro pour cet ID).
- **No external API key** : zéro dépendance externe. Render HTML serveur
  pur (Cloudflare Workers). Si visitor_id manquant côté `/render` → cookie
  set serveur via `Set-Cookie: _intralys_fid=<uuid>; HttpOnly; SameSite=Lax;
  Max-Age=31536000` (Phase B).

---

**Tableau de bord Phase A — état Manager-A SOLO** :

| Livrable                                              | Statut |
|-------------------------------------------------------|:------:|
| Migration `migration-funnels-seq139.sql` (additif fb_*)|   X    |
| Manifest entry seq139 (depends seq138)                 |   X    |
| Types `src/lib/api.ts` (9 interfaces + 18 helpers)     |   X    |
| Routes `worker.ts` (14 AUTHED + 3 PUBLIC)              |   X    |
| Stubs `funnels-builder.ts` (17 handlers, 501 + best-effort) |   X    |
| Stubs `lib/funnel-engine.ts` (4 helpers, 1 fonctionnel) |   X    |
| i18n × 4 catalogues (21 clés `funnels.*` parité STRICTE)|   X    |
| Doc `docs/LOT-FUNNELS-S44.md` §6 FIGÉ                  |   X    |
