// ── Tests processWebhookDelivery (Sprint 13.5 Phase B.2 backoff retry) ──
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processWebhookDelivery } from '../webhooks-queue';
import type { Env } from '../types';

vi.mock('../webhooks-dispatch', () => ({
  sendWebhookDirectly: vi.fn(),
}));
import { sendWebhookDirectly } from '../webhooks-dispatch';

describe('processWebhookDelivery — backoff retry + dead-letter + auto-disable', () => {
  let mockEnv: any;
  let message: any;
  let batch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        run: vi.fn().mockResolvedValue({}),
      },
    };
    message = {
      body: { deliveryId: 'del_1', subscriptionId: 'sub_1', url: 'https://test.com' },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    batch = { messages: [message] };
  });

  it('ack quand la livraison est marquée delivered', async () => {
    (sendWebhookDirectly as any).mockResolvedValue(undefined);
    mockEnv.DB.first
      .mockResolvedValueOnce({ status: 'delivered' })       // delivery status check
      .mockResolvedValueOnce({ fail_count: 0 });             // checkAndDisableWebhook

    await processWebhookDelivery(batch, mockEnv as Env);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('retry avec backoff 60s à la 1ère tentative', async () => {
    (sendWebhookDirectly as any).mockResolvedValue(undefined);
    mockEnv.DB.first
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({ attempt: 0 })                 // getAttemptCount
      .mockResolvedValueOnce({ fail_count: 1 });

    await processWebhookDelivery(batch, mockEnv as Env);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it('retry avec backoff 1800s à la 3ème tentative', async () => {
    (sendWebhookDirectly as any).mockResolvedValue(undefined);
    mockEnv.DB.first
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({ attempt: 2 })                 // 3ème tentative
      .mockResolvedValueOnce({ fail_count: 3 });

    await processWebhookDelivery(batch, mockEnv as Env);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 1800 });
  });

  it('dead-letter après 5 tentatives — status update + ack', async () => {
    (sendWebhookDirectly as any).mockResolvedValue(undefined);
    mockEnv.DB.first
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({ attempt: 5 })                 // MAX_ATTEMPTS atteint
      .mockResolvedValueOnce({ fail_count: 5 });

    await processWebhookDelivery(batch, mockEnv as Env);

    const runCalls = (mockEnv.DB.prepare as any).mock.calls.map((c: any) => c[0]).filter((s: string) => s.includes('dead_letter'));
    expect(runCalls.length).toBeGreaterThan(0);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('désactive la subscription après 100 échecs cumulés', async () => {
    (sendWebhookDirectly as any).mockResolvedValue(undefined);
    mockEnv.DB.first
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({ attempt: 1 })
      .mockResolvedValueOnce({ fail_count: 105 });           // > DISABLE_THRESHOLD

    await processWebhookDelivery(batch, mockEnv as Env);

    const disableCalls = (mockEnv.DB.prepare as any).mock.calls.map((c: any) => c[0]).filter((s: string) => s.includes('is_active = 0'));
    expect(disableCalls.length).toBe(1);
  });

  it('gère exception sendWebhookDirectly et retry quand même', async () => {
    (sendWebhookDirectly as any).mockRejectedValue(new Error('Network timeout'));
    mockEnv.DB.first
      .mockResolvedValueOnce({ attempt: 1 })                 // getAttemptCount dans catch
      .mockResolvedValueOnce({ fail_count: 2 });

    await processWebhookDelivery(batch, mockEnv as Env);

    expect(message.retry).toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
  });
});
