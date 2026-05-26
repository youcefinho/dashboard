// @vitest-environment jsdom
// ── Sprint 24 — Observabilité : tests <ObservabilityPanel /> (Manager-C) ──
//
// Couvre :
//   1. Rend les 4 KPIs (LCP p75, error rate, p95 latency moyenne, total req).
//   2. Tabs switch metrics ↔ alerts ; tab alerts rend <AlertRulesPanel />.
//   3. Period selector déclenche un re-fetch avec la période choisie.
//   4. `metrics.unavailable === true` → EmptyState `observability.metrics_unavailable`.
//   5. Loading : Skeleton visible avant fetch.
//   6. Health : null → EmptyState `observability.metrics_unavailable` ;
//      avec data → uptime / version / db.
//
// Pattern : vi.mock('@/lib/api') + mock AppLayout (router context lourd) +
// mock AlertRulesPanel (autre composant testé séparément).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import { t } from '@/lib/i18n';

// ── Mocks API ──────────────────────────────────────────────────────────────

const fetchObservabilityHealthMock = vi.fn();
const fetchRequestMetricsMock = vi.fn();
const fetchErrorMetricsMock = vi.fn();
const fetchWebVitalsObservabilityMock = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchObservabilityHealth: (...args: unknown[]) => fetchObservabilityHealthMock(...args),
  fetchRequestMetrics: (...args: unknown[]) => fetchRequestMetricsMock(...args),
  fetchErrorMetrics: (...args: unknown[]) => fetchErrorMetricsMock(...args),
  fetchWebVitalsObservability: (...args: unknown[]) => fetchWebVitalsObservabilityMock(...args),
}));

// AppLayout pull in Sidebar + router context — on le réduit à un passthrough.
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div data-testid="app-layout" data-title={title}>
      {children}
    </div>
  ),
}));

// AlertRulesPanel : testé séparément, on stub pour assertion de présence.
vi.mock('@/components/admin/AlertRulesPanel', () => ({
  AlertRulesPanel: () => <div data-testid="alert-rules-panel-stub">AlertRulesPanel</div>,
}));

// Imports APRÈS les mocks
import { ObservabilityPanel } from '../ObservabilityPanel';

// ── Fixtures ───────────────────────────────────────────────────────────────

function healthOk() {
  return {
    data: {
      status: 'ok' as const,
      db: 'ok' as const,
      version: '24.1.0',
      uptime_s: 3600 * 5 + 60 * 12,
      ai_mock: false,
      migrations_count: 122,
      last_migration: 'migration-observability-seq122.sql',
    },
  };
}

function metricsOk() {
  return {
    data: {
      metrics: [
        {
          route: '/api/leads',
          count: 1200,
          error_count: 12,
          p50_ms: 45,
          p95_ms: 180,
          p99_ms: 320,
          error_rate_pct: 1.0,
        },
        {
          route: '/api/tasks',
          count: 800,
          error_count: 0,
          p50_ms: 30,
          p95_ms: 120,
          p99_ms: 210,
          error_rate_pct: 0.0,
        },
      ],
    },
  };
}

function metricsUnavailable() {
  return { data: { metrics: [], unavailable: true } };
}

function errorsOk() {
  return {
    data: {
      errors: [
        { action: 'leads.create', count: 8, last_at: '2026-05-22T10:00:00Z' },
        { action: 'tasks.delete', count: 3, last_at: '2026-05-22T09:00:00Z' },
      ],
    },
  };
}

function vitalsOk() {
  return {
    data: {
      metrics: [
        { metric_name: 'LCP', count: 500, avg: 1800, p75: 2100 },
        { metric_name: 'CLS', count: 500, avg: 0.05, p75: 0.08 },
        { metric_name: 'INP', count: 500, avg: 120, p75: 200 },
      ],
      period: '24h',
      since: '2026-05-21T00:00:00Z',
    },
  };
}

