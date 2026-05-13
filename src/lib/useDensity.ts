// ── useDensity — Hook pour gérer le mode densité UI ─────────────────────────
// 3 modes : 'compact' · 'comfortable' (défaut) · 'spacious'.
// Applique data-density sur <html>, propage via CSS variables (cf. index.css).
// Persiste dans localStorage.

import { useState, useEffect, useCallback } from 'react';

export type Density = 'compact' | 'comfortable' | 'spacious';

const STORAGE_KEY = 'intralys_density';

function readStorage(): Density {
  if (typeof localStorage === 'undefined') return 'comfortable';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'compact' || v === 'spacious' ? v : 'comfortable';
}

function applyToDom(density: Density): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-density', density);
}

export function useDensity(): { density: Density; setDensity: (d: Density) => void; cycle: () => void } {
  const [density, setDensityState] = useState<Density>(() => readStorage());

  useEffect(() => {
    applyToDom(density);
    localStorage.setItem(STORAGE_KEY, density);
  }, [density]);

  const setDensity = useCallback((d: Density) => setDensityState(d), []);

  const cycle = useCallback(() => {
    setDensityState(prev => prev === 'compact' ? 'comfortable' : prev === 'comfortable' ? 'spacious' : 'compact');
  }, []);

  return { density, setDensity, cycle };
}
