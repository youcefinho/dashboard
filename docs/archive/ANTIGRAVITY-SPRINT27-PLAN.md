# ANTIGRAVITY-SPRINT27-PLAN.md — Chaman audit + plan (12 sub-tâches)

> **Sprint 27 — Design depth continuité** (suite Sprints 23-26)
> Plan préparé par Chaman avant context reset.
>
> ## ⚠️ UPDATE 2026-05-14 — Status post-Antigravity intervention
>
> Antigravity (Gemini) a livré pendant le reset les Sprints 27/28/29 **partiellement** :
>
> **✅ DONE** (Sprints 27/28/29 marqués dans ROADMAP) :
> - **27-1A** Tables premium Leads + Tasks table mode 3ᵉ vue (Sprint 27)
> - **27-4A** `AiInsightCard` 3 variants (hot-lead/stuck-deal/week-wins) + wiring Dashboard (Sprint 28)
> - **27-5A** `usePullToRefresh.tsx` hook créé (wirage 4 listes à vérifier) (Sprint 28)
> - **27-4B** Dashboard Presets 3 (Manager/Agent/Admin) inline dans Dashboard.tsx (Sprint 29 — pas de fichier `DashboardPresets.tsx` séparé)
> - PipelineSettings refactor en **3 tabs inline** (Sprint 27 — approche différente de mon plan 27-3A Wizard)
> - Shift+R refresh shortcut + loadData refactor (Sprint 29 — extra non-prévu)
> - 9 erreurs TS fixées
>
> **❌ TODO** (8 sub-tâches restantes pour Sprint 30) :
> - **27-1B** Reports tables premium + `CellHoverInfo` primitive
> - **27-2A** CommandPalette fuzzy + filters in-palette + `lib/fuzzy.ts`
> - **27-2B** MessageComposer slash-vars + `lib/snippetVars.ts`
> - **27-3A bis** Wizard `embedded` prop (PipelineSettings fait via tabs, Wizard reste à étendre pour autres usages futurs)
> - **27-3B** ApiWebhooksSettings wizard + `ScopePicker` primitive
> - **27-5A bis** Wirage `usePullToRefresh` sur 4 listes (Leads/Tasks/Inbox/Pipeline)
> - **27-5B** `useEdgeSwipe` + QuickAddFab enrichi (scroll-shrink + long-press fan-out)
> - **27-6A + 27-6B** Icon migration progressive (~18 fichiers + audit reduce-motion final)
>
> **Mode décidé** : **FULL 18 entités** — plan complet dans [`ANTIGRAVITY-SPRINT30-PLAN.md`](./ANTIGRAVITY-SPRINT30-PLAN.md) (12 sub-tâches × 3 Managers × 4 = wall-clock ~4.5h parallèle).
> Les 8 sub-tâches restantes ci-dessus + 4 extras (Reports filters in-palette, Settings nav search, Wizard embedded prop, AI insights 2 variants additionnels) = 12 atomic équilibrés.
>
> ---
> **Mode** : Full power 18 entités (Chaman ✅ déjà fait + 3 Managers × 4 tâches = 12 atomic)

---

## 1. État actuel (audit lecture seule)

### Tables (`Leads.tsx` 1341L)
**Déjà fait Sprint 27 partiellement amorcé** : `.table-premium`, `.col-frozen`, `.table-expand-trigger`, `.table-expand-content`, `.score-breakdown` (CSS lignes 4200-4393). `LeadTableRow` (ligne 1045) wired avec frozen col + expand inline + score tooltip breakdown.
**Reste à faire** :
- Tasks (895L) + Reports (522L) tables : aucune trace de `.table-premium`. Doivent recevoir frozen-cols + expand + hover info.
- `.cell-hover-info` (cell-level tooltips) inexistant — vraie nouveauté.

### Settings monolithiques candidats wizard
- **PipelineSettings.tsx** 589L — confirmé massive : pipelines + stages éditeurs inline imbriqués. Wizard 3 steps optimal (Liste pipelines → Stages config → Type/probabilité win/loss). **Mais** : `<Wizard>` actuel est conçu pour modal flow linéaire (Sprint 26). Pipeline = mode **embedded** récurrent (re-éditer même pipeline N fois). Adapt Wizard avec prop `embedded`.
- **ApiWebhooksSettings.tsx** 315L — touche 2 entités (API keys + webhooks). Wizard 2 steps make sense (Choix type → Config + scopes).

