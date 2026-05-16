// ── FilterChip — Chip filtre premium dismissable (Sprint 24 vague 2) ─────────
// Layout : [icon?] [label] [: value pill?] [× remove?]
// Variants : 'active' (gradient brand + glow) | 'available' (outline neutral)
// Hover scale 1.02 + transition smooth. prefers-reduced-motion respect.

import type { ReactNode, MouseEvent } from 'react';

export interface FilterChipProps {
  label: string;
  value?: string | number;
  /** Affiche le bouton × et appelle ce callback */
  onRemove?: () => void;
  /** Rend tout le chip cliquable (ex: ouvre un DropdownMenu) */
  onClick?: () => void;
  variant?: 'active' | 'available';
  icon?: ReactNode;
  /** Index pour stagger animation 30ms */
  index?: number;
  className?: string;
  /** Aria-label custom (sinon construit depuis label+value) */
  ariaLabel?: string;
}

export function FilterChip({
  label,
  value,
  onRemove,
  onClick,
  variant = 'available',
  icon,
  index = 0,
  className = '',
  ariaLabel,
}: FilterChipProps) {
  const isActive = variant === 'active';
  const Component: 'button' | 'span' = onClick ? 'button' : 'span';

  const handleRemove = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onRemove?.();
  };

  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`filter-chip ${isActive ? 'filter-chip--active' : ''} ${className}`}
      style={{
        animationDelay: `${Math.min(index, 12) * 30}ms`,
      }}
      aria-label={ariaLabel || (value !== undefined ? `${label}: ${value}` : label)}
      aria-pressed={onClick ? isActive : undefined}
    >
      {icon && <span aria-hidden className="inline-flex shrink-0">{icon}</span>}
      <span className="truncate max-w-[140px]">{label}</span>
      {value !== undefined && value !== '' && (
        <>
          <span aria-hidden className="opacity-50 text-[10px]">:</span>
          <span className="filter-chip__value">{value}</span>
        </>
      )}
      {onRemove && (
        <span
          role="button"
          tabIndex={-1}
          onClick={handleRemove}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              e.preventDefault();
              onRemove();
            }
          }}
          className="filter-chip__remove"
          aria-label={`Retirer le filtre ${label}`}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
            <path d="M1.5 1.5L6.5 6.5M6.5 1.5L1.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </Component>
  );
}
