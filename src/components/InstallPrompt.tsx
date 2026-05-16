// ── InstallPrompt — Banner PWA "Installer Intralys CRM" (Sprint 9) ──
// Écoute beforeinstallprompt, affiche un banner en bas, gère dismiss + localStorage

import { useState, useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Button, Icon } from '@/components/ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [showBanner, setShowBanner] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem('pwa_install_dismissed') === '1') return;

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    const prompt = deferredPromptRef.current;
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setShowBanner(false);
    deferredPromptRef.current = null;
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('pwa_install_dismissed', '1');
  };

  if (!showBanner) return null;

  return (
    <div
      className="fixed bottom-[70px] left-3 right-3 z-[60] flex items-center gap-3 px-4 py-3 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] animate-in slide-in-from-bottom-2 fade-in-0 duration-300 overflow-hidden"
      style={{
        boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 16px 40px -8px rgba(0,157,219,0.22)',
      }}
    >
      {/* Bandeau gradient brand top */}
      <span
        aria-hidden
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: 'linear-gradient(90deg, rgba(0,157,219,0.95) 0%, rgba(217,110,39,0.95) 100%)',
          boxShadow: '0 0 14px -2px rgba(0,157,219,0.50)',
        }}
      />
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0"
        style={{
          background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
          boxShadow: '0 4px 12px rgba(0,157,219,0.40)',
        }}
      >
        I
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-[var(--text-primary)] m-0">
          Installer Intralys CRM
        </p>
        <p className="text-[11px] text-[var(--text-muted)] m-0">
          Accès rapide depuis l'écran d'accueil
        </p>
      </div>
      <Button
        variant="primary"
        size="sm"
        onClick={() => void handleInstall()}
        leftIcon={<Icon as={Download} size={14} />}
        className="shrink-0"
      >
        Installer
      </Button>
      <button
        type="button"
        onClick={handleDismiss}
        className="chip-btn chip-btn--sm shrink-0 !w-8 !h-8 !p-0 flex items-center justify-center"
        aria-label="Fermer"
      >
        <Icon as={X} size={14} />
      </button>
    </div>
  );
}
