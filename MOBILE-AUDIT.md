# 📱 MOBILE AUDIT — Intralys CRM Sprint 9

> Date : 2026-05-12
> Auditeur : Antigravity
> Device référence : iPhone SE (375×667), iPad Mini (768×1024)
> Méthode : analyse statique du code + vérification visuelle

---

## Résumé

| Critère | Résultat |
|---------|----------|
| Pages totales | 31 |
| ✅ OK sur mobile | 8 |
| ⚠️ Partiel (utilisable mais UX dégradée) | 14 |
| ❌ Cassé (inutilisable sur 375px) | 9 |
| PWA installable | ✅ (manifest + SW commités) |
| Bottom nav mobile | ✅ (MobileBottomNav commité) |
| Touch targets 44px | ⚠️ CSS ajouté, non appliqué partout |

---

## Audit page par page

### ✅ OK — Fonctionnel sur mobile sans intervention

| # | Page | Notes |
|---|------|-------|
| 1 | Login | Formulaire centré, inputs plein width. OK. |
| 2 | ChangePassword | Formulaire simple centré. OK. |
| 3 | SignDocument | Déjà mobile-first (formulaire + signature pad). OK. |
| 4 | PublicForm | Formulaire public responsive. OK. |
| 5 | VisitMode | Conçu mobile-first. ⚠️ `grid-cols-4` sans breakpoint L205 (stats) |
| 6 | Documents | Cards layout, pas de table large. OK. |
| 7 | DocumentTemplates | Cards layout simple. OK. |
| 8 | Reviews | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` ✅ |

---

### ⚠️ Partiel — Utilisable mais UX dégradée

| # | Page | Problème | Sévérité |
|---|------|----------|----------|
| 9 | Dashboard | `grid-cols-4` L266, `grid-cols-6` L296, `grid-cols-3` L327/L404 sans breakpoint mobile → cartes écrasées | CRITIQUE |
| 10 | Leads | Table 7+ colonnes overflow horizontal. Mode cards `grid-cols-1 sm:grid-cols-2` OK, mais table mode cassé | MOYEN |
| 11 | Tasks | `grid-cols-2 md:grid-cols-3` OK, mais table de tâches overflow | MOYEN |
| 12 | Invoices | Stats `grid-cols-2 md:grid-cols-4` OK, mais table factures 6 colonnes overflow | MOYEN |
| 13 | Clients | Stats `grid-cols-2 sm:grid-cols-4` OK, mais table clients overflow | MOYEN |
| 14 | Agencies | Table overflow, pas de mode cards | MOYEN |
| 15 | ClientLeads | Table overflow, pas de breakpoints | MOYEN |
| 16 | Settings | SubNav `grid-cols-2 md:grid-cols-4` OK, sous-pages formulaires OK | MINEUR |
| 17 | Integrations | Stats `grid-cols-2 md:grid-cols-4` OK, cards intégrations OK | MINEUR |
| 18 | Properties | `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` ✅, mais formulaire modal peut overflow | MINEUR |
| 19 | Reports | Charts Recharts s'adaptent auto, mais onglets horizontaux overflow | MOYEN |
| 20 | Workflows | Cards `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` ✅, mais table detox overflow | MINEUR |
| 21 | WorkflowDetail | Stats `grid-cols-2 md:grid-cols-4` OK, table enrollments overflow | MINEUR |
| 22 | Templates | Cards `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` ✅ | MINEUR |

---

### ❌ Cassé — Inutilisable sur 375px

| # | Page | Problème | Action requise |
|---|------|----------|----------------|
| 23 | Pipeline | Kanban columns côte à côte → overflow horizontal sans scroll snap. Colonnes écrasées à ~60px | **Swiper horizontal 1 colonne visible** |
| 24 | Inbox | 3 panneaux flex côte à côte → threads invisibles sur 375px. Layout `flex` sans responsive | **1 panneau actif + back nav** |
| 25 | Calendar | Grille 7 jours fixe → cellules microscopiques. Vue Week illisible | **Vue Day par défaut + scroll** |
| 26 | EmailBuilder | Canvas drag-drop → inutilisable au touch. Sidebar props + canvas + preview = 3 panneaux | **Banner "desktop only"** |
| 27 | FormBuilder | Même problème que EmailBuilder — drag-drop multi-panneaux | **Banner "desktop only"** |
| 28 | WorkflowBuilder | Même problème — visual builder multi-panneaux | **Banner "desktop only"** |
| 29 | LeadDetail | 2 colonnes `md:grid-cols-3` mais beaucoup de contenu → scroll long OK, mais tabs latéraux overflow | MOYEN — wrappable |
| 30 | Trash | Table 5 colonnes, pas de mode cards, pas de breakpoints | **Wrapper table-responsive** |
| 31 | TriggerLinks | Table 4 colonnes overflow sans wrapper | **Wrapper table-responsive** |

---

## Bugs critiques à corriger

### Layout overflow (tables sans wrapper)

| Fichier | Ligne(s) | Fix |
|---------|----------|-----|
| `Leads.tsx` | Table mode | Ajouter `<div className="table-responsive">` autour du `<table>` |
| `Tasks.tsx` | Table mode | Idem |
| `Invoices.tsx` | Table factures | Idem |
| `Clients.tsx` | Table clients | Idem |
| `Agencies.tsx` | Table agences | Idem |
| `ClientLeads.tsx` | Table leads client | Idem |
| `Trash.tsx` | Table corbeille | Idem |
| `TriggerLinks.tsx` | Table trigger links | Idem |
| `WorkflowDetail.tsx` | Table enrollments | Idem |
| `Reports.tsx` | Table CAC | Idem |

### Grilles non-responsive

| Fichier | Ligne | Actuel | Fix |
|---------|-------|--------|-----|
| `Dashboard.tsx` | 266 | `grid-cols-4` | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` |
| `Dashboard.tsx` | 296 | `grid-cols-6` | `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` |
| `Dashboard.tsx` | 327 | `grid-cols-3` | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| `Dashboard.tsx` | 404 | `grid-cols-3` | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| `VisitMode.tsx` | 205 | `grid-cols-4` | `grid-cols-2 sm:grid-cols-4` |

