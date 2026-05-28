import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// Mock ./lib/twilio-voice pour neutraliser les appels réseau réels
vi.mock('../lib/twilio-voice', () => {
  return {
    buildRecordingR2Key: (clientId: string, callLogId: string, recordingSid: string) =>
      `voice/${clientId}/${callLogId}/${recordingSid}.mp3`,
    downloadRecordingToR2: vi.fn(async (env, url, key) => ({
      success: true,
      data: { r2Key: key, sizeBytes: 1024 }
    })),
    transcribeRecording: vi.fn(async () => ({
      success: true,
      data: { text: 'mock text', lang: 'fr' }
    })),
  };
});

import {
  handleTwilioVoiceTwiml,
  handleTwilioRecordingStatusCallback,
} from '../twilio-twiml';

const AUTH_TOKEN = 'test_auth_token_compliance';

async function makeTwilioSig(
  url: string,
  params: Record<string, string>,
  token: string,
): Promise<string> {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => k + params[k])
    .join('');
  const data = url + sorted;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(token),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function makeTwilioRequest(
  url: string,
  params: Record<string, string>,
  signature?: string,
): Request {
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (signature) headers['X-Twilio-Signature'] = signature;
  return new Request(url, { method: 'POST', headers, body });
}

function makeR2Stub() {
  return {
    put: vi.fn(async () => ({})),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  } as unknown as R2Bucket;
}

function makeEnv(token?: string): Env {
  const db = createMockD1();
  return {
    DB: db as unknown as D1Database,
    FILES: makeR2Stub(),
    TWILIO_ACCOUNT_SID: 'AC_compliance',
    TWILIO_AUTH_TOKEN: token as unknown as string,
    TWILIO_PHONE_NUMBER: '+15555550100',
  } as unknown as Env;
}

