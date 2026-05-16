// ── Combobox — Autocomplete primitive (Sprint 24 vague 4B) ──────────────────
// Input + dropdown filtrable avec fuzzy match (substring highlight gradient brand).
// Keyboard nav complète (↑↓ ↵ Esc). Loading skeleton, empty state premium,
// group support optionnel. Réutilise les styles .cmd-* pour cohérence avec
// la CommandPalette.
//
// Usage typique :
//   <Combobox
//     options={industries}
//     value={businessType}
//     onChange={setBusinessType}
//     placeholder="Sélectionnez une industrie..."
//     groupBy={(opt) => opt.description ?? ''}
//   />

import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type ChangeEvent } from 'react';
import { Skeleton } from './Skeleton';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Icon visuel (emoji ou JSX) optionnel */
  icon?: ReactNode;
  /** Description secondaire affichée sous le label */
  description?: string;
  /** Si fourni avec groupBy, override la clé de groupe pour cet item */
  groupKey?: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Skeleton rows pendant fetch async */
  loading?: boolean;
  /** Fonction qui retourne le nom du groupe pour chaque option */
  groupBy?: (opt: ComboboxOption) => string;
  /** Override du rendu d'un item */
  renderOption?: (opt: ComboboxOption, isHighlighted: boolean) => ReactNode;
  /** Permet de garder une valeur tapée non présente dans options */
  allowCustom?: boolean;
  /** Label aria pour le combobox */
  ariaLabel?: string;
  /** Class wrapper externe */
  className?: string;
  /** Texte affiché en empty state */
  emptyLabel?: string;
  /** Désactive l'input */
  disabled?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  return text.toLowerCase().includes(query.toLowerCase());
}

