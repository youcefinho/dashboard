// ── Sprint 26 — E2E API mocks helper ─────────────────────────────────────────
// Factorise le pattern figé smoke.spec.ts:87-107 (page.route avec longest-prefix
// match sur dictionnaire API_MOCKS). Override-friendly via merge.

import type { Page, Route, Request as PlaywrightRequest } from '@playwright/test';

/** Dictionnaire canonique des 16 endpoints couverts par les specs smoke. */
export const DEFAULT_API_MOCKS: Record<string, unknown> = {
  '/api/dashboard/stats': { data: { totalLeads: 0, totalClients: 0, openTasks: 0 } },
  '/api/leads': { data: [] },
  '/api/clients': { data: [] },
  '/api/notifications': { data: [] },
  '/api/pipelines': { data: [] },
  '/api/pipeline': { data: [] },
  '/api/conversations': { data: [] },
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

export interface InstallApiMocksOptions {
  /** Override response factory for POST/PUT/PATCH/DELETE. Defaults to `{ data: { id: 'created-<uuid>' }, success: true }`. */
  postResponse?: (route: Route, request: PlaywrightRequest) => unknown;
}

/**
 * Installe les mocks API sur la page. Merge `overrides` sur `DEFAULT_API_MOCKS`,
 * tri par longest-prefix descendant (les chemins plus spécifiques gagnent).
 * Mutation POST/PUT/PATCH/DELETE → réponse générique success.
 * Best-effort : aucun throw, route inconnue → 200 `{}`.
 */
export async function installApiMocks(
  page: Page,
  overrides: Record<string, unknown> = {},
  options: InstallApiMocksOptions = {},
): Promise<void> {
  const merged = { ...DEFAULT_API_MOCKS, ...overrides };
  const sortedKeys = Object.keys(merged).sort((a, b) => b.length - a.length);
  const defaultPostResponse = (_route: Route, _request: PlaywrightRequest) => ({
    data: { id: `created-${Math.random().toString(36).slice(2, 10)}` },
    success: true,
  });
  const postFactory = options.postResponse ?? defaultPostResponse;

  await page.route(/\/api\//, async (route, request) => {
    try {
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();

      if (method !== 'GET') {
        const body = postFactory(route, request);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
        return;
      }

      // GET — longest-prefix match
      const matchedKey = sortedKeys.find((k) => path === k || path.startsWith(`${k}/`) || path.startsWith(`${k}?`));
      const body = matchedKey ? merged[matchedKey] : {};
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    } catch {
      // Fallback never-throws : route fallback sur 200 {}
      try {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } catch {
        /* abandonne — la spec va probably timeout */
      }
    }
  });
}
