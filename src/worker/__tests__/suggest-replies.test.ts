import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAiSuggestReplies } from '../ai';
import type { Env } from '../types';

describe('Suggestions de Réponses IA (Copilote)', () => {
  let mockEnv: Env;
  let mockPrepare: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockPrepare = vi.fn().mockImplementation((sql: string) => {
      let result: any = null;
      if (sql.includes('FROM conversations')) {
        result = {
          lead_id: 'lead-123',
          lead_name: 'Jean Tremblay',
          lead_email: 'jean@gmail.com',
          lead_status: 'new',
          lead_source: 'website',
          lead_message: 'Bonjour, je voudrais réserver un rdv.',
          lead_notes: 'Notes de test',
          client_id: 'client-456'
        };
      } else if (sql.includes('FROM messages')) {
        result = [
          {
            direction: 'inbound',
            channel: 'sms',
            body: 'Bonjour, je voudrais réserver un rdv.',
            created_at: new Date().toISOString(),
            sender_name: 'Jean Tremblay',
            sentiment: 'Enthousiaste',
            detected_intent: 'Prendre RDV'
          }
        ];
      } else if (sql.includes('FROM clients')) {
        result = {
          brand_voice: 'Professionnel, rassurant et québécois naturel.'
        };
      }

      return {
        bind: vi.fn().mockImplementation((..._bindArgs) => {
          return {
            first: vi.fn().mockResolvedValue(Array.isArray(result) ? result[0] : result),
            all: vi.fn().mockResolvedValue({ results: Array.isArray(result) ? result : [result] })
          };
        })
      };
    });

    mockEnv = {
      DB: {
        prepare: mockPrepare
      },
      USE_MOCKS: 'true',
      ANTHROPIC_API_KEY: 'test-key'
    } as unknown as Env;
  });

  it('devrait retourner une erreur 400 si conversation_id est manquant', async () => {
    const req = new Request('http://localhost/api/ai/suggest-replies', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const res = await handleAiSuggestReplies(req, mockEnv);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('conversation_id requis');
  });

  it('devrait retourner une erreur 404 si la conversation est introuvable', async () => {
    // Mocker prepare pour retourner null pour la conversation
    mockEnv.DB.prepare = vi.fn().mockImplementation((sql: string) => {
      return {
        bind: vi.fn().mockImplementation(() => ({
          first: vi.fn().mockResolvedValue(null)
        }))
      };
    });

    const req = new Request('http://localhost/api/ai/suggest-replies', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: 'missing-id' })
    });

    const res = await handleAiSuggestReplies(req, mockEnv);
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Conversation introuvable');
  });

  it('devrait retourner les suggestions de fallback local en mode mock', async () => {
    const req = new Request('http://localhost/api/ai/suggest-replies', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: 'conv-123' })
    });

    const res = await handleAiSuggestReplies(req, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { suggestions: string[] } };
    expect(body.data.suggestions).toHaveLength(3);
    // Jean Tremblay est dans le nom, l'intention est Prendre RDV
    expect(body.data.suggestions[0]).toContain('Jean Tremblay');
    expect(body.data.suggestions[0]).toContain('Calendly');
  });

  it('devrait interroger Anthropic (mock global fetch) si le mode mock est désactivé', async () => {
    mockEnv.USE_MOCKS = 'false';
    mockEnv.ANTHROPIC_API_KEY = 'real-key-mocked';

    // Mocker le fetch global pour intercepter l'appel Anthropic
    const mockResponseJson = {
      content: [
        {
          type: 'text',
          text: '[\n  "Option 1 : RDV",\n  "Option 2 : Prix",\n  "Option 3 : Relance"\n]'
        }
      ]
    };

    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponseJson,
      text: async () => JSON.stringify(mockResponseJson)
    } as Response);

    const req = new Request('http://localhost/api/ai/suggest-replies', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: 'conv-123' })
    });

    const res = await handleAiSuggestReplies(req, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { suggestions: string[] } };
    expect(body.data.suggestions).toEqual([
      'Option 1 : RDV',
      'Option 2 : Prix',
      'Option 3 : Relance'
    ]);
    expect(globalFetchSpy).toHaveBeenCalled();
  });
});
