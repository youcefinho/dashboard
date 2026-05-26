// ── Sprint 26 — Playwright fixture composable ────────────────────────────────
// Étend @playwright/test avec fixture `authedPage` qui combine setupAuth +
// installApiMocks (defaults). Override possible via spec :
//   import { test } from '../_fixtures/test';
//   test('...', async ({ authedPage }) => { ... });

import { test as base, type Page } from '@playwright/test';
import { setupAuth, type SetupAuthOptions } from '../_helpers/auth';
import { installApiMocks } from '../_helpers/api-mocks';

export interface AuthedPageFixtures {
  authedPage: Page;
}

export const test = base.extend<AuthedPageFixtures>({
  authedPage: async ({ page }, use) => {
    await setupAuth(page);
    await installApiMocks(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
export { setupAuth, installApiMocks };
export type { SetupAuthOptions };
