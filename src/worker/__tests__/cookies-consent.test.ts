// ── cookies-consent.test.ts — Sprint 23 (Manager-B) ────────────────────
//
// Couvre les 2 handlers cookie consent :
//   - handlePostCookieConsent  (PUBLIC, rate-limit 30/min/IP, essential forcé)
//   - handleGetMyCookieConsent (AUTHED, dernier row par user_id)
//
// Invariants :
//   1. POST PUBLIC sans token → INSERT row avec user_id null.
//   2. essential = true même si body envoie false (force).
//   3. Body invalide (categories absentes) → 400 CONSENT_REQUIRED.
//   4. INSERT cookie_consent_log émis avec categories JSON-string.
//   5. GET me retourne dernier row du user, null si vide.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { handlePostCookieConsent, handleGetMyCookieConsent } from '../cookies-consent';

function makeEnv(): { env: Env; db: ReturnType<typeof createMockD1> } {
  const db = createMockD1();
  return { env: { DB: db } as unknown as Env, db };
}

function postReq(body: unknown, ip = '1.2.3.4'): Request {
  return new Request('http://x/api/cookies/consent', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, 'User-Agent': 'Mozilla/x' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  anonymous_id: 'anon-abc-123',
  categories: { essential: true, preferences: true, analytics: false, marketing: false },
  policy_version: '1.0',
  url: 'https://example.com/page',
};

// ──────────────────────────────────────────────────────────────────────────
// POST /api/cookies/consent (PUBLIC)
// ──────────────────────────────────────────────────────────────────────────

describe('S23 — POST /api/cookies/consent (PUBLIC)', () => {
  it('payload valide sans auth → 200 + INSERT émis avec user_id null', async () => {
    const { env, db } = makeEnv();
    const res = await handlePostCookieConsent(postReq(VALID_BODY), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
    // INSERT émis avec user_id = null (pas de token Bearer).
    const insert = db.calls.find(c => /INSERT INTO cookie_consent_log/i.test(c.sql));
    expect(insert).toBeDefined();
    // args: [anonymous_id, user_id, categoriesJSON, policy_version, ip, ua, url]
    expect(insert!.args[0]).toBe('anon-abc-123');
    expect(insert!.args[1]).toBeNull();
  });

  it('essential FORCÉ à true même si client envoie autrement (schema accepte que true)', async () => {
    const { env, db } = makeEnv();
    const res = await handlePostCookieConsent(postReq(VALID_BODY), env);
    expect(res.status).toBe(200);
    const insert = db.calls.find(c => /INSERT INTO cookie_consent_log/i.test(c.sql));
    const categoriesJson = String(insert!.args[2]);
    const parsed = JSON.parse(categoriesJson) as { essential: boolean };
    expect(parsed.essential).toBe(true);
  });

  it('body invalide (categories absent) → 400 CONSENT_REQUIRED', async () => {
    const { env } = makeEnv();
    const res = await handlePostCookieConsent(postReq({ anonymous_id: 'x' }), env);
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('CONSENT_REQUIRED');
  });

  it('essential: false dans le payload → 400 (schema z.literal(true))', async () => {
    const { env } = makeEnv();
    const res = await handlePostCookieConsent(
      postReq({
        anonymous_id: 'x',
        categories: { essential: false, preferences: false, analytics: false, marketing: false },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rate-limit dépassé → 429 RATE_LIMITED + PAS d\'INSERT', async () => {
    const { env, db } = makeEnv();
    // Seed COUNT(*) = 30 → quota atteint pour max=30.
    db.seed('SELECT COUNT(*)'.toLowerCase(), [{ c: 30 }]);
    db.seed('order by hit_at asc', [{ hit_at: new Date().toISOString().replace('T', ' ').slice(0, 19) }]);
    const res = await handlePostCookieConsent(postReq(VALID_BODY), env);
    expect(res.status).toBe(429);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('RATE_LIMITED');
    // Aucun INSERT dans cookie_consent_log.
    const insert = db.calls.find(c => /INSERT INTO cookie_consent_log/i.test(c.sql));
    expect(insert).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// GET /api/cookies/consent/me (AUTHED)
// ──────────────────────────────────────────────────────────────────────────

describe('S23 — GET /api/cookies/consent/me', () => {
  it('retourne dernier row pour user_id', async () => {
    const { env, db } = makeEnv();
    db.seed('from cookie_consent_log', [
      {
        id: 'c1',
        anonymous_id: 'anon-x',
        user_id: 'user-1',
        categories: JSON.stringify({ essential: true, preferences: true, analytics: false, marketing: false }),
        policy_version: '1.0',
        ip: '1.2.3.4',
        user_agent: 'Mozilla',
        url: '/page',
        granted_at: 'now',
      },
    ]);
    const res = await handleGetMyCookieConsent(env, { userId: 'user-1' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { user_id: string; categories: { preferences: boolean } } | null };
    expect(body.data?.user_id).toBe('user-1');
    expect(body.data?.categories.preferences).toBe(true);
  });

  it('aucun consent → null', async () => {
    const { env, db } = makeEnv();
    db.seed('from cookie_consent_log', []);
    const res = await handleGetMyCookieConsent(env, { userId: 'user-1' });
    const body = await res.json() as { data: unknown };
    expect(body.data).toBeNull();
  });

  it('user_id bindé strictement (pas de fuite cross-user)', async () => {
    const { env, db } = makeEnv();
    db.seed('from cookie_consent_log', []);
    await handleGetMyCookieConsent(env, { userId: 'user-42' });
    const sel = db.calls.find(c => /FROM cookie_consent_log/i.test(c.sql));
    expect(sel).toBeDefined();
    expect(sel!.args).toEqual(['user-42']);
  });
});
