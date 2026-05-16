// ── useHaptic — Sprint 25 vague 4A ─────────────────────────────────────────
// Hook React qui expose Web Vibration API centralisée + persistance localStorage
// + respect prefers-reduced-motion. Délègue lib/sensorial pour la logique brute.

import { useCallback, useEffect, useState } from 'react';
import {
  triggerHaptic as triggerHapticDirect,
  getHapticEnabled,
  writeBool,
  STORAGE_KEYS,
  subscribeReducedMotion,
  isTouchDevice,
  type HapticIntensity,
} from '@/lib/sensorial';

export type { HapticIntensity };

export interface UseHapticReturn {
  vibrate: (pattern: HapticIntensity | number | number[]) => void;
  isEnabled: boolean;
  setEnabled: (v: boolean) => void;
  /** True si appareil tactile (mobile/tablette) */
  isSupported: boolean;
  /** True si prefers-reduced-motion: reduce — force disable */
  reducedMotion: boolean;
}

export function useHaptic(): UseHapticReturn {
  const [enabled, setEnabledState] = useState<boolean>(() => getHapticEnabled());
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [isSupported, setIsSupported] = useState<boolean>(false);

  useEffect(() => {
    // navigator.vibrate + touch device check
    const hasVibrate =
      typeof navigator !== 'undefined' && 'vibrate' in navigator;
    setIsSupported(hasVibrate && isTouchDevice());
  }, []);

  useEffect(() => {
    return subscribeReducedMotion((reduced) => setReducedMotion(reduced));
  }, []);

  // Sync cross-tab
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.hapticEnabled) {
        setEnabledState(getHapticEnabled());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    writeBool(STORAGE_KEYS.hapticEnabled, v);
  }, []);

  const vibrate = useCallback(
    (pattern: HapticIntensity | number | number[]) => {
      // triggerHapticDirect lit storage + reduced-motion en interne (source de vérité)
      triggerHapticDirect(pattern);
    },
    []
  );

  return {
    vibrate,
    isEnabled: enabled && !reducedMotion,
    setEnabled,
    isSupported,
    reducedMotion,
  };
}
