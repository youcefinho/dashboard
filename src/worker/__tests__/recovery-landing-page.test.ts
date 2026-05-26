// ── recovery-landing-page.test.ts — Sprint 40 Agent C3 ─────────────────────
// Tests vitest pour handleRecoveryLandingPage (abandoned-carts.ts).
// Handler PUBLIC : GET /api/recovery/:cartToken/:step → 302 redirect vers
// /storefront/checkout?cart=...[&coupon=...] avec reposition cart 'active'.
//
// 5 cas couverts :
//   1. GET valide                       → 302 + Location coupon + UPDATE active
//   2. Token invalide (cart introuvable)→ 404
//   3. Step > sent_count                → 410 Gone
//   4. Cart déjà recovered (idempotent) → 302 vers checkout SANS coupon
//   5. Cross-tenant (cart_token global) → pas de fuite, juste redirect
//
// Mock D1 vi minimal qui répond au SELECT cart + UPDATE status + SELECT now +
// UPDATE recovery_attempts_json. Aucun réseau réel.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../types';
import { handleRecoveryLandingPage } from '../abandoned-carts';

// ── Mock D1 ────────────────────────────────────────────────────────────────
interface CartRow {
  id: string;
  client_id: string;
  status: string;
  recovery_discount_code: string | null;
  recovery_email_sent_count: number | null;
  recovery_completed_at: string | null;
  recovery_attempts_json: string | null;
}

interface MockDb {
  prepare: ReturnType<typeof vi.fn>;
  __calls: Array<{ sql: string; args: unknown[] }>;
}

function makeDb(opts: { cart?: CartRow | null }): MockDb {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      let boundArgs: unknown[] = [];
      const lower = sql.toLowerCase();
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        first: vi.fn(async () => {
          calls.push({ sql, args: boundArgs });
          // SELECT cart par cart_token (lookup principal).
          if (
            lower.includes('from carts') &&
            lower.includes('where cart_token')
          ) {
            return opts.cart ?? null;
          }
          // SELECT datetime('now') — pour stamping clicked_at.
          if (lower.includes("datetime('now')") && lower.includes('select')) {
            return { now: '2026-05-24 12:00:00' };
          }
          return null;
        }),
        all: vi.fn(async () => {
          calls.push({ sql, args: boundArgs });
          return { results: [] };
        }),
        run: vi.fn(async () => {
          calls.push({ sql, args: boundArgs });
          return { success: true, meta: { changes: 1, last_row_id: 1 } };
        }),
      };
      return stmt;
    }),
    __calls: calls,
  } as MockDb;
  return db;
}

function makeEnv(cart: CartRow | null): { env: Env; db: MockDb } {
  const db = makeDb({ cart });
  const env = { DB: db } as unknown as Env;
  return { env, db };
}

function getReq(cartToken: string): Request {
  return new Request(`https://app.example.com/api/recovery/${cartToken}/2`, {
    method: 'GET',
  });
}

