// ── SwipeAction — Sprint 23 wave 43 visual refresh ───────────────────────────
// Garde l'API existante (rightActions/leftActions, rightThreshold/leftThreshold).
// Améliorations :
//  - Background gradient progressive selon l'offset (sweep coloré qui grandit)
//  - Spring snap dramatique cubic-bezier(0.34, 1.56, 0.64, 1) (overshoot léger)
//  - Haptic feedback centralisé via triggerHaptic('medium') au seuil franchi (Sprint 25 4B)
//  - Action chips reçoivent scale 0→1 + fade-in pendant le swipe progressif
import { useState, useRef, useEffect, type CSSProperties, type ReactNode, type TouchEvent } from 'react';
import { triggerHaptic } from '@/lib/sensorial';

interface SwipeActionProps {
  children: ReactNode;
  rightActions?: ReactNode;
  leftActions?: ReactNode;
  rightThreshold?: number; // Distance in px to fully open right actions
  leftThreshold?: number;
  /** Couleur background sweep (gauche). default brand cyan */
  leftBg?: string;
  /** Couleur background sweep (droite). default brand orange */
  rightBg?: string;
}

export function SwipeAction({
  children,
  rightActions,
  leftActions,
  rightThreshold = 80,
  leftThreshold = 80,
  leftBg = 'rgba(0,157,219,0.85)',
  rightBg = 'rgba(217,110,39,0.85)',
}: SwipeActionProps) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [thresholdCrossed, setThresholdCrossed] = useState(false);

  const startX = useRef(0);
  const currentX = useRef(0);
  const startOffset = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastThresholdSide = useRef<'left' | 'right' | null>(null);

  // Respecte prefers-reduced-motion : pas d'overshoot agressif
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  // Sprint 25 vague 4B — délègue à lib/sensorial (respecte settings + reduced-motion)
  const fireHaptic = () => triggerHaptic('medium');

  const handleTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      startX.current = touch.clientX;
    }
    startOffset.current = offset;
    setIsDragging(true);
    setThresholdCrossed(false);
    lastThresholdSide.current = null;
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    if (touch) {
      currentX.current = touch.clientX;
    }
    const diff = currentX.current - startX.current;

    let newOffset = startOffset.current + diff;

    // Limits
    if (!rightActions && newOffset < 0) newOffset = 0;
    if (!leftActions && newOffset > 0) newOffset = 0;

    // Max stretch
    if (newOffset > leftThreshold + 20) newOffset = leftThreshold + 20;
    if (newOffset < -rightThreshold - 20) newOffset = -rightThreshold - 20;

    // Haptic au franchissement du seuil (changement d'état)
    const crossedLeft = newOffset > leftThreshold / 2 && !!leftActions;
    const crossedRight = newOffset < -rightThreshold / 2 && !!rightActions;
    const nowCrossed = crossedLeft || crossedRight;
    const side: 'left' | 'right' | null = crossedLeft ? 'left' : crossedRight ? 'right' : null;
    if (nowCrossed && side !== lastThresholdSide.current) {
      fireHaptic();
      lastThresholdSide.current = side;
    } else if (!nowCrossed && lastThresholdSide.current !== null) {
      lastThresholdSide.current = null;
    }
    setThresholdCrossed(nowCrossed);

    setOffset(newOffset);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);

    // Snap
    if (offset > leftThreshold / 2 && leftActions) {
      setOffset(leftThreshold);
    } else if (offset < -rightThreshold / 2 && rightActions) {
      setOffset(-rightThreshold);
    } else {
      setOffset(0);
    }
  };

  // ── Progression normalisée (0 → 1+) selon le swipe ────────────────────────
  const progress = (() => {
    if (offset > 0 && leftActions) return Math.min(offset / leftThreshold, 1.15);
    if (offset < 0 && rightActions) return Math.min(-offset / rightThreshold, 1.15);
    return 0;
  })();
  const side: 'left' | 'right' | 'none' = offset > 0 ? 'left' : offset < 0 ? 'right' : 'none';
  const swipeColor = side === 'left' ? leftBg : rightBg;

  // Background gradient : sweep coloré qui grandit. Pendant le swipe la zone
  // colorée est proportionnelle à |offset| / threshold.
  const bgWidthPct = Math.min(progress * 100, 100);
  const backgroundStyle: CSSProperties =
    side === 'left'
      ? {
          background: `linear-gradient(90deg, ${swipeColor} 0%, ${swipeColor} ${bgWidthPct}%, transparent ${bgWidthPct}%, transparent 100%)`,
        }
      : side === 'right'
      ? {
          background: `linear-gradient(270deg, ${swipeColor} 0%, ${swipeColor} ${bgWidthPct}%, transparent ${bgWidthPct}%, transparent 100%)`,
        }
      : {};

  // Spring snap au release : overshoot léger via cubic-bezier(0.34, 1.56, 0.64, 1)
  // Reduced motion → courbe linéaire douce.
  const releaseTransition = reducedMotion
    ? 'transform 0.18s ease-out'
    : 'transform 0.36s cubic-bezier(0.34, 1.56, 0.64, 1)';

  // Action chips fade/scale progressifs (clamp 0..1 pendant drag, 1 quand snapped)
  const chipProgress = isDragging ? Math.min(progress, 1) : offset !== 0 ? 1 : 0;
  const chipScale = 0.6 + chipProgress * 0.4; // 0.6 → 1
  const chipOpacity = chipProgress;
  const chipTransition = isDragging
    ? 'none'
    : reducedMotion
    ? 'transform 0.18s ease-out, opacity 0.18s ease-out'
    : 'transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.22s ease-out';

  const leftChipsStyle: CSSProperties = {
    transform: `scale(${side === 'left' ? chipScale : 0.6})`,
    opacity: side === 'left' ? chipOpacity : 0,
    transition: chipTransition,
    transformOrigin: 'left center',
  };
  const rightChipsStyle: CSSProperties = {
    transform: `scale(${side === 'right' ? chipScale : 0.6})`,
    opacity: side === 'right' ? chipOpacity : 0,
    transition: chipTransition,
    transformOrigin: 'right center',
  };

  // Pulse léger sur la zone background quand le seuil est franchi (feedback "armed")
  const armedBoost = thresholdCrossed && isDragging ? 'inset 0 0 24px rgba(255,255,255,0.18)' : 'none';

  return (
    <div className="relative overflow-hidden w-full" ref={containerRef}>
      {/* Background sweep progressive */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          ...backgroundStyle,
          boxShadow: armedBoost,
          transition: isDragging ? 'none' : 'background 0.24s ease-out, box-shadow 0.18s ease-out',
        }}
      />

      {/* Action chips (overlay) */}
      <div className="absolute inset-0 flex items-center justify-between z-[1] px-2 pointer-events-none">
        <div
          className={`h-full flex items-center ${side === 'left' ? 'pointer-events-auto' : ''}`}
          style={leftChipsStyle}
        >
          {leftActions}
        </div>
        <div
          className={`h-full flex items-center ${side === 'right' ? 'pointer-events-auto' : ''}`}
          style={rightChipsStyle}
        >
          {rightActions}
        </div>
      </div>

      {/* Content (Foreground) */}
      <div
        className="relative z-10 bg-[var(--bg-canvas)]"
        style={{
          transform: `translateX(${offset}px)`,
          transition: isDragging ? 'none' : releaseTransition,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (offset !== 0) setOffset(0); // Click outside actions closes the swipe
        }}
      >
        {children}
      </div>
    </div>
  );
}
