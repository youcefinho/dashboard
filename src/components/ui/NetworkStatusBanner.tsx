// ── NetworkStatusBanner — Sprint 34 vague 34-2A ──────────────────────────────
// Banner premium fixé sous le header AppLayout qui :
//   - Slide-down quand passage offline (gradient orange→rouge subtle, icon WifiOff)
//   - Slide-down "Connexion rétablie" 3s + auto-dismiss au retour online (success)
//   - Joue son + haptic via Sprint 25 endpoints (sensorial)
//   - Respecte prefers-reduced-motion (animation killed, instant transition)
//   - A11y : role="status" + aria-live="polite"
//   - Z-index 50 (sous Toast z-[9999], au-dessus du contenu principal)

import { useEffect, useRef, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { Icon } from './Icon';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { playSound, triggerHaptic } from '@/lib/sensorial';
import { t } from '@/lib/i18n';

type Phase = 'idle' | 'offline' | 'back-online';

const BACK_ONLINE_DURATION_MS = 3000;

export function NetworkStatusBanner() {
  const { isOnline } = useNetworkStatus();
  const [phase, setPhase] = useState<Phase>(isOnline ? 'idle' : 'offline');
  // Hydrate avec la valeur actuelle pour éviter un faux "back-online" au mount initial
  const prevOnlineRef = useRef<boolean>(isOnline);
  // Évite de jouer son/haptic au tout premier render (juste lecture initiale)
  const hasMountedRef = useRef<boolean>(false);

  useEffect(() => {
    const prev = prevOnlineRef.current;
    if (prev === isOnline) {
      // Hydratation initiale — pas un vrai flip
      hasMountedRef.current = true;
      return;
    }
    prevOnlineRef.current = isOnline;

    if (!isOnline) {
      // Passage offline — banner persistant
      setPhase('offline');
      if (hasMountedRef.current) {
        playSound('error');
        triggerHaptic('medium');
      }
    } else {
      // Retour online — banner success auto-dismiss
      setPhase('back-online');
      if (hasMountedRef.current) {
        playSound('success');
        triggerHaptic('light');
      }
      const timer = setTimeout(() => {
        setPhase('idle');
      }, BACK_ONLINE_DURATION_MS);
      return () => clearTimeout(timer);
    }
    hasMountedRef.current = true;
  }, [isOnline]);

  if (phase === 'idle') return null;

  const isOffline = phase === 'offline';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`network-status-banner ${isOffline ? 'is-offline' : 'is-back-online'}`}
    >
      <div className="network-status-banner-inner">
        <span className="network-status-banner-icon" aria-hidden>
          <Icon as={isOffline ? WifiOff : Wifi} size={16} strokeWidth={2.2} />
        </span>
        <span className="network-status-banner-message">
          {isOffline
            ? t('network.offline_pending')
            : t('network.back_online')}
        </span>
      </div>
    </div>
  );
}