### Dashboard.tsx (948L)
Système widgets déjà en place (`WidgetConfig[]` localStorage `intralys_dashboard_widgets`) — toggle visible + reorder via `order: number`. **Drag-drop layout** = step suivant naturel (HTML5 DnD natif suffit). **AI insights cards** = nouvelle row avant grid widgets, contextuelles selon données.

### CommandPalette.tsx (612L)
Déjà solide : intent engine, favoris, recents, saved searches, ROUTE_KEYWORDS. **Manque** :
- Fuzzy scoring (actuellement `.includes()` basique)
- Filters in-palette (`status:hot`, `source:meta`) — actuellement uniquement keyword search

### MessageComposer.tsx (212L)
Slash-snippets et templates déjà câblés. **Manque** :
- Snippets pickers généralisés (variables `{{name}}`, `{{deal_value}}`, `{{stage}}` interpolés)
- Slash menu enrichi avec section "Variables"

### Mobile (AppLayout 624L)
Aucun pull-to-refresh ni edge-swipe trouvé. `useHaptic` + `useSound` disponibles Sprint 25. Capacitor importé.

### QuickAddFab.tsx (278L)
FAB statique. Enrichissement : long-press → expand arc 4 actions ; scroll-down → shrink to icon-only ; haptic feedback.

### Icon migration (94 fichiers Lucide direct)
**Énorme scope** — migration progressive ciblée **18-22 fichiers haute-visibilité**. Le reste reste back-compat.

---

## 2. 12 sub-tâches × 6 vagues thématiques

### Vague 27-1 — Tables polish remainder

#### Sub-tâche 27-1A — Tasks table premium (frozen + expand + hover)
**Manager** : M1
**Fichiers WRITE** :
- `src/pages/Tasks.tsx` (refactor `viewMode === 'list'` rendering vers `.table-premium-container` + `.table-premium` ; reuse pattern Leads.tsx 1045-1330 ; expand row inline = subtasks + comments preview ; frozen first col = checkbox + title)
- `src/index.css` (append `/* ── Sprint 27 vague 27-1A bis — Tasks table polish ── */` : prio Hot column highlight, due-date overdue style, status-icon col width tight)
**Files dépendances READ** : Leads.tsx 820-1330, index.css 4200-4393, lib/types.ts
**Conflits** : zéro (Tasks.tsx exclusif M1)
**Acceptance** : Kanban inchangé · list mode frozen 2 cols · header sticky 72vh · expand row 250ms cubic-bezier · `prefers-reduced-motion` respect · bulk select fonctionnel
**Effort** : ~55 min

#### Sub-tâche 27-1B — Reports tables premium + CellHoverInfo primitive
**Manager** : M1
**Fichiers WRITE** :
- `src/pages/Reports.tsx` (tables Funnel/Sources/Performance → `.table-premium-container`)
- `src/components/reports/ReportComponents.tsx` (12 sub-reports, refactor uniforme)
- `src/components/ui/CellHoverInfo.tsx` **NOUVELLE PRIMITIVE** (tooltip 280ms delay sur `<td>` riche : breakdown numerics, sparkline mini, trend %)
- `src/components/ui/index.ts` (append `// ── Sprint 27 vague 27-1B — CellHoverInfo ──`)
- `src/index.css` (append `/* ── Sprint 27 vague 27-1B — Cell hover info ── */` : `.cell-hover-trigger`, `.cell-hover-popover` glassmorphism + brand shadow)
**Files dépendances READ** : Tooltip.tsx, LeadHoverPreview.tsx
**Acceptance** : API `<CellHoverInfo content={...} delay={280}><td>$X</td></CellHoverInfo>` · 280ms delay · brand shadow · max-w 220px · wired sur 4-6 cells Reports
**Effort** : ~50 min

### Vague 27-2 — Search global + Inbox composer enrichis

#### Sub-tâche 27-2A — CommandPalette fuzzy + filters in-palette
**Manager** : M1
**Fichiers WRITE** :
- `src/components/CommandPalette.tsx` (fuzzy scoring Levenshtein-lite + section "Filters" : `status:hot`/`source:meta`/`client:acme` → filtre instant)
- `src/lib/fuzzy.ts` **NOUVEAU** (`fuzzyScore(needle, haystack): number 0-1` Levenshtein early bail + char-position weighting)
- `src/index.css` (append `/* ── Sprint 27 vague 27-2A — CmdPalette filters chips ── */`)
**Acceptance** : `hot` → leads score≥70 first · `status:new` → filter section reveal · `:` seul → filters disponibles · recents/favoris préservés
**Effort** : ~60 min

