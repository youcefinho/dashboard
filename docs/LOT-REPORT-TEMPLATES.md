# LOT REPORT-TEMPLATES — Reports builder : templates + planif dashboard custom (Sprint 15 : le Reports builder existe DÉJÀ à ~85% — `DashboardBuilder.tsx` drag-drop 8 visus + `handleRunReportWidget` moteur whitelist anti-injection (reports.ts:644) + table `dashboards` (seq 51) + `dashboards.ts` CRUD/share + `scheduled-reports.ts` cron + pdfExport — on COMPLÈTE les 2 GAPS, 100% ADDITIF, RÉUTILISANT l'existant)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-FORECASTING.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE des fichiers RÉUTILISÉS,
> jamais le brief).

Sprint **100% ADDITIF**, **migration `migration-reporttemplates-seq115.sql`** (1
table neuve `report_templates`). Le Reports builder existe DÉJÀ — **à RÉUTILISER,
NE PAS reconstruire** :
- `src/components/reports/DashboardBuilder.tsx` : éditeur drag-drop 8 visus +
  schéma `DashboardBuilderValue` (`{ cols, widgets[] }`). **READ-ONLY (import).**
- `src/worker/reports.ts` (`handleRunReportWidget`, ligne 644 + whitelists
  `ALLOWED_SOURCES` ~254 / `DIMENSION_COLUMN` ~284 / `METRIC_EXPR` ~318 +
  `ALLOWED_DIMENSIONS` / `ALLOWED_METRICS`) : moteur widget anti-injection.
  **READ-ONLY / import — GELÉ.**
- `src/worker/dashboards.ts` (`handleCreateDashboard` ligne 382, `ensureDashboardScope`,
  `dashboard_scopes` seq 88) : logique de clone (INSERT `dashboards.config` +
  scope tenant). **READ-ONLY (lecture/réutilisation logique).**
- `src/worker/scheduled-reports.ts` (`processScheduledReports` ligne 461,
  `dashboard_id` INERTE ligne 531, `buildActivityDigestHtml` ligne 612) : cron
  digest. **dashboard_id INERTE → ACTIVÉ en RÉTRO-COMPAT (Manager-B).**

**GAPS comblés :**
- **(A)** aucune table `report_templates` (catalogue clonable) → table NEUVE
  seq 115 + routes `/api/report-templates*`.
- **(B)** `scheduled_reports.dashboard_id` POSÉ (seq 97) mais **INERTE** : le cron
  envoie `buildActivityDigestHtml` générique, jamais le rendu d'un dashboard
  sauvegardé → Manager-B AJOUTE `buildDashboardDigestHtml` branchée dans
  `processScheduledReports` SI `dashboard_id != null`, SINON fallback
  `buildActivityDigestHtml` (rétro-compat).

Alias : imports worker **RELATIFS** (`./...`), JAMAIS `@/`. Front `@/`.

---

## §0 — AUDIT DISQUE (le code fait foi — à RÉUTILISER)

### `src/worker/reports.ts` — `handleRunReportWidget` (ligne 644, GELÉ)

**Signature EXACTE (FIGÉE — NE PAS la changer, NE PAS toucher la route) :**
```ts
export async function handleRunReportWidget(
  request: Request,
  env: Env,
  auth: WidgetAuth,
): Promise<Response>;
//   Route : POST /api/reports/widget (INTOUCHABLE).
//   Body strict { source, dimension, metric, filters?, dashboard_id? }.
//   capGuard 'reports.view' (mode-agence-only, l.651-654).
//   Whitelist STRICTE anti-injection (JAMAIS de string libre dans le SQL) :
//     - ALLOWED_SOURCES (Set, ligne 254)        — source ∈ leads|tasks|invoices|
//                                                  orders|agency|conversations|events
//     - ALLOWED_DIMENSIONS / DIMENSION_COLUMN (ligne 284) — dimension whitelistée
//     - ALLOWED_METRICS / METRIC_EXPR (ligne 318)         — metric whitelistée
//   source/dimension/metric hors whitelist ⇒ json({ error: '...' }, 400).
//   Si dashboard_id fourni : loadDashboardInTenant (borné tenant) sinon 404.
//   Réponse : json({ data: { series, total } }).
```
⚠ **Cette fonction, ses whitelists, et sa route sont GELÉES — LECTURE/IMPORT
SEULEMENT.** Le clone d'un template RÉUTILISE ces whitelists pour VALIDER chaque
widget de la config AVANT INSERT (JAMAIS de SQL libre, jamais un widget hors
whitelist persisté).