### Pages desktop-only (builders)

| Fichier | Action |
|---------|--------|
| `EmailBuilder.tsx` | Afficher banner mobile "Cette fonctionnalité nécessite un écran plus large" |
| `FormBuilder.tsx` | Idem |
| `WorkflowBuilder.tsx` | Idem |

### Pages nécessitant refactoring mobile

| Fichier | Refactoring |
|---------|-------------|
| `Pipeline.tsx` | Kanban → swiper horizontal 1 colonne visible |
| `Inbox.tsx` | 3 panneaux → 1 panneau actif + back navigation |
| `Calendar.tsx` | Vue Day par défaut sur mobile, Week scrollable |

---

## Bugs UX mineurs

| # | Problème | Fichier(s) | Priorité |
|---|----------|------------|----------|
| 1 | Hover effects inutiles sur touch (`.card-lift:hover` déjà fixé dans CSS) | Global | ✅ Fait |
| 2 | Scrollbar visible sur table scroll mobile | Global CSS | Bas |
| 3 | Modals pas full-screen sur petit mobile | Global CSS | ✅ Fait |
| 4 | Tab bars horizontales overflow (Reports, Settings) | Reports/Settings | Moyen |
| 5 | Boutons trop petits sur certains formulaires | Divers | ✅ Fait (44px CSS) |

---

## Plan d'exécution par priorité

### P0 — Fix immédiats (< 1h)
- [x] Grilles Dashboard responsive ✅
- [x] Tables wrapper `table-responsive` sur 10 pages ✅ (la plupart avaient déjà `overflow-x-auto`)
- [x] Banner "desktop only" sur 3 builders ✅
- [x] VisitMode grid fix ✅

### P1 — Refactoring mobile (2-3j)
- [x] Pipeline kanban → swiper ✅
- [x] Inbox 1-panneau mobile ✅
- [x] Calendar Day default mobile ✅

### P2 — Polish (1j)
- [x] Install prompt PWA ✅
- [x] Tab bars scrollables (Reports, Settings) ✅
- [ ] Swipe actions sur cards (Leads, Tasks)
- [ ] Long-press menu contextuel

