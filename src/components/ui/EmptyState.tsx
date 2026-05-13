// ── EmptyState — placeholder encourageant (Sprint 23 — visual lift) ─────────
// Refonte visuelle "Superhuman / Arc" :
// - Icône dans un disque avec halo radial cyan/orange (signature Intralys)
// - Typo hiérarchisée (titre + description + action)
// - Optionnel : `tips` (3 conseils numérotés) + `meta` (sub-label en haut)
// - Light theme préservé, fond clair

import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Petite étiquette au-dessus du titre (ex: "Premier pas") */
  meta?: string;
  /** Liste de 2-4 conseils affichés sous l'action principale */
  tips?: string[];
  /** Action secondaire (lien "Voir la doc", etc.) */
  secondaryAction?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, meta, tips, secondaryAction, className }: EmptyStateProps) {
  return (
    <div className={cn('relative flex flex-col items-center justify-center py-16 px-6 text-center overflow-hidden', className)}>
      {/* Halo radial décoratif (signature Intralys cyan→orange) */}
      <div
        aria-hidden
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[480px] h-[280px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, oklch(0.7 0.15 220 / 0.10) 0%, oklch(0.75 0.16 50 / 0.06) 35%, transparent 65%)',
          filter: 'blur(40px)',
        }}
      />

      {icon && (
        <div className="relative mb-5">
          {/* Disque icône avec border subtile + glow */}
          <div className="relative w-[72px] h-[72px] rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, oklch(0.99 0.005 220) 0%, oklch(0.97 0.01 220) 100%)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 1px 2px oklch(0 0 0 / 0.04), 0 0 32px oklch(0.7 0.15 220 / 0.08)',
            }}>
            <div className="text-[var(--brand-primary)]" style={{ filter: 'drop-shadow(0 1px 2px oklch(0.7 0.15 220 / 0.3))' }}>
              {icon}
            </div>
          </div>
        </div>
      )}

      {meta && (
        <p className="relative text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-primary)] mb-2">
          {meta}
        </p>
      )}

      <h3 className="relative text-lg font-semibold text-[var(--text-primary)] mb-2 tracking-tight">
        {title}
      </h3>

      {description && (
        <p className="relative text-sm text-[var(--text-secondary)] max-w-md mb-6 leading-relaxed">
          {description}
        </p>
      )}

      {action && (
        <div className="relative flex items-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}

      {tips && tips.length > 0 && (
        <div className="relative mt-8 max-w-md w-full">
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] mb-3">
            Pour commencer
          </p>
          <ul className="space-y-2 text-left">
            {tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 mt-0.5"
                  style={{
                    background: 'oklch(0.7 0.15 220 / 0.1)',
                    color: 'var(--brand-primary)',
                  }}>
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
