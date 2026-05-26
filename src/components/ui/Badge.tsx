// ── Badge — Stripe-clean (Sprint 38) ────────────────────────────────────────
// 6 intents × 3 fill modes, pas de border/shadow gradient, pas de glow brand.
// API publique 100% préservée (intent, fill, size, color). Sprint 38 ajoute
// props optionnelles : dot (8px circle pulse), pulse (anim), solid (alias).

import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  intent?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
  fill?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  /** Couleur custom CSS (override intent) */
  color?: string;
  /** Sprint 38 — affiche un dot 8px à gauche du contenu */
  dot?: boolean;
  /** Sprint 38 — anime le dot (pulse-dot keyframe) */
  pulse?: boolean;
  /** Sprint 38 — alias back-compat : si true force fill='solid' */
  solid?: boolean;
}

const intentStyles: Record<string, Record<string, string>> = {
  neutral: {
    soft: 'bg-[var(--bg-muted)] text-[var(--text-secondary)]',
    solid: 'bg-[var(--text-muted)] text-white',
    outline: 'border-[var(--border-default)] text-[var(--text-secondary)]',
  },
  brand: {
    soft: 'bg-[var(--primary-soft)] text-[var(--primary)]',
    solid: 'bg-[var(--primary)] text-white',
    outline: 'border-[var(--primary)] text-[var(--primary)]',
  },
  success: {
    soft: 'bg-[var(--success-soft)] text-[var(--success-text)]',
    solid: 'bg-[var(--success)] text-white',
    outline: 'border-[var(--success)] text-[var(--success-text)]',
  },
  warning: {
    soft: 'bg-[var(--warning-soft)] text-[var(--warning-text)]',
    solid: 'bg-[var(--warning)] text-white',
    outline: 'border-[var(--warning)] text-[var(--warning-text)]',
  },
  danger: {
    soft: 'bg-[var(--danger-soft)] text-[var(--danger-text)]',
    solid: 'bg-[var(--danger)] text-white',
    outline: 'border-[var(--danger)] text-[var(--danger-text)]',
  },
  info: {
    soft: 'bg-[var(--info-soft)] text-[var(--info-text)]',
    solid: 'bg-[var(--info)] text-white',
    outline: 'border-[var(--info)] text-[var(--info-text)]',
  },
};

// Intent → color hex/var pour le dot (matches text color in soft/outline)
const intentDotColor: Record<string, string> = {
  neutral: 'var(--text-muted)',
  brand: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
};

export function Badge({
  className,
  intent = 'neutral',
  fill = 'soft',
  size = 'sm',
  color,
  dot,
  pulse,
  solid,
  children,
  style,
  ...props
}: BadgeProps) {
  // solid prop = alias back-compat
  const resolvedFill = solid ? 'solid' : fill;

  // Sizes Stripe-clean : sm h-4 px-1.5 text-[10px], md h-5 px-2 text-xs
  const sizeClass =
    size === 'sm' ? 'h-4 px-1.5 text-[10px]' : 'h-5 px-2 text-xs';

  // Dot color : reflète intent (en mode solid, white sur fond color)
  const dotColor = color
    ? color
    : resolvedFill === 'solid'
      ? '#FFFFFF'
      : intentDotColor[intent];

  const dotEl = dot ? (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 rounded-full mr-1', pulse && 'pulse-dot')}
      style={{
        width: '6px',
        height: '6px',
        background: dotColor,
      }}
    />
  ) : null;

  // Si couleur custom passée, override intent (Sprint 38 — clean : pas de
  // shadow tinted, juste bg/color soft + border subtle optionnelle)
  if (color) {
    const isSolid = resolvedFill === 'solid';
    return (
      <span
        className={cn(
          'inline-flex items-center font-medium whitespace-nowrap',
          sizeClass,
          className
        )}
        style={{
          backgroundColor: isSolid
            ? color
            : `color-mix(in srgb, ${color} 12%, transparent)`,
          color: isSolid ? '#FFFFFF' : color,
          borderRadius: 'var(--radius-pill)',
          ...style,
        }}
        {...props}
      >
        {dotEl}
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium whitespace-nowrap',
        sizeClass,
        resolvedFill === 'outline' && 'border',
        intentStyles[intent]?.[resolvedFill],
        className
      )}
      style={{ borderRadius: 'var(--radius-pill)', ...style }}
      {...props}
    >
      {dotEl}
      {children}
    </span>
  );
}
