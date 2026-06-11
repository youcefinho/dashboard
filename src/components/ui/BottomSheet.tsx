// ── BottomSheet — Mobile-first iOS-style sheet (Sprint 23 wave 43B) ─────────
// Primitive complémentaire au Modal/SlidePanel : remonte depuis le bas.
// - Radix Dialog (focus trap, ESC, aria-modal)
// - Animation entrance 320ms cubic-bezier(0.32,0.72,0,1) iOS-like
// - Drag-to-dismiss via handle (touch event uniquement, n'interfère pas
//   avec le scroll interne)
// - Backdrop gradient cyan→navy avec blur (cohérence Modal) mais opacité
//   plus subtile
// - Sur desktop : reste fonctionnel, centré-bas max-w-md
//
// Spec :
//   <BottomSheet open onOpenChange title="Détails" size="auto" showHandle>...</BottomSheet>

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Icon } from './Icon';
import { cn } from '@/lib/cn';
import { useRef, useState, useCallback, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
// Sprint 44 M3.4 — Edge swipe back ferme la BottomSheet top of stack
import { useBackHandler } from '@/hooks/useBackHandler';
// `useRef` est utilisé pour stocker la position de départ du drag (valeur mutable hors render).

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** auto = sizing par contenu, half = 50vh, full = 90vh */
  size?: 'auto' | 'half' | 'full';
  /** Afficher la handle drag visible en haut */
  showHandle?: boolean;
  className?: string;
  /** LOT C — aria-label du bouton fermer (i18n). Défaut 'Fermer' (rétro-compat). */
  closeLabel?: string;
}

const sizeMap: Record<NonNullable<BottomSheetProps['size']>, string> = {
  auto: 'max-h-[85vh]',
  half: 'h-[50vh] max-h-[50vh]',
  full: 'h-[90vh] max-h-[90vh]',
};

const DISMISS_THRESHOLD_PX = 80;

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'auto',
  showHandle = false,
  className,
  closeLabel = 'Fermer',
}: BottomSheetProps) {
  const dragStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  // Sprint 44 M3.4 — Edge swipe back ferme la sheet
  useBackHandler(() => onOpenChange(false), open);

  const handleTouchStart = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (!t) return;
    dragStartY.current = t.clientY;
    setDragOffset(0);
  }, []);

  const handleTouchMove = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    if (dragStartY.current == null) return;
    const t = e.touches[0];
    if (!t) return;
    const delta = t.clientY - dragStartY.current;
    // Ne pas tirer vers le haut, seulement vers le bas
    if (delta > 0) setDragOffset(delta);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (dragStartY.current == null) return;
    if (dragOffset > DISMISS_THRESHOLD_PX) {
      onOpenChange(false);
    }
    dragStartY.current = null;
    // Snap back (ou laisser l'anim exit jouer si fermé)
    setDragOffset(0);
  }, [dragOffset, onOpenChange]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Backdrop — gradient cyan→navy + blur (plus subtil que Modal) */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{
            background: 'var(--overlay)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        />
        <DialogPrimitive.Content
          data-bottomsheet=""
          aria-modal="true"
          className={cn(
            'fixed left-0 right-0 bottom-0 z-50 flex flex-col overflow-hidden',
            // iOS-style entrance/exit — slide depuis le bas
            'data-[state=open]:animate-[bottom-sheet-up_320ms_cubic-bezier(0.32,0.72,0,1)]',
            'data-[state=closed]:animate-[bottom-sheet-down_240ms_cubic-bezier(0.32,0.72,0,1)]',
            'rounded-t-3xl',
            // Desktop : centrer en bas avec max-width raisonnable
            'mx-auto md:max-w-md',
            sizeMap[size],
            className
          )}
          style={{
            background: 'linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-subtle) 100%)',
            border: '1px solid var(--border)',
            borderBottom: 'none',
            boxShadow: 'var(--shadow-overlay), 0 0 0 1px var(--border) inset',
            paddingBottom: 'env(safe-area-inset-bottom)',
            transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
            transition: dragOffset > 0 ? 'none' : 'transform 220ms cubic-bezier(0.32,0.72,0,1)',
          }}
        >


          {/* Handle drag — touch-action pan-y UNIQUEMENT ici (n'affecte pas scroll interne) */}
          {showHandle && (
            <div
              role="presentation"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              className="relative shrink-0 flex items-center justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing"
              style={{ touchAction: 'pan-y' }}
            >
              <div className="w-9 h-1 rounded-full bg-[var(--gray-300)]" />
            </div>
          )}

          {/* Header — sticky avec border-bottom branded */}
          {(title || description) && (
            <div
              className={cn(
                'relative flex items-center justify-between px-5 shrink-0',
                showHandle ? 'pt-2 pb-3' : 'pt-4 pb-3'
              )}
              style={{
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-surface)',
              }}
            >
              <div className="min-w-0 flex-1">
                {title && (
                  <DialogPrimitive.Title className="text-base font-bold text-[var(--text-primary)] tracking-tight">
                    {title}
                  </DialogPrimitive.Title>
                )}
                {description && (
                  <DialogPrimitive.Description className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              <DialogPrimitive.Close
                className="chip-btn chip-btn--sm shrink-0 ml-3"
                aria-label={closeLabel}
              >
                <Icon as={X} size={14} />
              </DialogPrimitive.Close>
            </div>
          )}

          {/* Content scrollable */}
          <div className="relative p-4 overflow-y-auto modal-scroll flex-1">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
