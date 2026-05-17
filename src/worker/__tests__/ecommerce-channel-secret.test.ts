// ── ecommerce-channel-secret.test.ts — Sprint S7 M1 (Manager B) ──────────────
//
// Couvre le remplacement du stockage KV CLAIR par le secret store chiffré D1
// pour les connecteurs Shopify / Woo, + rotation/révocation.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
//
// Stratégie : mock D1 stateful maison pour `integration_secrets` (le
// createMockD1 partagé ne simule pas UPSERT/soft-revoke). Sans env.TOKEN_KEY,
// encryptToken/decryptToken = identité (parité dev) ⇒ on peut asserter le
// plaintext stocké tel quel. Anti-fuite : on vérifie qu'aucun secret n'atterrit
// dans les `details` d'audit.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { shopifyCallback, shopifyPushFn } from '../ecommerce-channel-shopify';
import { wooCallback, wooPushFn } from '../ecommerce-channel-woo';
import {
  rotateChannelSecret,
  revokeChannelSecret,
} from '../ecommerce-channel-rotation';
import type { ChannelRow } from '../ecommerce-channel-sync';

// ── Mock D1 stateful : émule integration_secrets + sales_channels + audit_log ─
interface SecretRow {
  client_id: string;
  channel_id: string;
  kind: string;
  ciphertext: string;
  revoked_at: string | null;
}

function makeEnv(opts?: {
  channels?: ChannelRow[];
  shopifyTokenRes?: { access_token?: string };
}): {
  env: Env;
  secrets: SecretRow[];
  auditRows: Array<{ user_id: string; action: string; resource_id: string; details: string }>;
  kvDeletes: string[];
  kvPuts: Array<{ key: string; val: string }>;
} {
  const secrets: SecretRow[] = [];
  const auditRows: Array<{ user_id: string; action: string; resource_id: string; details: string }> = [];
  const kvDeletes: string[] = [];
  const kvPuts: Array<{ key: string; val: string }> = [];
  const channels = opts?.channels ?? [];

  const prepare = (sql: string) => {
    let args: any[] = [];
    const lower = sql.toLowerCase();
    return {
      bind(...a: any[]) {
        args = a;
        return this;
      },
      async first() {
        // SELECT canal (loadChannel : id=? AND client_id=?)
        if (lower.includes('from sales_channels')) {
          const [channelId, clientId] = args;
          const c = channels.find(
            (x) => x.id === channelId && x.client_id === clientId,
          );
          return (c as any) ?? null;
        }
        // SELECT ciphertext FROM integration_secrets WHERE ... revoked_at IS NULL
        if (lower.includes('from integration_secrets')) {
          const [clientId, channelId, kind] = args;
          const row = secrets.find(
            (s) =>
              s.client_id === clientId &&
              s.channel_id === channelId &&
              s.kind === kind &&
              s.revoked_at === null,
          );
          return row ? { ciphertext: row.ciphertext } : null;
        }
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        if (lower.includes('insert into integration_secrets')) {
          // UPSERT : (client_id, channel_id, kind, ciphertext)
          const [clientId, channelId, kind, ciphertext] = args;
          const existing = secrets.find(
            (s) => s.channel_id === channelId && s.kind === kind,
          );
          if (existing) {
            existing.client_id = clientId;
            existing.ciphertext = ciphertext;
            existing.revoked_at = null; // remet revoked_at=NULL
          } else {
            secrets.push({
              client_id: clientId,
              channel_id: channelId,
              kind,
              ciphertext,
              revoked_at: null,
            });
          }
        } else if (lower.includes('update integration_secrets')) {
          // soft-revoke : SET revoked_at WHERE client_id/channel_id/kind
          const [clientId, channelId, kind] = args;
          for (const s of secrets) {
            if (
              s.client_id === clientId &&
              s.channel_id === channelId &&
              s.kind === kind &&
              s.revoked_at === null
            ) {
              s.revoked_at = '2026-05-17 00:00:00';
            }
          }
        } else if (lower.includes('insert into audit_log')) {
          // (user_id, action, resource_type, resource_id, details, ip, ua)
          auditRows.push({
            user_id: args[0],
            action: args[1],
            resource_id: args[3],
            details: args[4],
          });
        }
        return { success: true, meta: { changes: 1, last_row_id: 1 } };
      },
    };
  };

  const env = {
    DB: { prepare },
    STATE_STORE: {
      async get() {
        return null;
      },
      async put(key: string, val: string) {
        kvPuts.push({ key, val });
      },
      async delete(key: string) {
        kvDeletes.push(key);
      },
    },
    SHOPIFY_CLIENT_ID: 'shp_cid',
    SHOPIFY_CLIENT_SECRET: 'shp_secret',
    // pas de TOKEN_KEY ⇒ encrypt/decrypt = identité (parité dev assertable)
  } as unknown as Env;

  // fetch mock pour l'échange OAuth Shopify
  (globalThis as any).fetch = async () =>
    ({
      ok: true,
      json: async () => opts?.shopifyTokenRes ?? { access_token: 'shp_tok_ABC' },
    }) as any;

  return { env, secrets, auditRows, kvDeletes, kvPuts };
}

