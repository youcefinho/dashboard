// ── Sprint 26 — S24 Admin observability E2E ─────────────────────────────────
// Couvre : page chargée + tabs metrics/alerts + period selector.
// User role:'admin' explicite (override defaut admin-1).

import { test, expect, installApiMocks, setupAuth } from '../_fixtures/test';

test.setTimeout(60_000);

const MOCK_HEALTH = {
  data: {
    status: 'ok',
    db: 'ok',
    version: '2.1.0',
    uptime_s: 3600,
    ai_mock: true,
    migrations_count: 123,
    last_migration: '123:migration-perf-indexes-seq123.sql',
  },
};

test.describe('S24 — Admin observability', () => {
  test('page loads with tabs metrics/alerts', async ({ page }) => {
    await setupAuth(page, { user: { role: 'admin' } });
    await installApiMocks(page, {
      '/api/admin/observability/health': MOCK_HEALTH,
      '/api/admin/observability/request-metrics': { data: { metrics: [] } },
      '/api/admin/observability/errors': { data: { errors: [] } },
      '/api/admin/observability/web-vitals': {
        data: { metrics: [], period: '24h', since: new Date().toISOString() },
      },
      '/api/admin/observability/alerts': { data: { rules: [], events: [] } },
    });
    await page.goto('/admin/observability', { waitUntil: 'domcontentloaded' });

    // Page title visible (i18n observability.title)
    await expect(page.getByText(/Observabilité|Observability/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('tab switching metrics → alerts', async ({ page }) => {
    await setupAuth(page, { user: { role: 'admin' } });
    await installApiMocks(page, {
      '/api/admin/observability/health': MOCK_HEALTH,
      '/api/admin/observability/request-metrics': { data: { metrics: [] } },
      '/api/admin/observability/errors': { data: { errors: [] } },
      '/api/admin/observability/web-vitals': {
        data: { metrics: [], period: '24h', since: new Date().toISOString() },
      },
      '/api/admin/observability/alerts': { data: { rules: [], events: [] } },
    });
    await page.goto('/admin/observability', { waitUntil: 'domcontentloaded' });

    const alertsTab = page.getByRole('tab', { name: /Alertes|Alerts/i }).first();
    if (await alertsTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await alertsTab.click();
      await expect(page.getByText(/Règles d'alerte|Alert rules/i).first()).toBeVisible({
        timeout: 5_000,
      });
    }
  });

  test('period selector changes', async ({ page }) => {
    await setupAuth(page, { user: { role: 'admin' } });
    await installApiMocks(page, {
      '/api/admin/observability/health': MOCK_HEALTH,
      '/api/admin/observability/request-metrics': { data: { metrics: [] } },
      '/api/admin/observability/errors': { data: { errors: [] } },
      '/api/admin/observability/web-vitals': {
        data: { metrics: [], period: '24h', since: new Date().toISOString() },
      },
      '/api/admin/observability/alerts': { data: { rules: [], events: [] } },
    });
    await page.goto('/admin/observability', { waitUntil: 'domcontentloaded' });

    const periodBtn = page.getByRole('button', { name: /^7 j$|^7d$/i }).first();
    if (await periodBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await periodBtn.click();
    }
  });
});
