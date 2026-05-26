// ── Tests src/worker/lib/meta-engine.ts — LOT META (Integrations P2-4) ─────
// Helpers PURS : validation state, signature webhook HMAC SHA-256, validation
// IDs Meta, parsing webhook event. ZÉRO I/O DB.
import { describe, it, expect } from 'vitest';
import {
  META_ERROR_CODES,
  META_OAUTH_SCOPES,
  validateMetaState,
  verifyMetaWebhookSignature,
  validatePageId,
  validateIgId,
  parseMetaWebhookEvent,
  validateRequestedMetaScopes,
  timingSafeEqualHex,
  MIN_STATE_LENGTH,
} from '../lib/meta-engine';

describe('META_ERROR_CODES + META_OAUTH_SCOPES — figés', () => {
  it('expose des codes stables et frozen', () => {
    expect(META_ERROR_CODES.STATE_INVALID).toBe('meta.state.invalid');
    expect(META_ERROR_CODES.SIGNATURE_INVALID).toBe('meta.signature.invalid');
    expect(Object.isFrozen(META_ERROR_CODES)).toBe(true);
  });

  it('whitelist scopes Meta v18.0 frozen', () => {
    expect(META_OAUTH_SCOPES).toContain('pages_manage_metadata');
    expect(META_OAUTH_SCOPES).toContain('instagram_basic');
    expect(META_OAUTH_SCOPES).toContain('leads_retrieval');
    expect(Object.isFrozen(META_OAUTH_SCOPES)).toBe(true);
  });
});

describe('validateMetaState — anti-CSRF', () => {
  it('accepte un state hex de 32+ chars', () => {
    expect(validateMetaState('a'.repeat(MIN_STATE_LENGTH))).toBe(true);
    expect(validateMetaState('0123456789abcdef0123456789abcdef')).toBe(true);
  });

  it('accepte les caractères URL-safe (alphanum + _ -)', () => {
    expect(validateMetaState('abc-123_DEF-456_ghi-789_jkl-1234')).toBe(true);
  });

  it('refuse un state trop court', () => {
    expect(validateMetaState('short')).toBe(false);
    expect(validateMetaState('a'.repeat(MIN_STATE_LENGTH - 1))).toBe(false);
  });

  it('refuse un state trop long', () => {
    expect(validateMetaState('a'.repeat(129))).toBe(false);
  });

  it('refuse des caractères interdits (espace, slash, accents)', () => {
    expect(validateMetaState('a'.repeat(31) + ' ')).toBe(false);
    expect(validateMetaState('a'.repeat(31) + '/')).toBe(false);
    expect(validateMetaState('é'.repeat(32))).toBe(false);
  });

  it('refuse les types non-string', () => {
    expect(validateMetaState(null)).toBe(false);
    expect(validateMetaState(undefined)).toBe(false);
    expect(validateMetaState(12345)).toBe(false);
    expect(validateMetaState({})).toBe(false);
  });
});

describe('validatePageId / validateIgId — Meta numeric IDs', () => {
  it('accepte des digits dans la fourchette 8-32 chars', () => {
    expect(validatePageId('12345678')).toBe(true);
    expect(validatePageId('123456789012345')).toBe(true);
    expect(validateIgId('17841412345678901')).toBe(true);
  });

  it('refuse les IDs trop courts ou trop longs', () => {
    expect(validatePageId('1234567')).toBe(false);
    expect(validatePageId('1'.repeat(33))).toBe(false);
  });

  it('refuse les caractères non-numériques', () => {
    expect(validatePageId('page-12345678')).toBe(false);
    expect(validatePageId('1234567a8')).toBe(false);
    expect(validateIgId('ig_account_123')).toBe(false);
  });

  it('refuse les types non-string', () => {
    expect(validatePageId(123456789)).toBe(false);
    expect(validateIgId(null)).toBe(false);
  });
});

describe('verifyMetaWebhookSignature — HMAC SHA-256 timing-safe', () => {
  const secret = 'test_app_secret_123';
  const payload = '{"object":"page","entry":[]}';

  async function makeSig(payload: string, secret: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const buf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    return `sha256=${hex}`;
  }

  it('retourne null si appSecret absent (mode legacy)', async () => {
    const result = await verifyMetaWebhookSignature(payload, 'sha256=abc', undefined);
    expect(result).toBeNull();
    const result2 = await verifyMetaWebhookSignature(payload, 'sha256=abc', '');
    expect(result2).toBeNull();
  });

  it('retourne false si header signature absent', async () => {
    expect(await verifyMetaWebhookSignature(payload, null, secret)).toBe(false);
    expect(await verifyMetaWebhookSignature(payload, '', secret)).toBe(false);
  });

  it('retourne false si format header invalide', async () => {
    expect(await verifyMetaWebhookSignature(payload, 'invalid-format', secret)).toBe(false);
    expect(await verifyMetaWebhookSignature(payload, 'md5=abc', secret)).toBe(false);
    expect(await verifyMetaWebhookSignature(payload, 'sha256=', secret)).toBe(false);
    expect(await verifyMetaWebhookSignature(payload, 'sha256=zzz', secret)).toBe(false);
  });

  it('retourne true pour signature valide', async () => {
    const sig = await makeSig(payload, secret);
    expect(await verifyMetaWebhookSignature(payload, sig, secret)).toBe(true);
  });

  it('retourne false pour signature avec secret différent', async () => {
    const sig = await makeSig(payload, secret);
    expect(await verifyMetaWebhookSignature(payload, sig, 'wrong_secret')).toBe(false);
  });

  it('retourne false pour signature avec payload modifié', async () => {
    const sig = await makeSig(payload, secret);
    expect(await verifyMetaWebhookSignature(payload + 'x', sig, secret)).toBe(false);
  });

  it('accepte la casse mixte dans le hex header', async () => {
    const sig = await makeSig(payload, secret);
    expect(await verifyMetaWebhookSignature(payload, sig.toUpperCase(), secret)).toBe(true);
  });
});

