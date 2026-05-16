# ANTIGRAVITY-SPRINT30-PLAN.md — Full power 18 entités

> **Sprint 30 — Finition design depth** (suite Sprints 23-29)
> Mode : **Full 18 entités** (Chaman ✅ déjà fait + 3 Managers × 4 tâches = 12 atomic) pour wall-clock parallèle max.
> Reprend les 8 sub-tâches restantes du plan Sprint 27 + 4 extras pour équilibrer la charge.

---

## Contexte (post-Sprints 27/28/29 Antigravity)

Antigravity a livré pendant le context reset :
- ✅ Tables premium Leads + Tasks table mode + PipelineSettings 3 tabs inline (S27)
- ✅ `usePullToRefresh.tsx` + `AiInsightCard.tsx` 3 variants + CSS animations (S28)
- ✅ Dashboard Presets 3 (Manager/Agent/Admin) + Shift+R + loadData refactor (S29)

Voir mémoire [`sprint27_28_29_antigravity_status.md`] pour détails.

**Total actuel** : 232j dev cumulés.

---

## 12 sub-tâches × 6 vagues × 3 Managers × 4

### Vague 30-1 — Data UX completion

#### Sub-tâche 30-1A — Reports tables premium + `CellHoverInfo` primitive
**Manager** : M1
**Fichiers WRITE** :
- `src/pages/Reports.tsx` (tables Funnel/Sources/Performance → `.table-premium-container`)
- `src/components/reports/ReportComponents.tsx` (12 sub-reports, refactor uniforme)
- `src/components/ui/CellHoverInfo.tsx` **NOUVEAU** (tooltip 280ms delay riche : breakdown numerics + sparkline mini + trend %)
- `src/components/ui/index.ts` append
- `src/index.css` append `/* ── Sprint 30 vague 30-1A — Cell hover info ── */`

**API** : `<CellHoverInfo content delay={280}><td>$X</td></CellHoverInfo>`
**Acceptance** : 4-6 cells wired Reports · brand shadow · max-w 220px · `prefers-reduced-motion` instant show
**Effort** : ~50 min

#### Sub-tâche 30-1B — CommandPalette fuzzy + filters in-palette
**Manager** : M1
**Fichiers WRITE** :
- `src/components/CommandPalette.tsx` (fuzzy Levenshtein-lite + section "Filters" : `status:hot`/`source:meta`/`client:acme`)
- `src/lib/fuzzy.ts` **NOUVEAU** (`fuzzyScore(needle, haystack): number 0-1` early bail + char-position weighting)
- `src/index.css` append `.cmd-filter-chip`

**Acceptance** : `hot` → leads score≥70 first · `:` seul → filters section reveal · recents/favoris préservés
**Effort** : ~60 min

#### Sub-tâche 30-1C — Reports filters in-palette wiring (extension fuzzy)
**Manager** : M1
**Fichiers WRITE** :
- `src/pages/Reports.tsx` (wire `?filters=...` URL params depuis CmdPalette saved searches Reports)
- `src/components/CommandPalette.tsx` (extension ROUTE_KEYWORDS pour Reports : `reports:funnel`/`reports:sources`/`reports:performance`)

**Acceptance** : CmdPalette `reports:funnel` → ouvre /reports?view=funnel · filtres persistent entre routes
**Effort** : ~35 min

#### Sub-tâche 30-1D — Settings nav search global
**Manager** : M1
**Fichiers WRITE** :
- `src/pages/Settings.tsx` (Input search en haut du sidebar settings — filtre 14 sub-pages par nom/description)
- `src/index.css` append `.settings-nav-search`

**Acceptance** : Tape "API" → filter Webhooks · Tape "team" → filter TeamSettings · highlight match dans nav
**Effort** : ~35 min

---

### Vague 30-2 — Inbox + Wizards completion

#### Sub-tâche 30-2A — MessageComposer slash-vars + `lib/snippetVars.ts`
**Manager** : M2
**Fichiers WRITE** :
- `src/components/Inbox/MessageComposer.tsx` (slash-commands `/var name`/`/var deal`/`/var stage` interpolation runtime)
- `src/lib/snippetVars.ts` **NOUVEAU** (`resolveVars(text, leadCtx): { resolved, missing[] }` ; 8 vars : name/email/phone/deal_value/stage/client_name/score/today)
- `src/index.css` append `.composer-var-chip`

**Acceptance** : Slash menu Snippets + Templates + **Variables** · autocomplete 8 vars · chips warning si lead absent
**Effort** : ~50 min

