// ── channel-sync-engine.test.ts — Renforcement P2-3 (2026-05-26) ───────────
// Tests unitaires des helpers PURS channel-sync-engine.ts. 15+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  CHANNEL_SYNC_ERROR_CODES,
  VALID_SYNC_STATUSES,
  VALID_CHANNELS_SYNC,
  MAX_RETRY_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  BASE_RETRY_DELAY_MS,
  validateStatusTransition,
  computeRetryDelay,
  parseChannelWebhook,
  validateSyncMapping,
} from '../lib/channel-sync-engine';

describe('CHANNEL_SYNC constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(CHANNEL_SYNC_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(VALID_SYNC_STATUSES)).toBe(true);
    expect(Object.isFrozen(VALID_CHANNELS_SYNC)).toBe(true);
  });

  it('VALID_SYNC_STATUSES = pending/syncing/synced/error/conflict', () => {
    expect(VALID_SYNC_STATUSES).toEqual(['pending', 'syncing', 'synced', 'error', 'conflict']);
  });

  it('VALID_CHANNELS_SYNC contient shopify/woocommerce/amazon/ebay/other', () => {
    expect(VALID_CHANNELS_SYNC).toContain('shopify');
    expect(VALID_CHANNELS_SYNC).toContain('woocommerce');
    expect(VALID_CHANNELS_SYNC).toContain('amazon');
    expect(VALID_CHANNELS_SYNC).toContain('ebay');
    expect(VALID_CHANNELS_SYNC).toContain('other');
  });
});

describe('validateStatusTransition', () => {
  it('pending → syncing OK', () => {
    expect(validateStatusTransition('pending', 'syncing').ok).toBe(true);
  });

  it('syncing → synced OK', () => {
    expect(validateStatusTransition('syncing', 'synced').ok).toBe(true);
  });

  it('syncing → error OK', () => {
    expect(validateStatusTransition('syncing', 'error').ok).toBe(true);
  });

  it('synced → syncing INTERDIT', () => {
    const r = validateStatusTransition('synced', 'syncing');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHANNEL_SYNC_ERROR_CODES.TRANSITION_INVALID);
  });

  it('synced → pending OK (re-sync)', () => {
    expect(validateStatusTransition('synced', 'pending').ok).toBe(true);
  });

  it('error → pending OK (retry)', () => {
    expect(validateStatusTransition('error', 'pending').ok).toBe(true);
  });

  it('conflict → syncing OK (force retry)', () => {
    expect(validateStatusTransition('conflict', 'syncing').ok).toBe(true);
  });

  it('idempotence : same → same OK', () => {
    expect(validateStatusTransition('synced', 'synced').ok).toBe(true);
  });

  it('rejette statut invalide', () => {
    const r = validateStatusTransition('unknown', 'synced');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHANNEL_SYNC_ERROR_CODES.STATUS_INVALID);
  });

  it('rejette non-string', () => {
    expect(validateStatusTransition(null, 'synced').ok).toBe(false);
    expect(validateStatusTransition('pending', 123).ok).toBe(false);
  });
});

describe('computeRetryDelay', () => {
  it('attempt 0 ⇒ BASE_RETRY_DELAY_MS', () => {
    expect(computeRetryDelay(0)).toBe(BASE_RETRY_DELAY_MS);
  });

  it('attempt 1 ⇒ 2× BASE', () => {
    expect(computeRetryDelay(1)).toBe(BASE_RETRY_DELAY_MS * 2);
  });

  it('attempt 5 ⇒ 32× BASE', () => {
    expect(computeRetryDelay(5)).toBe(BASE_RETRY_DELAY_MS * 32);
  });

  it('attempt très grand ⇒ cappé à MAX_RETRY_DELAY_MS', () => {
    expect(computeRetryDelay(20)).toBe(MAX_RETRY_DELAY_MS);
  });

  it('attempt > MAX_RETRY_ATTEMPTS ⇒ MAX', () => {
    expect(computeRetryDelay(MAX_RETRY_ATTEMPTS + 1)).toBe(MAX_RETRY_DELAY_MS);
  });

  it('attempt négatif ⇒ 0', () => {
    expect(computeRetryDelay(-1)).toBe(0);
  });

  it('attempt NaN ⇒ BASE', () => {
    expect(computeRetryDelay(NaN)).toBe(BASE_RETRY_DELAY_MS);
  });
});

describe('parseChannelWebhook', () => {
  it('détecte orders/create Shopify via topic', () => {
    const r = parseChannelWebhook('shopify', {
      topic: 'orders/create',
      line_items: [],
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('order_created');
  });

  it('détecte product.updated Woo via event', () => {
    const r = parseChannelWebhook('woocommerce', {
      event: 'product.updated',
      product_id: 123,
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('product_updated');
  });

  it('détecte refund via topic', () => {
    const r = parseChannelWebhook('shopify', {
      topic: 'refunds/create',
      amount_refunded: 100,
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('refund_created');
  });

  it('fallback heuristique : line_items présents ⇒ order_created', () => {
    const r = parseChannelWebhook('shopify', { line_items: [{ id: 1 }] });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('order_created');
  });

  it('payload non-objet ⇒ error', () => {
    const r = parseChannelWebhook('shopify', 'string');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHANNEL_SYNC_ERROR_CODES.WEBHOOK_PAYLOAD_INVALID);
  });

  it('canal invalide ⇒ error', () => {
    const r = parseChannelWebhook('myspace', { topic: 'orders/create' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHANNEL_SYNC_ERROR_CODES.CHANNEL_INVALID);
  });

  it('payload obscur ⇒ unknown', () => {
    const r = parseChannelWebhook('shopify', { random: 'stuff' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHANNEL_SYNC_ERROR_CODES.WEBHOOK_KIND_UNKNOWN);
  });

  it('détecte customer via email + first_name', () => {
    const r = parseChannelWebhook('shopify', {
      email: 'a@b.c',
      first_name: 'Alice',
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('customer_created');
  });
});

describe('validateSyncMapping', () => {
  it('accepte mapping valide', () => {
    expect(validateSyncMapping('local-123', 'ext-456', 'shopify').ok).toBe(true);
  });

  it('rejette localId vide', () => {
    const r = validateSyncMapping('', 'ext-456', 'shopify');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHANNEL_SYNC_ERROR_CODES.LOCAL_ID_INVALID);
  });

  it('rejette channelId vide', () => {
    const r = validateSyncMapping('local-123', '   ', 'shopify');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHANNEL_SYNC_ERROR_CODES.CHANNEL_ID_INVALID);
  });

  it('rejette canal hors whitelist', () => {
    const r = validateSyncMapping('local-123', 'ext-456', 'myspace');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHANNEL_SYNC_ERROR_CODES.CHANNEL_INVALID);
  });

  it('rejette ID trop longs (anti-injection)', () => {
    const long = 'x'.repeat(300);
    const r = validateSyncMapping(long, 'ext-456', 'shopify');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHANNEL_SYNC_ERROR_CODES.MAPPING_INVALID);
  });

  it('rejette types non-string', () => {
    expect(validateSyncMapping(123, 'ext-456', 'shopify').ok).toBe(false);
    expect(validateSyncMapping('local-123', null, 'shopify').ok).toBe(false);
    expect(validateSyncMapping('local-123', 'ext-456', undefined).ok).toBe(false);
  });
});
