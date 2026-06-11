// ── visual-test-helpers.test.ts — Sprint 99 (seq194) ────────────────────────
// Tests pour les helpers de tests de régression visuelle.
// 10 cas : routes, URLs, snapshots, masquage, viewports.

import { describe, it, expect } from 'vitest';
import {
  VISUAL_TEST_ROUTES,
  VIEWPORT_SIZES,
  ALL_VIEWPORTS,
  buildTestUrl,
  buildSnapshotName,
  getThreshold,
  getMaskSelectors,
  countTotalCaptures,
} from '../lib/visual-test-helpers';

// ──────────────────────────────────────────────────────────────────────────
// VISUAL_TEST_ROUTES — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S99 — VISUAL_TEST_ROUTES', () => {
  it('1. Contient au moins 8 routes', () => {
    expect(VISUAL_TEST_ROUTES.length).toBeGreaterThanOrEqual(8);
  });

  it('2. Chaque route a key, path, requiresAuth, threshold', () => {
    for (const route of VISUAL_TEST_ROUTES) {
      expect(typeof route.key).toBe('string');
      expect(typeof route.path).toBe('string');
      expect(typeof route.requiresAuth).toBe('boolean');
      expect(typeof route.threshold).toBe('number');
      expect(route.threshold).toBeGreaterThan(0);
      expect(route.threshold).toBeLessThanOrEqual(0.05);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildTestUrl — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S99 — buildTestUrl', () => {
  it('3. URL avec mode visual_test activé', () => {
    const route = VISUAL_TEST_ROUTES[0]!;
    const url = buildTestUrl('http://localhost:5173', route);
    expect(url).toContain('__visual_test=true');
    expect(url).toContain(route.path);
  });

  it('4. Extra params injectés dans l\'URL', () => {
    const route = VISUAL_TEST_ROUTES[0]!;
    const url = buildTestUrl('http://localhost:5173', route, { theme: 'dark' });
    expect(url).toContain('theme=dark');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildSnapshotName — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S99 — buildSnapshotName', () => {
  it('5. Format correct : key-viewport-browser.png', () => {
    const name = buildSnapshotName('login', 'desktop', 'chromium');
    expect(name).toBe('login-desktop-chromium.png');
  });

  it('6. Browser par défaut = chromium', () => {
    const name = buildSnapshotName('dashboard', 'mobile');
    expect(name).toBe('dashboard-mobile-chromium.png');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// getThreshold — 1 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S99 — getThreshold', () => {
  it('7. Retourne le threshold de la route', () => {
    const loginRoute = VISUAL_TEST_ROUTES.find((r) => r.key === 'login')!;
    expect(getThreshold(loginRoute)).toBe(0.002);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// getMaskSelectors — 1 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S99 — getMaskSelectors', () => {
  it('8. Inclut les defaults + les selectors de la route', () => {
    const dashboardRoute = VISUAL_TEST_ROUTES.find((r) => r.key === 'dashboard')!;
    const selectors = getMaskSelectors(dashboardRoute);
    // Defaults
    expect(selectors).toContain('[data-testid="current-time"]');
    expect(selectors).toContain('.notification-badge-count');
    // Route-specific
    expect(selectors).toContain('.stats-number');
    expect(selectors).toContain('.chart-canvas');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// VIEWPORT_SIZES / countTotalCaptures — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S99 — viewports & captures', () => {
  it('9. 3 viewports standards : desktop, tablet, mobile', () => {
    expect(ALL_VIEWPORTS.length).toBe(3);
    expect(VIEWPORT_SIZES.desktop.width).toBe(1280);
    expect(VIEWPORT_SIZES.tablet.width).toBe(768);
    expect(VIEWPORT_SIZES.mobile.width).toBe(375);
  });

  it('10. Total captures ≥ 20 (8 routes × ~3 viewports)', () => {
    const total = countTotalCaptures();
    expect(total).toBeGreaterThanOrEqual(20);
  });
});