### `src/worker/dashboards.ts` — `handleCreateDashboard` (ligne 382, RÉUTILISÉ)

**Signature + logique de clone (RÉUTILISÉE par Manager-B) :**
```ts
export async function handleCreateDashboard(
  request: Request,
  env: Env,
  auth: DashboardAuth,   // = CapAuth & { capabilities?: Set<string>; id?: string }
): Promise<Response>;
//   capGuard 'workflows.manage' (reportsCapGuard, l.387 — calque de CE LOT).
//   const name = sanitizeInput(body?.name).slice(0,120);
//   const config = body?.config ?? { widgets: [], cols: 12 };  ← DashboardBuilderValue
//   INSERT INTO dashboards (user_id, name, config) VALUES (?, ?, ?)
//     bind(userId, name, JSON.stringify(config));
//   id = result.meta.last_row_id;   ← dashboards.id = INTEGER AUTOINCREMENT
//   if (id != null) await ensureDashboardScope(env, id, auth);  ← scope tenant
//   return json({ data: { id, user_id, name, config, share_token: null } }, 201);
```
⚠ **`dashboards.id` est INTEGER AUTOINCREMENT** (seq 51). Le helper `applyReportTemplate`
front retourne `{ dashboard_id: string }` (id sérialisé en string — apiFetch).
Le clone matérialise un `dashboards` via cette LOGIQUE (Manager-B peut réutiliser
le helper interne ou répliquer l'INSERT borné + `ensureDashboardScope`), JAMAIS un
ALTER de `dashboards`.

### `DashboardBuilderValue` — schéma `config` (src/components/reports/DashboardBuilder.tsx)

```ts
type WidgetType = 'kpi'|'barchart'|'linechart'|'donut'|'table'|'map'|'funnel'|'heatmap';
type WidgetSize = '1x1'|'2x1'|'2x2';
type WidgetDataSource = 'leads'|'tasks'|'conversations'|'events'|'invoices';
type WidgetMetric = 'count'|'sum'|'avg'|'median'|'min'|'max';

interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  size: WidgetSize;
  source: WidgetDataSource;          // datasource canonique
  filters: { dateRange?: '7d'|'30d'|'90d'|'12m'|'all'; source?: string|null;
             status?: string|null; tags?: string[] };
  dimension?: string;                // groupBy
  metric: WidgetMetric;
  display: { color?: string; showLegend?: boolean; showLabels?: boolean };
}

interface DashboardBuilderValue {
  cols: number;                      // toujours 12
  widgets: WidgetConfig[];
}
//   createEmptyDashboard() => { cols: 12, widgets: [] }
```
⚠ C'est le format de `report_templates.config` ET de `dashboards.config` (clone
byte-compatible). VALIDATION clone : chaque `widget.source` ∈ `ALLOWED_SOURCES`,
`widget.dimension` ∈ whitelist dimension, `widget.metric` mappé — réutiliser les
whitelists reports.ts (NE PAS recoder).

### `src/worker/scheduled-reports.ts` — `processScheduledReports` + `dashboard_id` (RÉTRO-COMPAT)

```ts
export async function processScheduledReports(env: Env): Promise<void>;
//   Boucle sur scheduled_reports échus (status='active' AND next_run_at<=now).
//   Pour chaque row (borné row.client_id) :
//     - recipients = parseRecipients(row.recipients) ; si vide ⇒ avance échéance.
//     - LIGNE 531 (POINT D'ACTIVATION dashboard_id, ACTUELLEMENT INERTE) :
//         const digest = await buildActivityDigestHtml(env, clientId, row.cadence);
//       ⇒ Manager-B BRANCHE ICI le rétro-compat (cf. §6.H).
//     - envoi Resend best-effort (mock honnête sans clé) ; SUR SUCCÈS : avance
//       next_run_at + last_sent_at.
//   BEST-EFFORT STRICT : ne throw JAMAIS ; échec d'un row ⇒ next_run_at intact
//   (réessai), boucle continue.

export async function buildActivityDigestHtml(
  env: Env, clientId: string, cadence: string,
): Promise<{ subject: string; html: string; text: string }>;
//   SELECT leads BORNÉS WHERE client_id = ? (FLAG A1 : JAMAIS handleReportsOverview).
//   Digest HTML générique (nouveaux / convertis / perdus sur la cadence).
```
⚠ `scheduled_reports.dashboard_id INTEGER` (seq 97, l.76) référence
`dashboards.id` (INTEGER) — jointure APPLICATIVE. Le PATCH existant
`/api/scheduled-reports/:id` (`handleUpdateScheduledReport`) accepte DÉJÀ
`dashboard_id` (l.344-348) — Manager-C le PEUPLE, AUCUNE route nouvelle.

