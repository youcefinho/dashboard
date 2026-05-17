// ── Tests src/worker/lib/secret-store.ts — Sprint S7 M1 (sécu intégrations) ──
// Coffre chiffré des tokens d'intégration. Vérifie : lecture env additive,
// chiffrement AES-GCM réel (ciphertext ≠ plaintext quand TOKEN_KEY set),
// parité dev (clair si !TOKEN_KEY), round-trip, révocation, multi-tenant
// strict (filtrage client_id ET channel_id ET kind), anti-fuite.
//
// Mock D1 figé (_helpers.ts) : .run() → {success,meta:{changes}}, .first() →
// 1re ligne seedée ou null, db.calls enregistre sql+args.
// NON exécuté sur VM — run réel D1 délégué à Rochdi.
import { describe, it, expect } from 'vitest';
import { createMockD1, type MockD1 } from './_helpers';
import { createSecretStore } from '../lib/secret-store';

const KEY = 'unit-test-token-key-0123456789';

function mkEnv(db: MockD1, withKey: boolean, extra: Record<string, unknown> = {}) {
  return {
    DB: db as unknown,
    ...(withKey ? { TOKEN_KEY: KEY } : {}),
    ...extra,
  } as any;
}

describe('getEnvSecret — lecture additive non destructive', () => {
  it('retourne la valeur string du binding', () => {
    const env = mkEnv(createMockD1(), false, { SHOPIFY_CLIENT_ID: 'sid_123' });
    expect(createSecretStore(env).getEnvSecret('SHOPIFY_CLIENT_ID')).toBe('sid_123');
  });

  it('retourne undefined si absent ou non-string', () => {
    const env = mkEnv(createMockD1(), false, { NUMERIC_BINDING: 42 });
    const store = createSecretStore(env);
    expect(store.getEnvSecret('DOES_NOT_EXIST')).toBeUndefined();
    expect(store.getEnvSecret('NUMERIC_BINDING')).toBeUndefined();
  });
});

describe('putIntegrationToken — chiffrement + UPSERT', () => {
  it('persiste un ciphertext ≠ plaintext quand TOKEN_KEY est défini', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    await createSecretStore(env).putIntegrationToken(
      env, 'client_A', 'chan_1', 'shopify_token', 'shpat_supersecret'
    );
    const insert = db.calls.find(c => c.sql.toLowerCase().includes('insert into integration_secrets'));
    expect(insert).toBeTruthy();
    // args = (clientId, channelId, kind, ciphertext)
    expect(insert!.args[0]).toBe('client_A');
    expect(insert!.args[1]).toBe('chan_1');
    expect(insert!.args[2]).toBe('shopify_token');
    expect(typeof insert!.args[3]).toBe('string');
    expect(insert!.args[3]).not.toBe('shpat_supersecret'); // chiffré
    expect(insert!.args[3].length).toBeGreaterThan(0);
  });

  it('parité dev : stocke en clair si TOKEN_KEY absent', async () => {
    const db = createMockD1();
    const env = mkEnv(db, false);
    await createSecretStore(env).putIntegrationToken(
      env, 'client_A', 'chan_1', 'woo_creds', '{"ck":"x","cs":"y"}'
    );
    const insert = db.calls.find(c => c.sql.toLowerCase().includes('insert into integration_secrets'));
    expect(insert!.args[3]).toBe('{"ck":"x","cs":"y"}');
  });

  it('utilise ON CONFLICT(channel_id, kind) (UPSERT, pas de doublon)', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    await createSecretStore(env).putIntegrationToken(
      env, 'client_A', 'chan_1', 'shopify_token', 'tok'
    );
    const insert = db.calls.find(c => c.sql.toLowerCase().includes('insert into integration_secrets'));
    expect(insert!.sql.toLowerCase()).toContain('on conflict(channel_id, kind) do update');
  });
});

describe('getIntegrationToken — round-trip + multi-tenant', () => {
  it('round-trip : put puis get rend le plaintext original (TOKEN_KEY set)', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    const store = createSecretStore(env);
    await store.putIntegrationToken(env, 'client_A', 'chan_1', 'shopify_token', 'shpat_roundtrip');
    const insert = db.calls.find(c => c.sql.toLowerCase().includes('insert into integration_secrets'));
    const ciphertext = insert!.args[3] as string;
    // Le SELECT retournera la ligne chiffrée stockée
    db.seed('select ciphertext from integration_secrets', [{ ciphertext }]);
    const got = await store.getIntegrationToken(env, 'client_A', 'chan_1', 'shopify_token');
    expect(got).toBe('shpat_roundtrip');
  });

  it('filtre client_id ET channel_id ET kind ET revoked_at IS NULL', async () => {
    const db = createMockD1();
    const env = mkEnv(db, false);
    db.seed('select ciphertext from integration_secrets', [{ ciphertext: 'clair' }]);
    await createSecretStore(env).getIntegrationToken(env, 'client_A', 'chan_1', 'woo_creds');
    const sel = db.calls.find(c => c.sql.toLowerCase().includes('select ciphertext from integration_secrets'));
    expect(sel!.sql.toLowerCase()).toContain('where client_id = ? and channel_id = ? and kind = ? and revoked_at is null');
    expect(sel!.args).toEqual(['client_A', 'chan_1', 'woo_creds']);
  });

  it('retourne null si aucune ligne (rien / révoqué / mauvais tenant)', async () => {
    const db = createMockD1(); // defaultRows = [] → first() = null
    const env = mkEnv(db, true);
    const got = await createSecretStore(env).getIntegrationToken(
      env, 'client_X', 'chan_9', 'shopify_token'
    );
    expect(got).toBeNull();
  });
});

describe('revokeIntegrationToken — soft-revoke idempotent', () => {
  it('UPDATE revoked_at, filtré tenant, seulement non déjà révoqué', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    await createSecretStore(env).revokeIntegrationToken(env, 'client_A', 'chan_1', 'shopify_token');
    const upd = db.calls.find(c => c.sql.toLowerCase().includes('update integration_secrets'));
    expect(upd).toBeTruthy();
    expect(upd!.sql.toLowerCase()).toContain("set revoked_at = datetime('now')");
    expect(upd!.sql.toLowerCase()).toContain('where client_id = ? and channel_id = ? and kind = ? and revoked_at is null');
    expect(upd!.args).toEqual(['client_A', 'chan_1', 'shopify_token']);
  });

  it('après revoke, get renvoie null (WHERE revoked_at IS NULL exclut)', async () => {
    const db = createMockD1(); // pas de seed → SELECT post-revoke = []
    const env = mkEnv(db, true);
    const store = createSecretStore(env);
    await store.revokeIntegrationToken(env, 'client_A', 'chan_1', 'shopify_token');
    const got = await store.getIntegrationToken(env, 'client_A', 'chan_1', 'shopify_token');
    expect(got).toBeNull();
  });
});

describe('anti-fuite Loi 25', () => {
  it('aucune requête du module ne contient le plaintext en clair (TOKEN_KEY set)', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    const store = createSecretStore(env);
    await store.putIntegrationToken(env, 'c', 'ch', 'shopify_token', 'PLAINTEXT_SECRET');
    const leaked = db.calls.some(
      c => c.sql.includes('PLAINTEXT_SECRET') || c.args.some(a => a === 'PLAINTEXT_SECRET')
    );
    expect(leaked).toBe(false);
  });
});
