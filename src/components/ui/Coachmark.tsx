// ── Coachmark — Spotlight overlay tour (Sprint 24 vague 5B) ─────────────────
// Primitive overlay qui met en évidence un élément cible (via ref ou
// querySelector) avec un masque cut-out radial + tooltip card premium positionné
// près du target. Inspiration Superhuman / Notion / Linear onboarding.
//
// Props :
//   steps: CoachmarkStep[]  — étapes ordonnées
//   open: boolean
//   onClose: () => void     — skip / esc / fermeture
//   onComplete: () => void  — fin du tour
//
// Navigation :
//   ←→ : prev/next       Esc : close       Enter : next/finish
//
// Le spotlight est calculé à partir de getBoundingClientRect() du target.
// Auto-flip de la position si le tooltip touche un bord viewport.

import {
  useEffect,
  useState,
  useCallback,
  type RefObject,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowLeft, ArrowRight, Check } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Icon } from './Icon';

type Position = 'top' | 'bottom' | 'left' | 'right' | 'auto';

export interface CoachmarkStep {
  /** Ref vers le target DOM — prioritaire sur targetSelector */
  targetRef?: RefObject<HTMLElement | null>;
  /** Sélecteur CSS du target (querySelector global) */
  targetSelector?: string;
  title: string;
  description: string;
  /** ReactNode supplémentaire dans le tooltip (ex: badge "Pro tip") */
  action?: ReactNode;
  /** Position préférée du tooltip — 'auto' utilise placement intelligent */
  position?: Position;
}

interface CoachmarkProps {
  steps: CoachmarkStep[];
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;
const TOOLTIP_W = 320;
const TOOLTIP_H_EST = 180;
const VIEWPORT_MARGIN = 16;
const ARROW_SIZE = 10;

function resolveTarget(step: CoachmarkStep): HTMLElement | null {
  if (step.targetRef?.current) return step.targetRef.current;
  if (step.targetSelector) {
    return document.querySelector<HTMLElement>(step.targetSelector);
  }
  return null;
}

function computeTooltipPosition(targetRect: Rect, preferred: Position): {
  top: number;
  left: number;
  side: 'top' | 'bottom' | 'left' | 'right';
} {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tw = TOOLTIP_W;
  const th = TOOLTIP_H_EST;
  const gap = PADDING + ARROW_SIZE;

  // helper : essaie une side donnée et retourne position + détection overflow
  function trySide(side: 'top' | 'bottom' | 'left' | 'right') {
    let top = 0;
    let left = 0;
    if (side === 'top') {
      top = targetRect.top - th - gap;
      left = targetRect.left + targetRect.width / 2 - tw / 2;
    } else if (side === 'bottom') {
      top = targetRect.top + targetRect.height + gap;
      left = targetRect.left + targetRect.width / 2 - tw / 2;
    } else if (side === 'left') {
      top = targetRect.top + targetRect.height / 2 - th / 2;
      left = targetRect.left - tw - gap;
    } else {
      top = targetRect.top + targetRect.height / 2 - th / 2;
      left = targetRect.left + targetRect.width + gap;
    }
    const overflow =
      top < VIEWPORT_MARGIN ||
      left < VIEWPORT_MARGIN ||
      top + th > vh - VIEWPORT_MARGIN ||
      left + tw > vw - VIEWPORT_MARGIN;
    return { top, left, side, overflow };
  }

  // Si auto : tester les 4 sides dans l'ordre bottom > right > top > left
  const candidates =
    preferred === 'auto'
      ? (['bottom', 'right', 'top', 'left'] as const)
      : ([preferred, 'bottom', 'right', 'top', 'left'] as const);

  for (const side of candidates) {
    const result = trySide(side);
    if (!result.overflow) {
      // Clamp dans viewport
      result.left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(result.left, vw - tw - VIEWPORT_MARGIN),
      );
      result.top = Math.max(
        VIEWPORT_MARGIN,
        Math.min(result.top, vh - th - VIEWPORT_MARGIN),
      );
      return result;
    }
  }

  // Fallback : bottom centre clampé
  const f = trySide('bottom');
  f.left = Math.max(VIEWPORT_MARGIN, Math.min(f.left, vw - tw - VIEWPORT_MARGIN));
  f.top = Math.max(VIEWPORT_MARGIN, Math.min(f.top, vh - th - VIEWPORT_MARGIN));
  return f;
}

