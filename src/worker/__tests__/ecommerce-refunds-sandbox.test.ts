// ════════════════════════════════════════════════════════════════════════════
// Sprint S5 M2 — Remboursements e-commerce SANDBOX (ecommerce-refunds.ts)
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ ZÉRO modif code prod. On importe/teste les exports réels :
//   recordRefundTransition (~:104), handleCreateRefund (~:191).
//
// ⚠️ RÉGULÉ — SANDBOX UNIQUEMENT. payments_live_enabled n'est JAMAIS posé à 1.
// Chaque suite touchant le provider asserte EXPLICITEMENT que la résolution
// reste live_enabled=false / mode='test' (garde-fou Stripe sk_test_ NON
// contourné — cf. ecommerce-refunds.ts ZONE RÉGULÉE).
//
// ⚠️ LIMITE MOCK D1 (figée S2 _helpers.ts) : pas d'UNIQUE/FK/INSERT OR IGNORE ;
// .run() renvoie toujours {changes:1}. L'idempotence DB réelle (anti
// double-remboursement / anti double-restock au niveau contrainte) n'est PAS
// prouvable ici. On prouve la LOGIQUE APPLICATIVE : le code RELIT l'état
// « déjà présent » (refund existant non-failed / restocked=1) AVANT d'agir et
// NE rappelle PAS le provider / NE re-restocke PAS. Run réel = Rochdi.

import { describe, it, expect } from 'vitest';
import {
  ecomEnv,
  seedTenant,
  createMockD1,
  type MockD1,
} from './_ecommerce-fixtures';
import {
  recordRefundTransition,
  handleCreateRefund,
} from '../ecommerce-refunds';
import {
  resolvePaymentProvider,
  registerProvider,
  getProvider,
  type PaymentProvider,
} from '../ecommerce-payments';

const CLIENT = 'client-A';
const AUTH = { userId: 'user-A', role: 'admin' };

function hasCall(db: MockD1, re: RegExp): boolean {
  return db.calls.some((c) => re.test(c.sql));
}
function countCalls(db: MockD1, re: RegExp): number {
  return db.calls.filter((c) => re.test(c.sql)).length;
}

/** Devise région (loadClientRegion, needle 'default_currency' — non conflit). */
function seedCurrency(db: MockD1, currency: 'CAD' | 'EUR' | 'DZD'): void {
  db.seed('default_currency', [
    {
      region: 'X',
      country: currency === 'EUR' ? 'FR' : currency === 'DZD' ? 'DZ' : 'CA',
      default_currency: currency,
      tax_regime: currency === 'EUR' ? 'eu' : currency === 'DZD' ? 'dz' : 'qc',
      legal_flags_json: null,
    },
  ]);
}

/** Config provider — JAMAIS live=1. mode test forcé / flag 0. */
function seedConfigTestMode(db: MockD1, provider: string): void {
  db.seed('from payment_provider_config', [
    { provider, mode: 'test', payments_live_enabled: 0 },
  ]);
}

