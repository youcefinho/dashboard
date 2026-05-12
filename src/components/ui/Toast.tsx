import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

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

const ToastIcon = ({ type }: { type: ToastType }) => {
  switch (type) {
    case 'success': return <CheckCircle2 size={18} className="text-[var(--success)]" />;
    case 'error': return <AlertCircle size={18} className="text-[var(--danger)]" />;
    case 'warning': return <AlertTriangle size={18} className="text-[var(--warning)]" />;
    case 'info': return <Info size={18} className="text-[var(--info)]" />;
  }
};

const ToastItem = ({ toast, onRemove }: { toast: ToastMessage; onRemove: (id: string) => void }) => {
  useEffect(() => {
    if (toast.duration !== 0) {
      const timer = setTimeout(() => {
        onRemove(toast.id);
      }, toast.duration || 4000);
      return () => clearTimeout(timer);
    }
  }, [toast, onRemove]);

  return (
    <div className="flex items-start gap-3 p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-lg rounded-xl pointer-events-auto transform transition-all duration-300 animate-in slide-in-from-right-full fade-in z-50">
      <div className="shrink-0 mt-0.5">
        <ToastIcon type={toast.type} />
      </div>
      <div className="flex-1 min-w-0">
        {toast.title && <p className="text-sm font-semibold text-[var(--text-primary)]">{toast.title}</p>}
        <p className={`text-sm text-[var(--text-secondary)] ${toast.title ? 'mt-1' : ''}`}>
          {toast.message}
        </p>
        {toast.action && (
          <button
            onClick={() => {
              toast.action!.onClick();
              onRemove(toast.id);
            }}
            className="mt-2 text-sm font-medium text-[var(--brand-primary)] hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
      >
        <X size={16} />
      </button>
    </div>
  );
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((options: Omit<ToastMessage, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { ...options, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const contextValue = {
    toast: addToast,
    success: useCallback((message: string, options?: Partial<ToastMessage>) => addToast({ type: 'success', message, ...options }), [addToast]),
    error: useCallback((message: string, options?: Partial<ToastMessage>) => addToast({ type: 'error', message, ...options }), [addToast]),
    warning: useCallback((message: string, options?: Partial<ToastMessage>) => addToast({ type: 'warning', message, ...options }), [addToast]),
    info: useCallback((message: string, options?: Partial<ToastMessage>) => addToast({ type: 'info', message, ...options }), [addToast]),
    remove: removeToast,
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="fixed bottom-0 right-0 p-4 space-y-3 z-[9999] max-w-sm w-full pointer-events-none flex flex-col items-end">
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
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
