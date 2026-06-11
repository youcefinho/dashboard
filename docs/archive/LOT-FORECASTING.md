# LOT FORECASTING — projection + objectifs + scénarios (Sprint 14 : un forecast pondéré NAÏF existe DÉJÀ — `pipelines.ts handleGetPipelineForecast` deal_value × stage.probability, route GET /api/pipelines/:id/forecast, vue `ForecastView.tsx`, testé — mais date close SIMULÉE +90j, pas de projection, pas de group-by, pas d'objectifs, pas de scénarios → on COMPLÈTE, 100% ADDITIF, RÉUTILISANT l'existant EN LECTURE)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-CONVERSION-SCORING.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE des fichiers RÉUTILISÉS,
> jamais le brief).

Sprint **100% ADDITIF**, **migration `migration-forecast-seq114.sql`** (1 table
neuve `forecast_targets`). Le forecast pondéré existe DÉJÀ — **à RÉUTILISER EN
LECTURE, NE PAS réécrire** :
- `src/worker/pipelines.ts` (`handleGetPipelineForecast`, ~ligne 212) : forecast
  pondéré NAÏF. **READ-ONLY — INTOUCHABLE.**
- `src/worker/conversion-engine.ts` (`conversion_baselines` seq 113) :
  conversion_rate observé du tenant. **READ-ONLY** (lecture/calibration scénarios).
- `src/worker/reports.ts` (lignes 30-41) : pattern d'agrégat won/closed de
  référence. **READ-ONLY.**
- `src/components/pipelines/ForecastView.tsx` : vue existante (fetch brut +
  localStorage token) → **migrée vers apiFetch par Manager-C** (§6.H).

**GAP comblé :** le forecast actuel est NAÏF — (1) la date de close est **SIMULÉE
+90j** (`expectedDate.setDate(expectedDate.getDate() + 90)`, pipelines.ts:246-248),
(2) aucune **projection de tendance**, (3) aucun **group-by commercial/source**,
(4) aucun **objectif/quota**, (5) aucun **scénario best/likely/worst**, et (6) la
vue utilise **`fetch` brut + `localStorage.getItem('token')` + `as any`** au lieu
d'`apiFetch`/`ApiResponse`. On AJOUTE un moteur ENRICHI (DÉTERMINISTE, offline-safe,
ZÉRO LLM) servi par des routes NEUVES `/api/forecast*` + une table NEUVE
`forecast_targets`, et on migre la vue.

Alias : imports worker **RELATIFS** (`./...`), JAMAIS `@/`. Front `@/`.

---

## §0 — AUDIT DISQUE (le code fait foi — à RÉUTILISER EN LECTURE)

### `src/worker/pipelines.ts` — `handleGetPipelineForecast` (~ligne 212, INTOUCHABLE)

**Signature EXACTE (FIGÉE — NE PAS la changer, NE PAS toucher la route) :**
```ts
export async function handleGetPipelineForecast(
  env: Env,
  auth: { role: string; userId: string },
  pipelineId: string,
  _url: URL,
): Promise<Response>;
//   Route : GET /api/pipelines/:id/forecast (worker.ts:1588 — INTOUCHABLE).
//   Vérifie l'accès pipeline (admin OU users.client_id == pipelines.client_id).
//   SELECT l.deal_value, s.probability, l.status, l.created_at, l.updated_at
//     FROM leads l JOIN pipeline_stages s ON l.stage_id = s.id
//     WHERE l.pipeline_id = ? AND l.status != 'lost'
//   weighted = (deal_value * probability) / 100   ← PONDÉRATION RÉUTILISÉE
//   ⚠ BUG : monthKey = (updated_at|created_at) + 90 JOURS (date close SIMULÉE).
//   Réponse FIGÉE (NE PAS casser sa forme) :
//     json({ data: [{ month, weighted_revenue, deal_count }], total_pipeline_value, weighted_total })
```
⚠ **Cette fonction, sa route, et la forme de sa réponse sont INTOUCHABLES.** Le
moteur enrichi est un AJOUT séparé (`/api/forecast`), il NE remplace PAS celle-ci.

### Colonnes RÉELLES vérifiées sur disque (CRUCIAL Manager-B)

**`leads`** (migration-phase1.sql + seq 1) :
- `deal_value REAL DEFAULT 0` (unité monétaire, PAS cents) ;
- `status` TEXT — won/closed = réalisé, `'lost'` exclu (calque
  reports.ts : `status IN ('won','closed')` pour le réalisé) ;
