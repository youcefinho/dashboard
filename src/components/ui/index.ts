// ── UI Components — barrel export ────────────────────────────
// Sprint 16 — Migration complète vers le nouveau design system
// Plus aucun shim legacy — tous les composants sont directs

// ── Composants primitifs ────────────────────────────────────
export { Modal } from './Modal';

export { Input } from './Input';
export type { InputProps } from './Input';

export { Button } from './Button';
export type { ButtonProps } from './Button';

export { Card } from './Card';
export type { CardProps } from './Card';

export { Badge } from './Badge';
export type { BadgeProps } from './Badge';

export { Skeleton } from './Skeleton';

export { EmptyState } from './EmptyState';

export { Avatar } from './Avatar';

export { Sparkline } from './Sparkline';

export { Tooltip } from './Tooltip';

export { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';

export { SlidePanel } from './SlidePanel';
export type { SlidePanelSize } from './SlidePanel';

export { PanelStackProvider, usePanelStack } from './PanelStack';
export type { PanelDescriptor } from './PanelStack';

export { ViewTransition } from './ViewTransition';

export { AiSparkles } from './AiSparkles';

export { PageHero } from './PageHero';

export { AnimatedNumber } from './AnimatedNumber';

// ── Utilitaires ─────────────────────────────────────────────
export { ToastProvider, useToast } from './Toast';
export { ConfirmProvider, useConfirm, usePrompt } from './ConfirmDialog';
export * from './DateRangePicker';
