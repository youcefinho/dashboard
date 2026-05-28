import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleGetPhoneNumbers,
  handleSearchPhoneNumbers,
  handlePurchasePhoneNumber,
  handleReleasePhoneNumber,
  handleGetRoutingRules,
  handleSaveRoutingRules
} from '../phone-numbers';
import type { Env } from '../types';

describe('Phone Routing & Numbers Handler - Tests Unitaires (Sprint 51)', () => {
  let mockDb: any;
  let mockEnv: any;
  const mockAuth = { role: 'user', clientId: 'client_123', userId: 'user_456' };

  beforeEach(() => {
    mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    };
    mockEnv = {
      DB: mockDb,
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
    };
  });

  describe('handleGetPhoneNumbers', () => {
    it('doit retourner une erreur si clientId est absent', async () => {
      const response = await handleGetPhoneNumbers(new Request('http://localhost'), mockEnv, { role: 'user', userId: 'user_456' });
      expect(response.status).toBe(400);
      const body = await response.json() as any;
      expect(body.error).toBe('Client ID requis');
    });

    it('doit retourner les numéros de téléphone actifs du client', async () => {
      const mockNumbers = [
        { id: '1', phone_number: '+14505550100', friendly_name: '(450) 555-0100', status: 'active' },
        { id: '2', phone_number: '+15145550200', friendly_name: '(514) 555-0200', status: 'active' }
      ];
      mockDb.all.mockResolvedValueOnce({ results: mockNumbers });

      const response = await handleGetPhoneNumbers(new Request('http://localhost'), mockEnv, mockAuth);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.data).toEqual(mockNumbers);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM phone_numbers WHERE client_id = ? AND status = "active"')
      );
    });
  });

  describe('handleSearchPhoneNumbers', () => {
    it('doit retourner des numéros simulés en local (mode Mock/Bypass)', async () => {
      const response = await handleSearchPhoneNumbers(
        new Request('http://localhost/api/phone-numbers/search?areaCode=819'),
        mockEnv,
        mockAuth
      );
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.data).toHaveLength(5);
      expect(body.data[0].phone_number).toContain('+18195550');
      expect(body.data[0].region).toBe('QC');
    });

    it('doit appeler l API Twilio réelle si les clés sont configurées', async () => {
      mockEnv.TWILIO_ACCOUNT_SID = 'AC123';
      mockEnv.TWILIO_AUTH_TOKEN = 'token123';

      const twilioResponse = {
        available_phone_numbers: [
          { phone_number: '+18195551212', friendly_name: '(819) 555-1212', rate_center: 'Gatineau', region: 'QC' }
        ]
      };

      const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => twilioResponse,
      } as Response);

      const response = await handleSearchPhoneNumbers(
        new Request('http://localhost/api/phone-numbers/search?areaCode=819'),
        mockEnv,
        mockAuth
      );

      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.data).toHaveLength(1);
      expect(body.data[0].phone_number).toBe('+18195551212');
      expect(globalFetch).toHaveBeenCalled();
      
      globalFetch.mockRestore();
    });
  });

  describe('handlePurchasePhoneNumber', () => {
    it('doit provisionner un numéro simulé (mode mock) et ajouter la règle par défaut', async () => {
      mockDb.run.mockResolvedValue({ success: true });

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          phone_number: '+14505550111',
          friendly_name: '(450) 555-0111'
        })
      });

      const response = await handlePurchasePhoneNumber(req, mockEnv, mockAuth);
      expect(response.status).toBe(201);
      const body = await response.json() as any;
      expect(body.data.phone_number).toBe('+14505550111');
      expect(body.data.status).toBe('active');

      // Vérifie l'insertion du numéro puis l'insertion de la règle de routage par défaut
      expect(mockDb.prepare).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO phone_numbers'));
      expect(mockDb.prepare).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO phone_routing_rules'));
    });
  });

  describe('handleReleasePhoneNumber', () => {
    it('doit libérer le numéro et supprimer ses données de la DB', async () => {
      mockDb.first.mockResolvedValueOnce({
        id: 'num_123',
        phone_number: '+14505550111',
        twilio_sid: 'PN_mock_123'
      });
      mockDb.run.mockResolvedValue({ success: true });

      const response = await handleReleasePhoneNumber(new Request('http://localhost'), mockEnv, mockAuth, 'num_123');
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.data.success).toBe(true);

      expect(mockDb.prepare).toHaveBeenNthCalledWith(1, expect.stringContaining('SELECT id, phone_number, twilio_sid FROM phone_numbers'));
      expect(mockDb.prepare).toHaveBeenNthCalledWith(2, expect.stringContaining('DELETE FROM phone_numbers WHERE id = ?'));
    });
  });

  describe('handleGetRoutingRules & handleSaveRoutingRules', () => {
    it('doit récupérer les règles associées à un numéro de téléphone', async () => {
      mockDb.first.mockResolvedValueOnce({ id: 'num_123' });
      const mockRules = [
        { id: 'rule_1', priority: 1, condition_type: 'area_code', condition_value: '450', target_type: 'ivr', target_id: 'ivr_999' }
      ];
      mockDb.all.mockResolvedValueOnce({ results: mockRules });

      const response = await handleGetRoutingRules(new Request('http://localhost'), mockEnv, mockAuth, 'num_123');
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.data).toEqual(mockRules);
    });

    it('doit écraser et enregistrer de nouvelles règles après filtrage et validation', async () => {
      mockDb.first.mockResolvedValueOnce({ id: 'num_123', phone_number: '+14505550111' });
      mockDb.run.mockResolvedValue({ success: true });

      const rulesToSave = [
        { priority: 1, condition_type: 'area_code', condition_value: '514', target_type: 'user', target_id: 'user_999' },
        { priority: 2, condition_type: 'all', condition_value: '', target_type: 'forward', target_id: '+15145550099' }
      ];

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ rules: rulesToSave })
      });

      const response = await handleSaveRoutingRules(req, mockEnv, mockAuth, 'num_123');
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.data.success).toBe(true);

      // Suppression des anciennes règles
      expect(mockDb.prepare).toHaveBeenNthCalledWith(2, expect.stringContaining('DELETE FROM phone_routing_rules WHERE phone_number_id = ?'));
      // Insertion des deux nouvelles règles validées
      expect(mockDb.prepare).toHaveBeenNthCalledWith(3, expect.stringContaining('INSERT INTO phone_routing_rules'));
      expect(mockDb.prepare).toHaveBeenNthCalledWith(4, expect.stringContaining('INSERT INTO phone_routing_rules'));
    });
  });
});
