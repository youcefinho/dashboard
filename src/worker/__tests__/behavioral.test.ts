import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTrackBehavioralEvent, handleGetLeadBehavioralEvents } from '../behavioral';
import type { Env } from '../types';

describe('Lead Scoring Comportemental v2 (Sprint 78)', () => {
  let mockEnv: Env;
  let mockPrepare: any;
  let runSpy: any;
  let bindSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    runSpy = vi.fn().mockResolvedValue({ success: true });
    bindSpy = vi.fn().mockImplementation((..._args) => {
      return {
        first: vi.fn().mockResolvedValue({ id: 'lead_123', client_id: 'client_123', score: 30 }),
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 'event_1', event_type: 'page_view', score_delta: 2, score_after: 32, created_at: '2026-05-29T10:00:00Z' },
            { id: 'event_2', event_type: 'form_submit', score_delta: 15, score_after: 47, created_at: '2026-05-29T10:05:00Z' }
          ]
        }),
        run: runSpy
      };
    });

    mockPrepare = vi.fn().mockImplementation((sql: string) => {
      return {
        bind: bindSpy,
        first: vi.fn().mockResolvedValue({ id: 'lead_123', client_id: 'client_123', score: 30 }),
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 'event_1', event_type: 'page_view', score_delta: 2, score_after: 32, created_at: '2026-05-29T10:00:00Z' }
          ]
        }),
        run: runSpy
      };
    });

    mockEnv = {
      DB: {
        prepare: mockPrepare
      }
    } as unknown as Env;
  });

  describe('handleTrackBehavioralEvent', () => {
    it('devrait retourner une erreur 405 si la méthode n\'est pas POST', async () => {
      const req = new Request('http://localhost/api/public/track', { method: 'GET' });
      const res = await handleTrackBehavioralEvent(req, mockEnv);
      expect(res.status).toBe(405);
      const body = await res.json() as any;
      expect(body.error).toBe('Méthode non autorisée');
    });

    it('devrait retourner une erreur 400 si lead_id et email sont absents', async () => {
      const req = new Request('http://localhost/api/public/track', {
        method: 'POST',
        body: JSON.stringify({ event_type: 'page_view' })
      });
      const res = await handleTrackBehavioralEvent(req, mockEnv);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('lead_id ou email requis');
    });

    it('devrait retourner une erreur 400 si event_type est absent', async () => {
      const req = new Request('http://localhost/api/public/track', {
        method: 'POST',
        body: JSON.stringify({ lead_id: 'lead_123' })
      });
      const res = await handleTrackBehavioralEvent(req, mockEnv);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe('event_type requis');
    });

    it('devrait calculer le bon score et insérer l\'événement pour un clic email (+5)', async () => {
      const req = new Request('http://localhost/api/public/track', {
        method: 'POST',
        body: JSON.stringify({ lead_id: 'lead_123', event_type: 'email_click' })
      });

      const res = await handleTrackBehavioralEvent(req, mockEnv);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.new_score).toBe(35); // 30 + 5
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO behavioral_events')
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE leads SET score')
      );
    });

    it('devrait plafonner le score à 100 maximum', async () => {
      // Configurer le lead pour qu'il ait déjà 95 points
      mockEnv.DB.prepare = vi.fn().mockImplementation((sql: string) => {
        return {
          bind: vi.fn().mockImplementation(() => ({
            first: vi.fn().mockResolvedValue({ id: 'lead_123', client_id: 'client_123', score: 95 }),
            run: runSpy
          })),
          run: runSpy
        };
      });

      const req = new Request('http://localhost/api/public/track', {
        method: 'POST',
        body: JSON.stringify({ lead_id: 'lead_123', event_type: 'form_submit' }) // form_submit vaut +15
      });

      const res = await handleTrackBehavioralEvent(req, mockEnv);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.new_score).toBe(100); // 95 + 15 = 110 => plafonné à 100
    });

    it('devrait plancher le score à 0 minimum', async () => {
      // Configurer le lead pour qu'il ait déjà 10 points
      mockEnv.DB.prepare = vi.fn().mockImplementation((sql: string) => {
        return {
          bind: vi.fn().mockImplementation(() => ({
            first: vi.fn().mockResolvedValue({ id: 'lead_123', client_id: 'client_123', score: 10 }),
            run: runSpy
          })),
          run: runSpy
        };
      });

      const req = new Request('http://localhost/api/public/track', {
        method: 'POST',
        body: JSON.stringify({ lead_id: 'lead_123', event_type: 'unsubscribe' }) // unsubscribe vaut -20
      });

      const res = await handleTrackBehavioralEvent(req, mockEnv);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.new_score).toBe(0); // 10 - 20 = -10 => plancher à 0
    });

    it('devrait accepter un score_delta personnalisé', async () => {
      const req = new Request('http://localhost/api/public/track', {
        method: 'POST',
        body: JSON.stringify({ lead_id: 'lead_123', event_type: 'custom_event', score_delta: 25 })
      });

      const res = await handleTrackBehavioralEvent(req, mockEnv);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.new_score).toBe(55); // 30 + 25
    });
  });

  describe('handleGetLeadBehavioralEvents', () => {
    it('devrait récupérer l\'historique pour un administrateur', async () => {
      const auth = { role: 'admin', clientId: 'any_client' };
      const res = await handleGetLeadBehavioralEvents(
        new Request('http://localhost/api/leads/lead_123/behavioral-events'),
        mockEnv,
        auth,
        'lead_123'
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.events).toHaveLength(2);
      expect(body.events[0].event_type).toBe('page_view');
    });

    it('devrait récupérer l\'historique pour un utilisateur du même client_id', async () => {
      const auth = { role: 'user', clientId: 'client_123' };
      const res = await handleGetLeadBehavioralEvents(
        new Request('http://localhost/api/leads/lead_123/behavioral-events'),
        mockEnv,
        auth,
        'lead_123'
      );

      expect(res.status).toBe(200);
    });

    it('devrait retourner 403 pour un utilisateur d\'un autre client_id', async () => {
      const auth = { role: 'user', clientId: 'client_different' };
      const res = await handleGetLeadBehavioralEvents(
        new Request('http://localhost/api/leads/lead_123/behavioral-events'),
        mockEnv,
        auth,
        'lead_123'
      );

      expect(res.status).toBe(403);
      const body = await res.json() as any;
      expect(body.error).toContain('Accès interdit');
    });
  });
});
