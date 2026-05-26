// @vitest-environment jsdom
// ── POSReportDaily.test — Sprint 37 (Agent B4) ──────────────────────────────
// Couvre :
//  1. Loading skeleton render (avant résolution async getPosSessionReport).
//  2. Render plein avec mock reportData complet → 7 sections visibles.
//  3. Empty state si réponse vide (res.data null).
//  4. Erreur API → message d'erreur (data-testid pos-report-daily-error).
//  5. Variance badge data-level reflète warning_level (ok / low / high).
//  6. Click Export CSV → URL.createObjectURL + anchor click déclenchés.
//  7. Click Export PDF → window.print mocké appelé.
//  8. Top produits coupé à 10 max (slice(0, 10)).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import type { HTMLAttributes, ButtonHTMLAttributes } from 'react';
import type { PosSessionReport } from '../../lib/api';

// ── Mocks api ────────────────────────────────────────────────────────────────

const getPosSessionReportMock = vi.fn();
const listPosRegistersMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getPosSessionReport: (...a: unknown[]) =>
    getPosSessionReportMock(...(a as [])),
  listPosRegisters: (...a: unknown[]) =>
    listPosRegistersMock(...(a as [])),
}));

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../lib/i18n', () => ({
  t: (k: string) => k,
}));

// Stubs UI minimaux — préservent data-testid et children.
vi.mock('../ui/Card', () => ({
  Card: ({
    children,
    className,
    ...props
  }: HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="card-stub" className={className} {...props}>
      {children}
    </div>
  ),
}));

vi.mock('../ui/Badge', () => ({
  Badge: ({
    children,
    intent,
    fill,
    ...props
  }: HTMLAttributes<HTMLSpanElement> & {
    intent?: string;
    fill?: string;
  }) => (
    <span
      data-testid="badge-stub"
      data-intent={intent ?? 'neutral'}
      data-fill={fill ?? 'soft'}
      {...props}
    >
      {children}
    </span>
  ),
}));

vi.mock('../ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    type,
    'aria-label': ariaLabel,
    'data-testid': testId,
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    'data-testid'?: string;
  }) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-variant={variant ?? 'primary'}
      data-testid={testId}
    >
      {children}
    </button>
  ),
}));

vi.mock('../ui/Skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton-stub" className={className} />
  ),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeReport(
  overrides: Partial<PosSessionReport> = {},
  sessionOverrides: Partial<PosSessionReport['session']> = {},
): PosSessionReport {
  return {
    session: {
      id: 'sess_test_001',
      register_id: 'reg_001',
      client_id: 'client_001',
      opened_by: 'user_001',
      opened_at: '2026-05-24T09:00:00Z',
      closed_at: '2026-05-24T17:30:00Z',
      opening_cash_cents: 10000,
      closing_cash_cents: 25000,
      expected_cash_cents: 24800,
      variance_cents: 200,
      status: 'closed',
      total_sales_cents: 150000,
      total_tax_cents: 22500,
      transaction_count: 42,
      notes: '',
      ...sessionOverrides,
    },
    totals_by_method: [
      { method: 'cash', amount_cents: 50000, count: 15 },
      { method: 'card_terminal', amount_cents: 100000, count: 27 },
    ],
    top_products: [
      {
        variant_id: 'v_001',
        title: 'Espresso',
        quantity: 30,
        total_cents: 9000,
      },
      {
        variant_id: 'v_002',
        title: 'Croissant',
        quantity: 25,
        total_cents: 6250,
      },
    ],
    total_sales_cents: 150000,
    total_tax_cents: 22500,
    transaction_count: 42,
    ...overrides,
  };
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalPrint = window.print;

const createObjectUrlMock = vi.fn(() => 'blob:mock-url');
const revokeObjectUrlMock = vi.fn();
const printMock = vi.fn();

beforeEach(() => {
  getPosSessionReportMock.mockReset();
  listPosRegistersMock.mockReset();
  createObjectUrlMock.mockClear();
  revokeObjectUrlMock.mockClear();
  printMock.mockClear();

  // Mocks blob/print
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectUrlMock,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectUrlMock,
  });
  Object.defineProperty(window, 'print', {
    configurable: true,
    writable: true,
    value: printMock,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: originalRevokeObjectURL,
  });
  Object.defineProperty(window, 'print', {
    configurable: true,
    writable: true,
    value: originalPrint,
  });
});

