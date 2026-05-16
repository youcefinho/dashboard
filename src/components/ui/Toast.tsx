import { createContext, useContext, useState, useCallback, ReactNode, useEffect, useMemo } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X, ChevronDown, Trash2 } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Icon } from './Icon';
import { confettiBurstSubtle } from '@/lib/confetti';
// Sprint 25 vague 4B — son success/error au mount du toast
import { playSound } from '@/lib/sensorial';
// Sprint 34 vague 34-3B — annonce SR au mount (a11y)
import { announceSR } from '@/lib/announce';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

// Sprint 34 vague 34-2B — Queue management constantes
const TOAST_VISIBLE_MAX = 5;         // 5 max simultanés
const TOAST_CLEAR_ALL_THRESHOLD = 3; // bouton "Tout effacer" si ≥3 visibles
const TOAST_CLEAR_STAGGER_MS = 30;   // stagger dismiss au clear-all

// Sprint 34 vague 34-2B — ordre par sévérité (danger > warning > success > info)
const TOAST_TYPE_PRIORITY: Record<ToastType, number> = {
  error: 0,
  warning: 1,
  success: 2,
  info: 3,
};

/**
 * ToastMessage — payload d'un toast.
 *
 * Sprint 38 — refonte visuelle Stripe-clean :
 *   - Plus de gradient brand 420px, plus de halo pulse, plus de bounce overshoot.
 *   - `hero?: boolean` : version plus prominente (icon 28px + title gras),
 *     mais surface white + border + shadow-md sober.
 *   - `celebrate?: boolean` : déclenche `confettiBurstSubtle()` au mount,
 *     désormais OPT-IN explicite (plus auto sur hero).
 */
export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Sprint 24 vague 3B (Sprint 38 : visuel sobre) — toast plus prominent. */
  hero?: boolean;
  /** Sprint 24 vague 3B — confetti subtle au mount (opt-in explicit Sprint 38). */
  celebrate?: boolean;
  /** Sprint 34 vague 34-2B — timestamp interne pour ordre "récents en haut" */
  _createdAt?: number;
}