describe('timingSafeEqualHex — comparaison constant-time', () => {
  it('renvoie true pour chaînes identiques', () => {
    expect(timingSafeEqualHex('abc123', 'abc123')).toBe(true);
  });

  it('renvoie false pour chaînes différentes même longueur', () => {
    expect(timingSafeEqualHex('abc123', 'abc124')).toBe(false);
  });

  it('renvoie false pour longueurs différentes', () => {
    expect(timingSafeEqualHex('abc', 'abcd')).toBe(false);
  });

  it('renvoie false pour chaînes vides différentes longueur', () => {
    expect(timingSafeEqualHex('', 'a')).toBe(false);
  });
});

describe('parseMetaWebhookEvent — branch messaging | leadgen', () => {
  it('renvoie unknown pour body non-objet', () => {
    expect(parseMetaWebhookEvent(null).kind).toBe('unknown');
    expect(parseMetaWebhookEvent('string').kind).toBe('unknown');
    expect(parseMetaWebhookEvent(42).kind).toBe('unknown');
  });

  it('renvoie unknown si object !== page', () => {
    const r = parseMetaWebhookEvent({ object: 'user', entry: [] });
    expect(r.kind).toBe('unknown');
    expect(r.error).toBe(META_ERROR_CODES.WEBHOOK_OBJECT_UNSUPPORTED);
  });

  it('parse une entry messaging', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: '123456789012345',
          messaging: [{ sender: { id: 'psid1' }, message: { text: 'hi' } }],
        },
      ],
    };
    const r = parseMetaWebhookEvent(body);
    expect(r.kind).toBe('messaging');
    expect(r.data).toHaveLength(1);
    expect(r.data[0]?.subKind).toBe('messaging');
    expect(r.data[0]?.pageId).toBe('123456789012345');
  });

  it('parse une entry leadgen', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: '123456789012345',
          changes: [
            {
              field: 'leadgen',
              value: { leadgen_id: 'lead_42', form_id: 'form_1' },
            },
          ],
        },
      ],
    };
    const r = parseMetaWebhookEvent(body);
    expect(r.kind).toBe('leadgen');
    expect(r.data[0]?.subKind).toBe('leadgen');
  });

  it('ignore les changes non-leadgen', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: '123456789012345',
          changes: [{ field: 'mentions', value: {} }],
        },
      ],
    };
    const r = parseMetaWebhookEvent(body);
    expect(r.data).toHaveLength(0);
    expect(r.kind).toBe('unknown');
  });

  it('ignore les entries sans id', () => {
    const body = {
      object: 'page',
      entry: [{ messaging: [{ sender: { id: 'x' } }] }],
    };
    expect(parseMetaWebhookEvent(body).data).toHaveLength(0);
  });

  it('tolère un entry corrompu (mix mauvais types)', () => {
    const body = {
      object: 'page',
      entry: [null, 'string', { id: '123456789012345', messaging: [null, 'x', { ok: 1 }] }],
    };
    const r = parseMetaWebhookEvent(body);
    expect(r.data).toHaveLength(1);
  });
});

describe('validateRequestedMetaScopes — whitelist', () => {
  it('accepte une liste de scopes valides', () => {
    expect(validateRequestedMetaScopes('pages_manage_metadata').ok).toBe(true);
    expect(
      validateRequestedMetaScopes('pages_manage_metadata,instagram_basic').ok,
    ).toBe(true);
    expect(
      validateRequestedMetaScopes('pages_manage_metadata instagram_basic').ok,
    ).toBe(true);
  });

  it('refuse un scope hors whitelist', () => {
    const r = validateRequestedMetaScopes('pages_manage_metadata,foo_bar');
    expect(r.ok).toBe(false);
    expect(r.invalid).toContain('foo_bar');
  });

  it('refuse une chaîne vide ou invalide', () => {
    expect(validateRequestedMetaScopes('').ok).toBe(false);
    expect(validateRequestedMetaScopes('   ').ok).toBe(false);
  });
});
