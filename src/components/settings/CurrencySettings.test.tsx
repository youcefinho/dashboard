// @vitest-environment jsdom
// ── CurrencySettings.test — Sprint 39 (Agent B1) ────────────────────────────
// Couvre :
//  1. Render initial → loading skeletons → puis 5 devises + table rates.
//  2. Click Refresh → refreshCurrencyRates appelé + re-fetch listCurrencyRates.
//  3. Submit manual override → setManualCurrencyRate({ base, quote, rate }).
//  4. Badge source affiché correctement (ecb / manual / cached_stale).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Mocks api ───────────────────────────────────────────────────────────────
const getCurrenciesMock = vi.fn();
const listCurrencyRatesMock = vi.fn();
const refreshCurrencyRatesMock = vi.fn();
const setManualCurrencyRateMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getCurrencies: (...a: unknown[]) => getCurrenciesMock(...(a as [])),
  listCurrencyRates: (...a: unknown[]) => listCurrencyRatesMock(...(a as [])),
  refreshCurrencyRates: (...a: unknown[]) =>
    refreshCurrencyRatesMock(...(a as [])),
  setManualCurrencyRate: (...a: unknown[]) =>
    setManualCurrencyRateMock(...(a as [])),
}));

// i18n : renvoie la clé brute.
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

vi.mock('../../lib/i18n/datetime', () => ({
  formatRelativeTime: (d: string) => `rel(${d})`,
}));

// Button : stub pass-through.
vi.mock('../ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    type,
    'aria-label': ariaLabel,
    'data-testid': testId,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    type?: 'button' | 'submit' | 'reset';
    'aria-label'?: string;
    'data-testid'?: string;
  }) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      data-loading={isLoading ? 'true' : 'false'}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {children}
    </button>
  ),
}));

// Input : pass-through.
vi.mock('../ui/Input', () => ({
  Input: ({
    id,
    value,
    onChange,
    'aria-label': ariaLabel,
    required,
    type,
    'data-testid': testId,
    label,
  }: {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    'aria-label'?: string;
    required?: boolean;
    type?: string;
    'data-testid'?: string;
    label?: ReactNode;
  }) => (
    <label>
      {label}
      <input
        id={id}
        type={type ?? 'text'}
        value={value ?? ''}
        onChange={onChange}
        aria-label={ariaLabel}
        required={required}
        data-testid={testId ?? `input-${id ?? 'unknown'}`}
      />
    </label>
  ),
}));

// Select : pass-through (children options).
vi.mock('../ui/Select', () => ({
  Select: ({
    id,
    value,
    onChange,
    'aria-label': ariaLabel,
    'data-testid': testId,
    children,
    label,
  }: {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    'aria-label'?: string;
    'data-testid'?: string;
    children?: ReactNode;
    label?: ReactNode;
  }) => (
    <label>
      {label}
      <select
        id={id}
        value={value ?? ''}
        onChange={onChange}
        aria-label={ariaLabel}
        data-testid={testId ?? `select-${id ?? 'unknown'}`}
      >
        {children}
      </select>
    </label>
  ),
}));

// Icon : stub.
vi.mock('../ui/Icon', () => ({
  Icon: ({ size }: { size?: number | string }) => (
    <span data-testid="icon-stub" data-size={String(size)} />
  ),
}));

// Skeleton : stub.
vi.mock('../ui/Skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton-stub" className={className} />
  ),
}));

// Toast : capture success/error.
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('../ui/Toast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    toast: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    remove: vi.fn(),
  }),
}));

// Imports APRÈS les mocks.
import { CurrencySettings } from './CurrencySettings';
import type { CurrencyRate, SupportedCurrencyExt } from '../../lib/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const ALL_CURRENCIES: SupportedCurrencyExt[] = [
  'CAD',
  'USD',
  'EUR',
  'DZD',
  'MAD',
];

