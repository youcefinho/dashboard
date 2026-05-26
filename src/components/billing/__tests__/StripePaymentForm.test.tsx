// @vitest-environment jsdom
// ── StripePaymentForm tests — Sprint 31 (Agent C1) ───────────────────────────
// Mocks both @stripe/stripe-js (loadStripe singleton) and @stripe/react-stripe-js
// (Elements provider + hooks + CardElement + PaymentRequestButtonElement).
//
// Coverage :
//   1. Renders form (CardElement + submit button)
//   2. Submit with stripe=null → no-op (button disabled)
//   3. Submit → confirmCardSetup called with card element + empty clientSecret arg
//   4. onSuccess called with paymentMethodId on successful confirm
//   5. onError called when Stripe returns error
//   6. PaymentRequestButton appears when amount provided and canMakePayment=true
//   7. PaymentRequestButton skipped when amount missing
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react';

// ── Stripe SDK mocks ────────────────────────────────────────────────────────

const confirmCardSetupMock = vi.fn();
const paymentRequestCanMakePaymentMock = vi.fn();
const paymentRequestOnMock = vi.fn();
const paymentRequestFactoryMock = vi.fn(() => ({
  canMakePayment: paymentRequestCanMakePaymentMock,
  on: paymentRequestOnMock,
}));

const useStripeMock = vi.fn();
const useElementsMock = vi.fn();

vi.mock('@stripe/react-stripe-js', () => ({
  useStripe: () => useStripeMock(),
  useElements: () => useElementsMock(),
  CardElement: (props: Record<string, unknown>) => (
    <div data-testid="mock-card-element" {...props} />
  ),
  PaymentRequestButtonElement: (props: Record<string, unknown>) => (
    <div data-testid="mock-payment-request-button" {...props} />
  ),
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}));

// Imports after mocks
import { StripePaymentForm } from '../StripePaymentForm';
import { t } from '@/lib/i18n';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStripe(overrides: Record<string, unknown> = {}) {
  return {
    confirmCardSetup: confirmCardSetupMock,
    paymentRequest: paymentRequestFactoryMock,
    ...overrides,
  };
}

function makeElements(cardEl: unknown = { __mock: 'card' }) {
  return {
    getElement: vi.fn(() => cardEl),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('<StripePaymentForm /> — Sprint 31 (Agent C1)', () => {
  beforeEach(() => {
    confirmCardSetupMock.mockReset();
    paymentRequestCanMakePaymentMock.mockReset();
    paymentRequestOnMock.mockReset();
    paymentRequestFactoryMock.mockClear();
    useStripeMock.mockReset();
    useElementsMock.mockReset();

    // Default : Stripe loaded, no Apple/Google Pay support
    paymentRequestCanMakePaymentMock.mockResolvedValue(null);
    useStripeMock.mockReturnValue(makeStripe());
    useElementsMock.mockReturnValue(makeElements());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. renders CardElement + submit button', () => {
    render(
      <StripePaymentForm onSuccess={vi.fn()} onError={vi.fn()} />,
    );
    expect(screen.getByTestId('mock-card-element')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: new RegExp(t('billing.real.payment_method.add'), 'i') }),
    ).toBeInTheDocument();
  });

  it('2. submit button disabled when stripe=null', () => {
    useStripeMock.mockReturnValue(null);
    render(<StripePaymentForm onSuccess={vi.fn()} onError={vi.fn()} />);
    const btn = screen.getByRole('button', {
      name: new RegExp(t('billing.real.payment_method.add'), 'i'),
    });
    expect(btn).toBeDisabled();
  });

  it('3. submit form → confirmCardSetup called with empty clientSecret + card element', async () => {
    const cardEl = { __mock: 'card-elem' };
    useElementsMock.mockReturnValue(makeElements(cardEl));
    confirmCardSetupMock.mockResolvedValue({
      setupIntent: { payment_method: 'pm_test_123' },
      error: null,
    });

    const onSuccess = vi.fn();
    const onError = vi.fn();
    render(<StripePaymentForm onSuccess={onSuccess} onError={onError} />);

    const form = screen.getByTestId('mock-card-element').closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(confirmCardSetupMock).toHaveBeenCalledTimes(1);
    });
    expect(confirmCardSetupMock).toHaveBeenCalledWith('', {
      payment_method: { card: cardEl },
    });
  });

  it('4. onSuccess called with paymentMethodId on successful confirm', async () => {
    confirmCardSetupMock.mockResolvedValue({
      setupIntent: { payment_method: 'pm_test_abc' },
      error: null,
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();
    render(<StripePaymentForm onSuccess={onSuccess} onError={onError} />);

    const form = screen.getByTestId('mock-card-element').closest('form');
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('pm_test_abc');
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('4b. onSuccess extracts id when payment_method is an object', async () => {
    confirmCardSetupMock.mockResolvedValue({
      setupIntent: { payment_method: { id: 'pm_object_xyz' } },
      error: null,
    });
    const onSuccess = vi.fn();
    render(<StripePaymentForm onSuccess={onSuccess} onError={vi.fn()} />);
    const form = screen.getByTestId('mock-card-element').closest('form');
    fireEvent.submit(form as HTMLFormElement);
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('pm_object_xyz');
    });
  });

  it('5. onError called when Stripe returns error', async () => {
    confirmCardSetupMock.mockResolvedValue({
      setupIntent: null,
      error: { message: 'Your card was declined.' },
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();
    render(<StripePaymentForm onSuccess={onSuccess} onError={onError} />);

    const form = screen.getByTestId('mock-card-element').closest('form');
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    const errArg = onError.mock.calls[0]?.[0] as Error;
    expect(errArg).toBeInstanceOf(Error);
    expect(errArg.message).toBe('Your card was declined.');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('5b. onError when card element missing', async () => {
    useElementsMock.mockReturnValue(makeElements(null));
    const onError = vi.fn();
    render(<StripePaymentForm onSuccess={vi.fn()} onError={onError} />);
    const form = screen.getByTestId('mock-card-element').closest('form');
    fireEvent.submit(form as HTMLFormElement);
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
    expect(confirmCardSetupMock).not.toHaveBeenCalled();
  });

  it('6. PaymentRequestButton shown when amount provided + canMakePayment truthy', async () => {
    paymentRequestCanMakePaymentMock.mockResolvedValue({ applePay: true });
    render(
      <StripePaymentForm
        amount={4900}
        currency="CAD"
        onSuccess={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('mock-payment-request-button')).toBeInTheDocument();
    });
    expect(paymentRequestFactoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        country: 'CA',
        currency: 'cad',
        total: { label: 'Intralys', amount: 4900 },
      }),
    );
  });

  it('7. PaymentRequestButton skipped when amount missing', () => {
    render(<StripePaymentForm onSuccess={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByTestId('mock-payment-request-button')).not.toBeInTheDocument();
    expect(paymentRequestFactoryMock).not.toHaveBeenCalled();
  });

  it('7b. PaymentRequestButton skipped when canMakePayment returns null', async () => {
    paymentRequestCanMakePaymentMock.mockResolvedValue(null);
    render(
      <StripePaymentForm amount={1000} onSuccess={vi.fn()} onError={vi.fn()} />,
    );
    // Give the effect a tick
    await waitFor(() => {
      expect(paymentRequestCanMakePaymentMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('mock-payment-request-button')).not.toBeInTheDocument();
  });
});
