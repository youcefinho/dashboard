// ── useSwUpdate — Sprint 44 M2.4 ─────────────────────────────────────────────
// Détecte la disponibilité d'une nouvelle version du service worker.
//
// Mécanique :
//   1. Le SW est registered inline dans index.html (script bootstrap Sprint 23).
//      Le hook récupère le `ServiceWorkerRegistration` actif via
//      `navigator.serviceWorker.ready` (résout dès qu'un SW est actif).
//   2. On observe `registration.installing` pour détecter qu'une nouvelle
//      version est en cours d'install (event 'updatefound' sur la registration).
//   3. Quand le nouveau SW passe en `installed` ET il y a déjà un controller →
//      c'est une UPDATE (pas un premier install) → on set `hasUpdate=true`.
//   4. `applyUpdate()` postMessage `{ type: 'SKIP_WAITING' }` au waiting SW,
//      attend l'event `controllerchange` (le nouveau SW prend le contrôle), puis
//      reload la page.
//
// Sécurité :
//   - SSR-safe via `typeof window` gate
//   - Pas de polling : event-driven via API ServiceWorkerRegistration
//   - Idempotent : un seul listener par registration

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseSwUpdateReturn {
  /** True si une nouvelle version SW est installée et waiting */
  hasUpdate: boolean;
  /** Active le nouveau SW (postMessage SKIP_WAITING) puis reload */
  applyUpdate: () => void;
  /** Force un check manuel (sinon le browser check ~24h par défaut) */
  checkForUpdate: () => Promise<void>;
}

export function useSwUpdate(): UseSwUpdateReturn {
  const [hasUpdate, setHasUpdate] = useState(false);
  const waitingRef = useRef<ServiceWorker | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    // Helper : binde les listeners d'update sur une registration
    const wireRegistration = (reg: ServiceWorkerRegistration) => {
      if (cancelled) return;
      registrationRef.current = reg;

      // Cas 1 : il y a déjà un waiting SW au mount (page refresh juste après
      // un install background → on offre direct la mise à jour).
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingRef.current = reg.waiting;
        setHasUpdate(true);
      }

      // Cas 2 : un nouvel installing SW arrive
      const handleUpdateFound = () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // Update (pas premier install)
              waitingRef.current = installing;
              setHasUpdate(true);
            }
          }
        });
      };
      reg.addEventListener('updatefound', handleUpdateFound);
    };

    // navigator.serviceWorker.ready : résout dès qu'un SW est actif (after
    // l'index.html register). Sinon getRegistration() pour fallback.
    void navigator.serviceWorker.ready.then(wireRegistration).catch(() => {
      void navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) wireRegistration(reg);
      });
    });

    // Quand le controller change (= nouveau SW pris contrôle) → reload pour
    // garantir que tous les modules sont rechargés cohérents avec le nouveau cache.
    const handleControllerChange = () => {
      if (cancelled) return;
      // Évite reload boucle infinie : on ne reload QUE si on a déclenché un applyUpdate
      // (sinon c'est le premier install au boot → no-op)
      if (waitingRef.current) {
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const waiting = waitingRef.current;
    if (!waiting) {
      // Fallback : reload simple si pas de waiting SW capturé
      window.location.reload();
      return;
    }
    try {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      // Si postMessage fail → reload direct
      window.location.reload();
    }
    // Le reload effectif arrive via le listener 'controllerchange' ci-dessus.
  }, []);

  const checkForUpdate = useCallback(async () => {
    const reg = registrationRef.current;
    if (!reg) return;
    try {
      await reg.update();
    } catch {
      /* ignore — typiquement offline */
    }
  }, []);

  return { hasUpdate, applyUpdate, checkForUpdate };
}
