// ── aiInsights — Sprint 49 M2.4 ─────────────────────────────────────────────
// Registry des 8 variants d'AI Insight Cards (Dashboard).
//
// Étend les variants Sprint 27/30/36 (dormant / velocity-drop préservés) sans
// rupture : les anciens `AiInsightType` restent valides via un alias de
// compatibilité (cf. AiInsightCard.tsx).
//
// Chaque variant définit : icon, sévérité (→ couleur accent border-left 3px
// Stripe sober, PAS de glow), et un emoji léger optionnel. Le texte (headline /
// description / CTA) reste construit par l'appelant (Dashboard) avec les vraies
// données — ici on ne définit que la PRÉSENTATION + le contrat.

import type { LucideIcon } from 'lucide-react';
import {
  Flame,
  AlertTriangle,
  PartyPopper,
  Moon,
  TrendingDown,
  Activity,
  GitBranch,
  Target,
  ShieldAlert,
  Timer,
} from 'lucide-react';

export type InsightSeverity = 'positive' | 'info' | 'warning' | 'critical';

export type InsightVariant =
  // ── Variants Sprint 27/30/36 préservés ──
  | 'dormant'
  | 'velocity-drop'
  // ── Sprint 49 M2 — nouveaux ──
  | 'anomaly'
  | 'bottleneck'
  | 'forecast'
  | 'opportunity'
  | 'risk'
  | 'efficiency'
  // ── Variants historiques additionnels (back-compat Dashboard) ──
  | 'hot-lead'
  | 'week-wins';

export interface InsightVariantMeta {
  icon: LucideIcon;
  /** Sévérité → couleur accent (border-left 3px) Stripe sober. */
  severity: InsightSeverity;
  /** Emoji léger affiché devant le titre (sobre, optionnel). */
  emoji: string;
  /** Libellé d'accessibilité court. */
  ariaKind: string;
}

export const INSIGHT_VARIANTS: Record<InsightVariant, InsightVariantMeta> = {
  // ── Préservés ──
  'hot-lead': {
    icon: Flame,
    severity: 'warning',
    emoji: '🔥',
    ariaKind: 'leads chauds',
  },
  'week-wins': {
    icon: PartyPopper,
    severity: 'positive',
    emoji: '🎉',
    ariaKind: 'conversions de la semaine',
  },
  dormant: {
    icon: Moon,
    severity: 'info',
    emoji: '💤',
    ariaKind: 'leads dormants',
  },
  'velocity-drop': {
    icon: TrendingDown,
    severity: 'warning',
    emoji: '📉',
    ariaKind: 'vélocité pipeline en baisse',
  },
  // ── Sprint 49 M2 ──
  anomaly: {
    icon: Activity,
    severity: 'warning',
    emoji: '📊',
    ariaKind: 'anomalie d\'activité',
  },
  bottleneck: {
    icon: GitBranch,
    severity: 'warning',
    emoji: '🚧',
    ariaKind: 'goulot pipeline',
  },
  forecast: {
    icon: Target,
    severity: 'info',
    emoji: '🎯',
    ariaKind: 'prévision de fermetures',
  },
  opportunity: {
    icon: Flame,
    severity: 'positive',
    emoji: '✨',
    ariaKind: 'opportunités à saisir',
  },
  risk: {
    icon: ShieldAlert,
    severity: 'critical',
    emoji: '⚠️',
    ariaKind: 'deals à risque',
  },
  efficiency: {
    icon: Timer,
    severity: 'info',
    emoji: '⏱️',
    ariaKind: 'efficacité de réponse',
  },
};

/** Liste ordonnée des 8 variants principaux (pour audit / docs). */
export const INSIGHT_VARIANT_ORDER: InsightVariant[] = [
  'dormant',
  'velocity-drop',
  'anomaly',
  'bottleneck',
  'forecast',
  'opportunity',
  'risk',
  'efficiency',
];

/** Sévérité → suffixe de classe CSS accent (border-left 3px). */
export function severityClass(severity: InsightSeverity): string {
  return `ai-insight-card--${severity}`;
}

export { AlertTriangle };
