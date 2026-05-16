# Visual regression — Sprint 50 M1.2

Date : 2026-05-16
Statut : **setup + scripts prêts** — pas de run dans ce sprint (VMware, pas de
bun/npx disponible). Baseline à générer au prochain environnement avec bun.

## Ce qui existe

- `tests/visual/snapshots.spec.ts` (historique) — 5 snapshots :
  dashboard / leads / pipeline / clients / settings.
  Baselines présentes dans `tests/__screenshots__/snapshots.spec.ts/`.
- `tests/visual/full-regression.spec.ts` (**nouveau Sprint 50**) — 20 snapshots
  release-candidate.

## Couverture full-regression.spec.ts (20 snapshots)

| # | Snapshot | Route | Groupe |
|---|---|---|---|
| 1 | rc-dashboard | /dashboard | Cœur |
| 2 | rc-leads | /leads | Cœur |
| 3 | rc-lead-detail | /leads/demo-1 | Cœur |
| 4 | rc-pipeline | /pipeline | Cœur |
| 5 | rc-tasks | /tasks | Cœur |
| 6 | rc-inbox | /conversations | Cœur |
| 7 | rc-calendar | /calendar | Cœur |
| 8 | rc-reports | /reports | Cœur |
| 9 | rc-settings | /settings | Cœur |
| 10 | rc-admin-overview | /admin/overview | Cœur |
| 11 | rc-login | /login | Auth/mkt |
| 12 | rc-landing | / | Auth/mkt |
| 13 | rc-pricing | /pricing | Auth/mkt |
| 14 | rc-cmd-palette | /dashboard + Ctrl+K | Overlay |
| 15 | rc-notifications-panel | /dashboard + cloche | Overlay |
| 16 | rc-welcome-wizard | /dashboard (onboarding non-skippé) | Overlay |
| 17 | rc-empty-leads | /leads (data vide) | État |
| 18 | rc-m-dashboard | /dashboard @390×844 | Mobile |
| 19 | rc-m-leads | /leads @390×844 | Mobile |
| 20 | rc-m-inbox | /conversations @390×844 | Mobile |

## Config Playwright (projects)

`playwright.config.ts` — projects (préservés + ajoutés Sprint 50) :

- `smoke` — E2E 5 flows (Sprint 35, chromium) — **inchangé**
- `chromium` — snapshots historiques (Sprint précédents) — **inchangé**
- `webkit` — **nouveau** ≈ Safari desktop
- `firefox` — **nouveau** Gecko
- `mobile-safari` — **nouveau** device iPhone 14 (Mobile Safari)

Playwright suffixe automatiquement les snapshots par projet
(`{name}-{projectName}-{platform}{ext}`) → baselines distinctes
chrome/webkit/firefox sans collision.

## Comment générer la baseline (env avec bun)

```bash
# 1. Build + serveur preview (auto via webServer dans la config)
npm run build

# 2. Générer TOUTES les baselines (tous projets)
npm run test:visual:update
#   ≈ npx playwright test --update-snapshots

# 3. Ou cibler le nouveau spec uniquement
npx playwright test full-regression --update-snapshots

# 4. Ou un seul navigateur
npx playwright test full-regression --project=webkit --update-snapshots
```

## Comment vérifier la régression (CI)

```bash
npm run test:visual
#   échoue si diff pixel > maxDiffPixelRatio (0.01, défini dans la config)
```

Reports HTML dans `tests/results/`. Traces conservées en cas d'échec
(`trace: 'retain-on-failure'`).

## Notes

- Animations figées via `freezeAnimations()` (transition/animation 0s) →
  snapshots déterministes.
- API mockée via `page.route(/\/api\//)` → aucune dépendance backend/D1.
- Auth injectée via `addInitScript` localStorage (`intralys_token`) avant
  le mount React.
- `webServer` lance `bun run preview` (port 4173) avec
  `reuseExistingServer: true` → réutilise un serveur déjà up.
- ⚠️ Premier run sans baseline = échec attendu (génère les .png). Lancer
  d'abord `--update-snapshots` pour créer la baseline de référence.
