// ── Modal — Radix Dialog primitive (Sprint 38 — refonte Stripe-clean) ───────
// Stripe-style : backdrop dark transparent, contenu blanc, shadow-overlay,
// fadeIn backdrop + slideUp content. Pas de gradient/glass/orbs/halos.
// API publique 100% préservée (open, onOpenChange, title, description,
// children, className, size, modal). Nouvelles props optionnelles :
// - closeOnOverlay (default true) — désactive si false
// - position (default 'center') — 'bottom' = sheet mobile slide-up

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Icon } from './Icon';
import { cn } from '@/lib/cn';
import { type CSSProperties, type ReactNode } from 'react';
// Sprint 44 M3.4 — Edge swipe back ferme le modal top of stack
import { useBackHandler } from '@/hooks/useBackHandler';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Désactive le close button + clic outside (modale modale) */
  modal?: boolean;
  /** Sprint 38 — désactive fermeture par clic backdrop (default true) */
  closeOnOverlay?: boolean;
  /** Sprint 38 — position du panneau ('center' default, 'bottom' = sheet) */
  position?: 'center' | 'bottom';
  /** LOT C — aria-label du bouton fermer (i18n). Défaut 'Fermer' (rétro-compat). */
  closeLabel?: string;
}

const sizeMap = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  size = 'md',
  modal = false,
  closeOnOverlay = true,
  position = 'center',
  closeLabel = 'Fermer',
}: ModalProps) {
  const isBottom = position === 'bottom';

  // Sprint 44 M3.4 — Edge swipe back ferme ce modal (sauf modal === true qui
  // explicite l'intention "non-fermable par gesture", ex: confirm critique).
  useBackHandler(() => onOpenChange(false), open && !modal && closeOnOverlay);

  // Outside click is suppressed when modal=true OR closeOnOverlay=false
  const suppressOutside = modal || !closeOnOverlay;

  const contentStyle: CSSProperties = {
    background: 'var(--bg-surface)',
    borderRadius: isBottom
      ? 'var(--radius-xl) var(--radius-xl) 0 0'
      : 'var(--radius-xl)',
    boxShadow: 'var(--shadow-overlay)',
    border: '1px solid var(--border)',
  };

  const positionClasses = isBottom
    ? // Bottom sheet : full width mobile, slide up from bottom
      'fixed left-0 right-0 bottom-0 z-50 w-full overflow-hidden flex flex-col max-h-[90vh] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4'
    : // Center : translate -50/-50, slideUp entrance
      'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] overflow-hidden flex flex-col max-h-[90vh] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:slide-out-to-bottom-2';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Backdrop — Stripe pattern : rgba(15,17,26,0.4) flat, fadeIn */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{
            background: 'rgba(15, 17, 26, 0.4)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            animationDuration: 'var(--duration-base)',
            animationTimingFunction: 'var(--ease)',
          }}
        />
        <DialogPrimitive.Content
          onPointerDownOutside={
            suppressOutside ? (e) => e.preventDefault() : undefined
          }
          onEscapeKeyDown={modal ? (e) => e.preventDefault() : undefined}
          className={cn(positionClasses, !isBottom && sizeMap[size], className)}
          style={{
            ...contentStyle,
            animationDuration: 'var(--duration-base)',
            animationTimingFunction: 'var(--ease)',
          }}
        >
          {/* Header — sticky top, plain white, simple border-bottom */}
          <div
            className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 shrink-0"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title
                className="font-semibold tracking-tight"
                style={{
                  color: 'var(--text-primary)',
                  fontSize: '16px',
                  lineHeight: '24px',
                }}
              >
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description
                  className="mt-1 leading-relaxed"
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 'var(--text-caption)',
                  }}
                >
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            {!modal && (
              <DialogPrimitive.Close
                className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-md)] transition-colors outline-none"
                style={{ color: 'var(--text-muted)' }}
                aria-label={closeLabel}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    'var(--bg-hover)';
                  (e.currentTarget as HTMLElement).style.color =
                    'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '';
                  (e.currentTarget as HTMLElement).style.color =
                    'var(--text-muted)';
                }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow =
                    '0 0 0 3px var(--primary-ring)';
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = '';
                }}
              >
                <Icon as={X} size={14} />
              </DialogPrimitive.Close>
            )}
          </div>

          {/* Content — scrollable, padding 24px */}
          <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
