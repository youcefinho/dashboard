# LOT 3 — Sprint 26 : E2E Playwright

> Doc contrat §6 figé. **PAS de migration** (E2E = tests, no schema).
> Manifest reste à seq123. Prochaine seq libre = seq124 pour Sprint 27.

## Objectif

Étendre la couverture Playwright sur les 5 flux LOT 3 (Sprints 21-25) actuellement
non couverts par les specs existantes. Réutiliser le pattern auth+mock figé S35
(addInitScript localStorage + page.route /\/api\//) en le factorisant en helpers DRY
(élimine la triplication setupAuth présente dans smoke/crm-journey/ecommerce).

## État actuel (audit Chaman 2026-05-22)

### Playwright config
- `@playwright/test ^1.60.0`
- baseURL `http://localhost:4173` (vite preview, pas dev)
- 5 projects : smoke (e2e), chromium/webkit/firefox (visual), mobile-safari
- `webServer: bun run preview`, port 4173, reuseExistingServer
- workers 1, retries 0

### Tests existants
- `tests/e2e/smoke.spec.ts` (S35) : Dashboard, Leads/LeadPanel, Pipeline, Tasks FAB, Inbox
- `tests/e2e/crm-journey.spec.ts` (LOT E) : parcours enchaîné login→leads→pipeline→tâche
- `tests/e2e/ecommerce.spec.ts` (LOT E) : catalogue + commandes + flow négatif gating
- `tests/visual/snapshots.spec.ts` + `tests/visual/full-regression.spec.ts` : 25 snapshots

### Pattern auth canonique (figé S35, à factoriser Sprint 26)
- `addInitScript` injecte `intralys_token: 'dev-bypass-token'` + `intralys_locale: 'fr-CA'` +
  `intralys_user` admin AVANT chargement React.
- `page.route(/\/api\//)` intercepte API avec longest-prefix match sur dictionnaire `API_MOCKS`.
- POST/PUT/PATCH/DELETE → `{ data: { id: 'created-...' }, success: true }`.
- **DUPLIQUÉ dans 3 specs** : à factoriser Sprint 26.

## Roadmap Sprint 26

### Phase A (socle factorisé)
- `tests/e2e/_helpers/auth.ts` — `setupAuth(page, opts?)` réutilisable
- `tests/e2e/_helpers/api-mocks.ts` — `DEFAULT_API_MOCKS` + `installApiMocks(page, overrides?)`
- `tests/e2e/_fixtures/test.ts` — fixture composable `authedPage` (extends @playwright/test)
- `package.json` scripts : `test:e2e:ui`, `test:e2e:headed`

### Manager-C (specs + page-objects + testids)
- `tests/e2e/_pages/AppLayout.ts` + `Sidebar.ts` (helpers nav réutilisables)
- 5 specs nouvelles couvrant LOT 3 :
  - `onboarding-checklist.spec.ts` (S21)
  - `billing-plans.spec.ts` (S22, mock E4 inactif)
  - `cookies-consent.spec.ts` (S23 — anonyme, pas auth)
  - `data-privacy.spec.ts` (S23)
  - `admin-observability.spec.ts` (S24, role admin)
- 3 ChirurgicalEdits data-testid (CookiesBanner ×3, PlanSelector ×1, DataPrivacyPanel ×1)

## Hors-scope (renvoyé)
- Mobile/PWA E2E (Capacitor specs natives) → Sprint 27
- Refactor specs S35/LOT E vers nouveaux helpers → règle additif inter-sprints
- Backdoor `/api/e2e/*` → JAMAIS (S23 sécurité)
- Visual regression nouvelles → backlog post-RC
- CI workflow GitHub Actions → Antigravity hôte (VM sans git)
- Tests perf / Lighthouse CI → backlog Sprint 30
- Refonte SlidePanel `role="dialog"` → Sprint 29 a11y

## §6 Contrats figés

### 6.1 (cette doc)

### 6.2 Helper auth — `tests/e2e/_helpers/auth.ts`
- Export `setupAuth(page, options?): Promise<void>`
- Defaults : `token='dev-bypass-token'`, `locale='fr-CA'`, user admin
- Options `{ user?, locale?, token? }` — override possible

### 6.3 Helper mocks — `tests/e2e/_helpers/api-mocks.ts`
- Export `DEFAULT_API_MOCKS: Record<string, unknown>` (16 entrées smoke canoniques)
- Export `installApiMocks(page, overrides?, options?): Promise<void>` — page.route avec longest-prefix match
- POST/PUT/PATCH/DELETE → réponse générique success

### 6.4 Fixture — `tests/e2e/_fixtures/test.ts`
- `export const test = base.extend<{ authedPage: Page }>` (fixture combo auth + default mocks)
- Pas de teardown spécial (contextes Playwright isolés)

### 6.5 Page Objects — `tests/e2e/_pages/{Sidebar,AppLayout}.ts` (Manager-C)
- Sidebar : `gotoLeads()`, `gotoPipeline()`, `gotoSettings()`, `gotoGettingStarted()`, `gotoAdminObservability()`
- AppLayout : `greeting()`, `fab()`

### 6.6 Specs — `tests/e2e/{onboarding-checklist,billing-plans,cookies-consent,data-privacy,admin-observability}.spec.ts` (Manager-C)
- 1-2 tests par spec, 60s timeout, pattern fixture standardisée

### 6.7 ChirurgicalEdits data-testid (Manager-C)
- `CookiesBanner.tsx` : 3 testids boutons (`cookies-accept-all`, `cookies-reject-non-essential`, `cookies-customize`)
- `PlanSelector.tsx` : 1 testid sur toggle (`plan-selector-toggle-{monthly|yearly}`)
- `DataPrivacyPanel.tsx` : 1 testid sur bouton export (`data-privacy-export-btn`)
- Règle ABSOLUE : ajout pur, ZERO refactor

### 6.8 package.json scripts (Phase A — additif)
```json
"test:e2e:ui": "npx playwright test --project=smoke --ui",
"test:e2e:headed": "npx playwright test --project=smoke --headed"
```

## Procédure de run (documentée, NON exécutée VM)

```bash
bun run build
bun run preview &           # port 4173, auto-démarré par playwright.config
bun run test:e2e            # smoke + 5 nouvelles specs
bun run test:e2e:headed     # debug visuel
bun run test:e2e:ui         # Playwright UI mode
```

## Garde-fous
- Pattern `addInitScript` AVANT `page.goto` (sinon localStorage vide → AuthGuard redirect)
- `waitUntil: 'domcontentloaded'` (load trop lent, networkidle flaky)
- Sélecteurs : privilégier `getByRole`/`[role="dialog"]`/`[data-tier=…]` AVANT data-testid
- 3 testids MAX ajoutés, JAMAIS de refactor de page applicative
- AUCUN backdoor auth/seed
- AUCUNE validation intermédiaire — run groupé par Antigravity hôte à la fin LOT 3
