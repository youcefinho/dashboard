// ── Mock Twilio — simule l'envoi de SMS en mode dev ──
import type { Env } from '../types';

interface MockSmsOptions {
  to: string;
  body: string;
}

export async function mockSendSms(env: Env, leadId: string, clientId: string, options: MockSmsOptions): Promise<{ sid: string }> {
  const mockSid = 'mock-' + crypto.randomUUID();

  // Persister dans messages pour visualiser dans Inbox
  await env.DB.prepare(
    `INSERT INTO messages (id, lead_id, client_id, direction, channel, body, status, sent_by, external_id)
     VALUES (?, ?, ?, 'outbound', 'sms', ?, 'mock-sent', 'system', ?)`
  ).bind(
    crypto.randomUUID(), leadId, clientId,
    options.body, mockSid
  ).run();

  return { sid: mockSid };
}