describe('Compliance Recording & Consentement Loi 25 - Tests Unitaires (Sprint 55)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('blocked', { status: 599 })),
    );
  });

  describe('handleTwilioVoiceTwiml - Consentement et Enregistrement', () => {
    it('doit générer le message de consentement Loi 25 (Polly.Chantal) et Dial record si record_call=1 et play_consent_msg=1', async () => {
      const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voice';
      const params = { From: '+15145551234', To: '+15555550100', CallSid: 'CA_test_55_1' };
      const sig = await makeTwilioSig(url, params, AUTH_TOKEN);
      const env = makeEnv(AUTH_TOKEN);

      const db = env.DB as unknown as ReturnType<typeof createMockD1>;
      // Seed de la règle de routage
      db.seed('from phone_routing_rules', [
        {
          target_type: 'forward',
          target_id: '+15145559999',
          record_call: 1,
          play_consent_msg: 1,
          client_id: 'cli_55'
        }
      ]);

      const req = makeTwilioRequest(url, params, sig);
      const res = await handleTwilioVoiceTwiml(req, env);

      expect(res.status).toBe(200);
      const body = await res.text();

      // Doit contenir le message de consentement Loi 25
      expect(body).toContain('Polly.Chantal');
      expect(body).toContain('Cet appel peut être enregistré pour des fins de contrôle de la qualité');
      // Doit contenir l'attribut record dans le Dial
      expect(body).toContain('record="record-from-answer-dual"');
      // Doit appeler le numéro ciblé
      expect(body).toContain('+15145559999');
    });

    it('doit activer Dial record mais sans le message de consentement si record_call=1 et play_consent_msg=0', async () => {
      const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voice';
      const params = { From: '+15145551234', To: '+15555550100', CallSid: 'CA_test_55_2' };
      const sig = await makeTwilioSig(url, params, AUTH_TOKEN);
      const env = makeEnv(AUTH_TOKEN);

      const db = env.DB as unknown as ReturnType<typeof createMockD1>;
      db.seed('from phone_routing_rules', [
        {
          target_type: 'forward',
          target_id: '+15145559999',
          record_call: 1,
          play_consent_msg: 0,
          client_id: 'cli_55'
        }
      ]);

      const req = makeTwilioRequest(url, params, sig);
      const res = await handleTwilioVoiceTwiml(req, env);

      expect(res.status).toBe(200);
      const body = await res.text();

      // Ne doit PAS avoir le message Loi 25 de Polly.Chantal
      expect(body).not.toContain('Polly.Chantal');
      expect(body).not.toContain('Cet appel peut être enregistré');
      // Doit contenir le message de bienvenue normal
      expect(body).toContain('Bonjour, votre appel est important. Veuillez patienter.');
      // Doit activer l'enregistrement
      expect(body).toContain('record="record-from-answer-dual"');
    });

    it('ne doit pas enregistrer ni avertir si record_call=0', async () => {
      const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voice';
      const params = { From: '+15145551234', To: '+15555550100', CallSid: 'CA_test_55_3' };
      const sig = await makeTwilioSig(url, params, AUTH_TOKEN);
      const env = makeEnv(AUTH_TOKEN);

      const db = env.DB as unknown as ReturnType<typeof createMockD1>;
      db.seed('from phone_routing_rules', [
        {
          target_type: 'forward',
          target_id: '+15145559999',
          record_call: 0,
          play_consent_msg: 1,
          client_id: 'cli_55'
        }
      ]);

      const req = makeTwilioRequest(url, params, sig);
      const res = await handleTwilioVoiceTwiml(req, env);

      expect(res.status).toBe(200);
      const body = await res.text();

      // Pas de message de consentement
      expect(body).not.toContain('Polly.Chantal');
      // Bienvenue normale
      expect(body).toContain('Bonjour, votre appel est important. Veuillez patienter.');
      // Pas de record attribute
      expect(body).not.toContain('record="record-from-answer-dual"');
    });
  });

  describe('handleTwilioRecordingStatusCallback - Consentement et Archivage R2', () => {
    it('doit mettre à jour call_logs avec la clé R2, la durée et enregistrer le consentement Loi 25', async () => {
      const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/recording-status';
      const params = {
        RecordingSid: 'RE_compliance_123',
        RecordingUrl: 'https://api.twilio.com/RE_compliance_123',
        RecordingStatus: 'completed',
        RecordingDuration: '75',
        CallSid: 'CA_compliance_call',
        From: '+15145551234',
        To: '+15555550100',
      };
      const sig = await makeTwilioSig(url, params, AUTH_TOKEN);
      const env = makeEnv(AUTH_TOKEN);

      const db = env.DB as unknown as ReturnType<typeof createMockD1>;
      // Mock de la récupération du journal d'appel
      db.seed('from call_logs where twilio_sid', [
        { id: 'cl_compliance_99', client_id: 'cli_55' }
      ]);

      const req = makeTwilioRequest(url, params, sig);
      const res = await handleTwilioRecordingStatusCallback(req, env);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('OK');

      // Vérifier la mise à jour de call_logs
      const updateCallLogs = db.calls.find((c) => /update call_logs/i.test(c.sql));
      expect(updateCallLogs).toBeDefined();
      // Arguments : recordingSid, recordingUrl, r2Key, durationSec, callLogId
      expect(updateCallLogs!.args).toContain('RE_compliance_123');
      expect(updateCallLogs!.args).toContain('https://api.twilio.com/RE_compliance_123');
      expect(updateCallLogs!.args).toContain('voice/cli_55/cl_compliance_99/RE_compliance_123.mp3');
      expect(updateCallLogs!.args).toContain(75);
      expect(updateCallLogs!.args).toContain('cl_compliance_99');

      // Vérifier l'insertion de l'audit/métadonnées d'enregistrement (contenant la durée, taille, etc.)
      const insertMetadata = db.calls.find((c) => /insert into call_recordings_metadata/i.test(c.sql));
      expect(insertMetadata).toBeDefined();
      expect(insertMetadata!.args).toContain('cl_compliance_99');
      expect(insertMetadata!.args).toContain('cli_55');
      expect(insertMetadata!.args).toContain('RE_compliance_123');
      expect(insertMetadata!.args).toContain('voice/cli_55/cl_compliance_99/RE_compliance_123.mp3');
      expect(insertMetadata!.args).toContain(75);
      expect(insertMetadata!.args).toContain(1024); // mock taille de R2
    });
  });
});