function makeRate(over: Partial<CurrencyRate> = {}): CurrencyRate {
  return {
    id: over.id ?? 'r_1',
    base_currency: over.base_currency ?? 'EUR',
    quote_currency: over.quote_currency ?? 'CAD',
    rate: over.rate ?? 1.4567,
    source: over.source ?? 'ecb',
    fetched_at: over.fetched_at ?? new Date().toISOString(),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<CurrencySettings /> — Sprint 39 B1', () => {
  beforeEach(() => {
    getCurrenciesMock.mockResolvedValue({ data: ALL_CURRENCIES });
    listCurrencyRatesMock.mockResolvedValue({
      data: [
        makeRate({ id: 'r_ecb', base_currency: 'EUR', quote_currency: 'CAD', source: 'ecb' }),
        makeRate({
          id: 'r_manual',
          base_currency: 'EUR',
          quote_currency: 'USD',
          source: 'manual',
          rate: 1.08,
        }),
        makeRate({
          id: 'r_stale',
          base_currency: 'USD',
          quote_currency: 'DZD',
          source: 'ecb',
          // 48h dans le passé → stale.
          fetched_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        }),
      ],
    });
    refreshCurrencyRatesMock.mockResolvedValue({ data: { refreshed: 4 } });
    setManualCurrencyRateMock.mockResolvedValue({
      data: makeRate({ source: 'manual' }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. mount → load currencies + rates, affiche 5 devises et table rates', async () => {
    render(<CurrencySettings />);

    await waitFor(() => {
      expect(getCurrenciesMock).toHaveBeenCalledTimes(1);
      expect(listCurrencyRatesMock).toHaveBeenCalledTimes(1);
    });

    // 5 devises supportées rendues.
    await waitFor(() => {
      expect(screen.getByTestId('currency-row-CAD')).toBeInTheDocument();
    });
    expect(screen.getByTestId('currency-row-USD')).toBeInTheDocument();
    expect(screen.getByTestId('currency-row-EUR')).toBeInTheDocument();
    expect(screen.getByTestId('currency-row-DZD')).toBeInTheDocument();
    expect(screen.getByTestId('currency-row-MAD')).toBeInTheDocument();

    // Table rates avec 3 lignes.
    expect(screen.getByTestId('currency-rates-table')).toBeInTheDocument();
    expect(screen.getByTestId('currency-rate-row-r_ecb')).toBeInTheDocument();
    expect(screen.getByTestId('currency-rate-row-r_manual')).toBeInTheDocument();
    expect(screen.getByTestId('currency-rate-row-r_stale')).toBeInTheDocument();
  });

  it('2. click Refresh → refreshCurrencyRates appelé + re-load rates + toast', async () => {
    render(<CurrencySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('currency-rate-row-r_ecb')).toBeInTheDocument();
    });
    // Reset call count après le mount initial.
    listCurrencyRatesMock.mockClear();

    fireEvent.click(screen.getByTestId('currency-btn-refresh'));

    await waitFor(() => {
      expect(refreshCurrencyRatesMock).toHaveBeenCalledTimes(1);
    });
    // refreshCurrencyRates est sans arg (signature FIGÉE).
    expect(refreshCurrencyRatesMock.mock.calls[0]).toEqual([]);

    await waitFor(() => {
      // Re-fetch des rates après refresh.
      expect(listCurrencyRatesMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalled();
    });
  });

  it('3. submit manual override → setManualCurrencyRate appelé avec args', async () => {
    render(<CurrencySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('currency-rate-row-r_ecb')).toBeInTheDocument();
    });

    // Sélectionne base = USD, quote = MAD.
    const baseSel = screen.getByTestId('currency-manual-base');
    fireEvent.change(baseSel, { target: { value: 'USD' } });

    const quoteSel = screen.getByTestId('currency-manual-quote');
    fireEvent.change(quoteSel, { target: { value: 'MAD' } });

    const rateInput = screen.getByTestId('currency-manual-rate');
    fireEvent.change(rateInput, { target: { value: '9.85' } });

    fireEvent.click(screen.getByTestId('currency-manual-submit'));

    await waitFor(() => {
      expect(setManualCurrencyRateMock).toHaveBeenCalledTimes(1);
    });
    expect(setManualCurrencyRateMock.mock.calls[0]?.[0]).toEqual({
      base_currency: 'USD',
      quote_currency: 'MAD',
      rate: 9.85,
    });

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalled();
    });
  });

  it('4. badge source affiché correctement (ecb / manual / cached_stale)', async () => {
    render(<CurrencySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('currency-rate-row-r_ecb')).toBeInTheDocument();
    });

    const ecbBadge = screen.getByTestId('currency-rate-badge-r_ecb');
    expect(ecbBadge).toHaveAttribute('data-source', 'ecb');
    expect(ecbBadge).toHaveAttribute('data-stale', 'false');
    expect(ecbBadge).toHaveTextContent('shop.currency.source_ecb');

    const manualBadge = screen.getByTestId('currency-rate-badge-r_manual');
    expect(manualBadge).toHaveAttribute('data-source', 'manual');
    expect(manualBadge).toHaveAttribute('data-stale', 'false');
    expect(manualBadge).toHaveTextContent('shop.currency.source_manual');

    // Stale (fetched 48h ago) → flag stale + classe rose.
    const staleBadge = screen.getByTestId('currency-rate-badge-r_stale');
    expect(staleBadge).toHaveAttribute('data-stale', 'true');
    expect(staleBadge).toHaveTextContent('shop.currency.stale');
  });
});
