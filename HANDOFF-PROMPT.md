# 🎯 HANDOFF PROMPT — Intralys Dashboard Design (Sprint 41 done, Sprint 42 ready)

Tu es l'**agent main coordinator** sur le projet `intralys-dashboard` (CRM PMEs francophones — courtiers, dentistes, plombiers, coachs, agences). Tu reprends après **Sprint 41** (Inbox + Calendar refonte Stripe + Polish). Prochain step : **Sprint 42**.

⚠️ **VMware shutdown contexte** : le user éteint son PC et redémarre demain. La conversation actuelle n'existera plus. **Ce HANDOFF + les fichiers memory sont la SEULE source de continuité.** Lis-les en premier.

---

## 📍 Working dir
`z:\C\Users\rochdi\.gemini\antigravity\scratch\intralys-dashboard`

⚠️ **Heads-up critique** :
- Repo sur **VMware Shared Folder** → `git` refuse (`fatal: detected dubious ownership`). N'utilise PAS `git` direct. Travaille via Read/Edit/Write/Glob/Grep.
- **bun/npx absents du sandbox PATH** → typecheck/build/test pas exécutables. Validation user.

---

## 🛠️ Stack figée
- **Frontend** : React 19 + Vite + Tailwind v4 + TanStack Router
- **Backend** : TypeScript + Cloudflare Workers + D1 + R2 + Durable Objects
- **AI** : Claude Haiku 4.5
- **Mobile** : PWA + Capacitor V1

---

## 👤 User profile

- **Email** : intralys@gmail.com
- **Langue** : **français québécois informel** (tu/ouais/expressions naturelles)
- **Autonomie** : enchaîner sans demander feu vert. Choisis et continue.
- **Style design** : ⚠️ **SUBTLE Stripe Dashboard paradigm** depuis Sprint 38 RESET. Pas de DRAMATIC. Pas d'orbs/gradient brand massif/glow.
- **Theme** : light baseline. Pas de dark mode (sidebar peut avoir variant `.sidebar-dark` opt-in)

---

## 🚨 SPRINT 38 RESET — PARADIGM ACTUEL (2026-05-15)

User a explicitement dit Sprint 37 : **"tu fait pas vraiment du vraie travail de logiciel et app moderne"** + **"c'est le problème de Claude au lieu de modifier une chose il empile code sur code"**.

→ **Décision validée** : RESET COMPLET design system Sprint 23-37. Référence **Stripe Dashboard**.

### Paradigm Stripe (Sprint 38+39+40+41)

- **Subtle, monochromatique** — `--gray-50..900` Stripe palette
- **Primary `#635BFF`** (purple) pour CTAs + accents + active states
- **Brand Intralys cyan/orange** : signature UNIQUEMENT (logo, favicon, print, accent border-top KPI Revenu signature, 2-3 CTAs commerciaux)
- **Shadows** Stripe noir subtle 5-10% (fini cyan-tinted)
- **Pas d'orbs, pas de gradients brand sur surfaces, pas de glow**

### Caduques (NE PAS réintroduire)

- ~~"DRAMATIQUE 12-30% jamais 5-8%"~~ → Sprint 23-37 abandonné
- ~~`--shadow-brand-*` cyan-tinted~~
- ~~Orbs décoratifs partout~~
- ~~Nav items chip premium + bordure gradient~~ → Stripe-sober
- ~~Memory `feedback_design_dramatique`~~ → CADUQUE

---

## 🏗️ État codebase (post Sprint 41)

### Métriques
- **~239.7 jours dev cumulés** sur 41 sprints
- `src/index.css` : ~5100L (vs 8265L pré-Sprint 38 RESET, vs 3280L post-Sprint 40)
- **15 primitives core** Stripe-clean (Sprint 38 Phase 2) + 29 secondaires préservées (+ **MessageBubble Sprint 41**)
- **9 hooks** personnalisés (+ **useShortcuts Sprint 41**)
- **14 utilities lib**

### 9 pages cœur Stripe-clean

Dashboard · Leads · LeadDetail · Pipeline · Tasks · Sidebar · AppLayout (Sprint 38)
**+ Inbox · Calendar (Sprint 41)**

