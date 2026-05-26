// ── release-gates.test.ts — Sprint 30 (Manager-B) ──────────────────────────
//
// Couvre `handleReleaseGatesCheck` — 8 checks programmatiques pour le go-live
// production. Approche : harness mock D1 existant (`createMockD1` + `seed`),
// calqué sur `onboarding-checklist-s21.test.ts`. Mock global.fetch pour
// /api/health et /api/admin/web-vitals (URL interne worker).
//
// Contrats vérifiés :
//   1. all_green=true quand TOUS les checks critiques passent.
//   2. all_green=false si DEV_BYPASS_AUTH='true' (CRITIQUE).
//   3. all_green=false si une var critical env manque (avec missing[]).
//   4. env_optional reporting missing[] noms uniquement (PAS de leak valeur).
//   5. beta_codes_seeded.ok=false si count < 5.
//   6. health_endpoint.ok=false si /api/health retourne 500.
//   7. INSERT release_gates_runs best-effort silencieux (PAS de throw).
//   8. Shape ReleaseGatesStatus valide (all_green, checks.*, checked_at).
//
// ⚠️ env_optional_present.ok est TOUJOURS true (informatif, n'impacte pas
// all_green). Seules les 7 autres checks comptent dans all_green.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { handleReleaseGatesCheck } from '../release-gates';

// ── Helpers env / auth ─────────────────────────────────────────────────────

const AUTH_ADMIN = { userId: 'user-admin-1', role: 'admin' };

function makeEnv(overrides: Record<string, unknown> = {}, mockSeq = 125, betaCount = 5) {
  const db = createMockD1();
  // Migrations : on seed la requête SUBSTR/INSTR ET le fallback COUNT(*).
  db.seed('max(cast(substr', [{ max_seq: mockSeq }]);
  db.seed('count(*) as c from _migrations', [{ c: mockSeq }]);
  db.seed('count(*) as c from beta_invite_codes', [{ c: betaCount }]);
  db.seed("from settings where key = 'payments_live_enabled'", [{ value: 0 }]);

  const base: Record<string, unknown> = {
    DB: db,
    ADMIN_PASSWORD: 'x-admin',
    WEBHOOK_SECRET: 'x-webhook',
    NOTIFICATION_EMAIL: 'noreply@intralys.io',
    ALLOWED_ORIGINS: 'https://app.intralys.io',
  };
  // overrides: undefined value supprime la clé (simule var manquante)
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete base[k];
    } else {
      base[k] = v;
    }
  }
  return { env: base as unknown as Env, db };
}

function makeReq(): Request {
  return new Request('https://test.intralys.io/api/admin/release-gates', { method: 'GET' });
}

// ── Fetch mock setup ───────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Default : tous endpoints répondent 200.
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ──────────────────────────────────────────────────────────────────────────
// 1. all_green=true quand tout passe
// ──────────────────────────────────────────────────────────────────────────

