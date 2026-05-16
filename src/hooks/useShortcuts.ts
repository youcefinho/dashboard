// ── useShortcuts — Sprint 41 M3.1 ─────────────────────────────────────────
// Hook React qui binde des raccourcis clavier window-level avec gestion
// cross-platform Cmd/Ctrl, skip auto sur INPUT/TEXTAREA/SELECT/contentEditable
// (sauf si modifier accompagne — ex Cmd+Enter doit fonctionner dans un textarea).
//
// Usage :
//   useShortcuts({
//     'j': (e) => goNext(),
//     'k': (e) => goPrev(),
//     'Cmd+Enter': (e) => send(),
//     'Escape': (e) => close(),
//     'ArrowLeft': (e) => prevWeek(),
//   }, { enabled: true });
//
// Keys supportées :
//   - alpha : "j", "k", "r", "e", "n", "t", "w", "d", "m"...
//   - special : "Escape", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"
//   - modifiers : "Cmd+Enter" / "Ctrl+Enter" (matchent les deux automatiquement,
//     `metaKey || ctrlKey`), "Shift+J", "Alt+M"
//
// Toujours preventDefault sur match.
// Skip si `e.repeat` (anti-spam keep-pressed).
// Skip si event dans un input/textarea/select/contentEditable, SAUF :
//   - si `ignoreInputs: false` (option opt-out)
//   - si modifier Cmd/Ctrl/Alt présent (Cmd+Enter doit fonctionner dans textarea)

import { useEffect, useRef } from 'react';

export type ShortcutHandler = (e: KeyboardEvent) => void;
export type ShortcutBindings = Record<string, ShortcutHandler>;

export interface UseShortcutsOptions {
  /** Hook actif. Default `true`. Si `false`, aucun binding ne fire. */
  enabled?: boolean;
  /** Skip si l'event provient d'un input/textarea/select/contentEditable.
   *  Default `true`. Les bindings avec modifier (Cmd/Ctrl/Alt) restent toujours
   *  actifs pour permettre Cmd+Enter dans un textarea. */
  ignoreInputs?: boolean;
}

// Spécial keys reconnus tels quels
const SPECIAL_KEYS = new Set([
  'Escape',
  'Enter',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Tab',
  ' ',
  'Backspace',
  'Delete',
  '/',
  '?',
]);

/**
 * Normalise un événement clavier en chaîne `Cmd+Enter`, `Ctrl+J`, `Shift+ArrowLeft`,
 * ou simplement `j`, `Escape`. La comparaison est case-sensitive pour les lettres
 * (binding `"j"` matche `e.key === 'j'`), insensitive pour Cmd/Ctrl (alias).
 */
function eventToKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  const hasModifier = e.metaKey || e.ctrlKey;

  if (hasModifier) parts.push('Cmd'); // alias Cmd ≡ Ctrl (cross-platform)
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  // Pour les lettres : on prend la lowercase (matche bindings "j" pas "J")
  // sauf si shift est intentionnel (binding explicite "Shift+J")
  let key = e.key;
  if (key.length === 1 && /[a-zA-Z]/.test(key)) {
    key = key.toLowerCase();
  }
  parts.push(key);

  return parts.join('+');
}

/**
 * Variants pour matcher un binding string contre l'event normalisé.
 * `"Cmd+Enter"` matche aussi `"Ctrl+Enter"` (alias cross-platform).
 */
function bindingMatches(binding: string, eventKey: string): boolean {
  if (binding === eventKey) return true;
  // alias Ctrl+ ≡ Cmd+
  if (binding.startsWith('Ctrl+') && eventKey === binding.replace(/^Ctrl\+/, 'Cmd+')) {
    return true;
  }
  if (binding.startsWith('Cmd+') && eventKey === binding.replace(/^Cmd\+/, 'Cmd+')) {
    return true;
  }
  return false;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useShortcuts(
  bindings: ShortcutBindings,
  options?: UseShortcutsOptions,
): void {
  const enabled = options?.enabled ?? true;
  const ignoreInputs = options?.ignoreInputs ?? true;

  // Ref pour bindings : permet handler stable (un seul addEventListener au mount)
  // tout en lisant les fresh closures à chaque keydown.
  const bindingsRef = useRef<ShortcutBindings>(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Anti-spam : ne pas firer sur key held down
      if (e.repeat) return;
      // Si un handler local (ex Textarea onKeyDown send sur Enter) a déjà
      // preventDefault, on respecte sa décision et on skip ici.
      if (e.defaultPrevented) return;

      const eventKey = eventToKey(e);
      const hasModifier = e.metaKey || e.ctrlKey || e.altKey;

      // Skip si target éditable, SAUF si modifier accompagne
      // (permet Cmd+Enter dans un textarea pour send)
      if (ignoreInputs && isEditableTarget(e.target) && !hasModifier) {
        return;
      }

      // Match bindings via ref : fresh handlers chaque keydown sans rebind listener
      const current = bindingsRef.current;
      for (const [binding, handler] of Object.entries(current)) {
        // Normalise le binding : lettre minuscule (sauf si shift explicite)
        let normalizedBinding = binding;
        const lastPart = binding.split('+').pop() || '';
        if (lastPart.length === 1 && /[a-zA-Z]/.test(lastPart)) {
          // garder le reste, lowercase le dernier
          const head = binding.slice(0, binding.length - lastPart.length);
          normalizedBinding = head + lastPart.toLowerCase();
        }

        if (bindingMatches(normalizedBinding, eventKey)) {
          // preventDefault sur match (ex : "/" pour focus search ne doit pas écrire "/" dans input)
          e.preventDefault();
          handler(e);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, ignoreInputs]);
}

// Export utilitaire interne (testable)
export const __testables = { eventToKey, bindingMatches, isEditableTarget, SPECIAL_KEYS };
