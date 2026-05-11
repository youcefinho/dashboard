// ── Mock Resend — simule l'envoi d'email en mode dev ──
import type { Env } from '../types';

interface MockEmailOptions {
  from?: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
}

export async function mockSendEmail(env: Env, leadId: string, clientId: string, options: MockEmailOptions): Promise<{ data: { id: string } }> {
  const mockId = 'mock-' + crypto.randomUUID();

  // Persister dans messages pour visualiser dans Inbox
  await env.DB.prepare(
    `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by, external_id)
     VALUES (?, ?, ?, 'outbound', 'email', ?, ?, 'mock-sent', 'system', ?)`
  ).bind(
    crypto.randomUUID(), leadId, clientId,
    options.subject, options.html || options.text || '',
    mockId
  ).run();

  return { data: { id: mockId } };
}
