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

// ── Utilitaires ─────────────────────────────────────────────
export { ToastProvider, useToast } from './Toast';
export * from './DateRangePicker';
