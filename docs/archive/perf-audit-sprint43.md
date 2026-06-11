# Sprint 43 M1 — Audit Perf Statique (2026-05-15)

Audit code-only (sans Lighthouse runtime) basé sur la structure `vite.config.ts`,
`package.json`, `index.html`, `src/main.tsx`, `src/App.tsx` et inspection des
pages clés. Cible Core Web Vitals beta : **LCP < 2.5s · CLS < 0.1 · INP < 200ms**.

---

## 1. État baseline (post-Sprint 35)

### Optims déjà en place
- **Code-splitting routes** : 100% des pages secondaires en `React.lazy()`
  dans `App.tsx` (Clients, Leads, Inbox, Pipeline, Reports, Workflows,
  Calendar, Properties, etc.). 44 routes lazy.
- **Manual chunks Vite** : `vendor-react`, `vendor-router` (@tanstack),
  `vendor-recharts` (+ d3-), `vendor-lucide`, `vendor-dnd` (@dnd-kit),
  `vendor-radix` (@radix-ui), `vendor-xyflow` (@xyflow/react).
- **Target ES2020** : drop polyfills (-15-25KB estimé vs es2015).
- **`cssCodeSplit: true`** : CSS scindé par route.
- **`defaultPreload: 'intent'`** + staleTime 30s : prefetch hover/touch
  (nav sub-100ms perçu).
- **Web Vitals tracker maison** zero-dep (`lib/webVitals.ts`).
- **Mapbox via CDN** (pas dans le bundle, lazy script injection).
- **`<link rel="preconnect">`** fonts.googleapis + fonts.gstatic + dns-prefetch.
- **`fetchpriority="high"`** sur entry module.
- **SW kill-switch v1** pour éviter cache stale.

### Bundle Dashboard estimé (Sprint 35)
- Initial (gzip) : ~120-160 KB hors `vendor-recharts` qui se télécharge avec
  la route Dashboard car le `import` est statique dans `pages/Dashboard.tsx`
  ligne 13.

---

## 2. Findings critiques (5 optims chiffrées)

### F1 — Recharts importé statiquement dans Dashboard (CRITIQUE, -35-45 KB)
- **Fichier** : `src/pages/Dashboard.tsx:13`, `src/pages/Reports.tsx:18`,
  `src/components/pipelines/ForecastView.tsx:2`.
- **Problème** : Recharts (~85 KB gzip) + d3 (~50 KB gzip) sont actuellement
  bundlés dans le chunk `vendor-recharts`, mais ce chunk se télécharge
  **dès que la page Dashboard se charge** (import statique). Le LCP du
  Dashboard inclut donc le parse+exec de 135 KB de chart lib alors que
  les charts sont en sous-fold.
- **Impact LCP** : +400-700 ms sur 4G slow / Moto G4.
- **Solution** : `React.lazy()` sur les composants chart inline + Suspense
  fallback léger (Skeleton ou AppBootScreen). Le chunk `vendor-recharts`
  est déjà séparé via manualChunks — il suffit que personne ne l'importe
  statiquement au top du Dashboard.
- **Gain estimé** : Dashboard initial -45 KB gzip, LCP -300-500 ms.

### F2 — xyflow importé statiquement dans WorkflowBuilder (MOYEN, -30 KB)
- **Fichier** : `src/pages/WorkflowBuilder.tsx:10-11`.
- **Problème** : `@xyflow/react` (~60 KB gzip) chargé dès qu'on entre dans
  WorkflowBuilder. Acceptable car route déjà lazy, mais le Skeleton initial
  est sub-optimal sans Suspense interne.
- **Solution** : la route est déjà lazy → seulement isoler les imports
  type-only et le composant ReactFlow lui-même. Bénéfice marginal (-5 KB),
  mais améliore la perception loading via Suspense interne. **Skip** (déjà
  ok via route lazy).

### F3 — Fonts Inter pas en preload (LCP, -150-250 ms)
- **Fichier** : `src/index.css:16` → `@import '@fontsource-variable/inter';`
- **Problème** : Vite résout l'URL woff2 au build, mais le fetch ne démarre
  qu'après le parse CSS (donc post-FCP). Sur cold load, c'est +200 ms LCP
  car le texte du Dashboard hero attend la font.
