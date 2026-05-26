// @vitest-environment jsdom
// ── LoyaltyCustomerView.test — Sprint 38 (Agent B3) ─────────────────────────
// Couvre :
//  1. Loading → puis render header (nom + tier badge) + balance + history.
//  2. Tier badge couleur correcte selon current_tier (gold/silver/bronze).
//  3. Ledger trié par created_at desc (plus récent en premier).
//  4. Click "Ajuster" → modal s'ouvre.
//  5. Submit adjust → adjustLoyaltyPoints appelé avec program_id/customer_id/
//     points/reason + toast success + refresh.
//  6. Submit adjust avec points=0 ou reason vide → error toast, pas d'appel.
//  7. Expiry warning visible si earn entry expire ≤ 30j + balance > 0.
//  8. Empty state si pas de balance.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import type { ChangeEvent, ReactNode } from 'react';

// ── Mocks api ────────────────────────────────────────────────────────────────

const getCustomerLoyaltyBalanceMock = vi.fn();
const getLoyaltyLedgerMock = vi.fn();
const adjustLoyaltyPointsMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getCustomerLoyaltyBalance: (...a: unknown[]) =>
    getCustomerLoyaltyBalanceMock(...(a as [])),
  getLoyaltyLedger: (...a: unknown[]) => getLoyaltyLedgerMock(...(a as [])),
  adjustLoyaltyPoints: (...a: unknown[]) =>
    adjustLoyaltyPointsMock(...(a as [])),
}));

// i18n : renvoie la clé brute pour assertions stables.
vi.mock('../../lib/i18n', () => ({
  t: (k: string) => k,
}));

// ── Stubs UI ─────────────────────────────────────────────────────────────────

vi.mock('../ui/Card', () => ({
  Card: ({
    children,
    'data-testid': testId,
  }: {
    children: ReactNode;
    'data-testid'?: string;
  }) => <div data-testid={testId}>{children}</div>,
}));

vi.mock('../ui/Badge', () => ({
  Badge: ({
    children,
    intent,
    color,
    'data-testid': testId,
    'data-tier': dataTier,
    'aria-label': ariaLabel,
    style,
  }: {
    children: ReactNode;
    intent?: string;
    color?: string;
    'data-testid'?: string;
    'data-tier'?: string;
    'aria-label'?: string;
    style?: Record<string, string>;
  }) => (
    <span
      data-testid={testId}
      data-intent={intent}
      data-color={color}
      data-tier={dataTier}
      aria-label={ariaLabel}
      style={style}
    >
      {children}
    </span>
  ),
}));

vi.mock('../ui/Modal', () => ({
  Modal: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
    onOpenChange: (o: boolean) => void;
  }) =>
    open ? (
      <div data-testid="modal-stub" role="dialog" aria-label={title}>
        <div data-testid="modal-title">{title}</div>
        {children}
      </div>
    ) : null,
}));

vi.mock('../ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    variant,
    type,
    'data-testid': testId,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    variant?: string;
    type?: 'button' | 'submit' | 'reset';
    'data-testid'?: string;
    'aria-label'?: string;
  }) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      data-variant={variant ?? 'primary'}
      data-loading={isLoading ? 'true' : 'false'}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
}));

vi.mock('../ui/Input', () => ({
  Input: ({
    label,
    value,
    onChange,
    'aria-label': ariaLabel,
    type,
    disabled,
    'data-testid': testId,
  }: {
    label?: ReactNode;
    value?: string | number;
    onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
    'aria-label'?: string;
    type?: string;
    disabled?: boolean;
    'data-testid'?: string;
  }) => (
    <label>
      {label}
      <input
        aria-label={ariaLabel}
        type={type ?? 'text'}
        value={value ?? ''}
        onChange={onChange}
        disabled={disabled}
        data-testid={testId}
      />
    </label>
  ),
}));

vi.mock('../ui/Textarea', () => ({
  Textarea: ({
    label,
    value,
    onChange,
    'aria-label': ariaLabel,
    disabled,
    'data-testid': testId,
  }: {
    label?: ReactNode;
    value?: string;
    onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    'aria-label'?: string;
    disabled?: boolean;
    'data-testid'?: string;
  }) => (
    <label>
      {label}
      <textarea
        aria-label={ariaLabel}
        value={value ?? ''}
        onChange={onChange}
        disabled={disabled}
        data-testid={testId}
      />
    </label>
  ),
}));

// Toast : capture success/error.
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('../ui/Toast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    toast: vi.fn(),
    info: vi.fn(),
    remove: vi.fn(),
  }),
}));

// Import APRÈS les mocks.
import { LoyaltyCustomerView } from './LoyaltyCustomerView';
import type {
  LoyaltyCustomerBalance,
  LoyaltyLedgerEntry,
} from '../../lib/api';

// ── Fixtures ────────────────────────────────────────────────────────────────

const BALANCE_GOLD: LoyaltyCustomerBalance = {
  customer_id: 'cust_1',
  program_id: 'prog_1',
  current_balance: 1250,
  lifetime_earned: 5000,
  current_tier: 'gold',
  last_earn_at: '2026-05-20T10:00:00Z',
  last_redeem_at: '2026-05-15T14:30:00Z',
};

