# LOT SCHEDREPORT — Sprint A (Reporting planifié) — §6 FIGÉ

> Squelette transverse + CRUD réels. Phase A SOLO (transverses owner unique).
> Calque EXACT = `ecommerce-subscriptions.ts` (seq 85) pour le cycle planifié,
> `dashboards.ts` (seq 88) pour la capability/bornage tenant.

## §0 audit
- `scheduled_report(s)` ABSENT confirmé (aucune table préexistante).
- Cron `scheduled()` worker.ts = empilement `ctx.waitUntil(...).catch(()=>undefined)`
  best-effort isolé (calque E7 / broadcasts seq 5 / subscriptions seq 85).
- Resend pattern : `new Resend(env.RESEND_API_KEY)` →
  `resend.emails.send({from: env.NOTIFICATION_EMAIL||'noreply@intralys.com', ...})`
  (broadcast.ts:535-573), mock honnête si `!RESEND_API_KEY`.
- **FLAG A1** : `reports.ts handleReportsOverview` gaté admin + NON borné tenant
  (lit `client_id` query brut) → NE PAS réutiliser pour le cron/digest. Le digest
  (Phase B) fait ses PROPRES SELECT bornés `WHERE client_id = ?`.
- `dashboards.ts` : `reportsCapGuard` (reports.view mode-agence-only) calqué.
- `reports.view` ∈ ALL_CAPABILITIES (capabilities.ts:44). seq 96 dernière → 97 libre.
- i18n `reports.scheduled.*` LIBRE (sous-namespace) dans les 4 catalogues. App.tsx
  pas de collision (onglet dans Reports.tsx, pas de route).

## §6.A archi (tranché)
- Table `scheduled_reports(id TEXT PK, client_id TEXT, agency_id TEXT, name TEXT,
  dashboard_id INTEGER nullable, report_kind TEXT DEFAULT 'activity', cadence TEXT
  DEFAULT 'weekly', day_of_week INTEGER, day_of_month INTEGER, recipients TEXT json,
  format TEXT DEFAULT 'html', last_sent_at TEXT, next_run_at TEXT, status TEXT
  DEFAULT 'active', created_at TEXT, updated_at TEXT)`. Zéro FK, zéro CHECK
  (validés handler).
- Digest v1 = activité générique (SELECT leads bornés client_id :
  nouveaux/convertis/perdus période). `dashboard_id` colonne posée mais INERTE v1
  (v2). `format` v1 = HTML only (pdf=v2 INERTE).
