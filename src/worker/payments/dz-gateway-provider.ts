// ── Provider paiement Algérie (dz_gateway) — Sprint E4 M3.1 (2026-05-16) ────
//
// ⚠️ ZONE RÉGULÉE — revue Rochdi requise avant toute activation réelle.
//
// STUB STRUCTURÉ conforme au contrat FIGÉ `PaymentProvider`
// (src/worker/ecommerce-payments.ts — M1). Couvre les passerelles locales
// algériennes : SATIM (CIB / Edahabia) — la passerelle interbancaire
// nationale, et le portail e-paiement marchand associé.
//
// RÉGULÉ — STUB SANS RÉSEAU :
//   - `createPayment` ne fait AUCUN appel `fetch` réel : il renvoie une
//     référence de paiement mockée déterministe-friendly + statut 'pending'.
//   - `handleWebhook` renvoie systématiquement `null` (aucune intégration —
//     donc aucune transition financière ne peut être déclenchée par ce
//     provider tant que l'intégration réelle n'est pas livrée + revue).
//   - Aucune clé secrète, aucun PAN/CVV : ce provider ne manipule que des
//     références opaques (PCI : capture carte 100 % côté passerelle hébergée).
//
// Le module reste importable par le registry M2 (register.ts) via le chemin
// stable `src/worker/payments/dz-gateway-provider.ts`. Tant que ses méthodes
// sont inoffensives, l'enregistrer est sans risque (flag
// payment_provider_config.payments_live_enabled défaut 0 + stub no-op).

import type { Env } from '../types';
import type {
  PaymentStatus,
  PaymentCapabilities,
  RegionContext,
} from '../../lib/types';
import type {
  PaymentProvider,
  PaymentOrderRef,
} from '../ecommerce-payments';

// ────────────────────────────────────────────────────────────────────────────
// Points d'extension documentés pour l'intégration réelle (E4+)
// ────────────────────────────────────────────────────────────────────────────
//
// TODO E4+ : intégration réelle SATIM / CIB / Edahabia.
//   1. Bindings serveur (jamais dans le code / l'UI) :
//        env.DZ_SATIM_MERCHANT_ID, env.DZ_SATIM_TERMINAL_ID,
//        env.DZ_SATIM_SECRET (HMAC vérif webhook), env.DZ_SATIM_BASE_URL.
//   2. createPayment : POST register.do (montant en centimes DZD, orderId,
//        returnUrl/failUrl) → récupérer { orderId provider, formUrl } et
//        renvoyer redirect_url = formUrl (page de paiement HÉBERGÉE SATIM —
//        AUCUNE saisie carte dans notre UI).
//   3. handleWebhook : vérifier la signature SATIM (HMAC sur le payload),
//        mapper le code retour (00 = succès → 'paid', sinon 'failed'),
//        renvoyer { order_id, payment_ref, status }.
//   4. Idempotence : réutiliser `idemKey` comme orderNumber marchand pour
//        éviter tout double enregistrement côté passerelle.
//   5. Revue conformité (Loi conso DZ / PCI-DSS SAQ-A) AVANT go-live.

/** Méthode logique exposée pour l'Algérie (carte locale CIB / Edahabia
 *  via SATIM). Aligné sur le contrat figé `PaymentMethod` (= 'dz_local'). */
const DZ_METHOD = 'dz_local' as const;

/**
 * Provider Algérie — STUB conforme à l'interface `PaymentProvider`.
 * id = 'dz_gateway' (contrat figé). Inoffensif : aucun réseau, aucun effet.
 */
