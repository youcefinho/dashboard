// ── Tests Sprint 9 — Différenciateurs Intralys ───────────────
import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../src/worker/types';

// ── Mock DB factory ──────────────────────────────────────────

function createMockDb() {
  return {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({}),
    batch: vi.fn().mockResolvedValue([]),
  };
}

describe('Sprint 9 - Centris Sync', () => {
  it('doit refuser la synchronisation si le mls_number est manquant', async () => {
    const mockEnv = { DB: createMockDb() } as unknown as Env;
    const { handleSyncCentris } = await import('../src/worker/properties');
    
    const req = new Request('http://localhost/api/properties/centris-sync', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    
    const res = await handleSyncCentris(req, mockEnv, { userId: 'u1', role: 'admin', clientId: 'c1' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('Numéro MLS requis');
  });
});

describe('Sprint 9 - Compliance AMF', () => {
  it('doit injecter le disclaimer AMF dans le footer si configuré (mock mode)', async () => {
    // on vérifie que handleEmailBroadcast l'injecte
    const mockDb = createMockDb();
    
    // Mock clients query
    mockDb.first.mockResolvedValueOnce({ amf_certificate: 'AMF-123', amf_disclaimer_required: 1 });
    
    const mockEnv = { 
      DB: mockDb, 
      USE_MOCKS: 'true',
      BROADCAST_QUEUE: { send: vi.fn() }
    } as unknown as Env;

    const { processBroadcastQueueJob } = await import('../src/worker/broadcast');
    
    const batch = {
      messages: [{
        body: {
          broadcastId: 'b1',
          subject: 'Test',
          htmlContent: '<p>Hello</p>',
          textContent: 'Hello',
          clientId: 'client-1',
          authUserId: 'u1',
          leads: [{ id: 'l1', email: 'test@test.com', phone: '' }],
          origin: 'http://localhost'
        },
        ack: vi.fn()
      }]
    };

    // On mock aussi l'isUnsubscribed qui fait le premier 'first()'
    mockDb.first = vi.fn()
      .mockResolvedValueOnce(null) // isUnsub = false
      .mockResolvedValueOnce({ amf_certificate: 'AMF-123', amf_disclaimer_required: 1 }) // clientId lookup
      .mockResolvedValueOnce({ total: 1, sent: 1, failed: 0 }); // broadcast stats

    await processBroadcastQueueJob(batch as any, mockEnv);
    
    // check that the message was inserted with the AMF text
    expect(mockDb.run).toHaveBeenCalled();
    const runCalls = mockDb.run.mock.calls;
    const insertMsgCall = runCalls.find((call: any) => call[0] && call[0].includes && call[0].includes('INSERT INTO messages'));
    if (!insertMsgCall) {
        // C'est pas appelé car la query est mockée dans bind().run()
        // Mais bind() stocke les arguments
        const bindCalls = mockDb.bind.mock.calls;
        const msgBind = bindCalls.find((args: any) => typeof args[4] === 'string' && args[4].includes('AMF-123'));
        expect(msgBind).toBeDefined();
    }
  });
});
