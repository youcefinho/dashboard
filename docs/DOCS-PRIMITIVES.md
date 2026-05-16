# DOCS-PRIMITIVES — Catalog (48 primitives)

> Référence dense des composants UI du design system Intralys.
> Source de vérité barrel : `src/components/ui/index.ts`. Source CSS : `src/index.css`.
> Conventions : light theme, opacités 12-30%+, stroke 1.75, `prefers-reduced-motion` respecté.

---

## Index alphabétique

| Primitive | Famille | Sprint |
|---|---|---|
| AiLoadingShimmer | Feedback | 34 |
| AiSparkles | Advanced | 19 |
| AnimatedNumber | Data display | 23 |
| AppBootScreen | Feedback | 34 |
| AppliedFiltersBar | Navigation | 24 |
| AutosaveIndicator | Feedback | 24 |
| Avatar | Data display | 23 |
| AvatarGroup | Data display | 23 |
| Badge | Data display | 16 |
| BottomSheet | Layout | 23 |
| BulkActionBar | Navigation | 24 |
| Button | Navigation | 16 |
| Card | Layout | 23 |
| CellHoverInfo | Data display | 30 |
| Coachmark | Navigation | 24 |
| ColorSwatch | Form | 23 |
| Combobox | Form | 24 |
| ConfirmDialog | Advanced | 16 |
| DateRangePicker | Advanced | 23 |
| DropdownMenu | Navigation | 23 |
| EmptyState | Feedback | 23 |
| EmptyStateIllustration | Feedback | 25 |
| FilterChip | Navigation | 24 |
| Icon | Advanced | 25 |
| Input | Form | 16 |
| KpiStrip | Layout | 23 |
| LiveRegion | Feedback | 34 |
| Modal | Layout | 23 |
| NetworkStatusBanner | Feedback | 34 |
| PageHero | Layout | 23 |
| PanelStack | Layout | 22 |
| PhoneLink | Advanced | 23 |
| PullToRefreshIndicator | Mobile | 30 |
| ScopePicker | Form | 30 |
| ScoreGauge | Data display | 23 |
| Select | Form | 16 |
| ShareButton | Mobile | 35 |
| Skeleton | Feedback | 23 |
| SlidePanel | Layout | 22 |
| SmartBanner | Feedback | 23 |
| Sparkline | Data display | 23 |
| SwipeAction | Mobile | 23 |
| Switch | Form | 23 |
| Tabs | Layout | 16 |
| Tag | Data display | 23 |
| Textarea | Form | 16 |
| Toast | Feedback | 23 |
| Tooltip | Data display | 23 |
| ViewTransition | Advanced | 23 |
| Wizard | Form | 26 |

---

## Layout (8)

### PageHero
Bandeau hero signature avec orb animé + gradient + meta/title/description/actions.
```ts
<PageHero meta="Workspace" title="Tâches" description="..." actions={<Button .../>} compact?: boolean />
```
Sprint d'origine : 23

### Card
Surface container premium (surface-1 + shadow-brand-xs). Variant `interactive` lift -2px + ring focus brand.
```ts
<Card variant?="default"|"interactive" {...HTMLAttributes<HTMLDivElement>} />
```
Sprint d'origine : 23

### KpiStrip
Rangée de mini-KPIs contextuels (label + valeur gradient brand + trend optionnel).
```ts
type KpiItem = { label: string; value: ReactNode; trend?: { delta: number; period?: string } };
<KpiStrip items={KpiItem[]} className?: string />
```
Sprint d'origine : 23

### Modal
Radix Dialog premium. Backdrop gradient cyan→navy blur 12px, scale-in bounce, scrollable.
```ts
<Modal open onOpenChange title size?="sm"|"md"|"lg"|"xl">{children}</Modal>
```
Sprint d'origine : 23

### SlidePanel
Panneau latéral droit (Radix Dialog + slide). Différenciateur vs GHL : pas de full-page nav. Stack max 3 via PanelStack.
```ts
type SlidePanelSize = 'sm' | 'md' | 'lg' | 'xl';
<SlidePanel open onOpenChange title size?>{children}</SlidePanel>
```
Sprint d'origine : 22

### BottomSheet
Mobile-first iOS-style sheet (Radix Dialog). Drag-to-dismiss, animation 320ms cubic-bezier iOS.
```ts
<BottomSheet open onOpenChange title size?="auto"|"sm"|"md"|"lg"|"full" showHandle?>{children}</BottomSheet>
```
Sprint d'origine : 23

