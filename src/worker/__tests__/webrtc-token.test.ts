import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Env } from '../types';
import { handleGetTwilioWebrtcToken } from '../webrtc-token';

function makeEnv(withCredentials = false): Env {
  return {
    DB: {} as D1Database,
    TWILIO_ACCOUNT_SID: withCredentials ? 'AC_test_account' : undefined,
    TWILIO_API_KEY: withCredentials ? 'SK_test_api_key' : undefined,
    TWILIO_API_SECRET: withCredentials ? 'api_secret_key_12345678901234567890123456789012' : undefined,
    TWILIO_TWIML_APP_SID: withCredentials ? 'AP_twiml_app' : undefined,
  } as unknown as Env;
}

describe('Softphone SIP WebRTC Token - Tests Unitaires (Sprint 58)', () => {
  const auth = { userId: 'user_agent_789', role: 'user', clientId: 'client_intralys_58' };

  it('doit generer un jeton simule (mode mock) si les credentials Twilio sont absents', async () => {
    const env = makeEnv(false);
    const res = await handleGetTwilioWebrtcToken(env, auth);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.mock).toBe(true);
    expect(body.data.identity).toBe('user_agent_789');
    expect(body.data.token).toContain('mock_webrtc_token_for_user_agent_789_');
  });

  it('doit generer un jeton JWT d acces Twilio Voice valide si les credentials sont presents', async () => {
    const env = makeEnv(true);
    const res = await handleGetTwilioWebrtcToken(env, auth);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.mock).toBeUndefined();
    expect(body.data.identity).toBe('user_agent_789');

    const token = body.data.token;
    expect(token).toBeDefined();

    // Un JWT doit contenir 3 parties séparées par des points
    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    // Décoder le payload
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payloadDecoded = JSON.parse(atob(payloadBase64));

    expect(payloadDecoded.iss).toBe('SK_test_api_key');
    expect(payloadDecoded.sub).toBe('AC_test_account');
    expect(payloadDecoded.grants.identity).toBe('user_agent_789');
    expect(payloadDecoded.grants.voice.incoming.allow).toBe(true);
    expect(payloadDecoded.grants.voice.outgoing.application_sid).toBe('AP_twiml_app');
  });
});