#### Sub-tâche 27-2B — MessageComposer slash-vars
**Manager** : M1
**Fichiers WRITE** :
- `src/components/Inbox/MessageComposer.tsx` (slash-commands `/var name`/`/var deal`/`/var stage` interpolation runtime ; fallback `{{var}}` literal si pas de lead context ; preview pré-interpolation)
- `src/lib/snippetVars.ts` **NOUVEAU** (`resolveVars(text, leadCtx): { resolved, missing[] }` ; 8 vars : name, email, phone, deal_value, stage, client_name, score, today)
- `src/index.css` (append `/* ── Sprint 27 vague 27-2B — Var chip composer ── */`)
**Acceptance** : Slash menu Snippets + Templates + Variables · autocomplete 8 vars · chips warning si lead absent · preview hover valeur
**Effort** : ~50 min

### Vague 27-3 — Settings wizards monolithic refactor

#### Sub-tâche 27-3A — PipelineSettings wizard 3 steps + Wizard `embedded` prop
**Manager** : M2
**Fichiers WRITE** :
- `src/components/settings/PipelineSettings.tsx` (refactor : retirer édition inline imbriquée, mode "Configurer" → Wizard 3 steps : Liste pipelines / Stages config drag-reorder / Win/loss probabilités)
- `src/components/ui/Wizard.tsx` (étendre : prop `embedded?: boolean` — quand true, rendu inline pas dans Modal)
- `src/index.css` (append `/* ── Sprint 27 vague 27-3A — Wizard embedded variant ── */` : `.wizard-embedded`)
**Conflits** : `Wizard.tsx` shared. Default `embedded={false}` préserve TeamSettings/BrandingSettings Sprint 26.
**Acceptance** : Pipeline créé fonctionnel · mode embedded no overlay no Esc-close · persistKey `pipeline-config:{id}` · Sprint 26 wizards inchangés
**Effort** : ~70 min

#### Sub-tâche 27-3B — ApiWebhooksSettings wizard 2 steps + ScopePicker primitive
**Manager** : M2
**Fichiers WRITE** :
- `src/components/settings/ApiWebhooksSettings.tsx` (Modals → `<Wizard embedded={false}>` 2 steps chacun : Type & nom / Scopes ou Events multi-select)
- `src/components/ui/ScopePicker.tsx` **NOUVELLE PRIMITIVE** (multi-select chips grille catégorisée : 8 scopes API + 12 events webhook par cat lead/deal/task/conversation)
- `src/components/ui/index.ts` (append `// ── Sprint 27 vague 27-3B — ScopePicker ──`)
- `src/index.css` (append `/* ── Sprint 27 vague 27-3B — Scope picker grid ── */`)
**Acceptance** : API keys création Wizard 2 steps · scopes selectable · webhooks events selectable · created key Modal one-time préservé
**Effort** : ~55 min

### Vague 27-4 — AI insights cards Dashboard

#### Sub-tâche 27-4A — AiInsightsCard primitive + AiInsightsRow Dashboard
**Manager** : M2
**Fichiers WRITE** :
- `src/components/ui/AiInsightsCard.tsx` **NOUVELLE PRIMITIVE** (Card variant AI gradient brand→accent 12% + sparkles + title + reason + CTA + dismiss localStorage)
- `src/components/dashboard/AiInsightsRow.tsx` **NOUVEAU** (orchestre 4 cards : HotLeadInsight, StuckDealInsight, WeekWinsInsight, DormantLeadsInsight ; heuristics depuis leads + stats props)
- `src/pages/Dashboard.tsx` (`<AiInsightsRow>` avant grid widgets, après PageHero)
- `src/components/ui/index.ts` (append `// ── Sprint 27 vague 27-4A — AiInsightsCard ──`)
- `src/index.css` (append `/* ── Sprint 27 vague 27-4A — AI insights row ── */`)
**Acceptance** : 4 cards heuristics réels (Hot lead score≥70 sans contact, Stuck deal stage>14d, Week wins, Dormant>30d) · dismiss localStorage 7-day expiry · AI badge top-right · pas API call (mocked, prêt Claude Haiku)
**Effort** : ~75 min

