// ── Card — surface container (Sprint 23 — premium baseline) ────────────────
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[var(--space-6)] transition-all duration-300',
          interactive && 'cursor-pointer hover:-translate-y-0.5',
          className
        )}
        style={{
          // Sprint 23 — shadow étagée 2 couches (subtle ambient + soft lift)
          boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px -4px rgba(15,23,42,0.06)',
          ...style,
        }}
        onMouseEnter={interactive ? (e) => {
          e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,157,219,0.06), 0 12px 32px -8px rgba(0,157,219,0.18)';
          e.currentTarget.style.borderColor = 'rgba(0,157,219,0.3)';
        } : undefined}
        onMouseLeave={interactive ? (e) => {
          e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px -4px rgba(15,23,42,0.06)';
          e.currentTarget.style.borderColor = '';
        } : undefined}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';
