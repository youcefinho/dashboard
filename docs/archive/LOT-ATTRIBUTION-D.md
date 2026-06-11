# LOT ATTRIBUTION-D — Attribution multi-touch & cohortes de leads (fondations)

Sprint D · seq 100 · 2026-05-21 · Pattern Chaman READ-ONLY → Phase A SOLO → Phase B (B∥C).

Méthode VMware : fichiers via Read/Write/Edit/Grep/Glob uniquement, **jamais** git/bun/node.
Build délégué à Antigravity.

---

## §0 audit (honnête)

- `lead_attributions` (seq 21) = table **MORTE** (zéro read/write). L'attribution réelle
  est **SINGLE-TOUCH** dans des colonnes `leads` (`utm_source/medium/campaign/term/content/
  gclid/fbclid/referrer`), écrites `leads.ts:944-956`, **ÉCRASÉES au merge** (`leads.ts:920-924`).
  → **1 touch/lead, le dernier.**
- `message_events` (pas de `client_id`/`lead_id` direct = engagement email), `feature_events`
  (`user_id` CRM, pas leads), `funnel_analytics` (`lead_id` nullable, pas `client_id`) → **PAS
  exploitables comme touchpoints d'acquisition v1.**
- Cohortes DÉJÀ prouvées : `ecommerce-analytics.ts:216-308 handleEcommerceCohorts` (12 mois JS,
  `resolveClientId` bornage). **Calque** pour cohortes LEADS sur `leads.created_at` + `status`.
- seq 99 dernière → **100 libre**. `reports.view` ∈ ALL_CAPABILITIES. `Reports.tsx` PAS dans les
  6 R cœur.

## §6.A archi (tranché, honnêteté)