function refundReq(body: Record<string, unknown>): Request {
  return new Request('https://x/api/ecommerce/orders/o-1/refund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Provider de test refundable (refund LOCAL, aucun réseau, aucune clé). Permet
 * d'exercer le chemin remboursement SANS jamais activer le live.
 */
function makeRefundableProvider(): PaymentProvider {
  return {
    id: 'stripe',
    capabilities: (ctx) => ({ methods: ['card'], currencies: [ctx.currency] }),
    async createPayment(_e, _o, _c, k) {
      return { provider_ref: k, status: 'pending' };
    },
    async handleWebhook() {
      return null;
    },
    async refund(_e, _p, _amt, idemKey) {
      return { provider_ref: `re_${idemKey}`, status: 'succeeded' };
    },
  };
}

/** Provider SANS refund? (futur provider non remboursable) → 422 attendu. */
function makeNonRefundableProvider(): PaymentProvider {
  return {
    id: 'dz_gateway',
    capabilities: (ctx) => ({ methods: ['card'], currencies: [ctx.currency] }),
    async createPayment(_e, _o, _c, k) {
      return { provider_ref: k, status: 'pending' };
    },
    async handleWebhook() {
      return null;
    },
    // PAS de refund — provider valide mais sans remboursement.
  };
}

// Seed le paiement source lu par handleCreateRefund :
//   ORDER BY (status='paid') DESC, created_at DESC  → 'from payments'
function seedSourcePayment(
  db: MockD1,
  o: { paid: number; provider?: string; status?: string },
): void {
  db.seed('from payments', [
    {
      id: 'pay-1',
      client_id: CLIENT,
      order_id: 'o-1',
      provider: o.provider ?? 'stripe',
      amount_cents: o.paid,
      currency: 'CAD',
      provider_ref: 'pi_pay-1',
      status: o.status ?? 'paid',
    },
  ]);
}

// ════════════════════════════════════════════════════════════════════════════
// M2.B4 — handleCreateRefund : double-refund, gardes, restock, COD, 422
// ════════════════════════════════════════════════════════════════════════════

describe('M2.B4 handleCreateRefund — anti double-remboursement (clé idem)', () => {
  it('refund existant non-failed pour la clé → RETOURNÉ sans rappeler le provider', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'stripe');
    db.seed('from orders where id', [
      { id: 'o-1', client_id: CLIENT, financial_status: 'paid' },
    ]);
    seedSourcePayment(db, { paid: 10000 });
    // État « déjà présent » : un refund non-échoué pour la MÊME clé idem.
    // Le code relit `from refunds where ... idempotency_key` (1er match) et
    // doit retourner CET existant sans rappeler provider.refund.
    db.seed('from refunds', [
      {
        id: 'ref-existing',
        order_id: 'o-1',
        payment_id: 'pay-1',
        amount_cents: 4000,
        currency: 'CAD',
        status: 'succeeded',
        provider_ref: 're_old',
        idempotency_key: 'refund:o-1:4000:0',
        reason: null,
        restocked: 0,
        created_at: '2026-01-01 00:00:00',
      },
    ]);

    let providerCalled = false;
    const prev = getProvider('stripe');
    const p = makeRefundableProvider();
    const origRefund = p.refund!;
    p.refund = async (...a) => {
      providerCalled = true;
      return origRefund(...a);
    };
    registerProvider(p);
    try {
      // Garde-fou sandbox : la résolution reste en mode test.
      const resolved = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
      expect(resolved.live_enabled).toBe(false);
      expect(resolved.mode).toBe('test');

      const res = await handleCreateRefund(
        refundReq({ amount_cents: 4000 }),
        ecomEnv(db) as never,
        AUTH,
        'o-1',
      );
      const body = (await res.json()) as { data: { id: string } };
      expect(res.status).toBe(200);
      expect(body.data.id).toBe('ref-existing');
      // Logique applicative : provider.refund JAMAIS rappelé sur rejeu.
      expect(providerCalled).toBe(false);
      expect(hasCall(db, /INSERT\s+OR\s+IGNORE\s+INTO\s+refunds/i)).toBe(false);
    } finally {
      if (prev) registerProvider(prev);
    }
  });
});

describe('M2.B4 handleCreateRefund — gardes montant & provider', () => {
  it('engaged + requested > paid → 409, provider NON appelé', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'stripe');
    db.seed('from orders where id', [
      { id: 'o-1', client_id: CLIENT, financial_status: 'paid' },
    ]);
    seedSourcePayment(db, { paid: 10000 });
    // engaged déjà = 8000 ; demande 5000 ⇒ 13000 > 10000 ⇒ 409.
    // Le SELECT engaged et le SELECT existing partagent 'from refunds' :
    // on seede une ligne portant engaged ET un idempotency_key DISTINCT de la
    // clé calculée (refund:o-1:5000:<seq>) ⇒ pas de court-circuit "existant".
    db.seed('from refunds', [
      {
        id: 'r-prev',
        order_id: 'o-1',
        payment_id: 'pay-1',
        amount_cents: 8000,
        engaged: 8000,
        n: 1,
        currency: 'CAD',
        status: 'succeeded',
        provider_ref: 're_prev',
        idempotency_key: 'refund:o-1:8000:0',
        reason: null,
        restocked: 0,
        created_at: '2026-01-01 00:00:00',
      },
    ]);

    let providerCalled = false;
    const prev = getProvider('stripe');
    const p = makeRefundableProvider();
    p.refund = async (...a) => {
      providerCalled = true;
      return { provider_ref: 're_x', status: 'succeeded' };
    };
    registerProvider(p);
    try {
      const res = await handleCreateRefund(
        refundReq({ amount_cents: 5000 }),
        ecomEnv(db) as never,
        AUTH,
        'o-1',
      );
      expect(res.status).toBe(409);
      expect(providerCalled).toBe(false);
    } finally {
      if (prev) registerProvider(prev);
    }
  });

  it('provider sans refund? → 422 (remboursement non supporté)', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'DZD');
    seedConfigTestMode(db, 'dz_gateway');
    db.seed('from orders where id', [
      { id: 'o-1', client_id: CLIENT, financial_status: 'paid' },
    ]);
    seedSourcePayment(db, { paid: 10000, provider: 'dz_gateway' });
    db.seed('from refunds', []); // aucun refund engagé

    const prev = getProvider('dz_gateway');
    registerProvider(makeNonRefundableProvider());
    try {
      const resolved = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
      expect(resolved.live_enabled).toBe(false);
      expect(resolved.mode).toBe('test');

      const res = await handleCreateRefund(
        refundReq({ amount_cents: 3000 }),
        ecomEnv(db) as never,
        AUTH,
        'o-1',
      );
      expect(res.status).toBe(422);
    } finally {
      if (prev) registerProvider(prev);
    }
  });

  it('commande introuvable → 404', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'stripe');
    db.seed('from orders where id', []);

    const res = await handleCreateRefund(
      refundReq({ amount_cents: 1000 }),
      ecomEnv(db) as never,
      AUTH,
      'o-1',
    );
    expect(res.status).toBe(404);
  });

  it('aucun paiement source → 404', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'stripe');
    db.seed('from orders where id', [
      { id: 'o-1', client_id: CLIENT, financial_status: 'unpaid' },
    ]);
    db.seed('from payments', []); // pas de paiement

    const res = await handleCreateRefund(
      refundReq({ amount_cents: 1000 }),
      ecomEnv(db) as never,
      AUTH,
      'o-1',
    );
    expect(res.status).toBe(404);
  });
});