const chan = (over?: Partial<ChannelRow>): ChannelRow => ({
  id: 'ch1',
  client_id: 'cliA',
  name: 'Boutique',
  type: 'shopify',
  config_ref: null,
  shop_domain: 'ma-boutique.myshopify.com',
  external_id: null,
  active: 1,
  ...over,
});

// ── Shopify : callback persiste via secret store, JAMAIS KV clair ────────────
describe('Shopify callback → secret store', () => {
  it('persiste le token chiffré en D1 et n’écrit AUCUN shopify_token: clair en KV', async () => {
    const ctx = makeEnv();
    const url = new URL(
      'https://app/api/ecommerce/channels/ch1/callback?code=abc&state=ch1.nonce&shop=ma-boutique.myshopify.com',
    );
    const res = await shopifyCallback(ctx.env, chan(), url);
    expect(res.status).toBe(200);

    // secret store : 1 ligne (client_id figé depuis le canal, jamais en dur)
    expect(ctx.secrets).toHaveLength(1);
    expect(ctx.secrets[0]).toMatchObject({
      client_id: 'cliA',
      channel_id: 'ch1',
      kind: 'shopify_token',
      ciphertext: 'shp_tok_ABC', // identité (pas de TOKEN_KEY)
      revoked_at: null,
    });
    // AUCUN put KV clair 'shopify_token:...'
    expect(
      ctx.kvPuts.find((p) => p.key.startsWith('shopify_token:')),
    ).toBeUndefined();
  });
});

// ── Shopify : pushFn lit via secret store ; token absent ⇒ no-op ─────────────
describe('Shopify pushFn ← secret store', () => {
  it('utilise le token déchiffré du store quand présent', async () => {
    const ctx = makeEnv();
    ctx.secrets.push({
      client_id: 'cliA',
      channel_id: 'ch1',
      kind: 'shopify_token',
      ciphertext: 'shp_live',
      revoked_at: null,
    });
    let sentToken = '';
    (globalThis as any).fetch = async (_u: string, init: any) => {
      sentToken = init.headers['X-Shopify-Access-Token'];
      return { ok: true } as any;
    };
    const push = await shopifyPushFn(ctx.env, chan());
    const ok = await push('inv_1', 5);
    expect(ok).toBe(true);
    expect(sentToken).toBe('shp_live');
  });

  it('token absent (rien en store) ⇒ push no-op (false), pas d’appel HTTP', async () => {
    const ctx = makeEnv();
    let called = false;
    (globalThis as any).fetch = async () => {
      called = true;
      return { ok: true } as any;
    };
    const push = await shopifyPushFn(ctx.env, chan());
    const ok = await push('inv_1', 5);
    expect(ok).toBe(false);
    expect(called).toBe(false);
  });

  it('token révoqué ⇒ getIntegrationToken null ⇒ push no-op', async () => {
    const ctx = makeEnv();
    ctx.secrets.push({
      client_id: 'cliA',
      channel_id: 'ch1',
      kind: 'shopify_token',
      ciphertext: 'shp_live',
      revoked_at: '2026-05-17 00:00:00',
    });
    const push = await shopifyPushFn(ctx.env, chan());
    expect(await push('inv_1', 5)).toBe(false);
  });
});

// ── Woo : callback persiste {ck,cs} sérialisé via secret store ───────────────
describe('Woo callback → secret store', () => {
  it('persiste JSON.stringify({ck,cs}) chiffré, AUCUN woo_creds: clair en KV', async () => {
    const ctx = makeEnv();
    const url = new URL('https://app/api/ecommerce/channels/ch1/callback');
    const req = new Request(url.toString(), {
      method: 'POST',
      body: JSON.stringify({ consumer_key: 'ck_1', consumer_secret: 'cs_1' }),
    });
    const res = await wooCallback(
      ctx.env,
      chan({ type: 'woo' }),
      req,
      url,
    );
    expect(res.status).toBe(200);
    expect(ctx.secrets).toHaveLength(1);
    expect(ctx.secrets[0]).toMatchObject({
      client_id: 'cliA',
      channel_id: 'ch1',
      kind: 'woo_creds',
    });
    // format de sérialisation INCHANGÉ
    expect(JSON.parse(ctx.secrets[0].ciphertext)).toEqual({
      ck: 'ck_1',
      cs: 'cs_1',
    });
    expect(
      ctx.kvPuts.find((p) => p.key.startsWith('woo_creds:')),
    ).toBeUndefined();
  });
});