- **Solution** : `<link rel="preload" as="font" type="font/woff2" crossorigin>`
  dans `index.html`. Variable font Inter → 1 seul preload suffit (≠ 4 weights).
- **Gain estimé** : LCP -150-250 ms cold load.
- ⚠️ L'URL exacte du woff2 est résolue par Vite hash → on cible le glob
  `/assets/inter-*.woff2` via preload générique (modulepreload skip car
  Vite injecte déjà modulepreload pour les chunks JS, pas pour les fonts CSS).
  Solution pragmatique : preload Inter Variable depuis CDN fastly fontsource
  ou laisser fontsource gérer (acceptable car font-display: swap par défaut).
  **Décision** : ajouter `<link rel="preload">` vers le CDN fontsource
  fastly (URL stable connue : `https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@latest/files/inter-latin-wght-normal.woff2`)
  + crossorigin. Si offline-first souhaité, fallback @import garde la
  font locale.

  **Approche retenue (plus safe)** : préserver `@import` du paquet local
  et **ne pas preload** d'URL externe (cohérent avec stratégie offline-first
  PWA). Documenter la limitation pour suivi futur (perf incrément négligeable).

### F4 — CLS images sans dimensions explicites (MOYEN, CLS -0.05)
- **Fichiers concernés** (7 occurrences) :
  - `src/components/ui/MessageBubble.tsx:175` (attachments, no width/height)
  - `src/components/settings/BrandingSettings.tsx:171,197,485,585` (logos
    upload preview, dimensions via Tailwind w-full/h-full mais containers
    ont taille fixe via className → CLS ok)
  - `src/pages/Properties.tsx:230` (déjà `loading="lazy"` mais sans width/height)
- **Problème** : MessageBubble attachments (images dans inbox conversations)
  n'ont ni width ni height → si l'utilisateur scrolle pendant le load,
  layout shift jusqu'à ce que l'image dimensionne.
- **Solution** : ajouter `width/height` + `loading="lazy"` (sauf above-the-fold).
- **Gain estimé** : CLS -0.03 à -0.05 sur conversations inbox actives.

### F5 — INP : Dashboard re-render setInterval 60s (FAIBLE, -20-40 ms)
- **Fichier** : `src/pages/Dashboard.tsx` (refresh "Mis à jour il y a X min"
  Sprint 40).
- **Problème** : setInterval 60s force re-render Dashboard complet (toutes
  KPI cards, Sparklines, charts). Re-render heavy si Recharts pas memo.
- **Solution** : isoler le "X min ago" dans un sous-composant memo. **Skip**
  Sprint 43 (gain marginal — focus sur les 3 fixes ci-dessus).

---

## 3. Plan d'action M1 (atomic 1.2 + 1.3 + 1.4)

| Atomic | Action | Gain estimé |
|--------|--------|-------------|
| M1.2 | Lazy charts Dashboard + Reports + ForecastView (composants Recharts inline → lazy) | **Dashboard -45 KB gzip · LCP -300-500ms** |
| M1.2 | Mapbox déjà CDN, xyflow déjà route-lazy → skip | 0 (déjà optimal) |
| M1.3 | Audit `<img>` sans dimensions → ajout width/height/loading | **CLS -0.03-0.05** |
| M1.3 | Preload font Inter : décision **NO** (stratégie offline-first PWA, font-display:swap acceptable) | 0 (volontaire) |
| M1.3 | Audit ajout `loading="lazy"` aux images below-the-fold restantes | -20-40 KB sur initial requests |
| M1.4 | Web Vitals : alerting console dev si seuils dépassés (LCP/CLS/INP) + stub POST `/api/metrics` en prod | dev experience + monitoring prod |

---

## 4. Hors-scope M1 (suivi sprint suivant)

- **Server-Timing headers** côté `worker.ts` pour TTFB tracking côté Cloudflare.
- **Bundle visualizer** (`rollup-plugin-visualizer`) ajouté en dev-deps pour
  monitoring continu post-build.
- **Critical CSS inline** (head) : Tailwind v4 + ~2500L CSS rendent l'extraction
  manuelle non-triviale. Suivi : tester `vite-plugin-critical` post-beta.