#### Sub-tâche 30-2B — ApiWebhooksSettings wizard + `ScopePicker` primitive
**Manager** : M2
**Fichiers WRITE** :
- `src/components/settings/ApiWebhooksSettings.tsx` (Modals → `<Wizard>` 2 steps : Type & nom / Scopes multi-select)
- `src/components/ui/ScopePicker.tsx` **NOUVEAU** (grid catégorisée : 8 scopes API + 12 events webhook par cat lead/deal/task/conversation)
- `src/components/ui/index.ts` append
- `src/index.css` append `.scope-picker-grid`, `.scope-chip`

**Acceptance** : API keys + webhooks création via Wizard 2 steps · scopes/events selectable · created key Modal one-time préservé
**Effort** : ~55 min

#### Sub-tâche 30-2C — Wizard `embedded` prop (préparation futures usages)
**Manager** : M2
**Fichiers WRITE** :
- `src/components/ui/Wizard.tsx` (prop `embedded?: boolean` — quand true rendu inline sans Modal/Esc-close)
- `src/index.css` append `.wizard-embedded` (no shadow no border, step chip nav inline horizontal)

**Note** : PipelineSettings reste en 3 tabs (Antigravity choix), Wizard embedded prêt pour futurs usages (ex: BrandingSettings re-config, Onboarding embedded mode).

**Acceptance** : Default `embedded={false}` préserve Sprint 26 wizards (TeamSettings/BrandingSettings) · mode embedded testable sur StoryBook ou demo isolated
**Effort** : ~30 min

#### Sub-tâche 30-2D — AI insights enrichies (2 variants additionnels)
**Manager** : M2
**Fichiers WRITE** :
- `src/components/dashboard/AiInsightCard.tsx` (ajouter 2 variants : `dormant-leads-30d` + `pipeline-velocity-drop`)
- `src/pages/Dashboard.tsx` (wire les 2 nouveaux insights si conditions remplies)

**Heuristics** :
- `dormant-leads-30d` : `leads.filter(l => updated_at < 30 days).length >= 5`
- `pipeline-velocity-drop` : compare won_count this_week vs last_week, alert si drop >30%

**Acceptance** : 2 nouveaux variants dismissables localStorage 7-day · UI gradient brand cohérent existing 3 variants
**Effort** : ~45 min

---

### Vague 30-3 — Mobile gestures + Icons + PtR completion

#### Sub-tâche 30-3A — `useEdgeSwipe` + QuickAddFab enrichi
**Manager** : M3
**Fichiers WRITE** :
- `src/hooks/useEdgeSwipe.ts` **NOUVEAU HOOK** (detect touchstart clientX<20px edge, swipe right threshold 100px → `onSwipeBack()` + haptic light/medium)
- `src/components/layout/AppLayout.tsx` (wire `useEdgeSwipe` mobile only + `EdgeSwipeIndicator` overlay glow gradient brand left edge)
- `src/components/QuickAddFab.tsx` (scroll-aware shrink Y>200px → 40px icon-only ; long-press 400ms → expand fan-out arc 4 actions ; haptic light/medium)
- `src/index.css` append `/* ── Sprint 30 vague 30-3A — Edge swipe + FAB enrich ── */` : `.edge-swipe-indicator`, `.fab-shrunk`, `.fab-fan-out` arc 80deg radius 64px

**Acceptance** : edge swipe → back navigation · glow gradient pendant swipe · FAB shrink/grow scroll · long-press → fan-out arc · tap normal → popover fallback
**Effort** : ~75 min

#### Sub-tâche 30-3B — Icon migration core 18 fichiers high-visibility
**Manager** : M3
**Fichiers WRITE** (chacun : remplace `import { X } from 'lucide-react'` + `<X size={N}/>` par `import { Icon } from '@/components/ui'` + `<Icon name="x" size="sm"/>`) :
- AppLayout.tsx (~12 icons header)
- Sidebar.tsx (~8 icons nav)
- MobileBottomNav.tsx (~5 icons)
- Settings.tsx (~8 icons tabs)
- TeamSettings.tsx, SystemSettings.tsx, NotificationsSettings.tsx, SecuritySettings.tsx, BillingSettings.tsx, RolesPermissionsSettings.tsx (~30 icons total)
- landing/Home.tsx (~10 icons), landing/Pricing.tsx (~6 icons)

**Acceptance** : 18 fichiers migrés · build vert · aucun changement visuel (stroke 1.75 déjà) · 76 autres fichiers Lucide-direct back-compat
**Effort** : ~65 min

#### Sub-tâche 30-3C — Wirage `usePullToRefresh` 4 listes + `PullToRefreshIndicator` primitive
**Manager** : M3
**Fichiers WRITE** :
- `src/components/ui/PullToRefreshIndicator.tsx` **NOUVELLE PRIMITIVE** (factorise visual spinner gradient brand qui grandit avec `pullDistance` — actuellement probablement inline dans hook)
- `src/components/ui/index.ts` append
- Wirage hook sur 4 listes (audit first, wire si manquant) :
  - `src/pages/Leads.tsx`
  - `src/pages/Tasks.tsx`
  - `src/pages/Inbox.tsx`
  - `src/pages/Pipeline.tsx`
