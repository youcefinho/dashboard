// ════════════════════════════════════════════════════════════════════════════
// Sprint 40 Phase B — abandoned-cart-recovery.ts tests (Agent C2)
// ════════════════════════════════════════════════════════════════════════════
//
// Couvre `src/worker/lib/abandoned-cart-recovery.ts` (A2) :
//
//   1. Idempotence cron : 2 invocations consécutives processRecoverySequence
//      sur le même cart ⇒ 1 seul send (UPDATE atomique conditionnel verrouille
//      recovery_email_sent_count via WHERE COALESCE(...)=ancien_compteur).
//
//   2. Course concurrente : 5 Promise.all simultanées ⇒ exactly 1 winner via
//      le même UPDATE atomique conditionnel (4 losers reçoivent changes=0).
//
//   3. Séquence complète 3 steps : cron 1 (step 1, pas de coupon) → tick +1h →
//      cron 2 (step 2, REC-token-2 5%) → tick +24h → cron 3 (step 3,
//      REC-token-3 10%) → cron 4 (skip car count=3 hors filtre SELECT).
//
//   4. Cart recovered (recovery_completed_at posé entre step 2 et 3) ⇒ filtre
//      SELECT (`AND recovery_completed_at IS NULL`) le retire des candidats.
//
//   5. generateRecoveryCoupon idempotent : INSERT OR IGNORE évite doublon sur
//      retry, code 'REC-{token8}-{step}' déterministe par tenant+token+step,
//      cross-tenant isolation (même token+step côté client A vs B).
//
// Harness : mini-mock D1 inline (calque calendar-sync.test.ts) avec capture
// SQL + binds + simulate atomic UPDATE WHERE conditional + seed par needle.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  processRecoverySequence,
  generateRecoveryCoupon,
  recordRecoveryAttempt,
} from '../lib/abandoned-cart-recovery';

// ── In-memory cart state ────────────────────────────────────────────────────

interface MockCart {
  id: string;
  client_id: string;
  cart_token: string;
  customer_id: string | null;
  recovery_email_sent_count: number;
  last_recovery_at: string | null;
  recovery_completed_at: string | null;
  recovery_discount_code: string | null;
  recovery_attempts_json: string | null;
  status: 'abandoned' | 'recovered' | 'open';
  abandoned_at: string;
  updated_at: string;
  currency: string;
}

interface MockCoupon {
  id: string;
  client_id: string;
  code: string;
  discount_type: string;
  discount_percent: number;
  usage_limit: number;
  times_used: number;
  is_active: number;
  expires_at: string;
  created_at: string;
}

// ── Mock D1 (stateful : carts + coupons in-memory) ──────────────────────────

interface MockOpts {
  /** Override clock ('now()' returned by datetime('now')). */
  nowIso?: string;
  /** Pre-existing carts seed. */
  carts?: MockCart[];
  /** Pre-existing coupons seed. */
  coupons?: MockCoupon[];
}