- `assigned_to TEXT DEFAULT ''` (= **users.id** du commercial — `group_by='rep'`) ;
- `utm_source TEXT DEFAULT ''` (= **source** — `group_by='source'`) ;
- `stage_id` (JOIN `pipeline_stages.probability` pour la pondération) ;
- `created_at` / `updated_at`.

**`orders`** (migration-sprintE1-m1-ecommerce-schema.sql:162) :
- `total_cents INTEGER DEFAULT 0` (**÷100** pour passer en unité monétaire) ;
- `status` ∈ pending/paid/preparing/shipped/delivered/cancelled/refunded
  (réalisé e-commerce = paid/delivered selon choix Manager-B, documenté) ;
- `created_at` / `placed_at`.

**`conversion_baselines`** (seq 113) : `conversion_rate` (0..1) + `sample_size`
par `dimension` (source/status/score_bucket/overall) — LECTURE pour calibrer les
scénarios. `pipeline_stages.probability` = fallback si baseline absente.

### Table NEUVE (seq 114 — manifestée)

```sql
forecast_targets (id PK gen, client_id, agency_id, pipeline_id, assigned_to,
  period_month TEXT, target_amount REAL DEFAULT 0, created_at)
```
`pipeline_id` / `assigned_to` NULLABLES (null = global tenant / équipe).
Zéro FK / zéro CHECK : `group_by` (month|rep|source) et `scenario`
(best|likely|worst) validés HANDLER.

---

## §1 — MIGRATION (seq 114, ADDITIVE)

`migration-forecast-seq114.sql` (racine) — calque seq 113 : 1 `CREATE TABLE IF NOT
EXISTS forecast_targets` + 1 `CREATE INDEX IF NOT EXISTS idx_forecast_targets_client
(client_id, period_month)`. id randomblob, timestamps `datetime('now')`, client_id
NULLABLE schéma (TOUJOURS renseigné handler), **ZÉRO FK, ZÉRO CHECK, ZÉRO
DROP/RENAME/ALTER**. Manifestée `docs/migrations-manifest.json` seq 114
(`depends_on:["migration-conversion-scoring-seq113.sql"]`, risk low). ⚠ **NE touche
NI `leads` NI `orders` NI `pipelines` NI `conversion_baselines`.**

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **INCHANGÉS**. Succès =
**`json({ data })`** ; erreur = **`json({ error }, status)`**. **JAMAIS de champ
`code`**. **AUCUN helper n'envoie de `client_id`** (tenant re-borné worker-side).

```ts
// Forecast enrichi (signature FIGÉE Phase A).
getForecast(params?: { pipeline_id?: string; group_by?: 'month'|'rep'|'source'; period?: string })
  : Promise<ApiResponse<ForecastResponse>>          // GET /forecast(+querystring)
getForecastTargets(params?: { pipeline_id?: string; period?: string })
  : Promise<ApiResponse<{ targets: ForecastTarget[] }>>  // GET /forecast/targets
createForecastTarget(payload: { pipeline_id?, assigned_to?, period_month, target_amount })
  : Promise<ApiResponse<{ id: string }>>            // POST /forecast/targets
deleteForecastTarget(id: string)
  : Promise<ApiResponse<{ success: boolean }>>      // DELETE /forecast/targets/:id
```

### §6.B — Types (`src/lib/types.ts`, FIGÉS Phase A) — ApiResponse INCHANGÉ

```ts
export interface ForecastTarget {
  id: string; client_id?: string | null; agency_id?: string | null;
  pipeline_id?: string | null;   // null = tous pipelines
  assigned_to?: string | null;   // null = équipe, sinon quota commercial (users.id)
  period_month: string;          // 'YYYY-MM'
  target_amount: number;         // unité monétaire (PAS cents)
  created_at?: string;
}
export interface ForecastPoint {
  period_month: string; weighted: number; target?: number; actual?: number;
}
export interface ForecastScenario { best: number; likely: number; worst: number; }
export interface ForecastGroup { key: string; weighted: number; }
export interface ForecastResponse {
  points: ForecastPoint[]; scenarios: ForecastScenario;
  by_rep?: ForecastGroup[]; by_source?: ForecastGroup[]; trend?: ForecastPoint[];
}
```

### §6.C — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