### Primitives core Stripe-clean (`src/components/ui/`)

**Forms** : Button, Input, Textarea, Select, Tag (`statusIcon?` Sprint 40)
**Overlays** : Modal, DropdownMenu, Tooltip, Avatar, Badge
**Layout** : Card, KpiStrip, EmptyState, Skeleton, Toast
**Inbox** : **MessageBubble** (Sprint 41 nouvelle primitive autonome `direction: 'in'|'out'` + reactions + status icon, namespacée `.msg-bubble-ui-*` pour ne PAS confondre avec `components/Inbox/MessageBubble.tsx` legacy)

### Hooks

`useAutosave<T>` · `useSound` (7 sons) · `useHaptic` (5 patterns) · `useLongPress` · `useEdgeSwipe` · `usePullToRefresh` · `useNetworkStatus` · `useConversationWs` · **`useShortcuts`** (Sprint 41 window-level + ref pattern + skip-inputs + cross-platform Cmd/Ctrl)

### Utilities

`fuzzy.ts` · `snippetVars.ts` · `aiSort.ts` · `aiDrafts.ts` · `leadScoreExplain.ts` · `reactions.ts` · `quickReplies.ts` · `pdfExport.ts` · `announce.tsx` · `i18n.ts` · `webVitals.ts` · `sensorial.ts` · `confetti.ts`

### Features fonctionnelles 100% préservées

- Drag&drop dnd-kit Pipeline + Calendar drag-resize
- URL params filters useRouterState TanStack (Leads/Pipeline/Tasks/Reports)
- AI features : 5 insights + 3 sorts + 3 drafts + 6 score signals + 12 fuzzy search fields
- Bulk select Linear+Gmail patterns (Sprint 24)
- View modes : table/cards/map (Leads), kanban/list/forecast (Pipeline), list/kanban/table (Tasks)
- View transitions named `avatar-{id}` (Sprint 35)
- Mobile gestures (SwipeAction + LongPress + BottomSheet + PullToRefresh + EdgeSwipe + FAB fan-out)
- Sensorial 7 sons procéduraux Web Audio + 5 haptic patterns (Sprint 25)
- A11y focus-visible global + 16 WCAG fixes + LiveRegion SR announcements
- Capacitor lifecycle + i18n maison fr-CA/en + Web Vitals + E2E Playwright 5 flows + ShareButton + PDF exports 3 templates
- 3 Wizards Settings (Team/Branding/ApiWebhooks)
- Coachmark + InteractiveTour onboarding
- AutosaveIndicator + useAutosave debounced
- Reactions + QuickReplies Promise-pattern localStorage
- Tables premium 10 pages frozen + expand row + score tooltips
- Network status banner + Toast queue management (5 max + overflow)
- **Keyboard shortcuts Inbox/Calendar Sprint 41** (j/k nav · r/e archive · t today · n new · w/d/m view · ←/→ period · Esc cascade · Cmd+Enter send)

---

## 📊 Récap Sprints 38-41 (Stripe paradigm)

| Sprint | Focus | Wall-clock | Output |
|--------|-------|-----------|--------|
| **38 RESET** | Wipe 8265L CSS → 2497L + 15 primitives core + 7 pages refondues | ~27 min | TURNAROUND complet, ~140 décoratifs WIPED, 100% logic preserved |
| **39** Personality bump | Typography hierarchy + KPI icon chips + delta + accent borders + section headers + cards hover -2px + sidebar logo wordmark purple + badges | ~7 min | ~400L CSS append |
| **40** Details Stripe-grade | Sparkline 44px + dot terminal + hover reveal + Tag statusIcon + ComposedChart + peak labels + MiniSparkline inline + ActivityTypeDot + Sidebar live-dot + "Mis à jour il y a X min" + row hover quick-actions | ~9 min | ~500L CSS + 7 fichiers TSX |
| **41** Pages secondaires Stripe | M1 Inbox refonte (MessageBubble primitive + ConversationsList Stripe-clean + slash-vars hint + empty states FR québécois) + M2 Calendar refonte complète (views + drag-resize habillé + today live-line + mini-cal + SlidePanel détail + agenda) + M3 Polish (useShortcuts hook + j/k/r/e/t/n/w/d/m shortcuts + skeletons + toasts non-invasifs + a11y systémique + reduced-motion) | ~30 min | ~1820L CSS + 2 primitives + 1 hook + 8 fichiers TSX/TS |

