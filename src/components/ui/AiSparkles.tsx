// ── AiSparkles — Bouton flottant de réécriture AI inline ────────────────────
// Différenciateur français québécois vs GHL. Click sur Sparkles → menu Popover
// avec 4 actions (améliorer, raccourcir, formel, amical). Loading state, undo 5s.
//
// Usage typique sur un textarea contrôlé :
//   <div className="relative">
//     <textarea value={text} onChange={e => setText(e.target.value)} />
//     <AiSparkles value={text} onChange={setText} leadId={leadId} className="absolute bottom-2 right-2" />
//   </div>

import { useState, useRef, useEffect } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Sparkles, Loader2, Wand2, Scissors, Briefcase, Smile, Check, Undo2 } from 'lucide-react';
import { aiGenerate, type AiAction } from '@/lib/api';
import { useToast } from './Toast';
import { cn } from '@/lib/cn';

type InlineAction = Extract<AiAction, 'improve_text' | 'shorten' | 'formalize' | 'casualize'>;

interface AiSparklesProps {
  value: string;
  onChange: (next: string) => void;
  /** Contexte additionnel passé à l'AI (ex: lead name, conversation history) */
  leadId?: string;
  clientId?: string;
  className?: string;
  /** Désactive le bouton (pas seulement visuel : ne s'ouvre pas) */
  disabled?: boolean;
  /** Délai en ms pendant lequel l'undo reste affordable. Defaults to 5000. */
  undoMs?: number;
}

const ACTIONS: Array<{ id: InlineAction; label: string; icon: typeof Wand2; description: string }> = [
  { id: 'improve_text', label: 'Améliorer', icon: Wand2, description: 'Corriger fautes, clarifier' },
  { id: 'shorten', label: 'Raccourcir', icon: Scissors, description: 'Réduire ~50%' },
  { id: 'formalize', label: 'Formel', icon: Briefcase, description: 'Registre professionnel' },
  { id: 'casualize', label: 'Amical', icon: Smile, description: 'Registre chaleureux' },
];

export function AiSparkles({ value, onChange, leadId, clientId, className, disabled, undoMs = 5000 }: AiSparklesProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [undoState, setUndoState] = useState<{ previous: string; action: InlineAction } | null>(null);
  const { error: toastError } = useToast();
  const undoTimerRef = useRef<number | null>(null);

  // Cleanup timer au unmount
  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  const isDisabled = disabled || !value.trim() || isLoading;

  const handleAction = async (action: InlineAction) => {
    setIsOpen(false);
    if (isDisabled) return;
    const previous = value;
    setIsLoading(true);
    const res = await aiGenerate({
      action,
      text: value,
      lead_id: leadId,
      client_id: clientId,
    });
    setIsLoading(false);
    if (res.error || !res.data?.content) {
      toastError(`Erreur AI : ${res.error || 'pas de contenu retourné'}`);
      return;
    }
    onChange(res.data.content.trim());
    // Set up undo
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({ previous, action });
    undoTimerRef.current = window.setTimeout(() => setUndoState(null), undoMs);
  };

  const handleUndo = () => {
    if (!undoState) return;
    onChange(undoState.previous);
    setUndoState(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  };

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      {undoState && (
        <button
          type="button"
          onClick={handleUndo}
          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--brand-tint)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer animate-in fade-in-0 slide-in-from-right-2"
          title="Annuler la transformation AI"
        >
          <Undo2 size={11} /> Annuler
        </button>
      )}
      <Popover.Root open={isOpen} onOpenChange={(o) => !isDisabled && setIsOpen(o)}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={isDisabled}
            className={cn(
              'inline-flex items-center justify-center w-7 h-7 rounded-full transition-all cursor-pointer',
              'bg-gradient-to-br from-[var(--brand-primary)] to-[var(--accent-orange)] text-white',
              'shadow-[0_2px_6px_oklch(0.7_0.15_220/0.3)] hover:shadow-[0_3px_10px_oklch(0.7_0.15_220/0.5)] hover:scale-105',
              'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-[0_2px_6px_oklch(0.7_0.15_220/0.3)]',
              isLoading && 'animate-pulse'
            )}
            title={isLoading ? 'L\'AI réfléchit...' : isDisabled && !value.trim() ? 'Écrivez du texte d\'abord' : 'Réécrire avec l\'AI'}
            aria-label="Réécrire avec l'AI"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="end"
            sideOffset={8}
            className="z-[60] w-56 p-1 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[var(--shadow-lg)] animate-in fade-in-0 zoom-in-95"
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Réécrire avec l'AI
            </div>
            {ACTIONS.map(({ id, label, icon: Icon, description }) => (
              <button
                key={id}
                type="button"
                onClick={() => void handleAction(id)}
                className="w-full flex items-start gap-2.5 px-2 py-1.5 rounded-[var(--radius-sm)] text-left hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer group"
              >
                <Icon size={14} className="mt-0.5 text-[var(--brand-primary)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[var(--text-primary)]">{label}</div>
                  <div className="text-[10px] text-[var(--text-muted)] truncate">{description}</div>
                </div>
              </button>
            ))}
            <div className="border-t border-[var(--border-subtle)] mt-1 px-2 py-1 text-[9px] text-[var(--text-muted)] flex items-center gap-1">
              <Check size={10} /> Claude Haiku 4.5 — FR québécois
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
