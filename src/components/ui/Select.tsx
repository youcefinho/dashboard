// ── Select — Stripe-style native select wrapper ─────────────────────────────
// Sprint 38 RESET (Phase 2 M1) :
//   - Hérite style Input : border 1px, radius-md, focus border purple + ring 3px.
//   - Chevron lucide subtil gray-500 (était cyan brand 1.75 stroke).
//   - Plus de glow brand, plus de gradient disabled.
// PRÉSERVE 100 % de l'API :
//   - leftIcon, label, helper, error, success, containerClassName,
//   - size (sm|md), children options, tous les SelectHTMLAttributes (sauf size).
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { AlertCircle, CheckCircle2, ChevronDown } from 'lucide-react';
import { Icon } from './Icon';
import { cn } from '@/lib/cn';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  leftIcon?: ReactNode;
  /** Message erreur — string active danger + shake + icon. */
  error?: string | boolean;
  /** Message succès — string active success + check icon. */
  success?: string;
  /** Étiquette rendue au-dessus, style t-label-form. */
  label?: ReactNode;
  /** Texte d'aide sous le select. */
  helper?: ReactNode;
  size?: 'sm' | 'md';
  /** Classe sur le conteneur externe. */
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      containerClassName,
      leftIcon,
      error,
      success,
      label,
      helper,
      size = 'md',
      disabled,
      children,
      id,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const autoId = useId();
    const selectId = id ?? `sel-${autoId}`;
    const helpId = `${selectId}-help`;

    const heightCls = size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm';

    const hasErrorMsg = typeof error === 'string' && error.length > 0;
    const errorActive = hasErrorMsg || error === true;
    const successActive = typeof success === 'string' && success.length > 0;

    const [shake, setShake] = useState(false);
    const prevErr = useRef<boolean>(errorActive);
    useEffect(() => {
      const wasErr = prevErr.current;
      if (errorActive && (!wasErr || hasErrorMsg)) {
        setShake(true);
        const t = window.setTimeout(() => setShake(false), 360);
        prevErr.current = errorActive;
        return () => window.clearTimeout(t);
      }
      prevErr.current = errorActive;
    }, [errorActive, hasErrorMsg, error]);

    return (
      <div className={cn('flex flex-col gap-1.5 w-full', containerClassName)}>
        {label && (
          <label htmlFor={selectId} className="t-label-form">
            {label}
          </label>
        )}
        <div
          className={cn(
            'relative group',
            disabled && 'opacity-60 cursor-not-allowed',
            shake && 'input-shake',
          )}
        >
          {leftIcon && (
            <span
              className={cn(
                'absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none transition-colors z-10',
                disabled ? 'text-[var(--text-muted)] opacity-60' : 'text-[var(--text-muted)]',
              )}
            >
              {leftIcon}
            </span>
          )}
          <select
            ref={ref}
            id={selectId}
            disabled={disabled}
            aria-invalid={errorActive || undefined}
            aria-describedby={
              hasErrorMsg || successActive || helper
                ? cn(helpId, ariaDescribedBy)
                : ariaDescribedBy
            }
            className={cn(
              'appearance-none w-full rounded-[var(--radius-md)] border bg-[var(--bg-surface)] px-3 pr-9 text-[var(--text-primary)] transition-colors',
              heightCls,
              'border-[var(--border)]',
              !disabled && 'hover:border-[var(--border-strong)] cursor-pointer',
              !disabled &&
                'focus:border-[var(--primary)] focus:outline-none focus:shadow-[0_0_0_3px_var(--primary-ring)]',
              disabled && 'bg-[var(--bg-subtle)] cursor-not-allowed text-[var(--text-muted)]',
              errorActive && !disabled &&
                'border-[var(--danger)] focus:border-[var(--danger)] focus:shadow-[0_0_0_3px_rgba(205,61,100,0.20)]',
              successActive && !disabled && !errorActive &&
                'border-[var(--success)] focus:border-[var(--success)] focus:shadow-[0_0_0_3px_rgba(26,171,89,0.20)]',
              leftIcon && 'pl-10',
              className,
            )}
            style={{ WebkitAppearance: 'none', MozAppearance: 'none' }}
            {...props}
          >
            {children}
          </select>
          {/* Chevron subtle gray-500 */}
          <span
            aria-hidden
            className={cn(
              'absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none z-10',
              disabled ? 'text-[var(--text-muted)] opacity-60' : 'text-[var(--text-muted)]',
            )}
          >
            <Icon as={ChevronDown} size={14} />
          </span>
        </div>

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
Select.displayName = 'Select';
