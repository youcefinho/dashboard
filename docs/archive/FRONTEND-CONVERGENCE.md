# FRONTEND-CONVERGENCE — Sprint S6 M3 (2026-05-16)

> Diagnostic factuel de la divergence design CRM ↔ boutique + recommandations
> d'usage des classes/tokens **déjà existants** + backlog Lot 3.
>
> **Portée de ce doc** : outillage + recommandations seulement. M3 n'édite
> AUCUNE page (M1 = boutique, M2 = CRM) et n'a modifié AUCUNE règle CSS
> existante. La décision esthétique finale (alignement visuel) revient à
> Rochdi via validation visuelle — ce doc fournit le plan, pas le verdict.

---

## 1. Diagnostic densité / divergence (M3.1)

### 1.1 Mesures brutes (lignes / occurrences `className=`)

| Page | Fichier | Lignes | `className=` | Cohorte |
|---|---|---:|---:|---|
| Leads | `src/pages/Leads.tsx` | 1595 | 218 | CRM ancien |
| Dashboard | `src/pages/Dashboard.tsx` | 1461 | 229 | CRM ancien |
| LeadDetail | `src/pages/LeadDetail.tsx` | 1357 | 259 | CRM ancien |
| Tasks | `src/pages/Tasks.tsx` | 1181 | 143 | CRM ancien |
| Pipeline | `src/pages/Pipeline.tsx` | 1125 | 111 | CRM ancien |
| OrderDetailPanel | `src/components/ecommerce/OrderDetailPanel.tsx` | 1271 | — | mixte |
| BoutiqueDashboard | `src/pages/boutique/BoutiqueDashboard.tsx` | 720 | 130 | boutique récent |
| Produits | `src/pages/boutique/Produits.tsx` | 387 | 67 | boutique récent |
| Commandes | `src/pages/boutique/Commandes.tsx` | 333 | 42 | boutique récent |

Densité `className` par 100 lignes : Leads ≈ 13,7 · LeadDetail ≈ 19,1 ·
Produits ≈ 17,3 · Commandes ≈ 12,6. **La densité brute n'est PAS le vrai
signal** (le nombre dépend du contenu métier). Le signal réel est le
**pattern d'en-tête de page** ci-dessous.

### 1.2 Divergence centrale : en-tête de page (PageHero vs header manuel)

C'est l'écart de convergence #1, mesurable et net :

| Pattern | Pages | Exemple (chemin:ligne) |
|---|---|---|
| **`<PageHero>` primitive** (récent) | **19 pages** : toute la boutique + Reports, Clients, Integrations, Properties, Invoices, Agencies, Reviews, Documents, Workflows, Templates, Trash, TriggerLinks, DocumentTemplates, AdminOverview, ChangePassword | `src/pages/boutique/Produits.tsx:124-139` |
| **`<header>` Tailwind manuel** (ancien CRM cœur) | Leads, LeadDetail, Dashboard, Tasks, Pipeline | `src/pages/Leads.tsx:652-662` |

Code Leads (ancien, ad-hoc) :
```
<header className="flex flex-wrap items-end justify-between gap-4 mb-6">
  <div>
    <h1 className="t-h1 text-[var(--text-primary)]">Leads</h1>
    <p className="t-caption text-[var(--text-muted)] mt-1">…</p>
  </div>
  <Button variant="primary" …>Nouveau lead</Button>
</header>
```
`className="t-h1 text-[var(--text-primary)]"` n'existe plus que dans
**2 fichiers** (`Leads.tsx`, `LeadDetail.tsx`) — vestige pré-PageHero.

Code Produits (récent, primitive) :
```
<PageHero meta={…} title={…} highlight={…} description={…} actions={…} />
```

**Cause** : les pages cœur CRM datent d'avant la généralisation de
`<PageHero>` (sprints 38-41), la boutique a été écrite après et adopte
directement la primitive. Aucun des deux n'est « cassé » — c'est une
dette de cohérence, pas un bug.

### 1.3 Autres écarts mineurs observés

- **Filtres** : Produits utilise `flex flex-col md:flex-row gap-3 mb-5`
  (`Produits.tsx:142`) ; Leads emballe ses filtres dans
  `<Card className="p-4 mb-4">` (`Leads.tsx:733`). Espacements `mb-4`
  vs `mb-5` non harmonisés.
- **Tables** : convergence DÉJÀ bonne — les deux cohortes utilisent
  `.table-premium-container` / `.table-premium` / `.col-frozen` /
  `.table-expand-trigger` (`Produits.tsx:215-241`, idem Leads liste).
- **Divergence doc ↔ code (à signaler)** : `AGENTS.md` §6 annonce
  `--text-display 40px / --text-h1 28px / --text-h2 22px`, mais
  `src/index.css:89-92` réel = `--text-display 32px / --text-h1 24px /
  --text-h2 20px`. Le **code fait foi** (règle CODE > mémoire). Les
  classes `.t-h1/.t-h2` reflètent l'index.css réel. Aucune action CSS
  ici — juste noter pour éviter qu'un agent « corrige » dans le mauvais
  sens.

---

## 2. Inventaire classes/tokens existants couvrant l'harmonisation (M3.2)

**Tout ce qui est nécessaire pour converger existe déjà.** Aucune
nouvelle classe requise. Recommandations d'usage (à appliquer par M2 sur
le CRM en Lot 2/3, pas par M3) :