interface ToastContextType {
  toast: (options: Omit<ToastMessage, 'id'>) => void;
  success: (message: string, options?: Partial<ToastMessage>) => void;
  error: (message: string, options?: Partial<ToastMessage>) => void;
  warning: (message: string, options?: Partial<ToastMessage>) => void;
  info: (message: string, options?: Partial<ToastMessage>) => void;
  remove: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const ToastIcon = ({ type, size = 18 }: { type: ToastType; size?: number }) => {
  switch (type) {
    case 'success': return <Icon as={CheckCircle2} size={size} className="text-[var(--success)]" />;
    case 'error':   return <Icon as={AlertCircle} size={size} className="text-[var(--danger)]" />;
    case 'warning': return <Icon as={AlertTriangle} size={size} className="text-[var(--warning)]" />;
    case 'info':    return <Icon as={Info} size={size} className="text-[var(--info)]" />;
  }
};

const ToastItem = ({ toast, onRemove }: { toast: ToastMessage; onRemove: (id: string) => void }) => {
  useEffect(() => {
    if (toast.duration !== 0) {
      const timer = setTimeout(() => {
        onRemove(toast.id);
      }, toast.duration || (toast.hero ? 6000 : 4000));
      return () => clearTimeout(timer);
    }
  }, [toast, onRemove]);

  // Sprint 24 vague 3B (Sprint 38 : opt-in explicit) — confetti au mount si celebrate:true.
  useEffect(() => {
    if (toast.celebrate) {
      // Respecte prefers-reduced-motion en interne (cf. confetti.ts)
      void confettiBurstSubtle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sprint 25 vague 4B — son sensoriel au mount selon le type (silent pour info/warning)
  useEffect(() => {
    if (toast.type === 'success') {
      playSound('success');
    } else if (toast.type === 'error') {
      playSound('error');
    }
    // info/warning : pas de son (subtle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sprint 34 vague 34-3B — annonce SR au mount du toast.
  // errors → assertive (interrompt) ; success/warning/info → polite.
  useEffect(() => {
    const parts: string[] = [];
    if (toast.title) parts.push(toast.title);
    if (toast.message) parts.push(toast.message);
    const msg = parts.join(' — ');
    if (!msg) return;
    announceSR(msg, toast.type === 'error' ? 'assertive' : 'polite');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isHero = !!toast.hero;

  // Sprint 38 — Toast Stripe-clean : white surface + border + shadow-md sober.
  // Hero = plus prominent (icon 28px + title text-base gras + padding élargi),
  // mais MÊME baseline visuelle (plus de gradient brand 420px ni halo pulse).
  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`relative flex items-start gap-3 pointer-events-auto bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] z-50 ${
        isHero ? 'px-5 py-4' : 'px-4 py-3'
      }`}
      style={{
        maxWidth: isHero ? 420 : 380,
        width: isHero ? 420 : 'auto',
        animation: 'slideUp var(--duration-base) var(--ease)',
      }}
    >
      <div className="shrink-0 mt-0.5">
        <ToastIcon type={toast.type} size={isHero ? 22 : 18} />
      </div>
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p
            className={`font-semibold text-[var(--text-primary)] tracking-tight ${
              isHero ? 'text-base' : 'text-sm'
            }`}
          >
            {toast.title}
          </p>
        )}
        <p
          className={`text-[var(--text-secondary)] ${isHero ? 'text-sm leading-relaxed' : 'text-sm'} ${
            toast.title ? 'mt-1' : ''
          }`}
        >
          {toast.message}
        </p>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.onClick();
              onRemove(toast.id);
            }}
            className="mt-2 text-sm font-semibold text-[var(--primary)] hover:text-[var(--primary-hover)] hover:underline transition-colors"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 -mr-1 -mt-1 rounded-[var(--radius-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        aria-label="Fermer"
      >
        <Icon as={X} size={16} />
      </button>
    </div>
  );
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  // Sprint 34 vague 34-2B — overflow panel reveal
  const [overflowOpen, setOverflowOpen] = useState(false);

  const addToast = useCallback((options: Omit<ToastMessage, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { ...options, id, _createdAt: Date.now() }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Sprint 34 vague 34-2B — "Tout effacer" : dismiss tous avec stagger 30ms + son toggle
  const clearAllToasts = useCallback(() => {
    setToasts(prev => {
      // Capture ordre actuel pour stagger
      const ids = prev.map(t => t.id);
      ids.forEach((id, idx) => {
        setTimeout(() => {
          setToasts(curr => curr.filter(t => t.id !== id));
        }, idx * TOAST_CLEAR_STAGGER_MS);
      });
      playSound('toggle');
      return prev; // remplacé par les setTimeout au fil de l'eau
    });
    setOverflowOpen(false);
  }, []);

  // Sprint 34 vague 34-2B — wrap remove pour son tick à chaque dismiss individual
  const removeToastWithSound = useCallback((id: string) => {
    playSound('tick');
    removeToast(id);
  }, [removeToast]);

  const contextValue = {
    toast: addToast,
    success: useCallback((message: string, options?: Partial<ToastMessage>) => addToast({ type: 'success', message, ...options }), [addToast]),
    error: useCallback((message: string, options?: Partial<ToastMessage>) => addToast({ type: 'error', message, ...options }), [addToast]),
    warning: useCallback((message: string, options?: Partial<ToastMessage>) => addToast({ type: 'warning', message, ...options }), [addToast]),
    info: useCallback((message: string, options?: Partial<ToastMessage>) => addToast({ type: 'info', message, ...options }), [addToast]),
    remove: removeToast,
  };

  // Sprint 34 vague 34-2B — tri par priorité (severity) puis récents en haut
  // visibleToasts = TOAST_VISIBLE_MAX premiers, overflow = reste
  const sortedToasts = useMemo(() => {
    return [...toasts].sort((a, b) => {
      const pDiff = TOAST_TYPE_PRIORITY[a.type] - TOAST_TYPE_PRIORITY[b.type];
      if (pDiff !== 0) return pDiff;
      // Même type : récents en haut (createdAt desc)
      return (b._createdAt ?? 0) - (a._createdAt ?? 0);
    });
  }, [toasts]);

  const visibleToasts = sortedToasts.slice(0, TOAST_VISIBLE_MAX);
  const overflowToasts = sortedToasts.slice(TOAST_VISIBLE_MAX);
  const overflowCount = overflowToasts.length;
  const showClearAll = visibleToasts.length >= TOAST_CLEAR_ALL_THRESHOLD;

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div
        className="fixed bottom-0 right-0 p-4 space-y-3 z-[9999] max-w-[440px] w-full pointer-events-none flex flex-col items-end"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {visibleToasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToastWithSound} />
        ))}

        {/* Sprint 34 vague 34-2B — Overflow panel (révélé via chip) */}
        {overflowOpen && overflowCount > 0 && (
          <div
            className="toast-overflow-panel pointer-events-auto"
            role="list"
            aria-label={`${overflowCount} notifications supplémentaires`}
          >
            {overflowToasts.map(t => (
              <button
                key={t.id}
                type="button"
                role="listitem"
                onClick={() => removeToastWithSound(t.id)}
                className={`toast-overflow-item toast-overflow-item--${t.type}`}
                aria-label={`Fermer : ${t.title ?? t.message}`}
              >
                <span className="toast-overflow-item-dot" aria-hidden />
                <span className="toast-overflow-item-text">
                  {t.title ? <strong>{t.title}</strong> : null}
                  <span>{t.message}</span>
                </span>
                <Icon as={X} size={12} className="toast-overflow-item-close" />
              </button>
            ))}
          </div>
        )}

        {/* Sprint 34 vague 34-2B — Chip "+N autres" si overflow */}
        {overflowCount > 0 && (
          <button
            type="button"
            className="toast-stack-overflow-chip pointer-events-auto"
            onClick={() => setOverflowOpen(o => !o)}
            aria-expanded={overflowOpen}
            aria-label={`${overflowOpen ? 'Masquer' : 'Afficher'} ${overflowCount} notification${overflowCount > 1 ? 's' : ''} supplémentaire${overflowCount > 1 ? 's' : ''}`}
          >
            <span>+{overflowCount} autre{overflowCount > 1 ? 's' : ''} notification{overflowCount > 1 ? 's' : ''}</span>
            <Icon
              as={ChevronDown}
              size={12}
              className={`toast-stack-overflow-chevron ${overflowOpen ? 'is-open' : ''}`}
            />
          </button>
        )}

        {/* Sprint 34 vague 34-2B — Bouton "Tout effacer" si ≥3 toasts */}
        {showClearAll && (
          <button
            type="button"
            className="toast-clear-all pointer-events-auto"
            onClick={clearAllToasts}
            aria-label="Effacer toutes les notifications"
          >
            <Icon as={Trash2} size={12} />
            <span>Tout effacer</span>
          </button>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
