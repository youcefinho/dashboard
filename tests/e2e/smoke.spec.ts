// ── Tests E2E smoke — 5 flows critiques avant beta ────────────
// Sprint 35 vague 35-1D — sanity check perf/UX critique.
// Pattern : addInitScript auth + mock API (réutilise approche de tests/visual/snapshots.spec.ts).

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

// ── Mocks API par défaut ────────────────────────────────────
// On inclut 1 lead, 1 client, 1 pipeline avec 3 stages pour permettre les
// interactions (LeadPanel open, Pipeline column visible, etc.).

const MOCK_LEAD = {
  id: 'lead-smoke-1',
  client_id: 'client-1',
  name: 'Alice Tremblay',
  email: 'alice@test.local',
  phone: '+1-514-555-0100',
  status: 'new',
  source: 'manual',
  type: 'buyer',
  deal_value: 50000,
  score: 75,
  notes: '',
  tags: [],
  created_at: '2026-05-14T10:00:00Z',
  updated_at: '2026-05-14T10:00:00Z',
};

const MOCK_PIPELINE = {
  id: 'p1',
  name: 'Principal',
  is_default: true,
  stages: [
    { id: 's1', name: 'Nouveau', color: '#3b82f6', position: 0, probability: 10 },
    { id: 's2', name: 'Qualifié', color: '#22c55e', position: 1, probability: 50 },
    { id: 's3', name: 'Proposition', color: '#f59e0b', position: 2, probability: 75 },
  ],
};

const API_MOCKS: Record<string, unknown> = {
  '/api/dashboard/stats': {
    data: {
      total_leads: 1,
      total_clients: 1,
      new_leads_today: 1,
      conversion_rate: 12.5,
      total_revenue: 50000,
      leads_by_status: { new: 1 },
      leads_by_source: { manual: 1 },
      leads_by_month: [],
      leads_by_day: [],
    },
  },
  '/api/leads': { data: [MOCK_LEAD], meta: { total: 1 } },
  '/api/clients': { data: [{ id: 'client-1', name: 'Client Test', email: 'client@test.local' }] },
  '/api/notifications': { data: [] },
  '/api/pipelines': { data: [MOCK_PIPELINE] },
  '/api/pipeline': { data: { pipeline: MOCK_PIPELINE, leads: [MOCK_LEAD] } },
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

async function setupAuth(page: Page) {
  // Injection auth AVANT chargement React (cf. snapshots.spec.ts)
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
    // Match plus spécifique d'abord (longest prefix wins)
    const sortedKeys = Object.keys(API_MOCKS).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (pathname.startsWith(key)) {
        body = API_MOCKS[key];
        break;
      }
    }
    // Réponse génériquement OK pour les POST (créations)
    if (route.request().method() !== 'GET') {
      body = { data: { id: `created-${Date.now()}` }, success: true };
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

// ── Tests ────────────────────────────────────────────────────

test.describe('Smoke E2E — 5 flows critiques', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
  });

  // ── Flow 1 : Login → Dashboard ─────────────────────────────
  test('1. Login → Dashboard avec greeting visible', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    // Le AuthGuard doit laisser passer puisque le token est injecté.
    // On attend le greeting (Bonjour/Bon après-midi/Bonsoir selon l'heure).
    const greeting = page.locator('h2:has-text("Bonjour"), h2:has-text("Bon après-midi"), h2:has-text("Bonsoir")');
    await expect(greeting.first()).toBeVisible({ timeout: 10_000 });
  });

  // ── Flow 2 : Leads list → ouvrir LeadPanel ─────────────────
  test('2. Leads list → ouvrir LeadPanel slide-over', async ({ page }) => {
    await page.goto('/leads', { waitUntil: 'domcontentloaded' });
    // Attendre que la liste charge le lead mock
    const leadLink = page.locator('a[href="/leads/lead-smoke-1"]').first();
    await expect(leadLink).toBeVisible({ timeout: 10_000 });
    await leadLink.click();
    // Le SlidePanel s'ouvre — on cherche un élément discriminant du panel
    // (LeadPanel utilise un role=dialog ou aria-label dédié)
    const panel = page.locator('[role="dialog"], [data-panel="lead"], .slide-panel').first();
    await expect(panel).toBeVisible({ timeout: 5_000 });
  });

  // ── Flow 3 : Pipeline → assert column visible ──────────────
  test('3. Pipeline → colonne Kanban visible', async ({ page }) => {
    await page.goto('/pipeline', { waitUntil: 'domcontentloaded' });
    // Les stages mock contiennent "Nouveau" / "Qualifié" / "Proposition"
    const firstCol = page.locator('.pipeline-column').first();
    await expect(firstCol).toBeVisible({ timeout: 10_000 });
    // Vérifie au moins un nom de stage rendu
    await expect(page.getByText('Nouveau', { exact: false }).first()).toBeVisible();
  });

  // ── Flow 4 : Tasks → ajout rapide via FAB ──────────────────
  test('4. Tasks → ouverture FAB pour ajout rapide', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    // Le FAB QuickAdd est globalement présent (rendu par AppLayout)
    const fab = page.getByRole('button', { name: 'Création rapide' });
    await expect(fab).toBeVisible({ timeout: 10_000 });
    await fab.click();
    // Après click : soit un Popover desktop, soit un BottomSheet mobile s'ouvre
    // On cherche un menu/role dialog ou le label "Tâche" (action quick-add)
    const fanOutMenu = page.locator('[role="menu"], [role="dialog"]').first();
    const taskLabel = page.getByText(/Tâche/i).first();
    // Au moins un des deux doit apparaître
    await expect(fanOutMenu.or(taskLabel)).toBeVisible({ timeout: 5_000 });
  });

  // ── Flow 5 : Inbox → composer visible ──────────────────────
  test('5. Inbox → navigation + composer visible (ou empty state)', async ({ page }) => {
    await page.goto('/conversations', { waitUntil: 'domcontentloaded' });
    // Sans conversations le composer n'est pas rendu — on accepte
    // soit le composer (textarea visible avec placeholder Répondre via...),
    // soit l'empty state Inbox.
    const composer = page.locator('textarea[placeholder*="Répondre"], textarea[placeholder*="Tapez"]').first();
    const emptyState = page.getByText(/aucune conversation|Boîte de réception vide|Sélectionn/i).first();
    await expect(composer.or(emptyState)).toBeVisible({ timeout: 10_000 });
  });
});