- Cron = hook additif best-effort calque subscriptions. Capability `reports.view`.
  Bornage tenant strict (client_id/agency_id de l'auth JAMAIS body).
- UI onglet `scheduled` dans Reports.tsx (Phase B Manager-C).

## §6.B migration seq 97 (`migration-scheduled-reports-seq97.sql`, depends 96)
En-tête garde-fous calqué seq 96. Timestamps `datetime('now')` (aligné seq 85).
Zéro FK/CHECK/ALTER. 1 table + 2 index `IF NOT EXISTS`.
Manifest : `{ "seq": 97, "file": "migration-scheduled-reports-seq97.sql",
"depends_on": ["migration-marketplace-seq96.sql"],
"objects": ["table:scheduled_reports","index:scheduled_reports"], "risk": "low" }`.

## §6.C routes worker.ts + hook cron
- Module NEUF `src/worker/scheduled-reports.ts` :
  - CRUD `handleListScheduledReports` / `handleCreateScheduledReport` /
    `handleUpdateScheduledReport` / `handleDeleteScheduledReport` = CORPS RÉELS
    Phase A (reportsCapGuard reports.view + bornage tenant `WHERE client_id = ?`
    + INSERT/SELECT/UPDATE/DELETE bornés ; `computeNextRunAt` à la création).
  - `computeNextRunAt(cadence, dayOfWeek?, dayOfMonth?, from?)` = CORPS RÉEL (JS
    pur, format 'YYYY-MM-DD HH:MM:SS' ; weekly=+7j, monthly=+1 mois UTC ;
    day_of_week/day_of_month = ancrages INDICATIFS v1, non appliqués au calcul).
  - `processScheduledReports(env)` = STUB Phase A (`return undefined`).
  - `buildActivityDigestHtml(env, clientId, cadence)` = STUB Phase A (`return ''`).
- Routes routeProtected (import statique calque dashboards, PAS dynamic — le code
  réel des modules voisins utilise des imports statiques top-of-file ; mémoire
  "dynamic import" caduque, CODE > MÉMOIRE) : `GET/POST /api/scheduled-reports`,
  `PATCH/DELETE /api/scheduled-reports/:id`. Placées juste après le bloc dashboards
  (anti-shadowing : match `:id` = `[^/]+` après les routes statiques).
- Hook cron : ajouté dans `scheduled()` après le bloc broadcasts :
  `ctx.waitUntil(import('./worker/scheduled-reports').then(m=>m.processScheduledReports(env)).then(()=>undefined).catch(()=>undefined));`

## §6.D api.ts
`getScheduledReports()`, `createScheduledReport(payload)`,
`updateScheduledReport(id,patch)`, `deleteScheduledReport(id)` (apiFetch).
Type `ScheduledReportRecord` (recipients = string[]). ApiResponse INCHANGÉ.

## §6.E i18n `reports.scheduled.*` ×4 (14 clés, parité stricte)
`tab` / `title` / `create` / `cadence_weekly` / `cadence_monthly` / `recipients` /
`status_active` / `status_paused` / `pause` / `resume` / `delete` / `empty` /
`next_run` / `last_sent`. 4 catalogues (fr-CA, fr-FR, en, es) parité stricte.

## §6.F pages (Phase B Manager-C)
Reports.tsx onglet `scheduled` + ScheduledReportsPanel. api.ts/i18n déjà Phase A.

## §6.G découpage
- **Phase A SOLO (FAIT)** : migration+manifest + scheduled-reports.ts (CRUD réels
  + computeNextRunAt réel + processScheduledReports/buildActivityDigestHtml STUBS)
  + routes worker.ts + hook cron + api.ts + type + i18n ×4 + doc.
- **Phase B Manager-B** : corps `processScheduledReports` (processeur cron calque
  `handleRunDueSubscriptions` seq 85 : SELECT échus status='active' AND
  next_run_at<=now LIMIT N, boucle try/catch par row, avance next_run_at +
  last_sent_at) + `buildActivityDigestHtml` (SELECT leads BORNÉS client_id — FLAG
  A1 — + HTML + Resend, mock honnête si !RESEND_API_KEY).
- **Phase B Manager-C** : Reports.tsx onglet scheduled + ScheduledReportsPanel.

## §6.I garde-fous
Additif/CHECK59/E4-E6-jamais · cron best-effort `.catch(()=>undefined)` jamais
throw (n'altère pas RFM/workflows/broadcasts/cleanup) · bornage tenant strict
(FLAG A1 : digest SELECT bornés, pas handleReportsOverview) · zéro ajout
ALL_CAPABILITIES (reports.view réutilisée) · ApiResponse inchangé · zéro FK ·
datetime('now') · parité i18n ×4 avant usage · jamais git.

---

## IMPLEMENTATION-LOG — Phase B Manager-B (corps réels processor + digest)

Fichier touché (EXCLUSIF) : `src/worker/scheduled-reports.ts` (corps `processScheduledReports` + `buildActivityDigestHtml`). Reports.tsx / components/reports/* / worker.ts / api.ts / i18n / migration = ZÉRO touch (Manager-C + gelés Phase A).

### `processScheduledReports(env)` — calque EXACT handleRunDueSubscriptions seq 85
- SELECT `WHERE status='active' AND next_run_at IS NOT NULL AND next_run_at <= datetime('now') ORDER BY datetime(next_run_at) ASC LIMIT 50` (DUE_BATCH). GLOBAL multi-tenant (cron) — chaque row porte son `client_id`, le digest est borné row.client_id (FLAG A1).
- Resend importé dynamiquement UNE fois (`await import('resend')`, calque broadcast.ts:480). Mock honnête si `!RESEND_API_KEY` (ou import KO) : `console.log`, AUCUN faux 'sent'.
- Boucle `for…of` avec `try/catch PAR ROW` (calque subscription cycle). Sur SUCCÈS (réel OU mock) : UPDATE `next_run_at = computeNextRunAt(cadence, day_of_week, day_of_month, row.next_run_at)` (helper Phase A réutilisé, avance depuis l'ancienne échéance) + `last_sent_at = datetime('now')`, borné `WHERE id = ? AND client_id = ?`.
- Cas avancés-sans-envoi (pas de boucle infinie) : `client_id` NULL → avance échéance sans WHERE client_id ; recipients vide → avance échéance bornée, pas d'envoi.
- **BEST-EFFORT STRICT** : `try/catch` par row → un échec NE touche PAS son `next_run_at` (réessai prochain run) ; `try/catch` global → ne throw JAMAIS (table absente / panne ⇒ log seul). Le hook cron enveloppe déjà en `.catch`, on reste défensif.

### `buildActivityDigestHtml(env, clientId, cadence)` — FLAG A1 SELECT bornés
- Signature CHANGÉE : `Promise<string>` (stub) → `Promise<ActivityDigest>` (`{subject, html, text}`) — requis par le processor. Changement INTERNE au module (seul appelant = processScheduledReports, même fichier ; worker.ts n'appelle que processScheduledReports). Type `ActivityDigest` exporté.
- Fenêtre : weekly = 7 j, monthly = 30 j (`datetime('now', '-N days')`).
- SELECT TOUS bornés `WHERE client_id = ?` (FLAG A1, JAMAIS handleReportsOverview) : nouveaux leads (created_at >= période), convertis (`status IN ('won','closed')`), perdus (`status='lost'`), actifs total (`status NOT IN ('lost','closed','won')`), RDV à venir (appointments start_time entre now et +N j), CA payé (invoices `status='paid'`). Valeurs status calquées leads.ts.
- Best-effort PAR requête : helper `countSince` try/catch → 0 si table absente ; CA try/catch → tableau vide.
- **MULTI-DEVISE NON SOMMÉE** : CA `GROUP BY UPPER(COALESCE(NULLIF(currency,''),'CAD'))` (calque ai-chat.ts) — une ligne KPI par devise, jamais d'addition cross-devise.
- HTML email-safe : inline styles UNIQUEMENT (zéro classe CSS externe), `escHtml` sur tout texte injecté. Titre + table KPI + footer sobre. Version `text` plain en parallèle. subject = `Votre rapport <cadence> — N nouveau(x) lead(s)`.

### Garde-fous tenus
Processor best-effort (boucle try/catch par row, jamais throw, échec ne touche pas next_run_at) · FLAG A1 (SELECT bornés client_id, handleReportsOverview NON utilisé) · Resend mock honnête si pas de clé · bornage tenant strict · multi-devise NON sommée · E4-E6/CHECK59 jamais touchés · ApiResponse `{data}`/`{error}` inchangé · zéro FK · datetime('now') · Reports.tsx + components/reports/* ZÉRO touch · jamais git.

---

## IMPLEMENTATION-LOG — Phase B Manager-C (UI onglet « Planifiés »)

Fichiers touchés (EXCLUSIF) : `src/components/reports/ScheduledReportsPanel.tsx` (NEUF) · `src/pages/Reports.tsx` (onglet `scheduled`) · `src/index.css` (bloc sentinellé Sprint A) · ce log. ZÉRO touch worker/* · worker.ts · api.ts · types.ts · i18n · migrations · 6 pages R cœur · DashboardBuilder/_dashboardCharts (Manager-B + gelés Phase A).

### Reports.tsx
- `'scheduled'` ajouté au type `ReportTab` (union), à `TABS[]` (label `t('reports.scheduled.tab')`, icône `Mail` déjà importée, group `'BUILDER'`), et à `VALID_TABS`.
- Switch render : `case 'scheduled': return <ScheduledReportsPanel />;`.
- Import statique `ScheduledReportsPanel` ajouté.
- Exception empty-state : `activeTab !== 'scheduled'` ajouté à la garde `leads.length === 0` (le panel reste accessible sans leads, calque exception `builder`).
- Tous les autres onglets (builder/business/agence/équipe/marketing) **intacts**.

### ScheduledReportsPanel.tsx (NEUF)
- **Liste** `getScheduledReports()` → cards `.sched-report-card` (grille auto-fill 280px). Par card : nom, `<Tag>` statut (active→success / paused→neutral, `statusIcon` auto), chips cadence + nombre destinataires (`Users` icon), 2 dates (`next_run`/`last_sent`) via `formatDate(getLocale())`.
- **Créer** : bouton → `SlidePanel` (size md, footer Annuler/Créer). Form : nom (`Input`), cadence (`Select` weekly/monthly), jour conditionnel (`Select` jour-semaine si weekly / `Input number 1-28` si monthly), destinataires (`Input` — split `/[,\n;]+/` → array). Validation nom + ≥1 destinataire. → `createScheduledReport({ report_kind:'summary', format:'html', day_of_week|day_of_month selon cadence })`.
- **Pause/Reprendre** : `updateScheduledReport(id, { status })`.
- **Supprimer** : `useConfirm({ danger: true })` → `deleteScheduledReport`. Succès via `res.data?.success`.
- **Empty state** : `EmptyState variant="first-time"` + `EmptyStateIllustration kind="reports"` (clé `reports.scheduled.empty`).

### i18n
- Câblé UNIQUEMENT clés Phase A `reports.scheduled.*` (tab/title/create/cadence_weekly/cadence_monthly/recipients/status_active/status_paused/pause/resume/delete/empty/next_run/last_sent). **Aucune clé créée.**
- Footer Annuler = `action.cancel` (clé existante vérifiée fr-CA:105). Toasts = `reports.toast.*` (created/saved/deleted/create_error/save_error/delete_error — existants).
- Écart mineur : labels jours de semaine (`Lundi`…`Dimanche`) et placeholder/helper destinataires en dur FR — aucune clé `reports.scheduled.*` ne couvre ces libellés (périmètre i18n gelé Phase A, interdiction d'en créer).

### CSS
Bloc `/* === Sprint A Reporting planifié === */ … /* === Fin Sprint A === */` en fin de `index.css`. Classes `sched-report-*` calquées sur `.db-list-*` (Stripe subtle), reduce-motion respecté.

### Disjonction vérifiée
api.ts/i18n/worker/migration = lecture seule. ApiResponse string-match conservé (succès = `res.data` / `res.data?.success`, pas de `code`). Reports.tsx onglets existants préservés.

### Build
Délégué Antigravity (VM VMware sans bun/node).
