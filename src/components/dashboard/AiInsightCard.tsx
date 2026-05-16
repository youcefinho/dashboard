// ── AiInsightCard — Sprint 28 → Sprint 49 M2.4 ───────────────────────────────
// Carte AI insight contextuelle (Dashboard).
//
// Sprint 49 M2.4 : refonte Stripe SUBTLE (post-RESET Sprint 38). Plus de
// glow / orb / gradient brand massif. Surface blanche + border + accent
// border-left 3px color-coded par SÉVÉRITÉ (pas par variant). Registry des
// 8 variants centralisé dans src/lib/aiInsights.ts.
//
// API publique 100% préservée : props { type, title, description, actionLabel,
// onAction, onDismiss, delay }. Les anciens type-strings (hot-lead, stuck-deal,
// week-wins, dormant-leads-30d, pipeline-velocity-drop) restent acceptés via
// un alias de compatibilité.

import { X, Sparkles, ArrowRight } from 'lucide-react';
import { Icon } from '@/components/ui';
import {
  INSIGHT_VARIANTS,
  severityClass,
  type InsightVariant,
} from '@/lib/aiInsights';

// ── Compat : anciens identifiants Sprint 28/30 → nouveaux variants ──
const LEGACY_ALIAS: Record<string, InsightVariant> = {
  'hot-lead': 'hot-lead',
  'stuck-deal': 'bottleneck',
  'week-wins': 'week-wins',
  'dormant-leads-30d': 'dormant',
  'pipeline-velocity-drop': 'velocity-drop',
};

/** Type accepté en prop : nouveaux variants OU anciens identifiants. */
export type AiInsightType = InsightVariant | keyof typeof LEGACY_ALIAS;

interface AiInsightCardProps {
  type: AiInsightType;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  /** Délai d'animation staggeré (ms). */
  delay?: number;
}

function resolveVariant(type: AiInsightType): InsightVariant {
  if (type in INSIGHT_VARIANTS) return type as InsightVariant;
  return LEGACY_ALIAS[type] ?? 'dormant';
}

export function AiInsightCard({
  type,
  title,
  description,
  actionLabel,
  onAction,
  onDismiss,
  delay = 0,
}: AiInsightCardProps) {
  const variant = resolveVariant(type);
  const meta = INSIGHT_VARIANTS[variant] ?? INSIGHT_VARIANTS.dormant;
  const VariantIcon = meta.icon;

  return (
    <div
      className={`ai-insight-card ${severityClass(meta.severity)}`}
      style={{ animationDelay: `${delay}ms` }}
      role="article"
      aria-label={`Insight AI — ${meta.ariaKind} : ${title}`}
    >
      {/* Header */}
      <div className="ai-insight-card__head">
        <div className="ai-insight-card__kicker">
          <span className="ai-insight-card__icon" aria-hidden>
            <Icon as={VariantIcon} size={13} />
          </span>
          <span className="ai-insight-card__tag">
            <Icon as={Sparkles} size={10} />
            Insight AI
          </span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="ai-insight-card__dismiss"
            aria-label="Fermer l'insight"
          >
            <Icon as={X} size={13} />
          </button>
        )}
      </div>

      {/* Contenu */}
      <h4 className="ai-insight-card__title">
        <span aria-hidden>{meta.emoji}</span> {title}
      </h4>
      <p className="ai-insight-card__desc">{description}</p>

      {/* CTA — Stripe sober (texte + flèche, pas de gradient) */}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          className="ai-insight-card__cta"
        >
          <span>{actionLabel}</span>
          <Icon as={ArrowRight} size={12} className="ai-insight-card__cta-arrow" />
        </button>
      )}
    </div>
  );
}
