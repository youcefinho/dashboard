// ── Button — 5 variants × 3 sizes ───────────────────────────
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link' | 'premium';
  size?: 'sm' | 'md' | 'lg';
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', leftIcon, rightIcon, isLoading, children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center font-medium transition-all rounded-[var(--radius-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

    const variants: Record<string, string> = {
      // Sprint 23 — primary upgrade : gradient subtil + glow shadow brand
      primary: 'text-white active:scale-[0.98] bg-gradient-to-br from-[#009DDB] to-[#0086C0] hover:from-[#00B5F5] hover:to-[#009DDB] shadow-[0_2px_8px_rgba(0,157,219,0.35)] hover:shadow-[0_4px_16px_rgba(0,157,219,0.55)]',
      // Premium — gradient cyan→orange signature (pour CTAs principaux)
      premium: 'text-white active:scale-[0.98] bg-gradient-to-br from-[#009DDB] to-[#D96E27] hover:from-[#00B5F5] hover:to-[#F08B40] shadow-[0_4px_16px_rgba(217,110,39,0.4)] hover:shadow-[0_6px_24px_rgba(217,110,39,0.6)]',
      secondary: 'bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)] hover:shadow-sm',
      ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]',
      destructive: 'bg-[var(--danger)] text-white hover:brightness-110 active:scale-[0.98] shadow-[0_2px_8px_rgba(233,61,61,0.35)] hover:shadow-[0_4px_16px_rgba(233,61,61,0.55)]',
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
        className={cn(base, variants[variant], sizes[size], isLoading && (variant === 'primary' || variant === 'premium' || variant === 'destructive') && 'button-loading-glow', className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" style={{ filter: 'drop-shadow(0 0 4px currentColor)' }} /> : leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);
Button.displayName = 'Button';
