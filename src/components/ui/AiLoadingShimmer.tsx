// ── AiLoadingShimmer — Inline AI loading dots (Sprint 34 vague 34-3A) ─────
// Composant inline pour signaler "AI génère..." (réutilisable AiDrafts,
// AiInsightCard, etc.). 3 dots qui pulsent en gradient brand staggered
// 200ms via `ai-shimmer-dots` 1.2s loop. Optional text "AI réfléchit..."
// en italic muted. Respect prefers-reduced-motion : dots statiques.

import { cn } from '@/lib/cn';

interface AiLoadingShimmerProps {
  /** Texte optionnel à droite des dots (default: "AI réfléchit...") */
  text?: string | null;
  /** Skip le texte (just dots) */
  textless?: boolean;
  /** Taille des dots — `sm`=4px, `md`=6px (default), `lg`=8px */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Aria-label custom (default: text or "AI en cours") */
  ariaLabel?: string;
}

export function AiLoadingShimmer({
  text = 'AI réfléchit...',
  textless = false,
  size = 'md',
  className,
  ariaLabel,
}: AiLoadingShimmerProps) {
  const sizeClass =
    size === 'sm' ? 'ai-loading-shimmer--sm'
    : size === 'lg' ? 'ai-loading-shimmer--lg'
    : '';

  return (
    <span
      className={cn('ai-loading-shimmer', sizeClass, className)}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel || (textless ? 'AI en cours' : text || 'AI en cours')}
    >
      <span className="ai-shimmer-dots" aria-hidden>
        <span className="ai-shimmer-dot" />
        <span className="ai-shimmer-dot" />
        <span className="ai-shimmer-dot" />
      </span>
      {!textless && text && (
        <span className="ai-shimmer-text">{text}</span>
      )}
    </span>
  );
}
