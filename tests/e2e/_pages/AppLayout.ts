// ── Sprint 26 — Page object AppLayout (greeting + FAB QuickAdd) ─────────────
// Locators canoniques pour les éléments globaux du layout authentifié.
// Pattern smoke.spec.ts:122 + 153.

import type { Page } from '@playwright/test';

export class AppLayoutPage {
  constructor(private page: Page) {}
  greeting() {
    return this.page
      .locator('h2:has-text("Bonjour"), h2:has-text("Bon après-midi"), h2:has-text("Bonsoir")')
      .first();
  }
  fab() {
    return this.page.getByRole('button', { name: 'Création rapide' });
  }
}
