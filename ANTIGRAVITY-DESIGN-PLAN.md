# ANTIGRAVITY-DESIGN-PLAN.md — Sprint Design UX/UI

> Rédigé le 2026-05-10 par Antigravity. Source de vérité visuelle : `design-mockup.html`.

---

## A. Validation pré-sprint

- ✅ Ouvert `design-mockup.html` — direction comprise (sidebar dark #0D0D18, fond blanc #FAFBFC, brand cyan #009DDB, accent orange #D96E27, Inter font)
- ✅ Sprint 2 vertical Leads fini et committé (b3c49fb)
- ✅ Build vert (`bun run build` — 0 erreurs TS)
- ⚠️ 1 fichier modifié non committé : `design-mockup.html` — à committer avant D.0

---

## B. Dépendances à installer

| Package | Taille estimée | Usage |
|---|---|---|
| `lucide-react` | ~25 KB | Icônes cohérentes |
| `sonner` | ~8 KB | Toasts accessibles |
| `cmdk` | ~10 KB | Command palette ⌘K |
| `@radix-ui/react-dialog` | ~12 KB | Modals |
| `@radix-ui/react-dropdown-menu` | ~10 KB | Menus dropdown |
| `@radix-ui/react-popover` | ~8 KB | Popovers |
| `@radix-ui/react-tabs` | ~6 KB | Tabs |
| `@radix-ui/react-tooltip` | ~7 KB | Tooltips |
| `@radix-ui/react-toggle-group` | ~5 KB | Toggle groups |
| `clsx` | ~1 KB | Class conditionnelle |
| `tailwind-merge` | ~5 KB | Merge Tailwind classes |
| `@fontsource-variable/inter` | ~30 KB | Inter self-hosted |

**Total estimé : ~127 KB gzipped**

---

## C. Plan détaillé (5 phases)

### Phase D.0 — Setup (0.5j)

1. Install deps via `bun add`
2. Créer `src/lib/cn.ts` (clsx + tailwind-merge)
3. Créer 15 fichiers composants dans `src/components/ui/`
4. Créer barrel `src/components/ui/index.ts`
5. Créer page `/dev/components` (dev only showcase)
6. Commit : `chore(design): install deps + setup ui structure`

### Phase D.1 — Tokens + composants UI core (1j)

1. Refondre `src/index.css` — tokens §2 DESIGN-SPRINT (couleurs, typo, spacing, radius, shadows, transitions, animations)
2. Implémenter 15 composants : Button (5 variants × 3 sizes), Input, Card, Badge (6 intents × 3 fills), Modal (Radix), Toast (sonner), Skeleton, EmptyState, Table, DropdownMenu, Popover, Tabs, Tooltip, Avatar, Sparkline
3. `/dev/components` showcase
4. Commit : `refactor(design): new design tokens + ui core components`

### Phase D.2 — Layout (1j)

1. Sidebar.tsx : fond dark, lucide icons, sections groupées, collapsible, footer avatar
2. AppLayout.tsx : header sticky 56px, search ⌘K, theme toggle
3. SubNav.tsx : rail 200px pour Settings/Reports
4. Audit régressions pages existantes
5. Commit : `refactor(design): new layout (sidebar + header + subnav)`

### Phase D.3a — Dashboard (1.5j)

- Greeting + period selector + 4 stat cards sparklines + chart + activity feed + table
- Commit : `refactor(design): dashboard page refresh`

### Phase D.3b — Leads list (1.5j)

- Search + filter chips + table data-dense + pagination + view switcher
- Commit : `refactor(design): leads list page refresh`

### Phase D.3c — LeadDetail (2j)

- 2-column layout : left sticky card (320px) + right tabs flex-1
- Commit : `refactor(design): lead detail page refresh`

### Phase D.4 — Polish (0.5j)

- Page transitions, consistency audit, responsive 375px, Lighthouse >90
- Commit : `chore(design): polish, a11y, responsive audit`

---

## D. Risques techniques

| # | Risque | Impact | Mitigation |
|---|---|---|---|
| R1 | Tokens CSS = breaking change toutes pages | Élevé | D.1 avant D.3 + test chaque page |
| R2 | Bundle Radix+lucide > 1MB | Moyen | Tree-shake + vérif après D.0 |
| R3 | Mockup = Tailwind v3, code = v4 | Faible | Tester après D.1 |
| R4 | Pages non refondues cassées par nouveaux tokens | Élevé | Mapper anciennes vars CSS → nouvelles |
| R5 | Inter self-hosted +30KB | Faible | @fontsource optimisé |

---

## E. Anti-feature-creep

**INTERDICTION** pendant Sprint Design :
- Ajouter features / toucher backend / refondre pages non listées / ajouter migration SQL

---

## F. Estimation

| Phase | Effort | Cumul |
|---|---|---|
| D.0 Setup | 0.5j | 0.5j |
| D.1 Tokens + UI | 1j | 1.5j |
| D.2 Layout | 1j | 2.5j |
| D.3a Dashboard | 1.5j | 4j |
| D.3b Leads | 1.5j | 5.5j |
| D.3c LeadDetail | 2j | 7.5j |
| D.4 Polish | 0.5j | 8j |
| **Total** | **~7-8j** | — |

---

## G. Questions pour Rochdi

> [!IMPORTANT]
> 1. **Inter** : `@fontsource-variable/inter` (self-hosted, recommandé) ou Google Fonts CDN ?
> 2. **lucide-react** : confirmé ? (~25 KB, remplace emojis dans nav)
> 3. **Pages non refondues** : laisser ancien style ou patch minimal tokens-only ?
