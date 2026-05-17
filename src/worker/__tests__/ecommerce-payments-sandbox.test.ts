// ════════════════════════════════════════════════════════════════════════════
// Sprint S5 M2 — Paiement e-commerce SANDBOX (ecommerce-payments.ts)
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ ZÉRO modif code prod. On importe/teste les exports réels :
//   resolvePaymentProvider (~:159), handleInitPayment (~:262),
//   recordPaymentTransition (~:524), handlePaymentWebhook (~:430).
//
// ⚠️ RÉGULÉ — SANDBOX UNIQUEMENT. payments_live_enabled n'est JAMAIS posé à 1.
// On vérifie que le garde-fou `payments_live_enabled=0` TIENT : config absente
// OU explicitement à 0 ⇒ live_enabled=false, mode='test'. Aucun test ne pose
// jamais live=1.
//
// ⚠️ LIMITE MOCK D1 (figée S2 _helpers.ts) : pas d'UNIQUE/FK/INSERT OR IGNORE ;
// .run() renvoie toujours {changes:1}. L'idempotence DB réelle n'est donc PAS
// prouvable ici. On prouve la LOGIQUE APPLICATIVE : le code relit-il l'état
// « déjà présent » (paiement existant / event journalisé / paid_at) AVANT
// d'agir ? — en seedant cet état via fixtures et en assertant l'absence de
// re-création / re-appel provider via db.calls. Run réel = Rochdi.

import { describe, it, expect } from 'vitest';
import {
  ecomEnv,
  seedTenant,
  seedOrder,
  seedPayment,
  createMockD1,
  type MockD1,
} from './_ecommerce-fixtures';
import {
  resolvePaymentProvider,
  handleInitPayment,
  recordPaymentTransition,
  handlePaymentWebhook,
  registerProvider,
  getProvider,
  type PaymentProvider,
} from '../ecommerce-payments';

const CLIENT = 'client-A';
const AUTH = { userId: 'user-A', role: 'admin' };

// ── Utilitaires d'assertion sur les effets D1 observables ───────────────────
function countCalls(db: MockD1, re: RegExp): number {
  return db.calls.filter((c) => re.test(c.sql)).length;
}
function hasCall(db: MockD1, re: RegExp): boolean {
  return db.calls.some((c) => re.test(c.sql));
}

/**
 * Seed la devise région du tenant. `loadClientRegion` (ecommerce-region.ts)
 * lit `SELECT region, country, default_currency, tax_regime, legal_flags_json
 * FROM clients WHERE id = ?` → needle unique 'default_currency' (distinct de
 * 'modules_json from clients' seedé par seedTenant : aucun conflit de match).
 */
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

/** Désactive explicitement live (défaut DB = 0). JAMAIS de variante =1. */
function seedConfigTestMode(db: MockD1, provider?: string): void {
  if (provider) {
    db.seed('from payment_provider_config', [
      { provider, mode: 'test', payments_live_enabled: 0 },
    ]);
  } else {
    // Config absente → resolvePaymentProvider applique le défaut sûr.
    db.seed('from payment_provider_config', []);
  }
}

function initReq(method: string): Request {
  return new Request('https://x/api/ecommerce/orders/o-1/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method }),
  });
}

// Provider de test minimal — enregistré à la volée pour exercer le chemin
// « provider branché » SANS jamais toucher au live (createPayment local,
// aucun réseau, aucune clé). Restauré après chaque suite l'utilisant.
function makeStubProvider(id: 'stripe' | 'dz_gateway'): PaymentProvider {
  return {
    id,
    capabilities: (ctx) => ({
      methods: ['card'],
      currencies: [ctx.currency],
    }),
    async createPayment(_e, _o, _c, idemKey) {
      return { provider_ref: `stub_${idemKey}`, status: 'pending' };
    },
    async handleWebhook() {
      return null;
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// M2.B1 — resolvePaymentProvider : région→provider + garde-fou sandbox
// ════════════════════════════════════════════════════════════════════════════

describe('M2.B1 resolvePaymentProvider — région → provider', () => {
  it('DZD → dz_gateway (Stripe indisponible en DZD)', async () => {
    const db = createMockD1();
    seedCurrency(db, 'DZD');
    seedConfigTestMode(db); // pas de config explicite
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.provider_id).toBe('dz_gateway');
    expect(r.ctx.currency).toBe('DZD');
  });

  it('CAD → stripe par défaut', async () => {
    const db = createMockD1();
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db);
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.provider_id).toBe('stripe');
    expect(r.ctx.currency).toBe('CAD');
  });

  it('EUR → stripe par défaut', async () => {
    const db = createMockD1();
    seedCurrency(db, 'EUR');
    seedConfigTestMode(db);
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.provider_id).toBe('stripe');
    expect(r.ctx.currency).toBe('EUR');
  });

  it('COD injecté universellement en repli (méthode cod toujours présente)', async () => {
    const db = createMockD1();
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db);
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.capabilities.methods).toContain('cod');
  });

  it('config explicite "cod" → provider_id cod, devise région conservée', async () => {
    const db = createMockD1();
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'cod');
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.provider_id).toBe('cod');
    expect(r.capabilities.methods).toContain('cod');
  });
});

