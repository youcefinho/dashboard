// @vitest-environment jsdom
// ── POSTerminal.test — Sprint 37 (Agent B1) ─────────────────────────────────
// Couvre :
//  1. Pas de session active (localStorage vide) → CTA "Ouvrir session" visible.
//  2. Session active → header + grille catalogue + cart vide visible.
//  3. Scan barcode (Enter) → scanBarcode appelé + product ajouté au cart.
//  4. Edit qty cart (+ click) → total recalculé.
//  5. Cash + tendered > total → change calculé live (clientside, pas d'API).
//  6. Finaliser → createPosTransaction appelé avec args corrects + receipt
//     modal apparaît.
//  7. createPosTransaction renvoie une erreur → toast erreur + cart conservé.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
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
const listPosRegistersMock = vi.fn();
const getPosSessionMock = vi.fn();
const openPosSessionMock = vi.fn();
const scanBarcodeMock = vi.fn();
const createPosTransactionMock = vi.fn();
const getEcommerceProductsMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listPosRegisters: (...a: unknown[]) => listPosRegistersMock(...(a as [])),
  getPosSession: (...a: unknown[]) => getPosSessionMock(...(a as [])),
  openPosSession: (...a: unknown[]) => openPosSessionMock(...(a as [])),
  scanBarcode: (...a: unknown[]) => scanBarcodeMock(...(a as [])),
  createPosTransaction: (...a: unknown[]) =>
    createPosTransactionMock(...(a as [])),
  getEcommerceProducts: (...a: unknown[]) =>
    getEcommerceProductsMock(...(a as [])),
}));

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

vi.mock('../../lib/i18n/number', () => ({
  formatMoneyCents: (cents: number) => `${(cents / 100).toFixed(2)} $`,
}));

vi.mock('../../lib/i18n/datetime', () => ({
  formatDateTime: (iso: string) => `dt:${iso}`,
}));

// POSReceiptPreview : stub minimal qui rend un sentinel quand open=true.
vi.mock('./POSReceiptPreview', () => ({
  POSReceiptPreview: ({ open }: { open?: boolean }) =>
    open ? (
      <div data-testid="receipt-modal-stub" role="dialog">
        receipt
      </div>
    ) : null,
}));

// Button : stub pass-through avec onClick/type/disabled/isLoading + aria-label.
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

// Input : forwardRef pass-through via async factory (peut importer React).
vi.mock('../ui/Input', async () => {
  const React = await import('react');
  interface MockInputProps {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    'aria-label'?: string;
    'data-testid'?: string;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
  }
  const Input = React.forwardRef<HTMLInputElement, MockInputProps>(
    function MockInput(
      {
        id,
        value,
        onChange,
        onKeyDown,
        'aria-label': ariaLabel,
        'data-testid': testId,
        type,
        placeholder,
        disabled,
      },
      ref,
    ) {
      return (
        <input
          ref={ref}
          id={id}
          value={value ?? ''}
          onChange={onChange}
          onKeyDown={onKeyDown}
          aria-label={ariaLabel}
          data-testid={testId}
          type={type || 'text'}
          placeholder={placeholder}
          disabled={disabled}
        />
      );
    },
  );
  return { Input };
});

// Select : stub passthrough avec children options.
vi.mock('../ui/Select', () => ({
  Select: ({
    children,
    value,
    onChange,
    'aria-label': ariaLabel,
    'data-testid': testId,
    disabled,
  }: {
    children?: ReactNode;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    'aria-label'?: string;
    'data-testid'?: string;
    disabled?: boolean;
  }) => (
    <select
      value={value ?? ''}
      onChange={onChange}
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
    >
      {children}
    </select>
  ),
}));

// Icon : stub.
vi.mock('../ui/Icon', () => ({
  Icon: ({ size }: { size?: number | string }) => (
    <span data-testid="icon-stub" data-size={String(size ?? '')} />
  ),
}));

