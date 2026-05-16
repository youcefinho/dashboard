# AGENTS.md — Intralys Dashboard

> Rules permanentes pour tout agent AI (Claude / Gemini / Antigravity / Cursor / etc.) qui touche au code de ce projet.
>
> **Pour reprendre une session interrompue** : lis [`HANDOFF-PROMPT.md`](./HANDOFF-PROMPT.md).
> **Pour l'état des sprints** : lis [`ROADMAP.md`](./ROADMAP.md).

---

## ⚠️ SPRINT 38 RESET (2026-05-15) — VALABLE

Le projet a été **RESET visuellement** en Sprint 38. Référence : **Stripe Dashboard**. Sprints 39+40 ont ajouté du **Personality bump Stripe-PLUS** (typography hierarchy + KPI icon chips + accents subtils + micro-interactions) **sans retomber dans DRAMATIC**.

**Paradigm actuel** (Sprint 38-40 — règle absolue) :
- **Subtle, monochromatique** — `--gray-50..900` Stripe palette
- **Primary `#635BFF`** (purple Stripe) pour CTAs + accent + active states
- **Brand Intralys cyan/orange** : signature UNIQUEMENT (logo Intralys sidebar, favicon, print PDF headers, accent border-top KPI Revenu signature, 2-3 CTAs commerciaux) via `--brand-cyan`, `--brand-orange`, `--brand-gradient`, `.text-gradient-brand`
- **Shadows** : `--shadow-xs/sm/md/overlay` Stripe noir 5-10% (fini cyan-tinted)
- **Borders** : `--border` 1px gray subtle `rgba(50,50,93,0.10)` Stripe signature
- **Surfaces** : `--bg-canvas` (#F6F9FC) page / `--bg-surface` (white) cards
- **Pas d'orbs, pas de gradients brand sur surfaces, pas de glow brand**
- **Animations** : 4 keyframes essentielles (fadeIn, slideUp, slideDown, shimmer) + utilitaires (pulse-dot, ptr-rotate, input-shake, input-success-check)

**Paradigmes obsolètes (CADUQUES — ne pas réintroduire)** :
- ~~"DRAMATIQUE pas subtil, opacités 12-30% jamais 5-8%"~~ → Sprint 23-37 paradigm abandonné
- ~~`--shadow-brand-*` cyan-tinted~~
- ~~Orbs décoratifs partout, gradient brand sur surfaces, glow halo~~
- ~~Nav items chip + bordure gradient + chip-btn premium~~ → Stripe-sober (bg-soft active + border-left 3px primary)
- ~~Memory `feedback_design_dramatique`~~ → CADUQUE

**Compat aliases (legacy → migration progressive)** :
- `--brand-primary/--brand-hover/--brand-soft/--brand-tint` → mappent sur `--primary` Stripe purple
- `--surface-0..3` → tous mappent `--bg-canvas/--bg-surface`
- `--shadow-brand-xs..2xl` → mappent `--shadow-xs/sm/md/overlay`
- Classes `.card-premium*`, `.sidebar-nav-item`, `.dashboard-*` préservées (noms intacts) avec visuel Stripe-sober

---

## 1. Projet

**Intralys Dashboard** — CRM tout-en-un universel pour PMEs francophones (courtiers, dentistes, plombiers, coachs, agences). Différenciateurs : compliance Loi 25/CASL native, AI FR québécois, packs industrie 1-clic, prix abordable vs GHL/HubSpot.

## 2. Stack figée

- **Frontend** : React 19 + Vite + Tailwind v4 + TanStack Router
- **Backend** : TypeScript + Cloudflare Workers + D1 (SQLite edge)
- **Storage** : Cloudflare R2 · **Realtime** : Durable Objects · **AI** : Claude Haiku 4.5
- **Email** : Resend (mocks dev) · **SMS** : Twilio (mocks dev)
- **Mobile** : PWA + Capacitor V1
- **Hosting** : Cloudflare Pages

## 3. Heads-up critique

⚠️ Le repo est sur un **VMware Shared Folder** → `git` refuse par défaut (`fatal: detected dubious ownership`). N'utilise **PAS** de commandes git directes. Travaille via les tools file (Read/Edit/Write/Glob/Grep). Le user gère commit/push sur sa machine.

⚠️ **bun/npx absents du sandbox PATH** : typecheck/build/test pas exécutables. Validation côté user.

## 4. User profile + préférences

- **Email** : intralys@gmail.com
- **Langue** : **français québécois informel** (jamais "vous", "tu" exclusif, expressions naturelles)
- **Autonomie** : enchaîner les phases sans demander feu vert intermédiaire. Si doute mineur → choisis et continue, l'user redirige si besoin
- **Style design** : **SUBTLE Stripe Dashboard paradigm** (Sprint 38 RESET). Pas de DRAMATIC. Personality via typography hierarchy + accent micro-borders + hover micro-interactions
- **Theme** : light baseline (`--bg-canvas` #F6F9FC). PAS de dark mode (sauf sidebar variant `.sidebar-dark` opt-in fourni Sprint 39)
- **Nav items** : Stripe-sober (`bg-soft active` + `border-left 3px primary` signature, pas chip premium)

## 5. Brand colors

**Primary (Stripe)** :
- Purple : `--primary: #635BFF` (CTAs, accents, active states)
- Hover : `--primary-hover: #5851E5`
- Soft : `--primary-soft: #F0EFFE` (backgrounds tinted)
- Ring : `--primary-ring: rgba(99, 91, 255, 0.20)` (focus)

**Brand Intralys (signature uniquement)** :
- Cyan : `--brand-cyan: #009DDB`
- Orange : `--brand-orange: #D96E27`
- Gradient : `--brand-gradient: linear-gradient(135deg, #009DDB 0%, #D96E27 100%)`
- Usage : Logo Intralys sidebar, favicon, OG image, print PDF headers, accent border-top KPI Revenu (signature), 2-3 CTAs commerciaux maximum

## 6. Design system (Sprint 38-41)

### Tokens fondamentaux (`src/index.css` ~5100L)

- **Palette gris** : `--gray-50..900` Stripe
- **Surfaces** : `--bg-canvas` / `--bg-surface` / `--bg-subtle` / `--bg-hover`
- **Texte** : `--text-primary` (gray-900) / `--text-secondary` (gray-600) / `--text-muted` (gray-500) / `--text-link` (primary)
- **Status** : `--success #1AAB59` / `--warning #C7912C` / `--danger #CD3D64` / `--info` (primary)
- **Status soft** : `--{status}-soft` pour backgrounds tinted
- **Typography scale** : `--text-display 40px` / `--text-h1 28px` / `--text-h2 22px` / `--text-h3 17px` / `--text-body 14px` / `--text-caption 12px` (Sprint 39 bump)
- **Spacing** : `--space-1..16` (4/8/12/16/24/32/48/64)
- **Radii** : `--radius-sm 4px` / `--radius-md 6px` / `--radius-lg 8px` / `--radius-xl 12px` / `--radius-pill`
- **Shadows** : `--shadow-xs/sm/md/overlay` Stripe noir subtle
- **Border** : `--border rgba(50,50,93,0.10)` / `--border-strong rgba(50,50,93,0.20)`

### Typography utilities (Sprint 39 bumps)

`.t-display` (40px/700) · `.t-h1` (28px/700) · `.t-h2` (22px/700) · `.t-h3` (17px/600) · `.t-body` (14px/400) · `.t-body-strong` (14px/600) · `.t-caption` (12px/600 secondary) · `.t-meta` (11px/700 uppercase tracking 0.08em) · `.t-mono-num` (tabular-nums) · `.t-label-form`

### Classes signature

**Layout** : `.section-header` accent border-left 3px primary (Sprint 39)
**Cards** : `.card-premium` Stripe sober, `.card-interactive-bump` hover -2px + shadow-md (Sprint 39 39-3A)
**Tables** : `.table-premium-container`, `.table-premium`, `.row-premium`, `.col-frozen`, `.table-expand-trigger/content` (Sprint 27 simplified)
**Sidebar** : `.sidebar-nav-item`, `.sidebar-nav-item-badge-wrap`, `.sidebar-nav-item-badge`, `.sidebar-nav-item-live-dot` (Sprint 39+40)
**Dashboard** : `.dashboard-kpi-card`, `.dashboard-kpi-icon-chip`, `.dashboard-kpi-value`, `.dashboard-kpi-sparkline-dot-terminal`, `.dashboard-kpi-secondary`, `.dashboard-hero-updated-at`, `.dashboard-chart-card/header/title/subtitle`, `.dashboard-donut-legend-*`, `.dashboard-source-row/bar/bar-fill`, `.dashboard-mini-spark`, `.dashboard-activity-row/type-dot/time/cta-arrow`, `.dashboard-contact-row/-actions/-action`, `.dashboard-top-contact-item/-name/-count`, `.dashboard-add-contact-card/-chip/-icon/-label` (Sprint 38+39+40)
**Forms** : `.input-shake`, `.input-success-check` (Sprint 26)
**Cmd palette** : `.cmd-overlay/palette/input/item/kbd` (simplified Stripe Sprint 38)
**Tag status icon** : `.tag-status-icon` (Sprint 40)
**Inbox** : `.msg-bubble-ui-*` (primitive autonome Sprint 41 namespacée pour éviter collision avec `components/Inbox/MessageBubble.tsx` legacy)
**Calendar** : `.cal-nav-btn`, `.cal-empty-overlay`, `.cal-mini-day`, event chips border-left 3px via `--event-color` (Sprint 41)

### Primitives UI (`src/components/ui/`)

**Core 15 refondues Stripe-clean Sprint 38 Phase 2** :
- Forms : Button (variants primary/secondary/ghost/danger/link + premium→primary alias), Input (slots + label/helper/error/success), Textarea, Select, Tag (`statusIcon?` Sprint 40 + dot/pulse/solid)
- Overlays : Modal (backdrop noir 40%), DropdownMenu (Radix Stripe), Tooltip (gray-900 + shadow-md), Avatar (border subtle, `ring="active|hot"` border-color), Badge (soft bg)
- Layout : Card (variant interactive hover -1px shadow-xs→sm), KpiStrip, EmptyState, Skeleton (gray shimmer), Toast (queue 5 + variants sober)

**Secondary primitives préservées** : Tabs, SlidePanel, PanelStack, BulkActionBar, FilterChip, AppliedFiltersBar, Combobox, Switch, ColorSwatch, DateRangePicker, ConfirmDialog, Wizard (3 wizards Team/Branding/ApiWh), Icon (wrapper Lucide stroke 1.75), ScoreGauge, Sparkline (`strokeWidth?` + `terminalDotStripe?` Sprint 40), AnimatedNumber, ViewTransition, AiSparkles, AiLoadingShimmer, AppBootScreen, AutosaveIndicator, Coachmark, BottomSheet, SwipeAction, ShareButton, EmptyStateIllustration, LiveRegion, NetworkStatusBanner, PageHero, PhoneLink, PullToRefreshIndicator, ScopePicker, SmartBanner, **MessageBubble** (Sprint 41 nouvelle primitive autonome `direction: 'in'|'out'` + reactions + status icon Check/CheckCheck/Eye, namespacée `.msg-bubble-ui-*` pour ne PAS confondre avec `components/Inbox/MessageBubble.tsx` legacy)

### 9 hooks personnalisés

`useAutosave<T>` · `useSound` (7 sons procéduraux) · `useHaptic` (5 patterns) · `useLongPress` · `useEdgeSwipe` · `usePullToRefresh` · `useNetworkStatus` · `useConversationWs` · **`useShortcuts`** (Sprint 41, window-level keyboard bindings + ref pattern + skip-inputs option + cross-platform Cmd/Ctrl alias + e.repeat anti-spam)

### 14 utilities lib

`fuzzy.ts` (Levenshtein word-boundary) · `snippetVars.ts` (8 vars) · `aiSort.ts` (3 heuristiques) · `aiDrafts.ts` (3 tones) · `leadScoreExplain.ts` (6 signals) · `reactions.ts` (Promise pattern) · `quickReplies.ts` (FIFO 3 per-lead) · `pdfExport.ts` · `announce.tsx` (SR singleton) · `i18n.ts` (fr-CA + en) · `webVitals.ts` (PerformanceObserver) · `sensorial.ts` (Web Audio + Vibration singleton) · `confetti.ts` · `aiDrafts.ts`

### Features fonctionnelles préservées Sprint 23-41

Drag&drop dnd-kit Pipeline + Calendar drag-resize · URL params filters Sprint 31 useRouterState TanStack · AI features (5 insights + 3 sorts + 3 drafts + 6 score signals + 12 fuzzy search fields) · Bulk select Linear+Gmail patterns · View modes table/cards/map + kanban/list/forecast · View transitions named avatar-{id} Sprint 35 · Mobile gestures (SwipeAction + useLongPress + BottomSheet + usePullToRefresh + useEdgeSwipe + QuickAddFab fan-out) · Sensorial 7 sons + 5 haptics · A11y focus-visible + 16 WCAG fixes + LiveRegion SR · Capacitor lifecycle + i18n maison + Web Vitals + E2E Playwright + ShareButton + PDF exports · 3 Wizards (Team/Branding/ApiWebhooks) · Coachmark + InteractiveTour · AutosaveIndicator + useAutosave · Reactions + QuickReplies Promise-pattern · Tables premium 10 pages · Network status banner · Toast queue management · **Keyboard shortcuts Inbox/Calendar Sprint 41** (j/k nav · r/e archive · t today · n new · w/d/m view · ←/→ period · Esc cascade · Cmd+Enter send)

### 9 pages cœur Stripe-clean (Sprint 38 + 41)

Dashboard · Leads · LeadDetail · Pipeline · Tasks · Sidebar · AppLayout (Sprint 38) · **Inbox · Calendar (Sprint 41)**

## 7. Règles d'or pour toute modification

1. **Read AVANT Edit/Write** strict. Si pattern absent → adapte/skip gracefully
2. **DELETE > ADD** : modifier l'existant > empiler du code (leçon Sprint 38 RESET)
3. **Append-only sur fichiers partagés** :
   - `src/index.css` : append en bas avec header `/* ── Sprint {N} vague {X} — [Nom] ── */`
   - `src/components/ui/index.ts` : append avec header `// ── Sprint {N} vague {X} — [Nom] ──`
4. **`prefers-reduced-motion` respect obligatoire** pour TOUTE animation
5. **Subtle Stripe-style** : shadows xs/sm/md, borders gray, primary purple
6. **Pas de gradient brand sur surfaces** (brand Intralys signature seulement)
7. **API publique préservée** : props additifs uniquement, défauts back-compat
8. **Logique métier 100% préservée** : refonte = visuel pur, jamais state/hooks/handlers
9. **A11y** : aria-labels icon-only buttons, focus-visible, SR announcements
10. **TypeScript strict** : pas de `any` non documenté

## 8. Pattern d'orchestration (sprints design)

### Architecture standard (18 entités full)
```
User + Coordinator + Chaman Plan agent + 3 Managers × 4 tâches = 12 atomic
```

### Architecture slim (16 entités, économie tokens)
```
User + Coordinator + 3 Managers × 2 tâches = 6 atomic (skip Chaman)
```

### Architecture turnaround (Sprint 38 RESET)
```
User + Coordinator + Chaman audit profond + 7 agents Phase 1-2-3
```

### Architecture Phase A/B (validée Sprint 41)
```
Phase A : M1 + M2 parallèle (fichiers indépendants, ~10 min)
Phase B : M3 séquentiel après M1+M2 done (~10 min)
→ Évite races sur src/index.css (CSS append-only conflicts)
```
Utiliser quand M3 dépend des fichiers touchés par M1 et M2 (ex : Sprint 41 où M3 Polish wire shortcuts + toasts dans Inbox.tsx + Calendar.tsx édités par M1+M2).

### Note critique sur les Managers

`general-purpose` agents **n'ont PAS accès au tool `Agent`** dans leur sandbox → implémentent eux-mêmes séquentiellement. Pas de nested delegation.

### Note critique sur les races CSS

`src/index.css` est shared. **3 Managers en parallèle qui append en même temps = risque de conflit** sur `Edit` `old_string` (un Manager invalide les anchors du suivant). Mitigation : Phase A parallèle (différents fichiers ou Managers qui appendent à la fin avec Edit + retry intégré) + Phase B séquentielle pour le dernier append.

## 9. Communication user

- Français québécois informel
- Terse, info dense, pas de fluff
- Updates fil de l'eau (~200 mots par Manager terminé)
- End-of-sprint : tableau wall-clock + cumul + mise à jour mémoire/ROADMAP

## 10. Validation locale (user)

```bash
bun install && bun run typecheck && bun run build && bunx playwright test --project=smoke
```

Commit format : `feat(reset/polish): Sprint {N} — {résumé}`

## 11. Sources de vérité

- [`ROADMAP.md`](./ROADMAP.md) — historique sprints + total dev
- [`HANDOFF-PROMPT.md`](./HANDOFF-PROMPT.md) — giga-prompt reprise session
- [`STRATEGY.md`](./STRATEGY.md) — vision business
- [`README-DEV.md`](./README-DEV.md) — setup local
- `src/components/ui/index.ts` — barrel primitives
- `src/index.css` — design system Stripe (Sprint 38 RESET)
- `docs/DOCS-PRIMITIVES.md` — catalog 50 primitives (à mettre à jour pour MessageBubble Sprint 41 si pas déjà fait)

## 12. Reprise immédiate

**Plan GIGA validé 2026-05-15 — trilogie 41-43 étendue 10 sprints 41-50** (`sprint41_50_giga_plan.md` mémoire).

Sprint 41 **DONE** (2026-05-15). Prochain step : **Sprint 42** (Settings + 7 pages secondaires + PipelineSettings Wizard).

Si user dit "**go**" / "**vasy**" / "**on continue**" / "**lance sprint 42**" :
- Démarrer Sprint 42 M1.1 direct, mode **FULL 18 entités** (3 Managers × 4 atomic)
- Pattern Phase A parallèle + Phase B séquentielle si M3 dépend de M1+M2

Si user dit "**SLIM**" / "**ralentis**" → fallback SLIM 6 (M × 2 atomic).
Si user dit "**reset**" → NE PAS recommencer (Sprint 38 RESET déjà fait).
Si user dit "**pause**" / "**j'attends**" → ne rien lancer.

Avant action : check `ROADMAP.md` + mémoire `sprint41_status.md` + `sprint42_brief.md` (lessons learned Sprint 41).

---

**Dernière maj** : 2026-05-15 — après Sprint 41 (41 sprints cumulés, ~239.7j dev). Stripe paradigm depuis Sprint 38. 9 pages cœur Stripe-clean (+ Inbox + Calendar Sprint 41).