export const dzGatewayProvider: PaymentProvider = {
  id: 'dz_gateway',

  /**
   * Méthodes/devises supportées dans le contexte région. SATIM ne traite que
   * le Dinar algérien (DZD) — on ne propose JAMAIS une devise non supportée
   * (le registry M1 filtre déjà par devise région, mais on reste strict ici).
   */
  capabilities(_ctx: RegionContext): PaymentCapabilities {
    return {
      methods: [DZ_METHOD],
      currencies: ['DZD'],
    };
  },

  /**
   * Crée l'intention de paiement. ⚠️ ZONE RÉGULÉE.
   *
   * STUB — AUCUN appel réseau : on renvoie une référence opaque mockée et un
   * statut 'pending' (la commande reste 'unpaid' — aucun pont lifecycle n'est
   * déclenché tant qu'un webhook 'paid' réel n'arrive pas, ce qui n'arrivera
   * jamais avec ce stub puisque handleWebhook renvoie null).
   *
   * Pas de `redirect_url` : tant que l'intégration réelle (page hébergée
   * SATIM) n'est pas livrée, on n'envoie l'utilisateur nulle part. L'UI
   * affichera donc « en attente » sans capture possible (inoffensif).
   *
   * @param idemKey clé d'idempotence déterministe (order+method+amount) —
   *   réutilisée telle quelle comme suffixe de la ref pour rester stable
   *   sur un rejeu (anti double-enregistrement futur côté passerelle).
   */
  async createPayment(
    _env: Env,
    _order: PaymentOrderRef,
    _ctx: RegionContext,
    idemKey: string,
  ): Promise<{ provider_ref: string; redirect_url?: string; status: PaymentStatus }> {
    // TODO E4+ : intégration réelle SATIM/CIB/Edahabia (API register.do,
    // clés serveur, page de paiement hébergée, signature webhook). Ici :
    // référence mockée déterministe-friendly, AUCUN fetch, AUCUN effet.
    const safeKey =
      (idemKey || '').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 64) ||
      crypto.randomUUID();
    return {
      provider_ref: `dz_stub_${safeKey}`,
      status: 'pending',
      // redirect_url volontairement absent (pas d'intégration réelle).
    };
  },

  /**
   * Vérification de signature + normalisation du webhook. ⚠️ ZONE RÉGULÉE.
   *
   * STUB — renvoie TOUJOURS `null` : aucune intégration réelle, donc aucune
   * transition financière ne peut être déclenchée par ce provider. Le
   * dispatcher M1 traite `null` comme « non pertinent » (200 no-op, aucun
   * commit). Sûr par construction.
   */
  async handleWebhook(
    _env: Env,
    _request: Request,
  ): Promise<{ order_id: string; payment_ref: string; status: PaymentStatus } | null> {
    // TODO E4+ : vérifier la signature HMAC SATIM, mapper le code retour
    // (00 → 'paid', sinon 'failed'), renvoyer le résultat normalisé. Tant
    // que non implémenté : null (aucun effet — exigence régulée).
    return null;
  },

  /**
   * ── Sprint E6 M1 — Remboursement (STUB régulé) ───────────────────────────
   *
   * ⚠️ ZONE RÉGULÉE — revue Rochdi requise avant toute activation réelle.
   *
   * STUB SANS RÉSEAU : aucune intégration SATIM réelle livrée → AUCUN appel
   * `fetch`. On renvoie un statut 'pending' avec une référence opaque mockée :
   * aucun mouvement de fonds réel ne peut survenir (sûr par construction,
   * aligné sur les autres méthodes stub de ce provider + flag
   * payments_live_enabled défaut 0). La traçabilité (ligne `refunds`) est
   * gérée côté M1 ; ce stub ne décide d'aucune transition financière.
   *
   * TODO E4+ : POST refund SATIM (signature HMAC, code retour → status),
   * revue conformité (Loi conso DZ / PCI-DSS) AVANT go-live.
   */
  async refund(
    _env: Env,
    _payment: { client_id: string; provider_ref: string | null; currency: string },
    _amountCents: number,
    _idemKey: string,
  ): Promise<{ provider_ref: string; status: 'succeeded' | 'pending' | 'failed' }> {
    // ⚠️ ZONE RÉGULÉE — stub no-op : aucun réseau, aucun fonds réel remboursé.
    return { provider_ref: 'dz_stub_refund', status: 'pending' };
  },
};

export default dzGatewayProvider;