// ── Reset ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
describe('S40 C3 — handleRecoveryLandingPage', () => {
  // ── 1. GET valide → 302 + redirect + UPDATE active ──────────────────────
  it('GET valide → 302 redirect avec coupon + cart repassé en active', async () => {
    const cart: CartRow = {
      id: 'c1',
      client_id: 'cli_A',
      status: 'abandoned',
      recovery_discount_code: 'REC-tok123-2',
      recovery_email_sent_count: 2,
      recovery_completed_at: null,
      recovery_attempts_json: JSON.stringify([
        { step: 1, channel: 'email', ts: '2026-05-22 10:00:00', coupon_code: null, opened_at: null, clicked_at: null },
        { step: 2, channel: 'email', ts: '2026-05-23 10:00:00', coupon_code: 'REC-tok123-2', opened_at: null, clicked_at: null },
      ]),
    };
    const { env, db } = makeEnv(cart);

    const req = getReq('tok123');
    const res = await handleRecoveryLandingPage(req, env, 'tok123', '2');

    expect(res.status).toBe(302);
    const location = res.headers.get('Location') || '';
    expect(location).toContain('/storefront/checkout?cart=tok123');
    expect(location).toContain('coupon=REC-tok123-2');

    // Vérifie qu'un UPDATE status='active' a bien été émis.
    const updateActive = db.__calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update carts') &&
        c.sql.toLowerCase().includes("status = 'active'"),
    );
    expect(updateActive).toBeDefined();
    expect(updateActive?.args[0]).toBe('c1');
  });

  // ── 2. Token invalide → 404 ──────────────────────────────────────────────
  it('Token invalide → 404 Panier introuvable', async () => {
    const { env } = makeEnv(null);

    const req = getReq('badtoken');
    const res = await handleRecoveryLandingPage(req, env, 'badtoken', '1');

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/introuvable/i);
  });

  // ── 3. Step > sent_count → 410 Gone ──────────────────────────────────────
  it('Step > sent_count → 410 Gone (lien jamais envoyé)', async () => {
    const cart: CartRow = {
      id: 'c1',
      client_id: 'cli_A',
      status: 'abandoned',
      recovery_discount_code: 'REC-tok123-1',
      recovery_email_sent_count: 1, // step 3 jamais envoyé
      recovery_completed_at: null,
      recovery_attempts_json: JSON.stringify([
        { step: 1, channel: 'email', ts: '2026-05-22 10:00:00', coupon_code: null, opened_at: null, clicked_at: null },
      ]),
    };
    const { env, db } = makeEnv(cart);

    const req = new Request('https://app.example.com/api/recovery/tok123/3', {
      method: 'GET',
    });
    const res = await handleRecoveryLandingPage(req, env, 'tok123', '3');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/expir|envoy/i);

    // Pas d'UPDATE status='active' émis dans ce cas (early return).
    const updateActive = db.__calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update carts') &&
        c.sql.toLowerCase().includes("status = 'active'"),
    );
    expect(updateActive).toBeUndefined();
  });

  // ── 4. Cart déjà recovered → 302 SANS coupon (idempotent) ───────────────
  it('Cart déjà recovered → 302 vers checkout SANS réappliquer coupon', async () => {
    const cart: CartRow = {
      id: 'c1',
      client_id: 'cli_A',
      status: 'completed',
      recovery_discount_code: 'REC-tok123-2',
      recovery_email_sent_count: 2,
      recovery_completed_at: '2026-05-23T00:00:00Z',
      recovery_attempts_json: JSON.stringify([
        { step: 1, channel: 'email', ts: '2026-05-22 10:00:00', coupon_code: null, opened_at: null, clicked_at: '2026-05-22 11:00:00' },
        { step: 2, channel: 'email', ts: '2026-05-23 10:00:00', coupon_code: 'REC-tok123-2', opened_at: null, clicked_at: '2026-05-23 11:00:00' },
      ]),
    };
    const { env, db } = makeEnv(cart);

    const req = getReq('tok123');
    const res = await handleRecoveryLandingPage(req, env, 'tok123', '2');

    expect(res.status).toBe(302);
    const location = res.headers.get('Location') || '';
    expect(location).toContain('/storefront/checkout?cart=tok123');
    // PAS de coupon dans l'URL (idempotent, déjà recovered).
    expect(location).not.toContain('coupon=');

    // Pas d'UPDATE status='active' émis (early return après recovered_at).
    const updateActive = db.__calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update carts') &&
        c.sql.toLowerCase().includes("status = 'active'"),
    );
    expect(updateActive).toBeUndefined();
  });

  // ── 5. Cross-tenant impossible (cart_token UNIQUE global) ───────────────
  it('Cross-tenant via cart_token UNIQUE → pas de fuite info tenant', async () => {
    // Le cart appartient à cli_B mais l'URL est PUBLIC (pas d'auth).
    // Le lookup ramène le bon cart, on vérifie que la response ne fuite
    // RIEN d'autre que le redirect (ni client_id, ni cart.id, ni status).
    const cart: CartRow = {
      id: 'c-secret-id-internal',
      client_id: 'cli_B',
      status: 'abandoned',
      recovery_discount_code: 'REC-tok-cli-B-xyz-1',
      recovery_email_sent_count: 1,
      recovery_completed_at: null,
      recovery_attempts_json: JSON.stringify([
        { step: 1, channel: 'email', ts: '2026-05-23 10:00:00', coupon_code: 'REC-tok-cli-B-xyz-1', opened_at: null, clicked_at: null },
      ]),
    };
    const { env } = makeEnv(cart);

    const req = new Request(
      'https://app.example.com/api/recovery/tok-cli-B-xyz/1',
      { method: 'GET' },
    );
    const res = await handleRecoveryLandingPage(req, env, 'tok-cli-B-xyz', '1');

    expect(res.status).toBe(302);
    const location = res.headers.get('Location') || '';

    // Redirect attendu : juste cart=token + coupon.
    expect(location).toContain('/storefront/checkout?cart=tok-cli-B-xyz');
    expect(location).toContain('coupon=REC-tok-cli-B-xyz-1');

    // Aucune fuite cross-tenant : ni client_id, ni cart.id interne, ni status
    // dans l'URL ou les headers.
    expect(location).not.toContain('cli_B');
    expect(location).not.toContain('c-secret-id-internal');
    expect(location).not.toContain('abandoned');

    // Body vide pour un 302 (pas de JSON contenant des champs tenant).
    const bodyText = await res.text();
    expect(bodyText).toBe('');
  });
});