| Route | Méthode | Handler (`./worker/forecast-engine`) |
|---|---|---|
| `/api/forecast` | GET | `handleGetForecast(env, auth, url)` |
| `/api/forecast/targets` | GET | `handleGetForecastTargets(env, auth, url)` |
| `/api/forecast/targets` | POST | `handleCreateForecastTarget(request, env, auth)` |
| `/api/forecast/targets/:id` | DELETE | `handleDeleteForecastTarget(env, auth, id)` |

Placées dans la section **Pipelines** (après `/api/lost-reasons`), **APRÈS
`requireAuth`**. Import STATIQUE en tête (calque `handleGetConversionScore`).
**Anti-shadowing** : `/api/forecast/targets` et `/api/forecast/targets/:id` sont
déclarées **AVANT** `/api/forecast` ; paths EXACTS (pas de regex chevauchante).
capGuard `reports.view` appliqué **DANS le handler** (pas dans le routeur). ⚠ La
route `/api/pipelines/:id/forecast` existante (worker.ts:1588) est **INTOUCHÉE**.

### §6.D — Cron — AUCUN (FIGÉ Phase A)

**Calcul LIVE, pas de cron requis.** Le forecast est calculé à la demande (GET),
borné tenant, déterministe. Aucun job `scheduled()` ajouté. (Manager-B NE pose PAS
de cron.)

### §6.E — Stubs (`src/worker/forecast-engine.ts` — owned Manager-B, stubs posés Phase A)

Signatures **FIGÉES Phase A**, corps Phase B. Type auth :
`ForecastAuth = CapAuth & { capabilities?: Set<string>; id?: string }`. Garde
`forecastCapGuard(auth, 'reports.view')` (mode-agence-only, calque
`conversionCapGuard`). `resolveClientId(auth)` posé. Enums `FORECAST_ENUMS`
(group_by month|rep|source ; scenario best|likely|worst) validés HANDLER.

```ts
handleGetForecast(env, auth, url): Promise<Response>
//   capGuard reports.view + stub json({ data: { points:[], scenarios:{best:0,likely:0,worst:0} } })
handleGetForecastTargets(env, auth, url): Promise<Response>
//   capGuard reports.view + stub json({ data: { targets: [] } })
handleCreateForecastTarget(request, env, auth): Promise<Response>
//   capGuard reports.view + stub json({ data: { id: '' } }, 201)
handleDeleteForecastTarget(env, auth, id): Promise<Response>
//   capGuard reports.view + stub json({ data: { success: true } })
// Tous : + // Manager-B: corps réel
```

### §6.F — i18n (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, FIGÉ Phase A)

