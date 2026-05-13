// ── LeadPanel — SlidePanel wrapper autour de LeadDetailBody ──────────────
// Utilisé par PanelStackProvider via le renderer { lead: LeadPanel }.
// Le panel s'auto-ferme via `closeTopPanel` au close. Bouton "Ouvrir en page"
// navigue vers /leads/:id et ferme le panel.

import { lazy, Suspense } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { SlidePanel, usePanelStack, Skeleton } from '@/components/ui';

// LeadDetailBody est lourd → lazy import pour pas charger sur les pages qui
// n'ouvrent jamais le panel
const LeadDetailBody = lazy(() =>
  import('@/pages/LeadDetail').then(m => ({ default: m.LeadDetailBody }))
);

interface LeadPanelProps {
  id: string;
  stackLevel: number;
}

export function LeadPanel({ id, stackLevel }: LeadPanelProps) {
  const { closeTopPanel, closeAllPanels } = usePanelStack();
  const navigate = useNavigate();

  return (
    <SlidePanel
      open={true}
      onOpenChange={(o) => { if (!o) closeTopPanel(); }}
      title="Fiche lead"
      size="lg"
      stackLevel={stackLevel}
      onOpenFull={() => {
        closeAllPanels();
        void navigate({ to: `/leads/${id}` });
      }}
    >
      <Suspense fallback={<div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-60 w-full" /></div>}>
        <LeadDetailBody leadId={id} compact />
      </Suspense>
    </SlidePanel>
  );
}
