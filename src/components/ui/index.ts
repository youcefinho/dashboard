// ── UI Components — barrel export ────────────────────────────
// Sprint 16 — Migration complète vers le nouveau design system
// Plus aucun shim legacy — tous les composants sont directs

// ── Composants primitifs ────────────────────────────────────
export { Modal } from './Modal';

export { Input } from './Input';
export type { InputProps } from './Input';

export { Select } from './Select';
export type { SelectProps } from './Select';

export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

export { Button } from './Button';
export type { ButtonProps } from './Button';

export { Card } from './Card';
export type { CardProps } from './Card';

export { Badge } from './Badge';
export type { BadgeProps } from './Badge';

export { Tag } from './Tag';

export { Skeleton } from './Skeleton';

export { EmptyState } from './EmptyState';
// Sprint 45 M2.3 — Extension variants `first-time` + `filtered`
export type { EmptyStateVariant } from './EmptyState';

export { Avatar } from './Avatar';
export type { AvatarSize, AvatarStatus, AvatarRing } from './Avatar';
export { AvatarGroup } from './AvatarGroup';
export type { AvatarGroupItem } from './AvatarGroup';

export { Sparkline } from './Sparkline';

export { Tooltip } from './Tooltip';

export { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';

export {
  DropdownMenu,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from './DropdownMenu';

export { SlidePanel } from './SlidePanel';
export type { SlidePanelSize } from './SlidePanel';

export { PanelStackProvider, usePanelStack } from './PanelStack';
export type { PanelDescriptor } from './PanelStack';

export { ViewTransition } from './ViewTransition';

export { AiSparkles } from './AiSparkles';

export { PageHero } from './PageHero';

export { KpiStrip } from './KpiStrip';
export type { KpiItem } from './KpiStrip';

export { SmartBanner } from './SmartBanner';

export { AnimatedNumber } from './AnimatedNumber';

export { ScoreGauge } from './ScoreGauge';

// ── Sprint 23 wave 30 — Switch + ColorSwatch primitives ─────
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';

// ── Sprint 23 wave 43B — BottomSheet primitive ──────────────
export { BottomSheet } from './BottomSheet';
export type { BottomSheetProps } from './BottomSheet';

export { ColorSwatch } from './ColorSwatch';
export type { ColorSwatchProps } from './ColorSwatch';

// ── Utilitaires ─────────────────────────────────────────────
export { ToastProvider, useToast } from './Toast';
export { ConfirmProvider, useConfirm, usePrompt } from './ConfirmDialog';
export * from './DateRangePicker';

// ── Sprint 24 vague 1 — BulkActionBar ───────────────────────
export { BulkActionBar } from './BulkActionBar';
export type { BulkAction, BulkActionVariant } from './BulkActionBar';

// ── Sprint 24 vague 2 — FilterChip + AppliedFiltersBar ──────
export { FilterChip } from './FilterChip';
export type { FilterChipProps } from './FilterChip';
export { AppliedFiltersBar } from './AppliedFiltersBar';
export type { FilterDescriptor } from './AppliedFiltersBar';

// ── Sprint 24 vague 6A — AutosaveIndicator (M3) ─────────────
export { AutosaveIndicator } from './AutosaveIndicator';
export type { AutosaveState } from './AutosaveIndicator';

// ── Sprint 24 vague 5B — Coachmark (spotlight tour primitive — M3) ─
export { Coachmark } from './Coachmark';
export type { CoachmarkStep } from './Coachmark';

// ── Sprint 24 vague 4B — Combobox autocomplete primitive ────
export { Combobox } from './Combobox';
export type { ComboboxOption, ComboboxProps } from './Combobox';

// ── Sprint 25 vague 3A — Icon primitive (stroke 1.75 + sizes normalisées) ──
export { Icon, iconSizePx } from './Icon';
export type { IconSize, IconProps } from './Icon';

// ── Sprint 25 vague 4A — Sensorial types (sound + haptic) ────
// Re-export pour permettre `import { SoundName } from '@/components/ui'`
// même si la lib vit dans @/lib/sensorial. Source de vérité = sensorial.ts.
export type { SoundName, HapticIntensity } from '@/lib/sensorial';

// ── Sprint 25 vague 5B — EmptyStateIllustration (6 inline SVG kinds) ─
// Sprint 45 M2.1 — Refonte Stripe-clean + 2 nouveaux kinds (onboarding/celebration)
// + alias canonique `<Illustration name=... />`
export { EmptyStateIllustration, Illustration } from './EmptyStateIllustration';
export type { IllustrationProps } from './EmptyStateIllustration';

// ── Sprint 26 vague 26-3A — Wizard primitive ──
export { Wizard } from './Wizard';
export type { WizardStep } from './Wizard';

// ── Sprint 30 vague 30-1A — CellHoverInfo primitive ──
export { CellHoverInfo } from './CellHoverInfo';
export type {
  CellHoverInfoProps,
  CellHoverInfoBreakdownItem,
  CellHoverInfoTrend,
  CellHoverInfoTone,
} from './CellHoverInfo';

// ── Sprint 30 vague 30-2B — ScopePicker primitive (multi-select chips catégorisé) ──
export { ScopePicker, API_SCOPES, WEBHOOK_EVENTS } from './ScopePicker';
export type { ScopePickerMode, ScopePickerProps, ScopeOption, ScopeCategory } from './ScopePicker';

// ── Sprint 30 vague 30-3C — PullToRefreshIndicator primitive ──
export { PullToRefreshIndicator } from './PullToRefreshIndicator';
export type { PullToRefreshIndicatorProps } from './PullToRefreshIndicator';

// ── Sprint 34 vague 34-2A — NetworkStatusBanner ──
export { NetworkStatusBanner } from './NetworkStatusBanner';

// ── Sprint 34 vague 34-3A — Loading screens (AppBoot + AI shimmer) ──
export { AppBootScreen } from './AppBootScreen';
export { AiLoadingShimmer } from './AiLoadingShimmer';

// ── Sprint 34 vague 34-3B — A11y live region (screen reader announce) ──
export { LiveRegion } from './LiveRegion';
export type { LiveRegionProps } from './LiveRegion';
export { announceSR, LiveRegionPortal } from '@/lib/announce';
export type { Politeness } from '@/lib/announce';

// ── Sprint 35 vague 35-2D — ShareButton ──
export { ShareButton } from './ShareButton';
export type { ShareButtonProps } from './ShareButton';

// ── Sprint 41 M1.1 — MessageBubble primitive Stripe ──
export { MessageBubble } from './MessageBubble';
export type {
  MessageBubbleProps,
  MessageBubbleDirection,
  MessageBubbleStatus,
  MessageBubbleAttachment,
  MessageBubbleAttachmentType,
  MessageBubbleReaction,
  MessageBubbleReplyTo,
} from './MessageBubble';

// ── Sprint 44 M3.2 — ContextualActionsSheet (long-press contextual menu) ──
export { ContextualActionsSheet } from './ContextualActionsSheet';
export type {
  ContextualAction,
  ContextualActionVariant,
  ContextualActionsSheetProps,
} from './ContextualActionsSheet';

// ── Sprint 46 M3.1 — NotificationItem primitive Stripe ──
export { NotificationItem } from './NotificationItem';
export type {
  NotificationItemProps,
  NotificationItemType,
} from './NotificationItem';

// ── LOT RÉEL (Manager B) — LoadMore pagination primitive ──
export { LoadMore } from './LoadMore';
export type { LoadMoreProps } from './LoadMore';

// ── Sprint 29 — a11y AAA — SkipToContent (pages publiques hors AppLayout) ──
export { SkipToContent } from './SkipToContent';
export type { SkipToContentProps } from './SkipToContent';