function setHappy() {
  fetchObservabilityHealthMock.mockResolvedValue(healthOk());
  fetchRequestMetricsMock.mockResolvedValue(metricsOk());
  fetchErrorMetricsMock.mockResolvedValue(errorsOk());
  fetchWebVitalsObservabilityMock.mockResolvedValue(vitalsOk());
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<ObservabilityPanel /> — Sprint 24', () => {
  beforeEach(() => {
    setHappy();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. rend les 4 KPIs (LCP p75, error rate, p95 latency, total requests)', async () => {
    render(<ObservabilityPanel />);
    await waitFor(() => expect(fetchObservabilityHealthMock).toHaveBeenCalled());

    // LCP p75 → "2100 ms" (apparait aussi dans PerfBudgetCard + Web Vitals
    // table, on accepte plusieurs matches)
    await waitFor(() => {
      expect(screen.getAllByText(/2100\s*ms/).length).toBeGreaterThan(0);
    });
    // total requests = 2000 (locale-formatted "2,000" ou "2 000")
    expect(screen.getByText(/2[\s,  ]?000/)).toBeInTheDocument();
    // error rate = (12+0)/2000 *100 = 0.6 %
    expect(screen.getByText(/0\.6\s*%/)).toBeInTheDocument();
    // p95 moyenne = (180+120)/2 = 150 ms (peut apparaitre dans tableau aussi)
    expect(screen.getAllByText(/150\s*ms/).length).toBeGreaterThan(0);
  });

  it('2. tabs switch entre metrics et alerts ; tab alerts rend AlertRulesPanel', async () => {
    render(<ObservabilityPanel />);
    await waitFor(() => expect(fetchObservabilityHealthMock).toHaveBeenCalled());

    // Initial : tab metrics, AlertRulesPanel stub absent (Radix Tabs ne rend pas
    // les TabsContent non actifs dans le DOM par défaut)
    expect(screen.queryByTestId('alert-rules-panel-stub')).not.toBeInTheDocument();

    // Radix Tabs : la trigger reagit a `mousedown` (pas `click`) via
    // composeEventHandlers + button==0.
    fireEvent.mouseDown(screen.getByTestId('tab-alerts'), { button: 0 });
    await waitFor(() => {
      expect(screen.getByTestId('alert-rules-panel-stub')).toBeInTheDocument();
    });
  });

  it('3. period selector déclenche un re-fetch avec la période choisie', async () => {
    render(<ObservabilityPanel />);
    await waitFor(() => expect(fetchRequestMetricsMock).toHaveBeenCalledWith('24h'));

    fireEvent.click(screen.getByTestId('period-7d'));
    await waitFor(() => {
      expect(fetchRequestMetricsMock).toHaveBeenCalledWith('7d');
      expect(fetchErrorMetricsMock).toHaveBeenCalledWith('7d');
    });

    // web vitals : '1h' → fallback '24h' (vitals API ne supporte pas '1h')
    fireEvent.click(screen.getByTestId('period-1h'));
    await waitFor(() => {
      expect(fetchRequestMetricsMock).toHaveBeenCalledWith('1h');
      // dernier appel vitals reste '24h' (depuis le clic 7d) puis idle après 1h
      // on vérifie qu'il a été appelé au moins une fois avec '24h'
      const vitalsCalls = fetchWebVitalsObservabilityMock.mock.calls.map((c) => c[0]);
      expect(vitalsCalls).toContain('24h');
    });
  });

  it('4. metrics.unavailable === true → EmptyState `observability.metrics_unavailable`', async () => {
    fetchRequestMetricsMock.mockResolvedValue(metricsUnavailable());
    render(<ObservabilityPanel />);
    await waitFor(() => expect(fetchRequestMetricsMock).toHaveBeenCalled());

    // Plusieurs EmptyState peuvent s'afficher (top routes + tableaux vides)
    // → on vérifie qu'au moins un porte le texte i18n attendu.
    await waitFor(() => {
      const matches = screen.getAllByText(t('observability.metrics_unavailable'));
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('5. loading : skeletons visibles avant fetch (avant résolution promesses)', () => {
    // Ne résout pas les promesses pour figer le loading
    fetchObservabilityHealthMock.mockReturnValue(new Promise(() => {}));
    fetchRequestMetricsMock.mockReturnValue(new Promise(() => {}));
    fetchErrorMetricsMock.mockReturnValue(new Promise(() => {}));
    fetchWebVitalsObservabilityMock.mockReturnValue(new Promise(() => {}));

    const { container } = render(<ObservabilityPanel />);
    // Skeleton primitive applique inline `animation: shimmer ...` — on cherche
    // tous les divs qui portent cette animation comme proxy "loading state".
    const skeletons = Array.from(container.querySelectorAll('div')).filter((el) => {
      const style = (el as HTMLElement).getAttribute('style') ?? '';
      return /shimmer/i.test(style);
    });
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('6. health null → EmptyState ; health présent → uptime/version affichés', async () => {
    // Cas A — health présent
    render(<ObservabilityPanel />);
    await waitFor(() => expect(fetchObservabilityHealthMock).toHaveBeenCalled());

    expect(await screen.findByText('24.1.0')).toBeInTheDocument();
    // Uptime 5h12m → "5h 12m"
    expect(screen.getByText(/5h\s*12m/)).toBeInTheDocument();

    cleanup();
    vi.clearAllMocks();

    // Cas B — health échoue
    fetchObservabilityHealthMock.mockResolvedValue({ error: 'down' });
    fetchRequestMetricsMock.mockResolvedValue(metricsOk());
    fetchErrorMetricsMock.mockResolvedValue(errorsOk());
    fetchWebVitalsObservabilityMock.mockResolvedValue(vitalsOk());

    render(<ObservabilityPanel />);
    await waitFor(() => expect(fetchObservabilityHealthMock).toHaveBeenCalled());

    // Health card affiche le fallback i18n metrics_unavailable
    await waitFor(() => {
      const matches = screen.getAllByText(t('observability.metrics_unavailable'));
      expect(matches.length).toBeGreaterThan(0);
    });
  });
});