- Table NEUVE `lead_touchpoints` (capture touchpoints **DÉSORMAIS**, multi-touch **PROSPECTIF** —
  ne recrée **pas** d'historique).
- 4 modèles d'attribution (first / last / linéaire / time-decay) ; **convergent tant qu'1
  touch/lead.** La valeur multi-touch apparaît pour les leads ré-ingérés multi-source **APRÈS**
  livraison. Backfill 1 touch synthétique optionnel (`touch_order=0` depuis colonnes `leads`).
- Cohortes LEADS **rétroactives** JS (calque ecommerce) sur `created_at` + statut avancé
  (`contacted`/`qualified`/`won`/`closed`) à M+i. Calculable sur la donnée **EXISTANTE**.
- Capture = 1 INSERT additif **best-effort** (try/catch avalant, calque hook affiliation
  `leads.ts:974-992`) à la création + au merge. Leads existants = aucun touch (ou synthétique).
  Cohortes couvrent l'historique, attribution le futur.
- 100% lecture/agrégat pour les rapports (seule écriture = capture de touch). Capability
  `reports.view`. Bornage tenant.

## §6.B migration seq 100

Fichier `migration-attribution-cohort-seq100.sql`, `depends_on` 99. En-tête garde-fous calque
seq 99. Timestamps `datetime('now')`. **Zéro FK/CHECK/ALTER.** Ne touche **PAS** `lead_attributions`
(morte mais intouchée).

```sql
CREATE TABLE IF NOT EXISTS lead_touchpoints (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, lead_id TEXT,
  touch_order INTEGER DEFAULT 0,
  source TEXT, medium TEXT, campaign TEXT, referrer TEXT,
  occurred_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lead_touchpoints_lead ON lead_touchpoints(client_id, lead_id, touch_order);
```

Manifest :
`{ "seq": 100, "file": "migration-attribution-cohort-seq100.sql", "depends_on": ["migration-proactive-ai-seq99.sql"], "objects": ["table:lead_touchpoints","index:lead_touchpoints"], "risk": "low" }`.

## §6.C backend

- 2 handlers **stubs** dans `reports.ts` (corps Phase B) :
  - `handleReportsAttribution(env, auth, url)` → `{ data: { models: {}, by_source: [] } }` (stub) ;
  - `handleReportsLeadCohorts(env, auth, url)` → `{ data: { cohorts: [] } }` (stub).
  Capability `reports.view` mode-agence-only calqué `handleRunReportWidget:652`.
- Module capture NEUF `src/worker/touchpoints.ts` : `recordTouchpoint(env, leadId, clientId,
  attribution, touchOrder)` **STUB Phase A (no-op)**.
- Hook `leads.ts` : 2 points d'appel best-effort (création + merge) → import dynamique
  `recordTouchpoint` + try/catch **TOTAL** avalant (calque hook affiliation `:974-992`).
  `touch_order` : création = `0`, merge = `-1` (SENTINEL « append » → Phase B résout
  `SELECT MAX(touch_order)+1`). **Ne casse JAMAIS la création de lead.**
- Routes `worker.ts` (après `/reports/conversion`) : `GET /api/reports/attribution` +
  `GET /api/reports/lead-cohorts`.

## §6.D api.ts + types

`getReportsAttribution(model?, days?)`, `getLeadCohorts()` (calque `getReportsSources`).
Types `AttributionReport` / `LeadCohortRow` dans `src/lib/api.ts` (calque `SourceReport` — qui y
réside). `ApiResponse` **INCHANGÉ**.

## §6.E i18n `attribution.*` + `cohort.*` ×4

Titres onglets, modèles (first/last/linear/time-decay), en-têtes colonnes, empty-states.
**15 clés par catalogue, parité stricte ×4** (fr-CA / fr-FR / en / es).

## §6.F pages

`Reports.tsx` : `'attribution'` (group MARKETING) + `'cohorts'` (group BUSINESS) ajoutés à
`ReportTab`, `TABS`, `VALID_TABS`. 2 cas `switch` = onglets **VIDES/placeholder** Phase A
(`<EmptyState>`). Charts recharts = Phase C Manager-C.

## §6.G découpage

- **Phase A SOLO (CE LOT)** : migration + manifest + types (`api.ts`) + stubs handlers
  (`reports.ts`) + module `touchpoints.ts` (`recordTouchpoint` stub) + hook `leads.ts` (2 points
  best-effort) + routes `worker.ts` + helpers `api.ts` + i18n ×4 + onglets `Reports.tsx` vides + doc.
- **Phase B Manager-B** : corps des 2 handlers `reports.ts` (4 modèles + cohortes JS) + corps
  `recordTouchpoint` (INSERT borné tenant, résolution sentinel `-1` → `MAX+1`).
- **Phase C Manager-C** : `api.ts` + charts recharts dans les 2 onglets `Reports.tsx`.

## IMPLEMENTATION-LOG — Phase B Manager-B (corps backend, 2026-05-21)

Périmètre EXCLUSIF écrit : `src/worker/touchpoints.ts` (corps `recordTouchpoint`) +
`src/worker/reports.ts` (corps `handleReportsAttribution` + `handleReportsLeadCohorts`).
`leads.ts` **NON modifié** (hooks Phase A intacts). `Reports.tsx` / `components/reports/*`
**zéro touch** (Manager-C). Tout READ-ONLY ailleurs respecté.

### `recordTouchpoint` (touchpoints.ts) — capture best-effort
- Try/catch **TOTAL** englobant → **ne throw JAMAIS** (défensif en plus du try/catch du hook).
- Gardes : `clientId`/`leadId` vide → return. **SKIP si tous les champs attribution vides**
  (source/medium/campaign/referrer normalisés trim → null) — pas de touch sans donnée.
- **Résolution sentinel `-1`** : `SELECT MAX(touch_order) WHERE client_id=? AND lead_id=?` →
  `MAX+1` (ou `0` si aucun touch). `0` (création) / `n≥0` (explicite) conservés tels quels.
- INSERT additif borné `client_id` (depuis l'appelant, **jamais** le body), `occurred_at =
  datetime('now')`, `id` auto (randomblob du schéma).

### `handleReportsAttribution` (reports.ts) — 4 modèles
- capGuard `reports.view` mode-agence-only **préservé** (Phase A, calque `:652`).
- Bornage tenant **DUR** : `client_id IN (accessibleClientIds)` en mode agence (vide → `{}`/`[]`),
  no-op en legacy (calque `runGenericSource`/`isLegacyAuth`). Filtre `?days=` optionnel sur `occurred_at`.
- SELECT `lead_touchpoints` ordonné `lead_id, touch_order` (LIMIT 50000). Regroupement JS par lead.
- **4 modèles calculés** : **first** (100% touch min), **last** (100% touch max), **linéaire**
  (1/n par touch), **time-decay** (poids `2^(-Δt/7j)` relatif au dernier touch, normalisé somme=1).
- **HONNÊTETÉ** : 1 seul touch/lead → les 4 modèles **CONVERGENT** (poids 1 / 100% au touch unique).
  Divergence uniquement pour leads multi-touch (prospectif, post-livraison).
- Retour `{ data: { models: {first_touch,last_touch,linear,time_decay}, by_source: [...] } }`,
  `by_source` trié par crédit linéaire desc (top 100). Best-effort (table absente → vide).

### `handleReportsLeadCohorts` (reports.ts) — calque ecommerce
- capGuard `reports.view` préservé. Bornage tenant DUR identique. Fenêtre **12 mois glissants**.
- SELECT `leads (created_at, status)`. Logique JS **calquée** `ecommerce-analytics
  handleEcommerceCohorts:216` : `monthIdx` (mois absolu epoch sans dérive), `monthOf`, groupage
  par mois d'acquisition, `retention[]` borné `depth = min(12, nowIdx - cohortIdx + 1)`.
- Différence assumée (honnêteté) vs ecommerce : pas d'historique de transition de statut par mois
  → `retention[0]=100` (acquisition), `retention[M+i≥1]` = % cohorte au statut avancé
  (`contacted/qualified/won/closed`) **projeté** (état courant, pas une ré-activation mensuelle).
- Retour `{ data: { cohorts: [{month, size, retention[]}] } }`. Best-effort (table absente → vide).

### Écarts / notes
- `resolveClientId` du brief = satisfait via `auth.tenant.accessibleClientIds` (pattern tenant-context
  du fichier, identique aux widget handlers `runGenericSource`), **jamais le body**. Pas d'usage de
  `getClientModules` (ecommerce) car les handlers reports utilisent `WidgetAuth`/`TenantContext`.
- Types `AttributionSourceRow` / `LeadCohortRow` ajoutés **localement** dans `reports.ts` (non exportés,
  pas de touch `types.ts` gelé Phase A). `ApiResponse` inchangé. Zéro ajout `ALL_CAPABILITIES`.

## IMPLEMENTATION-LOG — Phase B Manager-C (front charts, 2026-05-21)

Périmètre EXCLUSIF écrit : `src/components/reports/AttributionPanel.tsx` (NEUF) +
`src/components/reports/CohortHeatmap.tsx` (NEUF) + `src/pages/Reports.tsx` (2 cases
switch remplis + 2 imports) + `src/index.css` (bloc sentinellé Sprint D). `worker/*`,
`api.ts`, `types.ts`, `i18n/*`, migrations, 6 pages R cœur, leads.ts → **zéro touch**.

### `AttributionPanel.tsx` — onglet `attribution`
- Fetch `getReportsAttribution()` au mount (1 appel ; le backend renvoie tous les
  modèles par source → bascule de modèle **côté client** sans refetch).
- `<Select>` modèle first/last/linear/time_decay (libellés `attribution.model_*`).
- `BarChart` recharts horizontal (layout vertical, source en Y, crédits en X), trié
  décroissant sur le modèle actif, filtré `value > 0`, palette sobre déterministe par
  index, tooltip Stripe-grade sobre. Hauteur dynamique (44px/ligne).
- Tableau récap `by_source` : 4 colonnes de modèles, colonne active en font-semibold,
  linéaire/time_decay arrondis 2 décimales.
- Empty state si aucun crédit > 0 → `attribution.title` / `attribution.empty` (donnée
  prospective) + hint répété sous le panel. Loading → `<Skeleton>`.

### `CohortHeatmap.tsx` — onglet `cohorts`
- Fetch `getLeadCohorts()` au mount.
- Table heatmap : mois d'acquisition en lignes, `M+0..M+N` en colonnes (N = max
  `retention.length`), % color-coded via `color-mix(in srgb, var(--primary) …%)`
  (opacité bornée 0.10→0.85, texte blanc dès 55%). Colonnes `cohort.col_month` /
  `cohort.col_size` / span `cohort.col_retention`.
- Empty state si 0 cohorte → `cohort.title` / `cohort.empty`. Loading → `<Skeleton>`.

### `Reports.tsx`
- 2 imports ajoutés (AttributionPanel, CohortHeatmap). Cases switch placeholder →
  `<AttributionPanel />` / `<CohortHeatmap />`. **Tous les autres onglets intacts**
  (sales/funnel/sources/perf/trends/activity/workflow/email/sms/calendar/forms/
  reviews/builder/scheduled). `EmptyState`/`EmptyStateIllustration` toujours utilisés
  ailleurs dans le fichier → aucun import orphelin.

### `index.css`
- Bloc `=== Sprint D Attribution ===` … `=== Fin Sprint D ===` en fin de fichier :
  classes `.cohort-heatmap*` (border-spacing, cellules radius/tabular-nums, hover
  brightness). Aucune classe existante écrasée.

### Conformité / écarts
- **i18n GELÉ** : clés `attribution.*` / `cohort.*` Phase A câblées telles quelles,
  **aucune créée** (vérifié fr-CA/fr-FR/en/es présentes ×4).
- **Types figés** : `AttributionReport` / `LeadCohortRow` importés d'api.ts, non
  modifiés. Signatures réelles confirmées : `getReportsAttribution(model?, days?)` →
  `{ models, by_source: AttributionReport[] }` ; `getLeadCohorts()` → `{ cohorts }`.
- **ApiResponse inchangé** : lecture `res.data?.…`.
- **recharts réutilisé** (BarChart/Bar/Cell/XAxis/YAxis/Tooltip/ResponsiveContainer),
  zéro nouvelle dépendance. Heatmap = table HTML pure (pas de chart lib).
- Écart vs brief : pas de dimension « campagne » dans la donnée réelle (crédits par
  **source** uniquement) → BarChart par source, le sélecteur de modèle pilotant
  tri/emphase. Charts en composants dédiés (calque `ScheduledReportsPanel`) plutôt
  qu'inline pour garder Reports.tsx lisible.

## §6.I garde-fous

Additif (1 table + 1 index `IF NOT EXISTS`) · CHECK59/E4-E6 jamais · lecture-seule/agrégat (seule
écriture = capture de touch best-effort, pas de mutation métier) · bornage tenant DUR (`client_id`
partout, jamais le body) · zéro ajout `ALL_CAPABILITIES` (`reports.view`) · `ApiResponse` inchangé ·
zéro FK · `datetime('now')` · capture import dynamique try/catch total (n'échoue jamais
l'ingestion) · `lead_attributions` morte **NON** touchée · honnêteté (multi-touch **prospectif**,
cohortes **rétroactives**) · jamais git.
