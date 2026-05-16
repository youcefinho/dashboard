// ── Button — Stripe-style 6 variants × 3 sizes ──────────────────────────────
// Sprint 38 RESET (Phase 2 M1) :
//   - Visuel refondu Stripe-clean : flat purple primary, white secondary,
//     border + shadow-xs, focus ring purple, plus de gradient brand cyan/orange.
//   - `premium` est désormais un alias de `primary` (gardé pour compat appels).
//   - `danger` + `destructive` co-existent (alias) pour ne pas casser les appels.
// PRÉSERVE 100 % de l'API publique :
//   - props : variant, size, leftIcon, rightIcon, isLoading, ripple, celebrate,
//     sound, disabled, fullWidth, et tous les ButtonHTMLAttributes.
//   - effets : ripple discret (gray-200), celebrate→confetti, sound→useSound.
import {
  forwardRef,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Loader2 } from 'lucide-react';
import { Icon } from './Icon';
import { cn } from '@/lib/cn';
import { confettiBurst } from '@/lib/confetti';
import { playSound, type SoundName } from '@/lib/sensorial';

// Soft dep — confettiBurstSubtle (M2 3B), fallback inline si absent.
let confettiBurstSubtle: ((opts?: { x?: number; y?: number }) => void) | null = null;
void import('@/lib/confetti').then((mod: any) => {
  if (typeof mod.confettiBurstSubtle === 'function') {
    confettiBurstSubtle = mod.confettiBurstSubtle;
  }
}).catch(() => { /* ignore */ });

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'destructive' // alias compat → mappé sur danger
  | 'link'
  | 'premium';    // alias compat → mappé sur primary

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  isLoading?: boolean;
  /** Width 100 % du conteneur parent. */
  fullWidth?: boolean;
  /** Ripple discret DOM-only au click. Défaut false (Stripe-style). */
  ripple?: boolean;
  /** Burst confetti au click via lib/confetti. Défaut false. */
  celebrate?: boolean;
  /** Micro-son procédural au click via lib/sensorial. Défaut false. */
  sound?: SoundName | boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function spawnRipple(button: HTMLButtonElement, evt: ReactMouseEvent<HTMLButtonElement>) {
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const x = evt.clientX - rect.left - size / 2;
  const y = evt.clientY - rect.top - size / 2;
  const ripple = document.createElement('span');
  ripple.className = 'btn-ripple-overlay';
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  button.appendChild(ripple);
  window.setTimeout(() => { ripple.remove(); }, 600);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      leftIcon,
      rightIcon,
      isLoading,
      fullWidth,
      ripple,
      celebrate,
      sound,
      children,
      disabled,
      onClick,
      type,
      ...props
    },
    ref,
  ) => {
    const localRef = useRef<HTMLButtonElement | null>(null);
    const setRefs = (node: HTMLButtonElement | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as { current: HTMLButtonElement | null }).current = node;
    };

    // Alias compat : premium → primary, destructive → danger
    const resolvedVariant: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' =
      variant === 'premium' ? 'primary'
      : variant === 'destructive' ? 'danger'
      : variant;

    const base =
      'relative overflow-hidden inline-flex items-center justify-center font-medium ' +
      'rounded-[var(--radius-md)] transition-colors duration-150 ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
      'focus-visible:ring-[var(--primary)] focus-visible:ring-offset-[var(--bg-surface)] ' +
      'disabled:opacity-50 disabled:pointer-events-none cursor-pointer select-none';

    const variants: Record<typeof resolvedVariant, string> = {
      primary:
        'bg-[var(--primary)] text-white shadow-[var(--shadow-xs)] ' +
        'hover:bg-[var(--primary-hover)]',
      secondary:
        'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] ' +
        'shadow-[var(--shadow-xs)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]',
      ghost:
        'bg-transparent text-[var(--text-secondary)] ' +
        'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
      danger:
        'bg-[var(--danger)] text-white shadow-[var(--shadow-xs)] hover:brightness-110',
      link:
        'bg-transparent text-[var(--primary)] hover:underline p-0 h-auto shadow-none',
    };

    const sizes: Record<ButtonSize, string> = {
      sm: 'h-8 px-3 text-xs gap-1.5',
      md: 'h-9 px-4 text-sm gap-2',
      lg: 'h-10 px-5 text-sm gap-2',
    };

    const rippleEnabled = ripple ?? false;

    const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
      const btn = localRef.current;
      const reduced = prefersReducedMotion();
      if (btn && rippleEnabled && !reduced && resolvedVariant !== 'link') {
        spawnRipple(btn, e);
      }
      if (celebrate && !reduced) {
        const x = e.clientX;
        const y = e.clientY;
        if (confettiBurstSubtle) {
          try { confettiBurstSubtle({ x, y }); }
          catch { confettiBurst({ x, y, count: 15 }); }
        } else {
          confettiBurst({ x, y, count: 15 });
        }
      }
      if (celebrate) {
        playSound('celebrate');
      } else if (sound === true) {
        playSound('tick');
      } else if (typeof sound === 'string') {
        playSound(sound);
      }
      onClick?.(e);
    };

    return (
      <button
        ref={setRefs}
        type={type ?? 'button'}
        className={cn(
          base,
          variants[resolvedVariant],
          resolvedVariant !== 'link' && sizes[size],
          fullWidth && 'w-full',
          className,
        )}
        disabled={disabled || isLoading}
        onClick={handleClick}
        {...props}
      >
        {isLoading
          ? <Icon as={Loader2} size={16} className="animate-spin shrink-0" />
          : leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  },
);
Button.displayName = 'Button';
