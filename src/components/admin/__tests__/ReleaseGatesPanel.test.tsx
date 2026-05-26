// @vitest-environment jsdom
// ── Sprint 30 — Release Candidate / Beta : tests <ReleaseGatesPanel /> ──────
//
// Couvre :
//   1. Render initial → title + subtitle + bouton "Vérifier" visibles, pas de
//      status (placeholder EmptyState).
//   2. Click "Vérifier" + all_green=true → badge `release_gates.all_green`
//      affiché (au moins 1 occurrence, header + lignes).
//   3. Click "Vérifier" + all_green=false → badge `release_gates.gate_failed`
//      affiché (header global).
//   4. env_critical_present.missing=['ADMIN_PASSWORD','WEBHOOK_SECRET'] →
//      nom des variables manquantes rendu dans la ligne.
//   5. API échoue (res.error) → EmptyState gracieux avec message d'erreur.
//   6. Les 8 data-testid `release-gate-row-<key>` présents quand status chargé.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react';

// ── Mock i18n : retourne la clé telle quelle (assertion littérale) ─────────
vi.mock('@/lib/i18n', () => ({
  t: (k: string) => k,
}));

// ── Mock API ───────────────────────────────────────────────────────────────
const fetchReleaseGatesMock = vi.fn();
vi.mock('@/lib/api', () => ({
  fetchReleaseGates: (...args: unknown[]) => fetchReleaseGatesMock(...args),
}));

// Imports APRÈS les mocks
import { ReleaseGatesPanel } from '../ReleaseGatesPanel';

// ── Fixtures ───────────────────────────────────────────────────────────────

function allGreenStatus() {
  return {
    data: {
      all_green: true,
      checks: {
        migrations_last_seq: { ok: true, value: 125 },
        env_critical_present: { ok: true, missing: [] },
        env_optional_present: { ok: true, missing: [] },
        dev_bypass_off: { ok: true },
        payments_live_disabled: { ok: true, value: 0 },
        health_endpoint: { ok: true, status: 200 },
        web_vitals_endpoint: { ok: true, status: 200 },
        beta_codes_seeded: { ok: true, count: 5 },
      },
      checked_at: new Date('2026-05-23T12:00:00Z').toISOString(),
    },
  };
}

function failingStatus() {
  return {
    data: {
      all_green: false,
      checks: {
        migrations_last_seq: { ok: false, value: 100 },
        env_critical_present: {
          ok: false,
          missing: ['ADMIN_PASSWORD', 'WEBHOOK_SECRET'],
        },
        env_optional_present: { ok: true, missing: [] },
        dev_bypass_off: { ok: true },
        payments_live_disabled: { ok: true, value: 0 },
        health_endpoint: { ok: false, status: 500 },
        web_vitals_endpoint: { ok: false, status: 0 },
        beta_codes_seeded: { ok: true, count: 5 },
      },
      checked_at: new Date('2026-05-23T12:00:00Z').toISOString(),
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<ReleaseGatesPanel /> — Sprint 30', () => {
  beforeEach(() => {
    fetchReleaseGatesMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. render initial : title + subtitle + bouton "Vérifier" + EmptyState placeholder', () => {
    render(<ReleaseGatesPanel />);
    expect(screen.getByText('release_gates.title')).toBeInTheDocument();
    // subtitle apparaît 2x (header + EmptyState description) — getAllByText safe
    expect(screen.getAllByText('release_gates.subtitle').length).toBeGreaterThan(0);
    // run_check apparaît 2x (bouton + EmptyState title placeholder)
    expect(screen.getAllByText('release_gates.run_check').length).toBeGreaterThan(0);
    // bouton interrogeable par testid
    expect(screen.getByTestId('release-gates-run')).toBeInTheDocument();
    // Pas de lignes de checks rendues avant fetch
    expect(
      screen.queryByTestId('release-gate-row-migrations_last_seq'),
    ).not.toBeInTheDocument();
  });

  it('2. click "Vérifier" + all_green=true → badge release_gates.all_green affiché', async () => {
    fetchReleaseGatesMock.mockResolvedValue(allGreenStatus());
    render(<ReleaseGatesPanel />);
    fireEvent.click(screen.getByTestId('release-gates-run'));
    await waitFor(() =>
      expect(
        screen.getByTestId('release-gate-row-migrations_last_seq'),
      ).toBeInTheDocument(),
    );
    // all_green apparaît au moins 1x (header global + lignes — au moins 9 instances :
    // 1 header + 8 lignes ok). On valide simplement >= 1.
    expect(screen.getAllByText('release_gates.all_green').length).toBeGreaterThan(0);
    expect(fetchReleaseGatesMock).toHaveBeenCalledTimes(1);
  });

  it('3. click "Vérifier" + all_green=false → badge release_gates.gate_failed affiché', async () => {
    fetchReleaseGatesMock.mockResolvedValue(failingStatus());
    render(<ReleaseGatesPanel />);
    fireEvent.click(screen.getByTestId('release-gates-run'));
    await waitFor(() =>
      expect(
        screen.getByTestId('release-gate-row-migrations_last_seq'),
      ).toBeInTheDocument(),
    );
    // gate_failed apparaît au moins 1x (header global + lignes en échec)
    expect(screen.getAllByText('release_gates.gate_failed').length).toBeGreaterThan(0);
  });

  it('4. missing[] populé → nom des variables manquantes rendu dans la ligne', async () => {
    fetchReleaseGatesMock.mockResolvedValue(failingStatus());
    render(<ReleaseGatesPanel />);
    fireEvent.click(screen.getByTestId('release-gates-run'));
    await waitFor(() =>
      expect(
        screen.getByTestId('release-gate-row-env_critical_present'),
      ).toBeInTheDocument(),
    );
    const row = screen.getByTestId('release-gate-row-env_critical_present');
    expect(row).toHaveTextContent('ADMIN_PASSWORD');
    expect(row).toHaveTextContent('WEBHOOK_SECRET');
    expect(row).toHaveTextContent('release_gates.env_missing');
  });

  it('5. API échoue (res.error) → EmptyState gracieux avec message d\'erreur', async () => {
    fetchReleaseGatesMock.mockResolvedValue({ error: 'Network error' });
    render(<ReleaseGatesPanel />);
    fireEvent.click(screen.getByTestId('release-gates-run'));
    await waitFor(() =>
      expect(screen.getByText('Network error')).toBeInTheDocument(),
    );
    // Pas de lignes de checks rendues
    expect(
      screen.queryByTestId('release-gate-row-migrations_last_seq'),
    ).not.toBeInTheDocument();
  });

  it('6. les 8 data-testid release-gate-row-<key> présents quand status chargé', async () => {
    fetchReleaseGatesMock.mockResolvedValue(allGreenStatus());
    render(<ReleaseGatesPanel />);
    fireEvent.click(screen.getByTestId('release-gates-run'));
    await waitFor(() =>
      expect(
        screen.getByTestId('release-gate-row-migrations_last_seq'),
      ).toBeInTheDocument(),
    );
    const expectedKeys = [
      'migrations_last_seq',
      'env_critical_present',
      'env_optional_present',
      'dev_bypass_off',
      'payments_live_disabled',
      'health_endpoint',
      'web_vitals_endpoint',
      'beta_codes_seeded',
    ];
    for (const key of expectedKeys) {
      expect(screen.getByTestId(`release-gate-row-${key}`)).toBeInTheDocument();
    }
  });
});