### Table NEUVE (seq 115 — manifestée)

```sql
report_templates (id PK gen, client_id, agency_id, name, description, category,
  config TEXT, is_system INTEGER DEFAULT 0, created_at, updated_at)
```
`client_id` / `agency_id` NULL = template SYSTÈME global (is_system=1, lecture pour
tous). `config` = JSON `DashboardBuilderValue`. Zéro FK / zéro CHECK : `category`
validé HANDLER. Index `idx_report_templates_scope(agency_id, client_id)`.

---

## §1 — MIGRATION (seq 115, ADDITIVE)

`migration-reporttemplates-seq115.sql` (racine) — calque seq 97/88 : 1 `CREATE
TABLE IF NOT EXISTS report_templates` + 1 `CREATE INDEX IF NOT EXISTS
idx_report_templates_scope(agency_id, client_id)`. id randomblob, timestamps
`datetime('now')`, client_id/agency_id NULLABLES (NULL = système), **ZÉRO FK,
ZÉRO CHECK, ZÉRO DROP/RENAME/ALTER**. Manifestée `docs/migrations-manifest.json`
seq 115 (`depends_on:["migration-forecast-seq114.sql"]`, risk low). ⚠ **NE touche
NI `dashboards` NI `scheduled_reports` NI `clients` NI `agencies`.**

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **INCHANGÉS**. Succès =
**`json({ data })`** ; erreur = **`json({ error }, status)`**. **JAMAIS de champ
`code`**. **AUCUN helper n'envoie de `client_id`** (tenant re-borné worker-side).

```ts
// Templates de dashboard (signatures FIGÉES Phase A).
getReportTemplates(): Promise<ApiResponse<ReportTemplate[]>>          // GET /report-templates
applyReportTemplate(id: string): Promise<ApiResponse<{ dashboard_id: string }>>
                                                                     // POST /report-templates/:id/apply
```

### §6.B — Types (`src/lib/types.ts`, FIGÉS Phase A) — ApiResponse INCHANGÉ

```ts
export interface ReportTemplate {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  config: unknown;          // JSON DashboardBuilderValue { cols, widgets[] }
  is_system: number;        // 1 = catalogue système
}
```

### §6.C — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

| Route | Méthode | Handler (`./worker/report-templates`) | capGuard |
|---|---|---|---|
| `/api/report-templates` | GET | `handleGetReportTemplates(env, auth)` | `reports.view` |
| `/api/report-templates/:id/apply` | POST | `handleApplyReportTemplate(env, auth, id)` | `workflows.manage` |

Placées dans la section **Dashboards** (après `/api/dashboards/:id/share`),
**APRÈS `requireAuth`**. Import STATIQUE en tête (calque `handleGetDashboards`).
**Anti-shadowing** : `/api/report-templates/:id/apply` est un path EXACT
(`/^\/api\/report-templates\/([^/]+)\/apply$/`) déclaré APRÈS la liste — pas de
chevauchement. capGuard appliqué **DANS le handler** (pas dans le routeur). ⚠ Les
routes `/api/reports/*` (data) et `/api/scheduled-reports/*` (planif) sont
**INTOUCHÉES** — la planif réutilise le PATCH existant
`/api/scheduled-reports/:id` qui accepte DÉJÀ `dashboard_id`.

### §6.D — Cron — branché EXISTANT (FIGÉ Phase A)

