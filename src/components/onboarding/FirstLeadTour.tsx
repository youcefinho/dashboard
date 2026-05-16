// ── FirstLeadTour — Sprint 45 M1.3 (2026-05-15) ──────────────────────────────
// Tour guidé pour la première création d'un lead, basé sur la primitive
// <Coachmark> (Sprint 24 vague 5B) et l'orchestration de <InteractiveTour>.
//
// 3 steps :
//   1. Bouton "Nouveau" (header) → "Commençons par créer ton premier lead"
//   2. Form fields name/email → "Remplis le nom et l'email minimum"
//   3. Save button → "Sauvegarde et regarde la magie opérer"
//
// Trigger (géré par le parent — typiquement AppLayout ou route Leads) :
//   `localStorage.getItem('first_lead_tour_shown') !== '1'` ET 0 leads dans la DB.
//
// Skip CTA + "Plus tard" CTA = simplement onClose (le parent gère la mémoire
// — on persiste `first_lead_tour_shown` dès la première fermeture).

import { useEffect, useMemo, useState } from 'react';
import { Coachmark, type CoachmarkStep } from '@/components/ui/Coachmark';

const TOUR_SHOWN_KEY = 'first_lead_tour_shown';
const TOUR_LATER_KEY = 'first_lead_tour_later';

interface FirstLeadTourProps {
  /** Force l'ouverture (bypass localStorage skip) */
  open: boolean;
  /** Appelé quand le tour se ferme (skip / Plus tard / Done) */
  onClose: () => void;
}

export function FirstLeadTour({ open, onClose }: FirstLeadTourProps) {
  const [internalOpen, setInternalOpen] = useState(open);

  useEffect(() => {
    setInternalOpen(open);
  }, [open]);

  // 3 steps : ciblent les data-tour-id existants + ceux ajoutés ici.
  // Si le target n'existe pas, Coachmark skip silencieusement (cf. Sprint 24).
  const steps: CoachmarkStep[] = useMemo(
    () => [
      {
        // Sprint 45 — le bouton "+ Nouveau" du header expose data-tour-id="header-new-lead"
        // (à ajouter dans AppLayout ou Sidebar). Fallback : selector générique.
        targetSelector: '[data-tour-id="header-new-lead"], [data-tour-id="quick-add-fab"]',
        title: 'Crée ton premier lead',
        description:
          "Commençons par créer ton premier lead. Clique sur ce bouton « + Nouveau » — c'est ton point de départ pour tout capturer dans Intralys.",
        position: 'bottom',
      },
      {
        // Le SlidePanel/Form lead expose data-tour-id="lead-form-fields" sur le wrapper input name+email.
        targetSelector: '[data-tour-id="lead-form-fields"], input[name="name"], #lead-name',
        title: 'Remplis le minimum',
        description:
          "Nom et courriel suffisent — tu pourras enrichir le profil plus tard. Intralys ajoutera automatiquement le score IA et la source.",
        position: 'right',
      },
      {
        // Bouton submit du form — data-tour-id="lead-form-save" ou fallback button[type=submit].
        targetSelector: '[data-tour-id="lead-form-save"], button[type="submit"]',
        title: 'Et c\'est parti',
        description:
          'Sauvegarde et regarde la magie opérer. Ton lead apparaît dans Leads + Pipeline, le scoring se calcule, et tu peux déjà lancer une première relance.',
        position: 'top',
      },
    ],
    [],
  );

  // ── Close handlers ──────────────────────────────────────────────────────────
  const persistShown = () => {
    try { localStorage.setItem(TOUR_SHOWN_KEY, '1'); } catch { /* ignore */ }
  };

  const persistLater = () => {
    try {
      localStorage.setItem(TOUR_LATER_KEY, new Date().toISOString());
      // On NE persiste PAS shown=1 ici → le tour réapparaîtra à la prochaine session
      // si l'user n'a toujours pas créé de lead.
    } catch { /* ignore */ }
  };

  const handleSkip = () => {
    // "Skip" via X / Esc = on persiste pour ne pas re-spammer.
    persistShown();
    setInternalOpen(false);
    onClose();
  };

  const handleComplete = () => {
    persistShown();
    setInternalOpen(false);
    onClose();
  };

  // Bouton "Plus tard" exposé via window event (Coachmark n'a pas de slot custom
  // dans le footer). On le déclenche depuis un bouton flottant accolé au tooltip.
  useEffect(() => {
    if (!internalOpen) return;
    const handler = (e: KeyboardEvent) => {
      // L pour "Plus tard"
      if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        persistLater();
        setInternalOpen(false);
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [internalOpen, onClose]);

  if (!internalOpen) return null;

  return (
    <>
      <Coachmark
        steps={steps}
        open={internalOpen}
        onClose={handleSkip}
        onComplete={handleComplete}
      />
      {/* CTA "Plus tard" flottant — Stripe-sober, en haut-droite du viewport. */}
      <button
        type="button"
        onClick={() => {
          persistLater();
          setInternalOpen(false);
          onClose();
        }}
        className="first-lead-tour-later-btn"
        aria-label="Reporter ce tour à plus tard"
        title="Reporter à plus tard (L)"
      >
        Plus tard
      </button>
    </>
  );
}

// ── Helpers d'orchestration (utilisés par AppLayout) ─────────────────────────

/**
 * Détermine si le tour doit s'ouvrir : pas encore complété ET 0 leads.
 * À appeler côté parent qui dispose de la liste leads + flag local.
 */
export function shouldShowFirstLeadTour(leadsCount: number): boolean {
  try {
    if (localStorage.getItem(TOUR_SHOWN_KEY) === '1') return false;
    const later = localStorage.getItem(TOUR_LATER_KEY);
    if (later) {
      // Si l'user a cliqué "Plus tard" dans les 24h, on attend.
      const lastTs = Date.parse(later);
      if (!Number.isNaN(lastTs) && Date.now() - lastTs < 24 * 60 * 60 * 1000) {
        return false;
      }
    }
  } catch { /* ignore */ }
  return leadsCount === 0;
}
