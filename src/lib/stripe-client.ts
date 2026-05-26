// ── Stripe.js lazy loader — Sprint 31 (Agent C1) ─────────────────────────────
// Lazy-loads `@stripe/stripe-js` to keep the main bundle slim.
// The Stripe SDK is heavy (~30kb gzipped) and only needed on billing pages —
// importing it dynamically lets Vite/Rollup split it into its own chunk.
//
// Singleton pattern : Stripe instance is shared across all Elements providers
// in a single page session (recommended by Stripe docs).
//
// Returns `null` when VITE_STRIPE_PUBLISHABLE_KEY is missing — caller must
// handle this (display "Stripe non configuré" fallback). This is the normal
// state in dev/mock mode (Sprint 22 E4 flag mock).
import type { Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise;
  const pk = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)?.trim();
  if (!pk) return Promise.resolve(null);
  stripePromise = import('@stripe/stripe-js').then(({ loadStripe }) => loadStripe(pk));
  return stripePromise;
}

/** Reset the cached Stripe promise — useful only for tests. */
export function __resetStripePromiseForTests(): void {
  stripePromise = null;
}