#### Sub-tâche 27-4B — Dashboard widget drag-drop + presets
**Manager** : M2
**Fichiers WRITE** :
- `src/pages/Dashboard.tsx` (HTML5 native drag handlers ; visual ghost clone + drop-zone highlight ; persist `saveWidgetConfig`)
- `src/components/dashboard/DashboardPresets.tsx` **NOUVEAU** (modal preset picker : 3 presets manager/agent/admin + bouton "Sauvegarder comme preset perso")
- `src/index.css` (append `/* ── Sprint 27 vague 27-4B — Widget drag-drop ── */` : `.widget-card[draggable]` cursor grab, `.is-dragging` opacity 50% rotate 1°, `.widget-drop-zone` pulse brand outline 2px dashed)
**Acceptance** : Drag-handle grip top-left au hover · ghost clone tilt 1° + drop zones · reorder persist localStorage · touch long-press 400ms via useLongPress · 3 presets apply 1 click · `prefers-reduced-motion` no tilt no clone instant swap
**Effort** : ~70 min

### Vague 27-5 — Mobile depth (Capacitor + gestures)

#### Sub-tâche 27-5A — usePullToRefresh hook + 4 listes wire
**Manager** : M3
**Fichiers WRITE** :
- `src/hooks/usePullToRefresh.ts` **NOUVEAU HOOK** (pure JS touch listeners, threshold 80px, `{ pullDistance, isRefreshing, pullProps }` ; déclenche `onRefresh()` + haptic medium + sound `success` à release)
- `src/components/ui/PullToRefreshIndicator.tsx` **NOUVELLE PRIMITIVE** (spinner gradient brand qui grandit avec pullDistance, transformY proportionnel)
- `src/components/ui/index.ts` (append `// ── Sprint 27 vague 27-5A — PullToRefresh ──`)
- `src/pages/Leads.tsx`, `Tasks.tsx`, `Inbox.tsx`, `Pipeline.tsx` (wire `usePullToRefresh` mobile-only via `pointer:coarse` detect)
- `src/index.css` (append `/* ── Sprint 27 vague 27-5A — Pull to refresh ── */`)
**Files dépendances READ** : useHaptic, useSound (Sprint 25), Skeleton
**Conflits** : Tasks.tsx, Leads.tsx aussi touchés par M1 → **séquencer M1 first, M3 ensuite**
**Acceptance** : pull 80px → refresh · indicator spinner gradient rotate · haptic medium au threshold, sound success · desktop no-op · `prefers-reduced-motion` no rotation
**Effort** : ~70 min

#### Sub-tâche 27-5B — useEdgeSwipe + QuickAddFab enrichi
**Manager** : M3
**Fichiers WRITE** :
- `src/hooks/useEdgeSwipe.ts` **NOUVEAU HOOK** (detect touchstart clientX<20px edge, track swipe right, threshold 100px → `onSwipeBack()` ; haptic light start, medium au threshold)
- `src/components/layout/AppLayout.tsx` (wire `useEdgeSwipe({ onSwipeBack: () => navigate({ history: 'back' }) })` mobile only + EdgeSwipeIndicator overlay glow gradient brand left edge)
- `src/components/QuickAddFab.tsx` (scroll-aware shrink Y>200px → 40px icon-only ; long-press 400ms → expand fan-out arc 4 actions ; haptic light/medium)
- `src/index.css` (append `/* ── Sprint 27 vague 27-5B — Edge swipe + FAB enrich ── */` : `.edge-swipe-indicator`, `.fab-shrunk`, `.fab-fan-out` arc 80deg radius 64px)
**Files dépendances READ** : QuickAddFab.tsx 1-100, useLongPress, AppLayout 1-80
**Acceptance** : edge swipe → back navigation · glow gradient left edge pendant swipe · FAB shrink/grow scroll · long-press → fan-out arc 4 actions · tap normal → popover fallback · `prefers-reduced-motion` no transitions
**Effort** : ~75 min

### Vague 27-6 — Icon migration + polish

