// ── useLongPress — Sprint 23 wave 43 refresh ────────────────────────────────
// Garde l'API existante (onLongPress, onClick, options { shouldPreventDefault, delay })
// Ajouts non-breaking :
//   - `disabled` pour court-circuiter (ex: desktop non-coarse)
//   - `mobileOnly` (default false) : auto-disable si pointer != coarse
//   - haptic léger au déclenchement long-press si dispo
//   - annulation si l'utilisateur bouge (>10px) entre touchstart et le délai
import { useCallback, useEffect, useRef, useState } from 'react';
import { triggerHaptic } from '@/lib/sensorial';

interface UseLongPressOptions {
  shouldPreventDefault?: boolean;
  delay?: number;
  disabled?: boolean;
  mobileOnly?: boolean;
  /** Pixels de tolérance avant annulation par mouvement */
  moveTolerance?: number;
}

export function useLongPress(
  onLongPress: () => void,
  onClick?: () => void,
  {
    shouldPreventDefault = true,
    delay = 500,
    disabled = false,
    mobileOnly = false,
    moveTolerance = 10,
  }: UseLongPressOptions = {}
) {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const target = useRef<EventTarget | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);

  // Détection coarse pointer pour mobileOnly
  const [isCoarse, setIsCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const apply = () => setIsCoarse(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  const effectivelyDisabled = disabled || (mobileOnly && !isCoarse);

  // Sprint 25 vague 4B — délègue à lib/sensorial (respecte settings + reduced-motion)
  const fireHaptic = () => triggerHaptic('medium');

  const getPos = (event: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in event && event.touches.length > 0) {
      const t = event.touches[0]!;
      return { x: t.clientX, y: t.clientY };
    }
    if ('clientX' in event) return { x: event.clientX, y: event.clientY };
    return null;
  };

  const start = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      if (effectivelyDisabled) return;
      longPressFired.current = false;
      startPos.current = getPos(event);
      if (shouldPreventDefault && event.target) {
        event.target.addEventListener('touchend', preventDefault, {
          passive: false,
        });
        target.current = event.target;
      }
      timeout.current = setTimeout(() => {
        longPressFired.current = true;
        fireHaptic();
        onLongPress();
      }, delay);
    },
    [onLongPress, delay, shouldPreventDefault, effectivelyDisabled]
  );

  const move = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      if (effectivelyDisabled) return;
      if (!startPos.current || !timeout.current) return;
      const p = getPos(event);
      if (!p) return;
      const dx = p.x - startPos.current.x;
      const dy = p.y - startPos.current.y;
      if (Math.hypot(dx, dy) > moveTolerance) {
        clearTimeout(timeout.current);
        timeout.current = null;
      }
    },
    [effectivelyDisabled, moveTolerance]
  );

  const clear = useCallback(
    (_event: React.MouseEvent | React.TouchEvent, shouldTriggerClick = true) => {
      if (timeout.current) {
        clearTimeout(timeout.current);
        timeout.current = null;
      }
      if (shouldTriggerClick && onClick && !longPressFired.current) {
        onClick();
      }
      if (shouldPreventDefault && target.current) {
        target.current.removeEventListener('touchend', preventDefault);
      }
      startPos.current = null;
    },
    [shouldPreventDefault, onClick]
  );

  return {
    onMouseDown: (e: React.MouseEvent) => start(e),
    onTouchStart: (e: React.TouchEvent) => start(e),
    onMouseMove: (e: React.MouseEvent) => move(e),
    onTouchMove: (e: React.TouchEvent) => move(e),
    onMouseUp: (e: React.MouseEvent) => clear(e),
    onMouseLeave: (e: React.MouseEvent) => clear(e, false),
    onTouchEnd: (e: React.TouchEvent) => clear(e),
    /** Indique si le long-press est actif (utile pour disable conditionnel UI) */
    isEnabled: !effectivelyDisabled,
  };
}

const preventDefault = (e: Event) => {
  if (!('touches' in e) || (e as TouchEvent).touches.length < 2) {
    e.preventDefault();
  }
};
