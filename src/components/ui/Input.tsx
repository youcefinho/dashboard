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
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none">{leftIcon}</span>
        )}
        <input
          ref={ref}
          className={cn(
            'h-[38px] w-full rounded-[var(--radius-sm)] border bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all',
            'border-[var(--border-default)] hover:border-[var(--border-strong)]',
            'focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none',
            error && 'border-[var(--danger)] focus:ring-[var(--danger-soft)]',
            leftIcon && 'pl-10',
            rightIcon && 'pr-10',
            className
          )}
          {...props}
        />
        {rightIcon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">{rightIcon}</span>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';
