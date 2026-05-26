// @vitest-environment jsdom
// ── GiftCardManager.test — Sprint 38 (Agent B1) ─────────────────────────────
// Couvre :
//  1. Mount → getGiftCards appelé + 2 cartes affichées.
//  2. Click "Émettre" → modal apparaît.
//  3. Submit avec amount 50$ → issueGiftCard appelé avec 5000 cents.
//  4. Click "Copier" code → navigator.clipboard.writeText appelé.
//  5. Click "Annuler" + confirm → voidGiftCard appelé.
//  6. Liste vide → empty state visible.

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
import type { ReactNode } from 'react';

// ── Mocks api ───────────────────────────────────────────────────────────────
const getGiftCardsMock = vi.fn();
const issueGiftCardMock = vi.fn();
const voidGiftCardMock = vi.fn();
const refundToGiftCardMock = vi.fn();
const getGiftCardTransactionsMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getGiftCards: (...a: unknown[]) => getGiftCardsMock(...(a as [])),
  issueGiftCard: (...a: unknown[]) => issueGiftCardMock(...(a as [])),
  voidGiftCard: (...a: unknown[]) => voidGiftCardMock(...(a as [])),
  refundToGiftCard: (...a: unknown[]) => refundToGiftCardMock(...(a as [])),
  getGiftCardTransactions: (...a: unknown[]) =>
    getGiftCardTransactionsMock(...(a as [])),
}));

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

vi.mock('../../lib/i18n/datetime', () => ({
  formatRelativeTime: (_d: unknown, _l: string) => 'il y a 2 h',
}));

vi.mock('../../lib/i18n/number', () => ({
  formatMoneyCents: (cents: number, _l: string, _c?: string) =>
    `$${(cents / 100).toFixed(2)}`,
}));

// Modal : stub minimal — rend les children quand open=true.
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

// SlidePanel : stub minimal — rend children quand open=true.
vi.mock('../ui/SlidePanel', () => ({
  SlidePanel: ({
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
      <div data-testid="slidepanel-stub" role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
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
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    type?: 'button' | 'submit' | 'reset';
    'aria-label'?: string;
  }) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      data-loading={isLoading ? 'true' : 'false'}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
}));