---

## 🎯 Pattern d'orchestration validé

### Standard FULL (18 entités)
```
User + Coordinator + Chaman Plan agent + 3 Managers × 4 tâches = 12 atomic
```

### Slim (16 entités, économie tokens)
```
User + Coordinator + 3 Managers × 2 tâches = 6 atomic (skip Chaman)
```

### Phase A/B (validé Sprint 41)
```
Phase A : M1 + M2 parallèle (~10 min) — fichiers indépendants
Phase B : M3 séquentiel après M1+M2 done (~10 min) — refactor/wire code produit par M1+M2
```
**Quand** : M3 dépend des fichiers édités par M1+M2 (ex : Sprint 41 où M3 wire shortcuts/toasts dans Inbox.tsx + Calendar.tsx).
**Évite** : races sur `src/index.css` 3 appends parallèles.

### Note critique
Managers `general-purpose` n'ont PAS accès au tool `Agent` → implémentent eux-mêmes séquentiellement.

---

## 🚀 Reprise immédiate

**Sprint 41 DONE** (2026-05-15). **Plan demain = Sprint 42** (Settings + 7 pages secondaires + PipelineSettings Wizard).

Si l'user dit :
- **"go"** / **"vasy"** / **"on continue"** / **"lance sprint 42"** → démarrer Sprint 42 M1.1 direct (3 Managers FULL 18, **Phase parallèle pure recommandée**, voir `sprint42_brief.md`) sans redemander
- **"SLIM"** / **"ralentis"** / **"trop ambitieux"** → fallback SLIM 6 (M × 2 atomic au lieu de M × 4)
- **"saute 42"** / **"on fait 43 direct"** → respecter, démarrer Sprint 43 (Production quality)
- **"reset"** → NE PAS recommencer (Sprint 38 RESET déjà fait)
- **"pause"** / **"j'attends"** / **"montre-moi"** → ne rien lancer, attendre instructions

**Avant action OBLIGATOIRE** :
1. Read `ROADMAP.md` dernière entrée pour contexte état codebase
2. Read mémoire `MEMORY.md` index pour pointers
3. Read mémoire `sprint41_status.md` (état post-Sprint 41 détaillé)
4. Read mémoire `sprint42_brief.md` (plan + pièges anticipés + lessons learned Sprint 41)
5. Read mémoire `sprint41_50_giga_plan.md` (specs détaillées Sprint 42 + suite)

### ⚡ Sprint 42 — démarrage rapide (specs résumées)

**3 Managers parallèles dans 1 message** (Phase parallèle pure car fichiers indépendants) :

- **M1 — Settings 11 components Stripe** (`src/components/settings/*.tsx` SAUF PipelineSettings.tsx) : Profile/Team/System/Notifications/Security/Billing/Roles/Snippets/AuditLog/ApiWebhooks/Branding + 2 dedicated `src/pages/settings/{Compliance,CustomFields}Settings.tsx` → audit Stripe-clean + form-row pattern + section-header accent + AutosaveIndicator. CSS header `/* ── Sprint 42 M1 — Settings ALL Stripe (2026-05-15) ── */`

- **M2 — 7 pages secondaires audit** (`src/pages/{Templates,Workflows,Reviews,Trash,Properties,Invoices,Documents}.tsx`) : tables premium Sprint 31-32 déjà refondues, juste fix opacités héritées >10% si trouvées + shadows brand-tinted. **PRÉSERVER** Loi 25/CASL (Compliance) + TPS/TVQ QC (Invoices breakdown) + Mapbox popup (Properties). CSS header `/* ── Sprint 42 M2 — Pages secondaires Stripe audit (2026-05-15) ── */`

