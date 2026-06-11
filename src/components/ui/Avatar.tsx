// ── Avatar — Stripe-clean (Sprint 38) ───────────────────────────────────────
// Container monochromatique gray-200 + initiale gray-700, status dot subtle.
// Pas de gradient cyan→orange, halo glow, ring premium gradient.
// Ring="hot" conservé en signature Intralys (border 2px brand-orange).
// Ring="active" : border 2px primary purple.
// API publique 100% préservée : name, src, size, ring, status, onClick,
// tooltip, animate, bordered, className, style, aria-label.

import {
  forwardRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
} from 'react';
import { cn } from '@/lib/cn';
import { Tooltip } from './Tooltip';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AvatarRing = 'hot' | 'active' | 'none';
export type AvatarStatus = 'online' | 'away' | 'busy' | 'offline' | 'typing';

interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  /** Ring autour de l'avatar — 'hot' = brand orange (signature hot leads), 'active' = primary */
  ring?: AvatarRing;
  /** Status dot bottom-right — online/away/busy/offline/typing */
  status?: AvatarStatus;
  /** Clickable button mode */
  onClick?: () => void;
  /** Wrap avec Tooltip primitive sur hover */
  tooltip?: string;
  /** Fade-in 200ms à l'apparition */
  animate?: boolean;
  /** Border 2px séparation visuelle (AvatarGroup) */
  bordered?: boolean;
  className?: string;
  /** Style inline forwardé (utilisé pour viewTransitionName Sprint 35) */
  style?: CSSProperties;
  'aria-label'?: string;
}

// Sizes : xs (24) / sm (28) / md (32) / lg (40) / xl (48)
const sizeMap: Record<AvatarSize, { dim: string; font: string }> = {
  xs: { dim: 'w-6 h-6', font: '10px' },
  sm: { dim: 'w-7 h-7', font: '12px' },
  md: { dim: 'w-8 h-8', font: '14px' },
  lg: { dim: 'w-10 h-10', font: '16px' },
  xl: { dim: 'w-12 h-12', font: '20px' },
};

// Taille du dot status (responsive selon avatar size)
const statusDotSize: Record<AvatarSize, string> = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2 h-2',
  md: 'w-2 h-2',
  lg: 'w-2.5 h-2.5',
  xl: 'w-3 h-3',
};

interface StatusVisual {
  bg: string;
  pulse: boolean;
}

function getStatusVisual(status: AvatarStatus): StatusVisual {
  switch (status) {
    case 'online':
      return { bg: 'var(--success)', pulse: false };
    case 'away':
      return { bg: 'var(--warning)', pulse: false };
    case 'busy':
      return { bg: 'var(--danger)', pulse: false };
    case 'offline':
      return { bg: 'var(--gray-400)', pulse: false };
    case 'typing':
      return { bg: 'var(--primary)', pulse: true };
  }
}

function resolveRingBorder(ring: AvatarRing): string | undefined {
  switch (ring) {
    case 'hot':
      return '2px solid var(--brand-orange)';
    case 'active':
      return '2px solid var(--primary)';
    case 'none':
    default:
      return undefined;
  }
}

export const Avatar = forwardRef<HTMLElement, AvatarProps>(function Avatar(
  {
    name,
    src,
    size = 'md',
    ring = 'none',
    status,
    onClick,
    tooltip,
    animate = false,
    bordered = false,
    className,
    style: styleProp,
    'aria-label': ariaLabel,
  },
  ref,
) {
  const [imageFailed, setImageFailed] = useState(false);

  const initial = (name || '?').charAt(0).toUpperCase();
  const sizeCfg = sizeMap[size];

  const interactive = typeof onClick === 'function';

  const ringBorder = resolveRingBorder(ring);

  // Style commun container
  const containerStyle: CSSProperties = {
    transition: `transform var(--duration-base) var(--ease), box-shadow var(--duration-base) var(--ease)`,
    ...(animate ? { animation: `fadeIn var(--duration-base) var(--ease) both` } : {}),
    // Ring : border 2px (subtle Stripe)
    ...(ringBorder ? { border: ringBorder } : {}),
    // Bordered (AvatarGroup) — separator ring blanc 2px
    ...(bordered && !ringBorder
      ? { boxShadow: '0 0 0 2px var(--bg-surface)' }
      : {}),
    // Style inline parent (viewTransitionName, etc.)
    ...(styleProp ?? {}),
  };

  const interactiveClass = interactive
    ? 'cursor-pointer hover:opacity-90 focus-visible:outline-none active:scale-95'
    : '';

  const baseClass = cn(
    'rounded-full shrink-0 relative inline-flex p-0 items-center justify-center overflow-hidden',
    sizeCfg.dim,
    interactiveClass,
    className,
  );

  // Inner visual : image ou initiale
  const showImage = !!src && !imageFailed;
  const visual = showImage ? (
    <img
      src={src}
      alt={name}
      onError={() => setImageFailed(true)}
      className="w-full h-full object-cover"
      draggable={false}
    />
  ) : (
    <div
      className="w-full h-full flex items-center justify-center select-none"
      style={{
        background: 'var(--gray-200)',
        color: 'var(--gray-700)',
        fontWeight: 600,
        fontSize: sizeCfg.font,
        letterSpacing: 0,
      }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );

  const statusNode = status ? <StatusDot status={status} size={size} /> : null;

  const accessibleLabel = ariaLabel ?? name;

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };

  const handleFocus = (e: ReactFocusEvent<HTMLElement>) => {
    if (!interactive) return;
    (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px var(--primary-ring)';
  };
  const handleBlur = (e: ReactFocusEvent<HTMLElement>) => {
    if (!interactive) return;
    // Restore bordered shadow if applicable
    if (bordered && !ringBorder) {
      (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 2px var(--bg-surface)';
    } else {
      (e.currentTarget as HTMLElement).style.boxShadow = '';
    }
  };

  let element: ReactElement;
  if (interactive) {
    element = (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        className={baseClass}
        style={containerStyle}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        aria-label={accessibleLabel}
        title={tooltip ? undefined : name}
      >
        {visual}
        {statusNode}
      </button>
    );
  } else {
    element = (
      <div
        ref={ref as Ref<HTMLDivElement>}
        className={baseClass}
        style={containerStyle}
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel}
        title={tooltip ? undefined : name}
      >
        {visual}
        {statusNode}
      </div>
    );
  }

  if (tooltip) {
    return <Tooltip content={tooltip}>{element}</Tooltip>;
  }

  return element;
});

// ── Status dot ──────────────────────────────────────────────────────────────
interface StatusDotProps {
  status: AvatarStatus;
  size: AvatarSize;
}

function StatusDot({ status, size }: StatusDotProps) {
  const visual = getStatusVisual(status);

  const dotStyle: CSSProperties = {
    background: visual.bg,
    border: '2px solid var(--bg-surface)',
    animation: visual.pulse ? 'pulse-dot 1.4s ease-in-out infinite' : undefined,
  };

  return (
    <span
      role="status"
      aria-label={`Status: ${status}`}
      className={cn(
        'absolute bottom-0 right-0 rounded-full block',
        statusDotSize[size],
      )}
      style={dotStyle}
    />
  );
}
