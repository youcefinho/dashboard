# Sprint 16.5 — Polish visuel + snapshots régression (~2-3j)

> **Objectif :** Compléter Phase D (polish visuel cohérent) et Phase E.2 (snapshots
> Playwright) du Sprint 16 qui ont été skipped lors de la migration mécanique
> (commit fa3c406 livré en 1j vs 10j estimés).
> Pas de refresh visuel — on aligne la cohérence sur l'existant cyan/orange.

**Contexte audit Sprint 16** :
- ✅ Migration Modal/Input → Radix faite (mécanique solide)
- ❌ Phase D polish (empty states, skeletons, transitions, a11y, spacing) non couverte
- ❌ Phase E.2 snapshots Playwright non créés

---

## Phase A — Audit visuel exhaustif (0.5j)

**A.1 — Tour des 43 pages (0.5j)** 🔴
- Démarrer dev server (`bun dev`)
- Pour chaque page de `src/pages/*.tsx`, captures + check rapide :
  - Empty state : présent ? format cohérent (icon + title + description + action) ?
  - Loading skeleton : présent pendant fetch ? matche la forme du contenu ?
  - Transitions : `transition-all duration-[var(--transition-fast)]` ou variations ?
  - Hover states : cohérents (border brand, shadow-md, scale subtile) ?
  - Focus visible : `focus-visible:ring-[3px]` partout sur interactifs ?
  - Spacing : `p-4` / `p-5` cohérent sur les cards ? gaps `gap-2/3/4` cohérents ?
- Sortie : tableau dans `docs/SPRINT16.5-AUDIT-VISUEL.md` avec ✅/❌/🟡 par page × critère

---

## Phase B — Empty states cohérents (0.5j)

**B.1 — Pages avec listes/tables sans EmptyState** 🟠
- Liste les pages détectées en Phase A.1
- Pour chaque : ajouter `<EmptyState icon={...} title="..." description="..." action={<Button/>} />`
- Référence visuelle : `Leads.tsx:346` (pattern actuel)
- Icons cohérentes : utiliser `lucide-react` (Users, Inbox, Calendar, FileX selon le contexte)
- Wording FR québécois : "Aucun lead pour l'instant" plutôt que "Aucun lead trouvé" si filters vides

---

## Phase C — Loading skeletons cohérents (0.5j)

**C.1 — Skeletons pendant fetch initial** 🟠
- Toute page qui appelle `getX()` au mount → skeleton tant que `isLoading`
- Pattern : `{isLoading ? <Skeleton className="h-96 w-full" /> : <Content />}`
- Forme du skeleton matche le contenu réel (table = barres horizontales, cards = grille de blocs)
- Pages prioritaires : Dashboard, Pipeline, Calendar, Inbox, Reports, Tasks, Templates

---

## Phase D — Transitions + hover + a11y (0.5j)

**D.1 — Transitions uniformisées** 🟡
- Tokens : `transition-all duration-[var(--transition-fast)]` (rapide UI) / `duration-[var(--transition-medium)]` (modal/drawer)
- Audit `transition-colors`, `duration-200`, `transition` nu → remplacer

**D.2 — Hover states unifiés** 🟡
- Cards interactives : `hover:border-[var(--brand-primary)] hover:shadow-[var(--shadow-md)]`
- Boutons icônes : `hover:bg-[var(--bg-subtle)] hover:text-[var(--brand-primary)]`
- Liens : `hover:underline` ou `hover:text-[var(--brand-primary)]` selon contexte

**D.3 — Focus visible a11y** 🔴
- Tous les éléments interactifs (`<button>`, `<Link>`, `<select>`, `<input>`) doivent avoir :
  - `focus-visible:ring-[3px] focus-visible:ring-[var(--ring)] focus-visible:outline-none`
- Modal Radix : auto-géré par primitive
- Test : naviguer Dashboard → Leads → LeadDetail uniquement au clavier (Tab + Shift+Tab + Enter)

---

## Phase E — Spacing + typo audit + snapshots + clôture (1j)

**E.1 — Spacing / typo cohérents (0.5j)** 🟡
- Headers de page : `text-lg font-semibold text-[var(--text-primary)]` partout
- Subheaders : `text-sm font-medium text-[var(--text-secondary)]`
- Text muted : `text-[var(--text-muted)]` (jamais `text-gray-400` / `text-zinc-500` / etc.)
- Cards padding : `p-4` (compact) ou `p-5` (default) — pas `p-3` ni `p-6` random
- Gaps : `gap-2` (tight) / `gap-3` (normal) / `gap-4` (loose) selon hiérarchie

**E.2 — Snapshots Playwright (0.5j)** 🟠
- Installer `@playwright/test` si pas déjà fait : `bun add -d @playwright/test`
- Config minimale `playwright.config.ts` (1 browser chromium, viewport 1440x900)
- Fichier `tests/visual.spec.ts` avec 5 captures :
  - Dashboard `/`
  - Leads `/leads` (table view + cards view + map view = 3 screenshots)
  - LeadDetail `/leads/lead-001`
  - Pipeline `/pipeline`
  - Inbox `/inbox`
- Stocker baselines dans `tests/__screenshots__/` (tracked git)
- Helper test `npm run test:visual` qui lance Playwright contre `bun dev`
- Si diff > 5% vs baseline → fail (régression visuelle catchée)

**E.3 — Clôture (0.25j)**
- Build vert + 193+ tests Vitest + tests:visual passe
- ROADMAP.md : Sprint 16.5 dans accomplis (total ~193j cumulés)
- `git mv ANTIGRAVITY-SPRINT16.5-PLAN.md docs/archive/`
- Update mémoire si besoin

---

## Résumé effort

| Phase | Effort | Items |
|---|---|---|
| A — Audit visuel exhaustif | 0.5j | Tour 43 pages, sortie audit dans docs/ |
| B — Empty states cohérents | 0.5j | Pages détectées, format unifié |
| C — Loading skeletons | 0.5j | Pages avec fetch initial, skeletons matche contenu |
| D — Transitions + hover + a11y | 0.5j | Tokens unifiés, focus visible partout |
| E — Spacing + snapshots + clôture | 1j | Audit final, Playwright setup + 5 snapshots, clôture |
| **Total** | **~3j** | **5 phases, ~15 items** |

---

## Critères de succès Sprint 16.5

- [ ] Toutes les pages avec liste/table ont un `<EmptyState />`
- [ ] Toutes les pages avec fetch initial ont un `<Skeleton />` pendant load
- [ ] 0 occurrence de `text-gray-` / `text-zinc-` dans `src/pages/*.tsx` (tokens uniquement)
- [ ] Navigation clavier fonctionne sur Dashboard → Leads → LeadDetail
- [ ] Focus visible visible sur tous éléments interactifs (ring 3px brand)
- [ ] Playwright installé + 5 snapshots tracked dans `tests/__screenshots__/`
- [ ] `bun run test:visual` passe (0 régression vs baseline)
- [ ] Build vert + 193+ tests Vitest verts

---

_Plan créé le 2026-05-13. Sera archivé dans docs/archive/ à la fin du sprint._
