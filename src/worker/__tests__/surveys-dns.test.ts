// ── Sprint 51 Agent T50 — surveys-dns.test.ts — Tests Sprint 50 (Surveys + DNS) ──
//
// Couvre ~12 cas répartis :
//
//   Surveys Engine (3 cas) :
//     1. resolveNextQuestion           → branch match (stub Phase A : { null, false })
//     2. computeNpsScore               → 50/30/20 → 30 / all detractors → -100 / total 0 → 0
//     3. aggregateNpsForPeriod         → stub Phase A : retourne agrégat vide propre
//
//   DNS Engine (3 cas) :
//     4. verifyDomainOwnership         → stub Phase A : { verified: false, reason: 'phase-a-stub' }
//     5. provisionCloudflareForSaas    → flag INACTIF : { zone_id: null, ssl_status: 'pending' }
//     6. syncDnsRecords                → flag INACTIF : { synced: 0 }
//
//   Surveys Handlers (3 cas) :
//     7. handleCreateSurvey            → INSERT surveys + 201
//     8. handlePublicSubmitSurvey      → rate-limit OK + honeypot vide → INSERT response + answers
//     9. handleGetNpsAggregate         → call aggregateNpsForPeriod → return data
//
//   DNS Handlers (3 cas) :
//    10. handleAddCustomDomain         → INSERT custom_domains + verification_token + 201
//    11. handleVerifyDomain            → verifyDomainOwnership stub returns false → status reste pending
//    12. Cap check                     → tenant mode-agence sans settings.manage → 403
//
// Mock D1 via `createMockD1` (helper figé) + mocks rate-limit + dns-engine pour
// le test 11 (override verified=true). Aucun réseau.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// ── Mocks de modules (AVANT import du SUT — vi.mock est hoisté) ─────────────

vi.mock('../lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 9,
    retry_after_seconds: 0,
    bucket_key: 'test',
  })),
}));

// Mock dns-engine pour pouvoir overrider verifyDomainOwnership dans le test 11.
vi.mock('../lib/dns-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dns-engine')>();
  return {
    ...actual,
    verifyDomainOwnership: vi.fn(async () => ({
      verified: false,
      reason: 'phase-a-stub',
    })),
    provisionCloudflareForSaas: vi.fn(async () => ({
      zone_id: null,
      ssl_status: 'pending' as const,
    })),
    syncDnsRecords: vi.fn(async () => ({
      synced: 0,
      reason: 'phase-a-stub',
    })),
  };
});

// Imports APRÈS les mocks (vi.mock hoisté).
import {
  resolveNextQuestion,
  computeNpsScore,
  aggregateNpsForPeriod,
  classifyNps,
  computeNpsFromAnswers,
  computeCsat,
  computeCes,
  validateAnswer,
  getNextQuestionId,
  isWithinSurveyWindow,
  hashRespondentIp,
  aggregateResponses,
  SURVEY_ERROR_CODES,
} from '../lib/survey-engine';
import {
  verifyDomainOwnership,
  provisionCloudflareForSaas,
  syncDnsRecords,
} from '../lib/dns-engine';
import {
  handleCreateSurvey,
  handlePublicSubmitSurvey,
  handleGetNpsAggregate,
  handleGetSurveyAnalytics,
  handleGetNextQuestion,
} from '../surveys';
import {
  handleAddCustomDomain,
  handleVerifyDomain,
} from '../custom-domains';

// ── helpers locaux ──────────────────────────────────────────────────────────

function makeAuth(
  overrides: Partial<{
    userId: string;
    clientId: string;
    capabilities: Set<string>;
    tenant: any;
  }> = {},
) {
  return {
    userId: 'u_1',
    role: 'admin',
    clientId: 'cli_A',
    capabilities: new Set(['settings.manage']),
    ...overrides,
  } as any;
}

