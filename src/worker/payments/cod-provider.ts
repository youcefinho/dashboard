// ── Sprint E4 M2 — Provider COD (Cash On Delivery / paiement à la livraison) ─
//
// COD = encaissement HORS LIGNE à la remise du colis. Méthode universelle,
// DOMINANTE en Algérie (DZD), proposable partout en repli.
//
// PCI : sans objet — AUCUN instrument de paiement n'est manipulé en ligne
// (le client paie en espèces/au livreur). Zéro donnée carte, zéro tokenisation.
//
// Flux COD (encaissement à la livraison) :
//   1. Init        : `createPayment` → status 'pending_cod', provider_ref
//                     interne déterministe, AUCUN redirect_url, AUCUNE capture.
//   2. Lifecycle   : recordPaymentTransition (M1) ne marque JAMAIS 'paid' sur
//                     'pending_cod' → la commande RESTE financial_status
//                     'unpaid', aucun commitSale, aucun mouvement de stock.
//   3. Webhook     : COD n'a PAS de webhook externe → `handleWebhook` renvoie
//                     toujours `null` (M1 : 200 no-op, aucune transition).
//   4. Réconciliation : l'encaissement réel (livreur a perçu l'argent) est une
//                     transition MANUELLE déclenchée au fulfillment — hors
//                     scope E4, traité par E5/E6 (réception fonds → 'paid').
//
// Conséquence clé : une commande COD n'est JAMAIS automatiquement payée par ce
// provider. C'est volontaire et conforme au contrat figé (pending_cod ≠ paid).

import type { Env } from '../types';
import type {
  PaymentStatus,
  PaymentCapabilities,
  RegionContext,
} from '../../lib/types';
import type { PaymentProvider, PaymentOrderRef } from '../ecommerce-payments';

export const codProvider: PaymentProvider = {
  id: 'cod',

  /**
   * COD : méthode 'cod' uniquement, mais TOUTES devises (universel, dominant
   * en DZD où Stripe est indisponible). M1 injecte déjà 'cod' en repli ;
   * on l'expose ici explicitement comme capability native.
   */
  capabilities(ctx: RegionContext): PaymentCapabilities {
    return {
      methods: ['cod'],
      // Universel : on supporte la devise du contexte région (CAD/EUR/DZD).
      currencies: [ctx.currency],
    };
  },

  /**
   * AUCUNE capture en ligne. On renvoie simplement une intention 'pending_cod'
   * avec une référence interne déterministe (pas d'appel réseau, pas de
   * redirect). Déterministe sur l'order id → idempotent par construction
   * (M1 fait déjà l'anti double-charge via idempotency_key ; ici la ref est
   * stable même si appelé deux fois).
   *
   * La commande RESTE 'unpaid' : recordPaymentTransition (M1) ne commit pas
   * sur 'pending_cod'. L'encaissement = transition manuelle au fulfillment
   * (E5/E6), hors scope E4.
   */
  async createPayment(
    _env: Env,
    order: PaymentOrderRef,
    _ctx: RegionContext,
    _idemKey: string,
  ): Promise<{ provider_ref: string; redirect_url?: string; status: PaymentStatus }> {
    // Réf interne opaque déterministe — alignée sur la convention M1
    // (handleInitPayment utilise `cod:<orderId>` pour la voie COD directe).
    // Aucun redirect_url : rien à confirmer côté client en ligne.
    return {
      provider_ref: `cod:${order.id}`,
      status: 'pending_cod',
    };
  },

  /**
   * COD n'a AUCUN webhook externe (pas de PSP). Toujours `null` → M1 répond
   * 200 no-op, aucune transition lifecycle. La transition vers 'paid' se fait
   * MANUELLEMENT à l'encaissement (livraison perçue) côté E5/E6 — jamais ici.
   */
  async handleWebhook(
    _env: Env,
    _request: Request,
  ): Promise<{ order_id: string; payment_ref: string; status: PaymentStatus } | null> {
    return null;
  },

  /**
   * ── Sprint E6 M1 — Remboursement COD ─────────────────────────────────────
   *
   * COD = encaissement HORS LIGNE (espèces au livreur) : il n'existe AUCUNE
   * API/PSP à appeler pour rembourser. Le remboursement réel se fait hors
   * système (remise d'espèces, virement manuel). On renvoie un succès tracé
   * (`provider_ref:'cod:offline'`, status 'succeeded') : AUCUN appel réseau,
   * inoffensif. La traçabilité financière (ligne `refunds` + bridge
   * financial_status) est assurée côté M1 (recordRefundTransition).
   *
   * Déterministe → idempotent par construction (M1 fait déjà l'anti-double
   * via idempotency_key ; ici la ref est stable même sur rejeu).
   */
  async refund(
    _env: Env,
    _payment: { client_id: string; provider_ref: string | null; currency: string },
    _amountCents: number,
    _idemKey: string,
  ): Promise<{ provider_ref: string; status: 'succeeded' | 'pending' | 'failed' }> {
    return { provider_ref: 'cod:offline', status: 'succeeded' };
  },
};
