// ── InstallPrompt — Banner PWA "Installer Intralys CRM" (Sprint 9) ──
// Écoute beforeinstallprompt, affiche un banner en bas, gère dismiss + localStorage

import { useState, useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [showBanner, setShowBanner] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Déjà installé en standalone ?
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    // Déjà dismissé ?
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
    <div className="install-prompt-banner" style={{
      position: 'fixed',
      bottom: 70,
      left: 12,
      right: 12,
      zIndex: 60,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 16px',
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: '0 8px 24px oklch(0 0 0 / 0.12)',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 'var(--radius-md)',
        background: 'linear-gradient(135deg, #009DDB 0%, #188BF6 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'white', fontWeight: 700, fontSize: 18, flexShrink: 0,
      }}>I</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Installer Intralys CRM
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Accès rapide depuis l'écran d'accueil
        </p>
      </div>
      <button
        onClick={() => void handleInstall()}
        style={{
          padding: '8px 14px', borderRadius: 'var(--radius-md)',
          background: 'var(--brand-primary)', color: 'white',
          border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
        }}
      >
        <Download size={14} /> Installer
      </button>
      <button
        onClick={handleDismiss}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', padding: 4, flexShrink: 0,
        }}
        aria-label="Fermer"
      >
        <X size={16} />
      </button>
    </div>
  );
}