function makeEnv(db: ReturnType<typeof createMockD1>): Env {
  return { DB: db } as unknown as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// SURVEYS ENGINE — 3 cas
// ════════════════════════════════════════════════════════════════════════════

describe('resolveNextQuestion — branch match (Phase B renforcée)', () => {
  it('match branche existante → { nextId: q_42, jumpToEnd: false }', async () => {
    const db = createMockD1();
    db.seed('from survey_branches', [
      {
        next_question_id: 'q_42',
        jump_to_end: 0,
      },
    ]);
    const env = makeEnv(db);

    const result = await resolveNextQuestion(env, 'q_1', 'option_a');
    expect(result).toEqual({ nextId: 'q_42', jumpToEnd: false });
  });

  it('aucune branche match → { nextId: null, jumpToEnd: false }', async () => {
    const db = createMockD1(); // pas de seed → .first() retourne null
    const env = makeEnv(db);
    const result = await resolveNextQuestion(env, 'q_unknown', 'whatever');
    expect(result).toEqual({ nextId: null, jumpToEnd: false });
  });

  it('jump_to_end=1 → { nextId: null, jumpToEnd: true }', async () => {
    const db = createMockD1();
    db.seed('from survey_branches', [
      { next_question_id: 'q_99', jump_to_end: 1 },
    ]);
    const env = makeEnv(db);
    const result = await resolveNextQuestion(env, 'q_1', 'option_x');
    expect(result).toEqual({ nextId: null, jumpToEnd: true });
  });

  it('env.DB absent → dégradation gracieuse { null, false }', async () => {
    const result = await resolveNextQuestion(
      {} as Env,
      'q_1',
      'option_a',
    );
    expect(result).toEqual({ nextId: null, jumpToEnd: false });
  });
});

describe('computeNpsScore', () => {
  it('50 promoters + 30 passives + 20 detractors / 100 total → score = 30', () => {
    const score = computeNpsScore(50, 30, 20);
    // NPS = (50 - 20) / 100 * 100 = 30.
    expect(score).toBe(30);
  });

  it('all detractors (0/0/100) → score = -100', () => {
    const score = computeNpsScore(0, 0, 100);
    expect(score).toBe(-100);
  });

  it('total 0 → score = 0 (anti-div-by-zero)', () => {
    expect(computeNpsScore(0, 0, 0)).toBe(0);
  });

  it('all promoters (100/0/0) → score = 100', () => {
    expect(computeNpsScore(100, 0, 0)).toBe(100);
  });
});

describe('aggregateNpsForPeriod', () => {
  it('agrège 4 réponses NPS seedées (2 promoters / 1 passive / 1 detractor → score 25)', async () => {
    const db = createMockD1();
    db.seed('from survey_response_answers', [
      { answer_value: 10, client_id: 'cli_X' }, // promoter
      { answer_value: 9, client_id: 'cli_X' }, // promoter
      { answer_value: 8, client_id: 'cli_X' }, // passive
      { answer_value: 5, client_id: 'cli_X' }, // detractor
    ]);
    const env = makeEnv(db);

    const result = await aggregateNpsForPeriod(env, 'survey_1', 30);

    expect(result).toMatchObject({
      survey_id: 'survey_1',
      period_days: 30,
      promoters_count: 2,
      passives_count: 1,
      detractors_count: 1,
      total_responses: 4,
      nps_score: 25, // (2 - 1) / 4 * 100 = 25
      client_id: 'cli_X',
    });
    expect(Number.isNaN(Date.parse(result.calculated_at))).toBe(false);
  });

  it('aucune réponse → agrégat zéro propre (best-effort)', async () => {
    const db = createMockD1(); // pas de seed → results=[]
    const env = makeEnv(db);
    const result = await aggregateNpsForPeriod(env, 'survey_empty', 60);
    expect(result.total_responses).toBe(0);
    expect(result.nps_score).toBe(0);
    expect(result.period_days).toBe(60);
  });

  it('env.DB absent → agrégat zéro sans throw', async () => {
    const result = await aggregateNpsForPeriod({} as Env, 'survey_x', 90);
    expect(result.total_responses).toBe(0);
    expect(result.period_days).toBe(90);
  });

  it('periodDays invalide → fallback 30j', async () => {
    const result = await aggregateNpsForPeriod({} as Env, 'survey_x', -10);
    expect(result.period_days).toBe(30);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SURVEY-ENGINE RENFORCEMENT (Phase B) — helpers purs ajoutés Sprint 51
// ════════════════════════════════════════════════════════════════════════════

describe('classifyNps', () => {
  it('9-10 → promoter, 7-8 → passive, 0-6 → detractor, hors-range → invalid', () => {
    expect(classifyNps(10)).toBe('promoter');
    expect(classifyNps(9)).toBe('promoter');
    expect(classifyNps(8)).toBe('passive');
    expect(classifyNps(7)).toBe('passive');
    expect(classifyNps(6)).toBe('detractor');
    expect(classifyNps(0)).toBe('detractor');
    expect(classifyNps(-1)).toBe('invalid');
    expect(classifyNps(11)).toBe('invalid');
    expect(classifyNps(null)).toBe('invalid');
    expect(classifyNps('abc')).toBe('invalid');
  });
});

describe('computeNpsFromAnswers', () => {
  it('liste mixte (10/9/8/5) → 2 promoters / 1 passive / 1 detractor / score 25', () => {
    const result = computeNpsFromAnswers([10, 9, 8, 5]);
    expect(result).toEqual({
      score: 25,
      promoters: 2,
      passives: 1,
      detractors: 1,
      total: 4,
    });
  });

  it('valeurs null / hors-range ignorées', () => {
    const result = computeNpsFromAnswers([10, null, 99, 9, 5]);
    expect(result.total).toBe(3); // 10, 9, 5 comptés
    expect(result.score).toBe(33); // (2-1)/3*100 = 33.33 → 33
  });

  it('liste vide → score 0 total 0', () => {
    expect(computeNpsFromAnswers([])).toEqual({
      score: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
      total: 0,
    });
  });

  it('score borné dans [-100, 100]', () => {
    const allDetractors = computeNpsFromAnswers([0, 1, 2, 3, 4, 5, 6]);
    expect(allDetractors.score).toBe(-100);
    const allPromoters = computeNpsFromAnswers([9, 9, 10, 10, 10]);
    expect(allPromoters.score).toBe(100);
  });
});

describe('computeCsat', () => {
  it('moyenne + distribution sur scale 1-5', () => {
    const result = computeCsat([5, 5, 4, 3, 2, 1]);
    expect(result.count).toBe(6);
    expect(result.avg).toBe(3.33);
    expect(result.distribution).toEqual([1, 1, 1, 1, 2]); // 1:1, 2:1, 3:1, 4:1, 5:2
  });

  it('hors-range ignoré', () => {
    const result = computeCsat([5, 6, 0, null], 5);
    expect(result.count).toBe(1); // seul 5 est valide
    expect(result.avg).toBe(5);
  });

  it('scaleMax invalide → fallback 5', () => {
    const r = computeCsat([3, 4], 0 as unknown as number);
    expect(r.distribution.length).toBe(5);
  });

  it('liste vide → avg 0 / count 0 / distribution zeroed', () => {
    const result = computeCsat([], 5);
    expect(result).toEqual({ avg: 0, count: 0, distribution: [0, 0, 0, 0, 0] });
  });
});

describe('computeCes', () => {
  it('default scale 7 (convention CEB)', () => {
    const result = computeCes([7, 6, 5, 4, 3, 2, 1]);
    expect(result.count).toBe(7);
    expect(result.distribution.length).toBe(7);
    expect(result.avg).toBe(4);
  });
});

describe('validateAnswer', () => {
  it('text valide → ok+trim', () => {
    const q = { id: 'q', type: 'text' as const };
    const r = validateAnswer(q, '  hello  ');
    expect(r).toEqual({ ok: true, value: 'hello' });
  });

  it('text trop long → TOO_LONG', () => {
    const q = { id: 'q', type: 'text' as const };
    const r = validateAnswer(q, 'x'.repeat(2001));
    expect(r).toEqual({ ok: false, error: SURVEY_ERROR_CODES.TOO_LONG });
  });

  it('multiple_choice valide → ok', () => {
    const q = {
      id: 'q',
      type: 'multiple_choice' as const,
      options_json: '["A","B","C"]',
    };
    expect(validateAnswer(q, 'B')).toEqual({ ok: true, value: 'B' });
  });

  it('multiple_choice option fantôme → INVALID_OPTION', () => {
    const q = {
      id: 'q',
      type: 'multiple_choice' as const,
      options_json: '["A","B","C"]',
    };
    const r = validateAnswer(q, 'Z');
    expect(r).toEqual({ ok: false, error: SURVEY_ERROR_CODES.INVALID_OPTION });
  });

  it('multiple_choice multi-select array ⊂ options → ok', () => {
    const q = {
      id: 'q',
      type: 'multiple_choice' as const,
      options_json: '["A","B","C"]',
    };
    expect(validateAnswer(q, ['A', 'C'])).toEqual({
      ok: true,
      value: ['A', 'C'],
    });
  });

  it('nps 0-10 valide → ok, 11 → OUT_OF_RANGE', () => {
    const q = { id: 'q', type: 'nps' as const };
    expect(validateAnswer(q, 9)).toEqual({ ok: true, value: 9 });
    expect(validateAnswer(q, 11)).toEqual({
      ok: false,
      error: SURVEY_ERROR_CODES.OUT_OF_RANGE,
    });
    expect(validateAnswer(q, -1)).toEqual({
      ok: false,
      error: SURVEY_ERROR_CODES.OUT_OF_RANGE,
    });
  });

  it('rating hors range → OUT_OF_RANGE', () => {
    const q = {
      id: 'q',
      type: 'rating' as const,
      options_json: '{"min":1,"max":5}',
    };
    expect(validateAnswer(q, 6)).toEqual({
      ok: false,
      error: SURVEY_ERROR_CODES.OUT_OF_RANGE,
    });
    expect(validateAnswer(q, 3)).toEqual({ ok: true, value: 3 });
  });

  it('date invalide → INVALID_DATE', () => {
    const q = { id: 'q', type: 'date' as const };
    expect(validateAnswer(q, 'not-a-date')).toEqual({
      ok: false,
      error: SURVEY_ERROR_CODES.INVALID_DATE,
    });
    expect(validateAnswer(q, '2026-01-15')).toEqual({
      ok: true,
      value: '2026-01-15',
    });
  });

  it('required + null → REQUIRED', () => {
    const q = { id: 'q', type: 'text' as const, required: 1 };
    expect(validateAnswer(q, null)).toEqual({
      ok: false,
      error: SURVEY_ERROR_CODES.REQUIRED,
    });
    expect(validateAnswer(q, '')).toEqual({
      ok: false,
      error: SURVEY_ERROR_CODES.REQUIRED,
    });
  });

  it('non-required + null → ok value null', () => {
    const q = { id: 'q', type: 'text' as const, required: 0 };
    expect(validateAnswer(q, null)).toEqual({ ok: true, value: null });
  });

  it('question inconnue → UNKNOWN_QUESTION', () => {
    expect(validateAnswer(null as any, 'x')).toEqual({
      ok: false,
      error: SURVEY_ERROR_CODES.UNKNOWN_QUESTION,
    });
  });

  it('type inconnu → INVALID_TYPE', () => {
    const q = { id: 'q', type: 'bogus' };
    expect(validateAnswer(q, 'x')).toEqual({
      ok: false,
      error: SURVEY_ERROR_CODES.INVALID_TYPE,
    });
  });
});

describe('getNextQuestionId — branching evaluator (pure)', () => {
  const questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];

  it('condition match → next_question_id', () => {
    const branches = [
      {
        question_id: 'q1',
        condition_value: 'yes',
        next_question_id: 'q3',
        jump_to_end: 0,
      },
    ];
    expect(getNextQuestionId('q1', 'yes', questions, branches)).toBe('q3');
  });

  it('condition not met → fallback question suivante par ordre', () => {
    const branches = [
      {
        question_id: 'q1',
        condition_value: 'yes',
        next_question_id: 'q3',
        jump_to_end: 0,
      },
    ];
    expect(getNextQuestionId('q1', 'no', questions, branches)).toBe('q2');
  });

  it('jump_to_end=1 → null', () => {
    const branches = [
      {
        question_id: 'q1',
        condition_value: 'stop',
        next_question_id: null,
        jump_to_end: 1,
      },
    ];
    expect(getNextQuestionId('q1', 'stop', questions, branches)).toBeNull();
  });

  it('dernière question sans match → null', () => {
    expect(getNextQuestionId('q3', 'x', questions, [])).toBeNull();
  });
});

describe('isWithinSurveyWindow', () => {
  it('is_published=0 → false', () => {
    expect(isWithinSurveyWindow({ is_published: 0 })).toBe(false);
  });

  it('publié sans bornes → true', () => {
    expect(isWithinSurveyWindow({ is_published: 1 })).toBe(true);
  });

  it('publié avant opens_at futur → false', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(isWithinSurveyWindow({ is_published: 1, opens_at: future })).toBe(false);
  });

  it('publié après closes_at passé → false (expired, lecture seule)', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(isWithinSurveyWindow({ is_published: 1, closes_at: past })).toBe(false);
  });
});

describe('hashRespondentIp', () => {
  it('même (ip, salt) → même hash (anti-double-submission anonyme)', async () => {
    const a = await hashRespondentIp('1.2.3.4', 'salt1');
    const b = await hashRespondentIp('1.2.3.4', 'salt1');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('salts distincts → hashes distincts', async () => {
    const a = await hashRespondentIp('1.2.3.4', 'salt1');
    const b = await hashRespondentIp('1.2.3.4', 'salt2');
    expect(a).not.toBe(b);
  });

  it('ip vide / null → "" (best-effort)', async () => {
    expect(await hashRespondentIp('', 'salt')).toBe('');
    expect(await hashRespondentIp(null, 'salt')).toBe('');
  });

  it('ne retourne JAMAIS l\'IP brute (Loi 25)', async () => {
    const h = await hashRespondentIp('192.168.1.1', 'salt');
    expect(h).not.toContain('192.168');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('aggregateResponses (par question)', () => {
  it('compte par question + NPS/CSAT globaux', () => {
    const questions = [
      { id: 'q_nps', type: 'nps' as const },
      { id: 'q_text', type: 'text' as const },
      { id: 'q_csat', type: 'csat' as const },
    ];
    const answers = [
      { question_id: 'q_nps', answer_value: 10 },
      { question_id: 'q_nps', answer_value: 9 },
      { question_id: 'q_nps', answer_value: 3 },
      { question_id: 'q_text', answer_text: 'Bien' },
      { question_id: 'q_text', answer_text: 'Bien' },
      { question_id: 'q_text', answer_text: 'Excellent' },
      { question_id: 'q_csat', answer_value: 5 },
      { question_id: 'q_csat', answer_value: 4 },
      { question_id: 'q_unknown', answer_text: 'ignored' }, // question fantôme
    ];
    const agg = aggregateResponses(questions, answers);
    expect(agg.by_question.length).toBe(3);
    const nps = agg.by_question.find((q) => q.question_id === 'q_nps')!;
    expect(nps.total).toBe(3);
    expect(nps.numeric.min).toBe(3);
    expect(nps.numeric.max).toBe(10);
    const text = agg.by_question.find((q) => q.question_id === 'q_text')!;
    expect(text.text_counts).toEqual({ Bien: 2, Excellent: 1 });
    expect(agg.nps).toBeDefined();
    expect(agg.nps?.total).toBe(3);
    expect(agg.nps?.score).toBe(33); // (2 promoters - 1 detractor)/3*100
    expect(agg.csat).toBeDefined();
    expect(agg.csat?.avg).toBe(4.5);
  });

  it('aucune réponse → by_question vide pour chaque question (total 0)', () => {
    const agg = aggregateResponses(
      [{ id: 'q1', type: 'text' as const }],
      [],
    );
    expect(agg.by_question[0].total).toBe(0);
    expect(agg.nps).toBeUndefined();
    expect(agg.csat).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DNS ENGINE — 3 cas
// ════════════════════════════════════════════════════════════════════════════

describe('verifyDomainOwnership — TXT token mismatch (Phase A stub)', () => {
  it('Phase A stub → { verified: false, reason: "phase-a-stub" }', async () => {
    // ⚠ vi.mock override dns-engine — on récupère le mock direct (qui clone
    // l'actual + override verifyDomainOwnership). Pour ce test on appelle
    // l'ACTUAL stub via dynamic import, pas le mock.
    vi.resetModules();
    vi.doUnmock('../lib/dns-engine');
    const actual = await import('../lib/dns-engine');

    const env = {} as Env;
    const result = await actual.verifyDomainOwnership(env, 'example.com', 'token_wrong');

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('phase-a-stub');

    // Restaure le mock pour les tests suivants.
    vi.resetModules();
  });
});

describe('provisionCloudflareForSaas — flag INACTIF V1', () => {
  it('pas de CLOUDFLARE_API_TOKEN → { zone_id: null, ssl_status: "pending" }', async () => {
    vi.resetModules();
    vi.doUnmock('../lib/dns-engine');
    const actual = await import('../lib/dns-engine');

    const env = {} as Env; // pas de CLOUDFLARE_API_TOKEN
    const result = await actual.provisionCloudflareForSaas(env, 'example.com');

    expect(result.zone_id).toBeNull();
    expect(result.ssl_status).toBe('pending');

    vi.resetModules();
  });
});

describe('syncDnsRecords — flag INACTIF V1', () => {
  it('pas de CLOUDFLARE_API_TOKEN → { synced: 0 } sans error/throw', async () => {
    vi.resetModules();
    vi.doUnmock('../lib/dns-engine');
    const actual = await import('../lib/dns-engine');

    const env = {} as Env;
    const result = await actual.syncDnsRecords(env, 'domain_1');

    expect(result.synced).toBe(0);
    // reason présent (debug) mais best-effort — pas de throw.
    expect(typeof result.reason === 'string' || result.reason === undefined).toBe(true);

    vi.resetModules();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SURVEYS HANDLERS — 3 cas
// ════════════════════════════════════════════════════════════════════════════

describe('handleCreateSurvey', () => {
  it('INSERT surveys + 201 avec id/title/type', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth();

    const req = new Request('https://app/api/surveys', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Mon survey NPS',
        description: 'Description test',
        type: 'nps',
      }),
    });

    const res = await handleCreateSurvey(req, env, auth);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data).toBeDefined();
    expect(body.data.title).toBe('Mon survey NPS');
    expect(body.data.type).toBe('nps');
    expect(typeof body.data.id).toBe('string');
    expect(body.data.id.length).toBeGreaterThan(0);

    // INSERT INTO surveys appelé avec les bons bindings.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into surveys'),
    );
    expect(insert).toBeDefined();
    // bind order : id, client_id, title, description, type, target_audience_json
    expect(insert?.args[1]).toBe('cli_A'); // client_id depuis auth
    expect(insert?.args[2]).toBe('Mon survey NPS');
    expect(insert?.args[3]).toBe('Description test');
    expect(insert?.args[4]).toBe('nps');
  });

  it('title manquant → 400', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth();

    const req = new Request('https://app/api/surveys', {
      method: 'POST',
      body: JSON.stringify({ type: 'standard' }),
    });

    const res = await handleCreateSurvey(req, env, auth);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/titre/i);
  });
});

describe('handlePublicSubmitSurvey', () => {
  it('rate-limit OK + honeypot vide + survey publié → INSERT response + answers + 200', async () => {
    const db = createMockD1();
    // Survey existe + publié.
    db.seed('from surveys where id', [
      { client_id: 'cli_A', is_published: 1 },
    ]);
    const env = makeEnv(db);

    const req = new Request('https://app/api/public/surveys/srv_1/submit', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
      body: JSON.stringify({
        respondent_email: 'visitor@test.com',
        respondent_name: 'Visiteur',
        answers: [
          { question_id: 'q_1', answer_text: 'Très satisfait' },
          { question_id: 'q_2', answer_value: 9 },
        ],
        partial: false,
        website: '', // honeypot vide
      }),
    });

    const res = await handlePublicSubmitSurvey(req, env, 'srv_1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('completed');
    expect(typeof body.data.id).toBe('string');

    // INSERT survey_responses appelé (ip_hash, pas ip brute).
    const insertResp = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into survey_responses'),
    );
    expect(insertResp).toBeDefined();
    // bind order : id, survey_id, client_id, respondent_email, respondent_name, ip_hash, status
    expect(insertResp?.args[1]).toBe('srv_1');
    expect(insertResp?.args[2]).toBe('cli_A');
    expect(insertResp?.args[3]).toBe('visitor@test.com');
    // ip_hash = SHA256 hex (64 chars), PAS l'IP brute.
    const ipHash = insertResp?.args[5];
    expect(typeof ipHash).toBe('string');
    expect(ipHash).not.toBe('1.2.3.4');
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);

    // INSERT survey_response_answers (2 answers).
    const insertAnswers = db.calls.filter((c) =>
      c.sql.toLowerCase().includes('insert into survey_response_answers'),
    );
    expect(insertAnswers.length).toBe(2);

    // UPDATE status='completed' (partial=false).
    const updateFinalize = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update survey_responses') &&
        c.sql.toLowerCase().includes("status = 'completed'"),
    );
    expect(updateFinalize).toBeDefined();

    // Rate-limit appelé avec bucket survey_submit:<ip_hash>.
    const { checkRateLimit } = await import('../lib/rate-limit');
    expect(vi.mocked(checkRateLimit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^survey_submit:[0-9a-f]{64}$/),
      10,
      3600,
    );
  });

  it('honeypot rempli → fake-success 200 (anti-bot, ne révèle pas la détection)', async () => {
    const db = createMockD1();
    const env = makeEnv(db);

    const req = new Request('https://app/api/public/surveys/srv_1/submit', {
      method: 'POST',
      body: JSON.stringify({
        website: 'http://spam.com', // honeypot REMPLI = bot
        answers: [{ question_id: 'q_1', answer_text: 'spam' }],
      }),
    });

    const res = await handlePublicSubmitSurvey(req, env, 'srv_1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.id).toBe('bot');
    expect(body.data.status).toBe('completed');

    // Aucun INSERT survey_responses (bot court-circuité).
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into survey_responses'),
    );
    expect(insert).toBeUndefined();
  });
});

describe('handleGetNpsAggregate', () => {
  it('aucun agrégat en DB → fallback aggregateNpsForPeriod → 200 avec data computed', async () => {
    const db = createMockD1();
    // Survey existe (loadSurveyInTenant), legacy donc pas de borne tenant.
    db.seed('select * from surveys where id', [
      { id: 'srv_1', client_id: 'cli_A' },
    ]);
    // Pas de seed pour nps_aggregates → .first() retourne null → fallback compute.
    const env = makeEnv(db);
    const auth = makeAuth();
    const url = new URL('https://app/api/surveys/srv_1/nps?period_days=60');

    const res = await handleGetNpsAggregate(env, auth, 'srv_1', url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toBeDefined();
    // computed via aggregateNpsForPeriod (stub Phase A → agrégat vide).
    expect(body.data.survey_id).toBe('srv_1');
    expect(body.data.period_days).toBe(60);
    expect(body.data.nps_score).toBe(0);

    // SELECT nps_aggregates avec period_days=60.
    const selectAgg = db.calls.find((c) =>
      c.sql.toLowerCase().includes('from nps_aggregates'),
    );
    expect(selectAgg).toBeDefined();
    expect(selectAgg?.args).toEqual(['srv_1', 60]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SURVEYS WIRE-UP Sprint 51 — 5 cas additifs (engine helpers câblés handler)
// ════════════════════════════════════════════════════════════════════════════

describe('handlePublicSubmitSurvey — wire-up validateAnswer (Sprint 51)', () => {
  it('invalid scale (>10 sur nps) → 400 SURVEY_INVALID_ANSWER', async () => {
    const db = createMockD1();
    // Survey publié dans la fenêtre.
    db.seed('from surveys where id', [
      {
        client_id: 'cli_A',
        is_published: 1,
        opens_at: null,
        closes_at: null,
        published_at: null,
      },
    ]);
    // Question NPS chargée pour validateAnswer (SELECT ... FROM survey_questions WHERE id IN).
    db.seed('from survey_questions where id in', [
      { id: 'q_nps', type: 'nps', required: 1, options_json: null },
    ]);
    const env = makeEnv(db);

    const req = new Request('https://app/api/public/surveys/srv_1/submit', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
      body: JSON.stringify({
        answers: [{ question_id: 'q_nps', answer_value: 99 }], // > 10 → invalid
        partial: false,
        website: '',
      }),
    });

    const res = await handlePublicSubmitSurvey(req, env, 'srv_1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe(SURVEY_ERROR_CODES.SURVEY_INVALID_ANSWER);
    expect(body.field).toBe('q_nps');

    // Aucun INSERT survey_responses (validation court-circuite).
    const insertResp = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into survey_responses'),
    );
    expect(insertResp).toBeUndefined();
  });
});

describe('handlePublicSubmitSurvey — wire-up isWithinSurveyWindow (Sprint 51)', () => {
  it('survey closed (closes_at passé) → 403 SURVEY_CLOSED', async () => {
    const db = createMockD1();
    const past = new Date(Date.now() - 86400000).toISOString();
    db.seed('from surveys where id', [
      {
        client_id: 'cli_A',
        is_published: 1,
        opens_at: null,
        closes_at: past, // expired
        published_at: null,
      },
    ]);
    const env = makeEnv(db);

    const req = new Request('https://app/api/public/surveys/srv_closed/submit', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '5.6.7.8' },
      body: JSON.stringify({
        answers: [{ question_id: 'q_1', answer_text: 'too late' }],
        partial: false,
        website: '',
      }),
    });

    const res = await handlePublicSubmitSurvey(req, env, 'srv_closed');
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.code).toBe(SURVEY_ERROR_CODES.SURVEY_CLOSED);

    // Aucun INSERT survey_responses.
    const insertResp = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into survey_responses'),
    );
    expect(insertResp).toBeUndefined();
  });
});

describe('handlePublicSubmitSurvey — wire-up anti-double-submit (Sprint 51)', () => {
  it('même IP hash existe déjà → 409 DUPLICATE_RESPONSE', async () => {
    const db = createMockD1();
    db.seed('from surveys where id', [
      {
        client_id: 'cli_A',
        is_published: 1,
        opens_at: null,
        closes_at: null,
        published_at: null,
      },
    ]);
    // Réponse existante pour ce même IP hash.
    db.seed('from survey_responses where survey_id = ? and ip_hash', [
      { id: 'existing_resp' },
    ]);
    const env = makeEnv(db);

    const req = new Request('https://app/api/public/surveys/srv_1/submit', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '9.9.9.9' },
      body: JSON.stringify({
        answers: [{ question_id: 'q_1', answer_text: 'second try' }],
        partial: false,
        website: '',
      }),
    });

    const res = await handlePublicSubmitSurvey(req, env, 'srv_1');
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.code).toBe(SURVEY_ERROR_CODES.DUPLICATE_RESPONSE);

    // Le SELECT anti-dup a été appelé avec (survey_id, ip_hash) — pas customer_id.
    const dupSelect = db.calls.find((c) =>
      c.sql
        .toLowerCase()
        .includes('from survey_responses where survey_id = ? and ip_hash'),
    );
    expect(dupSelect).toBeDefined();
    expect(dupSelect?.args[0]).toBe('srv_1');
    // args[1] doit être l'ip_hash (64 hex chars, pas l'IP brute).
    expect(dupSelect?.args[1]).toMatch(/^[0-9a-f]{64}$/);

    // Aucun INSERT survey_responses (court-circuit).
    const insertResp = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into survey_responses'),
    );
    expect(insertResp).toBeUndefined();
  });
});

describe('handleGetSurveyAnalytics — wire-up aggregateResponses (Sprint 51)', () => {
  it('NPS aggregate correct via engine helper', async () => {
    const db = createMockD1();
    db.seed('select * from surveys where id', [
      { id: 'srv_1', client_id: 'cli_A' },
    ]);
    db.seed('from survey_questions where survey_id', [
      { id: 'q_nps', type: 'nps', required: 1, options_json: null },
      { id: 'q_text', type: 'text', required: 0, options_json: null },
    ]);
    db.seed('from survey_response_answers sra', [
      { question_id: 'q_nps', answer_text: null, answer_value: 10 }, // promoter
      { question_id: 'q_nps', answer_text: null, answer_value: 9 }, // promoter
      { question_id: 'q_nps', answer_text: null, answer_value: 4 }, // detractor
      { question_id: 'q_text', answer_text: 'Bien', answer_value: null },
    ]);
    const env = makeEnv(db);
    const auth = makeAuth();

    const res = await handleGetSurveyAnalytics(env, auth, 'srv_1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toBeDefined();
    expect(body.data.by_question).toBeDefined();
    expect(Array.isArray(body.data.by_question)).toBe(true);
    expect(body.data.nps).toBeDefined();
    expect(body.data.nps.total).toBe(3);
    expect(body.data.nps.promoters).toBe(2);
    expect(body.data.nps.detractors).toBe(1);
    // NPS = (2 - 1) / 3 * 100 = 33.33 → 33
    expect(body.data.nps.score).toBe(33);
  });
});

describe('handleGetNextQuestion — wire-up branching jump_to_end (Sprint 51)', () => {
  it('jump_to_end=1 sur branche → { next_question_id: null, jump_to_end: true }', async () => {
    const db = createMockD1();
    db.seed('select * from surveys where id', [
      { id: 'srv_1', client_id: 'cli_A' },
    ]);
    // resolveNextQuestion → matche branche jump_to_end=1 → next_question_id null.
    db.seed('from survey_branches where question_id = ?', [
      { next_question_id: null, jump_to_end: 1 },
    ]);
    const env = makeEnv(db);
    const auth = makeAuth();
    const url = new URL(
      'https://app/api/surveys/srv_1/next-question?current=q_1&answer=stop',
    );

    const res = await handleGetNextQuestion(env, auth, 'srv_1', url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.next_question_id).toBeNull();
    expect(body.data.jump_to_end).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DNS HANDLERS — 3 cas
// ════════════════════════════════════════════════════════════════════════════

describe('handleAddCustomDomain', () => {
  it('INSERT custom_domains + génère verification_token + 201', async () => {
    const db = createMockD1();
    // Pas de collision préalable (SELECT id FROM custom_domains WHERE domain → null).
    const env = makeEnv(db);
    const auth = makeAuth();

    const req = new Request('https://app/api/custom-domains', {
      method: 'POST',
      body: JSON.stringify({ domain: 'EXAMPLE.com.' }), // testé normalizeDomain
    });

    const res = await handleAddCustomDomain(req, env, auth);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data).toBeDefined();
    expect(body.data.domain).toBe('example.com'); // normalisé
    expect(body.data.status).toBe('pending');
    expect(body.data.ssl_status).toBe('pending');
    expect(body.data.cloudflare_zone_id).toBeNull();
    // verification_token = hex 32 chars (UUID v4 sans tirets).
    expect(typeof body.data.verification_token).toBe('string');
    expect(body.data.verification_token).toMatch(/^[0-9a-f]{32}$/);

    // INSERT INTO custom_domains avec les bons bindings.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into custom_domains'),
    );
    expect(insert).toBeDefined();
    // bind order : id, client_id, domain, status, cloudflare_zone_id, verification_token, ssl_status
    expect(insert?.args[1]).toBe('cli_A');
    expect(insert?.args[2]).toBe('example.com');
    expect(insert?.args[3]).toBe('pending');
    expect(insert?.args[4]).toBeNull(); // zone_id null (flag INACTIF)
    expect(insert?.args[6]).toBe('pending');

    // provisionCloudflareForSaas appelé (mock).
    expect(vi.mocked(provisionCloudflareForSaas)).toHaveBeenCalledWith(
      expect.anything(),
      'example.com',
    );
  });

  it('domaine invalide → 400', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth();

    const req = new Request('https://app/api/custom-domains', {
      method: 'POST',
      body: JSON.stringify({ domain: 'not_a_domain' }),
    });

    const res = await handleAddCustomDomain(req, env, auth);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/invalide/i);
  });
});

describe('handleVerifyDomain', () => {
  it('verifyDomainOwnership stub returns verified=false → status reste pending', async () => {
    const db = createMockD1();
    // Domaine existe (loadDomainInTenant), legacy.
    db.seed('select * from custom_domains where id', [
      {
        id: 'dom_1',
        client_id: 'cli_A',
        domain: 'example.com',
        verification_token: 'tok_abc123',
        status: 'pending',
      },
    ]);
    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/custom-domains/dom_1/verify', {
      method: 'POST',
    });

    const res = await handleVerifyDomain(req, env, auth, 'dom_1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.verified).toBe(false);
    expect(body.data.status).toBe('pending');

    // verifyDomainOwnership appelé avec domain + token corrects.
    expect(vi.mocked(verifyDomainOwnership)).toHaveBeenCalledWith(
      expect.anything(),
      'example.com',
      'tok_abc123',
    );

    // PAS d'UPDATE status='verified' (verified=false).
    const updateVerified = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update custom_domains') &&
        c.sql.toLowerCase().includes("status = 'verified'"),
    );
    expect(updateVerified).toBeUndefined();
  });

  it('verifyDomainOwnership returns verified=true → UPDATE status=verified', async () => {
    // Override le mock pour ce test : verified=true.
    vi.mocked(verifyDomainOwnership).mockResolvedValueOnce({
      verified: true,
    });

    const db = createMockD1();
    db.seed('select * from custom_domains where id', [
      {
        id: 'dom_2',
        client_id: 'cli_A',
        domain: 'verified.com',
        verification_token: 'tok_ok',
        status: 'pending',
      },
    ]);
    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/custom-domains/dom_2/verify', {
      method: 'POST',
    });

    const res = await handleVerifyDomain(req, env, auth, 'dom_2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.verified).toBe(true);
    expect(body.data.status).toBe('verified');

    // UPDATE status='verified' + verified_at=now appelé.
    const updateVerified = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update custom_domains') &&
        c.sql.toLowerCase().includes("status = 'verified'") &&
        c.sql.toLowerCase().includes('verified_at'),
    );
    expect(updateVerified).toBeDefined();
    expect(updateVerified?.args).toEqual(['dom_2']);
  });
});

