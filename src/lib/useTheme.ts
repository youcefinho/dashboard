// ── useTheme — Gestion du thème Dark/Light ──────────────────

import { useState, useEffect, useCallback } from 'react';

type Theme = 'dark' | 'light';

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('intralys-theme') as Theme) || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('intralys-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    // Activer les transitions pour le changement de thème
    document.documentElement.setAttribute('data-transitioning', '');
    setThemeState(prev => prev === 'dark' ? 'light' : 'dark');
    // Retirer après la transition
    setTimeout(() => {
      document.documentElement.removeAttribute('data-transitioning');
    }, 400);
  }, []);

  return { theme, toggleTheme };
}
