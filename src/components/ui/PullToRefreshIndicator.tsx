// ── PullToRefreshIndicator — Sprint 30 vague 30-3C ──────────────────────────
// Primitive visuelle factorisée pour `usePullToRefresh` (Sprint 28).
// Le hook expose déjà un `indicator` JSX inline, mais cette primitive permet :
//   1. Réutilisation hors hook (ex: refresh manuel via bouton + même UI)
//   2. Customisation (taille, label) sans toucher le hook
//   3. Source de vérité visuelle unifiée si on veut changer le spinner brand
//
// Usage typique avec le hook :
//   const { containerRef, pullDistance, pullProgress, isRefreshing } = usePullToRefresh(...);
//   <div ref={containerRef}>
//     <PullToRefreshIndicator distance={pullDistance} progress={pullProgress} isRefreshing={isRefreshing} />
//     ...
//   </div>

import type { CSSProperties } from 'react';

export interface PullToRefreshIndicatorProps {
  /** Distance actuelle du pull (px). Quand 0 et !isRefreshing → null. */
  distance: number;
  /** Progression 0→1 vers le seuil. */
  progress: number;
  /** True pendant le refresh async (post-threshold). */
  isRefreshing: boolean;
  /** Label aria-live. Default : 'Tirez pour rafraîchir' / 'Rafraîchissement…'. */
  label?: string;
  /** Style additionnel sur le container. */
  style?: CSSProperties;
}

export function PullToRefreshIndicator({
  distance,
  progress,
  isRefreshing,
  label,
  style,
}: PullToRefreshIndicatorProps) {
  if (distance <= 0 && !isRefreshing) return null;

  const ariaLabel = label ?? (isRefreshing ? 'Rafraîchissement en cours' : 'Tirez pour rafraîchir');

  return (
    <div
      className="ptr-indicator"
      style={{
        height: distance,
        opacity: isRefreshing ? 1 : progress,
        ...style,
      }}
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <div
        className={`ptr-spinner ${isRefreshing ? 'ptr-spinner--active' : ''}`}
        style={{
          transform: `rotate(${progress * 360}deg) scale(${0.5 + progress * 0.5})`,
        }}
      />
    </div>
  );
}