// Skeleton : stub.
vi.mock('../ui/Skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

// EmptyState : stub — rend titre + action.
vi.mock('../ui/EmptyState', () => ({
  EmptyState: ({
    title,
    description,
    action,
  }: {
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
  }) => (
    <div data-testid="empty-state">
      <div data-testid="empty-title">{title}</div>
      <div data-testid="empty-description">{description}</div>
      <div data-testid="empty-action">{action}</div>
    </div>
  ),
}));

// Toast : capture success/error/info.
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastInfoMock = vi.fn();
vi.mock('../ui/Toast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    toast: vi.fn(),
    warning: vi.fn(),
    info: toastInfoMock,
    remove: vi.fn(),
  }),
}));

// Imports APRÈS les mocks.
import { POSTerminal } from './POSTerminal';
import type {
  PosRegister,
  PosSession,
  ScanResult,
  PosTransaction,
} from '../../lib/api';
import type { Product } from '../../lib/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeRegister(over: Partial<PosRegister> = {}): PosRegister {
  return {
    id: over.id ?? 'reg_1',
    client_id: over.client_id ?? 'cli_1',
    name: over.name ?? 'Caisse principale',
    location: over.location ?? 'Magasin Montréal',
    currency: over.currency ?? 'CAD',
    is_active: over.is_active ?? 1,
    default_tax_region: over.default_tax_region ?? 'QC',
    printer_config_json: over.printer_config_json ?? '{}',
    created_at: over.created_at ?? '2026-05-22T10:00:00Z',
    updated_at: over.updated_at ?? '2026-05-22T10:00:00Z',
  };
}

function makeSession(over: Partial<PosSession> = {}): PosSession {
  return {
    id: over.id ?? 'sess_1',
    register_id: over.register_id ?? 'reg_1',
    client_id: over.client_id ?? 'cli_1',
    opened_by: over.opened_by ?? 'user_1',
    opened_at: over.opened_at ?? '2026-05-22T09:00:00Z',
    closed_at: over.closed_at ?? null,
    opening_cash_cents: over.opening_cash_cents ?? 10000,
    closing_cash_cents: over.closing_cash_cents ?? null,
    expected_cash_cents: over.expected_cash_cents ?? null,
    variance_cents: over.variance_cents ?? null,
    status: over.status ?? 'open',
    total_sales_cents: over.total_sales_cents ?? 0,
    total_tax_cents: over.total_tax_cents ?? 0,
    transaction_count: over.transaction_count ?? 0,
    notes: over.notes ?? '',
  };
}

function makeProduct(
  id: string,
  variantId: string,
  title: string,
  basePrice: number,
): Product {
  return {
    id,
    client_id: 'cli_1',
    title,
    slug: id,
    description: '',
    status: 'active',
    product_type: '',
    vendor: '',
    base_price: basePrice,
    currency: 'CAD',
    tax_class: '',
    seo_title: '',
    seo_description: '',
    created_at: '2026-05-22T10:00:00Z',
    updated_at: '2026-05-22T10:00:00Z',
    variants: [
      {
        id: variantId,
        product_id: id,
        sku: `SKU-${variantId}`,
        title: 'Standard',
        price_override: null,
        options_json: '{}',
        barcode: `BC-${variantId}`,
        weight_grams: null,
        position: 0,
        created_at: '2026-05-22T10:00:00Z',
        updated_at: '2026-05-22T10:00:00Z',
      },
    ],
  };
}

function makeScanResult(
  variantId: string,
  productId: string,
  title: string,
  unitCents: number,
): ScanResult {
  return {
    variant: {
      id: variantId,
      product_id: productId,
      title: 'Standard',
      sku: `SKU-${variantId}`,
      barcode: `BC-${variantId}`,
      price_override: null,
    },
    product: { id: productId, title, base_price: unitCents },
    in_stock: true,
    unit_price_cents: unitCents,
  };
}

function makeTransaction(over: Partial<PosTransaction> = {}): PosTransaction {
  return {
    id: over.id ?? 'tx_1',
    session_id: over.session_id ?? 'sess_1',
    order_id: over.order_id ?? 'ord_1',
    payment_method: over.payment_method ?? 'cash',
    amount_cents: over.amount_cents ?? 0,
    tendered_cents: over.tendered_cents ?? null,
    change_due_cents: over.change_due_cents ?? 0,
    card_terminal_ref: over.card_terminal_ref ?? null,
    receipt_url: over.receipt_url ?? null,
    voided_at: over.voided_at ?? null,
    void_reason: over.void_reason ?? null,
    cashier_id: over.cashier_id ?? null,
    created_at: over.created_at ?? '2026-05-22T11:00:00Z',
  };
}

