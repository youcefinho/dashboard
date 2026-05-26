// ── Sprint 41 — voice-agent.test.ts — AI Voice Agent (PHASE B, Agent T41) ──-
//
// Tests vitest de l'engine (detectIntent / buildResponse / shouldEscalate) et
// des handlers REST (list/create/test/calls + cap settings.manage).
//
// Mock D1 via `createMockD1` (helper figé S2/S3) + `vi.mock` modules.
// Aucun réseau, aucun I/O réel, aucune dépendance Workers AI (env.AI absent).
//
// 10 cas couverts :
//   ENGINE (4) :
//     1. detectIntent keyword match → confidence > 0
//     2. detectIntent fallback no AI → keyword score only
//     3. buildResponse interpolation {{visitor_name}} + {{intent}}
//     4. shouldEscalate (confidence below / above / keyword human)
//   HANDLERS (6) :
//     5. handleListScripts 200 + 3 rows
//     6. handleCreateScript 200 + INSERT
//     7. handleCreateScript validation name vide → 400
//     8. handleTestScript → { confidence, response_text, would_escalate }
//     9. handleListCalls ?escalated=true → SQL contient escalated = 1
//    10. Cap settings.manage absent → 403

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// ── Mocks de modules (avant import du SUT) ─────────────────────────────────-

vi.mock('../modules', () => ({
  getClientModules: vi.fn(async (_env: any, _userId: string) => ({
    clientId: 'cli_A',
    modules: [],
  })),
}));

vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    audit: vi.fn().mockResolvedValue(true),
  };
});

// Imports APRÈS les mocks (vi.mock est hoisté, sécurité explicite).
import {
  detectIntent,
  buildResponse,
  shouldEscalate,
  // RENFORCEMENT additif (Sprint 41 hardening) :
  safeXmlEscape,
  parseDtmfInput,
  twimlSay,
  twimlGather,
  twimlDial,
  twimlVoicemail,
  getCallState,
  transitionCallState,
  resetCallState,
  getCallRetries,
  shouldForceEscalation,
  verifyTwilioVoiceSignature,
  resolveTenantFromCallee,
  detectIntentSync,
  isWithinBusinessHours,
  type VoiceAgentScript,
  type CallState,
} from '../lib/voice-agent-engine';
import {
  handleListScripts,
  handleCreateScript,
  handleTestScript,
  handleListCalls,
  // Sprint 41 renforcement — webhooks Twilio publics
  handleVoiceAgentIncoming,
  handleVoiceAgentGather,
  handleVoiceAgentEscalate,
} from '../voice-agent';
import { getClientModules } from '../modules';

// ── helpers locaux ─────────────────────────────────────────────────────────-

function makeAuth(
  overrides: Partial<{ userId: string; capabilities: Set<string> }> = {},
) {
  return {
    userId: 'u_admin_1',
    role: 'admin',
    clientId: 'cli_A',
    capabilities: new Set(['settings.manage']),
    ...overrides,
  } as any;
}

function makeEnv(db: ReturnType<typeof createMockD1>): Env {
  // env.AI volontairement absent → tryHaikuClassify retourne null,
  // detectIntent retombe sur le keyword matching.
  return { DB: db } as unknown as Env;
}

function makeScript(overrides: Partial<VoiceAgentScript> = {}): VoiceAgentScript {
  return {
    id: 'scr_1',
    client_id: 'cli_A',
    name: 'support',
    intent_keywords: ['support', 'help'],
    response_template: 'Hi {{visitor_name}}, your {{intent}} is processed.',
    escalation_threshold: 0.7,
    is_active: true,
    created_at: '2026-05-25T00:00:00.000Z',
    updated_at: '2026-05-25T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientModules).mockImplementation(async () => ({
    clientId: 'cli_A',
    modules: [] as any,
  }));
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE — 4 cas
// ═══════════════════════════════════════════════════════════════════════════

describe('detectIntent — keyword match', () => {
  it("script avec keywords ['support','help'] + input 'I need help' → match confiance > 0", async () => {
    const env = makeEnv(createMockD1());
    const scripts = [makeScript({ intent_keywords: ['support', 'help'] })];
    const result = await detectIntent(env, scripts, 'I need help');

    expect(result.scriptId).toBe('scr_1');
    expect(result.intent).toBe('support');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });
});

