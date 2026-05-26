// @vitest-environment jsdom
// ── POSSessionManager.test — Sprint 37 (Agent B2) ───────────────────────────
// Couvre :
//  1. Mode 'open' render → loading puis registers actifs filtrés + 1er sélectionné.
//  2. Mode 'open' submit → openPosSession appelé avec register_id + opening_cash_cents
//     + toast success + onSessionChanged + onClose.
//  3. Mode 'open' erreur API → toast error + reste ouvert.
//  4. Mode 'close' render → info session + variance live (closing - expected).
//  5. Mode 'close' variance level badge → ok / low / high (data-level + style).
//  6. Mode 'close' submit → confirm puis closePosSession appelé + toast + onClose.
//  7. Mode 'close' annuler confirm → closePosSession NON appelé.
//  8. Mode 'open' aucun register actif → message + bouton désactivé.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import type { ChangeEvent, ReactNode } from 'react';

// ── Mocks api ────────────────────────────────────────────────────────────────

const listPosRegistersMock = vi.fn();
const openPosSessionMock = vi.fn();
const closePosSessionMock = vi.fn();
const getPosSessionMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listPosRegisters: (...a: unknown[]) => listPosRegistersMock(...(a as [])),
  openPosSession: (...a: unknown[]) => openPosSessionMock(...(a as [])),
  closePosSession: (...a: unknown[]) => closePosSessionMock(...(a as [])),
  getPosSession: (...a: unknown[]) => getPosSessionMock(...(a as [])),
}));

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../lib/i18n', () => ({
  t: (k: string) => k,
}));

// Modal : stub minimal qui rend children quand open=true.
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

// Button : stub pass-through (préserve data-testid).
vi.mock('../ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    variant,
    type,
    'data-testid': testId,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    variant?: string;
    type?: 'button' | 'submit' | 'reset';
    'data-testid'?: string;
  }) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      data-variant={variant ?? 'primary'}
      data-loading={isLoading ? 'true' : 'false'}
      data-testid={testId}
    >
      {children}
    </button>
  ),
}));

// Input : stub minimal qui expose label + value/onChange + aria-label.
vi.mock('../ui/Input', () => ({
  Input: ({
    label,
    value,
    onChange,
    'aria-label': ariaLabel,
    type,
    disabled,
  }: {
    label?: ReactNode;
    value?: string | number;
    onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
    'aria-label'?: string;
    type?: string;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <input
        aria-label={ariaLabel}
        type={type ?? 'text'}
        value={value ?? ''}
        onChange={onChange}
        disabled={disabled}
      />
    </label>
  ),
}));

// Select : stub native select avec label.
vi.mock('../ui/Select', () => ({
  Select: ({
    label,
    value,
    onChange,
    'aria-label': ariaLabel,
    children,
    disabled,
  }: {
    label?: ReactNode;
    value?: string;
    onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
    'aria-label'?: string;
    children?: ReactNode;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select
        aria-label={ariaLabel}
        value={value ?? ''}
        onChange={onChange}
        disabled={disabled}
      >
        {children}
      </select>
    </label>
  ),
}));

// Textarea : stub minimal.
vi.mock('../ui/Textarea', () => ({
  Textarea: ({
    label,
    value,
    onChange,
    'aria-label': ariaLabel,
    disabled,
  }: {
    label?: ReactNode;
    value?: string;
    onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    'aria-label'?: string;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <textarea
        aria-label={ariaLabel}
        value={value ?? ''}
        onChange={onChange}
        disabled={disabled}
      />
    </label>
  ),
}));

// Icon : stub.
vi.mock('../ui/Icon', () => ({
  Icon: ({ size }: { size?: number }) => (
    <span data-testid="icon-stub" data-size={size} />
  ),
}));

// Toast : capture success/error/warning.
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastWarningMock = vi.fn();
vi.mock('../ui/Toast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: toastWarningMock,
    toast: vi.fn(),
    info: vi.fn(),
    remove: vi.fn(),
  }),
}));

// useConfirm : stub configurable (par défaut résout true).
const confirmMock = vi.fn().mockResolvedValue(true);
vi.mock('../ui/ConfirmDialog', () => ({
  useConfirm: () => confirmMock,
}));

