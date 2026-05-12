import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishEvent } from '../webhooks-dispatch';
import type { Env } from '../types';

describe('Webhooks Dispatcher', () => {
  let mockEnv: any;

  beforeEach(() => {
    mockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        all: vi.fn(),
        run: vi.fn(),
      },
      WEBHOOK_QUEUE: {
        send: vi.fn(),
      }
    };
  });

  it('ne devrait rien faire si aucun webhook configuré', async () => {
    mockEnv.DB.all.mockResolvedValue({ results: [] });
    
    // publishEvent est synchrone mais déclenche une Promise interne
    publishEvent(mockEnv as unknown as Env, 'client_1', 'lead.created', { id: '1' });
    
    // Attendre que le micro-task queue se vide
    await new Promise(r => setTimeout(r, 50));
    
    expect(mockEnv.DB.prepare).toHaveBeenCalledWith('SELECT id, url, events, secret FROM webhook_subscriptions WHERE client_id = ? AND is_active = 1');
    expect(mockEnv.WEBHOOK_QUEUE.send).not.toHaveBeenCalled();
  });

  it('devrait filtrer les abonnements par type d\'événement', async () => {
    mockEnv.DB.all.mockResolvedValue({
      results: [
        { id: 'sub_1', events: 'task.created', url: 'https://test1.com', secret: 'sec1' },
        { id: 'sub_2', events: '*', url: 'https://test2.com', secret: 'sec2' },
        { id: 'sub_3', events: 'lead.created,lead.updated', url: 'https://test3.com', secret: 'sec3' }
      ]
    });

    publishEvent(mockEnv as unknown as Env, 'client_1', 'lead.created', { id: 'lead_1' });

    await new Promise(r => setTimeout(r, 100));

    // sub_1 (task.created) devrait être ignoré
    // sub_2 (*) devrait recevoir
    // sub_3 (lead.created) devrait recevoir
    expect(mockEnv.WEBHOOK_QUEUE.send).toHaveBeenCalledTimes(2);
    
    // Vérifier les payloads envoyés à la queue
    const queueCalls = mockEnv.WEBHOOK_QUEUE.send.mock.calls;
    expect(queueCalls[0][0].subscriptionId).toBe('sub_2');
    expect(queueCalls[1][0].subscriptionId).toBe('sub_3');
  });

  it('devrait envoyer directement si la queue n\'est pas définie', async () => {
    mockEnv.WEBHOOK_QUEUE = undefined;
    mockEnv.DB.all.mockResolvedValue({
      results: [
        { id: 'sub_1', events: '*', url: 'https://test.com/hook', secret: 'sec1' }
      ]
    });

    // On mock global fetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    publishEvent(mockEnv as unknown as Env, 'client_1', 'test.event', { foo: 'bar' });

    await new Promise(r => setTimeout(r, 200));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://test.com/hook');
    
    fetchSpy.mockRestore();
  });

  it('devrait inclure le header X-Intralys-Timestamp', async () => {
    mockEnv.WEBHOOK_QUEUE = undefined;
    mockEnv.DB.all.mockResolvedValue({
      results: [
        { id: 'sub_1', events: '*', url: 'https://test.com/hook', secret: 'sec1' }
      ]
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    publishEvent(mockEnv as unknown as Env, 'client_1', 'test.event', { foo: 'bar' });

    await new Promise(r => setTimeout(r, 200));

    const fetchCall = fetchSpy.mock.calls[0];
    const headers = (fetchCall[1] as any).headers;
    expect(headers['X-Intralys-Timestamp']).toBeDefined();

    fetchSpy.mockRestore();
  });
});
