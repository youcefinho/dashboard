# Sprint 16 — Design System Migration + Cohérence visuelle (~10j)

> **Objectif :** Terminer le Sprint Design 1+2 inachevé. Migrer les 18 fichiers
> qui utilisent encore `LegacyModal` (API `isOpen/onClose`) vers le Modal Radix
> (`open/onOpenChange`), aligner les usages de `LegacyInput` vers le nouveau Input,
> retirer `_legacy.tsx` (dead code) et `_compat.tsx` (shim) du codebase, puis
> polish visuel cohérent sur toutes les pages.
> Pas de refresh palette ni nouvelle direction artistique — on finit ce qui a
> été commencé. Cyan/orange Intralys préservés.

**Contexte audit** :
- 18 fichiers utilisent `isOpen=` (Modal Legacy) — cf. `git grep -c "isOpen="`
- `src/components/ui/_legacy.tsx` est dead code (dup complet de l'ancien design system, plus importé directement)
- `src/components/ui/_compat.tsx` est shim actif (LegacyModal + LegacyInput exportés via barrel comme défaut)
- Le barrel commente : *"Sprint Design — les pages non refondues utilisent encore les APIs legacy"*

---

## Phase A — Audit & mapping migration (1j)

**A.1 — Inventaire exhaustif (0.5j)** 🟠
- Liste précise des 18 fichiers Modal Legacy + ce que chaque modal fait (nom, fonction métier)
- Liste précise des usages `LegacyInput` avec props `label` / `icon` (ces 2 props n'existent pas sur le nouveau Input)
- Liste des `isOpen=` qui appartiennent à `<Modal>` Radix vs `<LegacyModal>` (le nouveau Modal s'appelle aussi Modal mais sur `./Modal` direct)
- Sortie : tableau dans `docs/SPRINT16-MIGRATION-MAP.md`

**A.2 — Doc mapping API (0.25j)** 🟠
- `LegacyModal { isOpen, onClose, title, children }` → `Modal { open, onOpenChange, title, children, description?, size? }`
- `LegacyInput { label, icon, error }` → `<label>` explicite + `<Input leftIcon={...} />` + message d'erreur séparé
- Conversion automatique possible via script `sed` pour le 80% des cas

**A.3 — Script de migration assisté (0.25j)** 🟡
- `scripts/migrate-modal.ts` : transforme automatiquement les imports + props simples
  - `import { Modal } from '@/components/ui'` → `import { Modal } from '@/components/ui/Modal'`
  - `<Modal isOpen={x} onClose={() => f()}>` → `<Modal open={x} onOpenChange={(o) => !o && f()}>`
- Mode dry-run pour audit avant écriture
- Tests script sur 1 fichier pilote avant batch

---

## Phase B — Migration Modal LegacyModal → Radix Modal (3j)

**Stratégie** : migrer par batches de 3-4 fichiers, valider visuellement en dev, commit par batch.

**B.1 — Pilote sur 2 fichiers simples (0.5j)** 🔴
- `src/pages/Trash.tsx` (1 modal) + `src/pages/Invoices.tsx` (1 modal)
- Identifie les pièges (z-index, animations, body scroll lock, focus trap)
- Documente les patterns dans MIGRATION-MAP.md

**B.2 — Batch 1 : Pages simples (1j)** 🟠
- `src/pages/Agencies.tsx` (1), `src/pages/Pipeline.tsx` (1), `src/pages/Properties.tsx` (1), `src/pages/TriggerLinks.tsx` (1), `src/pages/WorkflowBuilder.tsx` (1)
- 5 fichiers × 1 modal = ~30 min/fichier
- Commit : `refactor(ui): migrate batch 1 to Radix Modal (Agencies, Pipeline, Properties, TriggerLinks, WorkflowBuilder)`

**B.3 — Batch 2 : Pages avec modals multiples (1j)** 🟠
- `src/pages/Calendar.tsx` (2), `src/pages/Clients.tsx` (2), `src/pages/Leads.tsx` (2), `src/pages/Tasks.tsx` (2), `src/pages/Templates.tsx` (2), `src/pages/FormBuilder.tsx` (3)
- 6 fichiers × 2-3 modals = ~45 min/fichier
- Commit : `refactor(ui): migrate batch 2 to Radix Modal (Calendar, Clients, Leads, Tasks, Templates, FormBuilder)`

**B.4 — Batch 3 : Composants partagés (0.5j)** 🟠
- `src/components/layout/AppLayout.tsx` (2), `src/components/settings/ApiWebhooksSettings.tsx` (3), `src/components/settings/SecuritySettings.tsx` (1), `src/components/settings/SnippetsSettings.tsx` (1), `src/components/settings/TeamSettings.tsx` (1)
- Composants partagés = visible sur plusieurs routes, valider sur 3+ routes différentes
- Commit : `refactor(ui): migrate shared components to Radix Modal (AppLayout, Settings sub-components)`

---

## Phase C — Migration LegacyInput → Input + label explicite (2j)

**C.1 — Audit usages LegacyInput (0.5j)** 🟠
- Grep `import.*Input.*from '@/components/ui'` (= barrel = LegacyInput)
- Pour chaque usage, noter si `label=` et/ou `icon=` sont passés
- Cas standard : `<Input label="Email" icon={<Mail size={16}/>} />` → `<label htmlFor="..."><Mail size={16}/> Email</label><Input id="..." leftIcon={<Mail size={16}/>} />`

**C.2 — Refactor par batch (1.25j)** 🟠
- 2 batches similaires à Phase B
- Préserve la sémantique (label associé via htmlFor + id)
- Préserve les error states (passer en prop ou via composant Field wrapper)
- Commit par batch

**C.3 — Helper Field wrapper (optionnel, 0.25j)** 🟡
- Si beaucoup de répétition `<label>... <Input> ... {error && ...}</...>`, créer `<Field label icon error>{...}</Field>` qui réplique l'API LegacyInput mais utilise le nouveau Input dessous
- Permet de migrer en 1-line change : `<Input label="..." />` → `<Field label="..."><Input /></Field>`
- À évaluer après le batch C.2 selon volume de répétitions

---

## Phase D — Polish visuel + cohérence (2.5j)

**D.1 — Empty states cohérents (0.5j)** 🟠
- Audit chaque page : empty state existe-t-il ? format cohérent (icon + title + description + action) ?
- Pages manquantes : ajouter `<EmptyState />` (composant existe déjà)
- Référence visuelle : empty state Leads.tsx actuel

**D.2 — Loading skeletons (0.5j)** 🟠
- Audit chaque liste/table : Skeleton pendant fetch
- Pattern : `{isLoading ? <Skeleton className="h-96 w-full" /> : <Content />}`
- Skeletons doivent matcher la forme du contenu réel

**D.3 — Transitions / hover cohérents (0.5j)** 🟡
- Audit `transition` classes : utiliser `transition-all duration-[var(--transition-fast)]` partout (vs `transition-colors`, `duration-200`, etc.)
- Hover states : `hover:border-[var(--brand-primary)]` ou `hover:shadow-[var(--shadow-md)]` selon contexte (cards interactives)
- Pas d'animation lourde sur scroll/load (perf mobile)

**D.4 — Focus visible (a11y) (0.5j)** 🟠
- Tous les éléments interactifs doivent avoir `focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]`
- Modals Radix gèrent le focus trap automatiquement, OK
- Vérif keyboard navigation (Tab + Shift+Tab) sur 3 pages clés (Dashboard, Leads, Inbox)

**D.5 — Spacing & typo audit (0.5j)** 🟡
- Audit headers de pages : tous en `text-lg font-semibold` ou `text-base font-semibold` ?
- Audit cards padding : tous en `p-4` ou `p-5` ?
- Audit text muted : `text-[var(--text-muted)]` partout (pas `text-gray-400`)

---

## Phase E — Cleanup + tests + clôture (1.5j)

**E.1 — Supprimer dead code (0.5j)** 🔴
- `git rm src/components/ui/_legacy.tsx` (dead code, plus importé directement après audit A.1)
- `git rm src/components/ui/_compat.tsx` (shim plus utilisé après Phases B+C)
- Update `src/components/ui/index.ts` : retirer `LegacyModal as Modal` et `LegacyInput as Input`, exporter direct depuis `./Modal` et `./Input`
- Build vert obligatoire après ce changement (TS erreurs sur tout fichier qui utilise encore Legacy*)

**E.2 — Tests snapshot visuel (0.5j)** 🟠
- Playwright (déjà installé dans deferred tools) : screenshots de 5 pages clés au build prod
  - Dashboard, Leads (table + cards + map), LeadDetail, Pipeline, Inbox
- Stocker dans `__tests__/snapshots/` (gitignored ou tracked petits)
- Si diff > 5% vs baseline → fail le test (régression visuelle catchée)

**E.3 — Docs MIGRATION-DESIGN-SYSTEM.md (0.25j)** 🟡
- `docs/MIGRATION-DESIGN-SYSTEM.md` :
  - Conventions usage Modal (taille, animation, focus)
  - Conventions usage Input (label, icon, error states)
  - Tokens CSS de référence (couleurs, spacing, radius, shadows)
  - Mapping ancien API → nouveau API (pour futur dev)

**E.4 — Build vert + tests + clôture (0.25j)**
- `bun run build` vert (worker.ts type-checké depuis Sprint 13.5)
- `bun run test --run` vert (193+ tests, pas de régression Toast/auth)
- ROADMAP.md : Sprint 16 → accomplis avec total ~200j cumulés
- `git mv ANTIGRAVITY-SPRINT16-PLAN.md docs/archive/`

---

## Résumé effort

| Phase | Effort | Items |
|---|---|---|
| A — Audit & mapping | 1j | Inventaire, mapping API, script aide |
| B — Migration Modal (18 fichiers, 3 batches) | 3j | Pilote + 3 batches commités |
| C — Migration Input + label explicite | 2j | Audit, refactor, Field wrapper optionnel |
| D — Polish visuel cohérent | 2.5j | Empty states, skeletons, transitions, a11y, spacing |
| E — Cleanup + tests + docs | 1.5j | _legacy/_compat supprimés, snapshots Playwright, MIGRATION-DESIGN.md |
| **Total** | **~10j** | **5 phases, ~20 items** |

---

## Critères de succès Sprint 16

- [ ] `src/components/ui/_legacy.tsx` supprimé
- [ ] `src/components/ui/_compat.tsx` supprimé
- [ ] Barrel `src/components/ui/index.ts` exporte directement Modal Radix et nouveau Input
- [ ] 0 occurrence de `isOpen=` dans `src/pages/*.tsx` + `src/components/**/*.tsx` (sauf si autre composant l'utilise)
- [ ] 0 occurrence de `<Input label=` ou `<Input icon=` (anciennes props LegacyInput)
- [ ] Build vert + 193+ tests verts + 0 erreurs TS
- [ ] 5 snapshots Playwright produits (Dashboard, Leads, LeadDetail, Pipeline, Inbox)
- [ ] Empty states et loading skeletons présents sur toutes les pages avec listes/tables
- [ ] `docs/MIGRATION-DESIGN-SYSTEM.md` documenté

---

## Hors scope (à faire dans un Sprint 17 dédié si décidé)

- **Refresh palette ou direction artistique** (= Option B initiale, cyan/orange préservés ici)
- **Refonte landing intralys.com** (site marketing séparé)
- **Onboarding wizard polish** (existe déjà, polish UX dédié)
- **Mode dark explicite** (actuellement dark by default, pas de toggle)
- **i18n EN** (Sprint 16 reste FR only, EN après 100 clients)

---

_Plan créé le 2026-05-12. Sera archivé dans docs/archive/ à la fin du sprint._
