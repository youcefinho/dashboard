// ── Badge — 6 intents × 3 fill modes ────────────────────────
import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  intent?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
  fill?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  /** Couleur custom CSS (override intent) */
  color?: string;
}

const intentStyles: Record<string, Record<string, string>> = {
  neutral: { soft: 'bg-[var(--bg-muted)] text-[var(--text-secondary)]', solid: 'bg-[var(--text-muted)] text-white', outline: 'border-[var(--border-default)] text-[var(--text-secondary)]' },
  brand:   { soft: 'bg-[var(--brand-tint)] text-[var(--brand-primary)]', solid: 'bg-[var(--brand-primary)] text-white', outline: 'border-[var(--brand-primary)] text-[var(--brand-primary)]' },
  success: { soft: 'bg-[var(--success-soft)] text-[var(--success)]', solid: 'bg-[var(--success)] text-white', outline: 'border-[var(--success)] text-[var(--success)]' },
  warning: { soft: 'bg-[var(--warning-soft)] text-[var(--warning)]', solid: 'bg-[var(--warning)] text-white', outline: 'border-[var(--warning)] text-[var(--warning)]' },
  danger:  { soft: 'bg-[var(--danger-soft)] text-[var(--danger)]', solid: 'bg-[var(--danger)] text-white', outline: 'border-[var(--danger)] text-[var(--danger)]' },
  info:    { soft: 'bg-[var(--info-soft)] text-[var(--info)]', solid: 'bg-[var(--info)] text-white', outline: 'border-[var(--info)] text-[var(--info)]' },
};

export function Badge({ className, intent = 'neutral', fill = 'soft', size = 'sm', color, children, style, ...props }: BadgeProps) {
  // Si couleur custom passée, on l'utilise directement
  if (color) {
    return (
      <span
        className={cn(
          'inline-flex items-center font-medium rounded-full whitespace-nowrap',
          size === 'sm' ? 'h-5 px-2 text-[11px]' : 'h-6 px-2.5 text-xs',
          className
        )}
        style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color, ...style }}
        {...props}
      >{children}</span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full whitespace-nowrap',
        size === 'sm' ? 'h-5 px-2 text-[11px]' : 'h-6 px-2.5 text-xs',
        fill === 'outline' && 'border',
        intentStyles[intent]?.[fill],
        className
      )}
      style={style}
      {...props}
    >{children}</span>
  );
}
