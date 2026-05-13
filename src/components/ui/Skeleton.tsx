// ── Skeleton — shimmer wave loader (Sprint 23 — branded cyan) ──────────────
import { cn } from '@/lib/cn';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={cn('skeleton-brand rounded-lg', className)} />
  );
}
