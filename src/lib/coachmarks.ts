// ── Coachmarks registry — Sprint 45 M3.2 (2026-05-15) ─────────────────────
// Wire 5 coachmarks contextuels (1 par page concernée) déclenchés au mount
// après un delay 1.5s, persistés via localStorage (1 flag par coachmark +
// 1 compteur visites par page). ESC ou X = mark shown.
//
// API publique :
//   getCoachmarkRegistry() → registry typé
//   shouldShowCoachmark(id, visits) → bool
//   markCoachmarkShown(id) → void
//   incrementPageVisits(pageName) → number (new count)
//   resetAllCoachmarks() → void  (Settings : "Réafficher les guides")
//
// Stripe paradigm : SUBTLE. Coachmark primitive refondue Sprint 45 M3.1.

import type { CoachmarkStep } from '@/components/ui/Coachmark';

// ── Types ────────────────────────────────────────────────────────────────

export type CoachmarkId =
  | 'pipeline_drag_drop'
  | 'inbox_slash_vars'
  | 'tasks_bulk_select'
  | 'reports_filter'
  | 'dashboard_cmdk';

export type PageName =
  | 'pipeline'
  | 'inbox'
  | 'tasks'
  | 'reports'
  | 'dashboard';

export interface CoachmarkRegistryEntry {
  id: CoachmarkId;
  page: PageName;
  /** Minimum nombre de visites avant déclenchement (1 = première visite, 2 = deuxième, etc.) */
  minVisits: number;
  /** Délai avant affichage (ms) */
  delayMs: number;
  step: CoachmarkStep;
}

// ── Storage keys ─────────────────────────────────────────────────────────

const SHOWN_KEY_PREFIX = 'coachmark_';
const VISITS_KEY_PREFIX = 'page_';
const SHOWN_SUFFIX = '_shown';
const VISITS_SUFFIX = '_visits';

function shownKey(id: CoachmarkId): string {
  return `${SHOWN_KEY_PREFIX}${id}${SHOWN_SUFFIX}`;
}

function visitsKey(page: PageName): string {
  return `${VISITS_KEY_PREFIX}${page}${VISITS_SUFFIX}`;
}

// ── Registry ─────────────────────────────────────────────────────────────

const REGISTRY: CoachmarkRegistryEntry[] = [
  {
    id: 'pipeline_drag_drop',
    page: 'pipeline',
    minVisits: 1,
    delayMs: 1500,
    step: {
      targetSelector: '.pipeline-card',
      title: 'Glisser-déposer entre étapes',
      description:
        "Glisse cette carte vers une autre colonne pour faire avancer le lead. Tu peux aussi ajuster la hauteur des cartes via la poignée du bas.",
      position: 'right',
    },
  },
  {
    id: 'inbox_slash_vars',
    page: 'inbox',
    minVisits: 1,
    delayMs: 1500,
    step: {
      targetSelector: '.composer-wrap textarea',
      title: 'Insérer des variables avec /',
      description:
        "Tape « / » dans le composer pour insérer des variables : nom du client, courriel, prix du dossier, etc. Pratique pour personnaliser sans copier-coller.",
      position: 'top',
    },
  },
  {
    id: 'tasks_bulk_select',
    page: 'tasks',
    minVisits: 2,
    delayMs: 1500,
    step: {
      targetSelector: '[data-coachmark="tasks-list"] input[type="checkbox"]',
      title: 'Sélection multiple rapide',
      description:
        "Ctrl+clic (ou Shift+clic pour une plage) pour sélectionner plusieurs tâches. La barre d'actions groupées apparaît automatiquement en bas.",
      position: 'right',
    },
  },
  {
    id: 'reports_filter',
    page: 'reports',
    minVisits: 1,
    delayMs: 1500,
    step: {
      targetSelector: '[data-coachmark="reports-period"]',
      title: 'Filtrer par période',
      description:
        "Change la fenêtre d'analyse (30 jours, 90 jours, 12 mois) ou active « Comparer » pour mettre en relation deux périodes côte-à-côte.",
      position: 'bottom',
    },
  },
  {
    id: 'dashboard_cmdk',
    page: 'dashboard',
    minVisits: 3,
    delayMs: 1500,
    step: {
      targetSelector: '[data-tour-id="header-search"]',
      title: 'Palette de commandes (⌘K)',
      description:
        "Appuie sur ⌘K (Mac) ou Ctrl+K (Windows) n'importe où dans l'app pour ouvrir la palette : recherche, navigation, création de leads, filtres. Plus rapide que les menus.",
      position: 'bottom',
    },
  },
];

// ── Public API ───────────────────────────────────────────────────────────

export function getCoachmarkRegistry(): CoachmarkRegistryEntry[] {
  return REGISTRY;
}

export function getCoachmarkForPage(page: PageName): CoachmarkRegistryEntry | undefined {
  return REGISTRY.find((e) => e.page === page);
}

export function isCoachmarkShown(id: CoachmarkId): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(shownKey(id)) === '1';
  } catch {
    return true;
  }
}

export function markCoachmarkShown(id: CoachmarkId): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(shownKey(id), '1');
  } catch {
    /* ignore */
  }
}

export function getPageVisits(page: PageName): number {
  if (typeof window === 'undefined') return 0;
  try {
    const v = localStorage.getItem(visitsKey(page));
    return v ? Math.max(0, parseInt(v, 10) || 0) : 0;
  } catch {
    return 0;
  }
}

export function incrementPageVisits(page: PageName): number {
  if (typeof window === 'undefined') return 0;
  const current = getPageVisits(page);
  const next = current + 1;
  try {
    localStorage.setItem(visitsKey(page), String(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** Vérifie si le coachmark doit s'afficher pour la page donnée (compte visites + flag shown). */
export function shouldShowCoachmark(page: PageName): CoachmarkRegistryEntry | null {
  const entry = getCoachmarkForPage(page);
  if (!entry) return null;
  if (isCoachmarkShown(entry.id)) return null;
  const visits = getPageVisits(page);
  if (visits < entry.minVisits) return null;
  return entry;
}

/** Reset tous les flags (Settings : "Réafficher les guides interactifs"). */
export function resetAllCoachmarks(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const entry of REGISTRY) {
      localStorage.removeItem(shownKey(entry.id));
      localStorage.removeItem(visitsKey(entry.page));
    }
    // Reset aussi le tour interactif principal (Sprint 24)
    localStorage.removeItem('intralys_tour_completed');
  } catch {
    /* ignore */
  }
}
