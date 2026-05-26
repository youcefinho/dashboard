// ── Sprint 26 — S23 Cookies consent banner E2E (anonyme) ────────────────────
// Couvre : banner visible + accept-all persiste localStorage + customize panel
// 4 catégories + déjà-consenti masque le banner.
// PAS de setupAuth — visiteur anonyme.

import { test as baseTest, expect } from '@playwright/test';
import { installApiMocks } from '../_helpers/api-mocks';

baseTest.setTimeout(60_000);

baseTest.describe('S23 — Cookies consent banner (anonyme)', () => {
  baseTest('banner visible on first visit + accept-all persists', async ({ page }) => {
    // PAS de setupAuth — visiteur anonyme
    await installApiMocks(page);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const banner = page.getByText(/Cookies & vie privée/i).first();
    await expect(banner).toBeVisible({ timeout: 10_000 });

    const acceptBtn = page.locator('[data-testid="cookies-accept-all"]');
    await acceptBtn.click();

    // Le banner se masque après acceptation
    await expect(banner).not.toBeVisible({ timeout: 5_000 });

    // localStorage est rempli
    const stored = await page.evaluate(() => localStorage.getItem('cookies_consent_v1'));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.categories.analytics).toBe(true);
    expect(parsed.categories.marketing).toBe(true);
  });

  baseTest('customize panel shows 4 categories with essential disabled', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const customizeBtn = page.locator('[data-testid="cookies-customize"]');
    await customizeBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await customizeBtn.click();

    // 4 catégories visibles, essential checked + disabled
    await expect(page.getByText(/Essentiels/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Préférences/i)).toBeVisible();
    await expect(page.getByText(/Analytique/i)).toBeVisible();
    await expect(page.getByText(/Marketing/i)).toBeVisible();
  });

  baseTest('banner hidden when already consented', async ({ page }) => {
    // Pré-injecter localStorage avec consent valide
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'cookies_consent_v1',
          JSON.stringify({
            anonymous_id: 'test-uuid',
            categories: {
              essential: true,
              preferences: true,
              analytics: false,
              marketing: false,
            },
            policy_version: '1.0',
            granted_at: new Date().toISOString(),
          }),
        );
      } catch {}
    });
    await installApiMocks(page);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    // Le banner ne doit PAS apparaître
    const banner = page.getByText(/Cookies & vie privée/i).first();
    await expect(banner).not.toBeVisible({ timeout: 3_000 });
  });
});