### Tabs
Radix tabs underline style brandé.
```ts
<Tabs value onValueChange>
  <TabsList><TabsTrigger value="x">X</TabsTrigger></TabsList>
  <TabsContent value="x">...</TabsContent>
</Tabs>
```
Sprint d'origine : 16

### PanelStack
Provider gérant l'empilement de slide-over panels (max 3) + sync URL (`?panel=lead:id,task:id`).
```ts
type PanelDescriptor = { type: string; id: string };
<PanelStackProvider renderers={{ lead: LeadPanel, task: TaskPanel }}>...</PanelStackProvider>
const { openPanel, closePanel, panels } = usePanelStack();
```
Sprint d'origine : 22

---

## Form (8)

### Input
Text/search/number premium. Slots prefix/suffix, label, helper/error/success, shake on error.
```ts
<Input label? leftSlot? rightSlot? helper? error? success? {...InputHTMLAttributes} />
```
Sprint d'origine : 16 (refonte 23 + 26)

### Textarea
Multi-line aligné Input. Counter optionnel (gradient brand à >=90% limite).
```ts
<Textarea label? helper? error? success? maxLength? showCounter? {...TextareaHTMLAttributes} />
```
Sprint d'origine : 16 (refonte 23 + 26)

### Select
Wrapper natif `<select>` premium. Chevron natif géré, props additifs label/helper/error/success.
```ts
<Select label? helper? error? success? {...SelectHTMLAttributes}><option /></Select>
```
Sprint d'origine : 16 (refonte 23 + 26)

### Switch
Toggle iOS-style gradient brand. Pattern `<button role="switch">` keyboard-accessible.
```ts
<Switch checked onCheckedChange label? variant?="brand"|"accent"|"success" size?="sm"|"md" disabled? />
```
Sprint d'origine : 23

### ColorSwatch
Color picker chip avec preview + presets. `<input type="color">` natif hidden + trigger chip-btn.
```ts
<ColorSwatch value={hex} onChange={hex => ...} presets?: string[] label? />
```
Sprint d'origine : 23

### Combobox
Autocomplete primitive. Fuzzy match substring highlight gradient brand, keyboard nav, groups.
```ts
type ComboboxOption = { value: string; label: string; description?: string; icon?: ReactNode };
<Combobox options value onChange placeholder? groupBy? loading? />
```
Sprint d'origine : 24

### ScopePicker
Multi-select chips groupés par catégorie pour scopes API + events webhook.
```ts
type ScopePickerMode = 'scope' | 'event';
<ScopePicker mode value={string[]} onChange={(v: string[]) => void} />
```
Sprint d'origine : 30

### Wizard
Multi-step Modal primitive (TeamSettings invite, BrandingSettings setup, etc.). Step chips numérotés gradient + connectors.
```ts
type WizardStep = { id: string; label: string; content: ReactNode; isValid?: boolean; isOptional?: boolean };
<Wizard steps currentIndex onStepChange onComplete onCancel? persistKey? title open onOpenChange />
```
Sprint d'origine : 26

---

## Feedback (10)

### Toast
Système toast (success/error/warning/info) avec queue par sévérité, son + haptic, SR announce.
```ts
const { toast } = useToast();
toast({ type: 'success', title: '...', description?, duration? });
<ToastProvider>{app}</ToastProvider>
```
Sprint d'origine : 23 (queue 34)

### Skeleton
Shimmer wave loader cyan branded.
```ts
<Skeleton className? style? /> // utiliser className pour width/height
```
Sprint d'origine : 23

### EmptyState
Placeholder encourageant : 2 orbs animés cyan+orange, chip icon gradient + halo pulse, tips numérotés.
```ts
<EmptyState icon? title description? action? tips?: string[] />
```
Sprint d'origine : 23

### EmptyStateIllustration
6 SVG inline brandés (leads/tasks/pipeline/inbox/calendar/reports). Gradient cyan→orange.
```ts
<EmptyStateIllustration kind="leads"|"tasks"|"pipeline"|"inbox"|"calendar"|"reports" size?=140 />
```
Sprint d'origine : 25

### NetworkStatusBanner
Banner sous AppLayout, slide-down offline (orange→rouge) + "Connexion rétablie" 3s auto-dismiss.
```ts
<NetworkStatusBanner />  // self-contained, écoute navigator.onLine
```
Sprint d'origine : 34

