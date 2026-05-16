// ── SwUpdatePrompt — Sprint 44 M2.4 ─────────────────────────────────────────
// Mount global dans AppLayout. Surveille `useSwUpdate()` et déclenche un Toast
// PERSISTANT (duration: 0) quand une nouvelle version du Service Worker est
// installée et waiting. CTA primary "Recharger" → applyUpdate() → reload.
//
// Préservations :
//   - Aucun bouton de fermeture du toast (persistant) — l'user DOIT
//     reload OU ignorer jusqu'au prochain refresh manuel.
//   - Pas de spam : un seul toast déclenché par session (guard via ref).

import { useEffect, useRef } from 'react';
import { useSwUpdate } from '@/hooks/useSwUpdate';
import { useToast } from '@/components/ui/Toast';

export function SwUpdatePrompt() {
  const toast = useToast();
  const { hasUpdate, applyUpdate } = useSwUpdate();
  const shownRef = useRef(false);

  useEffect(() => {
    if (!hasUpdate || shownRef.current) return;
    shownRef.current = true;

    toast.info('Une nouvelle version d\'Intralys est prête.', {
      title: 'Mise à jour disponible',
      duration: 0, // persistant — pas d'auto-dismiss
      action: {
        label: 'Recharger',
        onClick: () => {
          applyUpdate();
        },
      },
    });
  }, [hasUpdate, applyUpdate, toast]);

  return null;
}