const BALANCE_SILVER: LoyaltyCustomerBalance = {
  ...BALANCE_GOLD,
  current_balance: 450,
  current_tier: 'silver',
};

const BALANCE_BRONZE: LoyaltyCustomerBalance = {
  ...BALANCE_GOLD,
  current_balance: 100,
  current_tier: 'bronze',
};

const LEDGER_OLD: LoyaltyLedgerEntry = {
  id: 'led_old',
  customer_id: 'cust_1',
  points: 50,
  type: 'earn',
  source_order_id: 'ord_a',
  tier_snapshot: 'bronze',
  balance_after: 50,
  expires_at: null,
  created_at: '2026-01-10T08:00:00Z',
};

const LEDGER_MID: LoyaltyLedgerEntry = {
  id: 'led_mid',
  customer_id: 'cust_1',
  points: -100,
  type: 'redeem',
  source_order_id: 'ord_b',
  tier_snapshot: 'silver',
  balance_after: 200,
  expires_at: null,
  created_at: '2026-03-15T12:00:00Z',
};

const LEDGER_NEW: LoyaltyLedgerEntry = {
  id: 'led_new',
  customer_id: 'cust_1',
  points: 200,
  type: 'earn',
  source_order_id: 'ord_c',
  tier_snapshot: 'gold',
  balance_after: 400,
  // Expire dans 10 jours (≤ 30 → warning attendu).
  expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
  created_at: '2026-05-22T09:00:00Z',
};