export function Coachmark({ steps, open, onClose, onComplete }: CoachmarkProps) {
  const [index, setIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);

  // Reset l'index quand le tour s'ouvre
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const currentStep = steps[index];

  const recomputeTarget = useCallback(() => {
    if (!currentStep) return;
    const el = resolveTarget(currentStep);
    if (!el) {
      setTargetRect(null);
      return;
    }
    // Scroll into view if needed (smooth)
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    } catch { /* ignore */ }
    const r = el.getBoundingClientRect();
    setTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [currentStep]);

  useEffect(() => {
    if (!open) return;
    recomputeTarget();
    // Recompute on resize / scroll
    const onResize = () => recomputeTarget();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    // Retry une fois après 250ms (target peut être hors écran le temps du scrollIntoView)
    const t1 = window.setTimeout(recomputeTarget, 300);
    const t2 = window.setTimeout(recomputeTarget, 700);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [open, recomputeTarget]);

  const next = useCallback(() => {
    if (index < steps.length - 1) {
      setIndex((i) => i + 1);
    } else {
      onComplete();
    }
  }, [index, steps.length, onComplete]);

  const prev = useCallback(() => {
    if (index > 0) setIndex((i) => i - 1);
  }, [index]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, next, prev]);

  if (!open || !currentStep) return null;

  const preferred: Position = currentStep.position ?? 'auto';

  // Si pas de target : tooltip centré sans spotlight
  const hasTarget = targetRect !== null;
  const tipPos = hasTarget
    ? computeTooltipPosition(targetRect, preferred)
    : {
        top: typeof window !== 'undefined' ? window.innerHeight / 2 - TOOLTIP_H_EST / 2 : 200,
        left: typeof window !== 'undefined' ? window.innerWidth / 2 - TOOLTIP_W / 2 : 200,
        side: 'bottom' as const,
      };

  const isLast = index === steps.length - 1;

  // Sprint 45 M3.1 — Stripe-clean refonte : spotlight via box-shadow neutre,
  // outline primary 2px subtle, no glow, no gradient brand, no pulse ring.
  const spotlightStyle: React.CSSProperties | undefined = hasTarget
    ? {
        position: 'fixed',
        top: targetRect.top - PADDING,
        left: targetRect.left - PADDING,
        width: targetRect.width + PADDING * 2,
        height: targetRect.height + PADDING * 2,
        borderRadius: 8,
        boxShadow:
          '0 0 0 9999px rgba(15, 23, 42, 0.30), 0 0 0 2px var(--primary)',
        pointerEvents: 'none',
        zIndex: 9000,
        transition: 'top 200ms ease-out, left 200ms ease-out, width 200ms ease-out, height 200ms ease-out',
      }
    : undefined;

  return createPortal(
    <div className="coachmark-root" role="dialog" aria-modal aria-label="Tour guidé">
      {/* Backdrop — capture click pour skip. Sprint 45 M3.1 : pas de blur (Stripe-clean) */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 8999,
        }}
      />

      {/* Spotlight cut-out (Sprint 45 M3.1 — outline primary subtle) */}
      {hasTarget && (
        <div className="coachmark-spotlight" style={spotlightStyle} />
      )}

      {/* Tooltip card (Sprint 45 M3.1 — surface white + border subtle + shadow-md) */}
      <div
        className="coachmark-tooltip"
        style={{
          position: 'fixed',
          top: tipPos.top,
          left: tipPos.left,
          width: TOOLTIP_W,
          zIndex: 9002,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 8,
          padding: 16,
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {/* Sprint 45 M3.1 — Step indicator subtle, plus de gradient brand */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Étape {index + 1} / {steps.length}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer shrink-0"
            aria-label="Fermer le tour"
          >
            <Icon as={X} size={14} />
          </button>
        </div>

        <h3 className="text-[15px] font-semibold text-[var(--text-primary)] tracking-tight mb-1.5">
          {currentStep.title}
        </h3>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">
          {currentStep.description}
        </p>

        {currentStep.action && <div className="mb-3">{currentStep.action}</div>}

        {/* Sprint 45 M3.1 — Progress dots Stripe-clean (no glow, no gradient) */}
        <div className="flex items-center justify-center gap-1.5 mb-3" aria-hidden>
          {steps.map((_, i) => (
            <span
              key={i}
              className="coachmark-dot"
              style={{
                width: i === index ? 20 : 6,
                height: 6,
                borderRadius: 3,
                background:
                  i === index
                    ? 'var(--primary)'
                    : i < index
                    ? 'var(--gray-400)'
                    : 'var(--gray-200)',
                transition: 'width 180ms ease-out, background 180ms ease-out',
              }}
            />
          ))}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            Passer
          </button>
          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <button
                type="button"
                onClick={prev}
                className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <Icon as={ArrowLeft} size={11} strokeWidth={2} />
                Précédent
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-1 h-7 px-3 text-[11px] font-medium rounded-md text-white transition-colors cursor-pointer"
              style={{
                background: 'var(--primary)',
                border: '1px solid var(--primary)',
              }}
            >
              {isLast ? (
                <>
                  <Icon as={Check} size={11} strokeWidth={2.2} />
                  Terminer
                </>
              ) : (
                <>
                  Suivant
                  <Icon as={ArrowRight} size={11} strokeWidth={2} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
