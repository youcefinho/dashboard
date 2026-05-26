// @vitest-environment jsdom
// ── Sprint 32 — GBP : tests <GbpInsightsPanel /> (Manager-C4) ───────────────
//
// Couvre :
//   1. Render → getGbpInsights appelé avec (locationId, startDate, endDate)
//      où startDate ≈ J-28 (tolérance 1 jour) et endDate = aujourd'hui.
//   2. 4 KPIs visibles (vues maps combinées, appels, itinéraires, site web)
//      + agrégation BUSINESS_IMPRESSIONS_DESKTOP_MAPS + MOBILE_MAPS.
//   3. metrics: [] → EmptyState avec clés i18n title + description (quota).
//   4. Pas de locationId (string vide) → pas d'appel API, loading reste true.
//   5. res.data manquant (erreur API) → EmptyState rendu (loading retombé).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// ── Mock i18n : retourne la clé telle quelle (assertion littérale) ─────────
vi.mock('@/lib/i18n', () => ({
  t: (k: string) => k,
}));

// ── Mock API ───────────────────────────────────────────────────────────────
const getGbpInsightsMock = vi.fn();
vi.mock('@/lib/api', () => ({
  getGbpInsights: (...args: unknown[]) => getGbpInsightsMock(...args),
}));

// Imports APRÈS les mocks
import { GbpInsightsPanel } from '../GbpInsightsPanel';

// ── Fixtures ───────────────────────────────────────────────────────────────

function insightsWithAllMetrics() {
  return {
    data: {
      locationName: 'locations/123',
      startDate: '2026-04-26',
      endDate: '2026-05-24',
      metrics: [
        { metric: 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', value: 120 },
        { metric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', value: 380 },
        { metric: 'CALL_CLICKS', value: 42 },
        { metric: 'BUSINESS_DIRECTION_REQUESTS', value: 17 },
        { metric: 'WEBSITE_CLICKS', value: 88 },
      ],
    },
  };
}

function emptyInsights() {
  return {
    data: {
      locationName: 'locations/123',
      startDate: '2026-04-26',
      endDate: '2026-05-24',
      metrics: [],
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<GbpInsightsPanel /> — Sprint 32', () => {
  beforeEach(() => {
    getGbpInsightsMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. fetch insights avec (locationId, startDate ~ J-28, endDate = today)', async () => {
    getGbpInsightsMock.mockResolvedValue(insightsWithAllMetrics());
    render(<GbpInsightsPanel locationId="loc_abc" />);

    await waitFor(() => expect(getGbpInsightsMock).toHaveBeenCalledTimes(1));

    const [locId, startDate, endDate] = getGbpInsightsMock.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(locId).toBe('loc_abc');

    // Format ISO date YYYY-MM-DD
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // endDate = aujourd'hui (tolérance 1 jour pour timezone)
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect([today, yesterday]).toContain(endDate);

    // startDate ≈ J-28 (tolérance ±1 jour)
    const expected28 = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const expected27 = new Date(Date.now() - 27 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const expected29 = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect([expected27, expected28, expected29]).toContain(startDate);
  });

  it('2. 4 KPIs visibles (vues = desktop+mobile maps, appels, itinéraires, web)', async () => {
    getGbpInsightsMock.mockResolvedValue(insightsWithAllMetrics());
    render(<GbpInsightsPanel locationId="loc_abc" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-insights-panel')).toBeInTheDocument(),
    );

    // Labels i18n forwardés (mock identity)
    expect(screen.getByText('gbp.insights.views')).toBeInTheDocument();
    expect(screen.getByText('gbp.insights.calls')).toBeInTheDocument();
    expect(screen.getByText('gbp.insights.directions')).toBeInTheDocument();
    expect(screen.getByText('Site web')).toBeInTheDocument();

    // Title de la Card
    expect(screen.getByText('gbp.insights.title')).toBeInTheDocument();

    // Agrégation maps : 120 + 380 = 500
    expect(screen.getByText('500')).toBeInTheDocument();
    // Appels
    expect(screen.getByText('42')).toBeInTheDocument();
    // Itinéraires
    expect(screen.getByText('17')).toBeInTheDocument();
    // Site web
    expect(screen.getByText('88')).toBeInTheDocument();
  });

  it('3. metrics: [] → EmptyState avec clés i18n title + description (quota)', async () => {
    getGbpInsightsMock.mockResolvedValue(emptyInsights());
    render(<GbpInsightsPanel locationId="loc_abc" />);

    await waitFor(() =>
      expect(screen.getByText('gbp.insights.title')).toBeInTheDocument(),
    );

    // EmptyState description = clé quota
    expect(screen.getByText('gbp.error.api_quota')).toBeInTheDocument();

    // Pas de panel KPI rendu
    expect(screen.queryByTestId('gbp-insights-panel')).not.toBeInTheDocument();
  });

  it('4. locationId vide → pas d\'appel API, loading reste affiché', async () => {
    render(<GbpInsightsPanel locationId="" />);

    // Pas d'appel API
    expect(getGbpInsightsMock).not.toHaveBeenCalled();

    // Loading placeholder visible
    expect(screen.getByTestId('gbp-insights-loading')).toBeInTheDocument();
  });

  it('5. res.data manquant (erreur API) → EmptyState rendu', async () => {
    getGbpInsightsMock.mockResolvedValue({ error: 'rate_limited' });
    render(<GbpInsightsPanel locationId="loc_abc" />);

    await waitFor(() =>
      expect(screen.getByText('gbp.insights.title')).toBeInTheDocument(),
    );

    // EmptyState rendu (pas le panel)
    expect(screen.getByText('gbp.error.api_quota')).toBeInTheDocument();
    expect(screen.queryByTestId('gbp-insights-panel')).not.toBeInTheDocument();
  });
});