// Input : passe id + onChange.
vi.mock('../ui/Input', () => ({
  Input: ({
    id,
    value,
    onChange,
    'aria-label': ariaLabel,
    required,
    type,
  }: {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    'aria-label'?: string;
    required?: boolean;
    type?: string;
  }) => (
    <input
      id={id}
      type={type ?? 'text'}
      value={value ?? ''}
      onChange={onChange}
      aria-label={ariaLabel}
      required={required}
      data-testid={`input-${id ?? 'unknown'}`}
    />
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

// useConfirm : auto-confirm true par défaut (overridable par test).
const confirmMock = vi.fn(() => Promise.resolve(true));
vi.mock('../ui/ConfirmDialog', () => ({
  useConfirm: () => confirmMock,
}));

// Imports APRÈS les mocks.
import { GiftCardManager } from './GiftCardManager';
import type { GiftCard } from '../../lib/api';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeCard(over: Partial<GiftCard> = {}): GiftCard {
  return {
    id: over.id ?? 'gc_1',
    code: over.code ?? 'AAAABBBBCCCC1234',
    client_id: over.client_id ?? 'cli_1',
    initial_value_cents: over.initial_value_cents ?? 10000,
    current_balance_cents: over.current_balance_cents ?? 7500,
    currency: over.currency ?? 'CAD',
    expires_at: over.expires_at ?? '2027-01-01T00:00:00Z',
    issued_to_customer_id: over.issued_to_customer_id ?? null,
    issued_to_email: over.issued_to_email ?? 'alice@example.com',
    status: over.status ?? 'active',
    notes: over.notes ?? null,
    created_at: over.created_at ?? '2026-05-22T10:00:00Z',
  };
}

function twoCards(): GiftCard[] {
  return [
    makeCard({ id: 'gc_1', code: 'AAAABBBBCCCC1234', status: 'active' }),
    makeCard({
      id: 'gc_2',
      code: 'XXXXYYYYZZZZ5678',
      status: 'redeemed',
      issued_to_email: 'bob@example.com',
    }),
  ];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<GiftCardManager /> — Sprint 38 B1', () => {
  beforeEach(() => {
    getGiftCardsMock.mockResolvedValue({ data: twoCards() });
    issueGiftCardMock.mockResolvedValue({
      data: makeCard({ id: 'gc_new' }),
    });
    voidGiftCardMock.mockResolvedValue({
      data: makeCard({ status: 'voided' }),
    });
    refundToGiftCardMock.mockResolvedValue({ data: { id: 'tx_1' } });
    getGiftCardTransactionsMock.mockResolvedValue({ data: [] });
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. mount → getGiftCards appelé + 2 cartes rendues', async () => {
    render(<GiftCardManager />);
    await waitFor(() => expect(getGiftCardsMock).toHaveBeenCalledTimes(1));

    expect(await screen.findByTestId('giftcard-row-gc_1')).toBeInTheDocument();
    expect(screen.getByTestId('giftcard-row-gc_2')).toBeInTheDocument();
    // Masked code visible (4 derniers caractères)
    expect(screen.getByTestId('giftcard-code-gc_1').textContent).toContain(
      '1234',
    );
    expect(screen.getByTestId('giftcard-code-gc_1').textContent).toContain(
      'X',
    );
    expect(screen.getByTestId('giftcard-code-gc_1').textContent).not.toContain(
      'AAAA',
    );
  });

  it('2. click "Émettre" → modal apparaît', async () => {
    render(<GiftCardManager />);
    await screen.findByTestId('giftcard-row-gc_1');

    const issueButtons = screen.getAllByRole('button', {
      name: 'giftCards.issue.cta',
    });
    const firstIssue = issueButtons[0];
    if (!firstIssue) throw new Error('issue button not found');
    fireEvent.click(firstIssue);

    expect(await screen.findByTestId('modal-stub')).toBeInTheDocument();
    expect(screen.getByTestId('modal-title')).toHaveTextContent(
      'giftCards.issue.cta',
    );
  });

  it('3. submit avec amount 50$ → issueGiftCard appelé avec 5000 cents', async () => {
    render(<GiftCardManager />);
    await screen.findByTestId('giftcard-row-gc_1');

    const issueBtn = screen.getAllByRole('button', {
      name: 'giftCards.issue.cta',
    })[0];
    if (!issueBtn) throw new Error('issue button not found');
    fireEvent.click(issueBtn);
    const modal = await screen.findByTestId('modal-stub');

    // Saisit le montant en dollars
    const amountInput = within(modal).getByTestId('input-giftcard-amount');
    fireEvent.change(amountInput, { target: { value: '50' } });

    // Saisit email + expires
    const emailInput = within(modal).getByTestId('input-giftcard-email');
    fireEvent.change(emailInput, { target: { value: 'gift@example.com' } });

    const expInput = within(modal).getByTestId('input-giftcard-expires');
    fireEvent.change(expInput, { target: { value: '2027-12-31' } });

    // Submit
    const submitBtn = within(modal).getAllByRole('button', {
      name: 'giftCards.issue.cta',
    });
    // Le bouton de submit DANS le form (le dernier rendu — le bouton header ne porte pas l'aria-label dans le modal scope)
    const formSubmit = submitBtn[submitBtn.length - 1];
    if (!formSubmit) throw new Error('submit button not found');
    fireEvent.click(formSubmit);

    await waitFor(() => {
      expect(issueGiftCardMock).toHaveBeenCalledTimes(1);
    });
    expect(issueGiftCardMock).toHaveBeenCalledWith({
      initial_value_cents: 5000,
      issued_to_email: 'gift@example.com',
      expires_at: '2027-12-31',
    });
    // Toast success
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('giftCards.issue.success');
    });
  });

  it('4. click "Copier" → navigator.clipboard.writeText appelé avec le vrai code', async () => {
    const writeTextMock = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: writeTextMock },
    });

    render(<GiftCardManager />);
    await screen.findByTestId('giftcard-row-gc_1');

    const copyBtn = screen.getByTestId('giftcard-copy-gc_1');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('AAAABBBBCCCC1234');
    });
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalled();
    });
  });

  it('5. click "Annuler" + confirm → voidGiftCard appelé', async () => {
    render(<GiftCardManager />);
    const row = await screen.findByTestId('giftcard-row-gc_1');

    const voidBtn = within(row).getByRole('button', {
      name: /giftCards\.voided\.tag/,
    });
    fireEvent.click(voidBtn);

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(voidGiftCardMock).toHaveBeenCalledWith('gc_1');
    });
    // Refresh appelé après void
    await waitFor(() => {
      expect(getGiftCardsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('5b. void confirm cancel → voidGiftCard PAS appelé', async () => {
    confirmMock.mockResolvedValueOnce(false);
    render(<GiftCardManager />);
    const row = await screen.findByTestId('giftcard-row-gc_1');
    const voidBtn = within(row).getByRole('button', {
      name: /giftCards\.voided\.tag/,
    });
    fireEvent.click(voidBtn);

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(voidGiftCardMock).not.toHaveBeenCalled();
  });

  it('6. liste vide → empty state visible + bouton issue dans empty state', async () => {
    getGiftCardsMock.mockResolvedValue({ data: [] });

    render(<GiftCardManager />);
    await waitFor(() => expect(getGiftCardsMock).toHaveBeenCalled());

    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('empty-title')).toHaveTextContent(
      'giftCards.empty',
    );
    const emptyAction = screen.getByTestId('empty-action');
    expect(
      within(emptyAction).getByRole('button', {
        name: /giftCards\.issue\.cta/,
      }),
    ).toBeInTheDocument();
  });

  it('7. erreur réseau au mount → toast erreur + empty state', async () => {
    getGiftCardsMock.mockResolvedValue({ error: 'Network down' });

    render(<GiftCardManager />);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Network down');
    });
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
  });

  it('8. carte status=redeemed → pas de bouton Annuler', async () => {
    render(<GiftCardManager />);
    const row2 = await screen.findByTestId('giftcard-row-gc_2'); // redeemed
    expect(
      within(row2).queryByRole('button', { name: /giftCards\.voided\.tag/ }),
    ).toBeNull();
  });
});
