// ── Sprint 50 M1.2 — Visual regression complète (20 snapshots) ──
// Étend les 5 snapshots historiques (snapshots.spec.ts) avec la couverture
// release-candidate : pages cœur + secondaires + marketing + overlays + mobile.
//
// ⚠️ Pas de run dans ce sprint (VMware, pas de bun). Setup + scripts prêts.
//   Baseline : `npm run test:visual:update` (ou
//   `npx playwright test full-regression --update-snapshots`).
//
// Auth + mocks API : même pattern que snapshots.spec.ts (addInitScript +
// route interception) pour des snapshots déterministes hors backend.

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Réponses mock par défaut (aligné snapshots.spec.ts + entités RC)
const API_MOCKS: Record<string, unknown> = {
  '/api/dashboard/stats': { data: { total_leads: 42, total_clients: 5, new_leads_today: 3, conversion_rate: 12.5, total_revenue: 125000, leads_by_status: {}, leads_by_source: {}, leads_by_month: [] } },
  '/api/leads': { data: [], meta: { total: 0 } },
  '/api/clients': { data: [] },
  '/api/notifications': { data: [] },
  '/api/pipelines': { data: [{ id: 'p1', name: 'Principal', is_default: true, stages: [{ id: 's1', name: 'Nouveau', color: '#3b82f6', position: 0, probability: 10 }, { id: 's2', name: 'Qualifié', color: '#22c55e', position: 1, probability: 50 }, { id: 's3', name: 'Proposition', color: '#f59e0b', position: 2, probability: 75 }] }] },
  '/api/conversations': { data: [], meta: { counts: [] } },
  '/api/tasks': { data: [] },
  '/api/settings': { data: {} },
  '/api/users': { data: [] },
  '/api/agencies': { data: [] },
  '/api/custom-fields': { data: [] },
  '/api/smart-lists': { data: [] },
  '/api/snippets': { data: [] },
  '/api/templates': { data: [] },
  '/api/lead-tags': { data: [] },
  '/api/reports': { data: [] },
  '/api/admin': { data: { stats: {} } },
  '/api/calendar': { data: [] },
};

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('intralys_token', 'dev-bypass-token');
    localStorage.setItem('intralys_user', JSON.stringify({
      id: 'admin',
      name: 'Rochdi (Dev)',
      role: 'admin',
      email: 'test@intralys.com',
      onboarding_step: 0,
      onboarding_skipped: true,
    }));
  });

  await page.route(/\/api\//, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown = { data: null };
    for (const [key, value] of Object.entries(API_MOCKS)) {
      if (pathname.startsWith(key)) { body = value; break; }
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function freezeAnimations(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        transition-duration: 0s !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
      }
      .animate-shimmer, .animate-pulse, .animate-spin { animation: none !important; }
    `,
  });
}

async function snap(page: Page, path: string, name: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await freezeAnimations(page);
  await page.waitForTimeout(2000);
  await expect(page).toHaveScreenshot(name, { fullPage: true });
}

// ── 1. Pages cœur (app) ──────────────────────────────────
test.describe('RC visual — Pages cœur', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('Dashboard', async ({ page }) => { await snap(page, '/dashboard', 'rc-dashboard.png'); });
  test('Leads', async ({ page }) => { await snap(page, '/leads', 'rc-leads.png'); });
  test('LeadDetail', async ({ page }) => { await snap(page, '/leads/demo-1', 'rc-lead-detail.png'); });
  test('Pipeline', async ({ page }) => { await snap(page, '/pipeline', 'rc-pipeline.png'); });
  test('Tasks', async ({ page }) => { await snap(page, '/tasks', 'rc-tasks.png'); });
  test('Inbox (conversations)', async ({ page }) => { await snap(page, '/conversations', 'rc-inbox.png'); });
  test('Calendar', async ({ page }) => { await snap(page, '/calendar', 'rc-calendar.png'); });
  test('Reports', async ({ page }) => { await snap(page, '/reports', 'rc-reports.png'); });
  test('Settings', async ({ page }) => { await snap(page, '/settings', 'rc-settings.png'); });
  test('Admin Overview', async ({ page }) => { await snap(page, '/admin/overview', 'rc-admin-overview.png'); });
});

// ── 2. Auth + marketing ──────────────────────────────────
test.describe('RC visual — Auth & marketing', () => {
  // Pas de setup auth ici (login + landing publics)
  test.beforeEach(async ({ page }) => {
    await page.route(/\/api\//, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: null }),
    }));
  });

  test('Login', async ({ page }) => { await snap(page, '/login', 'rc-login.png'); });
  test('Landing', async ({ page }) => { await snap(page, '/', 'rc-landing.png'); });
  test('Pricing', async ({ page }) => { await snap(page, '/pricing', 'rc-pricing.png'); });
});

// ── 3. Overlays & états ──────────────────────────────────
test.describe('RC visual — Overlays & états', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('Command palette (Cmd+K)', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await freezeAnimations(page);
    await page.waitForTimeout(1500);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot('rc-cmd-palette.png');
  });

  test('Notifications panel', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await freezeAnimations(page);
    await page.waitForTimeout(1500);
    // Ouvre le panneau notifications via le bouton aria-label
    const bell = page.locator('[aria-label*="otification" i]').first();
    if (await bell.count()) {
      await bell.click();
      await page.waitForTimeout(500);
    }
    await expect(page).toHaveScreenshot('rc-notifications-panel.png');
  });

  test('Welcome wizard / onboarding', async ({ page }) => {
    // Force l'onboarding NON skippé pour capturer le wizard
    await page.addInitScript(() => {
      localStorage.setItem('intralys_token', 'dev-bypass-token');
      localStorage.setItem('intralys_user', JSON.stringify({
        id: 'admin', name: 'Rochdi (Dev)', role: 'admin',
        email: 'test@intralys.com', onboarding_step: 1, onboarding_skipped: false,
      }));
    });
    await snap(page, '/dashboard', 'rc-welcome-wizard.png');
  });

  test('Empty states (Leads vide)', async ({ page }) => {
    await snap(page, '/leads', 'rc-empty-leads.png');
  });
});

// ── 4. Mobile views (3 viewports) ────────────────────────
const MOBILE = { width: 390, height: 844 }; // iPhone 14 logique

test.describe('RC visual — Mobile', () => {
  test.use({ viewport: MOBILE });
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('Mobile Dashboard', async ({ page }) => { await snap(page, '/dashboard', 'rc-m-dashboard.png'); });
  test('Mobile Leads', async ({ page }) => { await snap(page, '/leads', 'rc-m-leads.png'); });
  test('Mobile Inbox', async ({ page }) => { await snap(page, '/conversations', 'rc-m-inbox.png'); });
});
