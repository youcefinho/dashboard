// ── Skeleton — shimmer wave loader (Sprint 38 — Stripe gray-100/200) ───────
// Plus de .skeleton-brand cyan. Gradient gray-100→gray-200→gray-100 shimmer
// 1.5s. Border-radius sm par défaut, override via className tailwind.
//
// API préservée 100% :
//   - `className?: string`        (width/height/radius via tailwind)
//   - `style?: CSSProperties`     (Sprint 26 — inline pour animation-delay stagger)
// Sprint S5 — ajout prop `variant` optionnelle :
//   - `'line'`   : skeleton-line (h12px, radius-md)
//   - `'circle'` : skeleton-circle (50%, flex-shrink)
//   - `'card'`   : skeleton-card (radius-xl, min-h 120px)
//   - `undefined` : comportement inline shimmer original (back-compat)
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

export type SkeletonVariant = 'line' | 'circle' | 'card';

interface SkeletonProps {
  className?: string;
  /** Inline style (utile pour width/height calculé ou animation-delay staggered). */
  style?: CSSProperties;
  /** Sprint S5 — variant visuelle prédéfinie (line, circle, card). Optionnel. */
  variant?: SkeletonVariant;
}

const variantClasses: Record<SkeletonVariant, string> = {
  line: 'skeleton-line',
  circle: 'skeleton-circle',
  card: 'skeleton-card',
};

export function Skeleton({ className, style, variant }: SkeletonProps) {
  // Si un variant est spécifié, on utilise les classes CSS S4 prédéfinies
  if (variant) {
    return (
      <div
        className={cn(variantClasses[variant], className)}
        style={style}
      />
    );
  }

  // Comportement original (back-compat) : shimmer inline
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
