// ── DiscoverAppTour — 8-step guided tour Sprint 45 M3.4 (2026-05-15) ──────
// Tour interactif déclenché depuis la CmdPalette via l'intent "discover_app"
// ("découvrir l'app" / "tour guidé" / "comment ça marche"). Navigue entre 8
// pages clés pour faire découvrir l'app à un user nouveau.
//
// Steps :
//   1. Sidebar nav            (Dashboard)
//   2. KPI hero               (Dashboard)
//   3. Lead create btn        (/leads)
//   4. Pipeline first card    (/pipeline)
//   5. Tasks bulk select      (/tasks)
//   6. Inbox composer         (/inbox)
//   7. Calendar today         (/calendar)
//   8. Cmd+K hint             (n'importe quelle page — header)
//
// Navigation entre pages : useNavigate + setTimeout(800ms) pour laisser le
// time au DOM de monter avant que le Coachmark cherche son target.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Coachmark, type CoachmarkStep } from '@/components/ui/Coachmark';

interface DiscoverAppTourProps {
  open: boolean;
  onClose: () => void;
}

interface NavStep extends CoachmarkStep {
  /** Route à laquelle naviguer avant d'afficher cette étape (skip si déjà dessus). */
  navigateTo?: string;
}

const STEPS: NavStep[] = [
  {
    navigateTo: '/dashboard',
    targetSelector: '[data-tour-id="sidebar-nav"]',
    title: '1 · Navigation principale',
    description:
      "La barre latérale regroupe tes modules clés : Leads, Pipeline, Conversations, Tâches, Rapports. Tu peux naviguer à la souris ou au clavier (↑↓).",
    position: 'right',
  },
  {
    navigateTo: '/dashboard',
    targetSelector: 'h1, .t-h1, .t-display',
    title: '2 · Vue d\'ensemble de tes performances',
    description:
      "Le dashboard te montre tes KPIs principaux : leads ce mois, conversion, valeur pipeline, sources actives. Tout en un coup d'œil.",
    position: 'bottom',
  },
  {
    navigateTo: '/leads',
    targetSelector: 'button[aria-label*="Nouveau"], button[aria-label*="Créer un lead"], [data-tour-id="leads-new"]',
    title: '3 · Créer un nouveau lead',
    description:
      "Depuis la page Leads, ajoute manuellement un prospect. Tu peux aussi les importer en masse (CSV) ou les recevoir automatiquement via formulaire web.",
    position: 'bottom',
  },
  {
    navigateTo: '/pipeline',
    targetSelector: '.pipeline-card',
    title: '4 · Pipeline glisser-déposer',
    description:
      "Glisse les cartes entre les colonnes pour faire avancer tes leads dans le pipeline. Confettis automatiques quand un deal est gagné.",
    position: 'right',
  },
  {
    navigateTo: '/tasks',
    targetSelector: '[data-coachmark="tasks-list"] input[type="checkbox"], .task-card input[type="checkbox"]',
    title: '5 · Tâches & sélection multiple',
    description:
      "Coche plusieurs tâches via Ctrl+clic (ou Shift+clic pour une plage). La barre d'actions groupées te permet de tout marquer fait / supprimer / réassigner en 1 clic.",
    position: 'right',
  },
  {
    navigateTo: '/inbox',
    targetSelector: '.composer-wrap textarea, .composer textarea',
    title: '6 · Conversations unifiées',
    description:
      "Tous tes canaux (email, SMS, WhatsApp, web) dans un seul inbox. Tape « / » dans le composer pour insérer des variables (nom client, prix, etc.) en 1 seconde.",
    position: 'top',
  },
  {
    navigateTo: '/calendar',
    targetSelector: '.calendar-today-line, [data-today="true"], .calendar-day--today',
    title: '7 · Calendrier des rendez-vous',
    description:
      "Vue jour / semaine / mois de tes RDV. Glisse pour déplacer un événement, redimensionne pour changer sa durée (snap 15 min).",
    position: 'bottom',
  },
  {
    targetSelector: '[data-tour-id="header-search"]',
    title: '8 · Palette de commandes (⌘K)',
    description:
      "La commande la plus rapide : appuie sur ⌘K (Mac) ou Ctrl+K (Windows) n'importe où. Tu peux y créer un lead, naviguer, filtrer, déclencher des actions — tout en langage naturel.",
    position: 'bottom',
  },
];

export function DiscoverAppTour({ open, onClose }: DiscoverAppTourProps) {
  const navigate = useNavigate();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [ready, setReady] = useState(false);

  // À chaque step : si navigateTo défini → navigue puis attend 700ms pour DOM
  useEffect(() => {
    if (!open) return;
    const step = STEPS[currentIdx];
    if (!step) return;
    setReady(false);
    let timer: number;
    if (step.navigateTo && typeof window !== 'undefined' && window.location.pathname !== step.navigateTo) {
      void navigate({ to: step.navigateTo });
      timer = window.setTimeout(() => setReady(true), 700);
    } else {
      timer = window.setTimeout(() => setReady(true), 200);
    }
    return () => window.clearTimeout(timer);
  }, [open, currentIdx, navigate]);

  // Reset au ouverture
  useEffect(() => {
    if (open) {
      setCurrentIdx(0);
      setReady(false);
    }
  }, [open]);

  // Custom onComplete : mark "discover_app_completed"
  const handleComplete = () => {
    try {
      localStorage.setItem('intralys_discover_app_completed', '1');
    } catch {
      /* ignore */
    }
    onClose();
  };

  // Sub-step proxy : on passe à la primitive Coachmark TOUTES les steps mais
  // avec un trick de re-keying — la primitive fait sa propre nav interne, mais
  // ici on contrôle l'index externe pour permettre la navigation entre pages
  // (chaque step peut nécessiter un navigate). Le pattern : 1 seul step proxy
  // mais avec une description "Étape N / 8" intégrée pour le contexte global.
  const proxySteps = useMemo<CoachmarkStep[]>(() => {
    const step = STEPS[currentIdx];
    if (!step) return [];
    const total = STEPS.length;
    const isLast = currentIdx === total - 1;
    return [
      {
        targetSelector: step.targetSelector,
        targetRef: step.targetRef,
        title: step.title,
        description: isLast
          ? step.description
          : `${step.description}\n\n(Étape ${currentIdx + 1} sur ${total} — clique « Suivant » pour continuer.)`,
        position: step.position,
        action: step.action,
      },
    ];
  }, [currentIdx]);

  if (!open || !ready) return null;

  const isLastStep = currentIdx === STEPS.length - 1;

  // Sprint 45 M3.4 — Avance : si pas dernière step → next index ; sinon → complete
  const advance = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentIdx((i) => Math.min(STEPS.length - 1, i + 1));
    }
  };

  return (
    <Coachmark
      steps={proxySteps}
      open={ready}
      onClose={onClose}
      onComplete={advance}
    />
  );
}
