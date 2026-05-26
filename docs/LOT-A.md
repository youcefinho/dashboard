# LOT A — Design system & cohérence visuelle (GIGA-PLAN-V2)

> Phase A SOLO (Manager A). Document autoportant. §6 ci-dessous = CONTRATS
> FIGÉS, copiables verbatim par les Managers B et C en Phase B.

## Résumé exécution Phase A

- **Constat Chaman confirmé par CODE** : `src/components/ui/PageHero.tsx` rendait
  2 orbs décoratifs `radial-gradient(rgba(0,157,219…)/rgba(217,110,39…))` + un
  titre `text-gradient-brand` → violation directe de `index.css:9-13`
  (« Pas d'orbs décoratifs. Pas de gradient brand sur surfaces. SUBTLE. »).
- **21 pages consomment `<PageHero>`** (vérifié par grep `<PageHero`,
  23 fichiers dont le composant + 1 test à venir). Quasi tous passent
  `highlight={t('…title')}` égal au titre entier → **tout le titre** était
  rendu en gradient brand cyan/orange. Incohérence visuelle #1 « vrai produit ».
- **Découverte clé** : `index.css:2377-2388` neutralisait DÉJÀ globalement
  `.hero-stat-orb { display:none !important }`. Les 2 `<div>` orbs du JSX
  étaient donc déjà invisibles (DOM mort). Migration = retrait du JSX mort +
  suppression du gradient brand sur le titre. Strictement non-régressif.

### Fichiers modifiés / créés
- `src/components/ui/PageHero.tsx` — **modifié** : titre sobre `--text-primary`,
  orbs retirés du rendu, surface blanche subtle. **Signature props INCHANGÉE.**
- `src/index.css` — **APPEND uniquement** (fin de fichier) : classe
  `.page-hero--sober` (override sobre + garde-fou anti-gradient sur `h1`).
  AUCUNE classe legacy supprimée/renommée.
- `src/components/ui/EmptyState.tsx` — **non modifié** (déjà robuste, cf §6.b).
- `docs/LOT-A.md` — **créé** (ce document).
- `src/components/ui/__tests__/PageHero-lotA.test.tsx` — **créé** (non exécuté, VM).
- `src/components/ui/__tests__/EmptyState-lotA.test.tsx` — **créé** (non exécuté, VM).
- `src/components/ui/index.ts` — **non modifié** (aucune signature changée).

### Diff conceptuel PageHero (avant → après)
| Aspect | Avant | Après |
|---|---|---|
| Titre | `<span class="text-gradient-brand">` (cyan/orange) | `text-[var(--text-primary)]` sobre |
| `highlight` prop | colorise un mot en gradient brand | conservée, no-op visuel (back-compat) |
| Orbs | 2 `<div class="hero-stat-orb">` radial-gradient | retirés du DOM (étaient déjà `display:none`) |
| Surface | `surface-2 shadow-brand-md` | `bg-surface` + `border` + `shadow-xs` sobre |
| Props signature | `{meta?,title,highlight?,description?,actions?,compact?}` | **IDENTIQUE** |

### Preuve props inchangées — 21 appelants vérifiés (grep `<PageHero`)
`Templates, TriggerLinks, DocumentTemplates, Agencies, ChangePassword,
Integrations, Reviews, Invoices, Properties, Documents, Workflows, Reports,
Trash, Leads, Pipeline, Tasks, Clients, boutique/BoutiqueDashboard,
boutique/Commandes, boutique/Clients, boutique/Produits, admin/AdminOverview`.
Aucun ne reçoit de prop requise nouvelle ; tous continuent de compiler
(props identiques, `highlight` toujours acceptée).

---

## §6 Contrats figés

### (a) Signature EXACTE props `PageHero` — INCHANGÉE (confirmée)

```ts
interface PageHeroProps {
  meta?: string;        // étiquette uppercase optionnelle
  title: string;        // SEULE prop requise
  highlight?: string;   // @deprecated — conservé back-compat, NO-OP visuel
  description?: string;
  actions?: React.ReactNode;
  compact?: boolean;    // header court pour pages denses
}
```
Règle pour B/C : ne JAMAIS ajouter de prop requise à `PageHero`. `highlight`
reste accepté mais n'a plus d'effet visuel — ne pas le retirer des appelants
(inutile) ni s'appuyer dessus pour styliser.

### (b) Signature EXACTE props `EmptyState` + pattern canonique IMPOSÉ

```ts
type EmptyStateVariant = 'default' | 'compact' | 'first-time' | 'filtered';

interface EmptyStateProps {
  icon?: React.ReactNode;
  illustration?: React.ReactNode;  // prioritaire sur icon si fourni
  title: string;                   // SEULE prop requise
  description?: string;
  action?: React.ReactNode;
  actions?: React.ReactNode;       // alias compat, rendu après action
  meta?: string;
  tips?: string[];
  secondaryAction?: React.ReactNode;
  variant?: EmptyStateVariant;     // défaut 'default'
  className?: string;
}
```
- Le wrapper porte **toujours** `role="status" aria-live="polite"` (vérifié,
  robuste — non modifié en Phase A).
- Le slot `illustration` est rendu via `<div class="empty-state-illustration">`
  (animation float subtle), `icon` en fallback `--gray-400`.

**Pattern canonique IMPOSÉ (Phase B doit l'utiliser tel quel) :**
```tsx
<EmptyState
  illustration={<EmptyStateIllustration kind="..." />}
  title="..."
  description="..."
/>
```
(`EmptyStateIllustration` et son alias `Illustration` sont exportés depuis
`@/components/ui` — barrel `index.ts:134`.)

### (c) Liste blanche tokens consommables (index.css:19-117)

C ne remplace un hex QUE par un de ces tokens (`var(--xxx)`) :

- Gris : `--gray-50 --gray-100 --gray-200 --gray-300 --gray-400 --gray-500
  --gray-600 --gray-700 --gray-800 --gray-900`
- Primary : `--primary --primary-hover --primary-soft --primary-ring`
- Brand (signature SEULEMENT — logo/print/CTA commercial, JAMAIS surface) :
  `--brand-cyan --brand-orange --brand-gradient`
- Surfaces : `--bg-canvas --bg-surface --bg-subtle --bg-hover --bg-muted`
- Texte : `--text-primary --text-secondary --text-muted --text-link
  --text-inverse` + variantes AAA inline `--success-text --warning-text
  --danger-text --info-text`
- Bordures : `--border --border-strong`
- Statut (bg/dot/icon/badge) : `--success --success-soft --warning
  --warning-soft --danger --danger-soft --info --info-soft`
- Typo : `--font-sans --font-mono --text-display --text-h1 --text-h2
  --text-h3 --text-body --text-caption`
- Spacing : `--space-1 … --space-16`
- Radii : `--radius-xs --radius-sm --radius-md --radius-lg --radius-xl
  --radius-2xl --radius-pill --radius-full`
- Shadows : `--shadow-xs` (+ niveaux subtle suivants index.css:118+)

⚠️ `--brand-*` interdit sur toute surface/texte de contenu (paradigme RESET).

### (d) Classes CSS legacy à PRÉSERVER (NE PAS supprimer/renommer)

`index.css` est **APPEND-only**. Préserver au minimum :
- `.text-gradient-brand` (index.css:440) — signature print, autres consommateurs.
- `.text-gradient-success` (index.css:447).
- `.hero-stat-orb` (index.css:2378, déjà neutralisé `display:none`).
- `.page-hero-orb`, `.bg-orbs-canvas`, `.bg-noise`, `.bg-noise-strong`
  (index.css:2379-2386, neutralisés legacy).
- `.card-premium`, `.card-premium-hot`, `.card` (index.css:2468).
- `.badge-hot` (et autres `badge-*` repérées).
- `.surface-2`, `.shadow-brand-md` (classes legacy, plus utilisées par
  PageHero mais possiblement par d'autres — ne pas retirer).
- Toute classe legacy de la zone neutralisée RESET : on NEUTRALISE par
  override append, on ne SUPPRIME jamais.

### (e) Règle modification signature primitive

Toute modification de signature d'une primitive partagée
(`PageHero`, `EmptyState`, etc.) DOIT :
1. être tracée ici (§6) par **Manager A uniquement** ;
2. être répercutée dans le barrel `src/components/ui/index.ts` par A seul ;
3. n'ajouter QUE des props **optionnelles** (jamais requises) ;
4. ne JAMAIS supprimer/renommer une prop existante consommée.
B et C **consomment** ces signatures, ne les modifient pas.

---

§6 FIGÉ → Phase B peut démarrer.
