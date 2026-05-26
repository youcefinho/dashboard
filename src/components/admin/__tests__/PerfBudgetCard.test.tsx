// @vitest-environment jsdom
// ── Sprint 25 — Perf : tests <PerfBudgetCard /> (Manager-C) ─────────────────
//
// Couvre :
//   1. Render 5 cellules quand tous les vitals présents → 5 data-testid + i18n labels.
//   2. LCP p75=2000 (pass / ≤ good 2500) → badge `perf.budget_pass`.
//   3. LCP p75=3000 (needs-improvement / > good 2500, ≤ poor 4000) → badge `perf.budget_needs`.
//   4. LCP p75=5000 (fail / > poor 4000) → badge `perf.budget_fail`.
//   5. Vitals vide [] → EmptyState `perf.no_data` rendered.
//   6. Vital missing (FCP absent) → cellule "—" placeholder, pas d'erreur.
//   7. CLS 0.30 → severity fail. Format 0.30 (2 décimales). Unit `perf.unit_score`.
//   8. LCP 2500 → frontière good (≤ strict) → severity pass.
//   9. t() mock : retourne la clé telle quelle pour assertion.
//  10. data-testid `vital-<NAME>-status` présents pour LCP/CLS/INP/TTFB/FCP.

import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ── Mock i18n : retourne la clé telle quelle (assertion littérale) ─────────
vi.mock('@/lib/i18n', () => ({
  t: (k: string) => k,
}));

// Imports APRÈS les mocks
import { PerfBudgetCard } from '../PerfBudgetCard';

// ── Fixtures ───────────────────────────────────────────────────────────────

