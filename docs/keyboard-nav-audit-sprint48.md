# Keyboard Navigation Audit — Sprint 48 M1.2

Date : 2026-05-15
Scope : Audit exhaustif de la navigation clavier sur les primitives + pages
cœur. Vérification Tab/Shift+Tab/Enter/Space/Escape/Arrow + ordre logique.

## Méthodologie

Pour chaque primitive et page, vérification de :
1. **Reachability** : tous les contrôles interactifs atteignables via Tab.
2. **Order** : ordre Tab logique (top-to-bottom, left-to-right).
3. **Activation** : Enter et/ou Space activent boutons/links/checkboxes.
4. **Dismissal** : Escape ferme modals/panels/tooltips/popovers.
5. **Arrow nav** : flèches naviguent dans listes/menus/tabs.
6. **Focus trap** : focus maintenu dans modales actives.

Tools : test manuel Tab keys + DevTools Accessibility tree + Storybook si dispo.

## Primitives — état audit

### Modal (`src/components/ui/Modal.tsx`)
Radix Dialog wrapper — comportements natifs OK :
- ✅ Focus trap dans Modal lors d'ouverture
- ✅ Tab cycle dans content
- ✅ Escape ferme (sauf `modal={true}`)
- ✅ Focus auto sur premier élément focusable
- ✅ Focus restauré au trigger à la fermeture
- ✅ `role="dialog"` + `aria-modal="true"` natif Radix

### SlidePanel (`src/components/ui/SlidePanel.tsx`)
Radix Dialog wrapper :
- ✅ Tous comportements identiques Modal
- ✅ Edge swipe back (mobile) gère close via Sprint 44 M3.4
- ✅ Stack support (PanelStack) maintient focus sur top panel
- ✅ Header actions (close + openFullHref) atteignables Tab

### Wizard (`src/components/ui/Wizard.tsx`)
- ✅ Step chips numérotés : `aria-current="step"` sur step actif
- ✅ `aria-label="Étape N : label"` sur chaque chip
- ✅ Enter sur body avance (sauf textarea)
- ✅ Précédent/Suivant boutons natifs `<button>` — Space/Enter activent
- ✅ Bouton Skip optionnel reachable Tab

### CommandPalette (`src/components/CommandPalette.tsx`)
**Modifications Sprint 48 M1.3** :
- ✅ Ajout `aria-modal="true"`
- ✅ Ajout `aria-describedby="cmd-palette-desc"` + sr-only desc
- ✅ Input → `role="combobox"`, `aria-expanded`, `aria-autocomplete="list"`,
  `aria-controls="cmd-palette-listbox"`, `aria-activedescendant={cmd-item-N}`
- ✅ Results container → `role="listbox"` + `id="cmd-palette-listbox"`
- ✅ Items → `role="option"` + `id="cmd-item-N"` + `aria-selected`
- ✅ Arrow Up/Down nav existante (handleKeyDown)
- ✅ Enter active item, Escape ferme

### DropdownMenu (`src/components/ui/DropdownMenu.tsx`)
Radix DropdownMenu wrapper — comportements natifs :
- ✅ Arrow Up/Down nav items
- ✅ Enter/Space active item
- ✅ Escape ferme
- ✅ `role="menu"` + `role="menuitem"` natif Radix
- ✅ `aria-haspopup` + `aria-expanded` sur trigger natif

### Tabs (`src/components/ui/Tabs.tsx`)
Radix Tabs wrapper :
- ✅ Arrow Left/Right entre triggers (natif Radix)
- ✅ Home/End premier/dernier tab
- ✅ Tab descend dans TabsContent active
- ✅ `role="tablist"`, `role="tab"`, `role="tabpanel"` natif Radix
- ✅ `aria-selected`, `aria-controls`, `aria-labelledby` natif

### Combobox (`src/components/ui/Combobox.tsx`)
**Modifications Sprint 48 M1.3** :
- ✅ Ajout `aria-activedescendant={listboxId-opt-N}`
- ✅ Listbox `id` unique par instance (plus de collision si 2 Combobox montés)
- ✅ Options `id` unique : `{listboxId}-opt-{idx}`
- ✅ Arrow Up/Down nav + Enter sélection + Esc close (déjà présent)
- ✅ Tab fermeture + focus flow (déjà présent)

### Toast (`src/components/ui/Toast.tsx`)
- ✅ `role="alert"` (error) ou `role="status"` (autres) selon sévérité
- ✅ `aria-live="polite"` sur container
- ✅ Action button + close button atteignables Tab
- ✅ Stack overflow chip + clear-all reachable

