// ── Wizard — multi-step primitive (Sprint 26 vague 26-3A) ─────────────────
// Pattern multi-step réutilisable pour Settings (TeamSettings invite, BrandingSettings setup, etc.)
// Inspiré de OnboardingWizard mais générique + step chips numérotés gradient brand + connectors.
//
// Props :
//   steps: WizardStep[]                — étapes ordonnées (id, label, content, isValid?, isOptional?)
//   currentIndex: number               — index controllé (parent gère state)
//   onStepChange: (index) => void      — appelé sur Suivant / Précédent / Skip
//   onComplete: () => void             — appelé sur Terminer (dernier step)
//   onCancel?: () => void              — appelé sur Esc / bouton Annuler header
//   persistKey?: string                — localStorage key pour persister currentIndex
//   title: string                      — titre Modal
//   description?: string               — sous-titre Modal
//   open: boolean
//   onOpenChange: (open) => void
//
// Keyboard :
//   Enter        — next step (si isValid)
//   Esc          — onCancel + close (géré par Modal)
//
// Animations :
//   slide horizontal entre steps (translateX ±20px + opacity 280ms)
//   respecte prefers-reduced-motion via .wizard-step-slide-in
//
// Persistance :
//   si persistKey fourni → onMount lit localStorage[`wizard:${persistKey}`] et reprend
//   onStepChange → écrit dans localStorage. onComplete → clear.

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Check, ChevronLeft, ChevronRight, SkipForward } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Icon } from './Icon';
import { cn } from '@/lib/cn';

export interface WizardStep {
  id: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
  /** Si retourne false → bouton Suivant disabled */
  isValid?: () => boolean;
  /** Si true → bouton Skip visible footer gauche */
  isOptional?: boolean;
}

interface WizardProps {
  steps: WizardStep[];
  currentIndex: number;
  onStepChange: (index: number) => void;
  onComplete: () => void;
  onCancel?: () => void;
  persistKey?: string;
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Label bouton final (default "Terminer") */
  completeLabel?: string;
  /** Désactive close outside / Esc */
  modal?: boolean;
  /**
   * Sprint 30 vague 30-2C — rendu inline sans Modal/overlay/Esc-close.
   * Quand `true` : pas d'overlay, pas de fermeture sur Esc, pas de title/description
   * dans un Modal (le parent gère son propre header si besoin).
   * Quand `false` (default) : rendu wrappé dans <Modal> — préserve Sprint 26.
   */
  embedded?: boolean;
}

function storageKey(persistKey: string) {
  return `wizard:${persistKey}`;
}

