// ── useSound — Sprint 25 vague 4A ──────────────────────────────────────────
// Hook React qui expose la lecture des 7 micro-sons procéduraux Sprint 25 +
// l'état utilisateur (enabled, volume) avec persistance localStorage.
//
// AudioContext + générateurs sont délégués à lib/sensorial (singleton partagé
// avec playSound non-hook). Le hook gère uniquement l'état UI + sync storage.
//
// `prefers-reduced-motion` : observé en live. Quand actif → isEnabled retourne
// false et play() est no-op (impossible de re-enable tant que la préférence
// système est active).

import { useCallback, useEffect, useState } from 'react';
import {
  playSound as playSoundDirect,
  getSoundEnabled,
  getSoundVolume,
  writeBool,
  writeFloat,
  STORAGE_KEYS,
  subscribeReducedMotion,
  type SoundName,
} from '@/lib/sensorial';

export type { SoundName };

export interface UseSoundReturn {
  play: (name: SoundName) => void;
  isEnabled: boolean;
  setEnabled: (v: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
  /** True si prefers-reduced-motion: reduce — force disable */
  reducedMotion: boolean;
}

export function useSound(): UseSoundReturn {
  const [enabled, setEnabledState] = useState<boolean>(() => getSoundEnabled());
  const [volume, setVolumeState] = useState<number>(() => getSoundVolume());
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  // Subscribe live à prefers-reduced-motion
  useEffect(() => {
    return subscribeReducedMotion((reduced) => setReducedMotion(reduced));
  }, []);

  // Sync cross-tab : écoute storage events pour propager changements
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.soundEnabled) {
        setEnabledState(getSoundEnabled());
      } else if (e.key === STORAGE_KEYS.soundVolume) {
        setVolumeState(getSoundVolume());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    writeBool(STORAGE_KEYS.soundEnabled, v);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    writeFloat(STORAGE_KEYS.soundVolume, clamped);
  }, []);

  const play = useCallback(
    (name: SoundName) => {
      // playSoundDirect lit localStorage + reduced-motion en interne (source de vérité)
      playSoundDirect(name);
    },
    // pas de deps : on délègue à la fonction globale qui lit toujours frais
    []
  );

  return {
    play,
    isEnabled: enabled && !reducedMotion,
    setEnabled,
    volume,
    setVolume,
    reducedMotion,
  };
}