#### Sub-tâche 27-6A — Icon migration core (18 fichiers high-visibility)
**Manager** : M3
**Fichiers WRITE** (chacun : remplace `import { X } from 'lucide-react'` + JSX `<X size={N}/>` par `import { Icon } from '@/components/ui'` + `<Icon name="x" size="sm"/>`) :
- AppLayout.tsx (~12 icons header)
- Sidebar.tsx (~8 icons nav)
- MobileBottomNav.tsx (~5 icons)
- CommandPalette.tsx (kbd chips)
- Settings.tsx (~8 icons tabs)
- TeamSettings.tsx, SystemSettings.tsx, NotificationsSettings.tsx, SecuritySettings.tsx, BillingSettings.tsx, RolesPermissionsSettings.tsx (~30 icons total)
- landing/Home.tsx (~10 icons), landing/Pricing.tsx (~6 icons)
- `src/components/ui/Icon.tsx` (étendre map si nouvelles icons requises)
**Acceptance** : 18 fichiers migrés, build vert, aucun changement visuel (stroke 1.75 déjà via Icon) · `Icon` accepte size enum xs/sm/md/lg/xl → 12/14/16/20/24 · 76 autres fichiers Lucide-direct back-compat
**Effort** : ~65 min

#### Sub-tâche 27-6B — Tasks/Reports/Leads/Pipeline/Calendar icons + reduce-motion audit final ⚠️ LAST
**Manager** : M3
**Fichiers WRITE** :
- Tasks.tsx (~10 icons, séquence M1 first), Reports.tsx (~14 icons), Leads.tsx (~22 icons, careful merge), ReportComponents.tsx (icons), Pipeline.tsx (~6), Calendar.tsx (~6)
- `src/index.css` audit complet : append `/* ── Sprint 27 vague 27-6B — Reduce-motion polish ── */` final consolidated `@media (prefers-reduced-motion: reduce) { .ai-insight-card, .widget-card, .fab-fan-out, .ptr-spinner, .edge-swipe-indicator, .table-expand-trigger, .table-expand-content, .cell-hover-popover, .wizard-embedded, .scope-chip { animation: none !important; transform: none !important; transition: opacity 120ms !important; } }`
**Conflits** : ⚠️ **MUST run LAST** dans M3 + tous autres vagues finished. Si M1/M2 pas finished : skip merge sections concernées + standalone audit.
**Acceptance** : 6 fichiers icon-migrated · reduce-motion audit consolidé tous Sprint 27 classes · test Chrome + prefers-reduced-motion forced → no animations · build vert · bundle delta <5KB
**Effort** : ~80 min

---

## 3. File-ownership matrix

| Fichier | Owner principal | Co-touchers | Type modif |
|---|---|---|---|
| `src/pages/Leads.tsx` | M3-6B | (existing W27-1A déjà fait) | Icon migrate only |
| `src/pages/Tasks.tsx` | M1-1A | M3-5A (PtR wire), M3-6B (icons) | Refactor table → PtR → icons sequential |
| `src/pages/Reports.tsx` | M1-1B | M3-6B (icons) | Wrapper tables + icons |
| `src/pages/Dashboard.tsx` | M2-4A puis M2-4B | — | M2 séquentiel interne |
| `src/pages/Pipeline.tsx` | M3-5A puis M3-6B | — | PtR + icons |
| `src/pages/Calendar.tsx` | M3-6B | — | Icons only |
| `src/pages/Inbox.tsx` | M3-5A | — | PtR wire |
| `src/components/CommandPalette.tsx` | M1-2A | — | Exclusive M1 |
| `src/components/Inbox/MessageComposer.tsx` | M1-2B | — | Exclusive M1 |
| `src/components/settings/PipelineSettings.tsx` | M2-3A | — | Exclusive M2 |
| `src/components/settings/ApiWebhooksSettings.tsx` | M2-3B | — | Exclusive M2 |
| `src/components/layout/AppLayout.tsx` | M3-5B puis M3-6A | — | Sequential interne M3 |
| `src/components/layout/Sidebar.tsx` | M3-6A | — | Icons only |
| `src/components/layout/MobileBottomNav.tsx` | M3-6A | — | Icons only |
| `src/components/QuickAddFab.tsx` | M3-5B | — | Enrich FAB |
| `src/components/ui/Wizard.tsx` | M2-3A | — | Add `embedded` prop |
| `src/components/ui/Icon.tsx` | M3-6A | — | Extend map if needed |
| `src/components/ui/CellHoverInfo.tsx` | M1-1B | — | **NOUVEAU** |
| `src/components/ui/ScopePicker.tsx` | M2-3B | — | **NOUVEAU** |
| `src/components/ui/AiInsightsCard.tsx` | M2-4A | — | **NOUVEAU** |
| `src/components/ui/PullToRefreshIndicator.tsx` | M3-5A | — | **NOUVEAU** |
| `src/components/dashboard/AiInsightsRow.tsx` | M2-4A | — | **NOUVEAU** |
| `src/components/dashboard/DashboardPresets.tsx` | M2-4B | — | **NOUVEAU** |
| `src/hooks/usePullToRefresh.ts` | M3-5A | — | **NOUVEAU** |
| `src/hooks/useEdgeSwipe.ts` | M3-5B | — | **NOUVEAU** |
| `src/lib/fuzzy.ts` | M1-2A | — | **NOUVEAU** |
| `src/lib/snippetVars.ts` | M1-2B | — | **NOUVEAU** |
| `src/components/reports/ReportComponents.tsx` | M1-1B | M3-6B (icons) | Refactor + icons |
| `src/components/ui/index.ts` | **TOUS** | append-only | Header `// ── Sprint 27 vague 27-XX — Name ──` |
| `src/index.css` | **TOUS** | append-only | Header `/* ── Sprint 27 vague 27-XX — Name ── */` |

