// ── useNetworkStatus — Sprint 34 vague 34-2A ─────────────────────────────────
// Hook React qui expose l'état online/offline + timestamp du dernier changement
// en wrappant `navigator.onLine` + les events `online`/`offline`. SSR-safe (default
// online si navigator inaccessible).
//
// Usage :
//   const { isOnline, lastChange } = useNetworkStatus();
//
// Retour :
//   - isOnline   : boolean — true si la connexion est active
//   - lastChange : Date    — instant du dernier changement détecté (init = mount)

import { useEffect, useState } from 'react';

export interface NetworkStatus {
  /** Connexion active selon `navigator.onLine` + events */
  isOnline: boolean;
  /** Timestamp du dernier flip détecté — utile pour animations / timers */
  lastChange: Date;
}

function readInitialOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine ?? true;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() => readInitialOnline());
  const [lastChange, setLastChange] = useState<Date>(() => new Date());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Sync initial au mount — au cas où l'état aurait flip avant l'effect
    const initial = readInitialOnline();
    setIsOnline((prev) => (prev === initial ? prev : initial));

    const handleOnline = () => {
      setIsOnline(true);
      setLastChange(new Date());
    };
    const handleOffline = () => {
      setIsOnline(false);
      setLastChange(new Date());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, lastChange };
}

/**
 * Alias public de `useNetworkStatus` pour sémantique "online/offline" claire.
 * Comportement byte-identique : retourne `{ isOnline: boolean; lastChange: Date }`.
 * `lastChange` est initialisé à la date du mount (jamais null).
 *
 * @example
 *   const { isOnline } = useOnlineStatus();
 *   if (!isOnline) return <OfflineBanner />;
 */
export const useOnlineStatus = useNetworkStatus;