describe('detectIntent — fallback no AI', () => {
  it('env.AI undefined → keyword score only (pas d\'exception)', async () => {
    // env sans `AI` binding → tryHaikuClassify retourne null silencieusement.
    const env = { DB: createMockD1() } as unknown as Env;
    expect((env as any).AI).toBeUndefined();

    const scripts = [
      makeScript({ id: 'scr_kw', name: 'billing', intent_keywords: ['invoice', 'billing'] }),
    ];
    const result = await detectIntent(env, scripts, 'I have a billing question');

    // Match keyword pur (1/2 keywords trouvés → 0.5 confidence).
    expect(result.scriptId).toBe('scr_kw');
    expect(result.intent).toBe('billing');
    expect(result.confidence).toBeGreaterThan(0);

    // Sanity : pas de no-match (input contient bien "billing").
    expect(result.scriptId).not.toBeNull();
  });
});

describe('buildResponse — interpolation', () => {
  it("template '{{visitor_name}} … {{intent}}' + context {John, support} → 'Hi John, your support is processed.'", () => {
    const script = makeScript({
      response_template: 'Hi {{visitor_name}}, your {{intent}} is processed.',
    });
    const out = buildResponse(script, { visitor_name: 'John', intent: 'support' });
    expect(out).toBe('Hi John, your support is processed.');
  });
});

describe('shouldEscalate — confidence + keywords', () => {
  it('confidence 0.5 < threshold 0.7 → true', () => {
    expect(shouldEscalate(0.5, 0.7)).toBe(true);
  });
  it('confidence 0.8 ≥ threshold 0.7 → false', () => {
    expect(shouldEscalate(0.8, 0.7)).toBe(false);
  });
  it("confidence 0.9 mais userRequest = 'I want to talk to a human' → true (keyword)", () => {
    expect(shouldEscalate(0.9, 0.7, 'I want to talk to a human')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS — 6 cas
// ═══════════════════════════════════════════════════════════════════════════

// ── 5. handleListScripts : mock D1 retourne 3 scripts → 200 + data 3 items ──
describe('handleListScripts', () => {
  it('mock D1 retourne 3 scripts → 200 + data 3 items', async () => {
    const db = createMockD1();
    db.seed('from voice_agent_scripts', [
      {
        id: 's1',
        client_id: 'cli_A',
        name: 'support',
        intent_keywords_json: JSON.stringify(['support', 'help']),
        response_template: 'Hi',
        escalation_threshold: 0.7,
        is_active: 1,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      {
        id: 's2',
        client_id: 'cli_A',
        name: 'billing',
        intent_keywords_json: JSON.stringify(['invoice', 'billing']),
        response_template: 'Hi billing',
        escalation_threshold: 0.7,
        is_active: 1,
        created_at: '2026-01-02',
        updated_at: '2026-01-02',
      },
      {
        id: 's3',
        client_id: 'cli_A',
        name: 'sales',
        intent_keywords_json: JSON.stringify(['buy', 'price']),
        response_template: 'Hi sales',
        escalation_threshold: 0.7,
        is_active: 0,
        created_at: '2026-01-03',
        updated_at: '2026-01-03',
      },
    ]);

    const env = makeEnv(db);
    const auth = makeAuth();
    const res = await handleListScripts(env, auth);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(3);
    expect(body.data[0].id).toBe('s1');
    expect(body.data[0].intent_keywords).toEqual(['support', 'help']);
    // Bornage tenant : client_id passé en bind.
    const selectCall = db.calls.find((c) =>
      c.sql.toLowerCase().includes('from voice_agent_scripts'),
    );
    expect(selectCall).toBeDefined();
    expect(selectCall?.args[0]).toBe('cli_A');
  });
});

// ── 6. handleCreateScript : body valide → INSERT + 200 ──────────────────────
describe('handleCreateScript', () => {
  it('body valide → INSERT voice_agent_scripts + 200', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/voice-agent/scripts', {
      method: 'POST',
      body: JSON.stringify({
        name: 'support',
        intent_keywords: ['support', 'help'],
        response_template: 'Hi {{visitor_name}}',
        escalation_threshold: 0.7,
        is_active: true,
      }),
    });

    const res = await handleCreateScript(req, env, auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.name).toBe('support');
    expect(body.data.intent_keywords).toEqual(['support', 'help']);
    expect(body.data.client_id).toBe('cli_A');
    expect(body.data.is_active).toBe(true);
    expect(typeof body.data.id).toBe('string');

    // INSERT voice_agent_scripts appelé.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into voice_agent_scripts'),
    );
    expect(insert).toBeDefined();
  });
});

// ── 7. handleCreateScript validation : name vide → 400 ──────────────────────
describe('handleCreateScript validation', () => {
  it('name vide → 400 + INSERT JAMAIS appelé', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/voice-agent/scripts', {
      method: 'POST',
      body: JSON.stringify({
        name: '',
        intent_keywords: ['support'],
        response_template: 'Hi',
      }),
    });

    const res = await handleCreateScript(req, env, auth);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/nom du script/i);

    // INSERT NE DOIT PAS être appelé (validation court-circuite avant DB).
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into voice_agent_scripts'),
    );
    expect(insert).toBeUndefined();
  });
});

