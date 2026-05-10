// ── UI Components — barrel export ────────────────────────────
// Sprint Design — les pages non refondues utilisent encore les APIs legacy
// Les pages refondues importeront directement depuis ./Button, ./Modal, etc.

// ── Composants avec API rétrocompatible ─────────────────────
// Modal et Input : on exporte les versions LEGACY par défaut
// car 6 pages les utilisent encore avec isOpen/onClose et label/icon
export { LegacyModal as Modal, LegacyInput as Input } from './_compat';

// ── Composants Sprint Design (API identique ou compatible) ──
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

// ── Nouveaux composants (import direct quand nécessaire) ────
// import { Modal } from '@/components/ui/Modal'     ← Radix version
// import { Input } from '@/components/ui/Input'     ← nouvelle version
