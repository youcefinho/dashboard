// ── InteractiveTour — Tour guidé post-onboarding (Sprint 24 vague 5B) ─────
// Compose 5 étapes via la primitive <Coachmark>. Cible des data-tour-id ajoutés
// dans Sidebar / AppLayout / QuickAddFab. Persistance localStorage pour skip
// les ré-affichages futurs.
// ── Sprint 47 M3.4 — Étape additionnelle "Pour aller plus loin" cross-link
//    vers le centre d'aide /help/getting-started. ──

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Coachmark, type CoachmarkStep } from '@/components/ui/Coachmark';
import { Icon } from '@/components/ui/Icon';
import { BookOpen, ArrowRight } from 'lucide-react';

const TOUR_COMPLETED_KEY = 'intralys_tour_completed';

interface InteractiveTourProps {
  /** Force l'ouverture (bypass localStorage skip) */
  open?: boolean;
  /** Appelé quand le tour se ferme (skip ou complete) */
  onClose?: () => void;
}

export function InteractiveTour({ open: openProp, onClose }: InteractiveTourProps) {
  // Auto-open si pas encore complété ET pas explicitement piloté
  const [open, setOpen] = useState<boolean>(() => {
    if (openProp !== undefined) return openProp;
    try {
      return localStorage.getItem(TOUR_COMPLETED_KEY) !== '1';
    } catch {
      return true;
    }
  });

  // Sync avec prop si pilotée extérieurement
  useEffect(() => {
    if (openProp !== undefined) setOpen(openProp);
  }, [openProp]);

  const steps: CoachmarkStep[] = useMemo(
    () => [
      {
        targetSelector: '[data-tour-id="sidebar-nav"]',
        title: 'Navigation principale',
        description:
          "La barre latérale regroupe vos modules clés : Leads, Pipeline, Conversations, Tâches, Rapports. Survolez chaque icône pour découvrir, ou utilisez les flèches ↑↓ pour naviguer au clavier.",
        position: 'right',
      },
      {
        targetSelector: '[data-tour-id="header-search"]',
        title: 'Recherche globale (⌘K)',
        description:
          "Trouvez n'importe quel lead, tâche, conversation ou page en quelques touches. Ouvrez aussi cette palette via ⌘K depuis n'importe où dans l'app.",
        position: 'bottom',
      },
      {
        targetSelector: '[data-tour-id="quick-add-fab"]',
        title: 'Création rapide',
        description:
          'Ce bouton flottant vous permet d\'ajouter un lead, RDV, tâche ou note en deux clics, peu importe la page où vous êtes. Le différenciateur power-user.',
        position: 'left',
      },
      {
        targetSelector: '[data-tour-id="header-notifs"]',
        title: 'Notifications & activité',
        description:
          'Suivez les nouveaux leads, messages, tâches en retard et mentions d\'équipe en temps réel. Les notifications sont groupées par jour pour rester lisibles.',
        position: 'bottom',
      },
      {
        targetSelector: '[data-tour-id="header-density"]',
        title: 'Densité d\'affichage',
        description:
          'Adaptez la densité de l\'interface (compacte, confortable, spacieuse) selon votre écran et vos préférences. Cliquez pour cycler entre les modes.',
        position: 'bottom',
      },
      // ── Sprint 47 M3.4 — Cross-link vers le centre d'aide ─────
      // Dernière étape "Pour aller plus loin" : envoie l'user vers la doc
      // pour qu'il puisse approfondir après le tour rapide. Cible le logo
      // sidebar comme ancrage neutre (toujours visible, pas de risque de
      // tour bloqué si l'élément n'existe pas).
      {
        targetSelector: '[data-tour-id="sidebar-nav"]',
        title: 'Pour aller plus loin',
        description:
          "Tu connais maintenant les bases ! Pour approfondir, consulte notre centre d'aide — guides détaillés, tutos, doc API. Tout est en français québécois.",
        position: 'right',
        action: (
          <Link
            to="/help/$slug"
            params={{ slug: 'getting-started' }}
            className="inline-flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium rounded-md text-[var(--primary)] hover:underline transition-colors"
            style={{
              background: 'var(--primary-soft)',
              border: '1px solid var(--primary-ring, rgba(99,91,255,0.20))',
            }}
            onClick={() => {
              try { localStorage.setItem(TOUR_COMPLETED_KEY, '1'); } catch { /* ignore */ }
            }}
          >
            <Icon as={BookOpen} size={11} aria-hidden />
            Consulter le centre d'aide
            <Icon as={ArrowRight} size={11} aria-hidden />
          </Link>
        ),
      },
    ],
    [],
  );

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  const handleComplete = () => {
    try {
      localStorage.setItem(TOUR_COMPLETED_KEY, '1');
    } catch { /* ignore */ }
    setOpen(false);
    onClose?.();
  };

  // Quand l'utilisateur skip via ESC / X, on persiste aussi (sinon ré-apparition)
  const handleSkip = () => {
    try {
      localStorage.setItem(TOUR_COMPLETED_KEY, '1');
    } catch { /* ignore */ }
    handleClose();
  };

  return (
    <Coachmark
      steps={steps}
      open={open}
      onClose={handleSkip}
      onComplete={handleComplete}
    />
  );
}
