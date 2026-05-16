// ── RFM — helpers UI/i18n — Sprint E7 M3 ─────────────────────
// Mapping pur segment RFM → clé i18n (catalogues shop.rfm.*) + variant
// Tag (couleur sobre Stripe). AUCUNE logique de scoring ici : le calcul
// RFM vit côté worker (M1 metrics / M2 recompute). Ce module est
// strictement présentationnel, partagé Clients.tsx + BoutiqueDashboard
// (zéro duplication). RfmSegment = union E1 (RFM_SEGMENTS), importée.

import type { RfmSegment } from './types';

/** Clé i18n du libellé lisible d'un segment (catalogues shop.rfm.*). */
export function rfmSegmentLabelKey(seg: RfmSegment): string {
  return `shop.rfm.${seg}`;
}

type TagVariant =
  | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

/**
 * Variant Tag par segment — palette sobre (pas de glow/gradient brand).
 * Vert = clients à valeur · Ambre = vigilance · Rouge = perte · Gris = froid.
 */
export function rfmSegmentVariant(seg: RfmSegment): TagVariant {
  switch (seg) {
    case 'champions': return 'success';
    case 'loyal': return 'success';
    case 'potential_loyalist': return 'brand';
    case 'new': return 'info';
    case 'promising': return 'info';
    case 'needs_attention': return 'warning';
    case 'at_risk': return 'warning';
    case 'hibernating': return 'neutral';
    case 'lost': return 'danger';
    default: return 'neutral';
  }
}

/** Couleur CSS var pour les barres du widget de répartition (sobre). */
export function rfmSegmentColor(seg: RfmSegment): string {
  switch (seg) {
    case 'champions': return 'var(--success)';
    case 'loyal': return 'var(--success)';
    case 'potential_loyalist': return 'var(--primary)';
    case 'new': return 'var(--info, var(--primary))';
    case 'promising': return 'var(--info, var(--primary))';
    case 'needs_attention': return 'var(--warning)';
    case 'at_risk': return 'var(--warning)';
    case 'hibernating': return 'var(--text-muted)';
    case 'lost': return 'var(--danger)';
    default: return 'var(--text-muted)';
  }
}
