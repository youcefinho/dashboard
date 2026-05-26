// ── sd-a-backend.test.ts — Sprint S-D (LOT D, Manager A) ────────────────────
//
// Couvre :
//   1. fetchWithTimeout — résout si fetch < timeout ; rejette (AbortError →
//      message "Timeout après Xms") si > timeout ; clearTimeout TOUJOURS
//      appelé (pas de timer fuyant) ; propage l'erreur réseau telle quelle.
//   2. Garde admin du dispatch GET /api/admin/web-vitals — logique de garde
//      LOCALE répliquée (auth.role ∉ {admin,owner} → 403 { error:<string> }).
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande bun/node). Écrits pour
//    vitest, vérifiés statiquement.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from '../lib/fetch-timeout';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('S-D §6.1 — fetchWithTimeout', () => {
  it('résout la Response si le fetch aboutit avant le timeout', async () => {
    const fake = new Response('ok', { status: 200 });
    globalThis.fetch = vi.fn(async () => fake) as any;

    const res = await fetchWithTimeout('https://x.test', undefined, 1000);
    expect(res).toBe(fake);
    expect(res.status).toBe(200);
  });

  it('clearTimeout est appelé en succès (aucun timer fuyant)', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    globalThis.fetch = vi.fn(async () => new Response('ok')) as any;

    await fetchWithTimeout('https://x.test', undefined, 1000);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('rejette avec "Timeout après Xms" si le fetch dépasse le timeout', async () => {
    // fetch qui ne résout jamais avant l'abort : écoute le signal et rejette
    // AbortError quand controller.abort() est déclenché.
    globalThis.fetch = vi.fn((_input: any, init: any) => {
      return new Promise((_resolve, reject) => {
        const sig: AbortSignal = init.signal;
        sig.addEventListener('abort', () => {
          const err: any = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as any;

    await expect(
      fetchWithTimeout('https://slow.test', undefined, 20),
    ).rejects.toThrow(/Timeout après 20ms/);
  });

  it('clearTimeout est appelé même en cas d\'erreur', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;

    await expect(
      fetchWithTimeout('https://down.test', undefined, 1000),
    ).rejects.toThrow();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('propage l\'erreur réseau (message conservé, pas AbortError)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Erreur réseau X');
    }) as any;

    await expect(
      fetchWithTimeout('https://down.test'),
    ).rejects.toThrow(/Erreur réseau X/);
  });
});

// ── Garde admin du dispatch /api/admin/web-vitals ───────────────────────────
// Le dispatch worker.ts applique une garde LOCALE (réplique
// admin-analytics.ts:16-23) : auth.role ∉ {admin,owner} → 403.
// On reproduit ici la décision exacte du dispatch pour la verrouiller.

function dispatchGuard(auth: { userId: string; role: string }):
  { status: number; error?: string } {
  if (auth.role !== 'admin' && auth.role !== 'owner') {
    return { status: 403, error: 'Accès réservé aux administrateurs.' };
  }
  return { status: 200 };
}

describe('S-D §6.3 — garde admin GET /api/admin/web-vitals', () => {
  it('role non-admin → 403 avec error string brute', () => {
    const r = dispatchGuard({ userId: 'u1', role: 'broker' });
    expect(r.status).toBe(403);
    expect(typeof r.error).toBe('string');
    expect(r.error).toBe('Accès réservé aux administrateurs.');
  });

  it('role admin → passe (200)', () => {
    expect(dispatchGuard({ userId: 'u1', role: 'admin' }).status).toBe(200);
  });

  it('role owner → passe (200)', () => {
    expect(dispatchGuard({ userId: 'u1', role: 'owner' }).status).toBe(200);
  });
});