describe('M2.B4 handleCreateRefund — restock garde anti double + COD no-op', () => {
  it('refund existant restocked=1 → NE re-restocke PAS (releaseStock non rappelé)', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'stripe');
    db.seed('from orders where id', [
      { id: 'o-1', client_id: CLIENT, financial_status: 'paid' },
    ]);
    seedSourcePayment(db, { paid: 5000 });
    // Refund déjà présent POUR LA CLÉ + restocked=1 ⇒ retour anticipé de
    // l'existant (status != failed) ⇒ aucun nouveau restock déclenché.
    db.seed('from refunds', [
      {
        id: 'ref-restocked',
        order_id: 'o-1',
        payment_id: 'pay-1',
        amount_cents: 5000,
        currency: 'CAD',
        status: 'succeeded',
        provider_ref: 're_done',
        idempotency_key: 'refund:o-1:5000:0',
        reason: null,
        restocked: 1,
        created_at: '2026-01-01 00:00:00',
      },
    ]);

    const prev = getProvider('stripe');
    registerProvider(makeRefundableProvider());
    try {
      const res = await handleCreateRefund(
        refundReq({ amount_cents: 5000, restock_items: ['v-1'] }),
        ecomEnv(db) as never,
        AUTH,
        'o-1',
      );
      expect(res.status).toBe(200); // existant retourné tel quel
      // Pas de réécriture du verrou restock (UPDATE refunds SET restocked).
      expect(hasCall(db, /UPDATE\s+refunds\s+SET\s+restocked/i)).toBe(false);
    } finally {
      if (prev) registerProvider(prev);
    }
  });

  it('COD refund → no-op succeeded (provider_ref cod:offline), aucun appel réseau', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'cod');
    db.seed('from orders where id', [
      { id: 'o-1', client_id: CLIENT, financial_status: 'paid' },
    ]);
    seedSourcePayment(db, { paid: 4000, provider: 'cod', status: 'pending_cod' });
    db.seed('from refunds', []);

    // cod est enregistré via ./payments/register côté prod ; on s'assure de
    // sa présence (sinon on l'enregistre localement, refund no-op tracé).
    const prev = getProvider('cod');
    if (!prev) {
      registerProvider({
        id: 'cod',
        capabilities: (ctx) => ({ methods: ['cod'], currencies: [ctx.currency] }),
        async createPayment(_e, o) {
          return { provider_ref: `cod:${o.id}`, status: 'pending_cod' };
        },
        async handleWebhook() {
          return null;
        },
        async refund() {
          return { provider_ref: 'cod:offline', status: 'succeeded' };
        },
      });
    }
    try {
      // Garde-fou : résolution reste test (jamais live=1).
      const resolved = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
      expect(resolved.live_enabled).toBe(false);
      expect(resolved.mode).toBe('test');

      const res = await handleCreateRefund(
        refundReq({ amount_cents: 4000 }),
        ecomEnv(db) as never,
        AUTH,
        'o-1',
      );
      // Le mock relit defaultRows=[] après INSERT (row=null) ⇒ data null mais
      // 201 : l'important = provider COD no-op, AUCUN INSERT 'failed' (pas
      // d'exception réseau), insertion 'succeeded' tracée.
      expect([201]).toContain(res.status);
      const ins = db.calls.find((c) =>
        /INSERT\s+OR\s+IGNORE\s+INTO\s+refunds/i.test(c.sql),
      );
      expect(ins).toBeTruthy();
      expect(ins!.args).toContain('cod:offline');
      expect(ins!.args).toContain('succeeded');
    } finally {
      if (!prev) {
        // rien à restaurer (on avait enregistré un stub) — laissé tel quel,
        // les autres suites réenregistrent leur propre stub avant usage.
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// recordRefundTransition — recalcul déterministe partially/refunded
// ════════════════════════════════════════════════════════════════════════════

describe('M2.B4 recordRefundTransition — financial_status déterministe', () => {
  it('somme remboursée == 0 → on ne touche RIEN (état conservé)', async () => {
    const db = createMockD1();
    db.seed('from orders where id', [
      { id: 'o-1', client_id: CLIENT, financial_status: 'paid' },
    ]);
    db.seed('from payments', [{ paid_sum: 10000, max_amount: 10000 }]);
    db.seed('from refunds', [{ refunded_sum: 0 }]);

    const r = await recordRefundTransition(ecomEnv(db) as never, {
      order_id: 'o-1',
      refund_id: 'ref-x',
      amount_cents: 0,
      status: 'succeeded',
    });
    expect(r.financial_status).toBe('paid'); // état courant conservé
    expect(hasCall(db, /UPDATE\s+orders\s+SET\s+financial_status/i)).toBe(false);
  });

  it('0 < somme < payé → partially_refunded', async () => {
    const db = createMockD1();
    db.seed('from orders where id', [
      { id: 'o-1', client_id: CLIENT, financial_status: 'paid' },
    ]);
    db.seed('from payments', [{ paid_sum: 10000, max_amount: 10000 }]);
    db.seed('from refunds', [{ refunded_sum: 4000 }]);

    const r = await recordRefundTransition(ecomEnv(db) as never, {
      order_id: 'o-1',
      refund_id: 'ref-x',
      amount_cents: 4000,
      status: 'succeeded',
    });
    expect(r.financial_status).toBe('partially_refunded');
    expect(hasCall(db, /UPDATE\s+orders\s+SET\s+financial_status/i)).toBe(true);
  });

  it('somme >= payé → refunded', async () => {
    const db = createMockD1();
    db.seed('from orders where id', [
      { id: 'o-1', client_id: CLIENT, financial_status: 'paid' },
    ]);
    db.seed('from payments', [{ paid_sum: 10000, max_amount: 10000 }]);
    db.seed('from refunds', [{ refunded_sum: 10000 }]);

    const r = await recordRefundTransition(ecomEnv(db) as never, {
      order_id: 'o-1',
      refund_id: 'ref-x',
      amount_cents: 10000,
      status: 'succeeded',
    });
    expect(r.financial_status).toBe('refunded');
  });

  it('rejeu (mêmes seeds) → MÊME résultat (recalcul déterministe, idempotent)', async () => {
    const seeds = () => {
      const db = createMockD1();
      db.seed('from orders where id', [
        { id: 'o-1', client_id: CLIENT, financial_status: 'paid' },
      ]);
      db.seed('from payments', [{ paid_sum: 10000, max_amount: 10000 }]);
      db.seed('from refunds', [{ refunded_sum: 6000 }]);
      return db;
    };
    const r1 = await recordRefundTransition(ecomEnv(seeds()) as never, {
      order_id: 'o-1',
      refund_id: 'ref-x',
      amount_cents: 6000,
      status: 'succeeded',
    });
    const r2 = await recordRefundTransition(ecomEnv(seeds()) as never, {
      order_id: 'o-1',
      refund_id: 'ref-x',
      amount_cents: 6000,
      status: 'succeeded',
    });
    expect(r1.financial_status).toBe(r2.financial_status);
    expect(r1.financial_status).toBe('partially_refunded');
  });

  it('commande introuvable → unpaid, aucune transition inventée', async () => {
    const db = createMockD1();
    db.seed('from orders where id', []);
    const r = await recordRefundTransition(ecomEnv(db) as never, {
      order_id: 'o-x',
      refund_id: 'ref-x',
      amount_cents: 100,
      status: 'succeeded',
    });
    expect(r.financial_status).toBe('unpaid');
    expect(hasCall(db, /UPDATE\s+orders\s+SET\s+financial_status/i)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Garde-fou transverse — payments_live_enabled reste 0 / mode test PARTOUT
// ════════════════════════════════════════════════════════════════════════════

describe('M2.B4 garde-fou SANDBOX — live JAMAIS activé (assert explicite)', () => {
  it('config absente → live_enabled=false, mode=test', async () => {
    const db = createMockD1();
    seedCurrency(db, 'CAD');
    db.seed('from payment_provider_config', []);
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.live_enabled).toBe(false);
    expect(r.mode).toBe('test');
  });

  it('config flag=0 explicite → live_enabled=false, mode=test', async () => {
    const db = createMockD1();
    seedCurrency(db, 'CAD');
    db.seed('from payment_provider_config', [
      { provider: 'stripe', mode: 'test', payments_live_enabled: 0 },
    ]);
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.live_enabled).toBe(false);
    expect(r.mode).toBe('test');
    // Aucun test de ce fichier ne pose jamais payments_live_enabled à 1.
  });
});
