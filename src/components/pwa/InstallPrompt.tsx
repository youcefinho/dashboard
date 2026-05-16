// ── InstallPrompt — Sprint 44 M2.1 (Stripe-clean modal) ─────────────────────
// Refonte du banner Sprint 9 → modal complet :
//   - Preview features app (3 bullets compactes)
//   - CTA primary "Installer" → usePwaInstall.promptInstall()
//   - Dismiss persiste 7j (cf. usePwaInstall hook)
//   - Auto-show 8s après mount si canInstall && pas déjà installée
//   - Toast success déclenché par hook (appinstalled event)
//
// Préservations :
//   - API publique inchangée : <InstallPrompt /> sans props
//   - Pas de gradient/orbs/glow massif (paradigm Stripe SUBTLE Sprint 38 RESET)
//   - A11y : Modal Radix Dialog (focus trap + Escape + aria-label)

import { useEffect, useState } from 'react';
import { Download, Sparkles, Zap, WifiOff, X } from 'lucide-react';
import { Button, Icon, Modal } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { usePwaInstall } from '@/hooks/usePwaInstall';

const AUTO_SHOW_DELAY_MS = 8000;

interface Feature {
  icon: typeof Sparkles;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: Zap,
    title: 'Démarrage instantané',
    description: 'Lancement sub-seconde depuis l\'écran d\'accueil, comme une app native.',
  },
  {
    icon: WifiOff,
    title: 'Fonctionne hors ligne',
    description: 'Consultez leads, tâches et inbox même sans connexion.',
  },
  {
    icon: Sparkles,
    title: 'Notifications push',
    description: 'Soyez alerté des nouveaux leads et messages directement.',
  },
];

export function InstallPrompt() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { canInstall, isInstalled, promptInstall, dismiss } = usePwaInstall({
    onInstalled: () => {
      setOpen(false);
      toast.success('Application installée !', {
        title: 'Intralys CRM',
        celebrate: true,
      });
    },
  });

  // Auto-show la modal après un délai si éligible — évite de spammer au boot.
  // L'user a 8s pour explorer avant qu'on propose l'install (UX patience).
  useEffect(() => {
    if (!canInstall || isInstalled || open) return;
    const t = window.setTimeout(() => {
      setOpen(true);
    }, AUTO_SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [canInstall, isInstalled, open]);

  // Si plus éligible (installée OU dismissed) → ferme la modal proprement
  useEffect(() => {
    if (!canInstall && open) {
      setOpen(false);
    }
  }, [canInstall, open]);

  const handleInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === 'unavailable') {
      toast.info('Installation indisponible', {
        message: 'Votre navigateur ne supporte pas l\'installation PWA.',
      });
    }
    // 'accepted' / 'dismissed' → géré par les events natifs (appinstalled)
    setOpen(false);
  };

  const handleDismiss = () => {
    setOpen(false);
    dismiss();
  };

  if (!canInstall || isInstalled) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) handleDismiss();
        else setOpen(o);
      }}
      title="Installer Intralys CRM"
      description="Accédez à votre CRM directement depuis l'écran d'accueil."
      size="sm"
    >
      <div className="pwa-install-modal">
        {/* Logo + tagline */}
        <div className="pwa-install-modal__hero">
          <div className="pwa-install-modal__logo" aria-hidden>
            <span>I</span>
          </div>
          <div className="pwa-install-modal__hero-text">
            <p className="pwa-install-modal__hero-title">Intralys CRM</p>
            <p className="pwa-install-modal__hero-sub">CRM pour PMEs francophones · QC</p>
          </div>
        </div>

        {/* Features list */}
        <ul className="pwa-install-modal__features" role="list">
          {FEATURES.map((f) => (
            <li key={f.title} className="pwa-install-modal__feature">
              <span className="pwa-install-modal__feature-icon" aria-hidden>
                <Icon as={f.icon} size={14} strokeWidth={2} />
              </span>
              <div className="pwa-install-modal__feature-text">
                <p className="pwa-install-modal__feature-title">{f.title}</p>
                <p className="pwa-install-modal__feature-desc">{f.description}</p>
              </div>
            </li>
          ))}
        </ul>

        {/* CTAs */}
        <div className="pwa-install-modal__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            leftIcon={<Icon as={X} size={14} />}
            aria-label="Plus tard, ne pas installer maintenant"
          >
            Plus tard
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleInstall()}
            leftIcon={<Icon as={Download} size={14} />}
          >
            Installer
          </Button>
        </div>

        <p className="pwa-install-modal__footnote">
          Vous pourrez désinstaller à tout moment depuis les paramètres de votre navigateur.
        </p>
      </div>
    </Modal>
  );
}
