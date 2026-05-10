// ── Compat legacy — adapters pour les pages non encore refondues ──
// À retirer progressivement dans Sprint Design Phase D.3

import { type InputHTMLAttributes, type ReactNode } from 'react';

// ── Legacy Modal (isOpen/onClose → open/onOpenChange) ───────

interface LegacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function LegacyModal({ isOpen, onClose, title, children }: LegacyModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-[var(--shadow-xl)] p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Legacy Input (label/icon → leftIcon, wrapping label) ────

interface LegacyInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
}

export function LegacyInput({ label, error, icon, className = '', id, ...props }: LegacyInputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-sm font-medium text-[var(--text-secondary)]">{label}</label>}
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">{icon}</span>}
        <input
          id={inputId}
          className={`w-full h-[38px] px-3 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] placeholder:text-[var(--text-muted)] transition-all hover:border-[var(--border-strong)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none ${icon ? 'pl-10' : ''} ${error ? 'border-[var(--danger)]' : ''} ${className}`}
          {...props}
        />
      </div>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
