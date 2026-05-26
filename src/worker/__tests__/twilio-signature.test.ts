// ── twilio-signature.test.ts — Sprint 34 Agent C1 (Phase C) ────────────────
//
// Couvre :
//   (a) verifyTwilioSignature (twilio-verify.ts) — 6 cas :
//       1) signature valide   → true (et handler 200)
//       2) signature invalide → false (et handler 403)
//       3) sans TWILIO_AUTH_TOKEN → bypass true (handler 200)
//       4) header X-Twilio-Signature absent + token présent → false (403)
//       5) params désordonnés → verify normalise (ordre-indépendant)
//       6) URL incluant une query string → canonical = url+sorted(params)
//
//   (b) handlers Phase B (twilio-twiml.ts) :
//       handleTwilioVoiceTwiml, handleTwilioVoicemailTwiml,
//       handleTwilioRecordingStatusCallback, handleTwilioTranscriptionCallback
//
// Imports RELATIFS uniquement (./_helpers, ../twilio-verify, ../twilio-twiml).
// Aucun appel réseau — global fetch mocké défensivement. Mock ./lib/twilio-voice
// pour neutraliser les dépendances réseau Twilio + uniformiser les noms attendus
// par twilio-twiml.ts (fetchRecording, buildR2RecordingKey).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// ── Mock ./lib/twilio-voice ─────────────────────────────────────────────────
// twilio-twiml.ts importe { fetchRecording, buildR2RecordingKey } — on les
// fournit ici (et on conserve les autres exports réels via importOriginal pour
// que d'autres dépendances éventuelles ne soient pas cassées).
vi.mock('../lib/twilio-voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/twilio-voice')>();
  return {
    ...actual,
    buildR2RecordingKey: (clientId: string, callLogId: string, recordingSid: string) =>
      `voice/${clientId}/${callLogId}/${recordingSid}.mp3`,
    fetchRecording: vi.fn(async () => ({ success: false, mock: true })),
  };
});

import { verifyTwilioSignature } from '../twilio-verify';
import {
  handleTwilioVoiceTwiml,
  handleTwilioVoicemailTwiml,
  handleTwilioRecordingStatusCallback,
  handleTwilioTranscriptionCallback,
} from '../twilio-twiml';

// ── Helpers ────────────────────────────────────────────────────────────────

const AUTH_TOKEN = 'test_auth_token_secret_FAKE';

/** Génère la signature Twilio canonique : HMAC-SHA1(authToken, url + sorted(k+v)) → base64. */
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

/** Construit un Request POST form-urlencoded avec header signature optionnel. */
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

/** R2 stub minimal (put/get/delete no-op). */
function makeR2Stub() {
  return {
    put: vi.fn(async () => ({})),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  } as unknown as R2Bucket;
}

/** Env mock — TWILIO_AUTH_TOKEN optionnel (passé en arg pour activer/désactiver le flag). */
function makeEnv(token?: string): Env {
  const db = createMockD1();
  return {
    DB: db as unknown as D1Database,
    FILES: makeR2Stub(),
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: token as unknown as string, // peut être undefined intentionnellement
    TWILIO_PHONE_NUMBER: '+15555550100',
  } as unknown as Env;
}

// ── Global fetch — interdiction de toucher le réseau ────────────────────────
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('blocked', { status: 599 })),
  );
});

// ════════════════════════════════════════════════════════════════════════════
// (a) verifyTwilioSignature — 6 cas
// ════════════════════════════════════════════════════════════════════════════