// ── Helpers test ────────────────────────────────────────────────────────────

function primeWithActiveSession(): void {
  window.localStorage.setItem('pos.active_session_id', 'sess_1');
  listPosRegistersMock.mockResolvedValue({ data: [makeRegister()] });
  getPosSessionMock.mockResolvedValue({ data: makeSession() });
  getEcommerceProductsMock.mockResolvedValue({
    data: [
      makeProduct('prod_1', 'var_1', 'Café latte', 500),
      makeProduct('prod_2', 'var_2', 'Croissant beurre', 350),
    ],
  });
}

// Attend la fin du loading initial (Skeleton disparaît, terminal apparaît).
async function waitForTerminalReady() {
  await waitFor(() => {
    expect(screen.getByTestId('pos-terminal')).toBeInTheDocument();
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<POSTerminal /> — Sprint 37 B1', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('1. pas de session → CTA "Ouvrir session" visible', async () => {
    listPosRegistersMock.mockResolvedValue({ data: [makeRegister()] });
    // getPosSession ne devrait pas être appelé (pas d'id en localStorage).

    render(<POSTerminal />);

    await waitFor(() => {
      expect(screen.getByTestId('pos-no-session')).toBeInTheDocument();
    });

    // Le bouton "Ouvrir session" est rendu via aria-label = clé i18n brute.
    expect(
      screen.getByRole('button', { name: 'pos.open_session' }),
    ).toBeInTheDocument();
    expect(getPosSessionMock).not.toHaveBeenCalled();
  });

  it('2. session active → header + grille catalogue + cart vide visibles', async () => {
    primeWithActiveSession();
    render(<POSTerminal />);
    await waitForTerminalReady();

    // Header session
    expect(screen.getByTestId('pos-session-header')).toBeInTheDocument();
    expect(screen.getByTestId('pos-session-status')).toHaveTextContent(
      'pos.session_open',
    );
    expect(screen.getByText('Caisse principale')).toBeInTheDocument();

    // Catalogue : 2 produits chargés via getEcommerceProducts.
    await waitFor(() => {
      expect(screen.getByTestId('pos-product-var_1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pos-product-var_2')).toBeInTheDocument();

    // Cart vide : total = 0,00 $.
    expect(screen.getByTestId('pos-cart-total')).toHaveTextContent('0.00 $');

    // Finaliser disabled (cart vide).
    expect(screen.getByTestId('pos-finalize-btn')).toBeDisabled();
  });

  it('3. scan barcode (Enter) → scanBarcode appelé + product ajouté au cart', async () => {
    primeWithActiveSession();
    scanBarcodeMock.mockResolvedValue({
      data: makeScanResult('var_99', 'prod_99', 'Article scanné', 1250),
    });

    render(<POSTerminal />);
    await waitForTerminalReady();

    const scanInput = screen.getByTestId('pos-scan-input') as HTMLInputElement;
    fireEvent.change(scanInput, { target: { value: 'BC-var_99' } });
    fireEvent.keyDown(scanInput, { key: 'Enter' });

    await waitFor(() => {
      expect(scanBarcodeMock).toHaveBeenCalledWith('BC-var_99');
    });

    // Ligne créée + total = 12,50 $.
    await waitFor(() => {
      expect(screen.getByTestId('pos-cart-line-var_99')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pos-cart-total')).toHaveTextContent('12.50 $');
    expect(screen.getByTestId('pos-cart-qty-var_99')).toHaveTextContent('1');
  });

  it('4. inc qty cart → total recalculé live', async () => {
    primeWithActiveSession();

    render(<POSTerminal />);
    await waitForTerminalReady();

    // Click un produit du catalogue (5,00 $).
    await waitFor(() => {
      expect(screen.getByTestId('pos-product-var_1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pos-product-var_1'));

    expect(screen.getByTestId('pos-cart-total')).toHaveTextContent('5.00 $');

    // Inc deux fois → qty=3 → total 15,00 $.
    fireEvent.click(screen.getByTestId('pos-cart-inc-var_1'));
    fireEvent.click(screen.getByTestId('pos-cart-inc-var_1'));

    expect(screen.getByTestId('pos-cart-qty-var_1')).toHaveTextContent('3');
    expect(screen.getByTestId('pos-cart-total')).toHaveTextContent('15.00 $');
    expect(screen.getByTestId('pos-cart-line-total-var_1')).toHaveTextContent(
      '15.00 $',
    );
  });

  it('5. cash + tendered > total → change calculé live clientside', async () => {
    primeWithActiveSession();

    render(<POSTerminal />);
    await waitForTerminalReady();

    // Ajoute 1 produit à 5,00 $.
    await waitFor(() => {
      expect(screen.getByTestId('pos-product-var_1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pos-product-var_1'));

    // Method = cash par défaut. Tendered = 10,00 → change = 5,00.
    const tendered = screen.getByTestId(
      'pos-tendered-input',
    ) as HTMLInputElement;
    fireEvent.change(tendered, { target: { value: '10' } });

    expect(screen.getByTestId('pos-change-due')).toHaveTextContent('5.00 $');

    // Tendered insuffisant → change = 0 + Finaliser disabled.
    fireEvent.change(tendered, { target: { value: '3' } });
    expect(screen.getByTestId('pos-change-due')).toHaveTextContent('0.00 $');
    expect(screen.getByTestId('pos-finalize-btn')).toBeDisabled();
  });

  it('6. finalize → createPosTransaction(args) + receipt modal apparaît', async () => {
    primeWithActiveSession();
    createPosTransactionMock.mockResolvedValue({ data: makeTransaction() });

    render(<POSTerminal />);
    await waitForTerminalReady();

    // Ajoute 1 produit (5,00 $).
    await waitFor(() => {
      expect(screen.getByTestId('pos-product-var_1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pos-product-var_1'));

    // Tendered 10,00.
    fireEvent.change(screen.getByTestId('pos-tendered-input'), {
      target: { value: '10' },
    });

    // Finalize.
    fireEvent.click(screen.getByTestId('pos-finalize-btn'));

    await waitFor(() => {
      expect(createPosTransactionMock).toHaveBeenCalledTimes(1);
    });

    // Vérifie args.
    const callArgs = (createPosTransactionMock as Mock).mock.calls[0]?.[0] as {
      session_id: string;
      cart: Array<{ variant_id: string; quantity: number }>;
      payment: {
        method: string;
        amount_cents: number;
        tendered_cents?: number;
      };
    };
    expect(callArgs.session_id).toBe('sess_1');
    expect(callArgs.cart).toEqual([{ variant_id: 'var_1', quantity: 1 }]);
    expect(callArgs.payment.method).toBe('cash');
    expect(callArgs.payment.amount_cents).toBe(500);
    expect(callArgs.payment.tendered_cents).toBe(1000);

    // Receipt modal apparaît.
    await waitFor(() => {
      expect(screen.getByTestId('receipt-modal-stub')).toBeInTheDocument();
    });

    // Cart vidé après vente.
    expect(screen.getByTestId('pos-cart-total')).toHaveTextContent('0.00 $');
  });

  it('7. createPosTransaction error → toast erreur + cart conservé', async () => {
    primeWithActiveSession();
    createPosTransactionMock.mockResolvedValue({ error: 'Boom' });

    render(<POSTerminal />);
    await waitForTerminalReady();

    await waitFor(() => {
      expect(screen.getByTestId('pos-product-var_1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pos-product-var_1'));
    fireEvent.change(screen.getByTestId('pos-tendered-input'), {
      target: { value: '10' },
    });

    fireEvent.click(screen.getByTestId('pos-finalize-btn'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Boom');
    });

    // Cart conservé (pas de wipe sur erreur).
    expect(screen.getByTestId('pos-cart-line-var_1')).toBeInTheDocument();
    expect(screen.queryByTestId('receipt-modal-stub')).not.toBeInTheDocument();
  });
});
