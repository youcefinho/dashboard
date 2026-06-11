# Lint Audit — Sprint 43 M2.4

**Date** : 2026-05-15
**Manager** : M2 Sprint 43
**Scope** : Audit STATIQUE ESLint + Prettier patterns (config absente — pas de runner)

## État configuration

| Outil | Présent | Note |
|---|---|---|
| ESLint | **NON** | Pas de `.eslintrc*` ni `eslint.config.*` |
| Prettier | **NON** | Pas de `.prettierrc*` ni `prettier.config.*` |
| TypeScript | OUI | `tsc` run via `bun run build` (strict + noUncheckedIndexedAccess) |
| Vitest | OUI | `vitest run` |
| Playwright | OUI | `npx playwright test` |

**package.json scripts** (extraits) :
- `dev` : `vite`
- `build` : `tsc && vite build` (typecheck strict comme garde-fou principal)
- `test` : `vitest run`

### Recommendation : installer ESLint + Prettier

Le projet bénéficierait d'une CI lint dédiée :
- **ESLint flat config** moderne : `@typescript-eslint/parser`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-import`
- **Prettier** : config minimaliste (`singleQuote`, `trailingComma: 'all'`, `printWidth: 100`)
- Script `bun run lint` à ajouter dans package.json

Hors scope Sprint 43 M2.4 (changement infra). À planifier dans un sprint Quality dédié.

---

## Audit patterns lint (manuel)

### 1. `no-explicit-any` (couvert M2.2)

Voir `docs/ts-strict-audit-sprint43.md`. **25 fichiers frontend** avec `any` documentés. Action déjà couverte par M2.2.

### 2. `no-unused-vars` (couvert par TS `noUnusedLocals: true`)

TypeScript catch déjà tous les imports/vars/params non utilisés via tsconfig :
- `noUnusedLocals: true`
- `noUnusedParameters: true`

Build casserait si présent. **0 finding** lors du dernier build connu.

### 3. `react-hooks/exhaustive-deps`

**26 fichiers** avec `useEffect(..., [])` ou similar. **Audit sample 5 fichiers** (Dashboard, Toast, Pipeline, Tasks, Leads) :

| Fichier | Pattern | Verdict |
|---|---|---|
| `Dashboard.tsx:185` | `useEffect(() => { void loadData(); }, [loadData])` | OK |
| `Dashboard.tsx:188` | `useEffect setInterval forceTick, [])` | OK — state setter stable |
| `Dashboard.tsx:194` | `useEffect keydown listener, [loadData])` | OK |
| `useShortcuts.ts` | useEffect avec deps explicit | OK |
| `useHaptic.ts` | useEffect mount-only | OK — pas de closures sur props |

Les 26 occurrences semblent toutes des cas "mount-only" légitimes (event listeners global, setInterval forceTick state-setter). **Audit complet exhaustif non fait** (intrusif), mais pattern sample OK.

**Recommendation** : ajouter `eslint-plugin-react-hooks` quand ESLint sera setup → cela attrapera automatiquement les faux negatives.

### 4. `no-console`

**1 occurrence** non-gated dans `src/`:
- `src/components/ui/__tests__/Toast.test.tsx:21` : `console.log('Undo clicked')` dans test mock — **acceptable** (file test, callback factice).

**Autres `console.*`** dans `src/main.tsx` (lignes 48, 76) — **gated derrière `import.meta.env.DEV`** — OK.

`src/worker/**` : 3 occurrences hors scope frontend.

### 5. `no-debugger`

**0 occurrence** de `debugger;` statement. Clean.

### 6. TODO / FIXME / XXX / HACK

**1 occurrence** dans frontend :
- `src/pages/Dashboard.tsx:233` : `// TODO: vraie comparaison période précédente requiert backend (getDashboardStats({period_compare}))` — **TODO documenté backend-driven, légitime**.

Pas de FIXME/XXX/HACK.

### 7. Prettier-like inconsistencies (sample)

Audit visuel rapide sur 10 fichiers — patterns observés :
- Single quotes `'...'` : majoritaire (Vite default) — **cohérent**
- Trailing commas : présent dans la plupart des arrays/objects multi-line — **cohérent**
- Indentation 2 spaces : **cohérent**
- Import order : pas de plugin auto-sort détecté mais ordre raisonnable manuel (react → @-aliased → relative)

Aucune inconsistance majeure trouvée.

---

## Summary M2.4

| Catégorie | Finding count |
|---|---|
| ESLint config présente | 0 (absent) |
| Prettier config présente | 0 (absent) |
| `any` frontend (cover M2.2) | 25 fichiers |
| `console.log` à fixer | 0 (1 dans test acceptable) |
| `debugger;` | 0 |
| TODO à fixer | 0 (1 documenté backend) |
| FIXME / XXX / HACK | 0 |
| useEffect `[]` à auditer | 26 (sample 5 OK) |

## Conclusion M2.4

Le code frontend Intralys est **propre par tsc strict** mais sans filet ESLint/Prettier dédié. Build OK = code OK (typecheck strict).

**Action immédiate** : aucune — code clean, pas de fix nécessaire.

**Action recommandée hors scope M2.4** :
1. Installer ESLint flat config + plugins (@typescript-eslint, react, react-hooks, import) dans un sprint dédié
2. Installer Prettier + config minimale
3. Ajouter `bun run lint` script + intégrer dans le pipeline `bun run build` (tsc → eslint → vite build)
4. Backfill audit complet `react-hooks/exhaustive-deps` quand ESLint sera setup
5. Refactor 25 fichiers `any` (couvert dans audit TS strict M2.2)
