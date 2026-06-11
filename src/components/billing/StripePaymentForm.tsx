// ── StripePaymentForm — Sprint 31 (Agent C1) ─────────────────────────────────
// Card collection form using Stripe Elements + optional Payment Request Button
// (Apple Pay / Google Pay).
//
// Sprint 31 target = SetupIntent flow (attach card to library for later use)
// — `clientSecret` is provided via parent <StripeElementsProvider>, Stripe
// Elements reads it from the Elements context automatically when we pass
// `undefined` as first arg of confirmCardSetup (lib v2.x+).
//
// Two payment paths :
//   1. Apple Pay / Google Pay — appears only if `amount` is provided AND
//      canMakePayment() returns truthy (depends on browser + saved cards).
//   2. Card form — always shown; submits via confirmCardSetup.
//
// Callbacks :
//   - onSuccess(paymentMethodId) : card successfully tokenized
//   - onError(error) : Stripe returned an error (declined, invalid, etc.)
import { useEffect, useState, type FormEvent } from 'react';
import {
  CardElement,
  useStripe,
  useElements,
  PaymentRequestButtonElement,
} from '@stripe/react-stripe-js';
import type { PaymentRequest } from '@stripe/stripe-js';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui';

interface Props {
  /** Amount in cents — only required for PaymentRequest (Apple/Google Pay). */
  amount?: number;
  /** ISO 4217 currency code — defaults to CAD (Intralys). */
  currency?: string;
  onSuccess: (paymentMethodId: string) => void;
  onError: (error: Error) => void;
}

export function StripePaymentForm({
  amount,
  currency = 'CAD',
  onSuccess,
  onError,
}: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Payment Request setup (Apple Pay / Google Pay) ─────────────────────────
  useEffect(() => {
    if (!stripe || !amount) return;
    const pr = stripe.paymentRequest({
      country: 'CA',
      currency: currency.toLowerCase(),
      total: { label: 'Intralys', amount },
      requestPayerName: true,
      requestPayerEmail: true,
    });
    let cancelled = false;
    pr.canMakePayment().then((result) => {
      if (!cancelled && result) setPaymentRequest(pr);
    });
    pr.on('paymentmethod', async (ev) => {
      try {
        onSuccess(ev.paymentMethod.id);
        ev.complete('success');
      } catch (err) {
        ev.complete('fail');
        onError(err instanceof Error ? err : new Error('Payment Request failed'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [stripe, amount, currency, onSuccess, onError]);

  async function handleSubmitCard(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setSubmitting(false);
      onError(new Error('Card element not mounted'));
      return;
    }

    // SetupIntent confirm — clientSecret is read from <Elements> context
    // when the first arg is omitted (passing empty string also works in v2.x).
    const { setupIntent, error } = await stripe.confirmCardSetup('', {
      payment_method: { card: cardElement },
    });
    setSubmitting(false);

    if (error || !setupIntent?.payment_method) {
      onError(new Error(error?.message || 'Setup failed'));
      return;
    }
    const pmId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method.id;
    onSuccess(pmId);
  }

  return (
    <div data-component="StripePaymentForm" className="space-y-4">
      {paymentRequest && (
        <div data-section="payment-request">
          <PaymentRequestButtonElement options={{ paymentRequest }} />
          <div className="text-center text-sm text-[var(--text-muted)] my-2">
            {t('billing.real.payment_method.or_card')}
          </div>
        </div>
      )}
      <form
        data-section="card-form"
        onSubmit={handleSubmitCard}
        className="space-y-4"
      >
        <div className="p-3 border rounded">
          <CardElement options={{ hidePostalCode: false }} />
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          {t('billing.real.payment_method.pci_notice')}
        </p>
        <Button type="submit" variant="primary" disabled={!stripe || submitting}>
          {submitting
            ? t('billing.real.payment_method.submitting')
            : t('billing.real.payment_method.add')}
        </Button>
      </form>
    </div>
  );
}
