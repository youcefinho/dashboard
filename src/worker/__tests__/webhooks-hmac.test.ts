import { describe, it, expect } from 'vitest';
import { generateWebhookSignature, verifyWebhookSignature } from '../webhooks-dispatch';

describe('Webhooks HMAC', () => {
  it('devrait générer et vérifier une signature valide', async () => {
    const payload = {
      event_id: 'evt_123',
      event_type: 'lead.created',
      data: { id: 'lead_1', name: 'John Doe' }
    };
    const secret = 'whsec_abcdef123456';
    
    // Test generation
    const signature = await generateWebhookSignature(payload, secret);
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

    // Test verification
    const isValid = await verifyWebhookSignature(payload, secret, signature);
    expect(isValid).toBe(true);
  });

  it('devrait rejeter une signature invalide (secret différent)', async () => {
    const payload = { test: true };
    const signature = await generateWebhookSignature(payload, 'secret1');
    const isValid = await verifyWebhookSignature(payload, 'secret2', signature);
    expect(isValid).toBe(false);
  });

  it('devrait rejeter un payload modifié', async () => {
    const payload1 = { id: 1, amount: 100 };
    const payload2 = { id: 1, amount: 1000 }; // attacker modification
    const secret = 'shared_secret';
    
    const signature1 = await generateWebhookSignature(payload1, secret);
    const isValid = await verifyWebhookSignature(payload2, secret, signature1);
    expect(isValid).toBe(false);
  });
});