- **M3 — PipelineSettings Wizard + dedup** (`src/components/settings/PipelineSettings.tsx` EXCLUSIF, pas touché par M1) : migration 3 tabs inline Sprint 27 Antigravity → `<Wizard embedded>` Sprint 30 ready (3 steps : Stages drag-reorder + Automations + Custom fields) + CSS dedup audit Settings (cible -200L) + EmptyState cohérence cross-pages + Toast/Autosave wirage uniforme. CSS header `/* ── Sprint 42 M3 — PipelineSettings Wizard + dedup (2026-05-15) ── */`

**Wall-clock estimé** : ~15-18 min parallèle pure.

### 🎯 PLAN TRILOGIE Sprint 41-42-43 VALIDÉ 2026-05-15

User a dit **"on fait trilogie"** → exécuter dans cet ordre strict (41 → 42 → 43), FULL 18 entités/sprint, validation user entre chaque.

**Détails complets** : voir mémoire `sprint41_43_trilogy_plan.md`

#### Sprint 41 — Pages secondaires majeures (FIRST)
- **M1 Inbox** : MessageBubble Stripe + Composer slash-vars wirage réel + Reactions/QuickReplies wirage + Conversation list rail + Empty state
- **M2 Calendar** : Views week/day/month Stripe + Drag-resize wirage visuel Stripe + Today live-line + Mini-cal sidebar + Event detail panel
- **M3 Polish** : Shortcuts (J/K/R/E/N/T) + Skeleton states + Toast feedback + A11y reduced-motion audit

#### Sprint 42 — Settings + 7 pages uniformisation
- **M1 Settings ALL** : Notifications/Profile/Security/Branding/Team/ApiWebhooks/Integrations/Billing Stripe pattern
- **M2 Pages secondaires audit** : Templates/Workflows/Reviews/Trash/Properties/Invoices/Documents Stripe-clean
- **M3 PipelineSettings Wizard migration** : 3 tabs inline → `<Wizard embedded>` Sprint 30 ready + CSS dedup + EmptyState cohérence

#### Sprint 43 — Production quality
- **M1 Performance** : Lighthouse audit + bundle splitting raffinement + image/font optims + Web Vitals monitoring
- **M2 Code quality** : `--brand-primary` → `--primary` migration ~50 fichiers + TS strict mode + dead code + ESLint pass
- **M3 AI backend wiring** : Reactions/QuickReplies/Drafts/Scoring → endpoints Workers + D1 + Claude Haiku 4.5

### 🚀 GIGA PLAN extension 44-50 validé 2026-05-15

User a dit **"giga plan hesite pas"** → trilogie étendue en **10 sprints release-candidate beta**. Détails complets : `sprint41_50_giga_plan.md`.

#### Sprint 44 — Mobile + PWA polish iOS/Android
- M1 Capacitor : Splash + Status bar + Push notifications + Deep links
- M2 PWA install + offline : Install prompt + IndexedDB cache + queue offline + update prompt
- M3 Mobile gestures deepen : Swipe-to-reply + Long-press menu + PtR audit + Edge swipe back

#### Sprint 45 — Onboarding + Empty states deepen
- M1 First-time setup : Wizard 4 steps + Demo data + First lead guided + Progress chip
- M2 Empty states illustrations : 6 SVG Stripe-style + 12 contextuels + first-time vs filtered + animations
- M3 Tour + Coachmarks : audit + 5 contextual + dismiss settings + CmdPalette discovery

#### Sprint 46 — Reports builder + Admin analytics
- M1 Reports builder : Drag-drop widget grid + config panel + save/load + PDF export
- M2 Admin analytics : route guard + Org KPI + activity heatmap + feature usage
- M3 Notifications center : primitive + panel + preferences + real-time WS

#### Sprint 47 — Marketing + landing pages
- M1 Landing : Hero + Features grid 6 + Testimonials + Footer
- M2 Pricing + legal : 3 plans + ToS/Privacy/Loi25/CASL + Contact + SEO meta
- M3 Blog/docs : list page + article MDX + Help center + cross-link

#### Sprint 48 — A11y AAA + i18n 4 langues
- M1 WCAG AAA : Contrast 7:1 + Keyboard exhaustive + ARIA + SR scripts
- M2 i18n multi-lang : EN + FR-FR + ES + switcher Settings
- M3 Intl deepen : Pluralization + Date + Number + Timezone

