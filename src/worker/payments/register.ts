// ── Sprint E4 M2 — Bootstrap registry providers de paiement ─────────────────
//
// Side-effect module : enregistre les providers concrets dans la registry M1
// (`ecommerce-payments.ts` n'auto-enregistre RIEN — la Map est peuplée
// uniquement via registerProvider). Importé une seule fois (import
// side-effect dans ecommerce-payments.ts — voir note ownership M2).
//
// Providers branchés :
//   - stripe      (M2) : Checkout hébergé tokenisé, webhook HMAC vérifié.
//   - cod         (M2) : paiement à la livraison, jamais 'paid' à la création.
//   - dz_gateway  (M3) : passerelle DZ — fichier créé par M3 (chemin STABLE
//                  convenu : ./dz-gateway-provider). Importé contre le contrat
//                  figé : si M3 n'a pas encore livré OU nomme son export
//                  autrement, on dégrade proprement (provider non branché →
//                  M1 répond 503 à l'init / 200 no-op au webhook) SANS casser
//                  stripe ni cod.

import { registerProvider } from '../ecommerce-payments';
import type { PaymentProvider } from '../ecommerce-payments';
import { stripeProvider } from './stripe-provider';
import { codProvider } from './cod-provider';
// Chemin STABLE convenu avec M3. Import namespace : résilient au nom d'export
// exact choisi par M3 (on cherche un objet conforme au contrat figé id==='dz_gateway').
import * as dzModule from './dz-gateway-provider';

// M2 : enregistrement immédiat (fichiers livrés, contrat respecté).
registerProvider(stripeProvider);
registerProvider(codProvider);

// M3 (dz_gateway) : enregistré si et seulement si un export conforme au
// contrat figé est présent. Tolérant au nom (`dzGatewayProvider`,
// `dzProvider`, `default`, ...) — on valide la forme, pas le nom.
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

const dz = pickDzProvider(dzModule as unknown as Record<string, unknown>);
if (dz) registerProvider(dz);