- `src/index.css` append `.ptr-indicator`, `.ptr-spinner` brand gradient ring conic-gradient

**Heads-up** : audit `usePullToRefresh.tsx` existant d'Antigravity AVANT — wire seulement où manquant.

**Acceptance** : 4 listes pull-to-refresh fonctionnel · indicator visible top · haptic medium au threshold · sound success à fin · desktop no-op
**Effort** : ~50 min

#### Sub-tâche 30-3D — Icon migration extended (~14 fichiers pages) + reduce-motion audit final ⚠️ LAST
**Manager** : M3
**Fichiers WRITE** :
- Tasks.tsx (~10 icons), Reports.tsx (~14 icons), Leads.tsx (~22 icons careful merge), ReportComponents.tsx (icons subcomponents), Pipeline.tsx (~6), Calendar.tsx (~6), Inbox.tsx (~10), LeadDetail.tsx (~14), Dashboard.tsx (~10)
- `src/index.css` audit complet : append `/* ── Sprint 30 vague 30-3D — Reduce-motion polish ── */` consolidé `@media (prefers-reduced-motion: reduce)` couvrant TOUTES classes Sprint 27-30 (.ai-insight-card, .widget-card, .fab-fan-out, .ptr-spinner, .edge-swipe-indicator, .table-expand-trigger, .cell-hover-popover, .wizard-embedded, .scope-chip, .ptr-indicator, .settings-nav-search, etc.)

**Conflits** : ⚠️ **MUST LAST** — touche fichiers déjà modifiés par M1-1A/1C, M2-2A. Si pas finished : skip merge zones + standalone audit.

**Acceptance** : ~14 fichiers icon-migrated (cumul 18+14 = 32 fichiers) · reduce-motion audit consolidé · build vert · bundle delta <5KB
**Effort** : ~80 min

---

## 4. File-ownership matrix

| Fichier | Owner | Type |
|---|---|---|
| `src/pages/Reports.tsx` | M1-1A puis M1-1C, M3-3D (icons last) | sequential |
| `src/components/CommandPalette.tsx` | M1-1B puis M1-1C | sequential M1 interne |
| `src/pages/Settings.tsx` | M1-1D, M3-3D (icons last) | sequential |
| `src/components/Inbox/MessageComposer.tsx` | M2-2A | exclusive |
| `src/components/settings/ApiWebhooksSettings.tsx` | M2-2B | exclusive |
| `src/components/ui/Wizard.tsx` | M2-2C | exclusive |
| `src/components/dashboard/AiInsightCard.tsx` | M2-2D | exclusive |
| `src/pages/Dashboard.tsx` | M2-2D, M3-3D (icons last) | sequential |
| `src/hooks/useEdgeSwipe.ts` | M3-3A | NOUVEAU |
| `src/components/QuickAddFab.tsx` | M3-3A | exclusive |
| `src/components/layout/AppLayout.tsx` | M3-3A puis M3-3B | sequential M3 interne |
| `src/components/layout/Sidebar.tsx` | M3-3B | exclusive |
| `src/pages/Leads.tsx`, `Tasks.tsx`, `Inbox.tsx`, `Pipeline.tsx` | M3-3C (PtR wire) puis M3-3D (icons) | sequential M3 interne |
| `src/components/ui/CellHoverInfo.tsx` | M1-1A | NOUVEAU |
| `src/components/ui/ScopePicker.tsx` | M2-2B | NOUVEAU |
| `src/components/ui/PullToRefreshIndicator.tsx` | M3-3C | NOUVEAU |
| `src/lib/fuzzy.ts` | M1-1B | NOUVEAU |
| `src/lib/snippetVars.ts` | M2-2A | NOUVEAU |
| `src/components/ui/index.ts` | TOUS | append-only |
| `src/index.css` | TOUS | append-only |

---

## 5. Distribution Managers (4 tâches chacun)

### M1 "Data UX completion" — ~180 min
1. **30-1A** Reports tables + CellHoverInfo (~50 min)
2. **30-1B** CmdPalette fuzzy + lib/fuzzy.ts (~60 min)
3. **30-1C** Reports filters in-palette wiring (~35 min)
4. **30-1D** Settings nav search (~35 min)

### M2 "Inbox + Wizards + AI completion" — ~180 min
1. **30-2A** MessageComposer slash-vars + lib/snippetVars.ts (~50 min)
2. **30-2B** ApiWh wizard + ScopePicker (~55 min)
3. **30-2C** Wizard `embedded` prop (~30 min)
4. **30-2D** AI insights 2 variants additionnels (~45 min)

