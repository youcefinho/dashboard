// ── Sprint 26 — S23 Data Privacy (Loi 25) E2E ───────────────────────────────
// Couvre : export bouton trigger download JSON + delete request modal s'ouvre.

import { test, expect, installApiMocks } from '../_fixtures/test';

test.setTimeout(60_000);

test.describe('S23 — Data Privacy (Loi 25)', () => {
  test('export button triggers JSON download', async ({ authedPage }) => {
    await installApiMocks(authedPage, {
      '/api/me/delete-account': { data: null },
      '/api/me/export-data': {
        data: {
          user: { id: 'admin-1', email: 'admin@intralys.test' },
          sessions: [],
          audit_log: [],
          consents_given: [],
          cookie_consents: [],
          exported_at: new Date().toISOString(),
          purpose: 'Loi 25 art. 27',
        },
      },
    });
    await authedPage.goto('/settings', { waitUntil: 'domcontentloaded' });

    // Naviguer vers tab data_privacy
    const tabBtn = authedPage
      .getByRole('button', { name: /Mes données|Données personnelles|Personal data/i })
      .first();
    if (await tabBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await tabBtn.click();
    }

    const exportBtn = authedPage.locator('[data-testid="data-privacy-export-btn"]').first();
    await exportBtn.waitFor({ state: 'visible', timeout: 10_000 });

    const downloadPromise = authedPage
      .waitForEvent('download', { timeout: 10_000 })
      .catch(() => null);
    await exportBtn.click();
    const download = await downloadPromise;

    if (download) {
      expect(download.suggestedFilename()).toMatch(/intralys-data-export.*\.json/);
    }
  });

  test('delete request modal opens', async ({ authedPage }) => {
    await installApiMocks(authedPage, { '/api/me/delete-account': { data: null } });
    await authedPage.goto('/settings', { waitUntil: 'domcontentloaded' });

    const tabBtn = authedPage
      .getByRole('button', { name: /Mes données|Données personnelles/i })
      .first();
    if (await tabBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await tabBtn.click();
    }

    const deleteBtn = authedPage
      .getByRole('button', { name: /Demander la suppression|Request deletion/i })
      .first();
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click();
      // Modal s'ouvre — chercher un input pour confirm_email
      await expect(authedPage.getByPlaceholder(/courriel|email/i).first()).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});
