// ── Sprint E4 M2 — Bootstrap registry providers de paiement ─────────────────
//
// Exporte une fonction bootProviders() appelée lazily par ecommerce-payments.ts
// APRÈS l'initialisation de REGISTRY (évite le TDZ sur import circulaire).
//
// Providers branchés :
//   - stripe      (M2) : Checkout hébergé tokenisé, webhook HMAC vérifié.
//   - cod         (M2) : paiement à la livraison, jamais 'paid' à la création.
//   - dz_gateway  (M3) : passerelle DZ — fichier créé par M3.

import type { PaymentProvider } from '../ecommerce-payments';
import { stripeProvider } from './stripe-provider';
import { codProvider } from './cod-provider';
// Chemin STABLE convenu avec M3. Import namespace : résilient au nom d'export
// exact choisi par M3.
import * as dzModule from './dz-gateway-provider';

// M3 (dz_gateway) : enregistré si et seulement si un export conforme au
// contrat figé est présent.
function pickDzProvider(mod: Record<string, unknown>): PaymentProvider | null {
  for (const value of Object.values(mod)) {
    if (
      value &&
      typeof value === 'object' &&
      (value as { id?: unknown }).id === 'dz_gateway' &&
      typeof (value as { createPayment?: unknown }).createPayment === 'function' &&
      typeof (value as { handleWebhook?: unknown }).handleWebhook === 'function' &&
      typeof (value as { capabilities?: unknown }).capabilities === 'function'
    ) {
      return value as PaymentProvider;
    }
  }
  return null;
}

/**
 * Enregistre tous les providers connus dans la registry.
 * Appelé lazily par ecommerce-payments.ts (APRÈS REGISTRY initialisé).
 * @param register — la fonction registerProvider de ecommerce-payments.ts
 */
export function bootProviders(register: (p: PaymentProvider) => void): void {
  register(stripeProvider);
  register(codProvider);

  const dz = pickDzProvider(dzModule as unknown as Record<string, unknown>);
  if (dz) register(dz);
}
