// ── BulkActionBar — Barre d'actions multi-sélection premium (Sprint 24 vague 1) ─
// Pattern Linear/Superhuman : sticky bar avec compteur gradient brand,
// boutons d'actions à droite, "Tout désélectionner" à gauche. Slide-in 280ms
// avec respect prefers-reduced-motion. Glassmorphism + accent border-bottom
// gradient cyan→orange + shadow brand-tinted.

import { useEffect, useRef, type ReactNode } from 'react';
// Sprint 34 vague 34-3B — annonce SR au changement de selectedCount
import { announceSR } from '@/lib/announce';

export type BulkActionVariant = 'default' | 'danger';

export interface BulkAction {
  id: string;
  label: string;
  icon?: ReactNode;
  variant?: BulkActionVariant;
  disabled?: boolean;
  onClick: () => void;
}

interface BulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  actions: BulkAction[];
  /** Slot additionnel à droite (ex: bouton AI batch) — rendu après les actions */
  extraSlot?: ReactNode;
  /** 'danger' colore légèrement la bar avec un wash rouge */
  variant?: BulkActionVariant;
  /** Label aria custom (sinon "{count} éléments sélectionnés") */
  ariaLabel?: string;
  className?: string;
}

export function BulkActionBar({
  selectedCount,
  onClear,
  actions,
  extraSlot,
  variant = 'default',
  ariaLabel,
  className = '',
}: BulkActionBarProps) {
  // Sprint 34 vague 34-3B — annonce SR sur changement de count (polite).
  // useRef + effect garantit qu'on n'annonce qu'au changement réel (pas re-render).
  const lastAnnouncedCountRef = useRef<number>(-1);
  useEffect(() => {
    if (selectedCount <= 0) {
      lastAnnouncedCountRef.current = 0;
      return;
    }
    if (lastAnnouncedCountRef.current === selectedCount) return;
    lastAnnouncedCountRef.current = selectedCount;
    announceSR(
      `${selectedCount} élément${selectedCount > 1 ? 's' : ''} sélectionné${selectedCount > 1 ? 's' : ''}`,
      'polite',
    );
  }, [selectedCount]);

  if (selectedCount <= 0) return null;

  const isDanger = variant === 'danger';

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel || `${selectedCount} élément${selectedCount > 1 ? 's' : ''} sélectionné${selectedCount > 1 ? 's' : ''}`}
      className={`bulk-action-bar flex items-center gap-3 px-4 py-2.5 flex-wrap ${className}`}
      style={isDanger ? {
        background: 'linear-gradient(135deg, rgba(233,61,61,0.10) 0%, rgba(217,110,39,0.06) 100%)',
        borderColor: 'rgba(233,61,61,0.32)',
      } : undefined}
    >
      {/* Indicator stripe gradient */}
      <span aria-hidden className="bulk-action-bar__stripe" />

      {/* Clear — toujours à gauche */}
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-semibold transition-all cursor-pointer shrink-0"
        style={{
          background: 'rgba(255,255,255,0.65)',
          border: '1px solid rgba(0,157,219,0.28)',
          color: 'var(--text-secondary)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--primary)';
          e.currentTarget.style.borderColor = 'rgba(0,157,219,0.55)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)';
          e.currentTarget.style.borderColor = 'rgba(0,157,219,0.28)';
        }}
        aria-label="Tout désélectionner"
        title="Tout désélectionner (Esc)"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Désélectionner</span>
      </button>

      {/* Compteur — gradient text bold */}
      <div className="flex items-center gap-1 shrink-0">
        <span
          className="text-[13px] font-extrabold tabular-nums"
          style={{
            background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
            filter: 'drop-shadow(0 0 6px rgba(0,157,219,0.18))',
          }}
        >
          {selectedCount}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          sélectionné{selectedCount > 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex-1 min-w-0" />

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {actions.map((a) => {
          const danger = a.variant === 'danger';
          return (
            <button
              key={a.id}
              type="button"
              onClick={a.onClick}
              disabled={a.disabled}
              className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={danger ? {
                background: 'linear-gradient(135deg, rgba(233,61,61,0.14) 0%, rgba(233,61,61,0.06) 100%)',
                border: '1px solid rgba(233,61,61,0.40)',
                color: 'var(--danger)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 1px 2px rgba(233,61,61,0.12)',
              } : {
                background: 'rgba(255,255,255,0.85)',
                border: '1px solid rgba(0,157,219,0.32)',
                color: 'var(--text-primary)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(0,157,219,0.10)',
              }}
              onMouseEnter={(e) => {
                if (a.disabled) return;
                if (danger) {
                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(233,61,61,0.24) 0%, rgba(233,61,61,0.10) 100%)';
                  e.currentTarget.style.borderColor = 'rgba(233,61,61,0.65)';
                  e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.5), 0 0 14px rgba(233,61,61,0.30)';
                } else {
                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,157,219,0.14) 0%, rgba(217,110,39,0.08) 100%)';
                  e.currentTarget.style.borderColor = 'rgba(0,157,219,0.55)';
                  e.currentTarget.style.color = 'var(--primary)';
                  e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.6), 0 0 14px rgba(0,157,219,0.25)';
                }
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                if (a.disabled) return;
                if (danger) {
                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(233,61,61,0.14) 0%, rgba(233,61,61,0.06) 100%)';
                  e.currentTarget.style.borderColor = 'rgba(233,61,61,0.40)';
                  e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.5), 0 1px 2px rgba(233,61,61,0.12)';
                } else {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.85)';
                  e.currentTarget.style.borderColor = 'rgba(0,157,219,0.32)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                  e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(0,157,219,0.10)';
                }
                e.currentTarget.style.transform = 'translateY(0)';
              }}
              aria-label={a.label}
            >
              {a.icon && <span aria-hidden className="inline-flex shrink-0">{a.icon}</span>}
              <span>{a.label}</span>
            </button>
          );
        })}
        {extraSlot}
      </div>
    </div>
  );
}
