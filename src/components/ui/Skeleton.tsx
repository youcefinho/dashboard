// ── Skeleton — shimmer wave loader (Sprint 38 — Stripe gray-100/200) ───────
// Plus de .skeleton-brand cyan. Gradient gray-100→gray-200→gray-100 shimmer
// 1.5s. Border-radius sm par défaut, override via className tailwind.
//
// API préservée 100% :
//   - `className?: string`        (width/height/radius via tailwind)
//   - `style?: CSSProperties`     (Sprint 26 — inline pour animation-delay stagger)
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

interface SkeletonProps {
  className?: string;
  /** Inline style (utile pour width/height calculé ou animation-delay staggered). */
  style?: CSSProperties;
}

export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      className={cn('rounded-[var(--radius-sm)]', className)}
      style={{
        background:
          'linear-gradient(90deg, var(--gray-100) 25%, var(--gray-200) 50%, var(--gray-100) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s ease-in-out infinite',
        ...style,
      }}
    />
  );
}
