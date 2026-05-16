// ── Icon — Primitive wrapper Lucide (Sprint 25 vague 3A) ────────────────────
// Stroke 1.75 signature Linear/Superhuman par défaut (au lieu du 2 Lucide).
// Sizes normalisées xs|sm|md|lg|xl pour éviter les 9/11/13/15/22 aberrants.
//
// Risk-mitigation : si la taille rendue est < 14px, on FORCE strokeWidth=2
// (Lucide devient illisible à stroke 1.75 sous 14px). Ce comportement est
// implicite et override-able via la prop strokeWidth (manuel).
//
// Usage :
//   import { Pencil } from 'lucide-react';
//   import { Icon } from '@/components/ui';
//   <Icon as={Pencil} />                 // 16px stroke 1.75
//   <Icon as={Pencil} size="lg" />       // 20px stroke 1.75
//   <Icon as={Pencil} size={18} />       // 18px stroke 1.75 (override num)
//   <Icon as={Pencil} size="xs" />       // 12px → stroke forcé 2 (lisibilité)
//
// API exporte aussi `iconSizePx('lg') === 20` pour cas spéciaux (button height match).

import type { SVGAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const ICON_SIZES: Record<IconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, 'children'> {
  /** Composant Lucide React (ex: Pencil, Check, Settings2) */
  as: LucideIcon;
  /** Taille standard ou pixels custom. Default 'md' (16px). */
  size?: IconSize | number;
  /** Override stroke. Default 1.75 (signature Linear). Forcé à 2 si rendu <14px. */
  strokeWidth?: number;
}

/** Icon primitive — stroke 1.75 unifié + sizes normalisées. Sprint 25 vague 3A. */
export function Icon({ as: As, size = 'md', strokeWidth = 1.75, ...rest }: IconProps) {
  const px = typeof size === 'number' ? size : ICON_SIZES[size];
  // Lisibilité : sous 14px, stroke 1.75 devient flou. Force 2.
  const finalStroke = px < 14 ? 2 : strokeWidth;
  return <As size={px} strokeWidth={finalStroke} absoluteStrokeWidth {...rest} />;
}

/** Retourne la valeur px d'un IconSize symbolique. Utile pour custom layouts. */
export function iconSizePx(size: IconSize): number {
  return ICON_SIZES[size];
}
