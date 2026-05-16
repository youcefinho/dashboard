// ── Tag — Stripe-style chip (Sprint 38 RESET Phase 2 M1) ────────────────────
// Refonte visuelle :
//   - Plus de gradient brand solid, plus de glow, plus de halo inset blanc.
//   - Soft tints subtiles, border 1px à opacité 20 %, radius pill.
//   - Solid : background couleur full (sans dégradé), texte blanc.
// PRÉSERVE 100 % de l'API :
//   - children, variant (brand|success|warning|danger|info|neutral|accent),
//   - color (override hex), size (xs|sm|md), dot, pulse, solid,
//   - leftIcon, onRemove, onClick, className.

import type { ReactNode } from 'react';
import { CheckCircle2, Clock, XCircle, Info, Sparkles, AlertCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type TagVariant = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent' | 'default';
type TagSize = 'xs' | 'sm' | 'md';

interface TagProps {
  children: ReactNode;
  variant?: TagVariant;
  /** Couleur custom (hex/rgb/var) — override variant si fourni */
  color?: string;
  size?: TagSize;
  /** Affiche un dot indicateur à gauche (6px). */
  dot?: boolean;
  /** Icon optionnel à gauche (priorité sur dot). */
  leftIcon?: ReactNode;
  /** Removable — affiche × à droite et appelle onRemove. */
  onRemove?: () => void;
  /** Solid background couleur full (au lieu de soft). */
  solid?: boolean;
  /** Anime le dot (statut "live" / "nouveau"). */
  pulse?: boolean;
  className?: string;
  onClick?: () => void;
  /**
   * Sprint 40 40-1B — Affiche une icône Lucide à gauche selon le variant :
   * success → CheckCircle2 · warning → Clock · danger → XCircle ·
   * info/brand → Info · accent → Sparkles · neutral/default → aucune
   * Override-able via `statusIcon` direct (LucideIcon).
   * Priorité : statusIcon (custom) > statusIcon (auto from variant) > leftIcon > dot
   */
  statusIcon?: boolean | LucideIcon;
}

// Sprint 40 40-1B — Mapping variant → Lucide status icon
const STATUS_ICONS: Partial<Record<TagVariant, LucideIcon>> = {
  success: CheckCircle2,
  warning: Clock,
  danger: XCircle,
  info: Info,
  brand: Info,
  accent: Sparkles,
};

// Re-export pour usage externe / docs
export const TAG_STATUS_ICONS = { CheckCircle2, Clock, XCircle, Info, Sparkles, AlertCircle };

function resolveVariantColor(variant: TagVariant): string {
  switch (variant) {
    case 'brand':   return '#635BFF'; // primary Stripe purple
    case 'success': return '#1AAB59';
    case 'warning': return '#C7912C';
    case 'danger':  return '#CD3D64';
    case 'info':    return '#635BFF';
    case 'accent':  return '#D96E27';
    case 'neutral':
    case 'default': return '#697386'; // gray-500
  }
}

export function Tag({
  children,
  variant = 'default',
  color,
  size = 'sm',
  dot = false,
  leftIcon,
  onRemove,
  solid = false,
  pulse = false,
  className = '',
  onClick,
  statusIcon = false,
}: TagProps) {
  // Sprint 40 40-1B — Résoudre l'icône status selon variant
  const StatusIconComponent: LucideIcon | null = (() => {
    if (!statusIcon) return null;
    if (typeof statusIcon === 'function') return statusIcon;
    return STATUS_ICONS[variant] ?? null;
  })();
  const c = color ?? resolveVariantColor(variant);
  const isNeutral = !color && (variant === 'neutral' || variant === 'default');

  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-[10px] gap-1',
    sm: 'px-2 py-0.5 text-xs gap-1.5',
    md: 'px-2.5 py-1 text-sm gap-1.5',
  }[size];

  // Stripe-style : tint subtle (~14 %) ou solid plat ; border opacité 20 %.
  // Neutral utilise les vars gray Stripe pour rester cohérent.
  let bg: string;
  let border: string;
  let text: string;
  if (solid) {
    bg = c;
    border = `1px solid ${c}`;
    text = '#FFFFFF';
  } else if (isNeutral) {
    bg = 'var(--gray-100)';
    border = '1px solid var(--border)';
    text = 'var(--gray-700)';
  } else {
    bg = `color-mix(in srgb, ${c} 14%, transparent)`;
    border = `1px solid color-mix(in srgb, ${c} 20%, transparent)`;
    text = c;
  }

  const Component = onClick ? 'button' : 'span';

  return (
    <Component
      className={`inline-flex items-center font-medium ${sizeClasses} ${onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''} ${className}`}
      style={{
        background: bg,
        border,
        color: text,
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
      }}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      {StatusIconComponent ? (
        <span className="tag-status-icon" aria-hidden>
          <StatusIconComponent size={11} />
        </span>
      ) : leftIcon ? (
        <span className="inline-flex items-center justify-center shrink-0">{leftIcon}</span>
      ) : dot ? (
        <span
          aria-hidden
          className={`relative inline-block w-1.5 h-1.5 rounded-full shrink-0 ${pulse ? 'tag-dot-pulse' : ''}`}
          style={{
            background: solid ? '#FFFFFF' : c,
            ['--tag-dot-color' as any]: solid ? '#FFFFFF' : c,
          }}
        />
      ) : null}
      <span>{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="inline-flex items-center justify-center w-3 h-3 rounded-full opacity-60 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
          style={{ marginLeft: 2 }}
          aria-label="Retirer"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 1.5L6.5 6.5M6.5 1.5L1.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </Component>
  );
}