const LEDGER_NO_EXPIRY_WARNING: LoyaltyLedgerEntry = {
  ...LEDGER_NEW,
  // Expire dans 90 jours (> 30 → pas de warning).
  expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LoyaltyCustomerView', () => {
  beforeEach(() => {
    getCustomerLoyaltyBalanceMock.mockReset();
    getLoyaltyLedgerMock.mockReset();
    adjustLoyaltyPointsMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Render basique ──────────────────────────────────────────────────

  it('1. Render header + balance + tier gold après load', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({ data: BALANCE_GOLD });
    getLoyaltyLedgerMock.mockResolvedValueOnce({
      data: [LEDGER_OLD, LEDGER_NO_EXPIRY_WARNING],
    });

    render(
      <LoyaltyCustomerView customerId="cust_1" customerName="Alice" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loyalty-customer-view')).toBeInTheDocument();
    });

    // Header
    expect(screen.getByText('Alice')).toBeInTheDocument();

    // Tier badge gold
    const badge = screen.getByTestId('loyalty-tier-badge');
    expect(badge).toHaveAttribute('data-tier', 'gold');
    expect(badge).toHaveTextContent('loyalty.tier.gold');

    // Balance value
    expect(screen.getByTestId('loyalty-balance-value')).toHaveTextContent(
      /1\D?250/,
    );

    // Lifetime
    expect(screen.getByTestId('loyalty-lifetime')).toHaveTextContent(/5\D?000/);
  });

  // ── 2. Tier badge couleurs ─────────────────────────────────────────────

  it('2. Tier silver → data-tier=silver + couleur correcte', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({
      data: BALANCE_SILVER,
    });
    getLoyaltyLedgerMock.mockResolvedValueOnce({ data: [] });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    const badge = await screen.findByTestId('loyalty-tier-badge');
    expect(badge).toHaveAttribute('data-tier', 'silver');
    expect(badge).toHaveAttribute('data-color', '#9ca3af');
  });

  it('2b. Tier bronze → data-tier=bronze + couleur correcte', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({
      data: BALANCE_BRONZE,
    });
    getLoyaltyLedgerMock.mockResolvedValueOnce({ data: [] });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    const badge = await screen.findByTestId('loyalty-tier-badge');
    expect(badge).toHaveAttribute('data-tier', 'bronze');
    expect(badge).toHaveAttribute('data-color', '#a16207');
  });

  it('2c. Tier gold → data-tier=gold + couleur correcte', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({ data: BALANCE_GOLD });
    getLoyaltyLedgerMock.mockResolvedValueOnce({ data: [] });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    const badge = await screen.findByTestId('loyalty-tier-badge');
    expect(badge).toHaveAttribute('data-tier', 'gold');
    expect(badge).toHaveAttribute('data-color', '#d4a017');
  });

  // ── 3. Ledger trié desc ────────────────────────────────────────────────

  it('3. Ledger entries triées par created_at desc', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({ data: BALANCE_GOLD });
    // Volontairement ordre non trié.
    getLoyaltyLedgerMock.mockResolvedValueOnce({
      data: [LEDGER_OLD, LEDGER_NEW, LEDGER_MID],
    });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    const table = await screen.findByTestId('loyalty-history-table');
    const rows = within(table).getAllByRole('row');
    // 1 header + 3 data rows.
    expect(rows).toHaveLength(4);
    // Order : LEDGER_NEW (2026-05-22) > LEDGER_MID (2026-03-15) > LEDGER_OLD (2026-01-10).
    expect(rows[1]).toHaveAttribute('data-testid', 'loyalty-history-row-led_new');
    expect(rows[2]).toHaveAttribute('data-testid', 'loyalty-history-row-led_mid');
    expect(rows[3]).toHaveAttribute('data-testid', 'loyalty-history-row-led_old');
  });

  // ── 4. Click "Ajuster" → modal ─────────────────────────────────────────

  it('4. Click bouton ajuster → modal s\'ouvre', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({ data: BALANCE_GOLD });
    getLoyaltyLedgerMock.mockResolvedValueOnce({ data: [] });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    const btn = await screen.findByTestId('loyalty-adjust-open');
    expect(screen.queryByTestId('modal-stub')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId('modal-stub')).toBeInTheDocument();
    expect(screen.getByTestId('loyalty-adjust-form')).toBeInTheDocument();
  });

  // ── 5. Submit adjust OK ────────────────────────────────────────────────

  it('5. Submit adjust → adjustLoyaltyPoints appelé + toast + refresh', async () => {
    getCustomerLoyaltyBalanceMock
      .mockResolvedValueOnce({ data: BALANCE_GOLD })
      .mockResolvedValueOnce({
        data: { ...BALANCE_GOLD, current_balance: 1300 },
      });
    getLoyaltyLedgerMock
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [LEDGER_OLD] });
    adjustLoyaltyPointsMock.mockResolvedValueOnce({
      data: { id: 'led_adj' },
    });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    fireEvent.click(await screen.findByTestId('loyalty-adjust-open'));

    const pointsInput = screen.getByTestId('loyalty-adjust-points');
    const reasonInput = screen.getByTestId('loyalty-adjust-reason');
    fireEvent.change(pointsInput, { target: { value: '50' } });
    fireEvent.change(reasonInput, { target: { value: 'Compensation client' } });

    fireEvent.click(screen.getByTestId('loyalty-adjust-submit'));

    await waitFor(() => {
      expect(adjustLoyaltyPointsMock).toHaveBeenCalledTimes(1);
    });
    expect(adjustLoyaltyPointsMock).toHaveBeenCalledWith({
      program_id: 'prog_1',
      customer_id: 'cust_1',
      points: 50,
      reason: 'Compensation client',
    });
    expect(toastSuccessMock).toHaveBeenCalled();
    // Refresh : 2 appels balance et ledger après submit.
    await waitFor(() => {
      expect(getCustomerLoyaltyBalanceMock).toHaveBeenCalledTimes(2);
      expect(getLoyaltyLedgerMock).toHaveBeenCalledTimes(2);
    });
  });

  // ── 6. Submit adjust invalide ──────────────────────────────────────────

  it('6. Submit avec points=0 → toast error, pas d\'appel API', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({ data: BALANCE_GOLD });
    getLoyaltyLedgerMock.mockResolvedValueOnce({ data: [] });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    fireEvent.click(await screen.findByTestId('loyalty-adjust-open'));
    fireEvent.change(screen.getByTestId('loyalty-adjust-points'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByTestId('loyalty-adjust-reason'), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByTestId('loyalty-adjust-submit'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
    expect(adjustLoyaltyPointsMock).not.toHaveBeenCalled();
  });

  it('6b. Submit avec reason vide → toast error, pas d\'appel API', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({ data: BALANCE_GOLD });
    getLoyaltyLedgerMock.mockResolvedValueOnce({ data: [] });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    fireEvent.click(await screen.findByTestId('loyalty-adjust-open'));
    fireEvent.change(screen.getByTestId('loyalty-adjust-points'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByTestId('loyalty-adjust-reason'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('loyalty-adjust-submit'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
    expect(adjustLoyaltyPointsMock).not.toHaveBeenCalled();
  });

  // ── 7. Expiry warning ──────────────────────────────────────────────────

  it('7. Expiry warning visible si earn expire ≤ 30j + balance > 0', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({ data: BALANCE_GOLD });
    getLoyaltyLedgerMock.mockResolvedValueOnce({ data: [LEDGER_NEW] });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    const warning = await screen.findByTestId('loyalty-expiry-warning');
    expect(warning).toHaveTextContent('loyalty.expiry.warning');
  });

  it('7b. Pas de warning si expiry > 30j', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({ data: BALANCE_GOLD });
    getLoyaltyLedgerMock.mockResolvedValueOnce({
      data: [LEDGER_NO_EXPIRY_WARNING],
    });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    await screen.findByTestId('loyalty-customer-view');
    expect(screen.queryByTestId('loyalty-expiry-warning')).toBeNull();
  });

  // ── 8. Empty state ─────────────────────────────────────────────────────

  it('8. Pas de balance → empty state', async () => {
    getCustomerLoyaltyBalanceMock.mockResolvedValueOnce({ data: null });
    getLoyaltyLedgerMock.mockResolvedValueOnce({ data: [] });

    render(<LoyaltyCustomerView customerId="cust_1" />);

    await waitFor(() => {
      expect(screen.getByTestId('loyalty-empty')).toBeInTheDocument();
    });
  });
});
