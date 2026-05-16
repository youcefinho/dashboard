// ── Switch — toggle iOS-style premium gradient brand ─────────
// Sprint 23 wave 30 — primitive UI essentielle pour Settings/Builders
// Pattern : <button role="switch"> natif pour accessibilité keyboard + focus
import {
  forwardRef,
  useId,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { cn } from '@/lib/cn';
// Sprint 25 vague 4B — feedback sensoriel sur toggle
import { playSound, triggerHaptic } from '@/lib/sensorial';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Label affiché à droite du toggle */
  label?: string;
  /** Description sous le label (subtitle) */
  description?: string;
  /** Couleur sémantique du state ON */
  variant?: 'brand' | 'success' | 'danger';
  className?: string;
  /** ID pour htmlFor accessibility */
  id?: string;
  name?: string;
}

type VariantColors = {
  /** Gradient ON track */
  trackOn: string;
  /** External glow color */
  glow: string;
  /** Focus ring color */
  ring: string;
};

const VARIANTS: Record<NonNullable<SwitchProps['variant']>, VariantColors> = {
  brand: {
    trackOn:
      'linear-gradient(135deg, #00B5F5 0%, #009DDB 55%, #0086C0 100%)',
    glow: 'rgba(0,157,219,0.45)',
    ring: 'rgba(0,157,219,0.30)',
  },
  success: {
    trackOn:
      'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)',
    glow: 'rgba(16,185,129,0.45)',
    ring: 'rgba(16,185,129,0.30)',
  },
  danger: {
    trackOn:
      'linear-gradient(135deg, #F87171 0%, #E93D3D 55%, #B91C1C 100%)',
    glow: 'rgba(233,61,61,0.45)',
    ring: 'rgba(233,61,61,0.30)',
  },
};

const SIZES = {
  sm: {
    trackW: 40,
    trackH: 22,
    thumb: 18,
    translate: 18,
    labelText: 'text-sm',
    descText: 'text-[11px]',
  },
  md: {
    trackW: 52,
    trackH: 28,
    thumb: 24,
    translate: 24,
    labelText: 'text-sm',
    descText: 'text-xs',
  },
} as const;

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked,
      onCheckedChange,
      disabled = false,
      size = 'md',
      label,
      description,
      variant = 'brand',
      className,
      id,
      name,
    },
    ref
  ) => {
    const reactId = useId();
    const switchId = id ?? `switch-${reactId}`;
    const labelId = label ? `${switchId}-label` : undefined;
    const descId = description ? `${switchId}-desc` : undefined;
    const colors = VARIANTS[variant];
    const dims = SIZES[size];

    const handleToggle = () => {
      if (disabled) return;
      // Sprint 25 vague 4B — feedback sensoriel
      playSound('toggle');
      triggerHaptic('light');
      onCheckedChange(!checked);
    };

    const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      handleToggle();
    };

    const handleKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      // Space déclenche le toggle (Enter est géré par le <button> natif mais
      // on garde la même sémantique pour switch)
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        handleToggle();
      }
    };

    // Track style (inline pour gradient dynamique selon variant)
    const trackStyle: CSSProperties = checked
      ? {
          width: dims.trackW,
          height: dims.trackH,
          background: colors.trackOn,
          boxShadow: `0 0 0 0 transparent, 0 2px 10px ${colors.glow}, inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -1px 2px rgba(0,0,0,0.10)`,
          borderColor: 'transparent',
        }
      : {
          width: dims.trackW,
          height: dims.trackH,
          background: 'rgba(0,0,0,0.08)',
          boxShadow:
            'inset 0 1px 2px rgba(15,23,42,0.10), inset 0 0 0 1px rgba(0,157,219,0.06)',
          borderColor: 'rgba(0,157,219,0.10)',
        };

    const thumbOffset = checked ? dims.translate : 2;

    const thumbStyle: CSSProperties = {
      width: dims.thumb,
      height: dims.thumb,
      transform: `translateX(${thumbOffset}px)`,
      transition: 'transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      boxShadow: checked
        ? '0 2px 8px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.85)'
        : '0 2px 6px rgba(0,0,0,0.20), 0 0 0 0.5px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.85)',
    };

    const focusRingStyle: CSSProperties = {
      // Le focus-visible est rendu via :focus-visible CSS pseudo-class
      // via une variable que l'on expose pour le ring color
      ['--switch-ring' as string]: colors.ring,
    };

    const button = (
      <button
        ref={ref}
        type="button"
        role="switch"
        id={switchId}
        name={name}
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        aria-labelledby={labelId}
        aria-describedby={descId}
        data-state={checked ? 'checked' : 'unchecked'}
        data-disabled={disabled || undefined}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{ ...trackStyle, ...focusRingStyle }}
        className={cn(
          'switch-premium relative inline-flex shrink-0 items-center rounded-full border',
          'transition-[background,box-shadow,border-color] duration-250 ease-out',
          'focus-visible:outline-none',
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer hover:brightness-[1.03]',
          !label && !description && className,
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none block rounded-full bg-white"
          style={thumbStyle}
        />
      </button>
    );

    if (!label && !description) {
      return button;
    }

    return (
      <div className={cn('inline-flex items-start gap-3', disabled && 'cursor-not-allowed', className)}>
        {button}
        <div className="flex flex-col leading-tight select-none">
          {label && (
            <label
              id={labelId}
              htmlFor={switchId}
              className={cn(
                'font-semibold text-[var(--text-primary)] cursor-pointer',
                dims.labelText,
                disabled && 'cursor-not-allowed opacity-70',
              )}
            >
              {label}
            </label>
          )}
          {description && (
            <span
              id={descId}
              className={cn(
                'text-[var(--text-muted)] mt-0.5',
                dims.descText,
                disabled && 'opacity-70',
              )}
            >
              {description}
            </span>
          )}
        </div>
      </div>
    );
  }
);
Switch.displayName = 'Switch';
