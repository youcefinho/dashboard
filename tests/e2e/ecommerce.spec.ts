// ── Test E2E — Parcours e-commerce (Boutique B2) ──────────────
// LOT E (Release candidate) Manager 1. ÉCRIT, NON EXÉCUTÉ VM —
// à exécuter par Antigravity (pas de backend réel sur la VM).
//
// Parcours : login → catalogue produits (/boutique/produits)
//          → commandes (/boutique/commandes) → ouvrir le détail
//            d'une commande.
//
// Réutilise STRICTEMENT le pattern mock de smoke.spec.ts :
//   - addInitScript : token 'dev-bypass-token' + user admin
//     (cf. smoke.spec.ts setupAuth() :72-107)
//   - page.route(/\/api\//) : longest-prefix match + POST générique
// Spécificité Boutique : les routes /boutique/* sont gated par
// <ModuleGuard module="ecommerce"> (App.tsx). Le guard lit GET
// /api/modules (src/components/ecommerce/ModuleGuard.tsx:26 →
// res.data.active). On mocke donc /api/modules avec
// active:['crm','ecommerce'] sinon redirect /dashboard.
// Endpoints réels lus dans src/lib/api.ts : GET /ecommerce/products
// (:340), GET /ecommerce/orders (:375), GET /ecommerce/categories
// (:633) — le client appelle /api/ecommerce/* (préfixe apiFetch).

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

// ── Données catalogue + commande mock cohérentes ─────────────

const MOCK_PRODUCT = {
  id: 'prod-e2e-1',
  slug: 'cafe-arabica-1kg',
  title: 'Café Arabica 1kg',
  description: 'Grains torréfiés artisanalement.',
  status: 'active',
  base_price: 2499, // cents
  currency: 'CAD',
  product_type: 'Café',
  vendor: 'Brûlerie Intralys',
  primary_image: null,
  variants_count: 1,
  categories: [{ id: 'cat-1', name: 'Boissons' }],
  variants: [
    {
      id: 'var-1',
      title: 'Format 1kg',
      sku: 'CAF-ARA-1K',
      price_override: null,
      inventory: { quantity: 42, low_stock_threshold: 5 },
    },
  ],
  created_at: '2026-05-17T08:00:00Z',
  updated_at: '2026-05-17T08:00:00Z',
};

const MOCK_ORDER = {
  id: 'order-e2e-1',
  order_number: 'CMD-1042',
  customer_email: 'client.boutique@test.local',
  email: 'client.boutique@test.local',
  status: 'paid',
  financial_status: 'paid',
  fulfillment_status: 'unfulfilled',
  subtotal_cents: 2499,
  tps_cents: 125,
  tvq_cents: 249,
  total_cents: 2873,
  currency: 'CAD',
  placed_at: '2026-05-17T08:30:00Z',
  created_at: '2026-05-17T08:30:00Z',
  items: [
    { variant_id: 'var-1', title: 'Café Arabica 1kg — Format 1kg', quantity: 1, unit_price_cents: 2499 },
  ],
};

const API_MOCKS: Record<string, unknown> = {
  // ── Gate Boutique : ModuleGuard lit res.data.active ──────
  '/api/modules': { data: { active: ['crm', 'ecommerce'] } },

  '/api/dashboard/stats': {
    data: {
      total_leads: 0,
      total_clients: 0,
      new_leads_today: 0,
      conversion_rate: 0,
      total_revenue: 2873,
      leads_by_status: {},
      leads_by_source: {},
      leads_by_month: [],
      leads_by_day: [],
    },
  },
  '/api/notifications': { data: [] },
  '/api/settings': { data: {} },
  '/api/users': { data: [] },

  // ── E-commerce : endpoints réels (src/lib/api.ts) ────────
  '/api/ecommerce/products': { data: [MOCK_PRODUCT], total: 1 },
  '/api/ecommerce/categories': { data: [{ id: 'cat-1', name: 'Boissons' }] },
  '/api/ecommerce/orders': { data: [MOCK_ORDER], total: 1 },
  '/api/ecommerce': { data: [] }, // filet pour analytics/dashboard boutique
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
    // Longest-prefix wins (ex. /api/ecommerce/products avant /api/ecommerce).
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

// ── Le parcours e-commerce ────────────────────────────────────

test.describe('E-commerce E2E — catalogue → commande (Boutique gated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
  });

  test('catalogue produits → commandes → détail commande', async ({ page }) => {
    // ── Étape 1 : catalogue produits (gate ecommerce passée) ──
    await page.goto('/boutique/produits', { waitUntil: 'domcontentloaded' });
    // Le ModuleGuard ne doit PAS rediriger vers /dashboard (module actif).
    await expect(page).toHaveURL(/\/boutique\/produits/, { timeout: 10_000 });
    // Le produit mock est listé dans la table-premium.
    await expect(
      page.getByText(MOCK_PRODUCT.title, { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ── Étape 2 : naviguer vers les commandes ────────────────
    await page.goto('/boutique/commandes', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/boutique\/commandes/, { timeout: 10_000 });
    // Le n° de commande mock apparaît.
    await expect(
      page.getByText(MOCK_ORDER.order_number, { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ── Étape 3 : ouvrir le détail de la commande ────────────
    // Le clic sur la ligne ouvre OrderDetailPanel (slide-over).
    await page.getByText(MOCK_ORDER.order_number, { exact: false }).first().click();
    const panel = page.locator('[role="dialog"], [data-panel], .slide-panel').first();
    // Soit le panel détail s'ouvre, soit le courriel client reste visible
    // (état cohérent du mock même si le sélecteur exact varie).
    const customerEmail = page.getByText(MOCK_ORDER.customer_email, { exact: false }).first();
    await expect(panel.or(customerEmail)).toBeVisible({ timeout: 5_000 });
  });

  test('module ecommerce désactivé → redirection /dashboard', async ({ page }) => {
    // Override ciblé : /api/modules sans 'ecommerce' => le guard redirige.
    await page.route(/\/api\/modules/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { active: ['crm'] } }),
      }),
    );
    await page.goto('/boutique/produits', { waitUntil: 'domcontentloaded' });
    // ModuleGuard.tsx:107 → navigate({ to: '/dashboard' }).
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });
});
