# Sprint 21 — Power-user features visibles (~5j)

> **Objectif :** Compléter la suite de différenciateurs UX. Focus sur 4 features qui ont
> un haut ratio impact/effort sur ressources existantes (pas de nouveau backend lourd).

## Contexte

TaskPanel/ConversationPanel demandent de nouveaux endpoints + refactor pages — reportés
à plus tard si vraiment nécessaire. À la place, on capitalise sur les features visibles
qui poussent encore plus loin la différenciation vs GHL.

## Phase A — Universal Quick-Add FAB (~1j)

Bouton flottant `+` bottom-right présent sur toutes les pages auth.
- Click → menu Popover avec 4 options : Nouveau lead · Nouveau RDV · Nouvelle tâche · Nouvelle note
- Click sur une option → ouvre une mini-modale rapide (1 champ : titre/nom) + save
- Lead créé → ouvre LeadPanel automatiquement
- Mobile : bouton ancré au-dessus de la MobileBottomNav
- Fichier : `src/components/QuickAddFab.tsx`
- Wire dans AppLayout

## Phase B — Density modes (~1j)

Toggle dans le header avec 3 modes : Compact · Confortable · Spacieux.
- Persiste dans localStorage `intralys_density`
- Applique data-attribute `data-density="compact"` sur `<html>`
- CSS variables `--row-height`, `--card-padding`, `--gap-y` qui dérivent du mode
- Compact : -25% vertical · Confortable (défaut) · Spacieux : +25%
- Wired dans 3 endroits visibles : Leads table, Inbox conversation list, Dashboard cards

## Phase C — AI batch summarize sur leads sélectionnés (~1.5j)

Quand l'user sélectionne 2+ leads dans [Leads.tsx](src/pages/Leads.tsx), la bulk action bar
gagne un bouton "✨ Résumer (N)" qui :
- Charge contexte de chaque lead (nom, email, status, notes, dernière interaction)
- Appelle un nouveau endpoint `/api/ai/summarize-leads` qui retourne un résumé tableau
- Affiche dans un Modal avec : tableau (1 ligne par lead) + résumé global "N leads, X hot, Y inactifs..."
- Bouton "Exporter en CSV" pour le résumé

## Phase D — Smart Lists pinned à la sidebar (~1j)

Smart Lists existent déjà mais sont enfouies. Les promouvoir au niveau "saved views" :
- Dans [Sidebar.tsx](src/components/layout/Sidebar.tsx), nouvelle section "Vues" après "Leads"
- Charge les `smartLists` au mount du Sidebar (via getSmartLists)
- Click sur une smart list → navigate vers `/leads?smart=<id>` qui pré-applique les filtres
- Indicateur visuel quand active (background tinted, icône check)

## Phase E — Clôture (~0.5j)

- Build vert + tests verts
- Smoke test : FAB visible partout, density change applique partout, batch summarize marche, smart list pin marche
- ROADMAP : Sprint 21 → ~213j cumulés
- Memory : `sprint21_status.md`

---

## Critères de succès

- [ ] FAB `+` flottant visible sur toutes les pages auth, 4 actions cliquables
- [ ] Density toggle persiste + affecte les 3 zones cibles
- [ ] Batch summarize : 5 leads sélectionnés → résumé apparaît en <3s
- [ ] Smart Lists apparaissent dans la sidebar, click applique le filtre
- [ ] Build vert + 193+ tests verts
- [ ] Aucune régression Sprints 17-20

## Hors scope (Sprint 22+)

- TaskPanel, ConversationPanel (extensions panel stack, demandent refactor backend)
- Activity stream feed (les notifications existent déjà — polish séparé)
- Multi-user awareness (live cursors)
- Semantic search via embeddings
- Sound design + haptics mobile

---

_Plan créé le 2026-05-13._