// ── Woo : pushFn lit/parse via secret store ; absent ⇒ no-op ────────────────
describe('Woo pushFn ← secret store', () => {
  it('déchiffre + parse {ck,cs} et envoie l’auth Basic', async () => {
    const ctx = makeEnv();
    ctx.secrets.push({
      client_id: 'cliA',
      channel_id: 'ch1',
      kind: 'woo_creds',
      ciphertext: JSON.stringify({ ck: 'ck_x', cs: 'cs_x' }),
      revoked_at: null,
    });
    let authHeader = '';
    (globalThis as any).fetch = async (_u: string, init: any) => {
      authHeader = init.headers.Authorization;
      return { ok: true } as any;
    };
    const push = await wooPushFn(ctx.env, chan({ type: 'woo' }));
    expect(await push('p1', 3)).toBe(true);
    expect(authHeader).toBe(`Basic ${btoa('ck_x:cs_x')}`);
  });

  it('creds absentes ⇒ no-op (false)', async () => {
    const ctx = makeEnv();
    const push = await wooPushFn(ctx.env, chan({ type: 'woo' }));
    expect(await push('p1', 3)).toBe(false);
  });
});

// ── Rotation / révocation : audit émis SANS secret + store à jour ────────────
describe('revokeChannelSecret', () => {
  it('révoque, purge la clé KV legacy, audit channel.revoke sans secret', async () => {
    const ctx = makeEnv({ channels: [chan()] });
    ctx.secrets.push({
      client_id: 'cliA',
      channel_id: 'ch1',
      kind: 'shopify_token',
      ciphertext: 'shp_tok',
      revoked_at: null,
    });
    const r = await revokeChannelSecret(
      ctx.env,
      'cliA',
      'ch1',
      'shopify_token',
      'user42',
    );
    expect(r.ok).toBe(true);
    // store à jour : secret révoqué
    expect(ctx.secrets[0].revoked_at).not.toBeNull();
    // legacy KV clair purgé
    expect(ctx.kvDeletes).toContain('shopify_token:ch1');
    // audit émis, user réel propagé, AUCUN secret dans details
    const a = ctx.auditRows.find((x) => x.action === 'channel.revoke');
    expect(a).toBeTruthy();
    expect(a!.user_id).toBe('user42');
    expect(a!.resource_id).toBe('ch1');
    expect(a!.details).toBe(JSON.stringify({ kind: 'shopify_token' }));
    expect(a!.details).not.toContain('shp_tok');
  });

  it('userId omis ⇒ fallback system', async () => {
    const ctx = makeEnv({ channels: [chan()] });
    const r = await revokeChannelSecret(ctx.env, 'cliA', 'ch1', 'woo_creds');
    expect(r.ok).toBe(true);
    expect(
      ctx.auditRows.find((x) => x.action === 'channel.revoke')!.user_id,
    ).toBe('system');
  });
});

describe('rotateChannelSecret', () => {
  it('révoque l’actuel, exige reconnexion, audit channel.rotate sans secret', async () => {
    const ctx = makeEnv({ channels: [chan()] });
    ctx.secrets.push({
      client_id: 'cliA',
      channel_id: 'ch1',
      kind: 'shopify_token',
      ciphertext: 'shp_tok',
      revoked_at: null,
    });
    const r = await rotateChannelSecret(
      ctx.env,
      'cliA',
      'ch1',
      'shopify_token',
      'user42',
    );
    expect(r).toEqual({ ok: true, reconnect_required: true });
    expect(ctx.secrets[0].revoked_at).not.toBeNull(); // pas de faux token
    const a = ctx.auditRows.find((x) => x.action === 'channel.rotate');
    expect(a).toBeTruthy();
    expect(a!.details).not.toContain('shp_tok');
    expect(JSON.parse(a!.details)).toEqual({
      kind: 'shopify_token',
      reconnect_required: true,
    });
  });
});

// ── Garde-fou multi-tenant : mauvais clientId ⇒ pas d’accès ─────────────────
describe('multi-tenant strict', () => {
  it('revoke avec mauvais clientId ⇒ canal introuvable, aucune révocation/audit', async () => {
    const ctx = makeEnv({ channels: [chan({ client_id: 'cliA' })] });
    ctx.secrets.push({
      client_id: 'cliA',
      channel_id: 'ch1',
      kind: 'shopify_token',
      ciphertext: 'shp_tok',
      revoked_at: null,
    });
    const r = await revokeChannelSecret(
      ctx.env,
      'cliB', // mauvais tenant
      'ch1',
      'shopify_token',
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/introuvable/i);
    expect(ctx.secrets[0].revoked_at).toBeNull(); // intact
    expect(ctx.auditRows).toHaveLength(0); // pas d’audit fuité
  });

  it('getIntegrationToken filtre client_id : autre tenant ⇒ null ⇒ push no-op', async () => {
    const ctx = makeEnv();
    // secret appartient à cliA
    ctx.secrets.push({
      client_id: 'cliA',
      channel_id: 'ch1',
      kind: 'shopify_token',
      ciphertext: 'shp_live',
      revoked_at: null,
    });
    // canal du mauvais tenant cliB
    const push = await shopifyPushFn(ctx.env, chan({ client_id: 'cliB' }));
    expect(await push('inv_1', 5)).toBe(false);
  });
});