**Règle d'or critique** : append-only sur `index.ts` et `index.css` avec headers Sprint 27. Pas d'écrasement Sprint 23-26.

---

## 4. Distribution Managers (4 tâches chacun)

### M1 "Data UX depth" — ~215 min
1. **27-1A** Tasks table premium (~55 min)
2. **27-1B** Reports tables + CellHoverInfo (~50 min)
3. **27-2A** CommandPalette fuzzy + filters (~60 min)
4. **27-2B** MessageComposer slash-vars (~50 min)

### M2 "Settings wizards + AI cards" — ~270 min
1. **27-3A** PipelineSettings wizard + Wizard `embedded` (~70 min)
2. **27-3B** ApiWebhooksSettings wizard + ScopePicker (~55 min)
3. **27-4A** AiInsightsCard + AiInsightsRow Dashboard (~75 min)
4. **27-4B** Dashboard widget drag-drop + presets (~70 min)

### M3 "Mobile gestures + Icon migration" — ~290 min
1. **27-5A** usePullToRefresh + 4 listes (~70 min)
2. **27-5B** useEdgeSwipe + QuickAddFab enrichi (~75 min)
3. **27-6A** Icon migration core 18 fichiers (~65 min)
4. **27-6B** Tasks/Reports/Leads/Pipeline/Calendar icons + reduce-motion audit ⚠️ LAST (~80 min)

**Wall-clock estimate** = max(215, 270, 290) ≈ **290 min ≈ 4.8h** parallèle (vs ~13h séquentiel = gain 2.7×).

---

## 5. Risques identifiés + mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| Tasks.tsx conflit M1-1A / M3-5A / M3-6B | 🔴 Haute | Séquence M1-1A → M3-5A (wrapper top-level) → M3-6B (last) |
| AppLayout.tsx M3-5B vs M3-6A | 🟡 Moyenne | Séquence interne M3 : 5B → 6A |
| Dashboard.tsx M2-4A vs M2-4B | 🟡 Moyenne | Séquence interne M2 : 4A → 4B |
| Wizard.tsx `embedded` régression Sprint 26 | 🟡 Moyenne | Default `embedded={false}` préserve TeamSettings/BrandingSettings. Test visuel obligatoire post-3A |
| index.css 4393L → conflits ordre @media | 🟢 Faible | Append-only strict + M3-6B audit final consolidé |
| CellHoverInfo vs Tooltip collisions | 🟢 Faible | Distinctes sémantiquement (delay 280ms glass vs 0 plain) |
| Drag-drop HTML5 sur touch | 🟡 Moyenne | useLongPress 400ms enable drag touch + preset picker fallback |
| Pull-to-refresh conflit scroll iOS | 🟡 Moyenne | `overscroll-behavior` + preventDefault uniquement quand pull>threshold start (scrollTop===0) |
| Icon migration 18 typecheck cascade | 🟡 Moyenne | M3-6A test AppLayout first puis batch · étendre Icon map si erreur |
| fuzzy.ts perf O(n*m) sur 1000+ leads | 🟢 Faible | Early bail Levenshtein > needle.length + sort + slice(50) |

