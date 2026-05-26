// ── lot4-register-ui.test.ts — LOT 4 SaaS M2 (2026-05-18) ───────────────────
//
// Contrat de la fonction CLIENT additive `register()` (api.ts §6.20) :
//   - POST /api/auth/register avec body { email, password, name, company? }
//   - Succès (format finishLogin : token + user) → setToken (intralys_token)
//     + localStorage.setItem('intralys_user') + removeItem('must_change_password')
//   - Erreur → { error } renvoyé tel quel (apiFetch figé api.ts:103-105
//     DROP le champ `code` ; le mapping i18n UI se fait sur le string error)
//   - register() est PUREMENT additif : ne dépend ni n'altère login().
//
// Test pur client (aucun mock D1/Worker). N'utilise PAS _helpers figés.
// Environnement vitest = 'node' → on stube localStorage/fetch/window et on
// mock @capacitor/core (api.ts l'importe au chargement du module).

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

// localStorage minimal en mémoire
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const store = new MemStorage();
// @ts-expect-error — stub global pour env node
globalThis.localStorage = store;
// @ts-expect-error — stub global pour env node
globalThis.window = { location: { href: '', assign: () => {} } };

// Import APRÈS les stubs globaux (api.ts touche localStorage au chargement indirect)
const { register } = await import('../../lib/api');

describe('LOT 4 — register() client (§6.20)', () => {
  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
  });

  it('POST /api/auth/register avec le body { email, password, name, company }', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    // @ts-expect-error — stub fetch
    globalThis.fetch = fetchSpy;

    await register({ email: 'a@b.co', password: 'motdepasse8', name: 'Ana', company: 'Acme' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'a@b.co', password: 'motdepasse8', name: 'Ana', company: 'Acme',
    });
  });

  it('succès → setToken + intralys_user + removeItem(must_change_password)', async () => {
    store.setItem('must_change_password', '1');
    const okBody = {
      success: true,
      token: 'tok-xyz',
      must_change_password: false,
      user: { id: 'u1', name: 'Ana', role: 'admin', email: 'a@b.co' },
    };
    // @ts-expect-error — stub fetch
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(okBody), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const res = await register({ email: 'a@b.co', password: 'motdepasse8', name: 'Ana' });

    expect(res.data).toBeTruthy();
    expect(res.data && res.data.token).toBe('tok-xyz');
    expect(store.getItem('intralys_token')).toBe('tok-xyz');
    expect(JSON.parse(store.getItem('intralys_user') || 'null')).toEqual(okBody.user);
    expect(store.getItem('must_change_password')).toBeNull();
  });

  it('409 → { error } backend propagé (déclenche email_taken UI), aucun token', async () => {
    // @ts-expect-error — stub fetch
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Cet email est déjà utilisé', code: 'EMAIL_TAKEN' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await register({ email: 'a@b.co', password: 'motdepasse8', name: 'Ana' });

    // apiFetch DROP `code` (api.ts:104) → seul `error` survit, c'est le
    // signal sur lequel Signup.tsx mappe vers t('auth.signup.email_taken').
    expect((res as { error?: string }).error).toContain('déjà utilisé');
    expect((res as { code?: string }).code).toBeUndefined();
    expect(res.data).toBeUndefined();
    expect(store.getItem('intralys_token')).toBeNull();
  });

  it('400 / 500 → { error } backend propagé sans token (mapping UI invalid/error)', async () => {
    const cases = [
      [400, 'Mot de passe trop court (min 8 caractères)'],
      [500, 'Création du compte impossible'],
    ] as const;
    for (const [status, error] of cases) {
      store.clear();
      // @ts-expect-error — stub fetch
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ error }), {
          status, headers: { 'Content-Type': 'application/json' },
        }),
      );
      const res = await register({ email: 'a@b.co', password: 'short', name: 'Ana' });
      expect((res as { error?: string }).error).toBe(error);
      expect(store.getItem('intralys_token')).toBeNull();
    }
  });

  it('erreur réseau → { error } propagé, aucun token (mapping auth.signup.error UI)', async () => {
    // @ts-expect-error — stub fetch qui rejette
    globalThis.fetch = vi.fn(async () => { throw new Error('network down'); });

    const res = await register({ email: 'a@b.co', password: 'motdepasse8', name: 'Ana' });

    expect(res.data).toBeUndefined();
    expect(typeof (res as { error?: string }).error).toBe('string');
    expect(store.getItem('intralys_token')).toBeNull();
  });
});