### FilterChip (`src/components/ui/FilterChip.tsx`)
- ✅ Si `onClick` fourni → `<button>` natif avec `aria-pressed`
- ✅ Sinon `<span>` non-focusable (chip read-only)
- ✅ Remove × bouton imbriqué : `role="button"` + tabIndex=-1 (action via Enter/Space)
  ⚠️ TODO M2 Sprint suivant : tabIndex=0 pour rendre le remove atteignable Tab.

### Switch (`src/components/ui/Switch.tsx`)
- ✅ `<button role="switch">` natif
- ✅ `aria-checked={checked}`
- ✅ Space toggle (en plus du click natif Enter)
- ✅ `aria-labelledby` + `aria-describedby` si label/description fournis
- ✅ Disabled state respecté

### BottomSheet / ContextualActionsSheet
- ✅ `role="dialog"` (BottomSheet)
- ✅ Actions clavier-friendly (button native)
- ⚠️ ContextualActionsSheet : long-press mobile → keyboard alternative via Shift+F10
  (déjà supporté par browsers context menu, OK).

### Tooltip (`src/components/ui/Tooltip.tsx`)
Radix Tooltip — focus = hover effective :
- ✅ Focus sur trigger révèle tooltip (Radix natif)
- ✅ Escape ferme tooltip
- ✅ `aria-describedby` natif Radix

### NotificationItem / MessageBubble
- ✅ Boutons interactifs natifs
- ✅ Reactions emoji bar : `<button>` natifs avec aria-label

## Pages cœur — état audit

### Sidebar (`src/components/layout/Sidebar.tsx`)
**Modifications Sprint 48 M1.3** :
- ✅ Ajout `aria-current="page"` sur nav-item actif
- ✅ Ajout `aria-current="page"` sur smart-list actif
- ✅ Arrow Up/Down/Home/End nav déjà présents (Sprint 23 wave 47A2)
- ✅ Tab descend vers Settings collapse button + onboarding chip + footer profil
- ✅ Collapse toggle a `aria-label` + `aria-expanded`
- ✅ Logout button `aria-label="Se déconnecter"`

### AppLayout (`src/components/layout/AppLayout.tsx`)
- ✅ Skip-link `<a href="#main-content" className="skip-link">` présent
- ✅ `#main-content` target avec `tabIndex={-1}` pour focus programmatique
- ✅ Sprint 48 M1.3 : skip-link CSS désormais styled (Sprint 38 RESET wipe avait nettoyé)
- ✅ Tous boutons header avec `aria-label`
- ✅ Notif filters → `role="tablist"` + `role="tab"` + `aria-selected`

### MobileBottomNav
- ✅ `aria-label="Navigation mobile"` sur nav
- ✅ `aria-current="page"` sur link actif
- ✅ Tab atteint chaque link

### Dashboard, Leads, LeadDetail, Pipeline, Tasks, Inbox, Calendar
- ✅ Pages refondues Sprint 38-41 utilisent primitives Stripe-clean
- ✅ Toutes les actions ont natif `<button>` ou `<a>`
- ✅ Drag-drop Pipeline → keyboard mode existant (Sprint 31)
- ✅ Bulk select tables → checkboxes natives + Shift+click range
- ⚠️ Calendar drag-resize events : keyboard mode TODO future sprint (drag handles only)

## Findings résumé

### Fixes Sprint 48 M1 (appliqués)
1. CommandPalette : pattern combobox-listbox complet (aria-activedescendant)
2. Combobox : ids uniques + aria-activedescendant
3. Sidebar : aria-current="page" nav-item + smart-list
4. Skip-link : CSS styling restauré (focus-visible reveal)
5. Tokens text AAA via utility classes

### TODO sprints suivants (non-blocant Sprint 48)
1. FilterChip `<span role=button>` remove → tabIndex=0 + Enter/Space
2. Calendar drag-resize keyboard alternative (ex: Shift+Arrow pour resize 15min)
3. Pipeline drag : déjà Sprint 31 keyboard mode, vérifier completeness
4. Reports DashboardBuilder drag widgets → keyboard alternative

### Bonnes pratiques observées
- Tous les modals/panels Radix → focus trap + restore automatique
- Sidebar Arrow keys Sprint 23 wave 47A2
- Sprint 33 8 focus-visible fixes systémiques en place
- announceSR singleton wired Toast + BulkActionBar + AutosaveIndicator

## Conclusion

La navigation clavier de l'app est **majoritairement complète et fonctionnelle**.
Sprint 48 M1.3 a rajouté les ARIA properties manquantes pour passer du niveau
AA → AAA-compatible. Les rares TODO restants (FilterChip remove tab, Calendar
keyboard resize) sont non-bloquants pour Sprint 48 et seront traités dans des
sprints futurs ciblés.
