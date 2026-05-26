// ── StripeElementsProvider — Sprint 31 (Agent C1) ────────────────────────────
// Thin wrapper around `<Elements>` from @stripe/react-stripe-js.
// Handles :
//   - Async load of Stripe.js (via lazy getStripePromise)
//   - `clientSecret` injection (PaymentIntent OR SetupIntent — both supported)
//   - French Canadian locale (fr-CA) — Intralys default
//   - Loading + missing-config fallbacks
//
// Children typically include <StripePaymentForm /> or any component using
// useStripe() / useElements() hooks.
import { useEffect, useState, type ReactNode } from 'react';
import type { Stripe, StripeElementsOptions } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { getStripePromise } from '@/lib/stripe-client';
import { t } from '@/lib/i18n';

interface Props {
  /** clientSecret from PaymentIntent or SetupIntent created server-side. */
  clientSecret: string;
  children: ReactNode;
}

export function StripeElementsProvider({ clientSecret, children }: Props) {
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getStripePromise().then((s) => {
      if (!cancelled) {
        setStripe(s);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div
        data-component="StripeElementsProvider"
        data-state="loading"
        className="text-sm text-gray-500"
      >
        {t('billing.real.stripe.loading')}
      </div>
    );
  }

  if (!stripe) {
    return (
      <div
        data-component="StripeElementsProvider"
        data-state="unconfigured"
        className="text-sm text-gray-500"
      >
        {t('billing.real.stripe.unconfigured')}
      </div>
    );
  }

  const options: StripeElementsOptions = {
    clientSecret,
    appearance: { theme: 'stripe' as const },
    locale: 'fr-CA' as const,
  };

  return (
    <Elements stripe={stripe} options={options}>
      {children}
    </Elements>
  );
}