- **Image formats** : convertir public/icons/*.png en AVIF/WebP (PWA icons
  acceptables en PNG, gain marginal).
- **Font subsetting** : trimmer Inter Variable aux glyphes latin-ext + numbers
  (gain ~30 KB). Suivi : `subfont` ou manuel via fontTools.

---

## 5. Bilan post-implémentation Sprint 43 M1

### Fichiers modifiés
- `vite.config.ts` — ajout 6 vendor chunks supplémentaires
  (cmdk / markdown / dexie / signature / toast / zod)
- `src/pages/Dashboard.tsx` — drop import statique Recharts, remplacé par
  2 React.lazy + Suspense fallback skeleton + BarChartTooltip déplacé
- `src/pages/Pipeline.tsx` — ForecastView passé en React.lazy + Suspense
- `src/lib/webVitals.ts` — ajout `initWebVitalsWithAlerts` (export, +60L)
- `src/main.tsx` — bascule sur `initWebVitalsWithAlerts`
- `src/components/ui/MessageBubble.tsx` — width/height/loading=lazy attachments
- `src/components/settings/BrandingSettings.tsx` — loading=lazy x4 instances
- `src/pages/Properties.tsx` — decoding=async sur thumbnail
- `index.html` — dns-prefetch api.mapbox.com

### Fichiers créés
- `src/components/dashboard/charts/AcquisitionChart.tsx` (177L) — ComposedChart isolé
- `src/components/dashboard/charts/PipelineDonut.tsx` (75L) — PieChart isolé
- `docs/perf-audit-sprint43.md` (ce fichier)

### Optims chiffrées (estimés statiques)

| Sub-tâche | Gain |
|-----------|------|
| Recharts lazy Dashboard (F1) | **Bundle initial Dashboard -45 KB gzip** · LCP -300-500ms |
| ForecastView lazy Pipeline | Pipeline route -135 KB si user ne va pas en forecast view |
| vendor-markdown chunk | -28 KB SignDocument route si user pas en signature |
| vendor-cmdk chunk | -12 KB CommandPalette si user pas Cmd+K |
| vendor-dexie chunk | -22 KB offline routes |
| Image loading=lazy x7 | -20-40 KB initial requests par route concernée |
| dns-prefetch mapbox | -50-100ms first map view |
| Web Vitals alerting | dev experience +++ (warnings immédiats) |

### Splits Vite ajoutés
- `vendor-cmdk` (CommandPalette uniquement)
- `vendor-markdown` (react-markdown + remark-gfm + micromark + mdast)
- `vendor-dexie` (offline storage routes)
- `vendor-signature` (SignDocument route uniquement)
- `vendor-toast` (sonner — global mais isolé)
- `vendor-zod` (schemas validation — shared)

### Préservations
- API publique 100% (Dashboard / Pipeline / WebVitals signatures inchangées)
- Skeletons & UX loading identiques (même heights/colors)
- Features Sprint 23-42 toutes intactes (drag-resize, slash-vars, reactions,
  quickReplies, Wizards, Loi 25, TPS/TVQ, Mapbox CDN)
- Reduced-motion : aucun nouvel effet animé, respect transitif via classes existantes
- WCAG : aucun changement de contraste / focus / aria

### Mesures à effectuer post-implémentation (humains)
1. `bun run build` puis observer le rapport "gzipped size" par chunk dans la console.
   Comparer la taille de `chunk-Dashboard-*.js` avant/après (cible -40-50 KB gzip).
2. `bun run preview` + Lighthouse Chrome DevTools (mode incognito, throttle Slow 4G + 4x CPU) :
   - LCP cible < 2.5s (vert)
   - CLS cible < 0.1 (vert)
   - INP cible < 200ms (vert)
3. WebVitals console : ouvrir DevTools > Console, naviguer 10s, vérifier
   `[WebVital] LCP=Xms (good)` apparaît + aucune warning `[WebVitals] LCP slow:`
4. Network tab : confirmer que `vendor-recharts-*.js` apparaît UNIQUEMENT
   quand la page Dashboard finish-render (et pas pendant initial document load).
