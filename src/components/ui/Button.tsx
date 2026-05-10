// ── Button — 5 variants × 3 sizes ───────────────────────────
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link';
  size?: 'sm' | 'md' | 'lg';
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', leftIcon, rightIcon, isLoading, children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center font-medium transition-all rounded-[var(--radius-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

    const variants: Record<string, string> = {
      primary: 'bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-hover)] active:scale-[0.98]',
      secondary: 'bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]',
      ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]',
      destructive: 'bg-[var(--danger)] text-white hover:brightness-110 active:scale-[0.98]',
      link: 'bg-transparent text-[var(--brand-primary)] hover:underline p-0 h-auto',
    };

    const sizes: Record<string, string> = {
      sm: 'h-8 px-3 text-xs gap-1.5',
      md: 'h-[38px] px-4 text-sm gap-2',
      lg: 'h-11 px-6 text-sm gap-2',
    };

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);
Button.displayName = 'Button';
