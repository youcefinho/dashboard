// ── useBackHandler — Sprint 44 M3.4 ────────────────────────────────────────
// Stack global de handlers "back" pour edge-swipe + Android-back-button + ESC.
// Le composant qui ouvre un SlidePanel/Modal/Wizard appelle `useBackHandler(onClose, isOpen)` :
//   - register au mount/open, unregister au unmount/close
//   - AppLayout (useEdgeSwipe global) consomme `consumeTopBackHandler()` avant
//     de tomber sur `window.history.back()`.
//   - Si plusieurs panels stack (LeadDetail → TaskPanel par exemple), le top
//     du stack est consommé en premier (LIFO).
//
// API minimale :
//   useBackHandler(callback, enabled = true)
//
// AppLayout :
//   const consume = consumeTopBackHandler();
//   const swipe = useEdgeSwipe({
//     onSwipeBack: () => {
//       if (!consume()) window.history.back();
//     },
//   });

import { useEffect, useRef } from 'react';

type BackHandler = () => void;

const backHandlerStack: BackHandler[] = [];

/**
 * Enregistre un handler "back" dans le stack global.
 * - Tant que `enabled` est true, le handler est dans le stack.
 * - Le handler en haut de pile est appelé en premier par le edge swipe global.
 * - Auto-cleanup au unmount.
 *
 * @example
 *   useBackHandler(() => setPanelOpen(false), panelOpen);
 */
export function useBackHandler(callback: BackHandler, enabled = true): void {
  // Ref évite de re-register quand le callback change d'identité (pattern stable handler)
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    const handler: BackHandler = () => callbackRef.current();
    backHandlerStack.push(handler);
    return () => {
      const idx = backHandlerStack.indexOf(handler);
      if (idx >= 0) backHandlerStack.splice(idx, 1);
    };
  }, [enabled]);
}

/**
 * Tente de consommer le handler "back" en haut de pile.
 * Retourne true si un handler a été appelé, false sinon (caller doit fallback
 * sur history.back() ou no-op).
 *
 * Appelé par AppLayout/useEdgeSwipe au swipe-from-edge.
 */
export function consumeTopBackHandler(): boolean {
  const handler = backHandlerStack[backHandlerStack.length - 1];
  if (!handler) return false;
  handler();
  return true;
}

/**
 * Renvoie le nombre de handlers actuellement enregistrés (debug + tests).
 */
export function getBackHandlerStackSize(): number {
  return backHandlerStack.length;
}
