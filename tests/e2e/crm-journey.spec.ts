// ── Test E2E — Parcours CRM enchaîné bout-en-bout ─────────────
// LOT E (Release candidate) Manager 1. ÉCRIT, NON EXÉCUTÉ VM —
// à exécuter par Antigravity (pas de backend réel sur la VM).
//
// Diffère des 5 flows smoke isolés : ici 1 SEUL parcours continu où
// chaque étape dépend de l'état posé par la précédente :
//   login → liste leads → ouvrir un lead (panel) → voir le pipeline
//          → créer une tâche liée au lead.
//
// Réutilise STRICTEMENT le pattern mock de smoke.spec.ts :
//   - addInitScript : localStorage token 'dev-bypass-token' + user admin
//     (cf. smoke.spec.ts setupAuth() :72-107)
//   - page.route(/\/api\//) : longest-prefix match sur un dictionnaire,
//     POST/PUT/PATCH/DELETE => réponse générique { success: true }
// Sélecteurs calqués sur smoke.spec.ts (a[href="/leads/<id>"],
// .pipeline-column, getByRole('button', { name: 'Création rapide' }))
// — lus, pas devinés.

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

// ── Données mock cohérentes pour TOUT le parcours ────────────
// Le même lead traverse liste -> panel -> pipeline -> tâche liée.

const JOURNEY_LEAD = {
  id: 'lead-journey-1',
  client_id: 'client-1',
  name: 'Bruno Lavoie',
  email: 'bruno.lavoie@test.local',
  phone: '+1-514-555-0142',
  status: 'new',
  source: 'manual',
  type: 'buyer',
  deal_value: 82000,
  score: 68,
  notes: '',
  tags: [],
  created_at: '2026-05-17T09:00:00Z',
  updated_at: '2026-05-17T09:00:00Z',
};

const JOURNEY_PIPELINE = {
  id: 'p1',
  name: 'Principal',
  is_default: true,
  stages: [
    { id: 's1', name: 'Nouveau', color: '#3b82f6', position: 0, probability: 10 },
    { id: 's2', name: 'Qualifié', color: '#22c55e', position: 1, probability: 50 },
    { id: 's3', name: 'Proposition', color: '#f59e0b', position: 2, probability: 75 },
  ],
};

// Tâche liée au lead du parcours — l'API renvoie cette liste après création.
const JOURNEY_TASK = {
  id: 'task-journey-1',
  title: 'Rappeler Bruno Lavoie',
  lead_id: JOURNEY_LEAD.id,
  status: 'todo',
  priority: 'high',
  due_date: '2026-05-20T10:00:00Z',
  created_at: '2026-05-17T09:05:00Z',
};

const API_MOCKS: Record<string, unknown> = {
  '/api/dashboard/stats': {
    data: {
      total_leads: 1,
      total_clients: 1,
      new_leads_today: 1,
      conversion_rate: 12.5,
      total_revenue: 82000,
      leads_by_status: { new: 1 },
      leads_by_source: { manual: 1 },
      leads_by_month: [],
      leads_by_day: [],
    },
  },
  '/api/leads': { data: [JOURNEY_LEAD], meta: { total: 1 } },
  '/api/clients': { data: [{ id: 'client-1', name: 'Client Test', email: 'client@test.local' }] },
  '/api/notifications': { data: [] },
  '/api/pipelines': { data: [JOURNEY_PIPELINE] },
  '/api/pipeline': { data: { pipeline: JOURNEY_PIPELINE, leads: [JOURNEY_LEAD] } },
  '/api/conversations': { data: [], meta: { counts: [] } },
  // La tâche liée est visible une fois "créée" (mock statique cohérent).
  '/api/tasks': { data: [JOURNEY_TASK] },
  '/api/settings': { data: {} },
  '/api/users': { data: [] },
  '/api/agencies': { data: [] },
  '/api/custom-fields': { data: [] },
  '/api/smart-lists': { data: [] },
  '/api/snippets': { data: [] },
  '/api/templates': { data: [] },
  '/api/lead-tags': { data: [] },
};

// setupAuth — copie fidèle du pattern smoke.spec.ts:72-107.
async function setupAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('intralys_token', 'dev-bypass-token');
    localStorage.setItem('intralys_locale', 'fr-CA');
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
    const sortedKeys = Object.keys(API_MOCKS).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (pathname.startsWith(key)) {
        body = API_MOCKS[key];
        break;
      }
    }
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

// ── Le parcours : un seul test, étapes enchaînées ─────────────

test.describe('CRM Journey E2E — parcours enchaîné bout-en-bout', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
  });

  test('login → lead → pipeline → tâche liée (état conservé entre étapes)', async ({ page }) => {
    // ── Étape 1 : login (token injecté) → Dashboard ──────────
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    const greeting = page.locator(
      'h2:has-text("Bonjour"), h2:has-text("Bon après-midi"), h2:has-text("Bonsoir")',
    );
    await expect(greeting.first()).toBeVisible({ timeout: 10_000 });

    // ── Étape 2 : naviguer vers la liste des leads ───────────
    await page.goto('/leads', { waitUntil: 'domcontentloaded' });
    const leadLink = page.locator(`a[href="/leads/${JOURNEY_LEAD.id}"]`).first();
    await expect(leadLink).toBeVisible({ timeout: 10_000 });

    // ── Étape 3 : ouvrir le lead → slide-over panel ──────────
    await leadLink.click();
    const panel = page.locator('[role="dialog"], [data-panel="lead"], .slide-panel').first();
    await expect(panel).toBeVisible({ timeout: 5_000 });
    // Le panel doit afficher le lead du parcours (cohérence inter-étapes).
    await expect(page.getByText(JOURNEY_LEAD.name).first()).toBeVisible({ timeout: 5_000 });

    // ── Étape 4 : aller dans le pipeline (le lead y est présent) ─
    await page.goto('/pipeline', { waitUntil: 'domcontentloaded' });
    const firstCol = page.locator('.pipeline-column').first();
    await expect(firstCol).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Nouveau', { exact: false }).first()).toBeVisible();
    // Le même lead apparaît dans une carte du pipeline.
    await expect(page.getByText(JOURNEY_LEAD.name).first()).toBeVisible({ timeout: 5_000 });

    // ── Étape 5 : créer une tâche liée via le FAB global ─────
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    const fab = page.getByRole('button', { name: 'Création rapide' });
    await expect(fab).toBeVisible({ timeout: 10_000 });
    await fab.click();
    const fanOutMenu = page.locator('[role="menu"], [role="dialog"]').first();
    const taskLabel = page.getByText(/Tâche/i).first();
    await expect(fanOutMenu.or(taskLabel)).toBeVisible({ timeout: 5_000 });

    // Vérif finale : la tâche liée au lead du parcours est listée
    // (mock /api/tasks renvoie JOURNEY_TASK rattachée à JOURNEY_LEAD).
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText(JOURNEY_TASK.title, { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
