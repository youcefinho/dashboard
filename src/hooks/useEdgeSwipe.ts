// ── useEdgeSwipe — Sprint 30 vague 30-3A ────────────────────────────────────
// Détecte un swipe horizontal qui débute depuis le bord gauche de l'écran
// (clientX < edgeWidth) et dépasse `threshold` px vers la droite.
//
// UX : permet "swipe back" iOS-style sur mobile pour revenir en arrière.
// Le hook écoute les events `touchstart/touchmove/touchend` sur window.
//
// Inspirations : Safari iOS back-swipe, Telegram chat back-gesture.
//
// Heuristiques :
//   - touchstart clientX < edgeWidth (default 20px)
//   - track delta horizontal vs vertical (abort si plus vertical que horizontal)
//   - exposer `progress` 0→1 pour overlay glow visuel pendant le drag
//   - threshold 100px → fire onSwipeBack + haptic medium
//   - threshold/2 atteint → haptic light (feedback "engagé")
//   - auto-disable si pointer != coarse (desktop no-op)
//   - lib/sensorial respecte prefers-reduced-motion / settings haptic OFF

import { useEffect, useRef, useState } from 'react';
import { triggerHaptic } from '@/lib/sensorial';

interface UseEdgeSwipeOptions {
  /** Callback déclenché quand le swipe atteint `threshold` px. */
  onSwipeBack: () => void;
  /** Distance (px) à partir du bord gauche pour considérer un edge-touch. Default 20. */
  edgeWidth?: number;
  /** Distance horizontale (px) minimale pour fire le callback. Default 100. */
  threshold?: number;
  /** Désactive le hook (ex: certaines routes). */
  disabled?: boolean;
}

interface UseEdgeSwipeReturn {
  /** True pendant qu'un swipe edge est actif (touch down + drag). */
  isSwiping: boolean;
  /** Distance horizontale actuelle (px), 0 quand inactif. */
  swipeX: number;
  /** Progression 0→1 vers le `threshold`. */
  progress: number;
}

export function useEdgeSwipe({
  onSwipeBack,
  edgeWidth = 20,
  threshold = 100,
  disabled = false,
}: UseEdgeSwipeOptions): UseEdgeSwipeReturn {
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeX, setSwipeX] = useState(0);

  const startX = useRef(0);
  const startY = useRef(0);
  const active = useRef(false);
  const midThresholdHaptic = useRef(false);
  const swipeXRef = useRef(0);

  // Coarse pointer (mobile) detection
  const [isCoarse, setIsCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const apply = () => setIsCoarse(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  useEffect(() => {
    if (disabled || !isCoarse || typeof window === 'undefined') return;

    const setX = (v: number) => {
      swipeXRef.current = v;
      setSwipeX(v);
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX < edgeWidth) {
        active.current = true;
        midThresholdHaptic.current = false;
        startX.current = t.clientX;
        startY.current = t.clientY;
        setIsSwiping(true);
        setX(0);
        triggerHaptic('light');
      }
    };

    const onMove = (e: TouchEvent) => {
      if (!active.current) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX.current;
      const dy = Math.abs(t.clientY - startY.current);
      // Si plus vertical que horizontal → abort (scroll vertical voulu)
      if (dy > Math.abs(dx) && dy > 24) {
        active.current = false;
        setIsSwiping(false);
        setX(0);
        return;
      }
      if (dx > 0) {
        setX(dx);
        if (!midThresholdHaptic.current && dx >= threshold / 2) {
          midThresholdHaptic.current = true;
          triggerHaptic('light');
        }
      }
    };

    const onEnd = () => {
      if (!active.current) return;
      active.current = false;
      const finalDx = swipeXRef.current;
      setIsSwiping(false);
      setX(0);
      if (finalDx >= threshold) {
        triggerHaptic('medium');
        onSwipeBack();
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [disabled, isCoarse, edgeWidth, threshold, onSwipeBack]);

  const progress = Math.min(swipeX / threshold, 1);

  return {
    isSwiping,
    swipeX,
    progress,
  };
}
