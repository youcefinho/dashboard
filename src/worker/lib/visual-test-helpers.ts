// ── visual-test-helpers.ts — Sprint 99 (seq194) ─────────────────────────────
// Helpers pour les tests de régression visuelle end-to-end automatisés.
//
// Couvre :
//   - Registre des routes à capturer (VISUAL_TEST_ROUTES)
//   - Construction d'URLs de test avec données mock
//   - Viewports standardisés (desktop, tablet, mobile)
//   - Seuils de tolérance par type de page
//   - Helpers de snapshot naming
//
// ZÉRO I/O. Helpers purs — utilisés par Playwright dans `tests/e2e/`.

// ── Viewports standardisés ────────────────────────────────────────────────

export const VIEWPORT_SIZES = Object.freeze({
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
} as const);

export type ViewportName = keyof typeof VIEWPORT_SIZES;

export const ALL_VIEWPORTS: readonly ViewportName[] = ['desktop', 'tablet', 'mobile'];

// ── Routes à capturer ─────────────────────────────────────────────────────

export interface VisualTestRoute {
  /** Nom unique pour le snapshot. */
  key: string;
  /** Path relatif (ex: '/login'). */
  path: string;
  /** Nécessite authentification. */
  requiresAuth: boolean;
  /** Seuil de tolérance pour la comparaison (0.0 = exact, 1.0 = tout passe). */
  threshold: number;
  /** Viewports à tester (défaut: tous). */
  viewports?: ViewportName[];
  /** Temps d'attente supplémentaire après navigation (ms). */
  waitAfterNav?: number;
  /** Sélecteur CSS à masquer (contenu dynamique). */
  maskSelectors?: string[];
}

/** Registre des routes pour les tests de régression visuelle. */
export const VISUAL_TEST_ROUTES: readonly VisualTestRoute[] = Object.freeze([
  {
    key: 'login',
    path: '/login',
    requiresAuth: false,
    threshold: 0.002,
    waitAfterNav: 500,
  },
  {
    key: 'dashboard',
    path: '/',
    requiresAuth: true,
    threshold: 0.005,
    maskSelectors: ['.stats-number', '.chart-canvas', '[data-testid="date-display"]'],
    waitAfterNav: 1000,
  },
  {
    key: 'leads',
    path: '/leads',
    requiresAuth: true,
    threshold: 0.005,
    maskSelectors: ['.avatar-img', '[data-testid="lead-count"]'],
    waitAfterNav: 800,
  },
  {
    key: 'pipeline',
    path: '/pipeline',
    requiresAuth: true,
    threshold: 0.008,
    maskSelectors: ['.deal-value', '.stage-count'],
    waitAfterNav: 1000,
  },
  {
    key: 'tasks',
    path: '/tasks',
    requiresAuth: true,
    threshold: 0.005,
    maskSelectors: ['[data-testid="task-due-date"]'],
    waitAfterNav: 800,
  },
  {
    key: 'calendar',
    path: '/calendar',
    requiresAuth: true,
    threshold: 0.01,
    viewports: ['desktop', 'tablet'], // Mobile a un layout très différent
    maskSelectors: ['.fc-day-today', '.fc-col-header-cell-text'],
    waitAfterNav: 1200,
  },
  {
    key: 'inbox',
    path: '/inbox',
    requiresAuth: true,
    threshold: 0.005,
    maskSelectors: ['.message-timestamp', '.unread-badge'],
    waitAfterNav: 800,
  },
  {
    key: 'settings',
    path: '/settings',
    requiresAuth: true,
    threshold: 0.003,
    waitAfterNav: 600,
  },
] as const);

// ── Construction d'URL de test ────────────────────────────────────────────

/** Construit une URL complète pour un test visuel.
 *  @param baseUrl — URL de base (ex: 'http://localhost:5173')
 *  @param route — Route de test
 *  @param extraParams — Params supplémentaires (ex: mock mode) */
export function buildTestUrl(
  baseUrl: string,
  route: VisualTestRoute,
  extraParams?: Record<string, string>,
): string {
  const url = new URL(route.path, baseUrl);
  // Toujours ajouter le mode mock pour les tests visuels
  url.searchParams.set('__visual_test', 'true');
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

// ── Snapshot naming ───────────────────────────────────────────────────────

/** Construit le nom du fichier de snapshot pour un test visuel.
 *  Format : `{key}-{viewport}-{browser}.png` */
export function buildSnapshotName(
  key: string,
  viewport: ViewportName,
  browser: string = 'chromium',
): string {
  return `${key}-${viewport}-${browser}.png`;
}

// ── Seuils de tolérance ───────────────────────────────────────────────────

/** Retourne le seuil de tolérance pour une route donnée.
 *  Fallback à 0.005 (0.5%) si non spécifié. */
export function getThreshold(route: VisualTestRoute): number {
  return route.threshold ?? 0.005;
}

// ── Helpers de masquage ───────────────────────────────────────────────────

/** Retourne les sélecteurs CSS à masquer pour une route (contenu dynamique
 *  qui change entre les captures : dates, compteurs, avatars, etc.). */
export function getMaskSelectors(route: VisualTestRoute): string[] {
  const defaults = [
    '[data-testid="current-time"]',
    '.notification-badge-count',
  ];
  return [...defaults, ...(route.maskSelectors ?? [])];
}

// ── Résumé du plan de test ────────────────────────────────────────────────

/** Calcule le nombre total de captures à effectuer. */
export function countTotalCaptures(): number {
  let total = 0;
  for (const route of VISUAL_TEST_ROUTES) {
    const viewports = route.viewports ?? ALL_VIEWPORTS;
    total += viewports.length;
  }
  return total;
}
