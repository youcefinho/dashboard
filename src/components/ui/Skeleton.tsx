// ── Skeleton — shimmer wave loader ──────────────────────────
import { cn } from '@/lib/cn';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={cn(
      'rounded-[var(--radius-sm)] bg-[var(--bg-muted)] animate-shimmer',
      className
    )} />
  );
}