describe('verifyTwilioSignature — 6 cas Sprint 34 C1', () => {
  it('1) Signature valide → true (et handler 200)', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voicemail';
    const params = { From: '+15145551234', To: '+15555550100', CallSid: 'CA_test_1' };
    const sig = await makeTwilioSig(url, params, AUTH_TOKEN);

    const env = makeEnv(AUTH_TOKEN);
    const req = makeTwilioRequest(url, params, sig);

    // Helper direct.
    expect(await verifyTwilioSignature(req.clone(), env, params)).toBe(true);

    // Handler voicemail (le plus déterministe — pas de lookup D1) répond 200 XML.
    const res = await handleTwilioVoicemailTwiml(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/xml/);
  });

  it('2) Signature invalide → false (handler 403)', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voicemail';
    const params = { From: '+15145551234', To: '+15555550100' };
    const fakeSig = btoa('not-a-real-signature-payload-random');

    const env = makeEnv(AUTH_TOKEN);
    const req = makeTwilioRequest(url, params, fakeSig);

    expect(await verifyTwilioSignature(req.clone(), env, params)).toBe(false);

    const res = await handleTwilioVoicemailTwiml(req, env);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Forbidden');
  });

  it('3) Sans TWILIO_AUTH_TOKEN → bypass true (handler 200)', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voicemail';
    const params = { From: '+15145551234' };

    // Token undefined → flag inactif → verify renvoie true sans toucher la sig.
    const env = makeEnv(undefined);
    const req = makeTwilioRequest(url, params); // pas de header X-Twilio-Signature

    expect(await verifyTwilioSignature(req.clone(), env, params)).toBe(true);

    const res = await handleTwilioVoicemailTwiml(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/xml/);
  });

  it('4) Header X-Twilio-Signature absent + token présent → false (handler 403)', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voicemail';
    const params = { From: '+15145551234', To: '+15555550100' };

    const env = makeEnv(AUTH_TOKEN);
    const req = makeTwilioRequest(url, params); // header absent intentionnellement

    expect(await verifyTwilioSignature(req.clone(), env, params)).toBe(false);

    const res = await handleTwilioVoicemailTwiml(req, env);
    expect(res.status).toBe(403);
  });

  it('5) Params ordre alpha — verify ordre-indépendant', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voice';
    // Volontairement insertés dans le désordre alphabétique.
    const paramsDisordered: Record<string, string> = {};
    paramsDisordered['To'] = '+15555550100';
    paramsDisordered['CallSid'] = 'CA_test_5';
    paramsDisordered['AccountSid'] = 'AC_test';
    paramsDisordered['From'] = '+15145551234';

    // La signature canonique Twilio est calculée sur les clés triées alpha →
    // makeTwilioSig retournera la même sig qu'avec n'importe quel autre ordre
    // d'insertion. On le confirme en générant la sig sur un objet où les clés
    // sont littéralement insérées dans un autre ordre.
    const sigFromDisordered = await makeTwilioSig(url, paramsDisordered, AUTH_TOKEN);

    const paramsOrdered = {
      AccountSid: 'AC_test',
      CallSid: 'CA_test_5',
      From: '+15145551234',
      To: '+15555550100',
    };
    const sigFromOrdered = await makeTwilioSig(url, paramsOrdered, AUTH_TOKEN);

    expect(sigFromDisordered).toBe(sigFromOrdered);

    // verify accepte les params dans n'importe quel ordre d'insertion (il les
    // trie en interne via Object.keys(params).sort()).
    const env = makeEnv(AUTH_TOKEN);
    const req = makeTwilioRequest(url, paramsDisordered, sigFromOrdered);
    expect(await verifyTwilioSignature(req, env, paramsDisordered)).toBe(true);
  });

  it('6) URL avec query string signée → canonical inclut la query', async () => {
    const url =
      'https://intralys-dashboard.workers.dev/api/twilio/twiml/voicemail?tenant=acme&v=1';
    const params = { From: '+15145551234', To: '+15555550100' };
    const sig = await makeTwilioSig(url, params, AUTH_TOKEN);

    const env = makeEnv(AUTH_TOKEN);
    const reqOk = makeTwilioRequest(url, params, sig);
    expect(await verifyTwilioSignature(reqOk, env, params)).toBe(true);

    // Même params + même sig mais URL sans query → doit échouer (canonical différent).
    const urlNoQuery = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voicemail';
    const reqMismatch = makeTwilioRequest(urlNoQuery, params, sig);
    expect(await verifyTwilioSignature(reqMismatch, env, params)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (b) Handlers Phase B — smoke tests via signature
// ════════════════════════════════════════════════════════════════════════════

describe('Handlers Twilio Phase B — bornage signature', () => {
  it('handleTwilioVoiceTwiml — signature valide + agent dispo → TwiML <Dial>', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voice';
    const params = { From: '+15145551234', To: '+15555550100', CallSid: 'CA_voice_1' };
    const sig = await makeTwilioSig(url, params, AUTH_TOKEN);

    const env = makeEnv(AUTH_TOKEN);
    // Seed un agent côté D1 (lookup users via clients/sub_accounts).
    (env.DB as unknown as ReturnType<typeof createMockD1>).seed(
      'select u.phone as phone',
      [{ phone: '+15145551111' }],
    );

    const req = makeTwilioRequest(url, params, sig);
    const res = await handleTwilioVoiceTwiml(req, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/xml/);
    const body = await res.text();
    expect(body).toContain('<Dial');
    expect(body).toContain('+15145551111'); // agent dialé
  });

  it('handleTwilioVoiceTwiml — signature invalide → 403', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voice';
    const params = { From: '+15145551234', To: '+15555550100' };

    const env = makeEnv(AUTH_TOKEN);
    const req = makeTwilioRequest(url, params, btoa('bogus-sig'));
    const res = await handleTwilioVoiceTwiml(req, env);

    expect(res.status).toBe(403);
  });

  it('handleTwilioVoicemailTwiml — TwiML <Record> + consent CRTC', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/voicemail';
    const params = { From: '+15145551234' };
    const sig = await makeTwilioSig(url, params, AUTH_TOKEN);

    const env = makeEnv(AUTH_TOKEN);
    const req = makeTwilioRequest(url, params, sig);
    const res = await handleTwilioVoicemailTwiml(req, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/xml/);
    const body = await res.text();
    expect(body).toContain('<Record');
    expect(body).toMatch(/enregistr/); // disclaimer FR
  });

  it('handleTwilioRecordingStatusCallback — completed + call_log trouvé → OK 200 + UPDATE/INSERT', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/recording-status';
    const params = {
      RecordingSid: 'RE_test_1',
      RecordingUrl: 'https://api.twilio.com/RE_test_1',
      RecordingStatus: 'completed',
      RecordingDuration: '42',
      CallSid: 'CA_rec_1',
      From: '+15145551234',
      To: '+15555550100',
    };
    const sig = await makeTwilioSig(url, params, AUTH_TOKEN);

    const env = makeEnv(AUTH_TOKEN);
    const db = env.DB as unknown as ReturnType<typeof createMockD1>;
    db.seed('from call_logs where twilio_sid', [{ id: 'cl_1', client_id: 'cli_1' }]);

    const req = makeTwilioRequest(url, params, sig);
    const res = await handleTwilioRecordingStatusCallback(req, env);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');

    // UPDATE call_logs SET recording_sid = ... présent dans les calls D1.
    const updated = db.calls.find((c) => /update call_logs/i.test(c.sql));
    expect(updated).toBeDefined();
    expect(updated!.args).toContain('RE_test_1');
  });

  it('handleTwilioRecordingStatusCallback — signature invalide → 403', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/recording-status';
    const params = { RecordingSid: 'RE_x', RecordingStatus: 'completed', CallSid: 'CA_x' };

    const env = makeEnv(AUTH_TOKEN);
    const req = makeTwilioRequest(url, params, btoa('bogus'));
    const res = await handleTwilioRecordingStatusCallback(req, env);

    expect(res.status).toBe(403);
  });

  it('handleTwilioTranscriptionCallback — completed → OK 200 + UPDATE call_logs', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/transcription-callback';
    const params = {
      TranscriptionText: 'Bonjour ceci est un message vocal de test.',
      TranscriptionStatus: 'completed',
      CallSid: 'CA_tr_1',
      RecordingSid: 'RE_tr_1',
    };
    const sig = await makeTwilioSig(url, params, AUTH_TOKEN);

    const env = makeEnv(AUTH_TOKEN);
    const req = makeTwilioRequest(url, params, sig);
    const res = await handleTwilioTranscriptionCallback(req, env);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');

    const db = env.DB as unknown as ReturnType<typeof createMockD1>;
    const updateCallLogs = db.calls.find(
      (c) => /update call_logs/i.test(c.sql) && /transcription/i.test(c.sql),
    );
    expect(updateCallLogs).toBeDefined();
    expect(updateCallLogs!.args).toContain('Bonjour ceci est un message vocal de test.');
  });

  it('handleTwilioTranscriptionCallback — failed → OK 200 + UPDATE status=failed', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/transcription-callback';
    const params = {
      TranscriptionStatus: 'failed',
      CallSid: 'CA_tr_2',
      RecordingSid: 'RE_tr_2',
    };
    const sig = await makeTwilioSig(url, params, AUTH_TOKEN);

    const env = makeEnv(AUTH_TOKEN);
    const req = makeTwilioRequest(url, params, sig);
    const res = await handleTwilioTranscriptionCallback(req, env);

    expect(res.status).toBe(200);
    const db = env.DB as unknown as ReturnType<typeof createMockD1>;
    // Branche failed : UPDATE call_logs SET transcription_status = 'failed' ...
    // (le 'failed' est en littéral SQL, pas en bind).
    const updateFailed = db.calls.find(
      (c) => /update call_logs/i.test(c.sql) && /transcription_status\s*=\s*'failed'/i.test(c.sql),
    );
    expect(updateFailed).toBeDefined();
    // Voicemails aussi UPDATE failed (handler ligne 446-456).
    const updateVm = db.calls.find(
      (c) => /update voicemails/i.test(c.sql) && /transcription_status\s*=\s*'failed'/i.test(c.sql),
    );
    expect(updateVm).toBeDefined();
  });

  it('handleTwilioTranscriptionCallback — sans TWILIO_AUTH_TOKEN → bypass + 200', async () => {
    const url = 'https://intralys-dashboard.workers.dev/api/twilio/twiml/transcription-callback';
    const params = {
      TranscriptionText: 'Texte test',
      TranscriptionStatus: 'completed',
      CallSid: 'CA_tr_3',
      RecordingSid: 'RE_tr_3',
    };

    const env = makeEnv(undefined); // flag inactif
    const req = makeTwilioRequest(url, params); // pas de sig nécessaire
    const res = await handleTwilioTranscriptionCallback(req, env);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });
});
