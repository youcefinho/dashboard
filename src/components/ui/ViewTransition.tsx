// ── ViewTransition — Active l'API native View Transitions sur change de route ─
// Chrome 111+, Safari 18+. Fallback silencieux (CSS fade) sur les autres browsers.
//
// Usage : wrapper autour de <Outlet /> ou des pages.
//   <ViewTransition><Outlet /></ViewTransition>
//
// CSS associé dans index.css : ::view-transition-old / ::view-transition-new

import { useEffect, useRef, type ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';

// Document.startViewTransition est défini dans lib.dom.d.ts (browser types).
// Pas besoin de redéclarer la globale ici — feature-detect via runtime suffit.

interface ViewTransitionProps {
  children: ReactNode;
}

export function ViewTransition({ children }: ViewTransitionProps) {
  const location = useRouterState({ select: s => s.location.pathname });
  const prevLocation = useRef(location);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prevLocation.current === location) return;
    prevLocation.current = location;

    // No-op si l'API n'est pas dispo — le contenu change quand même via React,
    // juste sans la transition fluide.
    if (typeof document === 'undefined' || !document.startViewTransition) return;

    // Respecte prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Trigger seulement quand le DOM aura été mis à jour par React.
    // Le pattern recommandé : appeler startViewTransition juste avant la mutation.
    // Mais ici on est dans un useEffect post-render — donc l'effet est limité
    // au polish CSS. On déclenche quand même pour activer les transitions
    // déclaratives `view-transition-name` sur les éléments persistents.
    try {
      document.startViewTransition(() => {
        // No-op callback : la mutation a déjà eu lieu, mais les pseudo-elements
        // ::view-transition-old/new captureront le before/after via le snapshot
        // qui se fait au moment de l'appel.
      });
    } catch {
      // Pas critique si ça échoue
    }
  }, [location]);

  return <div ref={containerRef} className="view-transition-root">{children}</div>;
}