describe('S30 — handleReleaseGatesCheck (happy path)', () => {
  it('all_green=true quand tous les checks critiques passent', async () => {
    const { env } = makeEnv();
    const res = await handleReleaseGatesCheck(makeReq(), env, AUTH_ADMIN);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: any };
    expect(body.data.all_green).toBe(true);
    expect(body.data.checks.migrations_last_seq.ok).toBe(true);
    expect(body.data.checks.migrations_last_seq.value).toBeGreaterThanOrEqual(125);
    expect(body.data.checks.env_critical_present.ok).toBe(true);
    expect(body.data.checks.env_critical_present.missing).toEqual([]);
    expect(body.data.checks.dev_bypass_off.ok).toBe(true);
    expect(body.data.checks.payments_live_disabled.ok).toBe(true);
    expect(body.data.checks.payments_live_disabled.value).toBe(0);
    expect(body.data.checks.health_endpoint.ok).toBe(true);
    expect(body.data.checks.health_endpoint.status).toBe(200);
    expect(body.data.checks.web_vitals_endpoint.ok).toBe(true);
    expect(body.data.checks.beta_codes_seeded.ok).toBe(true);
    expect(body.data.checks.beta_codes_seeded.count).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. DEV_BYPASS_AUTH='true' bloque (CRITIQUE)
// ──────────────────────────────────────────────────────────────────────────

describe('S30 — dev_bypass_off (CRITIQUE)', () => {
  it("all_green=false si DEV_BYPASS_AUTH='true'", async () => {
    const { env } = makeEnv({ DEV_BYPASS_AUTH: 'true' });
    const res = await handleReleaseGatesCheck(makeReq(), env, AUTH_ADMIN);
    const body = await res.json() as { data: any };
    expect(body.data.all_green).toBe(false);
    expect(body.data.checks.dev_bypass_off.ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. Critical env vars manquantes
// ──────────────────────────────────────────────────────────────────────────

describe('S30 — env_critical_present', () => {
  it('all_green=false + missing[] quand ADMIN_PASSWORD absent', async () => {
    const { env } = makeEnv({ ADMIN_PASSWORD: undefined });
    const res = await handleReleaseGatesCheck(makeReq(), env, AUTH_ADMIN);
    const body = await res.json() as { data: any };
    expect(body.data.all_green).toBe(false);
    expect(body.data.checks.env_critical_present.ok).toBe(false);
    expect(body.data.checks.env_critical_present.missing).toContain('ADMIN_PASSWORD');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Optional env reporting SANS leak valeur
// ──────────────────────────────────────────────────────────────────────────

describe('S30 — env_optional_present (anti-leak)', () => {
  it('missing[] reporte noms uniquement, AUCUNE valeur secrète leakée', async () => {
    const { env } = makeEnv({
      STRIPE_SECRET_KEY: 'sk_live_FAKE_TOPSECRET_ABC123',
      RESEND_API_KEY: 're_FAKE_topsecret_xyz',
    });
    // FCM_SERVER_KEY absent → doit apparaître dans missing[]
    const res = await handleReleaseGatesCheck(makeReq(), env, AUTH_ADMIN);
    const body = await res.json() as { data: any };
    // env_optional.ok est TOUJOURS true (informatif)
    expect(body.data.checks.env_optional_present.ok).toBe(true);
    expect(body.data.checks.env_optional_present.missing).toContain('FCM_SERVER_KEY');
    // Vérification anti-leak globale : aucune valeur secrète dans le payload
    const payloadStr = JSON.stringify(body);
    expect(payloadStr).not.toContain('sk_live_FAKE_TOPSECRET_ABC123');
    expect(payloadStr).not.toContain('re_FAKE_topsecret_xyz');
    expect(payloadStr).not.toMatch(/sk_live_/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. beta_codes_seeded count < 5
// ──────────────────────────────────────────────────────────────────────────

describe('S30 — beta_codes_seeded', () => {
  it('ok=false quand count < 5 (seuil seed)', async () => {
    const { env } = makeEnv({}, 125, 3);
    const res = await handleReleaseGatesCheck(makeReq(), env, AUTH_ADMIN);
    const body = await res.json() as { data: any };
    expect(body.data.checks.beta_codes_seeded.ok).toBe(false);
    expect(body.data.checks.beta_codes_seeded.count).toBe(3);
    expect(body.data.all_green).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. health_endpoint fail
// ──────────────────────────────────────────────────────────────────────────

describe('S30 — health_endpoint', () => {
  it('ok=false quand /api/health retourne 500', async () => {
    const { env } = makeEnv();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 })) as any;
    const res = await handleReleaseGatesCheck(makeReq(), env, AUTH_ADMIN);
    const body = await res.json() as { data: any };
    expect(body.data.checks.health_endpoint.ok).toBe(false);
    expect(body.data.checks.health_endpoint.status).toBe(500);
    expect(body.data.all_green).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. INSERT release_gates_runs best-effort silencieux
// ──────────────────────────────────────────────────────────────────────────

describe('S30 — INSERT release_gates_runs best-effort', () => {
  it('ne throw PAS si INSERT échoue (table absente)', async () => {
    const { env, db } = makeEnv();
    // Wrap prepare : INSERT release_gates_runs → reject ; reste → comportement original
    const originalPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      if (sql.includes('INSERT INTO release_gates_runs')) {
        return {
          bind: () => ({
            run: () => Promise.reject(new Error('no such table: release_gates_runs')),
          }),
        };
      }
      return originalPrepare(sql);
    };
    // Doit retourner 200 sans throw malgré l'échec INSERT
    const res = await handleReleaseGatesCheck(makeReq(), env, AUTH_ADMIN);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: any };
    expect(body.data.all_green).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 8. Shape ReleaseGatesStatus valide
// ──────────────────────────────────────────────────────────────────────────

describe('S30 — shape ReleaseGatesStatus', () => {
  it('retourne all_green + checks (8 sous-clés) + checked_at ISO', async () => {
    const { env } = makeEnv();
    const res = await handleReleaseGatesCheck(makeReq(), env, AUTH_ADMIN);
    const body = await res.json() as { data: any };
    expect(body.data).toHaveProperty('all_green');
    expect(body.data).toHaveProperty('checks');
    expect(body.data).toHaveProperty('checked_at');
    // checked_at = ISO string parsable
    expect(() => new Date(body.data.checked_at)).not.toThrow();
    expect(new Date(body.data.checked_at).toISOString()).toBe(body.data.checked_at);
    // 8 sous-clés checks
    expect(body.data.checks).toHaveProperty('migrations_last_seq');
    expect(body.data.checks).toHaveProperty('env_critical_present');
    expect(body.data.checks).toHaveProperty('env_optional_present');
    expect(body.data.checks).toHaveProperty('dev_bypass_off');
    expect(body.data.checks).toHaveProperty('payments_live_disabled');
    expect(body.data.checks).toHaveProperty('health_endpoint');
    expect(body.data.checks).toHaveProperty('web_vitals_endpoint');
    expect(body.data.checks).toHaveProperty('beta_codes_seeded');
  });
});
