// ── AppliedFiltersBar — Wrapper scroll-x mobile pour chips actifs (Sprint 24 vague 2)
// Pattern Notion/Linear : tous filtres actifs visibles en chips au-dessus de la liste.
// Bouton "Tout effacer" visible dès ≥2 filtres. Mobile : mask-image fade edges.

import type { ReactNode } from 'react';
import { FilterChip } from './FilterChip';

export interface FilterDescriptor {
  id: string;
  label: string;
  value?: string | number;
  onRemove: () => void;
  onClick?: () => void;
  icon?: ReactNode;
}

interface AppliedFiltersBarProps {
  filters: FilterDescriptor[];
  onClearAll: () => void;
  /** Slot ajouté à gauche des chips (ex: bouton "Ajouter filtre") */
  leadingSlot?: ReactNode;
  /** Hide complètement si vide (default true) */
  hideWhenEmpty?: boolean;
  className?: string;
}

export function AppliedFiltersBar({
  filters,
  onClearAll,
  leadingSlot,
  hideWhenEmpty = true,
  className = '',
}: AppliedFiltersBarProps) {
  if (hideWhenEmpty && filters.length === 0 && !leadingSlot) return null;

  return (
    <div className={`applied-filters-bar ${className}`} role="region" aria-label="Filtres actifs">
      {leadingSlot}
      {filters.map((f, idx) => (
        <FilterChip
          key={f.id}
          label={f.label}
          value={f.value}
          onRemove={f.onRemove}
          onClick={f.onClick}
          icon={f.icon}
          variant="active"
          index={idx}
        />
      ))}
      {filters.length >= 2 && (
        <button
          type="button"
          onClick={onClearAll}
          className="applied-filters-bar__clear"
          aria-label="Effacer tous les filtres"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Tout effacer
        </button>
      )}
    </div>
  );
}
