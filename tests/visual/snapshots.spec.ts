// ── Tests visuels Playwright — Snapshots régression 5 pages clés ──
// V6 : addInitScript pour injecter l'auth AVANT le chargement de la page

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Réponses mock par défaut
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
};

async function setup(page: Page) {
  // 1. Script qui s'exécute AVANT chaque navigation/page load
  // Injecte le token auth dans localStorage avant que React démarre
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

  // 2. Intercepter toutes les requêtes /api/
  await page.route(/\/api\//, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown = { data: null };
    for (const [key, value] of Object.entries(API_MOCKS)) {
      if (pathname.startsWith(key)) {
        body = value;
        break;
      }
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

// Figer les animations
async function freezeAnimations(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        transition-duration: 0s !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
      }
      .animate-shimmer, .animate-pulse, .animate-spin {
        animation: none !important;
      }
    `
  });
}

// ── Tests ────────────────────────────────────────────────

test.describe('Snapshots visuels — Pages clés', () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test('Dashboard — vue principale', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await freezeAnimations(page);
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('dashboard.png', { fullPage: true });
  });

  test('Leads — liste des leads', async ({ page }) => {
    await page.goto('/leads', { waitUntil: 'domcontentloaded' });
    await freezeAnimations(page);
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('leads.png', { fullPage: true });
  });

  test('Pipeline — vue Kanban', async ({ page }) => {
    await page.goto('/pipeline', { waitUntil: 'domcontentloaded' });
    await freezeAnimations(page);
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('pipeline.png', { fullPage: true });
  });

  test('Clients — liste des clients', async ({ page }) => {
    await page.goto('/clients', { waitUntil: 'domcontentloaded' });
    await freezeAnimations(page);
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('clients.png', { fullPage: true });
  });

  test('Settings — paramètres', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await freezeAnimations(page);
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('settings.png', { fullPage: true });
  });
});
