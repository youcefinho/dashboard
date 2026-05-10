// ── Card — surface container avec variant interactive ────────
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[var(--space-6)] transition-all duration-200',
          interactive && 'cursor-pointer hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] hover:-translate-y-px',
          className
        )}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';
