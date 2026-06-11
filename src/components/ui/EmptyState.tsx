// ── EmptyState — placeholder Stripe-clean (Sprint 38 refactor) ──────────────
// Center stack sober : icon monochrome 48-64px gray-400 + title gray-900 +
// description gray-600 + tips list chip numéroté gray-100 + actions.
// Plus d'orbs cyan/orange, plus de halo pulse, plus de chip gradient brand.
//
// Sprint 45 M2.3 + M2.4 — Extension API NON destructive :
//   - `illustration?: ReactNode` — slot dédié pour `<EmptyStateIllustration />`
//     (rendu avec animation float subtle + classe `empty-state-illustration`).
//     Si non fourni, fallback sur `icon`.
//   - `variant?: 'default' | 'compact' | 'first-time' | 'filtered'`
//     — `first-time` : data totalement vide (aucun élément créé).
//     — `filtered` : data existe MAIS filtre actif retourne 0 résultat.
//     Les deux nouveaux variants conservent la layout `default` ; ils ajoutent
//     simplement des classes CSS pour stagger l'animation et permettre styling
//     contextuel (ex: badge "Aucun résultat" en `filtered`).
//
// API préservée 100% (back-compat) :
//   - `title: string`
//   - `description?: string`
//   - `icon?: ReactNode`
//   - `meta?: string`
//   - `tips?: string[]`
//   - `action?: ReactNode`
//   - `secondaryAction?: ReactNode`
//   - `variant?: 'default' | 'compact'` (étendu)
//   - `className?: string`
//   - `actions?: ReactNode`

import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type EmptyStateVariant = 'default' | 'compact' | 'first-time' | 'filtered';

interface EmptyStateProps {
  icon?: ReactNode;
  /** Slot dédié illustration (Sprint 45 M2). Si fourni, rendu à la place de `icon`. */
  illustration?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Alias compat — rendu après `action` si fourni. */
  actions?: ReactNode;
  /** Petite étiquette au-dessus du titre (ex: "Premier pas") */
  meta?: string;
  /** Liste de 2-4 conseils affichés sous l'action principale */
  tips?: string[];
  /** Action secondaire (lien "Voir la doc", etc.) */
  secondaryAction?: ReactNode;
  /**
   * Variant :
   *   - `default` : padding généreux + icon 56×56
   *   - `compact` : padding réduit + icon 32×32 (inline tables/cards)
   *   - `first-time` : alias `default` + classe CSS (data totalement vide)
   *   - `filtered` : alias `default` + classe CSS (filtre actif → 0 résultat)
   */
  variant?: EmptyStateVariant;
  className?: string;
}

export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  actions,
  meta,
  tips,
  secondaryAction,
  variant = 'default',
  className,
}: EmptyStateProps) {
  const isCompact = variant === 'compact';
  const isFirstTime = variant === 'first-time';
  const isFiltered = variant === 'filtered';

  // Visual : illustration prioritaire sur icon. Si illustration fournie,
  // wrapper avec animation float subtle (sauf compact).
  const visual = illustration ?? icon;
  const hasVisual = Boolean(visual);
  const isIllustration = Boolean(illustration);

  return (
    <div
      className={cn(
        'empty-state empty-state-premium-s4 flex flex-col items-center justify-center text-center',
        isCompact ? 'py-8 px-4' : 'py-20 px-6',
        isFirstTime && 'empty-state--first-time',
        isFiltered && 'empty-state--filtered',
        className
      )}
      role="status"
      aria-live="polite"
    >
      {hasVisual && (
        <div
          className={cn(
            'empty-state-visual flex items-center justify-center mb-4',
            // Si illustration custom : pas de contrainte de taille hardcodée
            // (l'illustration gère sa propre size). Animation float optionnelle.
            isIllustration
              ? 'empty-state-illustration'
              : cn(
                  'empty-icon-ring text-[var(--gray-400)]',
                  isCompact ? 'w-8 h-8' : 'w-14 h-14'
                )
          )}
          aria-hidden
        >
          {visual}
        </div>
      )}

      {meta && (
        <p className="t-meta mb-2 empty-state-meta">
          {meta}
        </p>
      )}

      <h3
        className={cn(
          'empty-state-title text-[var(--text-primary)] mb-2 tracking-tight font-semibold',
          isCompact ? 'text-sm' : 't-h3'
        )}
      >
        {title}
      </h3>

      {description && (
        <p
          className={cn(
            'empty-state-description text-[var(--text-secondary)] max-w-md leading-relaxed',
            isCompact ? 'text-xs' : 't-body',
            (action || actions || secondaryAction || (tips && tips.length > 0)) ? 'mb-6' : ''
          )}
        >
          {description}
        </p>
      )}

      {(action || actions || secondaryAction) && (
        <div className="empty-state-actions flex items-center gap-3 flex-wrap justify-center">
          {action}
          {actions}
          {secondaryAction}
        </div>
      )}

      {tips && tips.length > 0 && (
        <div className="mt-8 max-w-md w-full">
          <p className="t-meta mb-3">Pour commencer</p>
          <ul className="space-y-2 text-left">
            {tips.map((tip, i) => (
              <li
                key={i}
                className="flex items-start gap-3 text-sm text-[var(--text-secondary)]"
              >
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-[11px] font-semibold shrink-0 mt-0.5 bg-[var(--gray-100)] text-[var(--text-secondary)] border border-[var(--border)]"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span className="leading-relaxed">{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
