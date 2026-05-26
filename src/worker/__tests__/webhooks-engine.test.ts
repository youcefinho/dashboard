// ── Tests src/worker/lib/webhooks-engine.ts — LOT WEBHOOKS (Integ P2-4) ────
// Helpers PURS : signature HMAC SHA-256 timestampée, backoff exp, validation
// URL anti-SSRF, validation events, idempotency. ZÉRO I/O DB.
import { describe, it, expect } from 'vitest';
import {
  WEBHOOKS_ERROR_CODES,
  MAX_RETRIES,
  WEBHOOK_TIMEOUT_MS,
  DEFAULT_TOLERANCE_SECONDS,
  MAX_BACKOFF_MS,
  INITIAL_BACKOFF_MS,
  VALID_EVENT_PREFIXES,
  generateSignature,
  parseSignatureHeader,
  verifySignature,
  computeRetryDelay,
  validateWebhookUrl,
  validateEventSubscription,
  idempotencyKeyForDelivery,
  timingSafeEqualHex,
} from '../lib/webhooks-engine';

describe('Constants', () => {
  it('expose des codes stables + constantes critiques', () => {
    expect(WEBHOOKS_ERROR_CODES.SIGNATURE_INVALID).toBe('webhooks.signature.invalid');
    expect(MAX_RETRIES).toBe(10);
    expect(WEBHOOK_TIMEOUT_MS).toBe(10_000);
    expect(DEFAULT_TOLERANCE_SECONDS).toBe(300);
    expect(MAX_BACKOFF_MS).toBe(3_600_000); // 1h
  });

  it('expose une whitelist event prefixes', () => {
    expect(VALID_EVENT_PREFIXES).toContain('lead');
    expect(VALID_EVENT_PREFIXES).toContain('order');
    expect(Object.isFrozen(VALID_EVENT_PREFIXES)).toBe(true);
  });
});

describe('generateSignature + parseSignatureHeader', () => {
  it('génère un format "t=<ts>,v1=<hex>"', async () => {
    const sig = await generateSignature('payload', 'secret', 1700000000);
    expect(sig).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  it('throw sur secret vide', async () => {
    await expect(generateSignature('payload', '', 1700000000)).rejects.toThrow();
  });

  it('throw sur ts invalide', async () => {
    await expect(generateSignature('payload', 'secret', NaN)).rejects.toThrow();
    await expect(generateSignature('payload', 'secret', -1)).rejects.toThrow();
  });

  it('parseSignatureHeader extrait ts + v1', () => {
    const r = parseSignatureHeader('t=1700000000,v1=abc123');
    expect(r?.ts).toBe(1700000000);
    expect(r?.v1).toEqual(['abc123']);
  });

  it('parseSignatureHeader gère plusieurs v1 (rotation)', () => {
    const r = parseSignatureHeader('t=1700000000,v1=abc,v1=DEF');
    expect(r?.v1).toEqual(['abc', 'def']);
  });

  it('parseSignatureHeader renvoie null si pas de ts', () => {
    expect(parseSignatureHeader('v1=abc')).toBeNull();
  });

  it('parseSignatureHeader renvoie null si pas de v1', () => {
    expect(parseSignatureHeader('t=1700000000')).toBeNull();
  });

  it('parseSignatureHeader renvoie null pour input vide/null', () => {
    expect(parseSignatureHeader(null)).toBeNull();
    expect(parseSignatureHeader('')).toBeNull();
    expect(parseSignatureHeader(undefined)).toBeNull();
  });

  it('parseSignatureHeader rejette les hex invalides', () => {
    const r = parseSignatureHeader('t=1700000000,v1=GGG');
    expect(r).toBeNull();
  });
});

describe('verifySignature — timing-safe + tolerance', () => {
  const secret = 'webhook_secret_42';

  it('renvoie true pour signature fraîche + valide', async () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const ts = Math.floor(now.getTime() / 1000);
    const sig = await generateSignature('payload', secret, ts);
    expect(await verifySignature('payload', sig, secret, 300, now)).toBe(true);
  });

  it('renvoie false si payload modifié', async () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const ts = Math.floor(now.getTime() / 1000);
    const sig = await generateSignature('payload', secret, ts);
    expect(await verifySignature('payload_tampered', sig, secret, 300, now)).toBe(false);
  });

  it('renvoie false si secret différent', async () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const ts = Math.floor(now.getTime() / 1000);
    const sig = await generateSignature('payload', secret, ts);
    expect(await verifySignature('payload', sig, 'wrong', 300, now)).toBe(false);
  });

  it('renvoie false si timestamp hors tolérance (replay)', async () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const oldTs = Math.floor(now.getTime() / 1000) - 1000; // 1000s avant
    const sig = await generateSignature('payload', secret, oldTs);
    expect(await verifySignature('payload', sig, secret, 300, now)).toBe(false);
  });

  it('renvoie false si secret vide', async () => {
    expect(await verifySignature('p', 't=1,v1=abc', '')).toBe(false);
  });

  it('renvoie false si header invalide', async () => {
    expect(await verifySignature('p', null, secret)).toBe(false);
    expect(await verifySignature('p', 'garbage', secret)).toBe(false);
  });
});

describe('timingSafeEqualHex', () => {
  it('comparaison strings identiques', () => {
    expect(timingSafeEqualHex('abc', 'abc')).toBe(true);
  });
  it('comparaison strings différentes', () => {
    expect(timingSafeEqualHex('abc', 'abd')).toBe(false);
  });
  it('refuse longueurs différentes', () => {
    expect(timingSafeEqualHex('a', 'aa')).toBe(false);
  });
});

