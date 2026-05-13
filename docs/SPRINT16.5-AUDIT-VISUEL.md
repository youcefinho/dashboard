# Sprint 16.5 — Audit Visuel (révisé 2026-05-13)

> Audit initial : 2026-05-13. **Révisé le 2026-05-13** après vérification manuelle.
> Scope : pages CRM (33 fichiers dans `src/pages/`).
> Légende : ✅ présent | ❌ absent/requis | 🟡 partiel | ➖ non applicable

## ⚠️ Note sur la méthodologie de l'audit initial

L'audit initial faisait un `grep -l "EmptyState\|Skeleton"` sur `src/pages/*.tsx` seuls.
Cette méthode produit **3 catégories de faux positifs** :

1. **Faux gaps "déjà fait"** — la page a bien ES/SK mais l'audit avait été généré
   sur une version antérieure (les commits Sprint 16.5 et précédents ne sont pas
   reflétés). Vérification grep réelle nécessaire.
2. **Faux gaps "sous-composants"** — la page de niveau supérieur (ex: `Inbox.tsx`)
   délègue la liste à un sous-composant (ex: `ConversationsList.tsx`) qui contient
   bien ES + SK. Le grep ne descend pas.
3. **Faux gaps "non applicable"** — pages-éditeur (FormBuilder, WorkflowBuilder)
   ou pages à données statiques (Integrations) qui n'ont pas vraiment besoin
   du même pattern qu'une page-liste async.

**Méthode correcte** : vérifier grep + lire la structure réelle de chaque page
avant de conclure à un gap.

## État réel après vérification (2026-05-13)

### Pages avec listes/données async

| Page | EmptyState | Skeleton | Hardcoded colors | Notes |
|---|---|---|---|---|
| Agencies | ✅ | ✅ | ✅ | OK |
| Calendar | ✅ | ✅ | ✅ | OK |
| ClientLeads | ✅ | ✅ | ✅ | OK |
| Clients | ✅ | ✅ | ✅ | OK |
| Documents | ✅ | ✅ | ✅ | OK *(audit initial avait dit ❌ — déjà fait)* |
| DocumentTemplates | ✅ | ✅ | ✅ | OK *(audit initial avait dit ❌ — déjà fait)* |
| **FormBuilder** | ➖ | ✅ | ✅ | Page-éditeur (pas une liste). Skeleton ajouté pendant `getForm()` |
| Inbox | ✅* | ✅* | ✅ | OK *(ES+SK dans `ConversationsList.tsx` sous-composant)* |
| Integrations | ➖ | ➖ | ✅ | Données statiques (const array), pas d'async — non applicable |
| Invoices | ✅ | ✅ | ✅ | OK *(audit initial avait dit ❌ — déjà fait)* |
| Leads | ✅ | ✅ | ✅ | OK |
| LeadDetail | ✅ | ✅ | ✅ | OK |
| **Pipeline** | ✅ | ✅ | ✅ | Empty global ajouté quand `leads.length === 0 && pas de filtre` |
| Properties | ✅ | ✅ | ✅ | OK *(audit initial avait dit ❌ — déjà fait)* |
| Reports | ➖ | ✅ | ✅ | Pas de liste vide (graphes/stats) |
| Reviews | ✅ | ✅ | ✅ | OK |
| **Tasks** | ✅ | ✅ | ✅ | Skeleton ajouté pendant `getTasks()` |
| Templates | ✅ | ✅ | ✅* | OK *(3 `text-gray-*` intentionnels dans previews d'emails `bg-white`)* |
| Trash | ✅ | ✅ | ✅ | OK |
| TriggerLinks | ✅ | ✅ | ✅ | OK *(audit initial avait dit SK ❌ — déjà fait)* |
| Workflows | ✅ | ✅ | ✅ | OK |
| WorkflowBuilder | ➖ | ➖ | ✅ | Page-éditeur (pas une liste) |
| WorkflowDetail | ✅ | ✅ | ✅ | OK |

\* = présent via sous-composant ou intentionnel (voir notes).

### Pages spéciales

| Page | Notes |
|---|---|
| Dashboard | KPIs + graphes — pas de liste vide. Skeleton présent. |
| EmailBuilder | Éditeur visuel — pas de liste. ES+SK non applicable. |
| Settings | Onglets config — pas de liste. ES+SK non applicable. |
| **VisitMode** | **Dark theme mobile intentionnel** (`bg-gray-950`, `text-gray-400`, etc.). Les 13 occurrences `text-gray-*` ne sont **pas** des gaps : c'est la palette dédiée du mode terrain courtier. Migration vers tokens nécessiterait de définir une variante dark du design system — Sprint dédié si voulu. |
| SignDocument | Form signature standalone. 1 `text-gray-*` à confirmer si intentionnel. |
| Login/ForgotPwd/Reset/ChangePwd | Auth pages — tokens OK. |

### Pages Landing (hors scope CRM)

Layout public séparé (palette plus claire `text-slate-*` pour landing marketing).
Hors scope du design system CRM. Migration possible mais déconseillée — landing
a sa propre identité visuelle.

## Hardcoded colors — analyse fine

### Intentionnels (à laisser tel quel)
- **Templates.tsx** lignes 176, 317, 361 : `text-gray-700/900` sur `bg-white` dans
  previews d'emails. Un email rendu doit s'afficher sur fond blanc avec texte
  sombre — c'est cohérent avec ce que le destinataire verra.
- **VisitMode.tsx** (13×) : palette dark intentionnelle pour le mode mobile
  terrain. Voir note dédiée ci-dessus.

### Vrais gaps : aucun dans le scope CRM utilisateur.

## Travail effectué le 2026-05-13 (post-audit)

### Fixes appliqués (Claude Code, 3 fichiers)
- `src/pages/FormBuilder.tsx` — Ajout `isLoading` state + Skeleton dans le canvas
  central pendant `getForm()`. Importe `Skeleton` depuis `@/components/ui`.
- `src/pages/Tasks.tsx` — Ajout `isLoading` state + Skeleton pour les modes
  list ET kanban pendant `getTasks()`. Importe `Skeleton` depuis `@/components/ui`.
- `src/pages/Pipeline.tsx` — Ajout `EmptyState` global quand `leads.length === 0`
  ET `activeFilters.length === 0` (premier usage, pas un filtre). Importe
  `EmptyState` depuis `@/components/ui`.

### Validation requise (Rochdi)
```bash
bun run build && bun run test --run
```

### Commits suggérés
```
feat(ui): skeleton loading state in FormBuilder + Tasks pages
feat(ui): global EmptyState for empty Pipeline (first-use)
docs(audit): refresh Sprint 16.5 visual audit with actual state
```

## Lesson learned (pattern audit-stale)

Cet épisode confirme le pattern d'audit-désync du handoff : un audit qui dit
"❌" peut être stale. Avant tout sprint de gap-filling, **re-vérifier le grep
réel** + lire la structure des pages pour distinguer :
- "déjà fait" (audit obsolète)
- "présent via sous-composant" (grep top-level seul ne suffit pas)
- "non applicable" (page-éditeur, données statiques, dark theme intentionnel)

À ajouter à `project_conventions.md` mémoire : *avant de partir sur un sprint
basé sur un audit, re-grep le scope ciblé pour confirmer les gaps*.
