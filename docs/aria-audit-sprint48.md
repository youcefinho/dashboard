# ARIA Audit — Sprint 48 M1.3

Date : 2026-05-15
Scope : Audit exhaustif roles + states + properties ARIA sur primitives + pages.

## Méthodologie

Pour chaque primitive et composant clé, vérification de :
1. **role** natif ou ARIA approprié
2. **states** (`aria-expanded`, `aria-selected`, `aria-checked`, `aria-pressed`,
   `aria-current`, `aria-disabled`, `aria-busy`)
3. **properties** (`aria-label`, `aria-labelledby`, `aria-describedby`,
   `aria-controls`, `aria-haspopup`, `aria-autocomplete`, `aria-activedescendant`)
4. **landmark** régions (`role="region"`, `role="main"`, `role="navigation"`,
   `role="banner"`, `role="complementary"`)
5. **live regions** (`aria-live="polite|assertive"`, `aria-atomic`)

## Primitives — état audit

### Modal (`src/components/ui/Modal.tsx`)
Wrappe Radix `Dialog` qui applique :
- ✅ `role="dialog"` natif
- ✅ `aria-modal="true"` natif (focus trap)
- ✅ `aria-labelledby` via `<DialogPrimitive.Title>` (toujours présent — title requis)
- ✅ `aria-describedby` via `<DialogPrimitive.Description>` (optionnel)
- ✅ Close button `aria-label="Fermer"`

### SlidePanel (`src/components/ui/SlidePanel.tsx`)
Identique Modal (Radix Dialog) :
- ✅ Tous attributs présents
- ✅ Close + openFullHref boutons `aria-label`
- ✅ Stack levels gérés via `onInteractOutside` (préviens vol focus)

### Wizard (`src/components/ui/Wizard.tsx`)
- ✅ `<ol aria-label="Progression">` pour stepper
- ✅ Step chip `aria-current="step"` sur actif
- ✅ Step chip `aria-label="Étape N : label"`
- ✅ Embedded mode : `<section role="region" aria-label={title}>`
- ✅ Modal mode hérite ARIA Modal

### CommandPalette (`src/components/CommandPalette.tsx`)
**Modifications Sprint 48 M1.3** :
- ✅ `role="dialog"` (déjà présent)
- ✅ AJOUT `aria-modal="true"`
- ✅ AJOUT `aria-describedby="cmd-palette-desc"` + sr-only description nav
- ✅ Input : AJOUT `role="combobox"`, `aria-expanded`, `aria-autocomplete="list"`,
  `aria-controls="cmd-palette-listbox"`, `aria-activedescendant`
- ✅ Results : AJOUT `id="cmd-palette-listbox"`, `role="listbox"`, `aria-label`
- ✅ Items : AJOUT `id="cmd-item-N"`, `role="option"`, `aria-selected` (déjà partiel)

### DropdownMenu (`src/components/ui/DropdownMenu.tsx`)
Radix DropdownMenu — natif :
- ✅ `role="menu"` (Content)
- ✅ `role="menuitem"` (Item)
- ✅ `role="menuitemcheckbox"` (CheckboxItem) + `aria-checked`
- ✅ `role="menuitemradio"` (RadioItem) + `aria-checked`
- ✅ `aria-haspopup="menu"` + `aria-expanded` sur Trigger
- ✅ Label : `role="presentation"`
- ✅ Separator : `role="separator"`

### Tabs (`src/components/ui/Tabs.tsx`)
Radix Tabs — natif :
- ✅ TabsList : `role="tablist"`
- ✅ TabsTrigger : `role="tab"`, `aria-selected`, `aria-controls`
- ✅ TabsContent : `role="tabpanel"`, `aria-labelledby`

### Combobox (`src/components/ui/Combobox.tsx`)
**Modifications Sprint 48 M1.3** :
- ✅ Input : `role="combobox"` (déjà), `aria-expanded` (déjà), `aria-autocomplete="list"` (déjà)
- ✅ AJOUT `aria-controls={listboxId}` unique (était hardcoded "combobox-listbox")
- ✅ AJOUT `aria-activedescendant={activeOptionId}` pointe vers option highlighted
- ✅ Listbox : `id={listboxId}` unique par instance + `role="listbox"` (déjà)
- ✅ Options : AJOUT `id={listboxId-opt-N}` unique + `role="option"` (déjà) + `aria-selected` (déjà)

### Toast (`src/components/ui/Toast.tsx`)
- ✅ Container : `role="region"` + `aria-label="Notifications"` + `aria-live="polite"`
- ✅ Item : `role="alert"` (error) ou `role="status"` (autres) selon sévérité
- ✅ Overflow panel : `role="list"` + `aria-label`
- ✅ Overflow items : `role="listitem"`
- ✅ Stack chip : `aria-expanded` + `aria-label`
- ✅ Wired `announceSR` (Sprint 34) pour SR

### Tooltip (`src/components/ui/Tooltip.tsx`)
Radix Tooltip — natif :
- ✅ `role="tooltip"` natif
- ✅ `aria-describedby` natif sur trigger
- ✅ Shouldn't trap focus (informational only)

### Switch (`src/components/ui/Switch.tsx`)
- ✅ `<button role="switch">` natif
- ✅ `aria-checked`
- ✅ `aria-disabled`
- ✅ `aria-labelledby` + `aria-describedby` si label/desc
- ✅ `data-state` pour CSS

