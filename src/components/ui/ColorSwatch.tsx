// ── ColorSwatch — color picker chip avec preview + presets ───
// Sprint 23 wave 30 — primitive UI essentielle pour Settings/Builders
// Pattern : <input type="color"> natif hidden + trigger button stylisé chip-btn-like
import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { cn } from '@/lib/cn';

export interface ColorSwatchProps {
  value: string; // hex format #RRGGBB
  onChange: (color: string) => void;
  label?: string;
  /** Palette de presets quick-pick (chip-btn dot row) */
  presets?: string[];
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  id?: string;
}

const SIZES = {
  sm: {
    triggerH: 30,
    dot: 18,
    padX: 10,
    text: 'text-xs',
    presetDot: 16,
  },
  md: {
    triggerH: 36,
    dot: 22,
    padX: 12,
    text: 'text-sm',
    presetDot: 18,
  },
} as const;

/** Normalize a hex value to uppercase #RRGGBB form (defensive). */
function normalizeHex(hex: string): string {
  if (!hex) return '#000000';
  const trimmed = hex.trim();
  if (!trimmed.startsWith('#')) return `#${trimmed.toUpperCase()}`;
  return trimmed.toUpperCase();
}

export const ColorSwatch = forwardRef<HTMLDivElement, ColorSwatchProps>(
  (
    {
      value,
      onChange,
      label,
      presets,
      disabled = false,
      size = 'md',
      className,
      id,
    },
    ref
  ) => {
    const reactId = useId();
    const inputId = id ?? `swatch-${reactId}`;
    const inputRef = useRef<HTMLInputElement>(null);
    const [isActive, setIsActive] = useState(false);
    const dims = SIZES[size];
    const displayHex = normalizeHex(value);

    const openPicker = () => {
      if (disabled) return;
      // Trigger natif OS color picker programmatically
      inputRef.current?.click();
    };

    const handleTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        openPicker();
      }
    };

    const handleNativeChange = (e: ChangeEvent<HTMLInputElement>) => {
      onChange(normalizeHex(e.target.value));
    };

    const handlePresetClick = (color: string) => {
      if (disabled) return;
      onChange(normalizeHex(color));
    };

    const dotStyle: CSSProperties = {
      width: dims.dot,
      height: dims.dot,
      backgroundColor: displayHex,
      boxShadow:
        'inset 0 0 0 1px rgba(15,23,42,0.10), inset 0 1px 2px rgba(255,255,255,0.30), 0 1px 2px rgba(15,23,42,0.06)',
    };

    const activeRingStyle: CSSProperties | undefined = isActive
      ? {
          boxShadow: `0 0 0 3px rgba(0,157,219,0.30), 0 0 16px ${displayHex}66`,
        }
      : undefined;

    return (
      <div
        ref={ref}
        className={cn('color-swatch-wrapper inline-flex flex-col gap-2', className)}
      >
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              'text-xs font-semibold text-[var(--text-secondary)] select-none',
              disabled && 'opacity-70',
            )}
          >
            {label}
          </label>
        )}

        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={openPicker}
            onKeyDown={handleTriggerKeyDown}
            onMouseDown={() => setIsActive(true)}
            onMouseUp={() => setIsActive(false)}
            onMouseLeave={() => setIsActive(false)}
            onBlur={() => setIsActive(false)}
            disabled={disabled}
            aria-label={`Choisir une couleur, valeur actuelle ${displayHex}`}
            aria-haspopup="dialog"
            className={cn(
              'color-swatch-trigger relative inline-flex items-center gap-2.5',
              'rounded-[10px] border transition-all duration-200',
              'border-[var(--border-subtle)]',
              'bg-[linear-gradient(180deg,var(--bg-surface)_0%,var(--bg-subtle)_100%)]',
              'shadow-[0_1px_2px_rgba(15,23,42,0.03),inset_0_1px_0_rgba(255,255,255,0.6)]',
              'focus-visible:outline-none',
              !disabled &&
                'cursor-pointer hover:-translate-y-px hover:border-[rgba(0,157,219,0.40)] hover:shadow-[0_2px_10px_-2px_rgba(0,157,219,0.22),0_0_12px_-4px_rgba(217,110,39,0.18),inset_0_1px_0_rgba(255,255,255,0.8)]',
              disabled && 'opacity-50 cursor-not-allowed',
              dims.text,
            )}
            style={{
              height: dims.triggerH,
              paddingLeft: dims.padX,
              paddingRight: dims.padX,
              ...(activeRingStyle ?? {}),
            }}
          >
            <span
              aria-hidden="true"
              className="block rounded-full shrink-0"
              style={dotStyle}
            />
            <span
              className="font-mono tabular-nums text-[var(--text-primary)] font-semibold tracking-tight"
              style={{ fontSize: size === 'sm' ? 11 : 12 }}
            >
              {displayHex}
            </span>
          </button>

          {/* Input hidden — déclenché programmatique par le trigger */}
          <input
            ref={inputRef}
            id={inputId}
            type="color"
            value={displayHex}
            onChange={handleNativeChange}
            disabled={disabled}
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only absolute pointer-events-none"
            style={{ width: 1, height: 1, opacity: 0 }}
          />
        </div>

        {presets && presets.length > 0 && (
          <div
            role="listbox"
            aria-label="Couleurs prédéfinies"
            className="inline-flex flex-wrap items-center gap-1.5"
          >
            {presets.map((preset) => {
              const presetHex = normalizeHex(preset);
              const isSelected =
                presetHex.toLowerCase() === displayHex.toLowerCase();
              return (
                <button
                  key={presetHex}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-label={`Choisir ${presetHex}`}
                  onClick={() => handlePresetClick(presetHex)}
                  disabled={disabled}
                  className={cn(
                    'color-swatch-preset relative rounded-full transition-all duration-200',
                    'focus-visible:outline-none',
                    !disabled && 'cursor-pointer hover:scale-110 hover:-translate-y-px',
                    disabled && 'opacity-50 cursor-not-allowed',
                    isSelected && 'is-selected',
                  )}
                  style={{
                    width: dims.presetDot,
                    height: dims.presetDot,
                    backgroundColor: presetHex,
                    boxShadow: isSelected
                      ? `inset 0 0 0 1px rgba(15,23,42,0.15), 0 0 0 2px rgba(255,255,255,0.95), 0 0 0 4px rgba(0,157,219,0.55), 0 2px 8px ${presetHex}66`
                      : 'inset 0 0 0 1px rgba(15,23,42,0.10), inset 0 1px 2px rgba(255,255,255,0.30), 0 1px 3px rgba(15,23,42,0.10)',
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }
);
ColorSwatch.displayName = 'ColorSwatch';