describe('computeRetryDelay — backoff exponentiel cappé', () => {
  it('attempt 0 → INITIAL', () => {
    expect(computeRetryDelay(0)).toBe(INITIAL_BACKOFF_MS);
  });
  it('attempt négatif → INITIAL', () => {
    expect(computeRetryDelay(-1)).toBe(INITIAL_BACKOFF_MS);
  });
  it('attempt NaN → INITIAL', () => {
    expect(computeRetryDelay(NaN)).toBe(INITIAL_BACKOFF_MS);
  });
  it('attempt 1 → 2x', () => {
    expect(computeRetryDelay(1)).toBe(INITIAL_BACKOFF_MS * 2);
  });
  it('attempt 3 → 8x', () => {
    expect(computeRetryDelay(3)).toBe(INITIAL_BACKOFF_MS * 8);
  });
  it('cappé à MAX_BACKOFF_MS (1h)', () => {
    expect(computeRetryDelay(30)).toBe(MAX_BACKOFF_MS);
    expect(computeRetryDelay(1000)).toBe(MAX_BACKOFF_MS);
  });
  it('croît monotone jusqu\'au cap', () => {
    let prev = 0;
    for (let i = 0; i < 25; i++) {
      const d = computeRetryDelay(i);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

describe('validateWebhookUrl — anti-SSRF + https only', () => {
  it('accepte https valide', () => {
    expect(validateWebhookUrl('https://example.com/hook').ok).toBe(true);
  });

  it('refuse http en prod', () => {
    const r = validateWebhookUrl('http://example.com/hook');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(WEBHOOKS_ERROR_CODES.URL_NOT_HTTPS);
  });

  it('accepte http SI allowHttp', () => {
    expect(validateWebhookUrl('http://example.com/hook', { allowHttp: true }).ok).toBe(true);
  });

  it('refuse localhost en prod', () => {
    const r = validateWebhookUrl('https://localhost/hook');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(WEBHOOKS_ERROR_CODES.URL_LOCALHOST);
  });

  it('refuse 127.0.0.1 en prod', () => {
    expect(validateWebhookUrl('https://127.0.0.1/hook').ok).toBe(false);
  });

  it('refuse IPs privées 10.* / 172.16-31.* / 192.168.*', () => {
    expect(validateWebhookUrl('https://10.0.0.1/h').ok).toBe(false);
    expect(validateWebhookUrl('https://172.16.0.1/h').ok).toBe(false);
    expect(validateWebhookUrl('https://172.31.255.255/h').ok).toBe(false);
    expect(validateWebhookUrl('https://192.168.1.1/h').ok).toBe(false);
  });

  it('refuse link-local 169.254.*', () => {
    expect(validateWebhookUrl('https://169.254.169.254/').ok).toBe(false);
  });

  it('accepte IP publique', () => {
    expect(validateWebhookUrl('https://1.1.1.1/h').ok).toBe(true);
  });

  it('accepte 172.32.* (hors privée)', () => {
    expect(validateWebhookUrl('https://172.32.0.1/h').ok).toBe(true);
  });

  it('refuse URL invalide', () => {
    expect(validateWebhookUrl('not a url').ok).toBe(false);
    expect(validateWebhookUrl('').ok).toBe(false);
    expect(validateWebhookUrl(null).ok).toBe(false);
  });

  it('refuse URL trop longue', () => {
    expect(validateWebhookUrl('https://e.com/' + 'a'.repeat(3000)).ok).toBe(false);
  });
});

describe('validateEventSubscription', () => {
  it('accepte le wildcard *', () => {
    expect(validateEventSubscription('*').ok).toBe(true);
  });

  it('accepte un event whitelisté', () => {
    expect(validateEventSubscription(['lead.created']).ok).toBe(true);
    expect(validateEventSubscription(['order.refunded', 'task.completed']).ok).toBe(true);
  });

  it('accepte une string unique', () => {
    expect(validateEventSubscription('lead.created').ok).toBe(true);
  });

  it('refuse un prefix hors whitelist', () => {
    const r = validateEventSubscription(['unknown.created']);
    expect(r.ok).toBe(false);
    expect(r.invalid).toContain('unknown.created');
  });

  it('refuse un format sans dot', () => {
    expect(validateEventSubscription(['leadcreated']).ok).toBe(false);
  });

  it('refuse une action vide ou invalide', () => {
    expect(validateEventSubscription(['lead.']).ok).toBe(false);
    expect(validateEventSubscription(['lead.@@@']).ok).toBe(false);
  });

  it('refuse array vide', () => {
    const r = validateEventSubscription([]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(WEBHOOKS_ERROR_CODES.EVENTS_EMPTY);
  });

  it('mélange wildcard + spécifiques tolérés', () => {
    expect(validateEventSubscription(['*', 'lead.created']).ok).toBe(true);
  });
});

describe('idempotencyKeyForDelivery', () => {
  it('format <webhookId>:<eventId>', () => {
    expect(idempotencyKeyForDelivery('wh_1', 'evt_42')).toBe('wh_1:evt_42');
  });

  it('trim les inputs', () => {
    expect(idempotencyKeyForDelivery(' wh_1 ', ' evt_42 ')).toBe('wh_1:evt_42');
  });

  it('renvoie chaîne vide si input absent', () => {
    expect(idempotencyKeyForDelivery('', 'evt')).toBe('');
    expect(idempotencyKeyForDelivery('wh', '')).toBe('');
    expect(idempotencyKeyForDelivery(null, undefined)).toBe('');
  });
});
