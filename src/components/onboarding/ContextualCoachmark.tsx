// ── ContextualCoachmark — Sprint 45 M3.2 (2026-05-15) ─────────────────
// Wrapper React qui :
//   1. Incrémente le compteur de visites de la page au mount (1 fois)
//   2. Check si le coachmark doit s'afficher (visits >= minVisits + !shown)
//   3. Affiche le Coachmark primitive avec un delay
//   4. Mark shown au close/complete
//
// Usage minimal dans une page :
//   <ContextualCoachmark page="pipeline" />
//
// Stripe-clean : zéro override visuel — relaie 100% sur la primitive refondue M3.1.

import { useEffect, useState, lazy, Suspense } from 'react';
import {
  type PageName,
  incrementPageVisits,
  shouldShowCoachmark,
  markCoachmarkShown,
  type CoachmarkRegistryEntry,
} from '@/lib/coachmarks';

const Coachmark = lazy(() =>
  import('@/components/ui/Coachmark').then((m) => ({ default: m.Coachmark }))
);

interface ContextualCoachmarkProps {
  page: PageName;
  /** Désactive l'incrément automatique de visites (pour tests / contrôle externe). */
  skipVisitTracking?: boolean;
}

export function ContextualCoachmark({ page, skipVisitTracking = false }: ContextualCoachmarkProps) {
  const [entry, setEntry] = useState<CoachmarkRegistryEntry | null>(null);
  const [open, setOpen] = useState(false);

  // Increment visits une seule fois au mount, puis check trigger
  useEffect(() => {
    if (!skipVisitTracking) {
      incrementPageVisits(page);
    }
    const candidate = shouldShowCoachmark(page);
    if (!candidate) return;
    setEntry(candidate);
    const delay = candidate.delayMs;
    const timer = window.setTimeout(() => {
      setOpen(true);
    }, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleClose = () => {
    if (entry) markCoachmarkShown(entry.id);
    setOpen(false);
  };

  const handleComplete = () => {
    if (entry) markCoachmarkShown(entry.id);
    setOpen(false);
  };

  if (!entry || !open) return null;

  return (
    <Suspense fallback={null}>
      <Coachmark
        steps={[entry.step]}
        open={open}
        onClose={handleClose}
        onComplete={handleComplete}
      />
    </Suspense>
  );
}
