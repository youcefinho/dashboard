import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetWeeklyInsight, handleGenerateWeeklyInsight } from '../ai';
import type { Env } from '../types';

describe('Rapports Narratifs Hebdomadaires IA (Weekly Insights)', () => {
  let mockEnv: Env;
  let mockPrepare: any;
  let insertedData: any[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    insertedData = [];

    mockPrepare = vi.fn().mockImplementation((sql: string) => {
      let result: any = null;
      if (sql.includes('SELECT * FROM weekly_ai_insights')) {
        result = {
          id: 'insight-123',
          client_id: 'client-456',
          content: 'Contenu du rapport de test',
          metric_changes_json: JSON.stringify({
            leads_this_week: 10,
            leads_prev_week: 5,
            leads_delta_pct: 100,
            deals_won_this_week: 2,
            deals_won_prev_week: 1,
            deals_won_delta: 1,
            pipeline_value: 150000,
            messages_count: 35
          }),
          created_at: new Date().toISOString()
        };
      } else if (sql.includes("leads WHERE client_id = ? AND created_at >= datetime('now', '-7 days')")) {
        result = { count: 10 };
      } else if (sql.includes("leads WHERE client_id = ? AND created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')")) {
        result = { count: 5 };
      } else if (sql.includes("status = 'won' AND updated_at >= datetime('now', '-7 days')")) {
        result = { count: 2 };
      } else if (sql.includes("status = 'won' AND updated_at >= datetime('now', '-14 days') AND updated_at < datetime('now', '-7 days')")) {
        result = { count: 1 };
      } else if (sql.includes("SUM(deal_value)")) {
        result = { val: 150000 };
      } else if (sql.includes("messages m")) {
        result = { count: 35 };
      } else if (sql.includes('FROM clients')) {
        result = {
          brand_voice: 'Professionnel et chaleureux québécois.'
        };
      }

      const bindMock = vi.fn().mockImplementation((...bindArgs) => {
        return {
          first: vi.fn().mockResolvedValue(result),
          all: vi.fn().mockResolvedValue({ results: [result] }),
          run: vi.fn().mockImplementation(() => {
            insertedData.push(bindArgs);
            return Promise.resolve({ success: true });
          })
        };
      });

      return {
        bind: bindMock
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

  describe('GET /api/ai/weekly-insight', () => {
    it('devrait retourner le dernier insight s\'il existe', async () => {
      const req = new Request('http://localhost/api/ai/weekly-insight');
      const res = await handleGetWeeklyInsight(req, mockEnv, { userId: 'user-1', role: 'admin', clientId: 'client-456' });
      
      expect(res.status).toBe(200);
      const body = await res.json() as { data: any };
      expect(body.data).toBeDefined();
      expect(body.data.id).toBe('insight-123');
      expect(body.data.content).toBe('Contenu du rapport de test');
    });

    it('devrait retourner null si aucun insight n\'existe', async () => {
      // Mocker pour retourner null
      mockEnv.DB.prepare = vi.fn().mockImplementation(() => ({
        bind: vi.fn().mockImplementation(() => ({
          first: vi.fn().mockResolvedValue(null)
        }))
      }));

      const req = new Request('http://localhost/api/ai/weekly-insight');
      const res = await handleGetWeeklyInsight(req, mockEnv, { userId: 'user-1', role: 'admin', clientId: 'client-456' });
      
      expect(res.status).toBe(200);
      const body = await res.json() as { data: any };
      expect(body.data).toBeNull();
    });
  });

  describe('POST /api/ai/weekly-insight/generate', () => {
    it('devrait generer un insight local fallback en mode mock', async () => {
      const req = new Request('http://localhost/api/ai/weekly-insight/generate', { method: 'POST' });
      const res = await handleGenerateWeeklyInsight(req, mockEnv, { userId: 'user-1', role: 'admin', clientId: 'client-456' });
      
      expect(res.status).toBe(200);
      const body = await res.json() as { data: any };
      expect(body.data).toBeDefined();
      expect(body.data.content).toContain('🌟 Points forts de la semaine');
      expect(body.data.content).toContain('10 nouveaux leads');
      expect(body.data.content).toContain('35 messages');
      
      // Valider l'insertion en DB
      expect(insertedData).toHaveLength(1);
      const insertArgs = insertedData[0];
      // bind args: insightId, clientId, content, JSON.stringify(metrics)
      expect(insertArgs[1]).toBe('client-456');
      expect(insertArgs[2]).toContain('🌟 Points forts de la semaine');
      const parsedMetrics = JSON.parse(insertArgs[3]);
      expect(parsedMetrics.leads_this_week).toBe(10);
      expect(parsedMetrics.leads_delta_pct).toBe(100);
    });

    it('devrait appeler l\'API Anthropic si le mode mock est desactive', async () => {
      mockEnv.USE_MOCKS = 'false';
      mockEnv.ANTHROPIC_API_KEY = 'real-key-mocked';

      const mockResponseJson = {
        content: [
          {
            type: 'text',
            text: '### 🌟 Points forts de la semaine\n- Hausse spectaculaire de 100%\n\n### ⚠️ Opportunités d\'amélioration\n- Suivi plus serré\n\n### 🎯 Plan d\'action recommandé\n1. Relancer\n2. Optimiser\n3. Qualifier'
          }
        ]
      };

      const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponseJson,
        text: async () => JSON.stringify(mockResponseJson)
      } as Response);

      const req = new Request('http://localhost/api/ai/weekly-insight/generate', { method: 'POST' });
      const res = await handleGenerateWeeklyInsight(req, mockEnv, { userId: 'user-1', role: 'admin', clientId: 'client-456' });
      
      expect(res.status).toBe(200);
      const body = await res.json() as { data: any };
      expect(body.data.content).toContain('Hausse spectaculaire');
      expect(globalFetchSpy).toHaveBeenCalled();
    });
  });
});
