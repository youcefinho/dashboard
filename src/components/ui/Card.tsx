// ── Card — surface container (Sprint 38 — Stripe-clean refactor) ────────────
// Subtle white surface + thin gray border + shadow-xs. Hover lift -1px sur
// interactive (CSS only, plus de mouseEnter inline JS shadow brand).
//
// API préservée 100% :
//   - `interactive?: boolean`        (legacy Sprint 24 W6B — focusable + hover)
//   - `variant?: 'default'|'interactive'|'premium'`  (legacy compat — `premium` = `default`)
//   - `as?: ElementType`             (polymorphic — render as 'a', 'section', etc.)
//   - tous les HTMLAttributes (onClick, data-*, className, style, children, ...)
import { forwardRef, type HTMLAttributes, type ElementType } from 'react';
import { cn } from '@/lib/cn';

export type CardVariant = 'default' | 'interactive' | 'premium';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Sprint 24 W6B — hover lift + focusable. Préservé. */
  interactive?: boolean;
  /** Sprint 38 — variant explicite. `interactive` ≡ `interactive:true`. `premium` ≡ `default` (legacy). */
  variant?: CardVariant;
  /** Polymorphic — rend en autre tag qu'un `div` (a, section, article, ...). */
  as?: ElementType;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, variant, tabIndex, as, ...props }, ref) => {
    // Résolution variant → flag interactive effectif
    const isInteractive = interactive === true || variant === 'interactive';
    const Tag = (as ?? 'div') as ElementType;

    return (
      <Tag
        ref={ref}
        // a11y : auto-tabIndex=0 si interactive sans override
        tabIndex={isInteractive && tabIndex === undefined ? 0 : tabIndex}
        className={cn(
          // Baseline Stripe : white surface, thin gray border, radius-xl, shadow-xs, padding 20px
          'rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-xs)] p-5 transition-[box-shadow,transform,border-color] duration-[var(--duration-base)] ease-[var(--ease)]',
          // Sprint 38 — hover lift -1px CSS-only, shadow-sm, border-strong. Pas de cyan-tinted.
          isInteractive &&
            'cursor-pointer hover:-translate-y-px hover:shadow-[var(--shadow-sm)] hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2',
          className
        )}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';