| Objectif de convergence | Réutiliser l'EXISTANT | Référence |
|---|---|---|
| En-tête de page uniforme | Primitive **`<PageHero meta title highlight description actions>`** | `src/components/ui/` ; adoptée par 19 pages |
| Titre de page | `.t-h1` (24px/700 — index.css réel) | `src/index.css:389` |
| Sous-texte / compteurs | `.t-caption` + `text-[var(--text-muted)]` | `src/index.css:410-412` |
| Méta uppercase (kicker) | `.t-meta` (11px/700 uppercase 0.08em) | doc AGENTS.md §6 |
| Bandeau de section interne | `.section-header` (border-left 3px primary) | AGENTS.md §6 |
| Carte conteneur | `.card-premium` / `<Card variant="interactive">` | AGENTS.md §6 |
| Tableau données | `.table-premium*` / `.col-frozen` / `.table-expand-trigger` | déjà commun aux 2 cohortes |
| Rythme vertical | tokens `--space-3..6` (12/16/20/24px) — proscrire `mb-4` vs `mb-5` au hasard | `src/index.css:99-102` |
| Rayons | `--radius-md` (6px) cartes / `--radius-lg` (8px) panels | `src/index.css:111-112` |
| Ombres | `--shadow-xs/sm/md` Stripe (jamais cyan-tinted) | AGENTS.md §6 |

**Recommandation prioritaire (pour M2/Lot 3, pas M3)** : migrer les
5 en-têtes `<header>` manuels (Leads, LeadDetail, Dashboard, Tasks,
Pipeline) vers `<PageHero>` — iso-rendu fonctionnel, gain de cohérence
maximal, zéro nouvelle ligne CSS. C'est une **substitution de primitive**,
pas une refonte. À cadrer comme tâche Lot 3 (touche des pages cœur
volumineuses → hors périmètre M3 + risque visuel → validation Rochdi).

---

## 3. Append index.css (M3.3)

**RIEN ajouté. Couvert intégralement par l'existant.**

Justification : la convergence repose sur (a) la primitive `<PageHero>`
déjà existante et largement adoptée, (b) les classes typo `.t-h1/.t-caption/
.t-meta`, (c) `.section-header`, (d) `.card-premium`, (e) les tokens
`--space-*/--radius-*/--shadow-*`. Aucun « gap » d'utilitaire de densité
partagée n'a été identifié qui ne soit déjà servi. Conformément au
mandat (priorité = réutiliser, pas créer du CSS), **aucune ligne n'a été
appendée** sous `/* ── S6 ── */`. `src/index.css` reste à 12686 lignes,
0 règle existante touchée.

---

## 4. Backlog Lot 3 (M3.4)

État honnête de ce qui reste pour la convergence/qualité — **différé Lot 3**
(non testé en sandbox, risqué, hors périmètre S6) :

### 4.1 Migration en-têtes CRM → `<PageHero>` (convergence #1)
Substituer les 5 `<header>` manuels (Leads `:652`, LeadDetail, Dashboard,
Tasks, Pipeline) par `<PageHero>`. Iso-rendu attendu mais touche des
pages cœur → **validation visuelle Rochdi obligatoire** avant merge.
Faible risque logique (props pure), risque visuel modéré (espacements).

### 4.2 Split pages géantes — extraction sous-composants iso-rendu
Pages à découper (lecture seule, **AUCUN refactor en S6**) :
`Leads.tsx` 1595 · `Dashboard.tsx` 1461 · `LeadDetail.tsx` 1357 ·
`OrderDetailPanel.tsx` 1271 · `Tasks.tsx` 1181 · `Pipeline.tsx` 1125.
Cadrage : extraction de sous-composants **strictement iso-rendu**
(toolbar, KPI strip, table, panneaux). Refactor non testé en sandbox →
**interdit S6, différé Lot 3** avec tests visuels + Rochdi.

### 4.3 i18n CRM restant
M2 a internationalisé ~6 pages. Restent **~34 pages** CRM avec strings
FR codées en dur (ex. `Leads.tsx:660` « Nouveau lead »,
`Leads.tsx:128` description PageHero littérale). À traiter par lots via
`src/lib/i18n/*` (territoire M2). Pattern `t('…')` déjà en place côté
boutique — réutiliser le même mécanisme.

### 4.4 Convergence design fine itérative
- Uniformiser le rythme filtres (`mb-4` Card-wrapper Leads vs `mb-5`
  flex Produits) → token `--space-5` cohérent.
- Auditer/réconcilier la divergence doc↔code des tokens typo
  (`AGENTS.md` §6 vs `index.css:89-92`) — décision : mettre AGENTS.md
  à jour pour refléter le code (32/24/20px), PAS l'inverse.
- Réduire les `text-[var(--text-primary)]` ad-hoc résiduels au profit
  des classes `.t-*`.

---

## 5. Part subjective explicitée

L'alignement esthétique final (faut-il vraiment uniformiser tous les
en-têtes ? quel espacement filtre ?) est une **décision visuelle qui
revient à Rochdi**. Ce document fournit le diagnostic factuel et le plan
d'outillage ; il n'impose pas le rendu. La validation se fait
visuellement côté Rochdi (sandbox ne build/run pas — AGENTS.md §3).

---

## 6. Préservations confirmées

- `src/index.css` : **0 règle existante modifiée/supprimée, 0 append**
  (couvert par existant). 12686 lignes inchangées.
- Classes legacy contractuelles (`.card-premium*`, `.sidebar-nav-item`,
  `.dashboard-*`, alias `--brand-*/--surface-*/--shadow-brand-*`) :
  **INTOUCHÉES**.
- Pages `.tsx` : **AUCUNE éditée** (M1 boutique / M2 CRM territoire).
- Catalogues `src/lib/i18n/*` (M2) / backend / worker / tests : **0 touch**.
- Pas de dark mode, pas de gradient brand sur surfaces, pas de refonte CSS.