### FilterChip (`src/components/ui/FilterChip.tsx`)
- ✅ `<button>` natif si onClick
- ✅ `aria-pressed` (toggle state) si onClick
- ✅ `aria-label` custom ou auto-construit
- ✅ Remove × : `role="button"` (inner span) + `aria-label="Retirer le filtre {label}"`

### LiveRegion (`src/components/ui/LiveRegion.tsx`) + announce.tsx
- ✅ `role="status"` (polite) ou `role="alert"` (assertive)
- ✅ `aria-live="polite"` ou `"assertive"`
- ✅ `aria-atomic="true"` (annonce le full content)
- ✅ Dedup window 500ms pour éviter spam
- ✅ Wired Toast, BulkActionBar, AutosaveIndicator

### Coachmark / Tour / Onboarding
- ✅ Coachmark wrapper utilise Modal/Dialog Radix
- ✅ Bottom sheet : `role="dialog"`
- ✅ ProgressChip onboarding : `aria-label` + `aria-valuenow/min/max`

### NotificationItem / MessageBubble
- ✅ `<article>` semantic
- ✅ Boutons actions : `<button>` natif + `aria-label`

### BottomSheet
- ✅ `role="dialog"` + `aria-modal`
- ✅ Drag handle `aria-label="Fermer la feuille"`

### ContextualActionsSheet
- ✅ `role="menu"` + `aria-label`
- ✅ Items `role="menuitem"`

## Pages cœur — état audit

### Sidebar (`src/components/layout/Sidebar.tsx`)
**Modifications Sprint 48 M1.3** :
- ✅ `<aside>` semantic
- ✅ `<nav aria-label="Navigation principale">` (déjà)
- ✅ AJOUT `aria-current="page"` sur nav-item actif
- ✅ AJOUT `aria-current="page"` sur smart-list actif
- ✅ Section headers : `<span>` (titre visuel, pas heading car visuelle)
- ✅ Collapse button : `aria-label` + `aria-expanded`
- ✅ Logout : `aria-label="Se déconnecter"`

### AppLayout (`src/components/layout/AppLayout.tsx`)
- ✅ `<header>` semantic (= role banner natif)
- ✅ `<main>` avec `id="main-content"` + `tabIndex={-1}` (skip-link target)
- ✅ Skip-link `<a href="#main-content">` — Sprint 48 M1.3 ajoute CSS styling
- ✅ Notif filters : `role="tablist"` + `role="tab"` + `aria-selected`
- ✅ Notif badge : aria-label avec count si > 0
- ✅ Search trigger : sober `<button>` (Cmd+K)
- ✅ Theme/density toggles : `aria-label`

### MobileBottomNav
- ✅ `<nav aria-label="Navigation mobile">`
- ✅ Links : `aria-current="page"` sur actif

### Inbox / Calendar / Pipeline / Tasks / Leads
- ✅ Pages refondues utilisent les primitives ci-dessus (ARIA propagé)
- ✅ Tables : `<table>` semantic (Sprint 27-32 premium tables)
- ✅ Pipeline cards : `<article>` + `aria-grabbed` lors du drag
- ✅ Calendar events : `<button>` + `aria-label` complet (date + heure + titre)

### Dashboard
- ✅ Hero `<h1>`
- ✅ KPI cards : `<article>` semantic + headings hiérarchiques
- ✅ Charts : `<figure>` + `<figcaption>` SR fallback texte
- ✅ AI Insight cards : `role="status"` (information dynamique)

## Live regions (announce.tsx)

Singleton wired aux endroits clés :
- ✅ Toast onMount (polite/assertive selon type)
- ✅ BulkActionBar onSelectionChange (polite)
- ✅ AutosaveIndicator on save state change (polite)
- ✅ NetworkStatusBanner online/offline transitions (assertive offline, polite online)
- ✅ Notifications WS realtime (polite)
- TODO M1.4 : étendre aux features Sprint 44-47 (push, offline, splash, onboarding)

## Findings résumé

### Fixes Sprint 48 M1.3 (appliqués)
1. **CommandPalette** : pattern combobox-listbox W3C-compliant complet
2. **Combobox** : `aria-activedescendant` + ids uniques (évite collisions)
3. **Sidebar** : `aria-current="page"` sur nav-items actifs
4. **AppLayout** : skip-link CSS styling restauré (focus reveal)
5. **CSS** : `.sr-only-aaa` fallback, `.skip-link`, `.focus-aaa`,
   forced-colors media query

### Patterns ARIA solides déjà en place (audit valide)
- Radix primitives (Dialog/DropdownMenu/Tabs/Tooltip) ARIA-natif AA+
- announceSR singleton wired aux primitives critiques
- LiveRegionPortal mounté dans AppLayout root
- Bulk actions / Toast / Modal tous semantically labeled

### TODO sprints suivants (non-blocant Sprint 48)
- Charts : `<figcaption>` détaillé (équivalent texte des data)
- Calendar events : `aria-grabbed` pendant drag
- Reports DashboardBuilder : `role="grid"` + cellules `role="gridcell"`
- Maps Mapbox Properties : `aria-label` des markers

## Conclusion

L'app Intralys a une **base ARIA solide** héritée de Radix primitives +
Sprint 32/33/34 a11y work + Sprint 48 M1 patches. Les 5 fixes ARIA Sprint 48
M1.3 ferment les derniers gaps majeurs (combobox-listbox pattern,
aria-current="page", skip-link styling). Niveau ARIA cohérent AAA-compatible.