### AutosaveIndicator
Pilule autosave (idle/dirty/saving/saved/error). Decay vers idle après 5s.
```ts
type AutosaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
<AutosaveIndicator state lastSaved? onRetry? />
```
Sprint d'origine : 24

### SmartBanner
Bandeau AI tip horizontal (variants tip/success/warning/ai). Dismissable persistant via localStorage.
```ts
<SmartBanner variant?="tip"|"success"|"warning"|"ai" title description? action? dismissKey? />
```
Sprint d'origine : 23

### AppBootScreen
Loading screen initial (2 orbs, logo gradient halo pulse, tagline).
```ts
<AppBootScreen tagline?="Chargement..." subtitle? />
```
Sprint d'origine : 34

### AiLoadingShimmer
Inline AI loading 3 dots pulsant gradient brand staggered.
```ts
<AiLoadingShimmer label?="AI réfléchit..." size?="sm"|"md" />
```
Sprint d'origine : 34

### LiveRegion
SR-only announce (`role="status"` polite / `"alert"` assertive). Reset après `clearAfter` ms.
```ts
<LiveRegion message politeness?="polite"|"assertive" clearAfter?: number />
// Global : announceSR(message) + <LiveRegionPortal /> dans AppLayout
```
Sprint d'origine : 34

---

## Navigation (6)

### Button
5 variants × 3 sizes. Ripple Material DOM, celebrate confettiBurst, sound micro-feedback.
```ts
<Button variant?="primary"|"premium"|"secondary"|"ghost"|"danger" size?="sm"|"md"|"lg"
  leftIcon? rightIcon? loading? ripple? celebrate? sound?: SoundName | boolean />
```
Sprint d'origine : 16 (premium 23/24/25)

### DropdownMenu
Radix dropdown wrapper. Glassmorphism + gradient sweep hover + accent brand item actif.
```ts
<DropdownMenu trigger={<Button>...</Button>}>
  <DropdownMenuItem variant?="default"|"brand"|"danger" onSelect>...</DropdownMenuItem>
  <DropdownMenuSeparator />
</DropdownMenu>
```
Sprint d'origine : 23

### FilterChip
Chip filtre premium dismissable. Layout `[icon?][label][:value?][× remove?]`.
```ts
<FilterChip label icon? value? variant?="active"|"available" onRemove? onClick? />
```
Sprint d'origine : 24

### AppliedFiltersBar
Wrapper scroll-x mobile pour chips actifs. Bouton "Tout effacer" si ≥2 filtres.
```ts
type FilterDescriptor = { id: string; label: string; value?: string; icon?: ReactNode };
<AppliedFiltersBar filters onRemove onClearAll />
```
Sprint d'origine : 24

### BulkActionBar
Sticky bar multi-sélection. Compteur gradient brand, actions à droite, slide-in 280ms, SR announce.
```ts
type BulkAction = { id: string; label: string; icon?: ReactNode; variant?: BulkActionVariant; onClick };
<BulkActionBar selectedCount actions onClear />
```
Sprint d'origine : 24

### Coachmark
Spotlight overlay tour onboarding. Masque cut-out radial + tooltip card. Nav ←→/Esc/Enter.
```ts
type CoachmarkStep = { target: string | RefObject; title; description; placement?: 'top'|'right'|'bottom'|'left' };
<Coachmark steps open onClose onComplete />
```
Sprint d'origine : 24

---

## Data display (9)

### Tag
Chip coloré unifié (statuts, catégories). Variants sémantiques ou couleur custom.
```ts
<Tag variant?="brand"|"success"|"warning"|"danger"|"info"|"neutral"|"accent" size?="xs"|"sm"|"md" color?: string>label</Tag>
```
Sprint d'origine : 23

### Badge
6 intents × 3 fill modes (soft/solid/outline). Numéros / labels compacts.
```ts
<Badge intent?="brand"|"success"|"warning"|"danger"|"info"|"neutral" fill?="soft"|"solid"|"outline" size?="sm"|"md" color? />
```
Sprint d'origine : 16

### Avatar
Initiales + couleur dynamique + image fallback. Status dots, ring hot/active, onClick, animate.
```ts
<Avatar name image? size?="xs"|"sm"|"md"|"lg"|"xl" status?: AvatarStatus ring?: AvatarRing onClick? tooltip? />
```
Sprint d'origine : 23