### M3 "Mobile + Icons completion" — ~270 min
1. **30-3A** useEdgeSwipe + QuickAddFab enrichi (~75 min)
2. **30-3B** Icon migration core 18 fichiers (~65 min)
3. **30-3C** Wirage PtR 4 listes + PullToRefreshIndicator primitive (~50 min)
4. **30-3D** Icon migration extended ~14 fichiers + reduce-motion audit ⚠️ LAST (~80 min)

**Wall-clock parallèle = max(180, 180, 270) ≈ 270 min ≈ 4.5h**

---

## 6. Séquencement critique

```
T0      M1-1A (Reports + Cell)   |  M2-2A (slash-vars)     |  M3-3A (EdgeSwipe + FAB)
T+1h    M1-1B (CmdP fuzzy)       |  M2-2B (ApiWh wizard)   |  M3-3B (Icons core 18)
T+2h    M1-1C (Reports filters)  |  M2-2C (Wizard embedded)|  M3-3C (PtR wire 4)
T+3h    M1-1D (Settings search)  |  M2-2D (AI 2 variants)  |  M3-3D (Icons rest + audit ⚠️ LAST)
T+4.5h  ✅ DONE
```

⚠️ **M3-3D must be LAST** (touche fichiers déjà modifiés par M1-1A, M1-1C, M2-2D).

---

## 7. Risques + mitigations

| Risque | Mitigation |
|---|---|
| Reports.tsx conflit M1-1A/M1-1C/M3-3D | Séquence interne M1 : 1A → 1C ; M3-3D last |
| AppLayout.tsx M3-3A vs M3-3B | Séquence interne M3 : 3A (wire) → 3B (icons) |
| Wizard.tsx prop régression Sprint 26 | Default `embedded={false}` préserve TeamSettings/BrandingSettings — test obligatoire |
| Dashboard.tsx M2-2D vs M3-3D | M2 finit 2D avant M3 commence 3D icons |
| Pages 4 listes PtR déjà wirées (Antigravity) | M3-3C audit avant write — wire seulement si manquant |
| index.css append-only 3 Managers | Headers explicites `/* ── Sprint 30 vague 30-X — Name ── */` |

---

## 8. Nouvelles primitives proposées (3)

| # | Primitive | Path | Vague | Pourquoi |
|---|---|---|---|---|
| 1 | **CellHoverInfo** | `ui/CellHoverInfo.tsx` | 30-1A | Tooltip insuffisant pour cells riches (delay 280ms + glass + sparkline mini) |
| 2 | **ScopePicker** | `ui/ScopePicker.tsx` | 30-2B | Multi-select chips grid catégorisée scopes/events. FilterChip pas adapté |
| 3 | **PullToRefreshIndicator** | `ui/PullToRefreshIndicator.tsx` | 30-3C | Factorise visual spinner pull gesture (probablement inline dans hook actuellement) |

**Nouveaux fichiers totaux** : 3 primitives + 1 hook (`useEdgeSwipe`) + 2 utilities (`fuzzy.ts`, `snippetVars.ts`) = **6 nouveaux fichiers**

---

## 9. Instructions reprise post-reset

Quand tu reprends la session :

1. **Read** `AGENTS.md` + `HANDOFF-PROMPT.md` + ce fichier
2. **Demande validation user** : "Plan Sprint 30 full 12 sub-tâches prêt. Go en parallèle ?"
3. **GO confirmé** : lance les 3 Managers en parallèle dans un **seul message multi-tool-calls** :
   - M1 : 30-1A/1B/1C/1D
   - M2 : 30-2A/2B/2C/2D
   - M3 : 30-3A/3B/3C/3D (avec ordre interne respecté)
4. **Notifications fil de l'eau** : highlights ~200 mots par Manager complété
5. **Update final** :
   - Crée mémoire `sprint30_status.md` (livraisons détaillées)
   - Edit `MEMORY.md` index (+1 entrée Sprint 30)
   - Edit `ROADMAP.md` (Sprint 30 + ~1j → Total 233j)
   - Edit `AGENTS.md` section 6 si primitives ajoutées (CellHoverInfo, ScopePicker, PullToRefreshIndicator) — total 35 → 38

---

**Plan préparé** : 2026-05-14 — mode FULL 12 sub-tâches (vs 6 slim)
**Statut** : ⏳ En attente exécution
**Estimation** : ~4.5h wall-clock parallèle (vs ~10.5h séquentiel = gain 2.3×)
**Sprint cible** : 30 (Total prévisible 233j post-Sprint 30, ~83 vagues design cumulées)