**AUCUN nouveau cron / route scheduled().** Le digest dashboard custom passe par
le cron `processScheduledReports` EXISTANT (déjà branché best-effort dans
`scheduled()`). Manager-B AJOUTE seulement `buildDashboardDigestHtml` + un
branchement rétro-compat à la ligne 531 (cf. §6.H). Le calcul du catalogue/clone
est LIVE (GET/POST), borné tenant.

### §6.E — Stubs (`src/worker/report-templates.ts` — owned Manager-B, stubs posés Phase A)

Signatures **FIGÉES Phase A**, corps Phase B. Type auth :
`ReportTemplateAuth = CapAuth & { capabilities?: Set<string>; id?: string }`.
Garde `templatesCapGuard(auth, cap)` (mode-agence-only, calque
`dashboards.ts:reportsCapGuard`). `resolveClientId(auth)` posé (auth, JAMAIS body).

```ts
handleGetReportTemplates(env, auth): Promise<Response>
//   capGuard reports.view + stub json({ data: [] })
handleApplyReportTemplate(env, auth, id): Promise<Response>
//   capGuard workflows.manage + stub json({ data: { dashboard_id: '' } }, 201)
// Tous : + // Manager-B: corps réel
```

### §6.F — i18n (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, FIGÉ Phase A)

