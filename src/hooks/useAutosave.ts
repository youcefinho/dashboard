// ── useAutosave — Hook autosave debounce (Sprint 24 vague 6A) ───────────────
// Trigger automatique d'un save debouncé quand `value` change. Expose les
// états compatible avec <AutosaveIndicator>. Support cmd+S force save.
//
// Usage :
//   const { state, lastSaved, retry, forceSave } = useAutosave({
//     value: { name, email, signature },
//     onSave: async (val) => { await updateProfile(val); },
//     debounceMs: 1200,
//   });

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AutosaveState } from '@/components/ui/AutosaveIndicator';

interface UseAutosaveOptions<T> {
  value: T;
  onSave: (value: T) => Promise<void> | void;
  /** Debounce avant déclenchement save — défaut 1200ms */
  debounceMs?: number;
  /** Désactive l'autosave (ex: loading initial) — défaut false */
  disabled?: boolean;
}

interface UseAutosaveResult {
  state: AutosaveState;
  lastSaved: Date | null;
  /** Retry après erreur */
  retry: () => void;
  /** Force save immédiat (cmd+S) */
  forceSave: () => void;
}

export function useAutosave<T>({
  value,
  onSave,
  debounceMs = 1200,
  disabled = false,
}: UseAutosaveOptions<T>): UseAutosaveResult {
  const [state, setState] = useState<AutosaveState>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const initialRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const decayRef = useRef<number | null>(null);
  const valueRef = useRef(value);

  // Keep ref up to date for forceSave/retry
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const performSave = useCallback(async () => {
    setState('saving');
    try {
      await onSave(valueRef.current);
      setState('saved');
      setLastSaved(new Date());
      initialRef.current = JSON.stringify(valueRef.current);
      // Auto-decay vers idle après 5s
      if (decayRef.current) window.clearTimeout(decayRef.current);
      decayRef.current = window.setTimeout(() => {
        setState((s) => (s === 'saved' ? 'idle' : s));
      }, 5000);
    } catch {
      setState('error');
    }
  }, [onSave]);

  // Effet principal : détecte changement vs initial
  useEffect(() => {
    if (disabled) return;
    const serialized = JSON.stringify(value);
    // Premier passage : initialiser snapshot sans déclencher save
    if (initialRef.current === null) {
      initialRef.current = serialized;
      return;
    }
    if (serialized === initialRef.current) {
      // Revenu à l'état initial — clean dirty
      setState((s) => (s === 'dirty' ? 'idle' : s));
      if (timerRef.current) window.clearTimeout(timerRef.current);
      return;
    }

    setState('dirty');
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void performSave();
    }, debounceMs);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [value, disabled, debounceMs, performSave]);

  // Cleanup décay au démontage
  useEffect(() => {
    return () => {
      if (decayRef.current) window.clearTimeout(decayRef.current);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const forceSave = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    void performSave();
  }, [performSave]);

  const retry = useCallback(() => {
    void performSave();
  }, [performSave]);

  // cmd+S / ctrl+S : force save immédiat
  useEffect(() => {
    if (disabled) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        // Only when we have something to save
        if (state === 'dirty' || state === 'error') {
          e.preventDefault();
          forceSave();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [state, disabled, forceSave]);

  return { state, lastSaved, retry, forceSave };
}