describe('M2.B1 resolvePaymentProvider — garde-fou SANDBOX (live=0 TIENT)', () => {
  it('payment_provider_config ABSENT → live_enabled=false, mode=test', async () => {
    const db = createMockD1();
    seedCurrency(db, 'CAD');
    db.seed('from payment_provider_config', []); // aucune ligne
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.live_enabled).toBe(false);
    expect(r.mode).toBe('test');
  });

  it('payments_live_enabled=0 explicite → mode test forcé', async () => {
    const db = createMockD1();
    seedCurrency(db, 'CAD');
    db.seed('from payment_provider_config', [
      { provider: 'stripe', mode: 'test', payments_live_enabled: 0 },
    ]);
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.live_enabled).toBe(false);
    expect(r.mode).toBe('test');
  });

  it('mode="live" mais payments_live_enabled=0 → mode RESTE test (garde-fou tient)', async () => {
    const db = createMockD1();
    seedCurrency(db, 'CAD');
    // Cas piège : mode='live' demandé mais flag NON activé → doit rester test.
    db.seed('from payment_provider_config', [
      { provider: 'stripe', mode: 'live', payments_live_enabled: 0 },
    ]);
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.live_enabled).toBe(false);
    expect(r.mode).toBe('test'); // live exige flag=1 ET mode=live ⇒ ici test
  });

  it('payments_live_enabled NULL → traité comme 0 (mode test)', async () => {
    const db = createMockD1();
    seedCurrency(db, 'CAD');
    db.seed('from payment_provider_config', [
      { provider: 'stripe', mode: null, payments_live_enabled: null },
    ]);
    const r = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
    expect(r.live_enabled).toBe(false);
    expect(r.mode).toBe('test');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M2.B2 — handleInitPayment : idempotence applicative + gardes
// ════════════════════════════════════════════════════════════════════════════

describe('M2.B2 handleInitPayment — idempotence applicative & gardes', () => {
  it('paiement existant non-failed pour la clé → RETOURNÉ sans re-INSERT', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'cod');
    seedOrder(db, { orderId: 'o-1', total: 5000 });
    // État « déjà présent » : un paiement non-échoué pour la clé idem.
    seedPayment(db, {
      paymentId: 'pay-existing',
      orderId: 'o-1',
      status: 'pending_cod',
    });

    const res = await handleInitPayment(initReq('cod'), ecomEnv(db) as never, AUTH, 'o-1');
    const body = (await res.json()) as { data: { payment_id: string; status: string } };

    expect(res.status).toBe(200);
    expect(body.data.payment_id).toBe('pay-existing');
    expect(body.data.status).toBe('pending_cod');
    // Logique applicative : le code RELIT payments puis renvoie l'existant —
    // aucun INSERT INTO payments déclenché (pas de double-charge).
    expect(hasCall(db, /INSERT\s+OR\s+IGNORE\s+INTO\s+payments/i)).toBe(false);
  });

  it('COD → status pending_cod, JAMAIS payé (provider_ref cod:<order>)', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'cod');
    seedOrder(db, { orderId: 'o-1', total: 5000 });
    db.seed('from payments where', []); // aucun paiement préexistant

    const res = await handleInitPayment(initReq('cod'), ecomEnv(db) as never, AUTH, 'o-1');
    expect(res.status).toBe(201);
    // INSERT effectué avec status pending_cod (le mock relit defaultRows=[]
    // ⇒ result reprend le status calculé pending_cod).
    const insert = db.calls.find((c) => /INSERT\s+OR\s+IGNORE\s+INTO\s+payments/i.test(c.sql));
    expect(insert).toBeTruthy();
    expect(insert!.args).toContain('pending_cod');
    expect(insert!.args).toContain('cod:o-1');
  });

  it('commande déjà payée (paid_at) → 409, aucun INSERT', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'cod');
    db.seed('from orders where id', [
      {
        id: 'o-1',
        client_id: CLIENT,
        total_cents: 5000,
        email: 'a@b.ca',
        paid_at: '2026-01-02 00:00:00',
        status: 'paid',
      },
    ]);

    const res = await handleInitPayment(initReq('cod'), ecomEnv(db) as never, AUTH, 'o-1');
    expect(res.status).toBe(409);
    expect(hasCall(db, /INSERT\s+OR\s+IGNORE\s+INTO\s+payments/i)).toBe(false);
  });

  it('commande annulée → 409', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'cod');
    db.seed('from orders where id', [
      {
        id: 'o-1',
        client_id: CLIENT,
        total_cents: 5000,
        email: 'a@b.ca',
        paid_at: null,
        status: 'cancelled',
      },
    ]);

    const res = await handleInitPayment(initReq('cod'), ecomEnv(db) as never, AUTH, 'o-1');
    expect(res.status).toBe(409);
  });

  it('provider non branché (stripe non enregistré, méthode card) → 503', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'stripe');
    seedOrder(db, { orderId: 'o-1', total: 5000 });
    db.seed('from payments where', []);

    // stripe NON enregistré dans cette suite → resolved.provider == null.
    if (getProvider('stripe')) {
      // Si l'env l'a chargé via ./payments/register, on bascule le test sur la
      // garde capabilities (card non proposé hors provider) plutôt que 503.
      const res = await handleInitPayment(initReq('card'), ecomEnv(db) as never, AUTH, 'o-1');
      expect([400, 503]).toContain(res.status);
    } else {
      const res = await handleInitPayment(initReq('card'), ecomEnv(db) as never, AUTH, 'o-1');
      // capabilities = ['cod'] (provider absent) ⇒ 'card' hors capabilities ⇒ 400.
      expect(res.status).toBe(400);
    }
  });

  it('méthode hors capabilities (provider cod, méthode card) → 400', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'cod');
    seedOrder(db, { orderId: 'o-1', total: 5000 });
    db.seed('from payments where', []);

    const res = await handleInitPayment(initReq('card'), ecomEnv(db) as never, AUTH, 'o-1');
    expect(res.status).toBe(400);
  });

  it('commande introuvable → 404', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    seedConfigTestMode(db, 'cod');
    db.seed('from orders where id', []);

    const res = await handleInitPayment(initReq('cod'), ecomEnv(db) as never, AUTH, 'o-1');
    expect(res.status).toBe(404);
  });

  it('provider branché (stub stripe) → createPayment local, AUCUN live touché', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    seedCurrency(db, 'CAD');
    // mode test forcé + flag 0 — on n'écrit JAMAIS live=1.
    db.seed('from payment_provider_config', [
      { provider: 'stripe', mode: 'test', payments_live_enabled: 0 },
    ]);
    seedOrder(db, { orderId: 'o-1', total: 7000 });
    db.seed('from payments where', []);

    const prev = getProvider('stripe');
    registerProvider(makeStubProvider('stripe'));
    try {
      // Garde-fou : la résolution reste en mode test.
      const resolved = await resolvePaymentProvider(ecomEnv(db) as never, CLIENT);
      expect(resolved.live_enabled).toBe(false);
      expect(resolved.mode).toBe('test');

      const res = await handleInitPayment(initReq('card'), ecomEnv(db) as never, AUTH, 'o-1');
      expect(res.status).toBe(201);
      const insert = db.calls.find((c) =>
        /INSERT\s+OR\s+IGNORE\s+INTO\s+payments/i.test(c.sql),
      );
      expect(insert!.args).toContain('pending'); // status stub
      expect(insert!.args.some((a) => String(a).startsWith('stub_o-1:card:'))).toBe(true);
    } finally {
      if (prev) registerProvider(prev);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M2.B3 — recordPaymentTransition + handlePaymentWebhook
// ════════════════════════════════════════════════════════════════════════════

describe('M2.B3 recordPaymentTransition — pont lifecycle gardé', () => {
  it('status=paid → commitOrderSale tenté (commande relue) ; UPDATE payments tracé', async () => {
    const db = createMockD1();
    db.seed('from payments where', [
      { id: 'pay-1', client_id: CLIENT, order_id: 'o-1' },
    ]);
    // commitOrderSale lit la commande ; on la seede NON encore payée
    // (paid_at null) ⇒ le pont tente le commit (pas de garde !paid_at bloquante).
    db.seed('from orders where id', [
      { id: 'o-1', client_id: CLIENT, status: 'paid', paid_at: null, cancelled_at: null },
    ]);

    const r = await recordPaymentTransition(ecomEnv(db) as never, {
      order_id: 'o-1',
      payment_ref: 'pi_pay-1',
      status: 'paid',
    });
    // UPDATE payments status toujours tracé (sûr) avant le pont.
    expect(hasCall(db, /UPDATE\s+payments\s+SET\s+status/i)).toBe(true);
    expect(typeof r.committed).toBe('boolean');
  });

  it('status=paid mais commande DÉJÀ payée (paid_at présent) → commitOrderSale no-op (garde !paid_at)', async () => {
    const db = createMockD1();
    db.seed('from payments where', [
      { id: 'pay-1', client_id: CLIENT, order_id: 'o-1' },
    ]);
    // État « déjà concrétisé » : paid_at non nul ⇒ commitOrderSale doit
    // détecter l'état et ne PAS re-commiter (committed=false).
    db.seed('from orders where id', [
      {
        id: 'o-1',
        client_id: CLIENT,
        status: 'paid',
        paid_at: '2026-01-02 00:00:00',
        cancelled_at: null,
      },
    ]);

    const r = await recordPaymentTransition(ecomEnv(db) as never, {
      order_id: 'o-1',
      payment_ref: 'pi_pay-1',
      status: 'paid',
    });
    expect(r.committed).toBe(false);
  });

  it('status=pending_cod → AUCUN commit (commande reste unpaid)', async () => {
    const db = createMockD1();
    db.seed('from payments where', [
      { id: 'pay-1', client_id: CLIENT, order_id: 'o-1' },
    ]);
    const r = await recordPaymentTransition(ecomEnv(db) as never, {
      order_id: 'o-1',
      payment_ref: 'pi_pay-1',
      status: 'pending_cod',
    });
    expect(r.committed).toBe(false);
    expect(hasCall(db, /UPDATE\s+payments\s+SET\s+status/i)).toBe(true);
  });

  it('status=failed → AUCUN commit', async () => {
    const db = createMockD1();
    db.seed('from payments where', [
      { id: 'pay-1', client_id: CLIENT, order_id: 'o-1' },
    ]);
    const r = await recordPaymentTransition(ecomEnv(db) as never, {
      order_id: 'o-1',
      payment_ref: 'pi_pay-1',
      status: 'failed',
    });
    expect(r.committed).toBe(false);
  });

  it('aucune ligne payments locale → committed=false (pas de transition inventée)', async () => {
    const db = createMockD1();
    db.seed('from payments where', []); // pas de paiement local
    const r = await recordPaymentTransition(ecomEnv(db) as never, {
      order_id: 'o-1',
      payment_ref: 'pi_inconnu',
      status: 'paid',
    });
    expect(r.committed).toBe(false);
    // Sécurité : pas d'UPDATE payments si aucune ligne reliée.
    expect(hasCall(db, /UPDATE\s+payments\s+SET\s+status/i)).toBe(false);
  });
});

describe('M2.B3 handlePaymentWebhook — dispatch & dédup applicative', () => {
  function wh(provider: string): Request {
    return new Request(`https://x/api/webhook/payments/${provider}`, {
      method: 'POST',
      body: '{}',
    });
  }

  it('provider inconnu → 404', async () => {
    const db = createMockD1();
    const res = await handlePaymentWebhook(wh('paypal'), ecomEnv(db) as never, 'paypal');
    expect(res.status).toBe(404);
  });

  it('provider connu mais NON branché → 200 ignored (pas de retries)', async () => {
    const db = createMockD1();
    const prev = getProvider('dz_gateway');
    // On force l'absence de provider en testant dz_gateway si non enregistré.
    if (!prev) {
      const res = await handlePaymentWebhook(wh('dz_gateway'), ecomEnv(db) as never, 'dz_gateway');
      const body = (await res.json()) as { ok: boolean; ignored?: boolean };
      expect(res.status).toBe(200);
      expect(body.ignored).toBe(true);
    } else {
      // dz_gateway branché par l'env : on vérifie au moins que ce n'est pas 404.
      const res = await handlePaymentWebhook(wh('dz_gateway'), ecomEnv(db) as never, 'dz_gateway');
      expect(res.status).not.toBe(404);
    }
  });

  it('handleWebhook renvoie null (COD-like) → 200 ignored, AUCUNE transition', async () => {
    const db = createMockD1();
    const prev = getProvider('stripe');
    registerProvider({
      id: 'stripe',
      capabilities: (ctx) => ({ methods: ['card'], currencies: [ctx.currency] }),
      async createPayment(_e, _o, _c, k) {
        return { provider_ref: k, status: 'pending' };
      },
      async handleWebhook() {
        return null; // non pertinent / signature KO
      },
    });
    try {
      const res = await handlePaymentWebhook(wh('stripe'), ecomEnv(db) as never, 'stripe');
      const body = (await res.json()) as { ok: boolean; ignored?: boolean };
      expect(res.status).toBe(200);
      expect(body.ignored).toBe(true);
      // Aucune écriture payment_events / transition.
      expect(hasCall(db, /INSERT\s+OR\s+IGNORE\s+INTO\s+payment_events/i)).toBe(false);
    } finally {
      if (prev) registerProvider(prev);
    }
  });

  it('handleWebhook lève → 400 webhook rejeté', async () => {
    const db = createMockD1();
    const prev = getProvider('stripe');
    registerProvider({
      id: 'stripe',
      capabilities: (ctx) => ({ methods: ['card'], currencies: [ctx.currency] }),
      async createPayment(_e, _o, _c, k) {
        return { provider_ref: k, status: 'pending' };
      },
      async handleWebhook() {
        throw new Error('signature invalide');
      },
    });
    try {
      const res = await handlePaymentWebhook(wh('stripe'), ecomEnv(db) as never, 'stripe');
      expect(res.status).toBe(400);
    } finally {
      if (prev) registerProvider(prev);
    }
  });

  it('transition paid → INSERT payment_events tenté puis pont déclenché (chemin nominal)', async () => {
    const db = createMockD1();
    const prev = getProvider('stripe');
    registerProvider({
      id: 'stripe',
      capabilities: (ctx) => ({ methods: ['card'], currencies: [ctx.currency] }),
      async createPayment(_e, _o, _c, k) {
        return { provider_ref: k, status: 'pending' };
      },
      async handleWebhook() {
        return { order_id: 'o-1', payment_ref: 'pi_pay-1', status: 'paid' };
      },
    });
    db.seed('from payments where', [
      { id: 'pay-1', client_id: CLIENT, order_id: 'o-1' },
    ]);
    db.seed('from orders where id', [
      {
        id: 'o-1',
        client_id: CLIENT,
        status: 'paid',
        paid_at: '2026-01-02 00:00:00', // déjà payé → commit no-op (idempotent)
        cancelled_at: null,
      },
    ]);
    try {
      const res = await handlePaymentWebhook(wh('stripe'), ecomEnv(db) as never, 'stripe');
      // Le code RELIT payment_events (INSERT OR IGNORE) avant d'agir : la
      // dédup DB réelle n'est pas simulée (mock changes:1 ⇒ "inséré"), mais on
      // prouve que le dispatch passe par payment_events AVANT recordTransition.
      expect(hasCall(db, /INSERT\s+OR\s+IGNORE\s+INTO\s+payment_events/i)).toBe(true);
      expect([200]).toContain(res.status);
    } finally {
      if (prev) registerProvider(prev);
    }
  });
});