/** Découpe `text` en segments matched/unmatched selon `query` (substring case-insensitive). */
function highlightSegments(text: string, query: string): Array<{ text: string; match: boolean }> {
  if (!query) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      segments.push({ text: text.slice(i), match: false });
      break;
    }
    if (idx > i) segments.push({ text: text.slice(i, idx), match: false });
    segments.push({ text: text.slice(idx, idx + q.length), match: true });
    i = idx + q.length;
  }
  return segments;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Rechercher...',
  loading = false,
  groupBy,
  renderOption,
  allowCustom = false,
  ariaLabel,
  className,
  emptyLabel = 'Aucun résultat',
  disabled = false,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Trouver le label correspondant à la `value` actuelle (affiché quand fermé)
  const selectedOption = useMemo(
    () => options.find(o => o.value === value),
    [options, value]
  );

  // Quand l'input n'est pas ouvert, query reflète le label sélectionné
  // (pattern Combobox standard : on tape directement pour filtrer).
  const displayValue = open ? query : (selectedOption?.label ?? (allowCustom ? value : ''));

  const filteredOptions = useMemo(() => {
    if (!open) return options;
    if (!query) return options;
    return options.filter(opt =>
      fuzzyMatch(opt.label, query) ||
      (opt.description ? fuzzyMatch(opt.description, query) : false)
    );
  }, [open, query, options]);

  // Group si groupBy fourni
  const groupedOptions = useMemo(() => {
    if (!groupBy) return null;
    const groups: Record<string, ComboboxOption[]> = {};
    filteredOptions.forEach(opt => {
      const key = opt.groupKey ?? groupBy(opt);
      if (!groups[key]) groups[key] = [];
      groups[key]!.push(opt);
    });
    return groups;
  }, [filteredOptions, groupBy]);

  // Reset highlighted on filter change
  useEffect(() => { setHighlightedIndex(0); }, [query, open]);

  // Click outside closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-cb-index="${highlightedIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, open]);

  const handleSelect = useCallback((opt: ComboboxOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }, [onChange]);

  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.min(prev + 1, filteredOptions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filteredOptions[highlightedIndex];
      if (opt) {
        handleSelect(opt);
      } else if (allowCustom && query) {
        onChange(query);
        setOpen(false);
        setQuery('');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    } else if (e.key === 'Tab') {
      // Close on Tab to allow normal focus flow
      setOpen(false);
      setQuery('');
    }
  }, [open, filteredOptions, highlightedIndex, allowCustom, query, onChange, handleSelect]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (!open) setOpen(true);
  };

  const handleFocus = () => {
    if (!disabled) setOpen(true);
  };

  // Build flat index map for grouped mode (so keyboard nav works across groups)
  let runningIndex = 0;
  const renderOptionRow = (opt: ComboboxOption) => {
    const idx = runningIndex++;
    const isHighlighted = idx === highlightedIndex;
    const isSelected = opt.value === value;
    if (renderOption) {
      return (
        <div
          key={opt.value}
          id={`${listboxId}-opt-${idx}`}
          data-cb-index={idx}
          role="option"
          aria-selected={isSelected}
          onMouseEnter={() => setHighlightedIndex(idx)}
          onMouseDown={(e) => { e.preventDefault(); handleSelect(opt); }}
          className={`cmd-item ${isHighlighted ? 'is-selected' : ''}`}
        >
          {renderOption(opt, isHighlighted)}
        </div>
      );
    }
    const labelSegments = highlightSegments(opt.label, query);
    const descSegments = opt.description ? highlightSegments(opt.description, query) : null;
    return (
      <div
        key={opt.value}
        id={`${listboxId}-opt-${idx}`}
        data-cb-index={idx}
        role="option"
        aria-selected={isSelected}
        onMouseEnter={() => setHighlightedIndex(idx)}
        onMouseDown={(e) => { e.preventDefault(); handleSelect(opt); }}
        className={`cmd-item ${isHighlighted ? 'is-selected' : ''}`}
      >
        {opt.icon && <span className="cmd-item-icon" aria-hidden="true">{opt.icon}</span>}
        <div className="cmd-item-body">
          <div className="cmd-item-label">
            {labelSegments.map((seg, i) => seg.match
              ? <span key={i} className="combobox-highlight">{seg.text}</span>
              : <span key={i}>{seg.text}</span>
            )}
          </div>
          {descSegments && (
            <div className="cmd-item-desc">
              {descSegments.map((seg, i) => seg.match
                ? <span key={i} className="combobox-highlight">{seg.text}</span>
                : <span key={i}>{seg.text}</span>
              )}
            </div>
          )}
        </div>
        {isSelected && !isHighlighted && (
          <span className="text-[var(--primary)] text-xs font-semibold pr-2" aria-hidden="true">✓</span>
        )}
      </div>
    );
  };

  const totalVisible = filteredOptions.length;
  const showEmpty = !loading && totalVisible === 0;

  // Sprint 48 M1.3 — IDs uniques pour pattern combobox-listbox (aria-activedescendant)
  const listboxId = useMemo(() => `cb-list-${Math.random().toString(36).slice(2, 9)}`, []);
  const activeOptionId = open && filteredOptions[highlightedIndex]
    ? `${listboxId}-opt-${highlightedIndex}`
    : undefined;

  return (
    <div ref={wrapperRef} className={`combobox relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel}
        value={displayValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {/* Caret indicator */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
      {open && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="combobox-list absolute left-0 right-0 mt-1 z-50 rounded-xl overflow-y-auto"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(249,252,254,0.96) 100%)',
            border: '1px solid rgba(0,157,219,0.18)',
            boxShadow: '0 16px 48px -12px rgba(0,157,219,0.22), 0 0 40px -8px rgba(217,110,39,0.12), inset 0 1px 0 rgba(255,255,255,0.85)',
            backdropFilter: 'blur(12px) saturate(170%)',
            WebkitBackdropFilter: 'blur(12px) saturate(170%)',
          }}
        >
          {loading ? (
            <div className="py-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                  <Skeleton className="w-7 h-7 rounded-lg" />
                  <div className="flex-1">
                    <Skeleton className="h-3 w-2/3 mb-1.5" />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : showEmpty ? (
            <div className="combobox-empty flex flex-col items-center justify-center px-6 py-8 text-center gap-2">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-white"
                style={{
                  background: 'linear-gradient(135deg, rgba(0,157,219,0.85) 0%, rgba(217,110,39,0.55) 100%)',
                  boxShadow: '0 8px 24px -6px rgba(0,157,219,0.45)',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">{emptyLabel}</div>
              {query && (
                <div className="text-[11px] text-[var(--text-muted)]">
                  Aucun résultat pour « <span className="text-[var(--primary)] font-medium">{query}</span> »
                </div>
              )}
            </div>
          ) : groupedOptions ? (
            Object.entries(groupedOptions).map(([groupName, items]) => (
              <div key={groupName}>
                {groupName && (
                  <div className="cmd-section-header">
                    <span className="cmd-section-header-label">{groupName}</span>
                    <span className="cmd-section-header-line" />
                  </div>
                )}
                {items.map(opt => renderOptionRow(opt))}
              </div>
            ))
          ) : (
            <div className="py-1">
              {filteredOptions.map(opt => renderOptionRow(opt))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
