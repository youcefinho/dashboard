// ── Input — text, search, with icon slots ───────────────────
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, leftIcon, rightIcon, error, ...props }, ref) => {
    return (
      <div className="input-premium-wrapper relative group">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--brand-primary)] pointer-events-none transition-colors z-10">{leftIcon}</span>
        )}
        <input
          ref={ref}
          className={cn(
            // Sprint 23 — input premium : background subtle gradient, focus glow brand visible
            'h-[40px] w-full rounded-[10px] border bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all',
            'border-[var(--border-default)] hover:border-[oklch(0.85_0.02_220)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
            // Focus state DRAMATIQUE : glow brand 4px + border brand
            'focus:border-[var(--brand-primary)] focus:outline-none focus:shadow-[0_0_0_4px_rgba(0,157,219,0.15),0_0_20px_-4px_rgba(0,157,219,0.35)]',
            error && 'border-[var(--danger)] focus:border-[var(--danger)] focus:shadow-[0_0_0_4px_rgba(233,61,61,0.15),0_0_20px_-4px_rgba(233,61,61,0.35)]',
            leftIcon && 'pl-10',
            rightIcon && 'pr-10',
            className
          )}
          {...props}
        />
        {rightIcon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--brand-primary)] transition-colors z-10">{rightIcon}</span>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';
