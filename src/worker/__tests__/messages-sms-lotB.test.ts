// ── messages-sms-lotB.test.ts — LOT B Manager B (§6.3) ──────
// Couvre UNIQUEMENT le correctif SMS réel non-mock de handleSendMessage :
//   - branche non-mock `channel === 'sms'` appelle réellement sendSms
//   - status='failed' si sendSms renvoie { success:false }
//   - status='sent' + external_id si sendSms renvoie { success:true, sid }
//   - branche mock USE_MOCKS='true' INCHANGÉE (non-régression)
//   - pas de crash si lead.phone absent (status='failed', sendSms non appelé)
// Mock D1 = _helpers.ts figé. Tests écrits, NON exécutés (VM VMware).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// sendSms mocké (helper réel non sollicité — pas d'appel réseau Twilio).
const sendSmsMock = vi.fn();

vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    sendSms: (...args: any[]) => sendSmsMock(...args),
    isLeadDnd: vi.fn().mockResolvedValue(false),
    createNotification: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../conversations', () => ({
  findOrCreateConversation: vi.fn().mockResolvedValue('conv-1'),
}));

vi.mock('../compliance', () => ({
  isUnsubscribed: vi.fn().mockResolvedValue(false),
  generateCaslFooter: vi.fn().mockReturnValue(''),
  generateAmfDisclaimer: vi.fn().mockReturnValue(''),
  generateUnsubscribeToken: vi.fn().mockReturnValue('tok'),
}));

// Import APRÈS les mocks (handleSendMessage capture sendSms à l'import du module).
import { handleSendMessage } from '../messages';

function makeReq(payload: Record<string, unknown>): Request {
  return new Request('http://localhost/api/leads/lead-1/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

describe('LOT B §6.3 — SMS réel non-mock dans handleSendMessage', () => {
  beforeEach(() => {
    sendSmsMock.mockReset();
  });

  it('branche non-mock : appelle sendSms(env, lead.phone, body) et status=sent si success', async () => {
    const db = createMockD1();
    db.seed('from leads where id', [{ id: 'lead-1', client_id: 'c-1', email: 'a@b.co', phone: '+15145551234' }]);
    db.seed('amf_certificate', [{ amf_certificate: null, amf_disclaimer_required: 0 }]);
    const env = { DB: db, USE_MOCKS: 'false' } as unknown as Env;

    sendSmsMock.mockResolvedValueOnce({ success: true, sid: 'SM_real_123' });

    const res = await handleSendMessage(
      makeReq({ channel: 'sms', body: 'Bonjour test SMS' }),
      env,
      { userId: 'u1', role: 'admin' },
      'lead-1'
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.success).toBe(true);
    expect(json.data.status).toBe('sent');

    // sendSms réellement invoqué avec le numéro réel + le corps réel.
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).toHaveBeenCalledWith(env, '+15145551234', 'Bonjour test SMS');

    // external_id propagé dans l'INSERT messages.
    const insert = db.calls.find(c => /insert into messages/i.test(c.sql));
    expect(insert).toBeDefined();
    expect(insert!.args).toContain('SM_real_123');
    expect(insert!.args).toContain('sent');
  });

  it('branche non-mock : status=failed si sendSms renvoie success:false', async () => {
    const db = createMockD1();
    db.seed('from leads where id', [{ id: 'lead-1', client_id: 'c-1', email: 'a@b.co', phone: '+15145559999' }]);
    db.seed('amf_certificate', [{ amf_certificate: null, amf_disclaimer_required: 0 }]);
    const env = { DB: db, USE_MOCKS: 'false' } as unknown as Env;

    sendSmsMock.mockResolvedValueOnce({ success: false, error: 'Twilio non configuré' });

    const res = await handleSendMessage(
      makeReq({ channel: 'sms', body: 'Echec attendu' }),
      env,
      { userId: 'u1', role: 'admin' },
      'lead-1'
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe('failed');
    expect(sendSmsMock).toHaveBeenCalledTimes(1);

    const insert = db.calls.find(c => /insert into messages/i.test(c.sql));
    expect(insert!.args).toContain('failed');
  });

  it('branche mock USE_MOCKS=true : INCHANGÉE — sendSms réel JAMAIS appelé, status=mock-sent', async () => {
    const db = createMockD1();
    db.seed('from leads where id', [{ id: 'lead-1', client_id: 'c-1', email: 'a@b.co', phone: '+15145550000' }]);
    db.seed('amf_certificate', [{ amf_certificate: null, amf_disclaimer_required: 0 }]);
    const env = { DB: db, USE_MOCKS: 'true' } as unknown as Env;

    const res = await handleSendMessage(
      makeReq({ channel: 'sms', body: 'Mock path' }),
      env,
      { userId: 'u1', role: 'admin' },
      'lead-1'
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe('mock-sent');
    // Non-régression : le helper sendSms réel ne doit jamais être sollicité en mock.
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('lead.phone absent : pas de crash, status=failed, sendSms NON appelé', async () => {
    const db = createMockD1();
    db.seed('from leads where id', [{ id: 'lead-1', client_id: 'c-1', email: 'a@b.co', phone: null }]);
    db.seed('amf_certificate', [{ amf_certificate: null, amf_disclaimer_required: 0 }]);
    const env = { DB: db, USE_MOCKS: 'false' } as unknown as Env;

    const res = await handleSendMessage(
      makeReq({ channel: 'sms', body: 'Sans numero' }),
      env,
      { userId: 'u1', role: 'admin' },
      'lead-1'
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe('failed');
    expect(sendSmsMock).not.toHaveBeenCalled();

    const insert = db.calls.find(c => /insert into messages/i.test(c.sql));
    expect(insert!.args).toContain('failed');
  });
});