### AvatarGroup
Stack horizontal avec overlap + cascade translateX au hover.
```ts
type AvatarGroupItem = { id; name; image?; status? };
<AvatarGroup items max?: number size? />
```
Sprint d'origine : 23

### Sparkline
Mini SVG chart. Gradient stroke cyan→orange, area multi-stops, dot terminal glowing, path draw animation.
```ts
<Sparkline values={number[]} width?=120 height?=32 showMarkers? color?: ColorStops />
```
Sprint d'origine : 23

### AnimatedNumber
Count-up branded. Extrait nombre d'une string ("1,247" / "12.5K $"), anime 0→N, reformatte.
```ts
<AnimatedNumber value={number | string} duration?=1200 format?: (n: number) => string />
```
Sprint d'origine : 23

### ScoreGauge
Demi-cercle SVG 0-100. Gradient brand, couleur dynamique (rouge<40<orange<70<vert).
```ts
<ScoreGauge score size?=80 showLabel? />
```
Sprint d'origine : 23

### Tooltip
Radix tooltip riche. content / title+description / icon+shortcut. 5 variants visuels.
```ts
<Tooltip content? title? description? icon? shortcut? variant?="default"|"brand"|"danger"|"success"|"info" shouldRender?>
  {trigger}
</Tooltip>
```
Sprint d'origine : 23

### CellHoverInfo
Tooltip riche cells de tables Reports. Delay 280ms, glass bg, brand shadow, max-w 220px. Sparkline + trend % optionnels.
```ts
<CellHoverInfo title description? breakdown?: CellHoverInfoBreakdownItem[] trend?: CellHoverInfoTrend tone? sparkline? />
```
Sprint d'origine : 30

---

## Mobile (3)

### SwipeAction
Swipe horizontal sur row mobile. Background gradient progressive, spring snap, haptic medium au seuil.
```ts
<SwipeAction rightActions? leftActions? rightThreshold? leftThreshold?>{row}</SwipeAction>
```
Sprint d'origine : 23

### PullToRefreshIndicator
Indicator visuel pour `usePullToRefresh` (réutilisable hors hook).
```ts
<PullToRefreshIndicator distance progress isRefreshing label?: string size? />
```
Sprint d'origine : 30

### ShareButton
Click-to-share natif (Web Share API + clipboard fallback). Mobile = sheet OS natif, desktop = copy + toast.
```ts
<ShareButton url? title? text? variant?="ghost"|"chip" onShared?: () => void />
```
Sprint d'origine : 35

---

## Advanced (6)

### AiSparkles
Bouton flottant inline (textarea) → menu Popover 4 actions AI (améliorer/raccourcir/formel/amical) + undo 5s.
```ts
<AiSparkles value onChange leadId? clientId? undoMs?=5000 className? disabled? />
```
Sprint d'origine : 19

### DateRangePicker
Sélecteur date avec presets (today/yesterday/this_week/this_month/last_30/custom). Glass + orb décoratif.
```ts
type DateRange = { from: Date | null; to: Date | null };
<DateRangePicker value onChange={(r: DateRange) => void} className? />
```
Sprint d'origine : 23

### PhoneLink
Click-to-call natif Capacitor. Chip gradient brand + icon pastille + glow hover + ripple.
```ts
<PhoneLink phone label? variant?="chip"|"link" size? />
```
Sprint d'origine : 23

### ConfirmDialog
Remplace `confirm()` / `prompt()` natif. API Promise. RequireText pour irréversibles (Loi 25 forget).
```ts
const confirm = useConfirm();
await confirm({ title, description?, danger?, requireText?: string });
const prompt = usePrompt();
await prompt({ title, placeholder? });
<ConfirmProvider>{app}</ConfirmProvider>
```
Sprint d'origine : 16

### ViewTransition
Active View Transitions API native (Chrome 111+, Safari 18+). Fallback CSS fade silencieux.
```ts
<ViewTransition>{<Outlet />}</ViewTransition>
// Categorical par data-route-category (workspace/inbox/settings/builder)
```
Sprint d'origine : 23

### Icon
Wrapper Lucide stroke 1.75 (signature Linear/Superhuman). Sizes normalisées xs/sm/md/lg/xl. Force stroke 2 si <14px.
```ts
type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
<Icon as={LucideIcon} size?="md" className? strokeWidth? />
```
Sprint d'origine : 25
