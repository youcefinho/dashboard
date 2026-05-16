// ── Input — Stripe-style text input ─────────────────────────────────────────
// Sprint 38 RESET (Phase 2 M1) :
//   - Refonte visuelle Stripe : bg white, border 1px var(--border), radius-md,
//     focus border purple + ring 3px primary-ring.
//   - Plus de glow brand 4px, plus de slots à fond gradient, plus d'inset.
// PRÉSERVE 100 % de l'API :
//   - leftIcon, rightIcon (legacy overlay), leftSlot, rightSlot (intégrés),
//   - label, helper, error (string|bool), success, containerClassName,
//   - size (sm|md|lg), tous les InputHTMLAttributes.
// Animations : input-shake on error transition, input-success-check on success.
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Icon } from './Icon';
import { cn } from '@/lib/cn';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Icône à gauche en overlay (legacy). */
  leftIcon?: ReactNode;
  /** Icône à droite en overlay (legacy). */
  rightIcon?: ReactNode;
  /** Slot gauche intégré dans la bordure (ex: $, +1). */
  leftSlot?: ReactNode;
  /** Slot droit intégré dans la bordure (ex: km, loader). */
  rightSlot?: ReactNode;
  /** Étiquette rendue au-dessus, style t-label-form. */
  label?: ReactNode;
  /** Texte d'aide sous l'input (caché si error/success). */
  helper?: ReactNode;
  /** Message erreur — string active danger + shake + icon. */
  error?: string | boolean;
  /** Message succès — string active success + check icon. */
  success?: string;
  /** Classe sur le conteneur externe. */
  containerClassName?: string;
  /** Taille — sm (h-8) / md (h-9) / lg (h-10). */
  size?: InputSize;
}

const heightForSize: Record<InputSize, string> = {
  sm: 'h-8 text-xs',
  md: 'h-9 text-sm',
  lg: 'h-10 text-sm',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      containerClassName,
      leftIcon,
      rightIcon,
      leftSlot,
      rightSlot,
      label,
      helper,
      error,
      success,
      disabled,
      readOnly,
      id,
      size = 'md',
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const autoId = useId();
    const inputId = id ?? `inp-${autoId}`;
    const helpId = `${inputId}-help`;

    const hasErrorMsg = typeof error === 'string' && error.length > 0;
    const errorActive = hasErrorMsg || error === true;
    const successActive = typeof success === 'string' && success.length > 0;

    // Shake on error transition
    const [shake, setShake] = useState(false);
    const prevErrorRef = useRef<boolean>(errorActive);
    useEffect(() => {
      const wasError = prevErrorRef.current;
      if (errorActive && (!wasError || hasErrorMsg)) {
        setShake(true);
        const t = window.setTimeout(() => setShake(false), 360);
        prevErrorRef.current = errorActive;
        return () => window.clearTimeout(t);
      }
      prevErrorRef.current = errorActive;
    }, [errorActive, hasErrorMsg, error]);

    return (
      <div className={cn('flex flex-col gap-1.5 w-full', containerClassName)}>
        {label && (
          <label htmlFor={inputId} className="t-label-form">
            {label}
          </label>
        )}
        <div
          className={cn(
            'relative group flex items-stretch w-full rounded-[var(--radius-md)] border bg-[var(--bg-surface)] transition-colors',
            'border-[var(--border)]',
            !disabled && !readOnly && 'hover:border-[var(--border-strong)]',
            !disabled && !readOnly &&
              'focus-within:border-[var(--primary)] focus-within:shadow-[0_0_0_3px_var(--primary-ring)]',
            readOnly && !disabled && 'bg-[var(--bg-subtle)]',
            disabled && 'opacity-60 cursor-not-allowed bg-[var(--bg-subtle)]',
            errorActive && !disabled &&
              'border-[var(--danger)] focus-within:border-[var(--danger)] focus-within:shadow-[0_0_0_3px_rgba(205,61,100,0.20)]',
            successActive && !disabled && !errorActive &&
              'border-[var(--success)] focus-within:border-[var(--success)] focus-within:shadow-[0_0_0_3px_rgba(26,171,89,0.20)]',
            shake && 'input-shake',
          )}
        >
          {/* Slot gauche intégré (séparateur) */}
          {leftSlot && (
            <span
              className={cn(
                'flex items-center justify-center px-3 text-xs text-[var(--text-muted)] border-r border-[var(--border)] select-none',
                'rounded-l-[var(--radius-md)] bg-[var(--bg-subtle)]',
                disabled && 'opacity-60',
              )}
            >
              {leftSlot}
            </span>
          )}

          {/* Icône gauche overlay (legacy) */}
          {leftIcon && !leftSlot && (
            <span
              className={cn(
                'absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none transition-colors z-10',
                disabled ? 'text-[var(--text-muted)] opacity-60' : 'text-[var(--text-muted)]',
              )}
            >
              {leftIcon}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            readOnly={readOnly}
            aria-invalid={errorActive || undefined}
            aria-describedby={
              hasErrorMsg || successActive || helper
                ? cn(helpId, ariaDescribedBy)
                : ariaDescribedBy
            }
            className={cn(
              'w-full min-w-0 flex-1 bg-transparent px-3 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none border-0',
              heightForSize[size],
              disabled && 'cursor-not-allowed text-[var(--text-muted)]',
              readOnly && !disabled && 'cursor-default',
              leftIcon && !leftSlot && 'pl-10',
              rightIcon && !rightSlot && 'pr-10',
              !leftSlot && 'rounded-l-[var(--radius-md)]',
              !rightSlot && 'rounded-r-[var(--radius-md)]',
              className,
            )}
            {...props}
          />

          {/* Icône droite overlay (legacy) */}
          {rightIcon && !rightSlot && (
            <span
              className={cn(
                'absolute right-3 top-1/2 -translate-y-1/2 transition-colors z-10',
                disabled ? 'text-[var(--text-muted)] opacity-60' : 'text-[var(--text-muted)]',
              )}
            >
              {rightIcon}
            </span>
          )}

          {/* Slot droit intégré (séparateur) */}
          {rightSlot && (
            <span
              className={cn(
                'flex items-center justify-center px-3 text-xs text-[var(--text-muted)] border-l border-[var(--border)] select-none',
                'rounded-r-[var(--radius-md)] bg-[var(--bg-subtle)]',
                disabled && 'opacity-60',
              )}
            >
              {rightSlot}
            </span>
          )}
        </div>

        {/* Messages — priorité : error > success > helper */}
        {hasErrorMsg ? (
          <span
            id={helpId}
            role="alert"
            className="t-caption inline-flex items-center gap-1.5 text-[var(--danger)] not-italic"
          >
            <Icon as={AlertCircle} size={12} className="shrink-0" />
            <span>{error}</span>
          </span>
        ) : successActive ? (
          <span
            id={helpId}
            className="t-caption inline-flex items-center gap-1.5 text-[var(--success)] input-success-check not-italic"
          >
            <Icon as={CheckCircle2} size={12} className="shrink-0" />
            <span>{success}</span>
          </span>
        ) : helper ? (
          <span id={helpId} className="t-caption">
            {helper}
          </span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';