export function Wizard({
  steps,
  currentIndex,
  onStepChange,
  onComplete,
  onCancel,
  persistKey,
  title,
  description,
  open,
  onOpenChange,
  completeLabel = 'Terminer',
  modal = false,
  embedded = false,
}: WizardProps) {
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const restoredRef = useRef(false);

  // Restore from localStorage on first open
  useEffect(() => {
    if (!open || !persistKey || restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(storageKey(persistKey));
      if (raw !== null) {
        const saved = parseInt(raw, 10);
        if (!Number.isNaN(saved) && saved >= 0 && saved < steps.length && saved !== currentIndex) {
          onStepChange(saved);
        }
      }
    } catch {
      /* ignore */
    }
  }, [open, persistKey, steps.length, currentIndex, onStepChange]);

  // Persist currentIndex
  useEffect(() => {
    if (!persistKey) return;
    try {
      localStorage.setItem(storageKey(persistKey), String(currentIndex));
    } catch {
      /* ignore */
    }
  }, [currentIndex, persistKey]);

  // Reset restored flag when closed
  useEffect(() => {
    if (!open) restoredRef.current = false;
  }, [open]);

  const current = steps[currentIndex];
  const isLast = currentIndex === steps.length - 1;
  const isFirst = currentIndex === 0;
  const canAdvance = current?.isValid ? current.isValid() : true;

  const handleNext = () => {
    if (!canAdvance) return;
    if (isLast) {
      // Clear persistence on complete
      if (persistKey) {
        try {
          localStorage.removeItem(storageKey(persistKey));
        } catch {
          /* ignore */
        }
      }
      onComplete();
    } else {
      setDirection('forward');
      onStepChange(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (isFirst) return;
    setDirection('backward');
    onStepChange(currentIndex - 1);
  };

  const handleSkip = () => {
    if (!current?.isOptional) return;
    if (isLast) {
      if (persistKey) {
        try {
          localStorage.removeItem(storageKey(persistKey));
        } catch {
          /* ignore */
        }
      }
      onComplete();
    } else {
      setDirection('forward');
      onStepChange(currentIndex + 1);
    }
  };

  // Keyboard nav — Enter = next (Esc-close désactivé en mode embedded)
  useEffect(() => {
    // En mode embedded on n'a pas de notion d'ouverture/fermeture — toujours actif tant que monté.
    if (!embedded && !open) return;
    const handler = (e: KeyboardEvent) => {
      // N'intercepte pas si l'utilisateur tape dans textarea (Enter = newline)
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Si Enter sur un button ou input submit, laisser le natif
        if (target?.tagName === 'BUTTON') return;
        e.preventDefault();
        if (canAdvance) handleNext();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canAdvance, currentIndex, isLast, embedded]);

  const handleOpenChange = (next: boolean) => {
    if (!next && onCancel) onCancel();
    onOpenChange(next);
  };

  const body = (
    <div className={cn('w-full', embedded && 'wizard-embedded')}>
        {/* ── Header progress : chips numérotés + connectors ── */}
        <div className="mb-6">
          <ol className="flex items-center gap-0 w-full" aria-label="Progression">
            {steps.map((s, i) => {
              const isCompleted = i < currentIndex;
              const isActive = i === currentIndex;
              return (
                <li
                  key={s.id}
                  className="flex items-center"
                  style={{ flex: i === steps.length - 1 ? '0 0 auto' : '1 1 auto' }}
                >
                  <div className="flex flex-col items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        // Permet de revenir en arrière en cliquant un step déjà complété
                        if (isCompleted) {
                          setDirection('backward');
                          onStepChange(i);
                        }
                      }}
                      disabled={!isCompleted}
                      className={cn(
                        'wizard-step-chip',
                        isActive && 'wizard-step-active',
                        isCompleted && 'wizard-step-completed',
                      )}
                      aria-current={isActive ? 'step' : undefined}
                      aria-label={`Étape ${i + 1} : ${s.label}`}
                    >
                      {isCompleted ? (
                        <Icon as={Check} size={14} strokeWidth={3} />
                      ) : (
                        <span className="text-[12px] font-bold tabular-nums">{i + 1}</span>
                      )}
                    </button>
                    <span
                      className={cn(
                        't-meta whitespace-nowrap transition-colors',
                        isActive
                          ? 'font-semibold text-[var(--text-primary)]'
                          : isCompleted
                          ? 'text-[var(--primary)]'
                          : 'text-[var(--text-muted)]',
                      )}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <span
                      aria-hidden
                      className={cn(
                        'wizard-connector',
                        isCompleted && 'wizard-connector--done',
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* ── Body : current step content ── */}
        <div
          key={current?.id}
          className={cn(
            'min-h-[280px] max-h-[55vh] overflow-y-auto modal-scroll px-1',
            direction === 'forward' ? 'wizard-step-slide-in-forward' : 'wizard-step-slide-in-backward',
          )}
        >
          {current?.content}
        </div>

        {/* ── Footer actions ── */}
        <div className="mt-6 pt-5 border-t border-[var(--border-subtle)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {current?.isOptional && !isLast && (
              <button
                type="button"
                onClick={handleSkip}
                className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <Icon as={SkipForward} size={13} strokeWidth={2.2} />
                Passer cette étape
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button variant="secondary" size="md" onClick={handlePrev} leftIcon={<Icon as={ChevronLeft} size={14} />}>
                Précédent
              </Button>
            )}
            <Button
              variant="premium"
              size="md"
              onClick={handleNext}
              disabled={!canAdvance}
              rightIcon={isLast ? <Icon as={Check} size={14} strokeWidth={2.6} /> : <Icon as={ChevronRight} size={14} />}
              className="min-w-[140px] justify-center"
            >
              {isLast ? completeLabel : 'Suivant'}
            </Button>
          </div>
        </div>
      </div>
  );

  // ── Sprint 30 vague 30-2C — rendu inline (no Modal, no overlay, no Esc-close) ──
  if (embedded) {
    // Garde la condition d'ouverture pour permettre au parent de "monter/démonter"
    // sans avoir à conditionner lui-même.
    if (!open) return null;
    return (
      <section
        className="wizard-embedded-root"
        role="region"
        aria-label={title}
      >
        {(title || description) && (
          <header className="wizard-embedded-header">
            {title && <h3 className="t-h3 mb-0.5">{title}</h3>}
            {description && (
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">{description}</p>
            )}
          </header>
        )}
        {body}
      </section>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      size="lg"
      modal={modal}
    >
      {body}
    </Modal>
  );
}