Namespace `reports.templates.*` — **6 clés + 1 clé** `reports.scheduled.dashboard`
= **7 clés ×4, parité STRICTE** : `reports.templates.title`,
`reports.templates.apply`, `reports.templates.applied`, `reports.templates.empty`,
`reports.templates.category`, `reports.templates.use_this`, +
`reports.scheduled.dashboard` (sélecteur de dashboard à planifier). Insérées APRÈS
`reports.scheduled.day_7` (clés AVANT usage). fr-CA tutoiement / fr-FR vouvoiement.
**Manager-C les CONSOMME, n'en AJOUTE PAS** (i18n GELÉ Phase A). ⚠ Source VIVANTE
= `src/lib/i18n/*.ts` (PAS `src/i18n/*.json` legacy).

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned :
  - **`src/worker/report-templates.ts`** :
    - **`handleGetReportTemplates`** : liste = templates SYSTÈME (is_system=1 AND
      client_id IS NULL) UNION templates du tenant bornés (`WHERE client_id = ?`
      [+ agency_id], depuis l'AUTH JAMAIS body). Parse config best-effort. Jamais
      d'exposition cross-tenant.
    - **`handleApplyReportTemplate`** : (1) charge le template par `id` borné
      (système OU tenant courant), 404 sinon (zéro leak) ; (2) **VALIDE la config
      JSON** (`{cols,widgets[]}`) widget par widget via les whitelists reports.ts
      (`ALLOWED_SOURCES`/dimension/metric) — rejet 400 si hors whitelist, **JAMAIS
      de SQL libre** ; (3) **clone via la LOGIQUE `handleCreateDashboard`**
      (dashboards.ts) : INSERT `dashboards.config` borné tenant +
      `ensureDashboardScope` ; (4) retourne `{ dashboard_id }` (id du nouveau
      dashboard, sérialisé string).
  - **`src/worker/scheduled-reports.ts`** : **activer `dashboard_id` (inerte
    l.531)** : ajouter **`buildDashboardDigestHtml(env, clientId, dashboardId)`**
    (NEUVE) qui lit `dashboards.config` **borné tenant** + appelle le moteur
    widget interne (RÉUTILISE `handleRunReportWidget`/whitelist) pour rendre les
    widgets en HTML. **Branchement** dans `processScheduledReports` :
    `if (row.dashboard_id != null) digest = await buildDashboardDigestHtml(env,
    clientId, row.dashboard_id); else digest = await buildActivityDigestHtml(env,
    clientId, row.cadence);` — **RÉTRO-COMPAT stricte** (dashboard_id NULL =
    comportement v1 byte-équivalent). BEST-EFFORT (échec dashboard ⇒ fallback ou
    next_run_at intact, jamais throw).
  - Borné tenant (`WHERE client_id = ?`, client_id de l'auth JAMAIS du body),
    capGuard `reports.view` (lecture) / `workflows.manage` (clone), category
    validée HANDLER. **NE PAS modifier** `reports.ts` / `dashboards.ts` (RÉUTILISÉS
    par import/lecture — `handleRunReportWidget` / `handleCreateDashboard` GELÉS).
    Jamais 500 brut. + tests `__tests__/`.
- **Manager-C (frontend)** owned :
  - **`src/components/reports/ReportTemplatesGallery.tsx`** (NEUF) : galerie des
    templates (`getReportTemplates`) + bouton **« Utiliser ce modèle »**
    (`reports.templates.use_this`) → `applyReportTemplate(id)` → navigue vers le
    builder/dashboard nouvellement créé (`dashboard_id`). i18n `reports.templates.*`.
  - **`src/pages/Reports.tsx`** : onglet **`templates`** ADDITIF (ajouter au `TABS`
    + `VALID_TABS` + le `switch (activeTab)` — additif, NE PAS retoucher les
    onglets existants `builder` / `scheduled` / etc.).
  - **`src/components/reports/ScheduledReportsPanel.tsx`** : **sélecteur de
    dashboard à planifier** (`reports.scheduled.dashboard`) qui peuple
    `dashboard_id` via le **PATCH existant** `/api/scheduled-reports/:id` (helper
    api déjà câblé `dashboard_id` accepté). Liste les dashboards via l'API
    dashboards existante.
- **INTERDITS aux deux** : migration, manifest, **`src/lib/types.ts`**,
  **`src/lib/api.ts`**, **`src/worker.ts`**, **i18n ×4**, **`src/index.css`** ;
  **`src/worker/reports.ts`** (`handleRunReportWidget` + whitelists INTACTS,
  lecture/import) ; **`src/worker/dashboards.ts`** (`handleCreateDashboard`
  INTACT, lecture/import) ; **`src/components/reports/DashboardBuilder.tsx`**
  (lecture/import). E4/E6 inactifs (whitelist exclut déjà payments).
  `report-templates.ts` + `scheduled-reports.ts` (`buildDashboardDigestHtml`) =
  **Manager-B** ; `ReportTemplatesGallery.tsx` / `Reports.tsx` /
  `ScheduledReportsPanel.tsx` = **Manager-C**. **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **Manifest seq 115 — chemin MANIFEST-DRIVEN.** Entrée seq 115 posée Phase A
   (NE PAS la modifier). `scripts/migrate.ts` FIGÉ : le fichier
   `migration-reporttemplates-seq115.sql` DOIT figurer au manifest. ✔ vérifié :
   virgule seq 114 ajoutée, JSON valide.
2. **CHECK / FK INTERDITS** dans la migration (additif pur — `category` validé
   HANDLER). Zéro DROP / RENAME / ALTER.
3. **NE PAS casser** : `reports.ts` (`handleRunReportWidget` INTACT),
   `dashboards.ts`, `scheduled-reports.ts` (CRUD/cron), `DashboardBuilder.tsx`.
4. **`dashboard_id` RÉTRO-COMPAT** : activation à l.531 = fallback
   `buildActivityDigestHtml` SI `dashboard_id` NULL. v1 byte-équivalent préservé.
5. **WHITELIST RÉUTILISÉE, JAMAIS de SQL libre** : le clone valide chaque widget
   via `ALLOWED_SOURCES`/dimension/metric de reports.ts. Le digest dashboard
   réutilise le moteur widget. NE PAS recoder un moteur de requêtes.
6. **CLONE = config VALIDÉE HANDLER** avant INSERT dans `dashboards.config` (via
   la logique `handleCreateDashboard`). Jamais d'INSERT de config non validée.
7. **BORNAGE TENANT depuis l'AUTH** (`resolveClientId`), JAMAIS le body/URL.
   Templates système (client_id NULL) lus à part ; tenant bornés `WHERE client_id = ?`.
8. **Capability** : lecture `reports.view`, écriture/clone `workflows.manage`
   (calque dashboards.ts:387 — **PAS** de `reports.manage` qui n'existe pas).
   **ZÉRO ajout à `ALL_CAPABILITIES`.**
9. **Alias relatifs worker** (`./...`), front `@/`.
10. **i18n `.ts` (PAS `.json`)** — `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, parité
    stricte (7 clés ×4), GELÉE Phase A.

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-22)

Fichiers **créés** :
1. `migration-reporttemplates-seq115.sql` — table `report_templates` + index
   `idx_report_templates_scope(agency_id, client_id)`, ADDITIF (calque seq 97/88).
   Zéro FK/CHECK/ALTER. Ne touche NI dashboards NI scheduled_reports.
2. `src/worker/report-templates.ts` — 2 stubs (`handleGetReportTemplates`,
   `handleApplyReportTemplate`), signatures FIGÉES, capGuard reports.view /
   workflows.manage, `templatesCapGuard` / `resolveClientId` posés, corps stub
   `json({ data: ... })` + `// Manager-B: corps réel`. Calque dashboards.ts /
   forecast-engine.ts.
3. `docs/LOT-REPORT-TEMPLATES.md` — ce document (§6 FIGÉ).

Fichiers **modifiés** (rigoureusement ADDITIFS) :
1. `docs/migrations-manifest.json` — entrée seq 115 (virgule seq 114 ajoutée,
   JSON valide, `depends_on:["migration-forecast-seq114.sql"]`).
2. `src/lib/types.ts` — `ReportTemplate` (NEUF). ApiResponse INCHANGÉ.
3. `src/lib/api.ts` — `getReportTemplates`, `applyReportTemplate` (NEUFS) ; import
   du type `ReportTemplate` ajouté. apiFetch/ApiResponse INCHANGÉS. AUCUN
   client_id envoyé.
4. `src/worker.ts` — import statique des 2 handlers + 2 routes
   `/api/report-templates*` (section Dashboards, anti-shadowing /apply path exact).
   Routes /api/reports/* et /api/scheduled-reports/* INTOUCHÉES.
5. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — namespace `reports.templates.*` (6 clés)
   + `reports.scheduled.dashboard` = 7 clés ×4, parité stricte vérifiée, clés
   AVANT usage, fr-CA tutoiement / fr-FR vouvoiement.

**Migration** : seq 115 ADDITIVE, manifestée (manifest-driven). **Build** : non
vérifié (VMware sans bun/node) — **délégué côté hôte**.

### Confirmations garde-fous
- **Migration ADDITIVE** : 1 `CREATE TABLE IF NOT EXISTS` + 1 index, zéro
  FK/CHECK/DROP/RENAME/ALTER. Manifest seq 115 (depends_on seq 114) valide.
- **Existant INTOUCHÉ** : `handleRunReportWidget` + whitelists (reports.ts),
  `handleCreateDashboard` (dashboards.ts), `DashboardBuilder.tsx` — lecture/import.
- **`dashboard_id` RÉTRO-COMPAT** : activation HANDLER (Manager-B), fallback
  `buildActivityDigestHtml` si NULL — v1 byte-équivalent.
- **ApiResponse INCHANGÉ** (`{ data }` / `{ error }`, jamais `code`).
- **Capabilities** `reports.view` (lecture) / `workflows.manage` (clone) RÉUTILISÉES
  — ZÉRO ajout à `ALL_CAPABILITIES`. PAS de `reports.manage`.
- **Sécurité clone** : config VALIDÉE HANDLER (whitelist) avant INSERT, JAMAIS de
  SQL libre. Bornage tenant depuis l'auth.
- **i18n** : source VIVANTE `src/lib/i18n/*.ts` (PAS `src/i18n/*.json` legacy).

### Écarts CODE > brief
- **`dashboards.id` = INTEGER AUTOINCREMENT** (seq 51), tandis que
  `report_templates.id` = TEXT (randomblob). Le clone produit un `dashboards.id`
  INTEGER ; le helper `applyReportTemplate` renvoie `{ dashboard_id: string }`
  (id sérialisé string via apiFetch). Manager-B sérialise `String(id)` au retour.
- **`scheduled_reports.dashboard_id` = INTEGER** (seq 97) → cohérent avec
  `dashboards.id` INTEGER (jointure applicative). Le PATCH
  `handleUpdateScheduledReport` accepte DÉJÀ `dashboard_id` (l.344-348) — Manager-C
  le peuple, AUCUNE route nouvelle (planif).
- **Le digest dashboard custom RÉUTILISE le cron EXISTANT** `processScheduledReports`
  (pas de nouveau cron) ; seul `buildDashboardDigestHtml` + le branchement l.531
  sont ajoutés (Manager-B).
- Stub `handleApplyReportTemplate` retourne `201` (création d'un dashboard), calque
  `handleCreateDashboard`.
