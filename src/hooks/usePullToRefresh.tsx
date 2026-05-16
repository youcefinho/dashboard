// ── usePullToRefresh — Sprint 28 vague 28-1B ──────────────────────────────
// Hook générique pull-to-refresh pour listes mobiles (touch-based).
// Affiche un indicateur spinner gradient brand qui descend depuis le top.
// Threshold configurable, bloque le double-pull, callback onRefresh async.
//
// Sprint 44 M3.3 — Haptic 'light' au déclenchement du refresh (respecte settings
// + reduced-motion via lib/sensorial). Cohérent avec autres gestures M3.

import { useState, useRef, useCallback, useEffect, type RefObject } from 'react';
import { triggerHaptic } from '@/lib/sensorial';

interface PullToRefreshOptions {
  /** Seuil en px pour déclencher le refresh (default: 64) */
  threshold?: number;
  /** Distance max du pull indicator en px (default: 100) */
  maxPull?: number;
  /** Désactiver le hook (ex: si pas mobile) */
  disabled?: boolean;
  /**
   * Sprint 30 vague 30-3C — Container scrollable parent à interroger pour `scrollTop`.
   * Si fourni, le hook utilise ce ref pour vérifier l'éligibilité du pull (au lieu
   * de `containerRef`). Utile quand le composant qui possède containerRef n'est pas
   * lui-même scrollable (ex: wrapper page sous un `#main-content` overflow-auto).
   */
  scrollParent?: { current: HTMLElement | null };
}

interface PullToRefreshReturn {
  /** Ref à attacher au container scrollable */
  containerRef: RefObject<HTMLDivElement | null>;
  /** true pendant le refresh async */
  isRefreshing: boolean;
  /** Distance actuelle du pull (0 quand inactif) */
  pullDistance: number;
  /** Ratio 0→1 de progression vers le seuil */
  pullProgress: number;
  /** JSX de l'indicateur à placer en haut du container */
  indicator: React.ReactNode;
}

export function usePullToRefresh(
  onRefresh: () => Promise<void>,
  options: PullToRefreshOptions = {}
): PullToRefreshReturn {
  const { threshold = 64, maxPull = 100, disabled = false, scrollParent } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startY = useRef(0);
  const isPulling = useRef(false);

  const pullProgress = Math.min(pullDistance / threshold, 1);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return;
    const container = containerRef.current;
    if (!container) return;
    // Sprint 30 vague 30-3C — délègue à scrollParent si fourni (page wrapper non-scrollable)
    const scrollHost = scrollParent?.current ?? container;
    if (scrollHost.scrollTop > 0) return;

    startY.current = e.touches[0]!.clientY;
    isPulling.current = true;
  }, [disabled, isRefreshing, scrollParent]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPulling.current || disabled || isRefreshing) return;

    const currentY = e.touches[0]!.clientY;
    const diff = currentY - startY.current;

    if (diff > 0) {
      // Résistance progressive (diminue avec la distance)
      const resistance = Math.max(0.3, 1 - diff / (maxPull * 3));
      const distance = Math.min(diff * resistance, maxPull);
      setPullDistance(distance);
      e.preventDefault();
    } else {
      isPulling.current = false;
      setPullDistance(0);
    }
  }, [disabled, isRefreshing, maxPull]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || disabled) return;
    isPulling.current = false;

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold * 0.6); // Garde le spinner visible pendant le refresh
      // Sprint 44 M3.3 — haptic 'light' au franchissement du threshold (respecte
      // settings haptic + reduced-motion via lib/sensorial).
      triggerHaptic('light');
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, isRefreshing, disabled, onRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || disabled) return;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, disabled]);

  // Indicateur JSX
  const indicator = (pullDistance > 0 || isRefreshing) ? (
    <div
      className="ptr-indicator"
      style={{
        height: pullDistance,
        opacity: isRefreshing ? 1 : pullProgress,
      }}
      aria-live="polite"
      aria-label={isRefreshing ? 'Rafraîchissement en cours' : 'Tirez pour rafraîchir'}
    >
      <div
        className={`ptr-spinner ${isRefreshing ? 'ptr-spinner--active' : ''}`}
        style={{
          transform: `rotate(${pullProgress * 360}deg) scale(${0.5 + pullProgress * 0.5})`,
        }}
      />
    </div>
  ) : null;

  return {
    containerRef,
    isRefreshing,
    pullDistance,
    pullProgress,
    indicator,
  };
}
