// ── Sprint 51 — Tests Sprint 44 Funnels Builder (Agent T44) ────────────────
//
// Coverage : src/worker/lib/funnel-engine.ts (engine) + src/worker/funnels-builder.ts
// (handlers REST). 10 cas couvrant le contrat figé docs/LOT-FUNNELS-S44.md §6.
//
// ── Engine (5) ─────────────────────────────────────────────────────────────
//   1. pickVariantForVisitor déterministe (même visitor_id → même variante x3).
//   2. pickVariantForVisitor split 70/30 sur 100 visiteurs (tolérance ±15).
//   3. pickVariantForVisitor liste vide → null.
//   4. computeFunnelAnalytics agrégat : steps + variants + views + conversions.
//   5. recordView best-effort : ne throw JAMAIS même si DB error.
//
// ── Handlers (5) ───────────────────────────────────────────────────────────
//   6. handleListFunnels → 200 + SELECT WHERE client_id=?.
//   7. handleCreateFunnel : slug dupliqué → 409.
//   8. handlePublishFunnel : UPDATE is_published=1 avec timestamp.
//   9. handlePublicTrackView (PUBLIC) : rate-limit OK + INSERT fb_step_views.
//  10. Cap check : sans `settings.manage` → 403.
//
// Mocks : createMockD1 (helper figé S2/S3) + vi.mock('../modules')
// + vi.mock('../lib/rate-limit'). Aucun réseau.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, type MockD1 } from './_helpers';
import type { Env } from '../types';

// ── Mocks modules (hoistés AVANT imports SUT) ──────────────────────────────

vi.mock('../modules', () => ({
  getClientModules: vi.fn(async () => ({
    clientId: 'cli_A',
    modules: [],
  })),
}));

vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    audit: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

// Imports SUT après les mocks.
import {
  pickVariantForVisitor,
  computeFunnelAnalytics,
  recordView,
  // Sprint 44 renforcement — pure helpers (additif)
  assignVariant,
  hashVisitorId,
  validateStepOrder,
  validateSplitPct,
  validateStepType,
  computeFunnelConversion,
  identifyDropoff,
  aggregateFunnelAnalytics,
  FUNNEL_STEP_TYPES,
  FUNNEL_ERROR_CODES,
} from '../lib/funnel-engine';
import {
  handleListFunnels,
  handleCreateFunnel,
  handlePublishFunnel,
  handlePublicTrackView,
  // Sprint 44 renforcement — wire-up handlers
  handleCreateStep,
  handleSetSplitPct,
  handleVisitorAssignVariant,
  handleGetAnalytics,
} from '../funnels-builder';
import { checkRateLimit } from '../lib/rate-limit';
import { getClientModules } from '../modules';
import type { FunnelStepVariant } from '../../lib/api';

// ── Fixtures partagées ─────────────────────────────────────────────────────

const CLIENT_ID = 'cli_A';
const USER_ID = 'u_admin';

function makeAuth(caps: string[] = ['settings.manage']) {
  return {
    userId: USER_ID,
    role: 'admin',
    clientId: CLIENT_ID,
    capabilities: new Set(caps),
  } as any;
}

function makeEnv(db: MockD1): Env {
  return { DB: db } as unknown as Env;
}

