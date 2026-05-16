# Bundle size budget — Sprint 50 M1.3

Date : 2026-05-16
Outil : `scripts/check-bundle-size.mjs` (`npm run check:bundle`)
CI : exit 1 si dépassement, exit 0 si OK, exit 0 + warning si `dist/` absent.

## Mesures réelles (build dist/ courant — gzip niveau 9)

| Asset | Raw | Gzip | Rôle |
|---|---|---|---|
| `index-*.js` (entry) | 463 KB | **~129 KB** | Entry app (eager) |
| `vendor-react-*.js` | 183 KB | **~57 KB** | React+ReactDOM (eager) |
| `vendor-router-*.js` | 85 KB | **~27 KB** | TanStack Router (eager) |
| **= Initial app** | — | **~213 KB** | 1er paint Dashboard |
| `index-*.css` | 238 KB | **~40 KB** | CSS global (Tailwind + index.css) |
| `vendor-recharts-*.js` | 440 KB | ~129 KB | Charts — LAZY (Reports/Dashboard) |
| `vendor-lucide-*.js` | 50 KB | ~17 KB | Icônes — LAZY |
| `Settings-*.js` | 115 KB | ~35 KB | Plus gros page chunk — LAZY |
| `Inbox-*.js` | 66 KB | — | LAZY |
| `LeadDetail-*.js` | 57 KB | — | LAZY |

## Budgets retenus (gzip)

| Budget | Seuil | Mesure actuelle | Marge |
|---|---|---|---|
| **Initial app** (index+react+router) | 230 KB | ~213 KB | ✅ ~7% |
| **Page chunk** (chacun, lazy) | 220 KB | max ~35 KB | ✅ large |
| **Vendor chunk** (chacun, lazy) | 320 KB | max ~129 KB | ✅ large |
| **CSS total** | 80 KB | ~40 KB | ✅ ~50% |

Les budgets page/vendor sont volontairement larges : ils servent de
**garde-fou anti-régression majeure** (ex : un import lourd ajouté par
erreur dans un chunk), pas de cible d'optimisation fine.

## Constat & dette technique notée

L'entry `index-*.js` (~129 KB gz) est le plus gros contributeur au
bundle initial. Le budget 230 KB laisse ~7% de marge — suffisant pour
la beta, mais **fragile**. Recommandation post-beta (hors scope Sprint 50) :

- Code-split `AppLayout` / `Sidebar` du chemin critique d'auth
- Lazy-load les primitives non-critiques au 1er paint (Wizard, Tour,
  CmdPalette déjà séparé via vendor-cmdk)
- Auditer les imports statiques dans l'entry qui pourraient être lazy

Le warning Vite `chunkSizeWarningLimit: 600` (KB raw, déjà en place
Sprint 35) reste inchangé : il alerte au build sur tout chunk > 600 KB
raw — complémentaire au budget gzip de ce script.

## Vendor chunks (Sprint 43 — documentés, NON cassés)

manualChunks (vite.config.ts) inchangés Sprint 50. 13 vendor chunks
isolés et lazy : react, router, recharts, lucide, dnd, radix, xyflow,
cmdk, markdown, dexie, signature, toast, zod. Chaque route ne tire que
les vendors qu'elle importe → split optimal préservé.

## Usage

```bash
npm run build          # génère dist/
npm run check:bundle   # vérifie budgets, exit 1 si dépassement
node scripts/check-bundle-size.mjs --json   # sortie JSON pour CI/dashboard
```

Sans build préalable, le script SKIP proprement (exit 0 + warning) →
ne casse pas une CI où le build n'a pas tourné.
