import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import { handleWhatsAppWebhook } from '../whatsapp';

const VERIFY_TOKEN = 'meta_whatsapp_verify_token_123';

function makeEnv(): Env {
  const db = createMockD1();
  return {
    DB: db as unknown as D1Database,
    WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
    WHATSAPP_ACCESS_TOKEN: 'access_token_123',
    WHATSAPP_PHONE_NUMBER_ID: 'phone_id_123',
  } as unknown as Env;
}

describe('WhatsApp Meta Integration - Tests Unitaires (Sprint 56)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('blocked', { status: 599 })));
  });

  describe('Webhook GET - Meta Handshake Verification', () => {
    it('doit valider le token et renvoyer le challenge avec un status 200', async () => {
      const env = makeEnv();
      const url = `https://localhost/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test_challenge`;
      const req = new Request(url, { method: 'GET' });
      const res = await handleWhatsAppWebhook(req, env);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('test_challenge');
    });

    it('doit rejeter avec un statut 403 si le verify_token est incorrect', async () => {
      const env = makeEnv();
      const url = `https://localhost/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=test_challenge`;
      const req = new Request(url, { method: 'GET' });
      const res = await handleWhatsAppWebhook(req, env);

      expect(res.status).toBe(403);
    });
  });

  describe('Webhook POST - Message Inbound', () => {
    it('doit parser le message entrant, resoudre le lead existant et inserer le message WhatsApp', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      // Seed 1 : La connexion WhatsApp pour le phone_number_id
      db.seed("SELECT client_id FROM whatsapp_connections", [
        { client_id: 'client_whatsapp_56' }
      ]);

      // Seed 2 : Le lead associé au numéro de téléphone expéditeur
      db.seed("SELECT id, name, preferred_language FROM leads", [
        { id: 'lead_56', name: 'Rochdi', preferred_language: 'fr' }
      ]);

      // Seed 3 : La conversation existante
      db.seed("SELECT id FROM conversations", [
        { id: 'conv_56' }
      ]);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba_123',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15555550100',
                    phone_number_id: 'phone_id_123'
                  },
                  contacts: [
                    {
                      profile: { name: 'Rochdi' },
                      wa_id: '15145551234'
                    }
                  ],
                  messages: [
                    {
                      from: '15145551234',
                      id: 'wamid.HBgLMTUxNDU1NTEyMzQSGDFG',
                      timestamp: '1646282828',
                      text: { body: 'Allo Antigravity!' },
                      type: 'text'
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      const req = new Request('https://localhost/api/webhook/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const res = await handleWhatsAppWebhook(req, env);
      expect(res.status).toBe(200);

      // Vérifier que le message a été inséré dans la table messages
      const insertMsg = db.calls.find((c) => /insert into messages/i.test(c.sql));
      expect(insertMsg).toBeDefined();
      expect(insertMsg!.args).toContain('Allo Antigravity!');
      expect(insertMsg!.args).toContain('wamid.HBgLMTUxNDU1NTEyMzQSGDFG');
      expect(insertMsg!.sql).toContain('\'whatsapp\'');

      // Vérifier que la conversation a été mise à jour
      const updateConv = db.calls.find((c) => /update conversations/i.test(c.sql));
      expect(updateConv).toBeDefined();
      expect(updateConv!.args).toContain('conv_56');
    });

    it('doit creer dynamiquement le lead s il n existe pas pour le tenant', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      db.seed("SELECT client_id FROM whatsapp_connections", [
        { client_id: 'client_whatsapp_56' }
      ]);
      // Aucun lead retourné par le SELECT sur leads
      db.seed("SELECT id, name, preferred_language FROM leads", []);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba_123',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    phone_number_id: 'phone_id_123'
                  },
                  contacts: [
                    {
                      profile: { name: 'Nouvel Acheteur' },
                      wa_id: '15145558888'
                    }
                  ],
                  messages: [
                    {
                      from: '15145558888',
                      id: 'wamid.new_lead_id',
                      text: { body: 'Je cherche un condo' },
                      type: 'text'
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      const req = new Request('https://localhost/api/webhook/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const res = await handleWhatsAppWebhook(req, env);
      expect(res.status).toBe(200);

      // Doit insérer le nouveau lead dans la DB
      const insertLead = db.calls.find((c) => /insert into leads/i.test(c.sql));
      expect(insertLead).toBeDefined();
      expect(insertLead!.args).toContain('Nouvel Acheteur');
      expect(insertLead!.args).toContain('+15145558888');
    });
  });

  describe('Webhook POST - Statuses delivery receipts', () => {
    it('doit mettre a jour le delivery_status du message correspondant', async () => {
      const env = makeEnv();
      const db = env.DB as unknown as ReturnType<typeof createMockD1>;

      db.seed("SELECT client_id FROM whatsapp_connections", [
        { client_id: 'client_whatsapp_56' }
      ]);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba_123',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    phone_number_id: 'phone_id_123'
                  },
                  statuses: [
                    {
                      id: 'wamid.HBgLMTUxNDU1NTEyMzQSGDFG',
                      status: 'delivered',
                      timestamp: '1646282900',
                      recipient_id: '15145551234'
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      const req = new Request('https://localhost/api/webhook/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const res = await handleWhatsAppWebhook(req, env);
      expect(res.status).toBe(200);

      // Doit mettre à jour le delivery_status dans la table messages
      const updateMsg = db.calls.find((c) => /update messages set delivery_status/i.test(c.sql));
      expect(updateMsg).toBeDefined();
      expect(updateMsg!.args).toContain('delivered');
      expect(updateMsg!.args).toContain('wamid.HBgLMTUxNDU1NTEyMzQSGDFG');
    });
  });
});
