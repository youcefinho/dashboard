// ── usePwaInstall — Sprint 44 M2.1 ───────────────────────────────────────────
// Hook qui détecte `beforeinstallprompt`, stocke l'event, expose `promptInstall`
// + `dismiss` + état machine. Persistance dismiss via localStorage avec re-prompt
// après 7 jours. Detect `appinstalled` event pour fire callback (Toast success).
//
// Usage :
//   const { canInstall, isInstalled, promptInstall, dismiss } = usePwaInstall({
//     onInstalled: () => toast.success("Installée !")
//   });
//
// Notes :
//   - SSR-safe : checks `typeof window` avant tout listener
//   - StrictMode-safe : refs pour event original (pas perdu au remount)
//   - displayMode standalone détecté → isInstalled true (déjà installée)
//   - dismiss persiste timestamp ms, re-prompt après RE_PROMPT_AFTER_MS

import { useCallback, useEffect, useRef, useState } from 'react';

// Re-prompt 7 jours après un dismiss explicite (cf. brief M2.1)
const RE_PROMPT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const DISMISS_KEY = 'pwa_install_dismissed_at';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface UsePwaInstallOptions {
  /** Callback déclenché à l'event `appinstalled` (post-install OS) */
  onInstalled?: () => void;
  /** Callback déclenché si l'utilisateur dismiss notre UI custom */
  onDismiss?: () => void;
}

export interface UsePwaInstallReturn {
  /** True si beforeinstallprompt a été capturé ET pas dismiss récent */
  canInstall: boolean;
  /** True si app tourne déjà en standalone (PWA installée) */
  isInstalled: boolean;
  /** Déclenche le prompt OS natif. Résout avec outcome */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Persiste dismiss timestamp, masque l'UI 7j */
  dismiss: () => void;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari
  // @ts-ignore — non-standard navigator.standalone
  if (window.navigator && (window.navigator as any).standalone === true) return true;
  return window.matchMedia('(display-mode: standalone)').matches;
}

function isDismissedRecently(): boolean {
  if (typeof localStorage === 'undefined') return false;
  // Legacy clé "1" Sprint 9 = considérer dismiss permanent → on respecte (clean
  // est explicite côté Settings si besoin).
  const legacy = localStorage.getItem('pwa_install_dismissed');
  if (legacy === '1') return true;
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const ts = parseInt(raw, 10);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < RE_PROMPT_AFTER_MS;
}

export function usePwaInstall(options: UsePwaInstallOptions = {}): UsePwaInstallReturn {
  const { onInstalled, onDismiss } = options;
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => isStandalone());
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const onInstalledRef = useRef(onInstalled);
  const onDismissRef = useRef(onDismiss);

  // Refresh refs pour pas re-bind les listeners à chaque render
  useEffect(() => {
    onInstalledRef.current = onInstalled;
    onDismissRef.current = onDismiss;
  }, [onInstalled, onDismiss]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone()) {
      setIsInstalled(true);
      return;
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      if (!isDismissedRecently()) {
        setCanInstall(true);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setCanInstall(false);
      deferredPromptRef.current = null;
      // Nettoyer le flag dismiss : si installée, plus rien à montrer
      try { localStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
      onInstalledRef.current?.();
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const prompt = deferredPromptRef.current;
    if (!prompt) return 'unavailable';
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      // L'event ne peut être appelé qu'une fois — clean
      deferredPromptRef.current = null;
      if (outcome === 'accepted') {
        setCanInstall(false);
      } else {
        // Refusé via OS dialog → respecte dismiss 7j
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
        setCanInstall(false);
      }
      return outcome;
    } catch {
      return 'unavailable';
    }
  }, []);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setCanInstall(false);
    onDismissRef.current?.();
  }, []);

  return { canInstall, isInstalled, promptInstall, dismiss };
}