function allVitalsHealthy() {
  return [
    { metric_name: 'LCP', count: 100, avg: 2000, p75: 2000 },
    { metric_name: 'CLS', count: 100, avg: 0.05, p75: 0.05 },
    { metric_name: 'INP', count: 100, avg: 150, p75: 150 },
    { metric_name: 'TTFB', count: 100, avg: 600, p75: 600 },
    { metric_name: 'FCP', count: 100, avg: 1500, p75: 1500 },
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<PerfBudgetCard /> — Sprint 25', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. render 5 cellules quand tous les vitals présents', () => {
    render(<PerfBudgetCard vitals={allVitalsHealthy()} />);

    // Card title (i18n key forwarded par le mock)
    expect(screen.getByText('perf.budget_card_title')).toBeInTheDocument();
    expect(screen.getByText('perf.budget_card_subtitle')).toBeInTheDocument();

    // 5 data-testid présents
    expect(screen.getByTestId('vital-LCP-status')).toBeInTheDocument();
    expect(screen.getByTestId('vital-CLS-status')).toBeInTheDocument();
    expect(screen.getByTestId('vital-INP-status')).toBeInTheDocument();
    expect(screen.getByTestId('vital-TTFB-status')).toBeInTheDocument();
    expect(screen.getByTestId('vital-FCP-status')).toBeInTheDocument();

    // Labels i18n forwardés (1 fois par cellule)
    expect(screen.getByText('perf.metric_lcp_label')).toBeInTheDocument();
    expect(screen.getByText('perf.metric_cls_label')).toBeInTheDocument();
    expect(screen.getByText('perf.metric_inp_label')).toBeInTheDocument();
    expect(screen.getByText('perf.metric_ttfb_label')).toBeInTheDocument();
    expect(screen.getByText('perf.metric_fcp_label')).toBeInTheDocument();

    // Tous les badges "pass" — 5 cellules toutes vertes
    const passBadges = screen.getAllByText('perf.budget_pass');
    expect(passBadges.length).toBe(5);
  });

  it('2. LCP p75=2000 (pass, ≤ good 2500) → badge perf.budget_pass', () => {
    render(
      <PerfBudgetCard
        vitals={[{ metric_name: 'LCP', count: 100, avg: 2000, p75: 2000 }]}
      />,
    );
    const lcpCell = screen.getByTestId('vital-LCP-status');
    expect(lcpCell).toHaveTextContent('perf.budget_pass');
    expect(lcpCell).toHaveTextContent('2000');
    expect(lcpCell).toHaveTextContent('perf.unit_ms');
  });

  it('3. LCP p75=3000 (needs-improvement) → badge perf.budget_needs', () => {
    render(
      <PerfBudgetCard
        vitals={[{ metric_name: 'LCP', count: 100, avg: 3000, p75: 3000 }]}
      />,
    );
    const lcpCell = screen.getByTestId('vital-LCP-status');
    expect(lcpCell).toHaveTextContent('perf.budget_needs');
    expect(lcpCell).toHaveTextContent('3000');
  });

  it('4. LCP p75=5000 (fail, > poor 4000) → badge perf.budget_fail', () => {
    render(
      <PerfBudgetCard
        vitals={[{ metric_name: 'LCP', count: 100, avg: 5000, p75: 5000 }]}
      />,
    );
    const lcpCell = screen.getByTestId('vital-LCP-status');
    expect(lcpCell).toHaveTextContent('perf.budget_fail');
    expect(lcpCell).toHaveTextContent('5000');
  });

  it('5. vitals vide [] → EmptyState perf.no_data rendered', () => {
    render(<PerfBudgetCard vitals={[]} />);
    expect(screen.getByText('perf.no_data')).toBeInTheDocument();
    // Pas de cellule vital rendue
    expect(screen.queryByTestId('vital-LCP-status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vital-FCP-status')).not.toBeInTheDocument();
  });

  it('6. vital manquant (FCP absent) → cellule placeholder "—" sans crash', () => {
    // Liste sans FCP — les 4 autres présents
    render(
      <PerfBudgetCard
        vitals={[
          { metric_name: 'LCP', count: 10, avg: 2000, p75: 2000 },
          { metric_name: 'CLS', count: 10, avg: 0.05, p75: 0.05 },
          { metric_name: 'INP', count: 10, avg: 150, p75: 150 },
          { metric_name: 'TTFB', count: 10, avg: 600, p75: 600 },
        ]}
      />,
    );
    const fcpCell = screen.getByTestId('vital-FCP-status');
    expect(fcpCell).toBeInTheDocument();
    expect(fcpCell).toHaveTextContent('—');
    // Pas de badge pass/needs/fail sur la cellule placeholder
    expect(fcpCell).not.toHaveTextContent('perf.budget_pass');
    expect(fcpCell).not.toHaveTextContent('perf.budget_fail');
  });

  it('7. CLS 0.30 → severity fail, format 0.30 (2 décimales), unit perf.unit_score', () => {
    render(
      <PerfBudgetCard
        vitals={[{ metric_name: 'CLS', count: 100, avg: 0.3, p75: 0.3 }]}
      />,
    );
    const clsCell = screen.getByTestId('vital-CLS-status');
    expect(clsCell).toHaveTextContent('perf.budget_fail');
    expect(clsCell).toHaveTextContent('0.30');
    expect(clsCell).toHaveTextContent('perf.unit_score');
    // Pas de "ms" sur CLS
    expect(clsCell).not.toHaveTextContent('perf.unit_ms');
  });

  it('8. LCP 2500 → frontière good (≤ strict) → severity pass', () => {
    render(
      <PerfBudgetCard
        vitals={[{ metric_name: 'LCP', count: 100, avg: 2500, p75: 2500 }]}
      />,
    );
    const lcpCell = screen.getByTestId('vital-LCP-status');
    expect(lcpCell).toHaveTextContent('perf.budget_pass');
    expect(lcpCell).not.toHaveTextContent('perf.budget_needs');
    expect(lcpCell).not.toHaveTextContent('perf.budget_fail');
  });

  it('9. t() mock : clé retournée telle quelle (assertion littérale)', () => {
    render(<PerfBudgetCard vitals={[]} />);
    // perf.no_data rendu comme literal grâce au mock
    expect(screen.getByText('perf.no_data')).toBeInTheDocument();
    // Title aussi rendu en mode literal
    expect(screen.getByText('perf.budget_card_title')).toBeInTheDocument();
  });

  it('10. data-testid vital-<NAME>-status présent pour les 5 metrics suivis', () => {
    render(<PerfBudgetCard vitals={allVitalsHealthy()} />);
    const expected = ['LCP', 'CLS', 'INP', 'TTFB', 'FCP'];
    for (const name of expected) {
      expect(screen.getByTestId(`vital-${name}-status`)).toBeInTheDocument();
    }
  });
});
