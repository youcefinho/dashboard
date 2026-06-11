// ── useOfflineSync.ts — Sprint 97 (seq192) ──────────────────────────────────
// Hook React pour synchroniser le store offline avec le serveur.
//
// Fonctionnalités :
//   - Détecte online/offline via navigator.onLine + événements
//   - Rejoue la sync queue au retour online
//   - Affiche un toast avec le résultat du rejeu
//   - Fournit le compteur de mutations en attente
//
// Usage : const { isOffline, pendingCount } = useOfflineSync();

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getSyncQueueCount,
  replayOfflineQueue,
  pruneStaleData,
} from '@/lib/offline-store';
import { apiFetch } from '@/lib/api';

export interface OfflineSyncState {
  /** True si l'appareil est hors-ligne. */
  isOffline: boolean;
  /** Nombre de mutations en attente dans la sync queue. */
  pendingCount: number;
  /** True si un rejeu est en cours. */
  isSyncing: boolean;
  /** Force un rejeu manuel de la queue. */
  forceSync: () => Promise<void>;
}

export function useOfflineSync(): OfflineSyncState {
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);

  // Mettre à jour le compteur
  const refreshCount = useCallback(async () => {
    try {
      const count = await getSyncQueueCount();
      setPendingCount(count);
    } catch {
      // IDB non disponible — on ignore
    }
  }, []);

  // Rejouer la queue
  const doSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);

    try {
      const { replayed, failed } = await replayOfflineQueue(
        (path, init) => apiFetch(path, init as Record<string, unknown>),
      );

      if (replayed > 0 || failed > 0) {
        // Le toast sera affiché par le composant parent via le compteur
        await refreshCount();
      }

      // Nettoyer les données anciennes (best-effort)
      await pruneStaleData();
    } catch {
      // Erreur de sync — on réessaiera plus tard
    }

    setIsSyncing(false);
    syncingRef.current = false;
  }, [refreshCount]);

  // Écouter les changements de connectivité
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      // Rejouer la queue au retour online
      void doSync();
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Charger le compteur initial
    void refreshCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [doSync, refreshCount]);

  return {
    isOffline,
    pendingCount,
    isSyncing,
    forceSync: doSync,
  };
}