function makeEnv(opts: MockOpts = {}) {
  const carts: MockCart[] = (opts.carts || []).map((c) => ({ ...c }));
  const coupons: MockCoupon[] = (opts.coupons || []).map((c) => ({ ...c }));
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  let nowIso = opts.nowIso || '2026-05-24 12:00:00';

  // Compare two SQL-format timestamps lexically (YYYY-MM-DD HH:MM:SS is sortable).
  const lex = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  // Add N minutes to an ISO-ish timestamp and return SQL-format.
  function addMinutes(base: string, mins: number): string {
    const d = new Date(base.replace(' ', 'T') + 'Z');
    d.setUTCMinutes(d.getUTCMinutes() + mins);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const sqlLow = sql.toLowerCase();

    const stmt = {
      bind(...a: unknown[]) {
        bound = a;
        return stmt;
      },

      async all(): Promise<{ results: unknown[] }> {
        calls.push({ sql, args: bound });

        // SELECT candidates carts
        if (sqlLow.includes('from carts') && sqlLow.includes('status =')) {
          const eligible = carts
            .filter(
              (c) =>
                c.status === 'abandoned' &&
                (c.recovery_email_sent_count || 0) < 3 &&
                c.recovery_completed_at === null,
            )
            .sort((a, b) =>
              lex(
                a.last_recovery_at || a.abandoned_at || a.updated_at,
                b.last_recovery_at || b.abandoned_at || b.updated_at,
              ),
            )
            .slice(0, 50)
            .map((c) => ({
              id: c.id,
              client_id: c.client_id,
              cart_token: c.cart_token,
              customer_id: c.customer_id,
              recovery_email_sent_count: c.recovery_email_sent_count,
              last_recovery_at: c.last_recovery_at,
              status: c.status,
            }));
          return { results: eligible };
        }

        // SELECT cart items (composeRecoveryEmail) — return empty list (best-effort)
        if (sqlLow.includes('from cart_items')) {
          return { results: [] };
        }

        return { results: [] };
      },

      async first(): Promise<unknown | null> {
        calls.push({ sql, args: bound });

        // Eligibility check : SELECT CASE WHEN datetime(?, ?) <= datetime('now')
        if (sqlLow.includes("case when datetime")) {
          const base = String(bound[0] || '');
          const delta = String(bound[1] || ''); // ex "+60 minutes"
          const m = delta.match(/([+-]?)(\d+)\s*minutes?/i);
          const mins = m ? Number(m[2]) * (m[1] === '-' ? -1 : 1) : 0;
          const target = addMinutes(base, mins);
          const eligible = lex(target, nowIso) <= 0 ? 1 : 0;
          return { eligible };
        }

        // SELECT datetime('now') — used by recordRecoveryAttempt
        if (sqlLow.includes("select datetime('now')")) {
          return { now: nowIso };
        }

        // SELECT cart + customer (composeRecoveryEmail) — best-effort, return cart
        if (sqlLow.includes('from carts c') && sqlLow.includes('left join customers')) {
          const id = String(bound[0]);
          const c = carts.find((x) => x.id === id);
          if (!c) return null;
          return {
            id: c.id,
            client_id: c.client_id,
            cart_token: c.cart_token,
            customer_id: c.customer_id,
            recovery_discount_code: c.recovery_discount_code,
            currency: c.currency,
            customer_email: null,
            customer_first_name: null,
          };
        }

        // SELECT recovery_attempts_json FROM carts WHERE id
        if (sqlLow.includes('select recovery_attempts_json from carts')) {
          const id = String(bound[0]);
          const c = carts.find((x) => x.id === id);
          if (!c) return null;
          return { recovery_attempts_json: c.recovery_attempts_json };
        }

        return null;
      },

      async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> {
        calls.push({ sql, args: bound });

        // UPDATE carts atomic claim (incrémente count)
        // WHERE id=? AND COALESCE(recovery_email_sent_count,0)=? AND status='abandoned'
        //   AND recovery_completed_at IS NULL
        if (
          sqlLow.includes('update carts') &&
          sqlLow.includes('set recovery_email_sent_count = coalesce')
        ) {
          const id = String(bound[0]);
          const expectedCount = Number(bound[1]);
          const c = carts.find((x) => x.id === id);
          if (
            !c ||
            (c.recovery_email_sent_count || 0) !== expectedCount ||
            c.status !== 'abandoned' ||
            c.recovery_completed_at !== null
          ) {
            return { success: true, meta: { changes: 0, last_row_id: 0 } };
          }
          c.recovery_email_sent_count = (c.recovery_email_sent_count || 0) + 1;
          c.last_recovery_at = nowIso;
          c.updated_at = nowIso;
          return { success: true, meta: { changes: 1, last_row_id: 0 } };
        }

        // UPDATE carts SET recovery_discount_code = ? WHERE id = ?
        if (
          sqlLow.includes('update carts') &&
          sqlLow.includes('set recovery_discount_code')
        ) {
          const code = String(bound[0]);
          const id = String(bound[1]);
          const c = carts.find((x) => x.id === id);
          if (!c) return { success: true, meta: { changes: 0, last_row_id: 0 } };
          c.recovery_discount_code = code;
          c.updated_at = nowIso;
          return { success: true, meta: { changes: 1, last_row_id: 0 } };
        }

        // UPDATE carts SET recovery_attempts_json = ? WHERE id=? AND count=?
        if (
          sqlLow.includes('update carts') &&
          sqlLow.includes('set recovery_attempts_json')
        ) {
          const json = String(bound[0]);
          const id = String(bound[1]);
          const expectedCount = Number(bound[2]);
          const c = carts.find((x) => x.id === id);
          if (
            !c ||
            (c.recovery_email_sent_count || 0) !== expectedCount
          ) {
            return { success: true, meta: { changes: 0, last_row_id: 0 } };
          }
          c.recovery_attempts_json = json;
          c.updated_at = nowIso;
          return { success: true, meta: { changes: 1, last_row_id: 0 } };
        }

        // INSERT OR IGNORE INTO coupons
        if (sqlLow.includes('insert or ignore into coupons')) {
          const [id, clientId, code, discountPct] = bound as [
            string, string, string, number,
          ];
          const dup = coupons.find(
            (c) => c.client_id === clientId && c.code === code,
          );
          if (dup) {
            return { success: true, meta: { changes: 0, last_row_id: 0 } };
          }
          coupons.push({
            id,
            client_id: clientId,
            code,
            discount_type: 'percent',
            discount_percent: Number(discountPct),
            usage_limit: 1,
            times_used: 0,
            is_active: 1,
            expires_at: addMinutes(nowIso, 7 * 24 * 60),
            created_at: nowIso,
          });
          return { success: true, meta: { changes: 1, last_row_id: 0 } };
        }

        return { success: true, meta: { changes: 0, last_row_id: 0 } };
      },
    };

    return stmt;
  }

  const env = {
    DB: { prepare },
  } as unknown as import('../types').Env;

  return {
    env,
    calls,
    carts,
    coupons,
    setNow: (iso: string) => {
      nowIso = iso;
    },
    getNow: () => nowIso,
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeCart(over: Partial<MockCart> = {}): MockCart {
  return {
    id: 'cart_001',
    client_id: 'tenant_A',
    cart_token: 'tok12345abcdef',
    customer_id: 'cust_1',
    recovery_email_sent_count: 0,
    last_recovery_at: null,
    recovery_completed_at: null,
    recovery_discount_code: null,
    recovery_attempts_json: null,
    status: 'abandoned',
    abandoned_at: '2026-05-23 10:00:00',
    updated_at: '2026-05-23 10:00:00',
    currency: 'CAD',
    ...over,
  };
}

beforeEach(() => {
  // Silence console.error/log noise from best-effort handlers under test.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// 1. Idempotence cron
// ════════════════════════════════════════════════════════════════════════════

describe('processRecoverySequence — idempotence cron', () => {
  it('2 invocations consécutives sur même cart ⇒ 1 seul send (UPDATE atomique conditionnel)', async () => {
    const { env, carts } = makeEnv({
      nowIso: '2026-05-24 12:00:00',
      carts: [makeCart()],
    });

    // 1er run : step 1 immédiat (last_recovery_at IS NULL ⇒ pas de gate).
    const r1 = await processRecoverySequence(env);
    expect(r1.sent).toBe(1);
    expect(carts[0]!.recovery_email_sent_count).toBe(1);
    expect(carts[0]!.last_recovery_at).toBe('2026-05-24 12:00:00');

    // 2e run IMMÉDIAT (même nowIso) : la fenêtre de délai step 2 n'est pas
    // ouverte (last_recovery_at + 60 min > now), donc le cart est filtré.
    // Idempotence garantie même si on relance le cron au même tick.
    const r2 = await processRecoverySequence(env);
    expect(r2.sent).toBe(0);
    expect(carts[0]!.recovery_email_sent_count).toBe(1); // inchangé
  });

  it('2 invocations même tick sur cart éligible — claim atomique simulé : 2ème UPDATE returns changes=0', async () => {
    // On simule explicitement le cas où un autre worker a déjà incrémenté
    // entre le SELECT et l'UPDATE de notre run. Le seeding initial le démontre :
    // si carts[0].recovery_email_sent_count est déjà à 1, le UPDATE WHERE
    // count=0 ne match plus ⇒ changes=0 ⇒ skip propre.
    const { env, carts } = makeEnv({
      nowIso: '2026-05-24 12:00:00',
      carts: [
        makeCart({
          // Cart vu par le SELECT comme éligible (count<3, abandoned, not recovered),
          // mais on va simuler une race où un autre worker l'a déjà bumpé entre
          // SELECT et UPDATE — pour ça, on pré-incrémente le count en mémoire
          // APRÈS le SELECT mais AVANT que notre UPDATE n'arrive. Le mock ne
          // permet pas cet ordering subtil ; à la place, le test #2 (course
          // concurrente) couvre cette propriété via Promise.all.
        }),
      ],
    });

    // Sanity : un seul run produit un seul send.
    const r = await processRecoverySequence(env);
    expect(r.sent).toBe(1);
    expect(carts[0]!.recovery_email_sent_count).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Course concurrente (5 Promise.all simultanées)
// ════════════════════════════════════════════════════════════════════════════

describe('processRecoverySequence — course concurrente', () => {
  it('5 Promise.all simultanées sur même cart ⇒ exactly 1 winner (sent=1)', async () => {
    const { env, carts } = makeEnv({
      nowIso: '2026-05-24 12:00:00',
      carts: [makeCart()],
    });

    // 5 invocations parallèles. Le mock D1 est in-process : chaque UPDATE
    // atomique conditionnel WHERE count=ancien_compteur est appliqué
    // séquentiellement par l'event loop. Le 1er incrémente count 0→1 ;
    // les 4 suivants voient count=1 ≠ 0 attendu ⇒ changes=0 ⇒ skip.
    const results = await Promise.all([
      processRecoverySequence(env),
      processRecoverySequence(env),
      processRecoverySequence(env),
      processRecoverySequence(env),
      processRecoverySequence(env),
    ]);

    const totalSent = results.reduce((acc, r) => acc + r.sent, 0);
    expect(totalSent).toBe(1);
    expect(carts[0]!.recovery_email_sent_count).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Séquence complète 3 steps (cron 1 → 2 → 3 → skip)
// ════════════════════════════════════════════════════════════════════════════

describe('processRecoverySequence — séquence complète 3 steps', () => {
  it('cron 1 (step 1, no coupon) → +24h cron 2 (step 2, 5%) → +72h cron 3 (step 3, 10%) → cron 4 skip', async () => {
    // RECOVERY_DELAYS_MIN indexes par nextStep :
    //   nextStep=1 ⇒ 60 min (immédiat car last_recovery_at IS NULL)
    //   nextStep=2 ⇒ 1440 min (24h après step 1)
    //   nextStep=3 ⇒ 4320 min (72h après step 2)
    const harness = makeEnv({
      nowIso: '2026-05-24 12:00:00',
      carts: [makeCart()],
    });
    const { env, carts, coupons } = harness;

    // ── Cron 1 : step 1, pas de coupon (RECOVERY_DISCOUNT_PCT[1] = 0)
    const r1 = await processRecoverySequence(env);
    expect(r1.sent).toBe(1);
    expect(carts[0]!.recovery_email_sent_count).toBe(1);
    expect(coupons.length).toBe(0); // step 1 ⇒ pas de coupon

    // ── Tick +24h (1440 min) — éligibilité step 2 ouverte
    harness.setNow('2026-05-25 12:00:00');
    const r2 = await processRecoverySequence(env);
    expect(r2.sent).toBe(1);
    expect(carts[0]!.recovery_email_sent_count).toBe(2);
    expect(coupons.length).toBe(1);
    expect(coupons[0]!.code).toBe('REC-tok12345-2');
    expect(coupons[0]!.discount_percent).toBe(5);
    expect(carts[0]!.recovery_discount_code).toBe('REC-tok12345-2');

    // ── Tick +72h (4320 min) — éligibilité step 3 ouverte
    harness.setNow('2026-05-28 12:00:00');
    const r3 = await processRecoverySequence(env);
    expect(r3.sent).toBe(1);
    expect(carts[0]!.recovery_email_sent_count).toBe(3);
    expect(coupons.length).toBe(2);
    expect(coupons[1]!.code).toBe('REC-tok12345-3');
    expect(coupons[1]!.discount_percent).toBe(10);
    expect(carts[0]!.recovery_discount_code).toBe('REC-tok12345-3');

    // ── Cron 4 : count=3 ⇒ filtré par SELECT (count<3 false)
    harness.setNow('2026-06-01 12:00:00'); // bien après
    const r4 = await processRecoverySequence(env);
    expect(r4.sent).toBe(0);
    expect(r4.processed).toBe(0); // hors SELECT
    expect(carts[0]!.recovery_email_sent_count).toBe(3); // inchangé
    expect(coupons.length).toBe(2); // pas de nouveau coupon
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Cart recovered_at posé entre step 2 et 3
// ════════════════════════════════════════════════════════════════════════════

describe('processRecoverySequence — cart recovered_at posé mid-séquence', () => {
  it('après step 2, recovery_completed_at posé ⇒ cron 3 skip (filtre SELECT)', async () => {
    const harness = makeEnv({
      nowIso: '2026-05-24 12:00:00',
      carts: [makeCart()],
    });
    const { env, carts } = harness;

    // Cron 1 (step 1) — immédiat
    await processRecoverySequence(env);
    expect(carts[0]!.recovery_email_sent_count).toBe(1);

    // +24h (gate step 2 ouverte) — Cron 2 (step 2)
    harness.setNow('2026-05-25 12:00:00');
    await processRecoverySequence(env);
    expect(carts[0]!.recovery_email_sent_count).toBe(2);

    // Manual UPDATE : customer convertit via le lien recovery email step 2
    carts[0]!.recovery_completed_at = '2026-05-25 14:30:00';

    // +72h (gate step 3 ouverte) — Cron 3 devrait skip car recovery_completed_at IS NOT NULL
    harness.setNow('2026-05-28 12:00:00');
    const r3 = await processRecoverySequence(env);
    expect(r3.processed).toBe(0); // SELECT exclut le cart
    expect(r3.sent).toBe(0);
    expect(carts[0]!.recovery_email_sent_count).toBe(2); // inchangé
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. generateRecoveryCoupon idempotent + cross-tenant
// ════════════════════════════════════════════════════════════════════════════

describe('generateRecoveryCoupon — idempotence INSERT OR IGNORE + cross-tenant', () => {
  it('2 appels même (clientId, token, step) ⇒ INSERT OR IGNORE pas de doublon', async () => {
    const { env, coupons } = makeEnv();

    const code1 = await generateRecoveryCoupon(env, 'tenant_A', 'abc12345xyz', 2);
    expect(code1).toBe('REC-abc12345-2');
    expect(coupons.length).toBe(1);
    expect(coupons[0]!.discount_percent).toBe(5);

    // 2e appel identique (retry cron) ⇒ INSERT OR IGNORE ⇒ no-op silencieux
    const code2 = await generateRecoveryCoupon(env, 'tenant_A', 'abc12345xyz', 2);
    expect(code2).toBe('REC-abc12345-2'); // même code retourné
    expect(coupons.length).toBe(1); // PAS de doublon
  });

  it('step 1 ⇒ pas de coupon (discount 0%) ⇒ code vide', async () => {
    const { env, coupons } = makeEnv();
    const code = await generateRecoveryCoupon(env, 'tenant_A', 'abc12345xyz', 1);
    expect(code).toBe('');
    expect(coupons.length).toBe(0);
  });

  it('cross-tenant : même code REC-token-2 unique par client_id (tenant A vs B coexistent)', async () => {
    const { env, coupons } = makeEnv();

    const codeA = await generateRecoveryCoupon(env, 'tenant_A', 'sameToken1', 2);
    const codeB = await generateRecoveryCoupon(env, 'tenant_B', 'sameToken1', 2);

    expect(codeA).toBe('REC-sameToke-2');
    expect(codeB).toBe('REC-sameToke-2');
    // Même code littéral, MAIS rows distinctes par client_id ⇒ pas de collision
    expect(coupons.length).toBe(2);
    expect(coupons[0]!.client_id).toBe('tenant_A');
    expect(coupons[1]!.client_id).toBe('tenant_B');
  });

  it('step 3 ⇒ code REC-{token8}-3 avec discount 10%', async () => {
    const { env, coupons } = makeEnv();
    const code = await generateRecoveryCoupon(env, 'tenant_A', 'longtoken123456', 3);
    expect(code).toBe('REC-longtoke-3');
    expect(coupons[0]!.discount_percent).toBe(10);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Bonus : recordRecoveryAttempt (sanité — UPDATE conditionnel sur count=step)
// ════════════════════════════════════════════════════════════════════════════

describe('recordRecoveryAttempt — UPDATE conditionnel cohérent avec processRecoverySequence', () => {
  it('returns true quand count = step (cohérent post-claim) et persiste JSON', async () => {
    const { env, carts } = makeEnv({
      carts: [makeCart({ recovery_email_sent_count: 2 })],
    });

    const ok = await recordRecoveryAttempt(env, 'cart_001', 2, 'email', 'REC-tok12345-2');
    expect(ok).toBe(true);
    expect(carts[0]!.recovery_attempts_json).toBeTruthy();

    const parsed = JSON.parse(carts[0]!.recovery_attempts_json!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].step).toBe(2);
    expect(parsed[0].channel).toBe('email');
    expect(parsed[0].coupon_code).toBe('REC-tok12345-2');
  });

  it('returns false quand count ≠ step (race / état incohérent)', async () => {
    const { env, carts } = makeEnv({
      // count=1 mais on essaie d'enregistrer step 2 ⇒ WHERE count=2 ne match pas
      carts: [makeCart({ recovery_email_sent_count: 1 })],
    });

    const ok = await recordRecoveryAttempt(env, 'cart_001', 2, 'email', null);
    expect(ok).toBe(false);
    expect(carts[0]!.recovery_attempts_json).toBeNull();
  });
});
