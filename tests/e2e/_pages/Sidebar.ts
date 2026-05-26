// ── Sprint 26 — Page object Sidebar (navigation helpers) ────────────────────
// Wrappers minces autour de page.goto avec waitUntil:'domcontentloaded'.
// Pattern figé : pas d'attente UI ici, c'est le rôle de chaque spec.

import type { Page } from '@playwright/test';

export class Sidebar {
  constructor(private page: Page) {}
  async gotoDashboard() {
    await this.page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  }
  async gotoLeads() {
    await this.page.goto('/leads', { waitUntil: 'domcontentloaded' });
  }
  async gotoPipeline() {
    await this.page.goto('/pipeline', { waitUntil: 'domcontentloaded' });
  }
  async gotoSettings() {
    await this.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  }
  async gotoGettingStarted() {
    await this.page.goto('/getting-started', { waitUntil: 'domcontentloaded' });
  }
  async gotoAdminObservability() {
    await this.page.goto('/admin/observability', { waitUntil: 'domcontentloaded' });
  }
}