---

## 6. Nouvelles primitives proposées (4 — pas 5+)

Réutilisation max 35 primitives existantes — uniquement 4 ajouts justifiés :

| # | Primitive | Path | Vague | Pourquoi |
|---|---|---|---|---|
| 1 | **CellHoverInfo** | `ui/CellHoverInfo.tsx` | 27-1B | Tooltip insuffisant pour cells riches (280ms delay + glass + sparkline mini + breakdown numerics). Sémantique distincte. |
| 2 | **ScopePicker** | `ui/ScopePicker.tsx` | 27-3B | Multi-select chips grid catégorisée scopes/events. FilterChip pas adapté (grid + cat + bulk all). |
| 3 | **AiInsightsCard** | `ui/AiInsightsCard.tsx` | 27-4A | AI insight pattern récurrent (Dashboard + LeadDetail + Settings future) = primitive justifiée. |
| 4 | **PullToRefreshIndicator** | `ui/PullToRefreshIndicator.tsx` | 27-5A | Visual indicator spinner gradient spécifique pull gesture. Skeleton/Toast pas adapté. |

**3 nouveaux composants non-primitives** : `dashboard/AiInsightsRow.tsx`, `dashboard/DashboardPresets.tsx`, (Wizard étendu prop `embedded` pas nouvelle primitive)

**3 nouveaux hooks** : `usePullToRefresh`, `useEdgeSwipe` + utilities `lib/fuzzy.ts`, `lib/snippetVars.ts`

---

## 7. Séquencement critique (timeline parallèle)

```
T0      M1-1A (Tasks)   |  M2-3A (Pipeline)   |  M3-6A (Icons core 18)
T+1h    M1-1B (Reports) |  M2-3B (ApiWh)      |  M3-5A (PullToRefresh)
T+2h    M1-2A (CmdP)    |  M2-4A (AI cards)   |  M3-5B (EdgeSwipe + FAB)
T+3h    M1-2B (Compos)  |  M2-4B (DragDrop)   |  M3-6B (Icons rest + audit ⚠️ LAST)
T+5h    ✅ DONE
```

⚠️ **M3-6B must be LAST** (touche fichiers déjà modifiés par M1-1A, M1-1B, M2-4A, M2-4B → audit reduce-motion).

---

## 8. Instructions reprise post-reset

Quand tu reprends la session (Claude / Gemini / Antigravity / autre agent), suis cet ordre :

1. **Read** ce fichier (`ANTIGRAVITY-SPRINT27-PLAN.md`) + [`AGENTS.md`](./AGENTS.md) + [`HANDOFF-PROMPT.md`](./HANDOFF-PROMPT.md)
2. **Demande validation user** : "Plan Sprint 27 prêt (12 sub-tâches × 3 Managers × 4). Go en parallèle ?"
3. **GO confirmé** : lance les 3 Managers en parallèle dans un **seul message multi-tool-calls** :
   - M1 prompt : briefe avec ses 4 tâches 27-1A/1B/2A/2B + constants design + read-before-write + append-only
   - M2 prompt : briefe avec ses 4 tâches 27-3A/3B/4A/4B
   - M3 prompt : briefe avec ses 4 tâches 27-5A/5B/6A/6B + ordre séquentiel interne (5B → 6A → 6B last)
   - Chaque prompt utilise `subagent_type: "general-purpose"`, `run_in_background: true`
4. **Au fil des notifications** : présente highlights ~200 mots par Manager complété
5. **Update final** :
   - Crée mémoire `sprint27_status.md` (livraisons détaillées)
   - Edit `MEMORY.md` index (+1 entrée Sprint 27)
   - Edit `ROADMAP.md` (Sprint 27 entry + +~2j dev → Total 231j)
   - Edit `AGENTS.md` section 6 si nouvelles primitives (CellHoverInfo, ScopePicker, AiInsightsCard, PullToRefreshIndicator) — total passera de 35 → 39

---

**Plan préparé** : 2026-05-14 par Chaman avant context reset
**Statut** : ⏳ En attente exécution post-reset
**Sprint cible** : 27 (Total prévisible 231j dev post-Sprint 27, 81 vagues cumulées)