function makeVariant(over: Partial<FunnelStepVariant> = {}): FunnelStepVariant {
  return {
    id: over.id ?? 'v_default',
    step_id: over.step_id ?? 's_1',
    variant_name: over.variant_name ?? 'A',
    content_html: over.content_html ?? '<h1>Hello</h1>',
    traffic_pct: over.traffic_pct ?? 0.5,
    is_control: over.is_control ?? false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientModules).mockImplementation(async () => ({
    clientId: CLIENT_ID,
    modules: [] as any,
  }));
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 30,
    retry_after_seconds: 0,
    bucket_key: '',
  } as any);
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE — pickVariantForVisitor (3 cas)
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 engine — pickVariantForVisitor', () => {
  it('déterministe : même visitor_id → toujours même variante (3 appels)', () => {
    const variants: FunnelStepVariant[] = [
      makeVariant({ id: 'v_A', variant_name: 'A', traffic_pct: 0.5 }),
      makeVariant({ id: 'v_B', variant_name: 'B', traffic_pct: 0.5 }),
    ];
    const r1 = pickVariantForVisitor(variants, 'visitor_X');
    const r2 = pickVariantForVisitor(variants, 'visitor_X');
    const r3 = pickVariantForVisitor(variants, 'visitor_X');
    expect(r1).not.toBeNull();
    expect(r2?.id).toBe(r1?.id);
    expect(r3?.id).toBe(r1?.id);
    // Doit être l'une des 2 variantes (pas null/inventée).
    expect(['v_A', 'v_B']).toContain(r1?.id);
  });

  it('split 70/30 : 100 visiteurs → distribution ~70/30 (tolérance ±15)', () => {
    const variants: FunnelStepVariant[] = [
      makeVariant({ id: 'v_A', variant_name: 'A', traffic_pct: 0.7 }),
      makeVariant({ id: 'v_B', variant_name: 'B', traffic_pct: 0.3 }),
    ];
    let countA = 0;
    let countB = 0;
    for (let i = 0; i < 100; i++) {
      const chosen = pickVariantForVisitor(variants, `visitor_${i}_${i * 31}`);
      if (chosen?.id === 'v_A') countA++;
      else if (chosen?.id === 'v_B') countB++;
    }
    // Tolérance ±15 (sample 100 visiteurs).
    expect(countA + countB).toBe(100);
    expect(countA).toBeGreaterThanOrEqual(55);
    expect(countA).toBeLessThanOrEqual(85);
    expect(countB).toBeGreaterThanOrEqual(15);
    expect(countB).toBeLessThanOrEqual(45);
  });

  it('0 variants : array vide → null (caller utilise fallback HTML)', () => {
    expect(pickVariantForVisitor([], 'visitor_X')).toBeNull();
    // Tolérance defensive : undefined-like inputs ne throw pas.
    expect(pickVariantForVisitor(null as any, 'visitor_X')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE — computeFunnelAnalytics
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 engine — computeFunnelAnalytics', () => {
  it('3 steps + variants + views/conversions → breakdown + conversion_rate + top_variants', async () => {
    const db = createMockD1();
    // Steps ordonnés (order_index ASC).
    db.seed('from fb_steps', [
      { id: 's_1', name: 'Landing', step_type: 'landing', order_index: 0 },
      { id: 's_2', name: 'Optin', step_type: 'optin', order_index: 1 },
      { id: 's_3', name: 'Thank You', step_type: 'thank_you', order_index: 2 },
    ]);
    // Variants : 2 sur s_1, 1 sur s_2, 1 sur s_3.
    db.seed('from fb_step_variants', [
      { id: 'v_1A', step_id: 's_1', variant_name: 'A', is_control: 1 },
      { id: 'v_1B', step_id: 's_1', variant_name: 'B', is_control: 0 },
      { id: 'v_2A', step_id: 's_2', variant_name: 'A', is_control: 1 },
      { id: 'v_3A', step_id: 's_3', variant_name: 'A', is_control: 1 },
    ]);
    // Views par (step_id, variant_id).
    db.seed('from fb_step_views', [
      { step_id: 's_1', variant_id: 'v_1A', c: 100 },
      { step_id: 's_1', variant_id: 'v_1B', c: 100 },
      { step_id: 's_2', variant_id: 'v_2A', c: 50 },
      { step_id: 's_3', variant_id: 'v_3A', c: 20 },
    ]);
    // Conversions.
    db.seed('from fb_step_conversions', [
      { step_id: 's_1', variant_id: 'v_1A', c: 30 },
      { step_id: 's_1', variant_id: 'v_1B', c: 10 },
      { step_id: 's_2', variant_id: 'v_2A', c: 20 },
      { step_id: 's_3', variant_id: 'v_3A', c: 5 },
    ]);

    const env = makeEnv(db);
    const result = await computeFunnelAnalytics(env, 'funnel_1');

    // Shape : 3 steps_breakdown.
    expect(result.steps_breakdown).toHaveLength(3);
    expect(result.steps_breakdown[0].step_id).toBe('s_1');
    expect(result.steps_breakdown[0].views).toBe(200); // 100+100
    expect(result.steps_breakdown[0].conversions).toBe(40); // 30+10
    expect(result.steps_breakdown[0].variants).toHaveLength(2);

    // conversion_rate global = conv(step 1) / views(step 1) = 40 / 200 = 0.2.
    expect(result.conversion_rate).toBeCloseTo(0.2, 5);

    // top_variants : sorted DESC by rate, max 5. v_2A = 20/50 = 0.4 → en tête.
    expect(result.top_variants.length).toBeGreaterThan(0);
    expect(result.top_variants.length).toBeLessThanOrEqual(5);
    expect(result.top_variants[0].variant_id).toBe('v_2A');
    expect(result.top_variants[0].conversion_rate).toBeCloseTo(0.4, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE — recordView best-effort
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 engine — recordView best-effort', () => {
  it('INSERT fb_step_views ne throw pas même si DB error (table absente)', async () => {
    // DB qui throw sur tout prepare → simule "no such table: fb_step_views".
    const brokenDb = {
      prepare(): never {
        throw new Error('no such table: fb_step_views');
      },
    } as unknown as Env['DB'];
    const env = { DB: brokenDb } as unknown as Env;

    const req = new Request('https://example.com/funnels/track', {
      method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0', 'CF-IPCountry': 'CA' },
    });

    // Doit résoudre SANS jeter (contrat : best-effort).
    await expect(
      recordView(env, 's_1', 'v_1', 'visitor_X', req),
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS — handleListFunnels
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 handler — handleListFunnels', () => {
  it('SELECT WHERE client_id=? → 200 + data array', async () => {
    const db = createMockD1();
    db.seed('from fb_funnels', [
      {
        id: 'f_1',
        client_id: CLIENT_ID,
        name: 'Funnel 1',
        slug: 'funnel-1',
        description: null,
        primary_goal: 'lead_capture',
        is_published: 1,
        published_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ]);

    const env = makeEnv(db);
    const url = new URL('https://example.com/api/funnels-builder');
    const res = await handleListFunnels(env, makeAuth(), url);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('f_1');
    expect(body.data[0].is_published).toBe(true);

    // Vérif bornage tenant : le SELECT porte bien client_id en bind.
    const sel = db.calls.find((c) =>
      /from fb_funnels/i.test(c.sql) && /where client_id = \?/i.test(c.sql),
    );
    expect(sel).toBeTruthy();
    expect(sel!.args[0]).toBe(CLIENT_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS — handleCreateFunnel slug unique
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 handler — handleCreateFunnel', () => {
  it('slug dupliqué → 409 (unicité par tenant)', async () => {
    const db = createMockD1();
    // Seed : un funnel existe déjà avec ce slug.
    db.seed('select id from fb_funnels where client_id = ? and slug = ?', [
      { id: 'f_existing' },
    ]);

    const env = makeEnv(db);
    const req = new Request('https://example.com/api/funnels-builder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Funnel Test',
        slug: 'funnel-test',
        primary_goal: 'lead_capture',
      }),
    });

    const res = await handleCreateFunnel(req, env, makeAuth());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/déjà utilisé/i);
  });

  it('slug unique + payload valide → 200 + INSERT', async () => {
    const db = createMockD1();
    // Pas de dupe : default rows = [] → first() null.
    const env = makeEnv(db);
    const req = new Request('https://example.com/api/funnels-builder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Funnel Test',
        slug: 'funnel-test',
        primary_goal: 'sale',
      }),
    });

    const res = await handleCreateFunnel(req, env, makeAuth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.slug).toBe('funnel-test');
    expect(body.data.primary_goal).toBe('sale');
    expect(body.data.is_published).toBe(false);

    // INSERT fb_funnels émis.
    const insert = db.calls.find((c) => /insert into fb_funnels/i.test(c.sql));
    expect(insert).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS — handlePublishFunnel
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 handler — handlePublishFunnel', () => {
  it('UPDATE is_published=1 + published_at non-null', async () => {
    const db = createMockD1();
    // Assert tenant : funnel existe.
    db.seed('select id from fb_funnels where id = ? and client_id = ?', [
      { id: 'f_1' },
    ]);
    // Re-SELECT après UPDATE pour shape complète.
    db.seed('select id, client_id, name, slug, description, primary_goal', [
      {
        id: 'f_1',
        client_id: CLIENT_ID,
        name: 'Funnel 1',
        slug: 'funnel-1',
        description: null,
        primary_goal: 'lead_capture',
        is_published: 1,
        published_at: '2026-05-25T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      },
    ]);

    const env = makeEnv(db);
    const req = new Request('https://example.com/api/funnels-builder/f_1/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish: true }),
    });

    const res = await handlePublishFunnel(req, env, makeAuth(), 'f_1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.is_published).toBe(true);
    expect(body.data.published_at).toBeTruthy();

    // UPDATE émis avec is_published=1.
    const update = db.calls.find((c) => /update fb_funnels/i.test(c.sql));
    expect(update).toBeTruthy();
    expect(update!.args[0]).toBe(1); // is_published
    expect(update!.args[1]).toBeTruthy(); // published_at (ISO timestamp)
    expect(update!.args[3]).toBe('f_1');
    expect(update!.args[4]).toBe(CLIENT_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS — handlePublicTrackView (PUBLIC, rate-limited)
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 handler — handlePublicTrackView (PUBLIC)', () => {
  it('rate-limit OK + INSERT fb_step_views émis', async () => {
    const db = createMockD1();
    const env = makeEnv(db);

    const req = new Request('https://example.com/api/public/funnels/track-view', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '1.2.3.4',
      },
      body: JSON.stringify({
        step_id: 's_1',
        variant_id: 'v_1',
        visitor_id: 'visitor_X',
      }),
    });

    const res = await handlePublicTrackView(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.success).toBe(true);

    // Rate-limit appelé.
    expect(vi.mocked(checkRateLimit)).toHaveBeenCalled();
    const rlCall = vi.mocked(checkRateLimit).mock.calls[0];
    expect(rlCall[1]).toMatch(/^funnel:view:/);
    expect(rlCall[2]).toBe(30); // max
    expect(rlCall[3]).toBe(60); // windowSec

    // INSERT fb_step_views émis (via recordView).
    const insert = db.calls.find((c) =>
      /insert into fb_step_views/i.test(c.sql),
    );
    expect(insert).toBeTruthy();
    // Bind args : id (uuid), step_id, variant_id, visitor_id, client_id, ua_hash, country.
    expect(insert!.args[1]).toBe('s_1');
    expect(insert!.args[2]).toBe('v_1');
    expect(insert!.args[3]).toBe('visitor_X');
  });

  it('rate-limit BLOQUÉ → fake-success silencieux (anti-énumération), pas d\'INSERT', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retry_after_seconds: 30,
      bucket_key: 'funnel:view:abc',
    } as any);

    const db = createMockD1();
    const env = makeEnv(db);
    const req = new Request('https://example.com/api/public/funnels/track-view', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '5.6.7.8',
      },
      body: JSON.stringify({
        step_id: 's_1',
        variant_id: 'v_1',
        visitor_id: 'visitor_Y',
      }),
    });

    const res = await handlePublicTrackView(req, env);
    expect(res.status).toBe(200); // fake-success silencieux
    const body = (await res.json()) as { data: any };
    expect(body.data.success).toBe(true);

    // PAS d'INSERT (rate-limit a bloqué).
    const inserts = db.calls.filter((c) =>
      /insert into fb_step_views/i.test(c.sql),
    );
    expect(inserts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS — Cap check (settings.manage)
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 handler — capability guard', () => {
  it('handleListFunnels sans settings.manage → 403', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const url = new URL('https://example.com/api/funnels-builder');

    // Auth sans capabilities → guard requireCapability retourne 403.
    const res = await handleListFunnels(env, makeAuth([]), url);
    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/refusé/i);

    // Aucun SELECT fb_funnels (guard a court-circuité avant DB).
    const selects = db.calls.filter((c) => /from fb_funnels/i.test(c.sql));
    expect(selects.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE RENFORCEMENT — hashVisitorId
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 engine renforcement — hashVisitorId', () => {
  it('déterministe : même visitor_id → même bucket (3 appels)', () => {
    const h1 = hashVisitorId('visitor_alpha');
    const h2 = hashVisitorId('visitor_alpha');
    const h3 = hashVisitorId('visitor_alpha');
    expect(h2).toBe(h1);
    expect(h3).toBe(h1);
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h1).toBeLessThan(100);
  });

  it('distribution ~uniforme sur 1000 visitors (10 buckets)', () => {
    const buckets = new Array(10).fill(0) as number[];
    for (let i = 0; i < 1000; i++) {
      const b = hashVisitorId(`visitor_${i}_seed`);
      buckets[Math.floor(b / 10)]!++;
    }
    // Chaque bucket de 10 = ~100 ± 50 (tolérance large, FNV-1a n'est pas
    // cryptographique mais suffisant pour bucketing A/B).
    for (const c of buckets) {
      expect(c).toBeGreaterThanOrEqual(50);
      expect(c).toBeLessThanOrEqual(150);
    }
  });

  it('input invalide (vide / null) → 0 sans throw', () => {
    expect(hashVisitorId('')).toBe(0);
    expect(hashVisitorId(null as any)).toBe(0);
    expect(hashVisitorId(undefined as any)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE RENFORCEMENT — assignVariant (split_pct integer 1..99)
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 engine renforcement — assignVariant', () => {
  it('déterministe : même visitor_id splits 50/50 → même choix x3', () => {
    const variants = [
      { id: 'v_A', split_pct: 50 },
      { id: 'v_B', split_pct: 50 },
    ];
    const r1 = assignVariant('visitor_1', variants);
    const r2 = assignVariant('visitor_1', variants);
    const r3 = assignVariant('visitor_1', variants);
    expect(r1).not.toBeNull();
    expect(r2?.id).toBe(r1?.id);
    expect(r3?.id).toBe(r1?.id);
  });

  it('visitors différents 50/50 → distribution proche 500/500 sur 1000 (tolérance ±100)', () => {
    const variants = [
      { id: 'v_A', split_pct: 50 },
      { id: 'v_B', split_pct: 50 },
    ];
    let countA = 0;
    let countB = 0;
    for (let i = 0; i < 1000; i++) {
      const chosen = assignVariant(`v_uid_${i}_${i * 17}`, variants);
      if (chosen?.id === 'v_A') countA++;
      else countB++;
    }
    expect(countA + countB).toBe(1000);
    expect(countA).toBeGreaterThanOrEqual(400);
    expect(countA).toBeLessThanOrEqual(600);
    expect(countB).toBeGreaterThanOrEqual(400);
    expect(countB).toBeLessThanOrEqual(600);
  });

  it('3 variants 33/33/34 → distribution proche 333/333/334 sur 1000', () => {
    const variants = [
      { id: 'v_A', split_pct: 33 },
      { id: 'v_B', split_pct: 33 },
      { id: 'v_C', split_pct: 34 },
    ];
    const counts: Record<string, number> = { v_A: 0, v_B: 0, v_C: 0 };
    for (let i = 0; i < 1000; i++) {
      const chosen = assignVariant(`visitor_${i}_${i * 7}`, variants);
      if (chosen?.id) counts[chosen.id]!++;
    }
    expect(counts.v_A + counts.v_B + counts.v_C).toBe(1000);
    // Tolérance ±100 sur 333 attendu (FNV-1a sample 1000).
    expect(counts.v_A).toBeGreaterThanOrEqual(230);
    expect(counts.v_A).toBeLessThanOrEqual(430);
    expect(counts.v_B).toBeGreaterThanOrEqual(230);
    expect(counts.v_B).toBeLessThanOrEqual(430);
    expect(counts.v_C).toBeGreaterThanOrEqual(240);
    expect(counts.v_C).toBeLessThanOrEqual(440);
  });

  it('1 seule variante → court-circuit (cette variante)', () => {
    const variants = [{ id: 'v_solo', split_pct: 100 }];
    const r = assignVariant('any_visitor', variants);
    expect(r?.id).toBe('v_solo');
  });

  it('liste vide → null', () => {
    expect(assignVariant('visitor_1', [])).toBeNull();
    expect(assignVariant('visitor_1', null as any)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE RENFORCEMENT — validateStepOrder
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 engine renforcement — validateStepOrder', () => {
  it('séquence 0,1,2 → ok', () => {
    const r = validateStepOrder([
      { id: 's_1', order_index: 0 },
      { id: 's_2', order_index: 1 },
      { id: 's_3', order_index: 2 },
    ]);
    expect(r.ok).toBe(true);
  });

  it('duplicates → DUPLICATE_ORDER_INDEX', () => {
    const r = validateStepOrder([
      { id: 's_1', order_index: 0 },
      { id: 's_2', order_index: 1 },
      { id: 's_3', order_index: 1 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(FUNNEL_ERROR_CODES.DUPLICATE_ORDER_INDEX);
    }
  });

  it('gaps (0, 2, 3) → STEP_INVALID', () => {
    const r = validateStepOrder([
      { id: 's_1', order_index: 0 },
      { id: 's_2', order_index: 2 },
      { id: 's_3', order_index: 3 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(FUNNEL_ERROR_CODES.STEP_INVALID);
    }
  });

  it('order_index négatif ou float → STEP_INVALID', () => {
    const r1 = validateStepOrder([{ id: 's_1', order_index: -1 }]);
    expect(r1.ok).toBe(false);
    const r2 = validateStepOrder([{ id: 's_1', order_index: 1.5 }]);
    expect(r2.ok).toBe(false);
  });

  it('array vide → ok (rien à valider)', () => {
    expect(validateStepOrder([]).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE RENFORCEMENT — validateSplitPct
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 engine renforcement — validateSplitPct', () => {
  it('sum=100 (50/50) → ok', () => {
    expect(validateSplitPct([{ split_pct: 50 }, { split_pct: 50 }]).ok).toBe(true);
  });

  it('sum=100 (33/33/34) → ok', () => {
    expect(
      validateSplitPct([
        { split_pct: 33 },
        { split_pct: 33 },
        { split_pct: 34 },
      ]).ok,
    ).toBe(true);
  });

  it('sum=99 → INVALID_SPLIT', () => {
    const r = validateSplitPct([{ split_pct: 50 }, { split_pct: 49 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(FUNNEL_ERROR_CODES.INVALID_SPLIT);
  });

  it('sum=101 → INVALID_SPLIT', () => {
    const r = validateSplitPct([{ split_pct: 51 }, { split_pct: 50 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(FUNNEL_ERROR_CODES.INVALID_SPLIT);
  });

  it('split_pct=0 (variante désactivée) → INVALID_SPLIT', () => {
    const r = validateSplitPct([{ split_pct: 0 }, { split_pct: 100 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(FUNNEL_ERROR_CODES.INVALID_SPLIT);
  });

  it('split_pct=100 sur 2 variants → INVALID_SPLIT (autre variante doit être ≥1)', () => {
    const r = validateSplitPct([{ split_pct: 100 }, { split_pct: 0 }]);
    expect(r.ok).toBe(false);
  });

  it('1 seule variante avec 100% → ok (pas d\'A/B test)', () => {
    expect(validateSplitPct([{ split_pct: 100 }]).ok).toBe(true);
  });

  it('1 seule variante avec 50% → INVALID_SPLIT', () => {
    const r = validateSplitPct([{ split_pct: 50 }]);
    expect(r.ok).toBe(false);
  });

  it('array vide → EMPTY_VARIANTS', () => {
    const r = validateSplitPct([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(FUNNEL_ERROR_CODES.EMPTY_VARIANTS);
  });

  it('split_pct float → INVALID_SPLIT (entier requis)', () => {
    const r = validateSplitPct([{ split_pct: 50.5 }, { split_pct: 49.5 }]);
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE RENFORCEMENT — validateStepType
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 engine renforcement — validateStepType', () => {
  it('whitelist types → ok', () => {
    for (const t of FUNNEL_STEP_TYPES) {
      expect(validateStepType(t).ok).toBe(true);
    }
  });

  it('type inconnu → INVALID_STEP_TYPE', () => {
    const r = validateStepType('not_a_real_type');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(FUNNEL_ERROR_CODES.INVALID_STEP_TYPE);
  });

  it('vide → INVALID_STEP_TYPE', () => {
    expect(validateStepType('').ok).toBe(false);
    expect(validateStepType(null as any).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE RENFORCEMENT — computeFunnelConversion + identifyDropoff
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 engine renforcement — computeFunnelConversion', () => {
  it('3 steps (100/80/60) → conv 80%, 75%, total 60%', () => {
    const steps = [
      { id: 's_1', order_index: 0 },
      { id: 's_2', order_index: 1 },
      { id: 's_3', order_index: 2 },
    ];
    const views = new Map<string, number>([
      ['s_1', 100],
      ['s_2', 80],
      ['s_3', 60],
    ]);
    const r = computeFunnelConversion(steps, views);
    expect(r.steps).toHaveLength(3);
    expect(r.steps[0].views).toBe(100);
    expect(r.steps[0].next).toBe(80);
    expect(r.steps[0].conversion_pct).toBe(80);
    expect(r.steps[1].views).toBe(80);
    expect(r.steps[1].next).toBe(60);
    expect(r.steps[1].conversion_pct).toBe(75);
    expect(r.steps[2].next).toBe(0); // dernier step
    expect(r.steps[2].conversion_pct).toBe(0);
    expect(r.total_conversion).toBe(60); // 60/100 = 60%
  });

  it('views=0 sur premier step → tout à 0 (pas de division par zéro)', () => {
    const steps = [
      { id: 's_1', order_index: 0 },
      { id: 's_2', order_index: 1 },
    ];
    const r = computeFunnelConversion(steps, { s_1: 0, s_2: 0 });
    expect(r.total_conversion).toBe(0);
    expect(r.steps[0].conversion_pct).toBe(0);
  });

  it('steps non triés en input → triés par order_index ASC en output', () => {
    const steps = [
      { id: 's_C', order_index: 2 },
      { id: 's_A', order_index: 0 },
      { id: 's_B', order_index: 1 },
    ];
    const r = computeFunnelConversion(steps, { s_A: 100, s_B: 50, s_C: 10 });
    expect(r.steps[0].id).toBe('s_A');
    expect(r.steps[1].id).toBe('s_B');
    expect(r.steps[2].id).toBe('s_C');
  });

  it('array vide → { steps: [], total: 0 }', () => {
    const r = computeFunnelConversion([], {});
    expect(r.steps).toEqual([]);
    expect(r.total_conversion).toBe(0);
  });

  it('supporte Record<string, number> en plus de Map', () => {
    const steps = [
      { id: 's_1', order_index: 0 },
      { id: 's_2', order_index: 1 },
    ];
    const r = computeFunnelConversion(steps, { s_1: 200, s_2: 100 });
    expect(r.steps[0].conversion_pct).toBe(50);
    expect(r.total_conversion).toBe(50);
  });
});

describe('S44 engine renforcement — identifyDropoff', () => {
  it('3 steps (100/80/20) → biggest dropoff sur s_2 (80→20 = 75% dropoff)', () => {
    const conv = computeFunnelConversion(
      [
        { id: 's_1', order_index: 0 },
        { id: 's_2', order_index: 1 },
        { id: 's_3', order_index: 2 },
      ],
      { s_1: 100, s_2: 80, s_3: 20 },
    );
    const d = identifyDropoff(conv);
    expect(d.biggest_dropoff_step_id).toBe('s_2');
    expect(d.dropoff_pct).toBe(75);
  });

  it('3 steps (100/20/15) → biggest dropoff sur s_1 (100→20 = 80% dropoff)', () => {
    const conv = computeFunnelConversion(
      [
        { id: 's_1', order_index: 0 },
        { id: 's_2', order_index: 1 },
        { id: 's_3', order_index: 2 },
      ],
      { s_1: 100, s_2: 20, s_3: 15 },
    );
    const d = identifyDropoff(conv);
    expect(d.biggest_dropoff_step_id).toBe('s_1');
    expect(d.dropoff_pct).toBe(80);
  });

  it('1 seul step → { null, 0 }', () => {
    const conv = computeFunnelConversion(
      [{ id: 's_1', order_index: 0 }],
      { s_1: 100 },
    );
    const d = identifyDropoff(conv);
    expect(d.biggest_dropoff_step_id).toBeNull();
    expect(d.dropoff_pct).toBe(0);
  });

  it('tous views=0 → { null, 0 }', () => {
    const conv = computeFunnelConversion(
      [
        { id: 's_1', order_index: 0 },
        { id: 's_2', order_index: 1 },
      ],
      {},
    );
    const d = identifyDropoff(conv);
    expect(d.biggest_dropoff_step_id).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE RENFORCEMENT — aggregateFunnelAnalytics (orchestrator)
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 engine renforcement — aggregateFunnelAnalytics', () => {
  it('global only (pas de segments) → { global, dropoff, by_cohort: [] }', () => {
    const r = aggregateFunnelAnalytics(
      [
        { id: 's_1', order_index: 0 },
        { id: 's_2', order_index: 1 },
      ],
      { s_1: 100, s_2: 50 },
    );
    expect(r.global.total_conversion).toBe(50);
    expect(r.dropoff.biggest_dropoff_step_id).toBe('s_1');
    expect(r.by_cohort).toEqual([]);
  });

  it('avec segments UTM (google/facebook) → by_cohort breakdown', () => {
    const steps = [
      { id: 's_1', order_index: 0 },
      { id: 's_2', order_index: 1 },
    ];
    const r = aggregateFunnelAnalytics(
      steps,
      { s_1: 100, s_2: 50 },
      undefined,
      [
        { key: 'google', views: { s_1: 60, s_2: 40 } },
        { key: 'facebook', views: { s_1: 40, s_2: 10 } },
      ],
    );
    expect(r.by_cohort).toHaveLength(2);
    expect(r.by_cohort[0].key).toBe('google');
    expect(r.by_cohort[0].conversion.total_conversion).toBeCloseTo(66.67, 1);
    expect(r.by_cohort[1].key).toBe('facebook');
    expect(r.by_cohort[1].conversion.total_conversion).toBe(25);
  });

  it('segment vide ignoré (key missing)', () => {
    const r = aggregateFunnelAnalytics(
      [{ id: 's_1', order_index: 0 }],
      { s_1: 100 },
      undefined,
      [{ key: '', views: { s_1: 10 } } as any],
    );
    expect(r.by_cohort).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WIRE-UP (Sprint 44 renforcement) — 5 tests pour les handlers câblés
// ═══════════════════════════════════════════════════════════════════════════

describe('S44 wire-up — handleCreateStep DUPLICATE_ORDER_INDEX', () => {
  it('order_index dupliqué (collision avec step existant) → 400 DUPLICATE_ORDER_INDEX', async () => {
    const db = createMockD1();
    // Funnel existe (assertFunnelInTenant).
    db.seed('select id from fb_funnels where id = ? and client_id = ?', [
      { id: 'f_1' },
    ]);
    // Steps existants : order_index 0 et 1.
    db.seed('select id, order_index from fb_steps where funnel_id = ?', [
      { id: 's_existing_0', order_index: 0 },
      { id: 's_existing_1', order_index: 1 },
    ]);

    const env = makeEnv(db);
    const req = new Request('https://example.com/api/funnels-builder/f_1/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Step Dup',
        step_type: 'optin',
        order_index: 1, // ← collision avec s_existing_1
      }),
    });

    const res = await handleCreateStep(req, env, makeAuth(), 'f_1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/DUPLICATE_ORDER_INDEX/);

    // Vérif : pas d'INSERT (validation a court-circuité).
    const inserts = db.calls.filter((c) =>
      /insert into fb_steps/i.test(c.sql),
    );
    expect(inserts.length).toBe(0);
  });
});

describe('S44 wire-up — handleCreateStep INVALID_STEP_TYPE', () => {
  it('step_type "invalid" → 400 INVALID_STEP_TYPE', async () => {
    const db = createMockD1();
    db.seed('select id from fb_funnels where id = ? and client_id = ?', [
      { id: 'f_1' },
    ]);

    const env = makeEnv(db);
    const req = new Request('https://example.com/api/funnels-builder/f_1/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Step Bad',
        step_type: 'invalid',
        order_index: 0,
      }),
    });

    const res = await handleCreateStep(req, env, makeAuth(), 'f_1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/INVALID_STEP_TYPE/);

    // Vérif : pas d'INSERT.
    const inserts = db.calls.filter((c) =>
      /insert into fb_steps/i.test(c.sql),
    );
    expect(inserts.length).toBe(0);
  });
});

describe('S44 wire-up — handleSetSplitPct INVALID_SPLIT (sum=101)', () => {
  it('sum=101 → 400 INVALID_SPLIT, pas d\'UPDATE', async () => {
    const db = createMockD1();
    // Step appartient au tenant.
    db.seed('select s.funnel_id as funnel_id', [{ funnel_id: 'f_1' }]);

    const env = makeEnv(db);
    const req = new Request(
      'https://example.com/api/funnels-builder/steps/s_1/variants/split',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variants: [
            { id: 'v_A', split_pct: 51 },
            { id: 'v_B', split_pct: 50 },
          ],
        }),
      },
    );

    const res = await handleSetSplitPct(req, env, makeAuth(), 's_1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/INVALID_SPLIT/);

    // Vérif : aucun UPDATE émis (validation court-circuit).
    const updates = db.calls.filter((c) =>
      /update fb_step_variants/i.test(c.sql),
    );
    expect(updates.length).toBe(0);
  });
});

describe('S44 wire-up — handleVisitorAssignVariant déterministe', () => {
  it('même visitor_id → même variant (cohérence A/B test)', async () => {
    const db = createMockD1();
    // 2 variants 50/50.
    db.seed('from fb_step_variants', [
      {
        id: 'v_A',
        step_id: 's_1',
        variant_name: 'A',
        traffic_pct: 0.5,
        is_control: 1,
      },
      {
        id: 'v_B',
        step_id: 's_1',
        variant_name: 'B',
        traffic_pct: 0.5,
        is_control: 0,
      },
    ]);

    const env = makeEnv(db);

    const makeReq = () =>
      new Request(
        'https://example.com/api/public/funnels/steps/s_1/assign-variant',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '1.2.3.4',
          },
          body: JSON.stringify({ visitor_id: 'visitor_alpha' }),
        },
      );

    const res1 = await handleVisitorAssignVariant(makeReq(), env, 's_1');
    const res2 = await handleVisitorAssignVariant(makeReq(), env, 's_1');
    const res3 = await handleVisitorAssignVariant(makeReq(), env, 's_1');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);

    const b1 = (await res1.json()) as { data: { variant: { id: string } | null } };
    const b2 = (await res2.json()) as { data: { variant: { id: string } | null } };
    const b3 = (await res3.json()) as { data: { variant: { id: string } | null } };

    expect(b1.data.variant).not.toBeNull();
    expect(b2.data.variant?.id).toBe(b1.data.variant?.id);
    expect(b3.data.variant?.id).toBe(b1.data.variant?.id);
    expect(['v_A', 'v_B']).toContain(b1.data.variant?.id);
  });
});

describe('S44 wire-up — handleGetAnalytics retourne dropoff', () => {
  it('analytics enrichi avec identifyDropoff dans data.dropoff', async () => {
    const db = createMockD1();
    // Funnel tenant.
    db.seed('select id from fb_funnels where id = ? and client_id = ?', [
      { id: 'f_1' },
    ]);
    // Steps + views/conversions pour computeFunnelAnalytics.
    db.seed('from fb_steps', [
      { id: 's_1', name: 'Landing', step_type: 'landing', order_index: 0 },
      { id: 's_2', name: 'Optin', step_type: 'optin', order_index: 1 },
      { id: 's_3', name: 'Thanks', step_type: 'thank_you', order_index: 2 },
    ]);
    db.seed('from fb_step_variants', [
      { id: 'v_1A', step_id: 's_1', variant_name: 'A', is_control: 1 },
      { id: 'v_2A', step_id: 's_2', variant_name: 'A', is_control: 1 },
      { id: 'v_3A', step_id: 's_3', variant_name: 'A', is_control: 1 },
    ]);
    // Views : 100 → 80 → 20 (gros drop entre step 2 et 3).
    db.seed('from fb_step_views', [
      { step_id: 's_1', variant_id: 'v_1A', c: 100 },
      { step_id: 's_2', variant_id: 'v_2A', c: 80 },
      { step_id: 's_3', variant_id: 'v_3A', c: 20 },
    ]);
    db.seed('from fb_step_conversions', [
      { step_id: 's_1', variant_id: 'v_1A', c: 80 },
      { step_id: 's_2', variant_id: 'v_2A', c: 20 },
      { step_id: 's_3', variant_id: 'v_3A', c: 5 },
    ]);

    const env = makeEnv(db);
    const res = await handleGetAnalytics(env, makeAuth(), 'f_1');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: {
        steps_breakdown: any[];
        conversion_rate: number;
        top_variants: any[];
        dropoff: { biggest_dropoff_step_id: string | null; dropoff_pct: number };
        conversion_breakdown: { steps: any[]; total_conversion: number };
      };
    };

    // Shape historique préservée.
    expect(body.data.steps_breakdown).toHaveLength(3);
    expect(Array.isArray(body.data.top_variants)).toBe(true);

    // Sprint 44 renforcement : dropoff renvoyé.
    expect(body.data.dropoff).toBeDefined();
    expect(body.data.dropoff.biggest_dropoff_step_id).toBe('s_2'); // 80→20 = 75% drop
    expect(body.data.dropoff.dropoff_pct).toBe(75);

    // conversion_breakdown additif.
    expect(body.data.conversion_breakdown).toBeDefined();
    expect(body.data.conversion_breakdown.total_conversion).toBe(20); // 20/100 = 20%
  });
});