// Import APRÈS les mocks (vi.mock est hoisté, OK).
import { POSReportDaily } from './POSReportDaily';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POSReportDaily', () => {
  it('rend le skeleton de loading pendant le fetch initial', () => {
    // Promise jamais résolue → loading reste à true.
    getPosSessionReportMock.mockReturnValue(new Promise(() => undefined));
    render(<POSReportDaily sessionId="sess_test_001" />);
    expect(screen.getByTestId('pos-report-daily-loading')).toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton-stub').length).toBeGreaterThan(0);
  });

  it('rend les 7 sections quand le report est chargé avec succès', async () => {
    getPosSessionReportMock.mockResolvedValue({
      data: makeReport(),
    });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(screen.getByTestId('pos-report-daily')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pos-report-section-header')).toBeInTheDocument();
    expect(screen.getByTestId('pos-report-section-totals')).toBeInTheDocument();
    expect(
      screen.getByTestId('pos-report-section-by-method'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('pos-report-section-variance'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('pos-report-section-top-products'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('pos-report-section-hourly')).toBeInTheDocument();
    expect(screen.getByTestId('pos-report-section-export')).toBeInTheDocument();
  });

  it('affiche les totaux formatés (sales, tax, tx_count)', async () => {
    getPosSessionReportMock.mockResolvedValue({
      data: makeReport(),
    });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(screen.getByTestId('pos-report-total-sales')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pos-report-total-sales')).toHaveTextContent(
      '1500.00 $',
    );
    expect(screen.getByTestId('pos-report-total-tax')).toHaveTextContent(
      '225.00 $',
    );
    expect(screen.getByTestId('pos-report-tx-count')).toHaveTextContent('42');
  });

  it('rend l\'empty state quand l\'API retourne data null', async () => {
    getPosSessionReportMock.mockResolvedValue({ data: null });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(screen.getByTestId('pos-report-daily-empty')).toBeInTheDocument();
    });
  });

  it('rend l\'erreur quand l\'API retourne un error string', async () => {
    getPosSessionReportMock.mockResolvedValue({ error: 'Boom 500' });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(screen.getByTestId('pos-report-daily-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pos-report-daily-error')).toHaveTextContent(
      'Boom 500',
    );
  });

  it('badge variance level = ok quand variance_cents = 0', async () => {
    getPosSessionReportMock.mockResolvedValue({
      data: makeReport({}, { variance_cents: 0 }),
    });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('pos-report-variance-badge'),
      ).toBeInTheDocument();
    });
    const badge = screen.getByTestId('pos-report-variance-badge');
    expect(badge).toHaveAttribute('data-level', 'ok');
    expect(badge).toHaveAttribute('data-intent', 'success');
  });

  it('badge variance level = low quand |variance| ≤ 500c', async () => {
    getPosSessionReportMock.mockResolvedValue({
      data: makeReport({}, { variance_cents: 300 }),
    });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('pos-report-variance-badge'),
      ).toBeInTheDocument();
    });
    const badge = screen.getByTestId('pos-report-variance-badge');
    expect(badge).toHaveAttribute('data-level', 'low');
    expect(badge).toHaveAttribute('data-intent', 'warning');
  });

  it('badge variance level = high quand |variance| > 500c', async () => {
    getPosSessionReportMock.mockResolvedValue({
      data: makeReport({}, { variance_cents: -1500 }),
    });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('pos-report-variance-badge'),
      ).toBeInTheDocument();
    });
    const badge = screen.getByTestId('pos-report-variance-badge');
    expect(badge).toHaveAttribute('data-level', 'high');
    expect(badge).toHaveAttribute('data-intent', 'danger');
  });

  it('coupe top_products à 10 max', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      variant_id: `v_${i}`,
      title: `P${i}`,
      quantity: 10 - (i % 5),
      total_cents: 1000 * (i + 1),
    }));
    getPosSessionReportMock.mockResolvedValue({
      data: makeReport({ top_products: many }),
    });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('pos-report-product-row-v_0'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('pos-report-product-row-v_9'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('pos-report-product-row-v_10'),
    ).not.toBeInTheDocument();
  });

  it('rend la section hourly avec data quand hourly_breakdown est présent', async () => {
    const reportWithHourly = {
      ...makeReport(),
      hourly_breakdown: [
        { hour: 9, count: 5, total_cents: 5000 },
        { hour: 10, count: 12, total_cents: 12000 },
        { hour: 11, count: 8, total_cents: 8000 },
      ],
    };
    getPosSessionReportMock.mockResolvedValue({ data: reportWithHourly });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('pos-report-hourly-row-9'),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('pos-report-hourly-row-10')).toBeInTheDocument();
    expect(screen.getByTestId('pos-report-hourly-row-11')).toBeInTheDocument();
  });

  it('click Export CSV → crée un blob (createObjectURL) et déclenche un téléchargement', async () => {
    getPosSessionReportMock.mockResolvedValue({
      data: makeReport(),
    });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('pos-report-export-csv'),
      ).toBeInTheDocument();
    });

    // Spy sur HTMLAnchorElement.click avant le click bouton.
    const anchorClickSpy = vi.spyOn(
      HTMLAnchorElement.prototype,
      'click',
    );

    fireEvent.click(screen.getByTestId('pos-report-export-csv'));

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);

    anchorClickSpy.mockRestore();
  });

  it('click Export PDF → appelle window.print()', async () => {
    getPosSessionReportMock.mockResolvedValue({
      data: makeReport(),
    });
    render(<POSReportDaily sessionId="sess_test_001" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('pos-report-export-pdf'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pos-report-export-pdf'));
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it('appelle getPosSessionReport avec le sessionId fourni', async () => {
    getPosSessionReportMock.mockResolvedValue({
      data: makeReport(),
    });
    render(<POSReportDaily sessionId="sess_abc_123" />);
    await waitFor(() => {
      expect(getPosSessionReportMock).toHaveBeenCalledWith('sess_abc_123');
    });
  });
});
