// ── LiveRegion — Screen reader announcement primitive (Sprint 34 vague 34-3B) ─
// Composant invisible (sr-only) avec `role="status"` (polite) ou `role="alert"`
// (assertive) pour annoncer des changements d'état aux lecteurs d'écran
// (NVDA, JAWS, VoiceOver). Reset après `clearAfter` ms pour permettre une
// re-annonce future identique.
//
// Pour un usage global, préférer `announceSR()` + `<LiveRegionPortal />`
// monté dans AppLayout (cf. `@/lib/announce`).

import { useEffect, useState, type CSSProperties } from 'react';

export interface LiveRegionProps {
  /** Message à annoncer. Vide = pas d'annonce. */
  message: string;
  /** 'polite' = attend une pause (default). 'assertive' = interrompt. */
  politeness?: 'polite' | 'assertive';
  /** Reset le message après N ms (default 5000) pour permettre re-annonce */
  clearAfter?: number;
  /** Classe additionnelle (mais le rendu reste visuellement invisible) */
  className?: string;
}

const SR_ONLY_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function LiveRegion({
  message,
  politeness = 'polite',
  clearAfter = 5000,
  className,
}: LiveRegionProps) {
  const [current, setCurrent] = useState(message);

  useEffect(() => {
    if (!message) return;
    setCurrent(message);
    if (clearAfter <= 0) return;
    const t = window.setTimeout(() => setCurrent(''), clearAfter);
    return () => window.clearTimeout(t);
  }, [message, clearAfter]);

  return (
    <div
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic="true"
      className={className}
      style={SR_ONLY_STYLE}
    >
      {current}
    </div>
  );
}
