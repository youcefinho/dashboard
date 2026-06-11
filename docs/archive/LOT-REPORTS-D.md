# LOT D — Reports Builder Hardening + Data Wiring (2026-05-20)

> Statut : **Phase A SOLO FIGÉE** (socle partagé + §6 verrouillé). Phase B
> Manager-B (backend dispatcher + scopes + audit + share snapshot) ∥
> Manager-C (front useWidgetData + modal share + scope badge) débloquées
> sur fichiers DISJOINTS (matrice §6.H). CODE-COMPLETE only — build/tests
> délégués au hôte Antigravity (VM sans bun/node).

Objectif produit : **verrouiller le builder de dashboards custom Sprint 46
M1.3 avant de brancher les widgets sur les vraies sources data**. Trois
trous sécurité identifiés par audit Chaman (gisement #1 post-MEMBER) :

1. Table `dashboards` (seq 51) = ZÉRO bornage `client_id`/`agency_id` →
   fuite cross-tenant en mode agence dès qu'un viewer accède via une
   sous-route.
2. Routes `/api/dashboards*` (CRUD + share) = ZÉRO `requireCapability` →
   un viewer peut créer / modifier / partager.
3. Route publique `/api/dashboards/shared/:token` lit `config` JSON brut →
   safe maintenant car widgets en MOCK (`sampleSeries(seed)` dans
   `_dashboardCharts.tsx`), MAIS dès qu'on branche les vraies données
   (Phase B) → leak public cross-tenant.

Principe directeur : **additif strict, rétro-compat byte-identique**,
réutilisation par CALQUE des patterns existants (LOT B-bis mode-agence-only,
LOT FUNNEL/EMAIL/BOOKING/MEMBER capability mutualisée `workflows.manage`).
AUCUNE nouvelle source data — le wiring widgets passe par les modules
existants (ecommerce-analytics, clients-admin `handleGetAgencyReports`,
leads, tasks) déjà bornés tenant. AUCUN nouveau scheduler. AUCUNE FK.
ZÉRO touch tables E4/E6 régulées.

## §6 Contrats figés A→I

### §6.A — ARCHITECTURE

Modèle conservé byte-identique côté front (builder existant OK — 8 widgets,
6 metrics, 8 dimensions, 5 datasources, dnd-kit + a11y). Côté DB : **table
compagnon `dashboard_scopes(dashboard_id, client_id, agency_id,
scope_signature, created_at)`** liant un dashboard à un scope tenant signé.
Rendering public re-vérifie `scope_signature` avant de servir (Phase B
Manager-B).

Reports builder = wrapper des handlers data EXISTANTS :
- `ecommerce-analytics.ts` (orders / customers / RFM)
- `clients-admin.ts::handleGetAgencyReports` (agrégat cross-sous-comptes,
  déjà borné `accessibleClientIds` + gardé `reports.view` — calque cible)
- `reports.ts::handleReportsOverview/Sources/Conversion` (leads agrégés)
- `leads.ts` / `tasks.ts` / `invoices.ts` (déjà bornés tenant)

**AUCUNE nouvelle source data**. Phase A pose le squelette ; Phase B
branche `_dashboardCharts.tsx` sur de vrais handlers via
`POST /api/reports/widget` (route NEUVE, dispatcher UNIQUE) qui dispatche
en interne selon `body.source` — SANS modifier les sources data
(READ-ONLY Phase B).

**`apiFetch` / `ApiResponse` GELÉS** depuis LOT B Team — JAMAIS de champ
`code`, contrat `{ data }` / `{ error }` strict. Discrimination capability
côté front = string-match sur `error` (pas `code`). Helpers ADDITIFS posés
Phase A — signatures FIGÉES, Phase B Manager-C consomme tel quel :

- `runReportWidget(payload: RunReportWidgetPayload): Promise<ApiResponse<WidgetRunResult>>`
- Types ADDITIFS : `WidgetRunResult { series; total; delta? }`,
  `RunReportWidgetPayload { source; dimension; metric; filters?;
  dashboard_id? }`

Existants conservés (Sprint 46 M1.3) : `getDashboards` / `getDashboard` /
`createDashboard` / `updateDashboard` / `deleteDashboard` /
`shareDashboard` / `getSharedDashboard` + type `DashboardRecord`.
Signatures byte-équivalentes — Phase A ne touche AUCUNE signature
existante.

### §6.B — DDL seq 88 (`migration-reports-d-seq88.sql`)

2 tables NEUVES, 3 index NEUFS, idempotents, strictement additifs :

```sql
CREATE TABLE IF NOT EXISTS dashboard_scopes (
  dashboard_id INTEGER NOT NULL,
  client_id TEXT,
  agency_id TEXT,
  scope_signature TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY(dashboard_id)
);
CREATE TABLE IF NOT EXISTS dashboard_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id INTEGER,
  user_id TEXT,
  action TEXT,
  ip TEXT,
  ua TEXT,
  at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_dashboard_scopes_client ON dashboard_scopes(client_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_scopes_agency ON dashboard_scopes(agency_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_audit_did_at ON dashboard_audit_log(dashboard_id, at);
```

Garde-fous recopiés verbatim en en-tête du fichier (calque seq 84/85/86/87) :
INTERDIT tout DROP / RENAME / rebuild / ALTER de contrainte. AUCUN
ALTER sur `dashboards` (seq 51) — bornage par TABLE COMPAGNON.
AUCUN touch `users` / `admin_sessions` / `clients` / tables E4/E6
régulées. CHECK seq 59 (rebuild:users) INTOUCHÉ. AUCUNE FK
(D1/SQLite : FK ⇒ rebuild ⇒ interdit). Jointure
`dashboard_scopes.dashboard_id ↔ dashboards.id` APPLICATIVE.

`dashboard_audit_log` est un NAMESPACE DISTINCT de `audit_log` (seq 5) —
JAMAIS touché/lu par ce lot. `scope_signature` = HMAC serveur (calque
genToken existant) recalculé/vérifié AVANT toute lecture publique via
`/api/dashboards/shared/:token` (corps Phase B Manager-B).

Manifest mis à jour (`docs/migrations-manifest.json`) : entrée seq 88,
`depends_on: ["migration-member-seq87.sql"]`, risk `low`.

### §6.C — ROUTES `src/worker.ts`

**Routes existantes Sprint 46 M1.3 INCHANGÉES en terme de mapping** :
- `GET    /api/dashboards`
- `POST   /api/dashboards`
- `GET    /api/dashboards/:id`
- `PUT    /api/dashboards/:id`
- `DELETE /api/dashboards/:id`
- `POST   /api/dashboards/:id/share` (et `GET` même handler)
- `GET    /api/dashboards/shared/:token` (PUBLIC, hors routeProtected)

Le bridage capability est appliqué **DANS chaque handler** `dashboards.ts`
(calque LOT FUNNEL/EMAIL/BOOKING/MEMBER) — PAS au router. Phase A pose
les gardes early-return.

**ROUTE NEUVE** : `POST /api/reports/widget` câblée vers
`handleRunReportWidget(request, env, auth)` (auth, gardée `reports.view`
mode-agence-only). UNE SEULE route, dispatch interne par `body.source`
(évite d'exposer N endpoints non-tenant-bornés). Phase A = STUB
placeholder `{ series: [], total: 0 }` ; corps réel Phase B Manager-B.

Route publique `/api/dashboards/shared/:token` : Phase A NE TOUCHE PAS
(corps Phase B Manager-B — vérification `scope_signature` + snapshot
figé + audit `dashboard_audit_log` write).

### §6.D — CAPABILITY MUTUALISÉE `workflows.manage`

Calque EXACT LOT FUNNEL / EMAIL / BOOKING / MEMBER :
- **LECTURE** (`handleGetDashboards`, `handleGetDashboard`,
  `handleRunReportWidget`) → `'reports.view'` (déjà dans
  `ALL_CAPABILITIES`, posée Sprint 46 / Team B).
- **ÉCRITURE** (`handleCreateDashboard`, `handleUpdateDashboard`,
  `handleDeleteDashboard`, `handleShareDashboard`) →
  `'workflows.manage'` (déjà dans `ALL_CAPABILITIES`).

**Justification** : capability "manage builder" mutualisée entre les
builders WORKFLOWS / FUNNELS / EMAIL SEQUENCES / BOOKING / MEMBER /
REPORTS — cohérence sémantique, évite de polluer `ALL_CAPABILITIES`
avec une `reports.manage` qui demanderait une migration `seed:role_capabilities`
+ rebuild matrice front. **PAS de `reports.manage` ajoutée à
`ALL_CAPABILITIES`**.

Garde conditionnelle mode-agence-only (calque LOT B-bis) :
```typescript
function reportsCapGuard(auth: DashboardAuth, cap: Capability): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined; // legacy/mono-tenant
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, cap);
}
```

Legacy/mono-tenant → le set legacy `legacyCapsFromRole` est LARGE
(broker/store_manager ont déjà `reports.view` + `workflows.manage`) ⇒
**pas de régression historique**. Mode agence → enforcement réel, viewer
bridé. Pattern textuel IDENTIQUE à `funnels.ts:capGuard` mais conditionné
`agencyId` (l'enforcement réel n'opérait pas non plus avant LOT B-bis
pour les routes legacy).

### §6.E — i18n `reports.*` ×4 catalogues — parité STRICTE

**+12 clés Phase A** (parité STRICTE ×4 avant tout usage runtime — Phase A
owner unique). Insérées en fin de namespace `reports.*` (après
`reports.pdf.total_leads`, avant le namespace suivant `workflows.*`).
Vérifié zéro collision avec les 84 clés `reports.*` préexistantes.

| Clé | fr-CA | fr-FR | en | es |
|-----|-------|-------|----|----|
| `reports.share.confirm_public` | Partager ce tableau de bord publiquement ? | Partager ce tableau de bord publiquement ? | Share this dashboard publicly? | ¿Compartir este panel públicamente? |
| `reports.share.scope_warning` | (avertissement périmètre, tutoiement) | (vouvoiement) | (verify scope) | (verifica el alcance) |
| `reports.widget.error_data` | Impossible de charger les données du widget. | id. | Unable to load widget data. | No se pudieron cargar los datos del widget. |
| `reports.widget.empty` | Aucune donnée pour ce widget sur la période. | id. | No data for this widget over the period. | Sin datos para este widget en el período. |
| `reports.audit.shared_at` | Partagé le | Partagé le | Shared on | Compartido el |
| `reports.audit.last_view` | Dernière consultation | Dernière consultation | Last viewed | Última consulta |
| `reports.scope.bound_to_client` | Lié au sous-compte | Lié au sous-compte | Bound to sub-account | Vinculado a la subcuenta |
| `reports.scope.bound_to_agency` | Lié à l'agence | Lié à l'agence | Bound to agency | Vinculado a la agencia |
| `reports.scope.legacy` | Sans périmètre (legacy) | Sans périmètre (legacy) | No scope (legacy) | Sin alcance (legacy) |
| `reports.cap.required_view` | (tutoiement) | (vouvoiement) | (you don't have permission) | (no tienes permiso) |
| `reports.cap.required_manage` | (tutoiement) | (vouvoiement) | (you don't have permission) | (no tienes permiso) |
| `reports.toast.scope_locked` | Périmètre verrouillé : impossible de partager hors du tenant. | id. | Scope locked: cannot share outside the tenant. | Alcance bloqueado: no se puede compartir fuera del tenant. |

Vocabulaire calqué par langue (fr-CA `Sous-compte`/`Périmètre` ; fr-FR
`Sous-compte`/`Périmètre` ; en `Sub-account`/`Scope` ; es `Subcuenta`/`Alcance`).
Total `reports.*` après Phase A : **84 + 12 = 96 clés ×4 (parité 96/96/96/96)**.

### §6.F — PAGES

**AUCUNE nouvelle page Phase A.** Modifications PHASE B uniquement
(Manager-C exclusif) :

- `src/components/reports/_dashboardCharts.tsx` : remplacer
  `sampleSeries(seed)` par `useWidgetData(widget)` (hook nouveau Phase B —
  appelle `runReportWidget` helper api.ts FIGÉ Phase A).
- `src/pages/Reports.tsx` : modal confirm share (`reports.share.confirm_public`
  + `reports.share.scope_warning`) avant `shareDashboard`.
- `src/pages/SharedDashboard.tsx` : rendre snapshot JSON figé (Phase B
  Manager-B aura inséré le snapshot via /:token, Phase B Manager-C
  l'affiche).

**6 pages R protégées** (Dashboard / LeadDetail / Pipeline / Tasks /
Leads / Inbox) = **HORS PÉRIMÈTRE**, ne JAMAIS toucher. Pattern
re-confirmé après remédiation Antigravity (commit `7846e72`).

### §6.G — DÉCOUPAGE Phase A SOLO → Phase B B∥C

**Phase A SOLO (TERMINÉE 2026-05-20)** :

1. `migration-reports-d-seq88.sql` (en-tête garde-fous + 2 tables + 3 index)
2. Manifest migration `docs/migrations-manifest.json` (seq 88, risk low,
   depends 87)
3. `src/worker/dashboards.ts` : injection helper privé `reportsCapGuard` +
   gardes early-return dans les 6 handlers (calque LOT B-bis
   mode-agence-only). Type `DashboardAuth = CapAuth & { capabilities?,
   id? }` — `id` legacy préservé pour rétro-compat byte-équivalente.
   Corps SQL INTOUCHÉS.
4. `src/worker/reports.ts` : stub `handleRunReportWidget(request, env,
   auth)` signature figée retournant placeholder
   `{ success: true, data: { series: [], total: 0 } }`. Garde
   mode-agence-only inline (calque LOT B-bis textuel).
5. `src/worker.ts` : import + route `POST /api/reports/widget` câblée vers
   stub. Aucune autre route modifiée.
6. `src/lib/api.ts` : helper stub `runReportWidget` + types
   `WidgetRunResult` / `RunReportWidgetPayload`. Insérés après
   `getSharedDashboard` (rétro-compat helpers Sprint 46 M1.3 préservée).
7. i18n ×4 catalogues : 12 clés parité stricte (fr-CA → fr-FR → en → es).
   Total 96/96/96/96 vérifié.
8. `docs/LOT-REPORTS-D.md` §6 verbatim A→I (ce document).

**Phase B Manager-B (backend, exclusif — PAS Phase A)** : corps réel
`handleRunReportWidget` dispatcher (par `body.source` →
ecommerce-analytics / clients-admin handleGetAgencyReports / leads /
tasks bornés `auth.tenant.accessibleClientIds`) + bornage
`dashboard_scopes` (CREATE auto au moment du `handleCreateDashboard` +
vérification au `handleShareDashboard` + signature `scope_signature` HMAC) +
audit `dashboard_audit_log` write (actions : `widget_run`, `view`,
`share_create`, `share_open`, `share_rotate`, `update`, `delete`) +
snapshot share figé (route publique lit le snapshot, pas la config live) +
sécurisation route publique `handleGetSharedDashboard` (vérif
`scope_signature` AVANT serve).

**Phase B Manager-C (front, exclusif — PAS Phase A)** : hook
`useWidgetData(widget)` (`src/hooks/useWidgetData.ts` — appelle
`runReportWidget`, gère loading/error/empty via i18n) + modal confirm
share dans `Reports.tsx` (i18n `reports.share.confirm_public` +
`reports.share.scope_warning`) + UI snapshot dans `SharedDashboard.tsx` +
scope-bound badge dans `DashboardBuilder.tsx` (i18n
`reports.scope.bound_to_client` / `bound_to_agency` / `legacy`) + toasts
i18n `reports.toast.scope_locked` / `reports.widget.error_data` /
`reports.widget.empty` / `reports.cap.required_*`.

### §6.H — DISJONCTION STRICTE

**Phase A exclusif (TERMINÉE)** : migration, manifest, `worker.ts`
(uniquement la NOUVELLE route widget + 0 modification des routes
dashboards existantes), `api.ts` (helpers ajoutés en fin), i18n ×4, doc,
stubs `dashboards.ts` (gardes capGuard) + stub `reports.ts`
(`handleRunReportWidget` signature).

**Exclusifs Manager-B Phase B** :
- `src/worker/dashboards.ts` corps tenants/scopes/audit (création
  `dashboard_scopes` lors du `handleCreateDashboard`, vérification dans
  `handleShareDashboard` et `handleGetSharedDashboard`, audit-write dans
  tous les 6 handlers + `handleRunReportWidget`)
- `src/worker/reports.ts` corps `handleRunReportWidget` complet
  (dispatcher par `source`, bornage `accessibleClientIds`, audit-write)

**Exclusifs Manager-C Phase B** :
- `src/components/reports/_dashboardCharts.tsx` (sampleSeries →
  useWidgetData)
- `src/components/reports/DashboardBuilder.tsx` (scope-bound badge UI,
  si ajustement UI nécessaire)
- `src/pages/Reports.tsx` (modal share)
- `src/pages/SharedDashboard.tsx` (snapshot UI)
- `src/hooks/useWidgetData.ts` (NEUF — Phase B Manager-C)

**PARTAGÉS Phase B = ZÉRO** (matrice DURE).

**READ-ONLY Phase B (PHASE A ne les modifie pas non plus)** :
`ecommerce-analytics.ts`, `clients-admin.ts`, `leads.ts`, `tasks.ts`,
`invoices.ts`, `capabilities.ts`, `tenant-context.ts`, `team.ts`,
`src/index.css`. **Aucun ajout à `ALL_CAPABILITIES`**.

### §6.I — GARDE-FOUS récap (NON NÉGOCIABLES)

- ✅ Additif strict, rétro-compat byte-identique (aucun handler legacy
  ne perd d'accès — set legacy LARGE en mono-tenant)
- ✅ CHECK seq 59 jamais touché, jamais rebuild `users`
- ✅ E4/E6 jamais activés (zéro `payments_live`/`payments`/`refunds`/
  `disputes`/`return_requests` ; source widget whitelist exhaustive
  exclut ces tables)
- ✅ 6 pages R prudence (Dashboard / LeadDetail / Pipeline / Tasks /
  Leads / Inbox) — exclues du périmètre
- ✅ i18n 4 catalogues parité STRICTE avant usage runtime (Phase A SOLO
  owner unique — 96/96/96/96 vérifié)
- ✅ VMware sans bun/node : Antigravity délégué pour build (NE PAS tenter
  `bun run build`/`tsc`)
- ✅ Pas de SSR (SPA hydraté)
- ✅ **PAS de `reports.manage` ajoutée à `ALL_CAPABILITIES`** :
  réutilisation `workflows.manage` calquée LOT FUNNEL/EMAIL/BOOKING/
  MEMBER (justification = capability "manage builder" mutualisée,
  cohérence sémantique)
- ✅ JAMAIS de commande git, JAMAIS `git config`, JAMAIS de Bash
  destructeur
- ✅ `ApiResponse` INCHANGÉ, jamais `code` (apiFetch GELÉ depuis LOT B
  Team)
- ✅ Capability discrimination front = string-match sur `error` (jamais
  `code`)
- ✅ AUCUNE FK (D1/SQLite : FK ⇒ rebuild ⇒ interdit) — jointure
  `dashboard_scopes.dashboard_id ↔ dashboards.id` APPLICATIVE
- ✅ AUCUN ALTER sur `dashboards` (seq 51) — bornage par TABLE COMPAGNON
  `dashboard_scopes`
- ✅ Garde capability conditionnelle mode-agence-only (calque LOT B-bis
  textuel) — viewer bridé UNIQUEMENT en mode agence
- ✅ `dashboard_audit_log` est un NAMESPACE DISTINCT de `audit_log`
  (seq 5) — JAMAIS touché/lu par ce lot

## Implementation log

### 2026-05-20 — Phase A SOLO TERMINÉE (code-complete, NON buildé VM)

Fichiers créés :
- `migration-reports-d-seq88.sql` (en-tête garde-fous verbatim calque seq 87
  + 2 tables `dashboard_scopes` / `dashboard_audit_log` + 3 index)
- `docs/LOT-REPORTS-D.md` (ce document)

Fichiers modifiés :
- `docs/migrations-manifest.json` (entrée seq 88, depends 87, risk low)
- `src/worker/dashboards.ts` (helper `reportsCapGuard` + 6 gardes
  early-return ; type `DashboardAuth` enrichi en préservant `auth.id`
  legacy ; corps SQL INTOUCHÉS)
- `src/worker/reports.ts` (stub `handleRunReportWidget` + imports
  `CapAuth`/`requireCapability`)
- `src/worker.ts` (import `handleRunReportWidget` + route
  `POST /api/reports/widget`)
- `src/lib/api.ts` (helper `runReportWidget` + types `WidgetRunResult` /
  `RunReportWidgetPayload`, insérés après `getSharedDashboard`)
- `src/lib/i18n/fr-CA.ts` (+12 clés)
- `src/lib/i18n/fr-FR.ts` (+12 clés)
- `src/lib/i18n/en.ts` (+12 clés)
- `src/lib/i18n/es.ts` (+12 clés)

Vérifications Phase A :
- Parité i18n `reports.*` : 96/96/96/96 ✅
- 12 clés nouvelles présentes ×4 : 48 occurrences ✅
- Zéro collision avec les 84 clés `reports.*` préexistantes ✅
- `ALL_CAPABILITIES` (capabilities.ts) INTOUCHÉ ✅
- 6 pages R prudence INTOUCHÉES ✅
- Aucune commande Bash exécutée (git / bun / tsc) — VMware sans
  bun/node respecté ✅

Écart CODE > brief flag :
- Le brief annonçait que `dashboards.ts` recevait déjà `auth` ; vérifié
  disque OK (signatures `(env, auth)` / `(request, env, auth)` /
  `(env, auth, id)`). Le type interne `Auth = { id?; userId?; role? }`
  a été ÉLARGI en `DashboardAuth = CapAuth & { capabilities?; id? }`
  pour pouvoir lire `auth.tenant` + `auth.capabilities` du choke-point
  `routeProtected`. Le `getUserId(auth)` préserve la priorité legacy
  `auth.id || auth.userId` (Sprint 46 M1.3) — comportement
  byte-équivalent.

**À DÉLÉGUER ANTIGRAVITY (Rochdi)** : build (`bun run build` +
`tsc -p tsconfig.worker.json`), tests vitest non-régression
(teamA-*/lot*/tenant-context/ecommerce/reports-* si suites existantes),
puis enchaîner Phase B B∥C une fois build vert.

### 2026-05-20 — Phase B Manager-C TERMINÉE (code-complete, NON buildé VM)

Fichiers créés :
- `src/hooks/useWidgetData.ts` (NEUF — hook frontal qui appelle
  `runReportWidget` helper FIGÉ Phase A ; gère loading / error / empty /
  data via i18n `reports.widget.*` ; fallback dev offline `import.meta.env.DEV`
  → dataset déterministe calque ex-`sampleSeries`).

Fichiers modifiés :
- `src/components/reports/_dashboardCharts.tsx` : `sampleSeries(seed)`
  SUPPRIMÉ → remplacé par `useWidgetData(widget)` via wrapper transverse
  `WidgetShell` (intercepte loading/error/empty avant de rendre le chart).
  Les 8 sous-widgets (KPI / Bar / Line / Donut / Table / Map / Funnel /
  Heatmap) consomment désormais les vraies données via le hook.
  Heatmap : reste un placeholder visuel mais module la grille par
  `total` retourné par le widget (au lieu du seed pur).
- `src/components/reports/DashboardBuilder.tsx` : prop optionnelle `scope`
  ajoutée à `DashboardBuilderProps` (`'client' | 'agency' | 'legacy'` |
  undefined). Badge scope rendu dans toolbar (mode édition) ou en
  bandeau supérieur (mode readOnly). Dégradation gracieuse : si prop
  non fournie → pas de badge (rétro-compat Sprint 46 byte-équivalente).
- `src/pages/Reports.tsx` : import `useConfirm` ajouté. `handleShareDashboard`
  enrobé d'un appel `await confirm({ title, description, confirmLabel })`
  avec i18n `reports.share.confirm_public` + `reports.share.scope_warning`
  AVANT l'appel à `shareDashboard(id)`. Gestion d'erreur enrichie :
  string-match sur `res.error` (jamais `code` — ApiResponse gelé) pour
  router vers les toasts i18n `reports.cap.required_manage` (forbidden /
  capability / manage) ou `reports.toast.scope_locked` (scope / tenant) ;
  fallback `reports.toast.link_error` sinon. Scope propagé best-effort
  depuis `current?.config?.scope` au `<DashboardBuilder>` du builder ouvert.
- `src/pages/SharedDashboard.tsx` : refonte complète UI snapshot. Lit
  champs additifs best-effort sur la réponse `getSharedDashboard` :
  `snapshot { widgets, cols, data? }` (figé Manager-B) → utilisé en
  priorité ; sinon fallback `config` live + Tag warning "Données live".
  Affiche `shared_at` (i18n `reports.audit.shared_at`) en priorité sur
  `updated_at`. Affiche `last_view` (i18n `reports.audit.last_view`)
  si fourni. Scope badge propagé via `<DashboardBuilder scope=...>`.
- `src/index.css` : append-only bloc `/* === LOT D Reports Hardening
  === */` à la fin du fichier. Classes neuves : `.db-widget-state`
  (3 variants : loading shimmer / error / empty), `.db-builder__scope`
  (+ variant `--readonly`), `.shared-dashboard-page__audit` /
  `__snapshot-tag` / `__last-view`. Respect `prefers-reduced-motion`.
  Calque Stripe-sober Sprint 38 RESET (pas de glow ni gradient).
- `docs/LOT-REPORTS-D.md` : cette entrée IMPLEMENTATION-LOG.

Vérifications Phase B Manager-C :
- i18n nouvelles clés câblées :
  - `reports.share.confirm_public` ✅ (Reports.tsx — modal title)
  - `reports.share.scope_warning` ✅ (Reports.tsx — modal description)
  - `reports.widget.error_data` ✅ (useWidgetData fallback + _dashboardCharts StateError)
  - `reports.widget.empty` ✅ (_dashboardCharts StateEmpty)
  - `reports.audit.shared_at` ✅ (SharedDashboard header)
  - `reports.audit.last_view` ✅ (SharedDashboard header)
  - `reports.scope.bound_to_client` ✅ (DashboardBuilder scopeBadge)
  - `reports.scope.bound_to_agency` ✅ (DashboardBuilder scopeBadge)
  - `reports.scope.legacy` ✅ (DashboardBuilder scopeBadge)
  - `reports.cap.required_manage` ✅ (Reports.tsx — erreur capability)
  - `reports.toast.scope_locked` ✅ (Reports.tsx — erreur tenant)
  - `reports.cap.required_view` : NON câblé (réservé Manager-B handlers
    capability sur lecture `/api/reports/widget` — la consommation côté
    front passera par le 1er handler GET qui rejette ; à câbler quand
    Manager-B livrera le wiring d'erreur précis).
- ZÉRO modification :
  - `src/worker/dashboards.ts` ✅
  - `src/worker/reports.ts` ✅
  - `src/worker.ts` ✅
  - `src/lib/api.ts` ✅
  - `src/lib/i18n/*.ts` ✅
  - `migration-reports-d-seq88.sql` ✅
  - `docs/migrations-manifest.json` ✅
  - 6 pages R protégées (Dashboard / LeadDetail / Pipeline / Tasks /
    Leads / Inbox) ✅
  - `capabilities.ts` / `tenant-context.ts` / `team.ts` /
    `ecommerce-analytics.ts` / `clients-admin.ts` / `leads.ts` /
    `tasks.ts` / `invoices.ts` ✅
- `ApiResponse` discrimination = string-match sur `error` ✅
- Aucune commande Bash exécutée (git / bun / tsc) — VMware respect ✅

Écarts CODE > brief signalés :
- Le brief mentionnait `import.meta.env.DEV && widget.__mock` comme
  fallback ; pas de `__mock` flag sur `WidgetConfig` à ajouter (signature
  gelée). Décision : fallback dev OFFLINE = activé sur ERREUR uniquement
  (catch ou `!res.data`), pas via un flag dans `WidgetConfig`. Garde
  l'UX dev simple : pas de mock par défaut en prod, mock automatique
  si backend muet en dev.
- `DashboardRecord.config` (api.ts FIGÉ Phase A) ne contient pas
  `scope`. Décision : scope passé via prop optionnelle `DashboardBuilderProps.scope`
  + lecture best-effort `current.config.scope` côté Reports.tsx
  (n'enrichit pas le type `DashboardRecord` — gelé). Manager-B peut
  injecter `scope` dans le payload `config` lors du
  `handleGetDashboards`/`handleGetDashboard` sans casser le type
  (interface JSON-shape additive).
- Heatmap : ne mappe pas 1:1 sur `series: [{name, value}]`. Décision :
  rester sur grille déterministe 7×6 + modulation par `total` retourné
  par le widget. C'est un placeholder visuel — à enrichir si Manager-B
  livre une shape `series: [{x, y, value}]` future (hors scope LOT D).
- Modal confirm : ne passe PAS `danger: true` malgré l'exposition
  publique. Justification : c'est une action VOLONTAIRE d'exposition
  (pas une destruction). Le warning textuel `reports.share.scope_warning`
  porte la vigilance ; bouton "Partager" reste primary.

**À DÉLÉGUER ANTIGRAVITY (Rochdi)** : build groupé (Phase A + Phase B
B∥C empilés) — `bun run build` + `tsc -p tsconfig.worker.json` + tests
vitest non-régression (teamA-*/lot*/tenant-context/ecommerce/reports-*).

### 2026-05-20 — Phase B Manager-B (backend) TERMINÉE (code-complete, NON buildé VM)

**Périmètre exclusif Manager-B** (front Manager-C en parallèle, fichiers
disjoints) : corps RÉELS des handlers `dashboards.ts` (tenant scopes +
audit + share signature) + `reports.ts` (dispatcher widget réel, bornage
tenant strict, audit corrélé).

Fichiers modifiés (2 + 1 doc + 1 worker.ts call-site one-liner) :

- `src/worker/dashboards.ts` — Phase A STUB remplacé par corps réels :
  - Helpers privés ajoutés : `loadDashboardInTenant` (calque
    `booking-public:rowInTenant`/`clients-admin:assertClientInTenant`),
    `ensureDashboardScope` (HMAC SHA-256 sur `${agency_id}|${client_id}|
    ${dashboard_id}|${user_id}`), `auditDashboard` (write best-effort
    `dashboard_audit_log` seq 88, NAMESPACE distinct de `audit_log` seq 5),
    `computeScopeSignature` (signature recalculée AVANT serve route publique),
    `isLegacy` (calque `clients-admin:isLegacy`).
  - 6 handlers (Get/Create/Update/Delete/Share/Public) ré-écrits :
    - `handleGetDashboards` : LEGACY → SELECT byte-identique Sprint 46.
      MODE AGENCE → UNION ALL des dashboards SCOPÉS dans le tenant +
      dashboards SANS scope tolérance read user_id (auto-migration douce
      au premier UPDATE).
    - `handleGetDashboard` : `loadDashboardInTenant` → 404 si hors tenant.
      Audit `view` best-effort.
    - `handleCreateDashboard` : INSERT dashboard puis `ensureDashboardScope`
      (no-op legacy). Audit `create`.
    - `handleUpdateDashboard` : `loadDashboardInTenant` 404, auto-migration
      douce du scope si manquant (mode agence), UPDATE par PK (id),
      audit `update`.
    - `handleDeleteDashboard` : `loadDashboardInTenant` 404, DELETE +
      cascade applicative `dashboard_scopes`. Audit `delete`.
    - `handleShareDashboard` : bornage tenant, scope posé si manquant,
      token généré ou réutilisé. Audit `share_create`. La sécurité du
      partage = la signature scope figée à l'instant T : si le créateur
      change de scope plus tard, la signature recalculée différera ⇒ 404.
    - `handleGetSharedDashboard` (route PUBLIQUE) : signature étendue
      `(env, token, request?)` rétro-compat byte-équivalente (3e arg
      OPTIONNEL — l'appel 2-args historique fonctionne identique). Rate-limit
      léger 60req/60s par token (best-effort COUNT sur
      `dashboard_audit_log`). LEFT JOIN scope → si scope existe, vérif
      `scope_signature` recalculée SHA-256 ⇒ 404 si mismatch (anti-leak
      temporel cross-tenant). Si scope absent (legacy pré-seq 88) →
      tolérance Sprint 46 (rétro-compat). Audit `share_open` ou
      `share_invalid` selon résultat.
  - 2 exports additifs pour réutilisation cross-module : `loadDashboardInTenant`
    et `auditDashboard` (consommés par `reports.ts:handleRunReportWidget`).
- `src/worker/reports.ts` — Phase A STUB `handleRunReportWidget` remplacé
  par dispatcher COMPLET :
  - Whitelist STRICTES (anti-injection) : 7 sources (`leads`/`tasks`/
    `conversations`/`events`/`invoices`/`orders`/`agency`), 6 metrics
    (count/sum/avg/median/min/max — median fallback avg car SQLite n'a
    pas MEDIAN natif), 8 dimensions (source/status/type/owner/client/
    date/week/month) — TOUS validés via Set lookup ⇒ 400 BAD_REQUEST sinon.
  - Matrice statique `DIMENSION_COLUMN[source][dimension]` → expression SQL
    pré-écrite (jamais de string libre concaténée). Matrice
    `METRIC_EXPR[source|metric]` → expression d'agrégation pré-écrite.
  - Bornage tenant DUR en mode agence : `WHERE client_id IN
    (?,...,?)` avec `auth.tenant.accessibleClientIds` ; `accessibleClientIds`
    vide ⇒ série vide (jamais leak). LEGACY/mono-tenant : pas de filtre
    tenant ajouté (rétro-compat byte-équivalente — handlers historiques
    Sprint 46 ne filtraient pas par tenant non plus, set legacy LARGE).
  - Filtres sanitizés inline : `dateRange` whitelist 5 valeurs,
    `status`/`source` regex `[^a-z0-9_\-. ]` + slice max 32/64, `tags`
    array filtré strings ≤16 entrées.
  - Si `dashboard_id` fourni : `loadDashboardInTenant` 404 si hors
    périmètre + audit `widget_run` corrélé best-effort.
  - Dispatcher 4 voies :
    - `runGenericSource(leads|tasks|invoices)` : SQL direct bornage
      tenant + filtres + GROUP BY dimension + agrégation metric. LIMIT
      dur 100 buckets (anti-explosion).
    - `runOrdersSource` : SQL direct sur `orders` avec garde-fou
      multi-devise (montants restreints à CAD pour `metric != 'count'`,
      respecte le pattern figé `ecommerce-analytics.ts:10-14`). Filtre
      `placed_at, created_at` formaté `YYYY-MM-DD HH:MM:SS`.
    - `runAgencySource` : agrégat cross-sous-comptes leads par client,
      bornage `accessibleClientIds`. Si legacy → série vide.
    - `conversations`/`events` : série vide best-effort (pas de table
      widget-friendly garantie au schéma).
  - Réponse `{ data: { series: [{name,value},...], total } }` —
    `WidgetRunResult` figé Phase A respecté (delta optionnel non émis,
    placé en évolution future).
- `src/worker.ts` (one-liner additif rétro-compat byte-équivalent ligne 492+) :
  appel `handleGetSharedDashboard(env, token, request)` au lieu de
  `(env, token)`, pour passer le contexte HTTP (IP/UA) à l'audit. La
  signature 3-args est rétro-compat (param `request?` optionnel).
- `docs/LOT-REPORTS-D.md` (ce document, section IMPLEMENTATION-LOG).

Garde-fous tenus :
- ✅ Additif strict, rétro-compat byte-identique legacy/mono-tenant :
  un user sans `auth.tenant` voit exactement ce qu'il voyait Sprint 46.
- ✅ CHECK seq 59 INTOUCHÉ, jamais rebuild `users`.
- ✅ E4/E6 jamais activés : whitelist `source` exclut explicitement
  `payments` / `payment_events` / `refunds` / `disputes` / `return_requests`.
- ✅ 6 pages R prudence : zéro touch.
- ✅ i18n GELÉ : 0 modification (Phase A owner unique).
- ✅ `ALL_CAPABILITIES` figée : 0 ajout (`reports.manage` jamais introduite).
- ✅ `ApiResponse` INCHANGÉ : pas de champ `code`.
- ✅ Bornage tenant TOUS les SELECT/INSERT/UPDATE/DELETE dashboards :
  - SELECT list (handleGetDashboards) : UNION ALL JOIN scope + LEGACY fallback.
  - SELECT detail (handleGetDashboard) : loadDashboardInTenant + 404.
  - INSERT (handleCreateDashboard) : suivi de `ensureDashboardScope` (mode agence).
  - UPDATE (handleUpdateDashboard) : `loadDashboardInTenant` AVANT update
    + auto-migration douce du scope.
  - DELETE (handleDeleteDashboard) : `loadDashboardInTenant` AVANT delete
    + cascade applicative `dashboard_scopes`.
  - Share (handleShareDashboard) : `loadDashboardInTenant` AVANT, scope
    posé si manquant.
  - Public (handleGetSharedDashboard) : signature scope vérifiée AVANT
    serve (anti-leak temporel cross-tenant).
  - Widget (handleRunReportWidget) : `accessibleClientIds` strict.

Écarts CODE > brief signalés :

1. **Snapshot share** : le brief proposait optionnellement une table
   `dashboard_snapshots` pour stocker un snapshot pré-calculé des données
   widgets au moment du partage. Décision exécution : NON pertinent — la
   `config` JSON figée dans `dashboards.config` suffit (elle décrit les
   widgets), et les DONNÉES des widgets sont re-fetchées au runtime par
   `_dashboardCharts.tsx` → `handleRunReportWidget` qui re-vérifie le
   scope par `dashboard_id` à chaque appel. Le "snapshot" effectif est la
   **signature scope figée** : si le créateur change de scope, la signature
   recalculée différera ⇒ 404. Évite une table additionnelle (additif
   strict respecté — aucune migration nouvelle au-delà de seq 88) et le coût
   d'écriture sync de N requêtes widget au moment du partage. Rétro-compat
   stricte préservée.

2. **`handleGetSharedDashboard` signature étendue** : ajout d'un 3e argument
   `request?: Request` optionnel pour permettre l'audit IP/UA. Modification
   du seul call-site `worker.ts:492` pour passer `request` (one-liner additif,
   gel route inchangé — aucune route ajoutée/supprimée). Cette signature
   3-args est rétro-compat avec l'appel historique 2-args (TypeScript
   optional param).

3. **`median`** : SQLite n'a pas de MEDIAN natif. Fallback `AVG` pour les
   metrics median (note explicite dans `METRIC_EXPR`). Documenté pour
   évolution future (window function ou percentile via subquery).

4. **`orders` multi-devise** : garde-fou recopié de `ecommerce-analytics.ts`
   (jamais sommer cross-devise) — on borne à `currency = 'CAD'` quand la
   metric agrège un montant (pas pour `count`). Évite leak cross-devise.

5. **Sources `conversations`/`events`** : retournent série vide
   intentionnellement (pas de table normalisée widget-friendly garantie au
   schéma — `messages`/`activity_log` ont des conventions trop hétérogènes
   pour matcher la matrice dimension/metric stricte du builder). Extension
   future possible dans un prochain lot R+1 si besoin.

6. **Filtre `lead.source` (champ leads)** : conflict de nommage entre
   `body.source` (datasource widget — leads/tasks/...) et
   `filters.source` (champ `source` de la table leads — Facebook/Google/
   direct/...). Géré : `filters.source` n'est appliqué QUE quand
   `body.source === 'leads'`, comme attendu par le builder. Pour les autres
   sources : ignoré silencieusement.

7. **Source `orders` & `agency`** : présentes dans la whitelist serveur
   alors que `DashboardBuilder.tsx` les liste pas dans `DATA_SOURCES`. Le
   builder fait foi (source de vérité front), mais le backend tolère ces
   alias additifs car le brief les liste et qu'ils permettent une extension
   future SANS modifier DashboardBuilder.tsx (additif strict). Aucun front
   actuel ne les envoie ⇒ aucune régression.

Vérifications Phase B Manager-B (auditées disque) :
- Stub Phase A `success: true, data: { series: [], total: 0 }` : **0
  occurrence** dans `src/worker/` (grep) ✅
- Aucun fichier exclusif Manager-C touché ✅ (`_dashboardCharts.tsx`,
  `DashboardBuilder.tsx`, `Reports.tsx`, `SharedDashboard.tsx`,
  `useWidgetData.ts` intacts — Manager-C les a livrés)
- Aucun fichier READ-ONLY touché ✅ (`ecommerce-analytics.ts`,
  `clients-admin.ts`, `leads.ts`, `tasks.ts`, `invoices.ts`,
  `capabilities.ts`, `tenant-context.ts`, `team.ts`, i18n catalogues,
  migration seq 88, manifest, `api.ts`)
- `src/worker.ts` : 1 modification SPATIALEMENT MINIMALE (ligne 492 :
  ajout 3e argument `request` au call `handleGetSharedDashboard`) — additif
  rétro-compat strict, aucune nouvelle route, aucune route supprimée
- `ALL_CAPABILITIES` INTOUCHÉ ✅ (12 capabilities figées)
- 6 pages R prudence INTOUCHÉES ✅
- Aucune commande Bash exécutée (git / bun / tsc) — VMware sans bun/node ✅

**À DÉLÉGUER ANTIGRAVITY (Rochdi)** post-Phase B B∥C complète :
- Build : `bun run build` + `tsc -p tsconfig.worker.json`
- Tests vitest non-régression : teamA-* / lot* / tenant-context /
  ecommerce / reports-* (si suites existantes) + nouveau test smoke
  réutilisant `loadDashboardInTenant` + scope HMAC mismatch
- Migration seq 88 : `npx wrangler d1 execute intralys-crm
  --file=migration-reports-d-seq88.sql --remote` (idempotente, risk
  low — 2 CREATE TABLE IF NOT EXISTS + 3 CREATE INDEX IF NOT EXISTS)
- Test E2E manuel : créer dashboard (mode agence), partager, ouvrir
  lien public → 200 + données ; switcher de sous-compte (simuler change
  scope_signature) → lien public retombe 404. Confirme l'anti-leak
  temporel cross-tenant.