#### Sprint 49 — AI features avancées
- M1 Smart compose : Inline suggestions + Tone analyzer + Spelling FR-QC + Multi-lang detect
- M2 Predictive scoring : 30d predict + Bottleneck + Anomaly + Insights 5→8 variants
- M3 Auto-tagging : Conversations + Leads + Smart sort 3→6 + AI command palette NL

#### Sprint 50 — Release candidate + beta invite
- M1 Polish final : Cross-browser + Visual regression + Bundle budget + Microcopy
- M2 Docs + changelog : 30 user articles + 10 admin + Dev API + Changelog public
- M3 Beta invite flow : Beta signup public + Magic link auth + Beta onboarding + Feedback widget

### Backlog Sprint 51+ (post-release-candidate)

- v1.1 features votés roadmap public
- Marketplace integrations partenaires
- Enterprise tier (SSO/SCIM/audit logs)
- Multi-tenant architecture si besoin

---

## 📁 Fichiers de référence indispensables

- `ROADMAP.md` — historique 41 sprints + total ~239.7j dev
- `AGENTS.md` — rules permanentes + design system actuel Stripe (à jour Sprint 41)
- `STRATEGY.md` — vision business
- `README-DEV.md` — setup local sans clés externes
- `docs/DOCS-PRIMITIVES.md` — catalog 50 primitives (Sprint 35, à mettre à jour Sprint 41 MessageBubble)
- `docs/archive/` — anciens plans Sprint archivés
- `src/components/ui/index.ts` — barrel primitives
- `src/index.css` — design system Stripe complet ~5100L
- `src/lib/api.ts` — types backend
- **Memory entries** (`C:\Users\rochdi atlas\.claude\projects\z--C-Users-rochdi--gemini-antigravity-scratch-intralys-dashboard\memory\`) :
  - `MEMORY.md` — index (load AUTO en context)
  - `sprint38_status.md` — TURNAROUND détaillé
  - `sprint39_40_stripe_polish.md` — Personality + Details bumps
  - `sprint41_status.md` — **NOUVEAU** Inbox + Calendar refonte + Polish
  - `sprint41_43_trilogy_plan.md` — plan trilogie validé (Sprint 41 marqué DONE)
  - `sprint41_50_giga_plan.md` — GIGA plan 10 sprints
  - `sprint42_brief.md` — **NOUVEAU** plan détaillé Sprint 42 + lessons learned Sprint 41 + pièges à anticiper
  - `orchestration_chaman_managers.md` — pattern validé + Phase A/B documenté
  - `intralys_business_context.md` — vision business
  - `vmware_safe_directory.md` — workaround git
  - `user_language.md` / `feedback_autonomy.md` / `feedback_theme_baseline.md` (Stripe paradigm preserved)

---

## 💡 Conseils opérationnels

1. **DELETE > ADD** (leçon Sprint 38) : modifier > empiler
2. **Préserver features** : refonte visuelle uniquement, jamais state/hooks/handlers
3. **API additifs only** : props optional avec défaut back-compat
4. **Append-only CSS** avec headers Sprint datés
5. **Stripe-PLUS si user demande "plus de personnalité"** — JAMAIS retour DRAMATIC
6. **prefers-reduced-motion** respect obligatoire
7. **Communication user** : terse + français québécois informel

---

**État précis pour reprise** :
- Sprint 41 vient de finir (2026-05-15) — Inbox + Calendar refonte Stripe + Polish
- 41 sprints cumulés, ~239.7j dev
- 5100L CSS Stripe paradigm (3280 + 1820 Sprint 41)
- 9 pages cœur Stripe-clean (Dashboard/Leads/LeadDetail/Pipeline/Tasks/Sidebar/AppLayout/Inbox/Calendar)
- 50 primitives + 8 hooks + 14 utilities lib
- AGENTS.md + ROADMAP.md + MEMORY.md + sprint41_status.md à jour
- Code-complete, en attente validation locale user
- Prochain step prévu : **Sprint 42** (Settings + 7 pages secondaires + PipelineSettings Wizard)

Lance la suite quand l'user te dit go. Bonne continuation ! 🚀
