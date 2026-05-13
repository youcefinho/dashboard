// ── SlidePanel — Panneau latéral droit (Radix Dialog + slide animation) ─────
// Différenciateur UX vs GHL : pas de full-page nav. Click détail = panel.
// Supporte le stacking (max 3) via PanelStack context.
//
// Usage simple (standalone) :
//   const [open, setOpen] = useState(false);
//   <SlidePanel open={open} onOpenChange={setOpen} title="Détails">
//     <div>contenu</div>
//   </SlidePanel>
//
// Usage stack (recommandé pour app) :
//   const { openPanel } = usePanelStack();
//   openPanel({ type: 'lead', id: 'lead-001' });

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { type ReactNode } from 'react';

export type SlidePanelSize = 'sm' | 'md' | 'lg' | 'xl';

interface SlidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: SlidePanelSize;
  /** Niveau dans le stack (0 = top, 1 = sous le top, etc.). Décale visuellement de -32px par niveau. */
  stackLevel?: number;
  /** Slot d'actions custom à droite du header (à côté du close) */
  headerActions?: ReactNode;
  /** Footer sticky en bas (boutons d'action principaux) */
  footer?: ReactNode;
  /** Affichage du bouton "Ouvrir en page complète" — fournir le href cible */
  openFullHref?: string;
  /** Callback quand l'user clique "Ouvrir en page" — alternative au href si navigation programmatique */
  onOpenFull?: () => void;
  /** Classe additionnelle sur le body scrollable */
  bodyClassName?: string;
}

const sizeMap: Record<SlidePanelSize, string> = {
  sm: 'w-full sm:max-w-[380px]',
  md: 'w-full sm:max-w-[540px]',
  lg: 'w-full sm:max-w-[720px]',
  xl: 'w-full sm:max-w-[920px]',
};

export function SlidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
  stackLevel = 0,
  headerActions,
  footer,
  openFullHref,
  onOpenFull,
  bodyClassName,
}: SlidePanelProps) {
  // Décalage visuel quand un panel est sous un autre (effet "carte sous carte")
  const offsetTransform = stackLevel > 0
    ? `translateX(-${Math.min(stackLevel, 2) * 32}px) scale(${1 - Math.min(stackLevel, 2) * 0.02})`
    : undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={stackLevel === 0}>
      <DialogPrimitive.Portal>
        {stackLevel === 0 && (
          <DialogPrimitive.Overlay
            className="fixed inset-0 z-40 bg-[oklch(0.18_0.015_260/0.35)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          />
        )}
        <DialogPrimitive.Content
          className={cn(
            'fixed right-0 top-0 bottom-0 z-50 flex flex-col bg-[var(--bg-surface)] shadow-[var(--shadow-xl)] border-l border-[var(--border-subtle)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
            'data-[state=open]:duration-250 data-[state=closed]:duration-200',
            sizeMap[size]
          )}
          style={{
            zIndex: 50 + (10 - Math.min(stackLevel, 3)),
            transform: offsetTransform,
            transition: 'transform 250ms ease-out',
          }}
          // Empêche le focus trap des panels sous-jacents de voler le focus
          onInteractOutside={(e) => {
            if (stackLevel > 0) e.preventDefault();
          }}
        >
          {/* Header sticky */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {headerActions}
              {(openFullHref || onOpenFull) && (
                <button
                  onClick={() => {
                    if (onOpenFull) onOpenFull();
                    else if (openFullHref) window.location.assign(openFullHref);
                  }}
                  className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer"
                  title="Ouvrir en page complète"
                  aria-label="Ouvrir en page complète"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              )}
              <DialogPrimitive.Close
                className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Body scrollable */}
          <div className={cn('flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>
            {children}
          </div>

          {/* Footer optionnel sticky */}
          {footer && (
            <div className="sticky bottom-0 z-10 px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
