# Sprint 16.5 — Audit Visuel

> Généré le 2026-05-13. Scope : pages CRM (33 fichiers dans src/pages/).
> Légende : ✅ présent | ❌ absent/requis | 🟡 partiel | ➖ non applicable

## Pages CRM avec listes/données

| Page | EmptyState | Skeleton | Hardcoded colors | Notes |
|---|---|---|---|---|
| Agencies | ✅ | ✅ | ✅ | OK |
| Calendar | ✅ | ✅ | ✅ | OK |
| ClientLeads | ✅ | ✅ | ✅ | OK |
| Clients | ✅ | ✅ | ✅ | OK |
| **Documents** | ❌ | ❌ | ✅ | Liste de documents — besoin ES+SK |
| **DocumentTemplates** | ❌ | ❌ | ✅ | Liste templates doc — besoin ES+SK |
| **FormBuilder** | ❌ | ❌ | ✅ | Liste de formulaires — besoin ES+SK |
| **Inbox** | ❌ | ❌ | ✅ | Conversations — besoin ES+SK |
| **Integrations** | ❌ | ❌ | ✅ | Cartes intégrations — besoin ES+SK |
| **Invoices** | ❌ | ❌ | ⚠ 1 | Liste factures — besoin ES+SK |
| Leads | ✅ | ✅ | ⚠ 1 | 1x text-gray-400 (mapbox hint) |
| LeadDetail | ✅ | ✅ | ✅ | OK |
| **Pipeline** | ❌ | ✅ | ✅ | Colonnes Kanban — besoin ES |
| **Properties** | ❌ | ❌ | ✅ | Liste propriétés — besoin ES+SK |
| Reports | ➖ | ✅ | ✅ | Pas de liste vide (graphes/stats) |
| Reviews | ✅ | ✅ | ✅ | OK |
| Tasks | ✅ | ❌ | ✅ | A un ES mais pas de Skeleton |
| Templates | ✅ | ✅ | ⚠ 3 | 3x text-gray (aperçu email HTML) |
| Trash | ✅ | ✅ | ✅ | OK |
| TriggerLinks | ✅ | ❌ | ✅ | A un ES mais pas de Skeleton |
| Workflows | ✅ | ✅ | ✅ | OK |
| WorkflowBuilder | ❌ | ❌ | ✅ | Pas une liste — ➖ |
| WorkflowDetail | ✅ | ✅ | ✅ | OK |

## Pages spéciales (pas de liste)

| Page | EmptyState | Skeleton | Notes |
|---|---|---|---|
| Dashboard | ➖ | ✅ | Stats/KPIs, pas de liste vide |
| EmailBuilder | ➖ | ➖ | Éditeur email, pas de liste |
| Settings | ➖ | ➖ | Onglets config, pas de liste |
| VisitMode | ➖ | ➖ | ⚠ 13x text-gray — mobile dark mode spécial |
| SignDocument | ➖ | ➖ | ⚠ 1x text-gray — formulaire signature |
| Login/ForgotPwd/Reset/ChangePwd | ➖ | ➖ | Auth pages OK |

## Pages Landing (hors scope CRM)

| Page | Hardcoded colors | Notes |
|---|---|---|
| PublicLayout | ⚠ 12x text-slate | Layout public — scope distinct |
| Pricing | ⚠ 20x text-slate | Page publique |
| Home | ⚠ text-slate | Page publique |
| Legal | ⚠ text-slate | Page publique |
| Demo/About/Changelog | ⚠ text-slate | Pages publiques |
| PublicForm | ⚠ 10x text-gray | Formulaire public embed |

## Résumé des actions

### Priorité 1 — EmptyState manquants (8 pages)
Documents, DocumentTemplates, FormBuilder, Inbox, Integrations, Invoices, Pipeline, Properties

### Priorité 2 — Skeleton manquants (10 pages)  
Documents, DocumentTemplates, FormBuilder, Inbox, Integrations, Invoices, Properties, Tasks, TriggerLinks + fixes

### Priorité 3 — Hardcoded colors CRM (4 fichiers, 18 occ)
Leads (1), Invoices (1), Templates (3), VisitMode (13)

### Priorité 4 — Hardcoded colors Landing (hors scope pour l'instant)
PublicLayout, Pricing, Home, Legal, Demo, About, Changelog, PublicForm (~50+ occurrences)