describe('Cap check — settings.manage absent en mode agence', () => {
  it('handleAddCustomDomain en mode tenant agence sans cap → 403', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    // Mode tenant agence (agencyId != null) + capabilities sans settings.manage.
    const auth = makeAuth({
      capabilities: new Set(['leads.read']),
      tenant: {
        userId: 'u_1',
        role: 'viewer',
        clientId: 'cli_A',
        agencyId: 'agency_1', // ⚠ critique : active la guard
        accountLevel: 'sub',
        accessibleClientIds: ['cli_A'],
      },
    });

    const req = new Request('https://app/api/custom-domains', {
      method: 'POST',
      body: JSON.stringify({ domain: 'example.com' }),
    });

    const res = await handleAddCustomDomain(req, env, auth);
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/refus/i);

    // Aucun INSERT (cap court-circuite avant DB).
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into custom_domains'),
    );
    expect(insert).toBeUndefined();
  });

  it('handleCreateSurvey en mode tenant agence sans cap → 403', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth({
      capabilities: new Set(['leads.read']),
      tenant: {
        userId: 'u_1',
        role: 'viewer',
        clientId: 'cli_A',
        agencyId: 'agency_1',
        accountLevel: 'sub',
        accessibleClientIds: ['cli_A'],
      },
    });

    const req = new Request('https://app/api/surveys', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', type: 'nps' }),
    });

    const res = await handleCreateSurvey(req, env, auth);
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/refus/i);

    // Aucun INSERT.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into surveys'),
    );
    expect(insert).toBeUndefined();
  });
});
