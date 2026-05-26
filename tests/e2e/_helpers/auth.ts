// ── Sprint 26 — E2E auth helper (factorise pattern figé smoke.spec.ts:72-86) ─
// Injecte le token bypass + locale + user mock AVANT chargement React via
// addInitScript. À appeler AVANT chaque page.goto.

import type { Page } from '@playwright/test';

export interface SetupAuthUserOptions {
  id?: string;
  name?: string;
  email?: string;
  role?: 'admin' | 'user' | 'superadmin';
  onboarding_step?: number;
  onboarding_skipped?: boolean;
}

export interface SetupAuthOptions {
  token?: string;
  locale?: string;
  user?: SetupAuthUserOptions;
}

const DEFAULT_USER = {
  id: 'admin-1',
  name: 'Admin Test',
  email: 'admin@intralys.test',
  role: 'admin' as const,
  onboarding_step: 6,
  onboarding_skipped: true,
};

export async function setupAuth(page: Page, options: SetupAuthOptions = {}): Promise<void> {
  const token = options.token ?? 'dev-bypass-token';
  const locale = options.locale ?? 'fr-CA';
  const user = { ...DEFAULT_USER, ...(options.user ?? {}) };

  await page.addInitScript(
    ({ token, locale, user }) => {
      try {
        localStorage.setItem('intralys_token', token);
        localStorage.setItem('intralys_locale', locale);
        localStorage.setItem('intralys_user', JSON.stringify(user));
      } catch {
        /* never throws — best-effort */
      }
    },
    { token, locale, user },
  );
}