Namespace `forecast.*` — **20 clés ×4, parité STRICTE** : `title`,
`weighted_revenue`, `trend`, `projection`, `target`, `actual`, `gap`, `scenario`,
`scenario_best`, `scenario_likely`, `scenario_worst`, `by_rep`, `by_source`,
`period`, `best_month`, `worst_month`, `no_data`, `add_target`, `target_amount`,
`total_pipeline`. fr-CA tutoiement / fr-FR vouvoiement. Clés AVANT usage.
**Manager-C les CONSOMME, n'en AJOUTE PAS** (i18n GELÉ Phase A). ⚠ Source VIVANTE
= `src/lib/i18n/*.ts` (PAS `src/i18n/*.json` legacy).

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned : **`src/worker/forecast-engine.ts` UNIQUEMENT** :
  - **`handleGetForecast`** : revenu pondéré par mois — **CORRIGE le bucketing** :
    remplace le `+90j` naïf par une **heuristique stage→horizon DÉTERMINISTE
    documentée** (ex : map stage.probability → nombre de mois d'horizon, ou
    `period` courant) OU période courante — **NE PAS garder le +90j naïf sans le
    documenter**. RÉUTILISE la pondération `deal_value × pipeline_stages.probability`
    (lecture, comme handleGetPipelineForecast). **+ projection de tendance**
    (moyenne mobile + régression linéaire simple, DÉTERMINISTE) → `trend[]`.
    **+ group_by** `assigned_to` (rep) / `utm_source` (source) → `by_rep[]` /
    `by_source[]`. **+ objectifs vs réalisé** : `forecast_targets` vs réalisé
    (`leads status IN ('won','closed')` × `deal_value` ET/OU `orders.total_cents/100`,
    LECTURE) → `points[].target` / `points[].actual`. **+ scénarios**
    best/likely/worst (facteurs déterministes BORNÉS sur la proba — réutilise
    `conversion_baselines.conversion_rate` si présent, sinon `stage.probability`)
    → `scenarios`.
  - **CRUD `forecast_targets`** : `handleGetForecastTargets` (liste bornée tenant),
    `handleCreateForecastTarget` (client_id depuis l'AUTH, period_month 'YYYY-MM',
    pipeline_id/assigned_to nullables), `handleDeleteForecastTarget`
    (WHERE id = ? AND client_id = ?).
  - Borné tenant (`WHERE client_id = ?`, client_id de l'auth JAMAIS du body),
    **calcul LIVE**, **ZÉRO LLM dur**, **DÉTERMINISTE**, jamais 500 brut. capGuard
    `reports.view`. Enums validés HANDLER. **NE PAS casser** `handleGetPipelineForecast`
    (pipelines.ts) ni sa route ni la forme de sa réponse. **NE PAS importer/modifier**
    reports.ts/dashboard.ts/ecommerce-analytics.ts/conversion-engine.ts au-delà de
    la LECTURE. + tests `__tests__/`.
- **Manager-C (frontend)** owned : **`src/components/pipelines/ForecastView.tsx`** :
  - **migrer vers `apiFetch` + `ApiResponse`** : SUPPRIMER le `fetch` brut +
    `localStorage.getItem('token')` + `as any` ; passer par les helpers §6.A
    (`getForecast`, `getForecastTargets`, `createForecastTarget`,
    `deleteForecastTarget`) ;
  - **brancher i18n `forecast.*`** (remplacer les libellés FR en dur) ;
  - **ajouter** : graphes tendance/projection (`trend[]`), objectifs vs réalisé
    (`points[].target`/`actual`), toggles scénarios best/likely/worst
    (`scenarios`), group-by commercial/source (`by_rep`/`by_source`) ;
  - réutilise `KpiStrip`/`recharts` déjà importés. Manager-C PEUT ajouter une page
    Forecast dédiée si pertinent, mais l'onglet Pipeline existant suffit.
- **INTERDITS aux deux** : migration, manifest, **`src/lib/types.ts`**,
  **`src/lib/api.ts`**, **`src/worker.ts`**, **i18n ×4**, **`src/index.css`** ;
  **`src/worker/pipelines.ts`** (`handleGetPipelineForecast` INTACT, route
  INTACTE) ; **reports.ts** / **dashboard.ts** / **ecommerce-analytics.ts** /
  **conversion-engine.ts** (RÉUTILISÉS en lecture/import — NON modifiés). E4/E6
  inactifs. `forecast-engine.ts` = **Manager-B** ; `ForecastView.tsx` =
  **Manager-C**. **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **Manifest seq 114 — chemin MANIFEST-DRIVEN, PAS le fallback.** L'entrée
   seq 114 est posée Phase A (NE PAS la modifier). `scripts/migrate.ts` est FIGÉ :
   le fichier `migration-forecast-seq114.sql` DOIT figurer au manifest. ✔ vérifié :
   virgule seq 113 ajoutée, JSON valide.
2. **CHECK / FK INTERDITS** dans la migration (additif pur — `group_by` /
   `scenario` validés HANDLER). Zéro DROP / RENAME / ALTER.
3. **NE PAS casser le forecast pondéré existant** : `handleGetPipelineForecast`
   (pipelines.ts), sa route `/api/pipelines/:id/forecast` (worker.ts:1588), et la
   **forme de sa réponse** `{ data, total_pipeline_value, weighted_total }` sont
   INTOUCHABLES. ForecastView.tsx/Pipeline.tsx vivants.
4. **BUG +90j à DOCUMENTER** : la date de close `+90j` naïve
   (pipelines.ts:246-248) est REMPLACÉE par un buckétage DÉTERMINISTE documenté
   (heuristique stage→horizon OU période courante), JAMAIS conservée telle quelle
   sans justification.
5. **DÉTERMINISTE, offline-safe, calcul LIVE** : ZÉRO LLM, ZÉRO cron requis,
   borné tenant. Mock/fallback déterministe, jamais 500 brut.
6. **RÉUTILISER, PAS DUPLIQUER** : pondération `deal_value × stage.probability`
   (comme l'existant), pattern agrégat won/closed (reports.ts:30-41),
   `conversion_baselines` (seq 113) pour la calibration des scénarios. NE PAS
   recoder un scoring.
7. **Capability `reports.view` RÉUTILISÉE** — ZÉRO ajout à `ALL_CAPABILITIES`.
8. **Alias relatifs worker** (`./...`), front `@/`.
9. **i18n `.ts` (PAS `.json`)** — `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, parité
   stricte (20 clés ×4), GELÉE Phase A.
10. **Unités** : `leads.deal_value` = unité monétaire ; `orders.total_cents` =
    **cents** (÷100 avant agrégat). `forecast_targets.target_amount` = unité
    monétaire (PAS cents). Ne pas mélanger.

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-22)

Fichiers **créés** :
1. `migration-forecast-seq114.sql` — table `forecast_targets` + index
   `idx_forecast_targets_client(client_id, period_month)`, ADDITIF (calque
   seq 113). Zéro FK/CHECK/ALTER. Ne touche NI leads NI orders NI pipelines.
2. `src/worker/forecast-engine.ts` — 4 stubs (`handleGetForecast`,
   `handleGetForecastTargets`, `handleCreateForecastTarget`,
   `handleDeleteForecastTarget`), signatures FIGÉES, capGuard `reports.view`,
   `forecastCapGuard` / `resolveClientId` / `FORECAST_ENUMS` posés, corps stub
   `json({ data: ... })` + `// Manager-B: corps réel`. Calque conversion-engine.ts.
3. `docs/LOT-FORECASTING.md` — ce document (§6 FIGÉ).

Fichiers **modifiés** (rigoureusement ADDITIFS) :
1. `docs/migrations-manifest.json` — entrée seq 114 (virgule seq 113 ajoutée,
   JSON valide, `depends_on:["migration-conversion-scoring-seq113.sql"]`).
2. `src/lib/types.ts` — `ForecastTarget`, `ForecastPoint`, `ForecastScenario`,
   `ForecastGroup`, `ForecastResponse` (NEUFS). ApiResponse INCHANGÉ.
3. `src/lib/api.ts` — `getForecast`, `getForecastTargets`, `createForecastTarget`,
   `deleteForecastTarget` (NEUFS) ; import des 2 types ajouté. apiFetch/ApiResponse
   INCHANGÉS. AUCUN client_id envoyé.
4. `src/worker.ts` — import statique des 4 handlers + 4 routes `/api/forecast*`
   (section Pipelines, anti-shadowing /targets avant /forecast). Route
   `/api/pipelines/:id/forecast` INTOUCHÉE.
5. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — namespace `forecast.*` (20 clés ×4,
   parité stricte vérifiée, clés AVANT usage, fr-CA tutoiement / fr-FR vouvoiement).

**Migration** : seq 114 ADDITIVE, manifestée (manifest-driven). **Build** : non
vérifié (VMware sans bun/node) — **délégué côté hôte**.

### Confirmations garde-fous
- **Migration ADDITIVE** : 1 `CREATE TABLE IF NOT EXISTS` + 1 index, zéro
  FK/CHECK/DROP/RENAME/ALTER. Manifest seq 114 (depends_on seq 113) valide.
- **Forecast existant INTOUCHÉ** : `handleGetPipelineForecast` (pipelines.ts), sa
  route, et la forme `{ data, total_pipeline_value, weighted_total }` préservées.
- **Existant RÉUTILISÉ** : pipelines.ts / conversion-engine.ts / reports.ts /
  orders / leads en LECTURE uniquement.
- **ApiResponse INCHANGÉ** (`{ data }` / `{ error }`, jamais `code`).
- **`reports.view`** réutilisée — ZÉRO ajout à `ALL_CAPABILITIES`.
- **Déterministe, offline-safe, calcul LIVE** : ZÉRO LLM, ZÉRO cron, borné tenant.
- **i18n** : source VIVANTE `src/lib/i18n/*.ts` (PAS `src/i18n/*.json` legacy).

### Écarts CODE > brief
- `handleGetPipelineForecast` a la signature `(env, auth: { role; userId }, pipelineId,
  _url)` — auth SIMPLE (role/userId), DIFFÉRENTE du `ForecastAuth` (CapAuth +
  capabilities) du nouveau moteur. Les 2 coexistent : l'existant garde son auth
  simple, le moteur enrichi utilise le choke-point CapAuth (calque conversion-engine).
- Le moteur enrichi est SERVI par des routes NEUVES `/api/forecast*` (PAS un
  paramètre de pipeline) — il agrège au niveau TENANT (`pipeline_id` optionnel en
  filtre), là où l'existant est PAR pipeline. Pas de collision de route.
- **AUCUN cron** posé (§6.D) : forecast = calcul LIVE déterministe à la demande,
  contrairement à conversion-engine (qui avait un cron de baselines).
