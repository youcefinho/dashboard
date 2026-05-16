// ── ConfirmDialog — Modal confirm/prompt avec API Promise ─────
// Remplace les natifs confirm() / prompt() / alert() pour cohérence UI.
// Usage :
//   const confirm = useConfirm();
//   const ok = await confirm({ title: '...', description: '...', danger: true });
//
//   const prompt = usePrompt();
//   const name = await prompt({ title: 'Nom de la liste', placeholder: '...' });
//
// Pour les irréversibles compliance (Loi 25 forget) :
//   await confirm({ ..., requireText: 'SUPPRIMER' })  // user doit taper "SUPPRIMER"

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
// Sprint 25 vague 4B — son success au confirm (silent au cancel)
import { playSound } from '@/lib/sensorial';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Si fourni, l'user doit taper cette string exacte pour activer le bouton confirm */
  requireText?: string;
}

interface PromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

type Resolver<T> = (value: T) => void;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<{ options: ConfirmOptions; resolver: Resolver<boolean> } | null>(null);
  const [promptState, setPromptState] = useState<{ options: PromptOptions; resolver: Resolver<string | null> } | null>(null);
  const [textValue, setTextValue] = useState('');
  const [promptValue, setPromptValue] = useState('');

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setTextValue('');
      setConfirmState({ options, resolver: resolve });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>(resolve => {
      setPromptValue(options.defaultValue || '');
      setPromptState({ options, resolver: resolve });
    });
  }, []);

  const closeConfirm = (result: boolean) => {
    // Sprint 25 vague 4B — son success uniquement sur confirm OK (silent au cancel)
    if (result) {
      playSound('success');
    }
    if (confirmState) confirmState.resolver(result);
    setConfirmState(null);
  };

  const closePrompt = (result: string | null) => {
    if (promptState) promptState.resolver(result);
    setPromptState(null);
  };

  const requiredOK = confirmState?.options.requireText
    ? textValue === confirmState.options.requireText
    : true;

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}

      {confirmState && (
        <Modal open onOpenChange={(v) => { if (!v) closeConfirm(false); }} title={confirmState.options.title}>
          <div className="space-y-4">
            {confirmState.options.description && (
              <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
                {confirmState.options.description}
              </p>
            )}
            {confirmState.options.requireText && (
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)] block mb-1.5">
                  Tapez <code className="px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--danger)] font-mono">{confirmState.options.requireText}</code> pour confirmer
                </label>
                <Input value={textValue} onChange={e => setTextValue(e.target.value)} autoFocus />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => closeConfirm(false)}>
                {confirmState.options.cancelLabel || 'Annuler'}
              </Button>
              <Button
                variant={confirmState.options.danger ? 'destructive' : 'primary'}
                onClick={() => closeConfirm(true)}
                disabled={!requiredOK}>
                {confirmState.options.confirmLabel || 'Confirmer'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {promptState && (
        <Modal open onOpenChange={(v) => { if (!v) closePrompt(null); }} title={promptState.options.title}>
          <div className="space-y-4">
            {promptState.options.description && (
              <p className="text-sm text-[var(--text-secondary)]">{promptState.options.description}</p>
            )}
            <Input
              value={promptValue}
              onChange={e => setPromptValue(e.target.value)}
              placeholder={promptState.options.placeholder}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && promptValue.trim()) closePrompt(promptValue); }}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => closePrompt(null)}>
                {promptState.options.cancelLabel || 'Annuler'}
              </Button>
              <Button onClick={() => closePrompt(promptValue)} disabled={!promptValue.trim()}>
                {promptState.options.confirmLabel || 'OK'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx.confirm;
}

export function usePrompt() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('usePrompt must be used within ConfirmProvider');
  return ctx.prompt;
}