// Import APRÈS les mocks.
import { POSSessionManager } from './POSSessionManager';
import type { PosRegister, PosSession } from '../../lib/api';

// ── Fixtures ────────────────────────────────────────────────────────────────

const REG_ACTIVE_A: PosRegister = {
  id: 'reg_a',
  client_id: 'client_1',
  name: 'Caisse A',
  location: 'Boutique',
  currency: 'CAD',
  is_active: 1,
  default_tax_region: 'QC',
  printer_config_json: '{}',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const REG_ACTIVE_B: PosRegister = {
  ...REG_ACTIVE_A,
  id: 'reg_b',
  name: 'Caisse B',
};
const REG_INACTIVE: PosRegister = {
  ...REG_ACTIVE_A,
  id: 'reg_off',
  name: 'Caisse hors-service',
  is_active: 0,
};

const SESSION_OPEN: PosSession = {
  id: 'sess_1',
  register_id: 'reg_a',
  client_id: 'client_1',
  opened_by: 'user_1',
  opened_at: '2026-05-24T08:00:00Z',
  closed_at: null,
  opening_cash_cents: 10000, // 100.00 $
  closing_cash_cents: null,
  expected_cash_cents: 25050, // 250.50 $ → variance live calculable
  variance_cents: null,
  status: 'open',
  total_sales_cents: 15050,
  total_tax_cents: 1500,
  transaction_count: 7,
  notes: '',
};

const SESSION_CLOSED_OK: PosSession = {
  ...SESSION_OPEN,
  closed_at: '2026-05-24T18:00:00Z',
  closing_cash_cents: 25050,
  variance_cents: 0,
  status: 'closed',
};

const SESSION_CLOSED_HIGH: PosSession = {
  ...SESSION_OPEN,
  closed_at: '2026-05-24T18:00:00Z',
  closing_cash_cents: 24000,
  variance_cents: -1050, // |1050| > 500 → high
  status: 'closed',
};

const baseOpenProps = {
  open: true,
  onClose: vi.fn(),
  mode: 'open' as const,
  onSessionChanged: vi.fn(),
};

const baseCloseProps = {
  open: true,
  onClose: vi.fn(),
  mode: 'close' as const,
  session: SESSION_OPEN,
  onSessionChanged: vi.fn(),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POSSessionManager', () => {
  beforeEach(() => {
    listPosRegistersMock.mockReset();
    openPosSessionMock.mockReset();
    closePosSessionMock.mockReset();
    getPosSessionMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    toastWarningMock.mockReset();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    baseOpenProps.onClose = vi.fn();
    baseOpenProps.onSessionChanged = vi.fn();
    baseCloseProps.onClose = vi.fn();
    baseCloseProps.onSessionChanged = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Mode 'open' ────────────────────────────────────────────────────────

  it('1. Mode open → load registers actifs + sélectionne le 1er', async () => {
    listPosRegistersMock.mockResolvedValueOnce({
      data: [REG_ACTIVE_A, REG_INACTIVE, REG_ACTIVE_B],
    });

    render(<POSSessionManager {...baseOpenProps} />);

    // Modal titre = open_session
    expect(screen.getByTestId('modal-title')).toHaveTextContent(
      'pos.open_session',
    );

    // Attendre que les registers soient affichés.
    const select = (await screen.findByLabelText(
      'pos.register_select',
    )) as unknown as HTMLSelectElement;
    expect(select).toBeInTheDocument();

    // Seuls les actifs sont dans le select (2 options).
    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveValue('reg_a');
    expect(options[1]).toHaveValue('reg_b');

    // Par défaut le 1er actif est sélectionné.
    expect(select.value).toBe('reg_a');

    // Input opening_cash visible.
    expect(screen.getByLabelText('pos.opening_cash')).toBeInTheDocument();
  });

  it('2. Mode open submit → openPosSession appelé + toast + callbacks', async () => {
    listPosRegistersMock.mockResolvedValueOnce({
      data: [REG_ACTIVE_A, REG_ACTIVE_B],
    });
    openPosSessionMock.mockResolvedValueOnce({
      data: { ...SESSION_OPEN },
    });

    render(<POSSessionManager {...baseOpenProps} />);

    // Attend registers loaded.
    const select = await screen.findByLabelText('pos.register_select');

    // Change register vers B.
    fireEvent.change(select, { target: { value: 'reg_b' } });

    // Set opening cash à 150.50.
    const cashInput = screen.getByLabelText('pos.opening_cash');
    fireEvent.change(cashInput, { target: { value: '150.50' } });

    // Click open_session.
    fireEvent.click(screen.getByTestId('submit-open-session'));

    await waitFor(() => {
      expect(openPosSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(openPosSessionMock).toHaveBeenCalledWith({
      register_id: 'reg_b',
      opening_cash_cents: 15050,
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('pos.session_open');
    expect(baseOpenProps.onSessionChanged).toHaveBeenCalledTimes(1);
    expect(baseOpenProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('3. Mode open erreur API → toast error + reste ouvert', async () => {
    listPosRegistersMock.mockResolvedValueOnce({ data: [REG_ACTIVE_A] });
    openPosSessionMock.mockResolvedValueOnce({
      error: 'caisse déjà ouverte',
    });

    render(<POSSessionManager {...baseOpenProps} />);
    await screen.findByLabelText('pos.register_select');

    fireEvent.click(screen.getByTestId('submit-open-session'));

    await waitFor(() => {
      expect(openPosSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(toastErrorMock).toHaveBeenCalledWith('caisse déjà ouverte');
    expect(baseOpenProps.onClose).not.toHaveBeenCalled();
    expect(baseOpenProps.onSessionChanged).not.toHaveBeenCalled();
    // Message d'erreur affiché.
    expect(screen.getByText('caisse déjà ouverte')).toBeInTheDocument();
  });

  it('8. Mode open sans register actif → message + bouton disabled', async () => {
    listPosRegistersMock.mockResolvedValueOnce({ data: [REG_INACTIVE] });

    render(<POSSessionManager {...baseOpenProps} />);

    await waitFor(() => {
      expect(
        screen.getByText('pos.error.register_inactive'),
      ).toBeInTheDocument();
    });

    const submitBtn = screen.getByTestId('submit-open-session');
    expect(submitBtn).toBeDisabled();
  });

  // ── Mode 'close' ───────────────────────────────────────────────────────

  it('4. Mode close → info session + variance live calculée', async () => {
    getPosSessionMock.mockResolvedValueOnce({ data: SESSION_OPEN });

    render(<POSSessionManager {...baseCloseProps} />);

    expect(screen.getByTestId('modal-title')).toHaveTextContent(
      'pos.close_session',
    );

    // Info session : expected_cash visible (250.50 $).
    expect(screen.getByTestId('session-expected-cash')).toHaveTextContent(
      /250\.50/,
    );
    // opening_cash visible (100.00 $).
    expect(screen.getByTestId('session-opening-cash')).toHaveTextContent(
      /100\.00/,
    );
    // tx_count visible.
    expect(screen.getByTestId('session-tx-count')).toHaveTextContent('7');

    // Input closing_cash visible et par défaut 0.00 → variance = -250.50.
    const closingInput = screen.getByLabelText(
      'pos.closing_cash',
    ) as HTMLInputElement;
    expect(closingInput).toBeInTheDocument();

    // Variance live (default closing 0 → expected 250.50 → variance -250.50).
    const badge = screen.getByTestId('variance-badge');
    expect(badge).toHaveAttribute('data-level', 'high');
    expect(badge.textContent).toMatch(/-250\.50/);

    // Tape closing 250.50 → variance 0 → level ok.
    fireEvent.change(closingInput, { target: { value: '250.50' } });
    await waitFor(() => {
      const b2 = screen.getByTestId('variance-badge');
      expect(b2).toHaveAttribute('data-level', 'ok');
    });
  });

  it('5. Mode close variance levels (ok / low / high)', async () => {
    getPosSessionMock.mockResolvedValue({ data: SESSION_OPEN });

    render(<POSSessionManager {...baseCloseProps} />);
    const closingInput = (await screen.findByLabelText(
      'pos.closing_cash',
    )) as HTMLInputElement;

    // expected = 250.50 $ = 25050c. variance = closing - expected.
    //   closing 250.50 → 0c → ok
    fireEvent.change(closingInput, { target: { value: '250.50' } });
    await waitFor(() => {
      expect(screen.getByTestId('variance-badge')).toHaveAttribute(
        'data-level',
        'ok',
      );
    });

    //   closing 253.50 → +300c (|v| ≤ 500c) → low
    fireEvent.change(closingInput, { target: { value: '253.50' } });
    await waitFor(() => {
      expect(screen.getByTestId('variance-badge')).toHaveAttribute(
        'data-level',
        'low',
      );
    });

    //   closing 200.00 → -5050c (> 500c) → high
    fireEvent.change(closingInput, { target: { value: '200.00' } });
    await waitFor(() => {
      expect(screen.getByTestId('variance-badge')).toHaveAttribute(
        'data-level',
        'high',
      );
    });
  });

  it('6. Mode close submit → confirm + closePosSession + toast + callbacks', async () => {
    getPosSessionMock.mockResolvedValueOnce({ data: SESSION_OPEN });
    closePosSessionMock.mockResolvedValueOnce({ data: SESSION_CLOSED_OK });
    confirmMock.mockResolvedValueOnce(true);

    render(<POSSessionManager {...baseCloseProps} />);

    const closingInput = await screen.findByLabelText('pos.closing_cash');
    fireEvent.change(closingInput, { target: { value: '250.50' } });

    fireEvent.click(screen.getByTestId('submit-close-session'));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(closePosSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(closePosSessionMock).toHaveBeenCalledWith('sess_1', {
      closing_cash_cents: 25050,
      notes: undefined,
    });
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(baseCloseProps.onSessionChanged).toHaveBeenCalledTimes(1);
    expect(baseCloseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('6bis. Mode close variance HIGH au close → toast warning au lieu de success', async () => {
    getPosSessionMock.mockResolvedValueOnce({ data: SESSION_OPEN });
    closePosSessionMock.mockResolvedValueOnce({ data: SESSION_CLOSED_HIGH });
    confirmMock.mockResolvedValueOnce(true);

    render(<POSSessionManager {...baseCloseProps} />);
    const closingInput = await screen.findByLabelText('pos.closing_cash');
    fireEvent.change(closingInput, { target: { value: '240.00' } });

    fireEvent.click(screen.getByTestId('submit-close-session'));

    await waitFor(() => {
      expect(closePosSessionMock).toHaveBeenCalledTimes(1);
    });
    // Warning car variance_cents = -1050 → high.
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('7. Mode close annuler confirm → closePosSession NON appelé', async () => {
    getPosSessionMock.mockResolvedValueOnce({ data: SESSION_OPEN });
    confirmMock.mockResolvedValueOnce(false);

    render(<POSSessionManager {...baseCloseProps} />);
    await screen.findByLabelText('pos.closing_cash');

    fireEvent.click(screen.getByTestId('submit-close-session'));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(1);
    });
    expect(closePosSessionMock).not.toHaveBeenCalled();
    expect(baseCloseProps.onClose).not.toHaveBeenCalled();
    expect(baseCloseProps.onSessionChanged).not.toHaveBeenCalled();
  });

  it('Annuler bouton Annuler → onClose appelé', async () => {
    listPosRegistersMock.mockResolvedValueOnce({ data: [REG_ACTIVE_A] });

    render(<POSSessionManager {...baseOpenProps} />);
    await screen.findByLabelText('pos.register_select');

    // Trouve le bouton action.cancel (button stub, pas closeLabel modal).
    const cancelBtn = screen
      .getAllByText('action.cancel')
      .find((el) => el.tagName === 'BUTTON');
    expect(cancelBtn).toBeDefined();
    fireEvent.click(cancelBtn!);

    expect(baseOpenProps.onClose).toHaveBeenCalledTimes(1);
    expect(openPosSessionMock).not.toHaveBeenCalled();
  });
});
