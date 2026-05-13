// ── useCountUp — Animation count-up sur stat numbers (Sprint 23 — wave 8) ───
// Anime un nombre de 0 → target avec easing. Respect prefers-reduced-motion.

import { useEffect, useState, useRef } from 'react';

interface Options {
  /** Durée de l'animation en ms */
  duration?: number;
  /** Démarre seulement si visible dans le viewport (perf) */
  triggerOnVisible?: boolean;
}

export function useCountUp(target: number, { duration = 1200, triggerOnVisible = true }: Options = {}): { value: number; ref: React.RefObject<HTMLElement | null> } {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLElement | null>(null);
  const animationStartedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Respect reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }

    const startAnimation = () => {
      if (animationStartedRef.current) return;
      animationStartedRef.current = true;
      const startTime = performance.now();
      const initialValue = 0;

      const tick = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Easing out-cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = initialValue + (target - initialValue) * eased;
        setValue(progress >= 1 ? target : current);
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if (!triggerOnVisible || !ref.current) {
      startAnimation();
      return;
    }

    // IntersectionObserver — démarre quand visible
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            startAnimation();
            observer.disconnect();
          }
        });
      },
      { threshold: 0.2 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target, duration, triggerOnVisible]);

  return { value, ref };
}