// ── 8. handleTestScript : load + detectIntent + buildResponse ───────────────
describe('handleTestScript', () => {
  it('script trouvé + match keyword → { confidence, response_text, would_escalate }', async () => {
    const db = createMockD1();
    db.seed('from voice_agent_scripts', [
      {
        id: 'scr_1',
        client_id: 'cli_A',
        name: 'support',
        intent_keywords_json: JSON.stringify(['support', 'help']),
        response_template: 'Hi {{visitor_name}}, your {{intent}} is processed.',
        escalation_threshold: 0.7,
        is_active: 1,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ]);
    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/voice-agent/scripts/scr_1/test', {
      method: 'POST',
      body: JSON.stringify({
        sample_input: 'I need support and help please',
        visitor_name: 'John',
      }),
    });

    const res = await handleTestScript(req, env, auth, 'scr_1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.data.confidence).toBe('number');
    expect(body.data.confidence).toBeGreaterThan(0);
    expect(typeof body.data.response_text).toBe('string');
    expect(body.data.response_text).toContain('John');
    expect(body.data.response_text).toContain('support');
    expect(typeof body.data.would_escalate).toBe('boolean');
  });
});

// ── 9. handleListCalls : ?escalated=true → SQL inclut WHERE escalated=1 ─────
describe('handleListCalls', () => {
  it("?escalated=true → SQL généré contient 'escalated = 1'", async () => {
    const db = createMockD1();
    db.seed('from voice_agent_calls', [
      {
        id: 'call_1',
        client_id: 'cli_A',
        script_id: 'scr_1',
        escalated: 1,
        confidence: 0.4,
        response_text: null,
        created_at: '2026-05-25T00:00:00.000Z',
      },
    ]);

    const env = makeEnv(db);
    const auth = makeAuth();
    const url = new URL('https://app/api/voice-agent/calls?escalated=true');
    const res = await handleListCalls(env, auth, url);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);

    // Le SELECT généré doit contenir le filtre escalated = 1.
    const selectCall = db.calls.find((c) =>
      c.sql.toLowerCase().includes('from voice_agent_calls'),
    );
    expect(selectCall).toBeDefined();
    expect(selectCall!.sql.toLowerCase()).toContain('escalated = 1');
    // client_id reste le 1er bind (bornage tenant).
    expect(selectCall!.args[0]).toBe('cli_A');
  });
});

