// ── useOnboardingItemCompletion — Sprint 21 (Onboarding durci) ──────────────
//
// Hook idempotent à brancher dans les pages métier (Settings/Pipeline/Leads/
// Integrations/etc.). Quand `shouldComplete` passe à `true`, appelle
// `completeOnboardingItem(itemKey)` UNE seule fois pour la session du tenant
// (flag localStorage).
//
// Sémantique :
//   - Idempotent : multiple mounts / re-renders avec `shouldComplete === true`
//     ne déclenchent qu'UN seul appel API tant que le flag localStorage est set.
//   - Best-effort : si l'API fail (network/500), on RESET le flag in-memory pour
//     permettre un retry au prochain mount où la condition reste vraie. On NE
//     persiste pas le flag dans localStorage tant que l'API n'a pas confirmé.
//   - Storage : flag `onboarding_item_<itemKey>_completed` = 'true' après
//     succès. Si localStorage indispo (SSR, mode privé), le fallback in-memory
//     suffit pour empêcher le re-fire dans la même session de page.
//
// Usage type :
//   useOnboardingItemCompletion('profile_completed', !!user?.name && !!user?.email);
//
// Convention de naming des flags localStorage choisie pour ne PAS collider avec
// les flags existants S8/Sprint 45 utilisés par OnboardingProgressChip :
//   - chip lit `profile_completed` / `pipeline_configured` / ...  (valeur '1')
//   - ce hook lit `onboarding_item_<itemKey>_completed` (valeur 'true')
// Les deux peuvent coexister en parallèle sans confusion : l'un est l'état UI
// local du chip historique, l'autre est le "lock" anti-re-fire du hook serveur.

import { useEffect, useRef } from 'react';
import { completeOnboardingItem } from '@/lib/api';
import type { OnboardingChecklistItemKey } from '@/lib/types';

const STORAGE_PREFIX = 'onboarding_item_';
const STORAGE_SUFFIX = '_completed';

function readFlag(itemKey: OnboardingChecklistItemKey): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${itemKey}${STORAGE_SUFFIX}`) === 'true';
  } catch {
    return false;
  }
}

function writeFlag(itemKey: OnboardingChecklistItemKey): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${itemKey}${STORAGE_SUFFIX}`, 'true');
  } catch {
    /* localStorage indispo — fallback in-memory via ref suffit */
  }
}

export function useOnboardingItemCompletion(
  itemKey: OnboardingChecklistItemKey,
  shouldComplete: boolean,
): void {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!shouldComplete) return;
    if (firedRef.current) return;

    // Si le flag localStorage est déjà set, on considère l'item déjà tagué
    // côté client — on évite l'appel API redondant.
    if (readFlag(itemKey)) {
      firedRef.current = true;
      return;
    }

    firedRef.current = true;

    completeOnboardingItem(itemKey)
      .then((res) => {
        if (!res.error) {
          writeFlag(itemKey);
        } else {
          // Échec API : on RESET pour autoriser un retry au prochain mount.
          firedRef.current = false;
        }
      })
      .catch(() => {
        firedRef.current = false;
      });
  }, [itemKey, shouldComplete]);
}
