// ── Textarea — Stripe-style multi-line input ────────────────────────────────
// Sprint 38 RESET (Phase 2 M1) :
//   - Hérite style Input : border 1px, radius-md, focus border purple + ring 3px.
//   - min-height 80px, resize vertical par défaut.
//   - Plus de gradient brand inset, plus de glow 4px brand.
// PRÉSERVE 100 % de l'API :
//   - label, helper, error, success, containerClassName,
//   - maxLength + showCounter, resize, tous les TextareaHTMLAttributes.
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Icon } from './Icon';
import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Message erreur — string active danger + shake + icon. */
  error?: string | boolean;
  /** Message succès — string active success + check icon. */
  success?: string;
  /** Étiquette rendue au-dessus, style t-label-form. */
  label?: ReactNode;
  /** Texte d'aide sous le textarea. */
  helper?: ReactNode;
  /** Affiche un compteur de caractères en focus quand maxLength est fourni. */
  showCounter?: boolean;
  /** Comportement resize — défaut: vertical. */
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  /** Classe sur le conteneur externe. */
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      containerClassName,
      error,
      success,
      label,
      helper,
      showCounter = false,
      resize = 'vertical',
      disabled,
      readOnly,
      maxLength,
      onChange,
      defaultValue,
      value,
      id,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const autoId = useId();
    const taId = id ?? `ta-${autoId}`;
    const helpId = `${taId}-help`;

    const initial =
      typeof value === 'string' ? value.length
      : typeof defaultValue === 'string' ? defaultValue.length
      : 0;
    const [count, setCount] = useState<number>(initial);

    const handleChange = useCallback(
      (e: ChangeEvent<HTMLTextAreaElement>) => {
        setCount(e.target.value.length);
        onChange?.(e);
      },
      [onChange],
    );

    const counterVisible = showCounter && typeof maxLength === 'number' && maxLength > 0;
    const ratio = counterVisible ? count / maxLength! : 0;
    const nearLimit = counterVisible && ratio >= 0.9;
    const overLimit = counterVisible && count > maxLength!;

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

    const resizeCls =
      resize === 'none' ? 'resize-none'
      : resize === 'horizontal' ? 'resize-x'
      : resize === 'both' ? 'resize'
      : 'resize-y';

    return (
      <div className={cn('flex flex-col gap-1.5 w-full', containerClassName)}>
        {label && (
          <label htmlFor={taId} className="t-label-form">
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
          <textarea
            ref={ref}
            id={taId}
            disabled={disabled}
            readOnly={readOnly}
            maxLength={maxLength}
            value={value}
            defaultValue={defaultValue}
            onChange={handleChange}
            aria-invalid={errorActive || undefined}
            aria-describedby={
              hasErrorMsg || successActive || helper
                ? cn(helpId, ariaDescribedBy)
                : ariaDescribedBy
            }
            className={cn(
              'w-full rounded-[var(--radius-md)] border bg-[var(--bg-surface)] p-3 text-sm leading-relaxed min-h-[80px]',
              'text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors',
              resizeCls,
              'border-[var(--border)]',
              !disabled && !readOnly && 'hover:border-[var(--border-strong)]',
              !disabled && !readOnly &&
                'focus:border-[var(--primary)] focus:outline-none focus:shadow-[0_0_0_3px_var(--primary-ring)]',
              readOnly && !disabled && 'bg-[var(--bg-subtle)] cursor-default focus:outline-none',
              disabled && 'bg-[var(--bg-subtle)] cursor-not-allowed text-[var(--text-muted)]',
              errorActive && !disabled &&
                'border-[var(--danger)] focus:border-[var(--danger)] focus:shadow-[0_0_0_3px_rgba(205,61,100,0.20)]',
              successActive && !disabled && !errorActive &&
                'border-[var(--success)] focus:border-[var(--success)] focus:shadow-[0_0_0_3px_rgba(26,171,89,0.20)]',
              counterVisible && 'pb-7',
              className,
            )}
            {...props}
          />
          {counterVisible && (
            <span
              aria-live="polite"
              className={cn(
                'pointer-events-none absolute bottom-2 right-3 text-[10px] font-medium tabular-nums tracking-wide rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-opacity duration-150',
                'opacity-0 group-focus-within:opacity-100',
                overLimit
                  ? 'text-[var(--danger)] bg-[var(--danger-soft)]'
                  : nearLimit
                    ? 'text-[var(--warning)] bg-[var(--warning-soft)]'
                    : 'text-[var(--text-muted)] bg-[var(--bg-subtle)]',
              )}
            >
              {count}/{maxLength}
            </span>
          )}
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
Textarea.displayName = 'Textarea';