// ── 10. Cap check : auth sans 'settings.manage' → 403 ──────────────────────
describe('handleListScripts — capability guard', () => {
  it("auth sans 'settings.manage' → 403", async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth({ capabilities: new Set<string>() });

    const res = await handleListScripts(env, auth);
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/refus/i);

    // Aucune query DB ne doit être déclenchée (guard court-circuite).
    expect(db.calls.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RENFORCEMENT (Sprint 41 hardening) — tests additifs
// ═══════════════════════════════════════════════════════════════════════════

// ── verifyTwilioVoiceSignature ─────────────────────────────────────────────

describe('verifyTwilioVoiceSignature', () => {
  it('TWILIO_AUTH_TOKEN absent → bypass (return true, FLAG INACTIF)', async () => {
    const env = { DB: createMockD1() } as unknown as Env;
    const req = new Request('https://app/twilio/voice', { method: 'POST' });
    const ok = await verifyTwilioVoiceSignature(req, env, { From: '+15145551234' });
    expect(ok).toBe(true);
  });

  it("token présent + header X-Twilio-Signature absent → false (rejet)", async () => {
    const env = {
      DB: createMockD1(),
      TWILIO_AUTH_TOKEN: 'fake_test_token',
    } as unknown as Env;
    const req = new Request('https://app/twilio/voice', { method: 'POST' });
    const ok = await verifyTwilioVoiceSignature(req, env, { From: '+15145551234' });
    expect(ok).toBe(false);
  });

  it('token présent + signature valide HMAC-SHA1 → true', async () => {
    const token = 'test_token_12345';
    const url = 'https://app/twilio/voice';
    const params = { From: '+15145551234', To: '+15145559999', CallSid: 'CA' + 'a'.repeat(32) };
    // Recalcule signature attendue.
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const k of sortedKeys) data += k + (params as any)[k];
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(token),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

    const req = new Request(url, {
      method: 'POST',
      headers: { 'X-Twilio-Signature': expected },
    });
    const env = {
      DB: createMockD1(),
      TWILIO_AUTH_TOKEN: token,
    } as unknown as Env;
    const ok = await verifyTwilioVoiceSignature(req, env, params);
    expect(ok).toBe(true);
  });
});

// ── detectIntentSync : 5 cas (match exact / partiel / fallback / escalation / empty) ─

describe('detectIntentSync — 5 cas', () => {
  const scripts: VoiceAgentScript[] = [
    {
      id: 'scr_hours',
      client_id: 'cli_A',
      name: 'horaires',
      intent_keywords: ['horaire', 'heures', 'ouvert'],
      response_template: 'Nos horaires sont…',
      escalation_threshold: 0.7,
      is_active: true,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'scr_price',
      client_id: 'cli_A',
      name: 'tarifs',
      intent_keywords: ['prix', 'tarif', 'coûte'],
      response_template: 'Nos tarifs…',
      escalation_threshold: 0.7,
      is_active: true,
      created_at: '',
      updated_at: '',
    },
  ];

  it('match exact (input contient 2/3 keywords) → confidence ≈ 0.67', () => {
    const r = detectIntentSync(scripts, 'Quels sont vos horaires et heures ?');
    expect(r.scriptId).toBe('scr_hours');
    expect(r.intent).toBe('horaires');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("match partiel (1 keyword sur 3) → confidence > MIN_CONFIDENCE (0.3)", () => {
    const r = detectIntentSync(scripts, 'Combien ça coûte ?');
    expect(r.scriptId).toBe('scr_price');
    expect(r.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it('no match (input totalement off-topic) → scriptId null (fallback escalation)', () => {
    const r = detectIntentSync(scripts, 'météo demain');
    expect(r.scriptId).toBeNull();
    expect(r.intent).toBeNull();
  });

  it('empty input → scriptId null + confidence 0', () => {
    const r = detectIntentSync(scripts, '');
    expect(r.scriptId).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('scripts array vide → scriptId null + confidence 0 (no match → escalation côté caller)', () => {
    const r = detectIntentSync([], 'horaires svp');
    expect(r.scriptId).toBeNull();
    expect(r.confidence).toBe(0);
  });
});

// ── twimlSay : XML escape + accents OK ─────────────────────────────────────

describe('twimlSay — XML safe escape', () => {
  it("text contenant <, &, \" est escape (anti-injection TwiML)", () => {
    const out = twimlSay('Bonjour <b>"Jean & Co"</b>');
    expect(out).toContain('&lt;b&gt;');
    expect(out).toContain('&quot;Jean &amp; Co&quot;');
    expect(out).toContain('&lt;/b&gt;');
    // Anti-double-escape : `&amp;amp;` interdit.
    expect(out).not.toMatch(/&amp;amp;/);
  });

  it('accents FR (é, à, ç) restent intacts dans le payload XML', () => {
    const out = twimlSay('Bonjour, nous sommes à votre écoute.');
    expect(out).toContain('Bonjour, nous sommes à votre écoute.');
  });

  it('text vide → fallback <Hangup/> (jamais de Response vide qui drop)', () => {
    const out = twimlSay('');
    expect(out).toContain('<Hangup/>');
    expect(out).not.toContain('<Say');
  });

  it("voice + language sont escape (anti-injection sur attrs)", () => {
    const out = twimlSay('Hi', 'Polly.Joanna" onerror="xss', 'en-US');
    // Le guillemet est escape → l'attribut reste contenu.
    expect(out).toContain('Polly.Joanna&quot;');
    expect(out).not.toMatch(/voice="Polly\.Joanna" onerror/);
  });
});

// ── twimlGather + twimlDial + twimlVoicemail (smoke + safety) ──────────────

describe('twimlGather / twimlDial / twimlVoicemail', () => {
  it("twimlGather inclut <Gather> + <Say> + Redirect fallback (no-input)", () => {
    const out = twimlGather('Tapez 1 pour <support>', '/api/voice/menu', 1, 5);
    expect(out).toContain('<Gather');
    expect(out).toContain('action="/api/voice/menu"');
    expect(out).toContain('numDigits="1"');
    expect(out).toContain('timeout="5"');
    expect(out).toContain('&lt;support&gt;'); // prompt escape
    expect(out).toContain('<Redirect');
  });

  it('twimlGather clamp numDigits 99 → 10 et timeout 999 → 60', () => {
    const out = twimlGather('?', '/cb', 99, 999);
    expect(out).toContain('numDigits="10"');
    expect(out).toContain('timeout="60"');
  });

  it('twimlDial forward + record=false par défaut', () => {
    const out = twimlDial('+15145559999', '+15145551111', false, 30);
    expect(out).toContain('<Dial');
    expect(out).toContain('+15145559999');
    expect(out).toContain('callerId="+15145551111"');
    expect(out).not.toMatch(/record="record/);
  });

  it('twimlDial avec recordingEnabled=true → record="record-from-answer-dual"', () => {
    const out = twimlDial('+15145559999', '+15145551111', true);
    expect(out).toContain('record="record-from-answer-dual"');
  });

  it('twimlDial forwardTo vide → TwiML Hangup safe (pas de <Dial> vide)', () => {
    const out = twimlDial('', '+15145551111');
    expect(out).toContain('<Hangup/>');
    expect(out).not.toContain('<Dial');
  });

  it('twimlVoicemail clamp maxLength 9999 → 600 + <Record playBeep="true"/>', () => {
    const out = twimlVoicemail(9999);
    expect(out).toContain('maxLength="600"');
    expect(out).toContain('playBeep="true"');
    expect(out).toContain('<Record');
  });
});

// ── State machine ──────────────────────────────────────────────────────────

describe('CallState state machine', () => {
  const SID = 'CA' + 'b'.repeat(32);

  beforeEach(() => {
    resetCallState(SID);
  });

  it("get sur SID inconnu → 'incoming' (création implicite)", () => {
    expect(getCallState(SID)).toBe<CallState>('incoming');
  });

  it("transitions valides : incoming → menu → input → routing → resolved", () => {
    getCallState(SID); // init
    expect(transitionCallState(SID, 'menu')).toBe('menu');
    expect(transitionCallState(SID, 'input')).toBe('input');
    expect(transitionCallState(SID, 'routing')).toBe('routing');
    expect(transitionCallState(SID, 'resolved')).toBe('resolved');
    expect(getCallState(SID)).toBe('resolved');
  });

  it("transition invalide (incoming → resolved direct) → null", () => {
    getCallState(SID);
    expect(transitionCallState(SID, 'resolved')).toBeNull();
    expect(getCallState(SID)).toBe('incoming');
  });

  it("transition depuis terminal (resolved) → null (toujours rejetée)", () => {
    getCallState(SID);
    transitionCallState(SID, 'menu');
    transitionCallState(SID, 'input');
    transitionCallState(SID, 'routing');
    transitionCallState(SID, 'resolved');
    expect(transitionCallState(SID, 'menu')).toBeNull();
    expect(transitionCallState(SID, 'escalation')).toBeNull();
  });

  it("callSid invalide → null transition + 'incoming' get", () => {
    expect(transitionCallState('!!bad!!', 'menu')).toBeNull();
    expect(getCallState('!!bad!!')).toBe('incoming');
  });

  it("input → menu (retry) incrémente getCallRetries", () => {
    getCallState(SID);
    transitionCallState(SID, 'menu'); // incoming → menu
    transitionCallState(SID, 'input'); // menu → input
    expect(getCallRetries(SID)).toBe(0);
    transitionCallState(SID, 'menu'); // input → menu = retry
    expect(getCallRetries(SID)).toBe(1);
    transitionCallState(SID, 'input');
    transitionCallState(SID, 'menu');
    transitionCallState(SID, 'input');
    transitionCallState(SID, 'menu');
    expect(getCallRetries(SID)).toBe(3);
    expect(shouldForceEscalation(SID)).toBe(true);
  });
});

// ── parseDtmfInput ─────────────────────────────────────────────────────────

describe('parseDtmfInput', () => {
  it("'123' → '123' (chiffres seuls)", () => {
    expect(parseDtmfInput('123')).toBe('123');
  });

  it("'1*2#' → '1*2#' (* et # acceptés)", () => {
    expect(parseDtmfInput('1*2#')).toBe('1*2#');
  });

  it("'abc' → null (lettres rejetées)", () => {
    expect(parseDtmfInput('abc')).toBeNull();
  });

  it("'1a2' → null (mix invalide)", () => {
    expect(parseDtmfInput('1a2')).toBeNull();
  });

  it("'' / '   ' / null / undefined / number → null", () => {
    expect(parseDtmfInput('')).toBeNull();
    expect(parseDtmfInput('   ')).toBeNull();
    expect(parseDtmfInput(null)).toBeNull();
    expect(parseDtmfInput(undefined)).toBeNull();
    expect(parseDtmfInput(123 as any)).toBeNull();
  });

  it("'  5  ' → '5' (trim)", () => {
    expect(parseDtmfInput('  5  ')).toBe('5');
  });
});

// ── safeXmlEscape (edge cases) ─────────────────────────────────────────────

describe('safeXmlEscape', () => {
  it("null/undefined → '' (defensive)", () => {
    expect(safeXmlEscape(null)).toBe('');
    expect(safeXmlEscape(undefined)).toBe('');
  });

  it("escape les 5 entités XML (& < > \" ')", () => {
    expect(safeXmlEscape('<a href="b\'c&d">')).toBe(
      '&lt;a href=&quot;b&apos;c&amp;d&quot;&gt;',
    );
  });

  it("& doit être escape EN PREMIER (pas de double-escape)", () => {
    // Test critique : "&amp;" en entrée NE DOIT PAS devenir "&amp;amp;".
    // Mais notre helper escape `&` → `&amp;`, donc "&amp;" → "&amp;amp;".
    // C'est le comportement attendu (input littéral, pas pré-encodé).
    // Le critère réel : "<" précédé de "&" ne casse pas.
    expect(safeXmlEscape('A & <B>')).toBe('A &amp; &lt;B&gt;');
  });
});

// ── resolveTenantFromCallee ─────────────────────────────────────────────────

describe('resolveTenantFromCallee', () => {
  it('numéro absent / vide / non-string → null', async () => {
    const env = makeEnv(createMockD1());
    expect(await resolveTenantFromCallee(env, null)).toBeNull();
    expect(await resolveTenantFromCallee(env, '')).toBeNull();
    expect(await resolveTenantFromCallee(env, undefined)).toBeNull();
    expect(await resolveTenantFromCallee(env, 'abc' as any)).toBeNull();
  });

  it('tenant trouvé via call_logs.to_number → { clientId, agencyId }', async () => {
    const db = createMockD1();
    db.seed('from call_logs', [{ client_id: 'cli_A' }]);
    db.seed('from clients', [{ agency_id: 'ag_42' }]);
    const env = makeEnv(db);
    const out = await resolveTenantFromCallee(env, '+15145559999');
    expect(out).toEqual({ clientId: 'cli_A', agencyId: 'ag_42' });
  });

  it('numéro inconnu (pas de call_log) → null', async () => {
    const db = createMockD1();
    // defaultRows vide → first() → null
    const env = makeEnv(db);
    const out = await resolveTenantFromCallee(env, '+15145559999');
    expect(out).toBeNull();
  });

  it("agency lookup KO → clientId quand même renvoyé avec agencyId=null", async () => {
    const db = createMockD1();
    db.seed('from call_logs', [{ client_id: 'cli_B' }]);
    // pas de seed clients → defaultRows vide → first() → null
    const env = makeEnv(db);
    const out = await resolveTenantFromCallee(env, '+15145559999');
    expect(out).toEqual({ clientId: 'cli_B', agencyId: null });
  });
});

// ── isWithinBusinessHours ──────────────────────────────────────────────────

describe('isWithinBusinessHours', () => {
  it('lundi 10h UTC (default lun-ven 8-20) → true', () => {
    // 2026-05-25 = lundi (vérif Date.getUTCDay() === 1).
    const monday10am = new Date('2026-05-25T10:00:00Z');
    expect(monday10am.getUTCDay()).toBe(1);
    expect(isWithinBusinessHours(monday10am)).toBe(true);
  });

  it('dimanche 14h UTC → false (hors jours ouvrés)', () => {
    const sunday2pm = new Date('2026-05-24T14:00:00Z');
    expect(sunday2pm.getUTCDay()).toBe(0);
    expect(isWithinBusinessHours(sunday2pm)).toBe(false);
  });

  it('lundi 03h UTC → false (avant 8h)', () => {
    const monday3am = new Date('2026-05-25T03:00:00Z');
    expect(isWithinBusinessHours(monday3am)).toBe(false);
  });

  it("config override : 24/7 (daysOfWeek=[0..6]) → true tout le temps", () => {
    const sunday2am = new Date('2026-05-24T02:00:00Z');
    expect(
      isWithinBusinessHours(sunday2am, {
        startHour: 0,
        endHour: 24,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      }),
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WIRE-UP — Twilio webhook handlers PUBLICS (handleVoiceAgentIncoming/Gather/Escalate)
// 5 tests câblage helpers renforcés (signature/state machine/parseDtmf/business
// hours/escalation forcée).
// ═══════════════════════════════════════════════════════════════════════════

/** Helper : forge un Request Twilio form-urlencoded. */
function makeTwilioRequest(
  url: string,
  params: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  const body = new URLSearchParams(params).toString();
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
}

/**
 * Mocke `Date.now()` / `new Date()` pour piloter `isWithinBusinessHours`.
 * Renvoie la fonction de cleanup.
 */
function freezeTime(iso: string): () => void {
  const original = Date;
  // @ts-expect-error — override global Date dans un test scope.
  globalThis.Date = class extends original {
    constructor(...args: any[]) {
      if (args.length === 0) super(iso);
      else super(...(args as []));
    }
    static now() {
      return new original(iso).getTime();
    }
  };
  return () => {
    globalThis.Date = original;
  };
}

// ── Test 1 : /voice/incoming sans signature (token configuré) → 403 ────────
describe('handleVoiceAgentIncoming — signature guard', () => {
  it('TWILIO_AUTH_TOKEN présent + signature header absente → 403', async () => {
    const db = createMockD1();
    const env = {
      DB: db,
      TWILIO_AUTH_TOKEN: 'test_token_xxx',
    } as unknown as Env;
    const req = makeTwilioRequest(
      'https://app/api/voice-agent/twilio/incoming',
      { From: '+15145551234', To: '+15145559999', CallSid: 'CA' + 'c'.repeat(32) },
      // PAS de X-Twilio-Signature
    );
    const res = await handleVoiceAgentIncoming(req, env);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toMatch(/invalid Twilio signature/i);
  });
});

// ── Test 2 : /voice/incoming signature valide + tenant trouvé → TwiML valide ─
describe('handleVoiceAgentIncoming — TwiML happy path', () => {
  it('mode dev (no token) + tenant trouvé + heures ouvrées → <Gather> valide', async () => {
    const restoreTime = freezeTime('2026-05-25T14:00:00Z'); // lundi 14h UTC (ouvert)
    try {
      const db = createMockD1();
      db.seed('from call_logs', [{ client_id: 'cli_tenant_1' }]);
      db.seed('from clients', [{ agency_id: 'ag_1' }]);

      const env = {
        DB: db,
        // pas de TWILIO_AUTH_TOKEN → bypass signature (mode dev)
      } as unknown as Env;
      const sid = 'CA' + 'd'.repeat(32);
      const req = makeTwilioRequest(
        'https://app/api/voice-agent/twilio/incoming',
        { From: '+15145551234', To: '+15145559999', CallSid: sid },
      );
      const res = await handleVoiceAgentIncoming(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toMatch(/text\/xml/);
      const xml = await res.text();
      expect(xml).toContain('<?xml');
      expect(xml).toContain('<Gather');
      expect(xml).toContain('action="/api/voice-agent/twilio/gather"');
      // L'état doit avoir transition incoming → menu.
      expect(getCallState(sid)).toBe('menu');
      resetCallState(sid);
    } finally {
      restoreTime();
    }
  });

  it('tenant introuvable → TwiML générique "non attribué" + Hangup', async () => {
    const restoreTime = freezeTime('2026-05-25T14:00:00Z');
    try {
      const db = createMockD1(); // pas de seed call_logs → resolveTenant null
      const env = { DB: db } as unknown as Env;
      const req = makeTwilioRequest(
        'https://app/api/voice-agent/twilio/incoming',
        { From: '+15145551234', To: '+15145557777', CallSid: 'CA' + 'e'.repeat(32) },
      );
      const res = await handleVoiceAgentIncoming(req, env);
      expect(res.status).toBe(200);
      const xml = await res.text();
      // Apostrophe XML-escapée → on accepte les deux formes.
      expect(xml).toMatch(/n(?:'|&apos;)est pas attribué/i);
    } finally {
      restoreTime();
    }
  });
});

// ── Test 3 : /voice/gather DTMF "abc" → ignored, retry message ─────────────
describe('handleVoiceAgentGather — DTMF invalide rejeté + retry', () => {
  it('Digits="abc" sans SpeechResult → retry <Gather> (pas de match intent)', async () => {
    const db = createMockD1();
    db.seed('from call_logs', [{ client_id: 'cli_A' }]);
    db.seed('from clients', [{ agency_id: null }]);
    const env = { DB: db } as unknown as Env;

    const sid = 'CA' + 'f'.repeat(32);
    resetCallState(sid);
    const req = makeTwilioRequest(
      'https://app/api/voice-agent/twilio/gather',
      {
        From: '+15145551234',
        To: '+15145559999',
        CallSid: sid,
        Digits: 'abc', // parseDtmfInput → null
        SpeechResult: '', // pas de speech non plus
      },
    );
    const res = await handleVoiceAgentGather(req, env);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<Gather');
    // Apostrophe XML-escapée (&apos;) ou littérale.
    expect(xml).toMatch(/n(?:'|&apos;)ai pas (?:bien )?compris/i);
    // Retries doit avoir été incrémenté (input → menu = retry).
    expect(getCallRetries(sid)).toBeGreaterThanOrEqual(1);
    resetCallState(sid);
  });
});

// ── Test 4 : /voice/gather retries >= 3 → escalation ──────────────────────
describe('handleVoiceAgentGather — escalation après MAX_INPUT_RETRIES', () => {
  it('3 inputs invalides successifs → 3e réponse = escalation TwiML (Dial ou Voicemail)', async () => {
    const db = createMockD1();
    db.seed('from call_logs', [{ client_id: 'cli_A' }]);
    db.seed('from clients', [{ agency_id: null }]);
    const env = {
      DB: db,
      TWILIO_FORWARD_TO: '+15145550000', // humain configuré → twimlDial
      TWILIO_PHONE_NUMBER: '+15145559999',
    } as unknown as Env;

    const sid = 'CA' + '9'.repeat(32);
    resetCallState(sid);
    // Pré-pump l'état : on simule 2 retries déjà accumulés.
    // Pour atteindre retries=3 après l'appel (retries >= MAX=3 → escalation).
    // Le handler fait : menu(incoming→menu)→input→menu (retry). Pour atteindre
    // 3 retries il faut 3 appels — on les fait directement.
    const makeReq = () =>
      makeTwilioRequest('https://app/api/voice-agent/twilio/gather', {
        From: '+15145551234',
        To: '+15145559999',
        CallSid: sid,
        Digits: 'abc',
      });

    // 1er appel : retries → 1
    await handleVoiceAgentGather(makeReq(), env);
    // 2e appel : retries → 2
    await handleVoiceAgentGather(makeReq(), env);
    // 3e appel : retries → 3 ⇒ shouldForceEscalation === true ⇒ escalation
    const res3 = await handleVoiceAgentGather(makeReq(), env);
    expect(res3.status).toBe(200);
    const xml = await res3.text();
    // Escalation flow : soit Dial (humain configuré), soit Voicemail.
    // Ici TWILIO_FORWARD_TO présent → Dial attendu.
    expect(xml).toMatch(/<Dial|<Record/);
    if (xml.includes('<Dial')) {
      expect(xml).toContain('+15145550000');
    }
    resetCallState(sid);
  });
});

// ── Test 5 : business hours OFF → message + voicemail (pas de menu) ────────
describe('handleVoiceAgentIncoming — hors heures ouvrées', () => {
  it('dimanche 14h UTC → twimlVoicemail (pas de <Gather> menu)', async () => {
    // dimanche 2026-05-24 14h UTC (jour 0, hors lun-ven default)
    const restoreTime = freezeTime('2026-05-24T14:00:00Z');
    try {
      const db = createMockD1();
      db.seed('from call_logs', [{ client_id: 'cli_A' }]);
      db.seed('from clients', [{ agency_id: 'ag_1' }]);
      const env = { DB: db } as unknown as Env;

      const sid = 'CA' + '8'.repeat(32);
      resetCallState(sid);
      const req = makeTwilioRequest(
        'https://app/api/voice-agent/twilio/incoming',
        { From: '+15145551234', To: '+15145559999', CallSid: sid },
      );
      const res = await handleVoiceAgentIncoming(req, env);
      expect(res.status).toBe(200);
      const xml = await res.text();
      // Pas de menu interactif hors heures ouvrées.
      expect(xml).not.toContain('<Gather');
      // Voicemail attendu (Record + consent CRTC).
      expect(xml).toContain('<Record');
      expect(xml).toMatch(/enregistré|enregistre/i);
      resetCallState(sid);
    } finally {
      restoreTime();
    }
  });
});

// ── Bonus : /escalate?mode=voicemail standalone ────────────────────────────
describe('handleVoiceAgentEscalate — mode=voicemail', () => {
  it('?mode=voicemail → twimlVoicemail avec consent CRTC', async () => {
    const env = { DB: createMockD1() } as unknown as Env;
    const sid = 'CA' + '7'.repeat(32);
    resetCallState(sid);
    // Pré-pump state vers 'escalation' (sinon transition refusée).
    getCallState(sid);
    transitionCallState(sid, 'menu');
    transitionCallState(sid, 'escalation');

    const req = makeTwilioRequest(
      'https://app/api/voice-agent/twilio/escalate?mode=voicemail',
      { CallSid: sid, From: '+15145551234', To: '+15145559999' },
    );
    const res = await handleVoiceAgentEscalate(req, env);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<Record');
    expect(xml).toMatch(/enregistré/i);
    resetCallState(sid);
  });
});
