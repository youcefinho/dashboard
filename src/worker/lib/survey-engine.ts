// ── Sprint 50 — survey-engine.ts — Engine surveys (branching + NPS/CSAT) ────
//
// Helpers PURE/HANDLER pour surveys.ts Sprint 50. Module surveys avancés —
// questionnaires multi-pages avec branching logic conditionnel, NPS scores
// (-100..+100), CSAT (Customer Satisfaction), CES (Customer Effort Score).
// DISTINCT du module Forms (S5, seq106) qui est single-step capture lead.
//
// Helpers Phase A (signatures FIGÉES — calque pricing-engine/affiliate-engine,
// PAS de throw, best-effort total) :
//   - resolveNextQuestion(env, qid, answer)         async D1 — branching SQL
//   - computeNpsScore(promoters, passives, detractors)  pure — score [-100..+100]
//   - aggregateNpsForPeriod(env, surveyId, periodDays) async D1 — agrégat fenêtre
//
// Helpers Phase B RENFORCEMENT (Sprint 51 — additif, signatures NEUVES) :
//   - classifyNps(value)                            pure — promoter|passive|detractor
//   - computeNpsFromAnswers(answers)                pure — { score, breakdown }
//   - computeCsat(values, scaleMax)                 pure — { avg, count, distribution }
//   - computeCes(values, scaleMax)                  pure — { avg, count, distribution }
//   - validateAnswer(question, answer)              pure — discriminated by type
//   - getNextQuestionId(currentQid, answer, qs, br) pure — branching evaluator
//   - isWithinSurveyWindow(survey)                  pure — opens_at/closes_at
//   - hashRespondentIp(ip, salt)                    async — SHA256 hex anti-spoof
//   - aggregateResponses(survey, answers)           pure — par question
//
// Contrats GELÉS (docs/LOT-SURVEYS-DNS-S50.md §6) :
//   - imports RELATIFS uniquement (`../types`)
//   - PAS de throw — best-effort, dégradation gracieuse (calque pricing-engine /
//     affiliate-engine)
//   - PAS d'appel réseau externe (Resend Phase B suivante)
//   - Multi-tenant strict — appels en aval bornent client_id côté HANDLER
//
// ⚠ NE TOUCHE PAS aux helpers forms.ts existants — surveys et forms vivent
//   côte à côte (modèles distincts S5 seq106 vs S50 seq145).

import type { Env } from '../types';

// ── Types internes (alignés api.ts client) ────────────────────────────────

/** Type de survey — détermine le rendu UI et l'agrégation. */
export type SurveyType = 'standard' | 'nps' | 'csat' | 'custom';

/** Type de question — détermine le widget de saisie et le typage answer. */
export type QuestionType =
  | 'text'
  | 'multiple_choice'
  | 'rating'
  | 'nps'
  | 'csat'
  | 'date';

/** Statut d'une session de réponse. */
export type ResponseStatus = 'in_progress' | 'completed' | 'abandoned';

/** Whitelists validation HANDLER — PAS de CHECK SQL (calque affiliate-engine). */
export const SURVEY_TYPES = ['standard', 'nps', 'csat', 'custom'] as const;
export const QUESTION_TYPES = [
  'text',
  'multiple_choice',
  'rating',
  'nps',
  'csat',
  'date',
] as const;
export const RESPONSE_STATUSES = [
  'in_progress',
  'completed',
  'abandoned',
] as const;

/** Codes erreur STABLES validateAnswer (calque pricing-engine). */
export const SURVEY_ERROR_CODES = {
  INVALID_TYPE: 'INVALID_TYPE',
  REQUIRED: 'REQUIRED',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  TOO_LONG: 'TOO_LONG',
  INVALID_OPTION: 'INVALID_OPTION',
  INVALID_DATE: 'INVALID_DATE',
  UNKNOWN_QUESTION: 'UNKNOWN_QUESTION',
  // ── Sprint 51 — codes wire-up handler (additif, calque affiliate-engine) ──
  SURVEY_INVALID_ANSWER: 'SURVEY_INVALID_ANSWER',
  SURVEY_CLOSED: 'SURVEY_CLOSED',
  DUPLICATE_RESPONSE: 'DUPLICATE_RESPONSE',
} as const;

/** Résultat de resolveNextQuestion() — où aller après la question courante. */
export interface NextQuestionResult {
  /** ID de la prochaine question, ou null si fin/aucun match. */
  nextId: string | null;
  /** true ⇒ terminer le survey (branche `jump_to_end=1`). */
  jumpToEnd: boolean;
}

/** Résultat d'aggregateNpsForPeriod() — agrégats NPS de la fenêtre. */
export interface NpsAggregateResult {
  client_id: string;
  survey_id: string;
  period_days: number;
  promoters_count: number;
  passives_count: number;
  detractors_count: number;
  total_responses: number;
  /** Score NPS ∈ [-100..+100]. */
  nps_score: number;
  /** Timestamp ISO du calcul. */
  calculated_at: string;
}

/** Classification d'un score NPS (0-10 — Bain & Co convention). */
export type NpsBucket = 'promoter' | 'passive' | 'detractor' | 'invalid';

/** Résultat validateAnswer (discriminated union). */
export type ValidateAnswerResult =
  | { ok: true; value: string | number | string[] | null }
  | { ok: false; error: string };

/** Question minimal — utilisée par validateAnswer/getNextQuestionId (pure). */
export interface QuestionLike {
  id: string;
  type?: QuestionType | string;
  required?: number | boolean;
  options_json?: string | null;
  /** Présent seulement si déjà parsé côté handler. */
  options?: unknown;
}

/** Branche minimale — utilisée par getNextQuestionId (pure). */
export interface BranchLike {
  question_id: string;
  condition_value: string | null;
  next_question_id: string | null;
  jump_to_end?: number | boolean;
}

/** Window survey — utilisée par isWithinSurveyWindow (pure). */
export interface SurveyWindowLike {
  is_published?: number | boolean | null;
  opens_at?: string | null;
  closes_at?: string | null;
  published_at?: string | null;
}

/** Distribution agrégée par question. */
export interface AggregatedQuestion {
  question_id: string;
  type: string;
  total: number;
  /** Pour multiple_choice/text — comptage par valeur textuelle. */
  text_counts?: Record<string, number>;
  /** Pour rating/nps/csat — distribution numérique. */
  numeric: {
    avg: number;
    min: number | null;
    max: number | null;
    distribution: Record<string, number>;
  };
}

// ── 1) resolveNextQuestion (async D1, best-effort) — SIGNATURE FIGÉE ──────
/**
 * Résout la branche conditionnelle d'une question Sprint 50.
 *
 * Phase A : retourne stub { null, false } — laisse l'appelant choisir l'ordre.
 * Phase B (ce module) : passe par `getNextQuestionId()` quand un env.DB est
 * disponible, sinon dégrade en stub. PAS d'IO si env.DB absent.
 */
export async function resolveNextQuestion(
  env: Env,
  questionId: string,
  answer: string,
): Promise<NextQuestionResult> {
  // Best-effort : si pas de DB binding, on retombe sur le stub historique.
  if (!env || !env.DB || typeof env.DB.prepare !== 'function') {
    return { nextId: null, jumpToEnd: false };
  }
  try {
    const row = (await env.DB.prepare(
      'SELECT next_question_id, jump_to_end FROM survey_branches WHERE question_id = ? AND condition_value = ? ORDER BY rowid ASC LIMIT 1',
    )
      .bind(questionId, answer)
      .first()) as
      | { next_question_id: string | null; jump_to_end: number | null }
      | null;
    if (!row) return { nextId: null, jumpToEnd: false };
    const jump = Number(row.jump_to_end ?? 0) === 1;
    return {
      nextId: jump ? null : row.next_question_id ?? null,
      jumpToEnd: jump,
    };
  } catch {
    // Table absente / DB KO → dégradation gracieuse.
    return { nextId: null, jumpToEnd: false };
  }
}

// ── 2) computeNpsScore (pure, sync) — SIGNATURE FIGÉE ─────────────────────
/**
 * NPS ∈ [-100..+100] = round((promoteurs - détracteurs) / total * 100).
 * Total 0 ⇒ 0. Inputs négatifs ou non-finite ⇒ traités comme 0 (best-effort).
 */
export function computeNpsScore(
  promoters: number,
  passives: number,
  detractors: number,
): number {
  const p = sanitizeCount(promoters);
  const ps = sanitizeCount(passives);
  const d = sanitizeCount(detractors);
  const total = p + ps + d;
  if (total <= 0) return 0;
  const score = ((p - d) / total) * 100;
  // Bornage défensif [-100, 100] (déjà garanti algébriquement mais safety net).
  return Math.max(-100, Math.min(100, Math.round(score)));
}

// ── 3) aggregateNpsForPeriod (async D1, best-effort) — SIGNATURE FIGÉE ────
/**
 * Agrège réponses NPS sur la fenêtre [now - periodDays, now].
 *
 * Phase B : SELECT survey_response_answers JOIN survey_responses JOIN
 * survey_questions WHERE question.type='nps' AND response.completed_at IN
 * window. Best-effort : DB absente / tables absentes ⇒ agrégat zéro.
 */
export async function aggregateNpsForPeriod(
  env: Env,
  surveyId: string,
  periodDays: number,
): Promise<NpsAggregateResult> {
  const period = Number.isFinite(periodDays) && periodDays > 0
    ? Math.floor(periodDays)
    : 30;
  const empty: NpsAggregateResult = {
    client_id: '',
    survey_id: surveyId,
    period_days: period,
    promoters_count: 0,
    passives_count: 0,
    detractors_count: 0,
    total_responses: 0,
    nps_score: 0,
    calculated_at: new Date().toISOString(),
  };
  if (!env || !env.DB || typeof env.DB.prepare !== 'function') return empty;
  try {
    const { results } = await env.DB.prepare(
      `SELECT sra.answer_value, sr.client_id
         FROM survey_response_answers sra
         JOIN survey_responses sr ON sr.id = sra.response_id
         JOIN survey_questions sq ON sq.id = sra.question_id
        WHERE sr.survey_id = ?
          AND sq.type = 'nps'
          AND sr.status = 'completed'
          AND sr.completed_at >= datetime('now', ?)`,
    )
      .bind(surveyId, `-${period} days`)
      .all();
    const rows = (results || []) as Array<{
      answer_value: number | null;
      client_id: string | null;
    }>;
    if (rows.length === 0) return empty;
    const breakdown = computeNpsFromAnswers(
      rows.map((r) => (r.answer_value == null ? null : Number(r.answer_value))),
    );
    const clientId = rows.find((r) => r.client_id)?.client_id ?? '';
    return {
      client_id: clientId,
      survey_id: surveyId,
      period_days: period,
      promoters_count: breakdown.promoters,
      passives_count: breakdown.passives,
      detractors_count: breakdown.detractors,
      total_responses: breakdown.total,
      nps_score: breakdown.score,
      calculated_at: new Date().toISOString(),
    };
  } catch {
    return empty;
  }
}

// ── 4) classifyNps (pure) ──────────────────────────────────────────────────
/** Bain & Co : 9-10 promoter, 7-8 passive, 0-6 detractor. Sinon 'invalid'. */
export function classifyNps(value: unknown): NpsBucket {
  // Strict : null/undefined/'' ⇒ invalid (sinon Number(null)=0 = detractor faux+).
  if (value === null || value === undefined || value === '') return 'invalid';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'invalid';
  if (n < 0 || n > 10) return 'invalid';
  if (n >= 9) return 'promoter';
  if (n >= 7) return 'passive';
  return 'detractor';
}

// ── 5) computeNpsFromAnswers (pure) ────────────────────────────────────────
/**
 * Classe une liste de réponses NPS et retourne le breakdown + score.
 * Valeurs null/NaN/hors-range sont IGNORÉES (non comptées dans `total`).
 */
export function computeNpsFromAnswers(values: Array<number | null>): {
  score: number;
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
} {
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const v of values) {
    const bucket = classifyNps(v);
    if (bucket === 'promoter') promoters++;
    else if (bucket === 'passive') passives++;
    else if (bucket === 'detractor') detractors++;
  }
  const total = promoters + passives + detractors;
  const score = computeNpsScore(promoters, passives, detractors);
  return { score, promoters, passives, detractors, total };
}

// ── 6) computeCsat (pure) ──────────────────────────────────────────────────
/**
 * CSAT = moyenne arithmétique des scores, distribution 1..scaleMax.
 * Hors-range/NaN ignorés. scaleMax invalide ⇒ default 5.
 */
export function computeCsat(
  values: Array<number | null>,
  scaleMax = 5,
): { avg: number; count: number; distribution: number[] } {
  const max =
    Number.isFinite(scaleMax) && scaleMax >= 2 && scaleMax <= 10
      ? Math.floor(scaleMax)
      : 5;
  const distribution: number[] = new Array(max).fill(0);
  let sum = 0;
  let count = 0;
  for (const v of values) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const i = Math.floor(n);
    if (i < 1 || i > max) continue;
    const idx = i - 1;
    distribution[idx] = (distribution[idx] ?? 0) + 1;
    sum += i;
    count++;
  }
  const avg = count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
  return { avg, count, distribution };
}

// ── 7) computeCes (pure) ───────────────────────────────────────────────────
/**
 * CES (Customer Effort Score) = moyenne sur échelle 1..7 (convention CEB).
 * Calcul identique à CSAT mais scale default 7.
 */
export function computeCes(
  values: Array<number | null>,
  scaleMax = 7,
): { avg: number; count: number; distribution: number[] } {
  return computeCsat(values, scaleMax);
}

// ── 8) validateAnswer (pure, discriminated) ────────────────────────────────
/**
 * Valide+normalise une réponse selon question.type. Retourne :
 *   - { ok: true, value }   ⇒ valeur normalisée (string/number/null)
 *   - { ok: false, error }  ⇒ code STABLE de SURVEY_ERROR_CODES
 *
 * Convention :
 *   - text          → trim + max 2000 chars (TOO_LONG sinon)
 *   - multiple_choice → answer ∈ options (INVALID_OPTION sinon)
 *   - rating/csat   → entier ∈ [1, max] (OUT_OF_RANGE sinon)
 *   - nps           → entier ∈ [0, 10] (OUT_OF_RANGE sinon)
 *   - date          → ISO YYYY-MM-DD parsable (INVALID_DATE sinon)
 *
 * Required + answer nullish ⇒ REQUIRED.
 * Type inconnu ⇒ INVALID_TYPE.
 */
export function validateAnswer(
  question: QuestionLike | null | undefined,
  answer: unknown,
): ValidateAnswerResult {
  if (!question || typeof question !== 'object') {
    return { ok: false, error: SURVEY_ERROR_CODES.UNKNOWN_QUESTION };
  }
  const required =
    question.required === 1 || question.required === true ? true : false;
  const type = (question.type ?? 'text') as string;
  const isNullish =
    answer === null || answer === undefined || answer === '';
  if (isNullish) {
    if (required) return { ok: false, error: SURVEY_ERROR_CODES.REQUIRED };
    return { ok: true, value: null };
  }
  if (!QUESTION_TYPES.includes(type as (typeof QUESTION_TYPES)[number])) {
    return { ok: false, error: SURVEY_ERROR_CODES.INVALID_TYPE };
  }

  const opts = parseOptions(question);

  switch (type) {
    case 'text': {
      const raw = String(answer).trim();
      if (raw.length > 2000)
        return { ok: false, error: SURVEY_ERROR_CODES.TOO_LONG };
      return { ok: true, value: raw };
    }
    case 'multiple_choice': {
      // Single-select : string ∈ options.
      // Multi-select : array<string> ⊂ options (extension UI multi).
      const choices = Array.isArray(opts) ? opts.map(String) : [];
      if (choices.length === 0) {
        // Pas d'options définies — accepte la valeur en string-cast (best-effort).
        return { ok: true, value: String(answer) };
      }
      if (Array.isArray(answer)) {
        const ok = answer.every((a) => choices.includes(String(a)));
        if (!ok) return { ok: false, error: SURVEY_ERROR_CODES.INVALID_OPTION };
        return { ok: true, value: answer.map(String) };
      }
      const single = String(answer);
      if (!choices.includes(single)) {
        return { ok: false, error: SURVEY_ERROR_CODES.INVALID_OPTION };
      }
      return { ok: true, value: single };
    }
    case 'rating':
    case 'csat': {
      const n = Number(answer);
      if (!Number.isFinite(n))
        return { ok: false, error: SURVEY_ERROR_CODES.OUT_OF_RANGE };
      const max = readScale(opts, type === 'csat' ? 5 : 5);
      const min = readMin(opts, 1);
      const intN = Math.floor(n);
      if (intN < min || intN > max)
        return { ok: false, error: SURVEY_ERROR_CODES.OUT_OF_RANGE };
      return { ok: true, value: intN };
    }
    case 'nps': {
      const n = Number(answer);
      if (!Number.isFinite(n))
        return { ok: false, error: SURVEY_ERROR_CODES.OUT_OF_RANGE };
      const intN = Math.floor(n);
      if (intN < 0 || intN > 10)
        return { ok: false, error: SURVEY_ERROR_CODES.OUT_OF_RANGE };
      return { ok: true, value: intN };
    }
    case 'date': {
      const raw = String(answer).trim();
      // Accepte YYYY-MM-DD ou ISO complet. Pas de futur/passé strict (UI handle).
      const date = new Date(raw);
      if (Number.isNaN(date.getTime()))
        return { ok: false, error: SURVEY_ERROR_CODES.INVALID_DATE };
      return { ok: true, value: raw };
    }
    default:
      return { ok: false, error: SURVEY_ERROR_CODES.INVALID_TYPE };
  }
}

// ── 9) getNextQuestionId (pure branching evaluator) ────────────────────────
/**
 * Évalue le branching localement (sans IO) à partir des branches déjà
 * chargées. Logique :
 *   1. Match exact `condition_value === String(answer)` ⇒ next_question_id
 *      (ou null + jumpToEnd si jump_to_end=1).
 *   2. Sinon ⇒ question suivante par order (questions[index+1].id) ou null.
 *
 * Wrapper sync de resolveNextQuestion() pour usage côté handler/test.
 */
export function getNextQuestionId(
  currentQid: string,
  answer: unknown,
  questions: Array<{ id: string }>,
  branchingRules: BranchLike[],
): string | null {
  if (!currentQid) return null;
  const matched = branchingRules.find(
    (b) =>
      b.question_id === currentQid &&
      b.condition_value !== null &&
      b.condition_value === String(answer),
  );
  if (matched) {
    const jump =
      matched.jump_to_end === 1 || matched.jump_to_end === true;
    if (jump) return null;
    return matched.next_question_id ?? null;
  }
  // Fallback : question suivante par ordre.
  const idx = questions.findIndex((q) => q.id === currentQid);
  if (idx < 0 || idx + 1 >= questions.length) return null;
  return questions[idx + 1]?.id ?? null;
}

// ── 10) isWithinSurveyWindow (pure) ────────────────────────────────────────
/**
 * Survey actif si is_published=1 ET now ∈ [opens_at, closes_at] (bornes
 * inclusives, valeurs null = pas de borne). Best-effort sur dates invalides
 * (ignore la borne).
 */
export function isWithinSurveyWindow(
  survey: SurveyWindowLike | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!survey || typeof survey !== 'object') return false;
  const published =
    survey.is_published === 1 || survey.is_published === true;
  if (!published) return false;
  const t = now.getTime();
  if (survey.opens_at) {
    const opens = Date.parse(survey.opens_at);
    if (Number.isFinite(opens) && opens > t) return false;
  }
  if (survey.closes_at) {
    const closes = Date.parse(survey.closes_at);
    if (Number.isFinite(closes) && closes < t) return false;
  }
  return true;
}

// ── 11) hashRespondentIp (async, deterministe) ─────────────────────────────
/**
 * SHA256 hex de `${ip}:${salt}`. Salt distinct ⇒ hash distinct (rotation
 * possible côté ops). Inputs vides ⇒ '' (best-effort, calque surveys.ts
 * sha256Hex). Anti-double-submission anonyme = même (ip, salt) ⇒ même hash.
 */
export async function hashRespondentIp(
  ip: string | null | undefined,
  salt: string | null | undefined = '',
): Promise<string> {
  try {
    const ipStr = ip == null ? '' : String(ip);
    const saltStr = salt == null ? '' : String(salt);
    if (!ipStr) return '';
    const data = new TextEncoder().encode(`${ipStr}:${saltStr}`);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

// ── 12) aggregateResponses (pure) ──────────────────────────────────────────
/**
 * Agrège les answers par question pour un survey. Branche par question.type :
 *   - text/multiple_choice ⇒ comptage par valeur textuelle
 *   - rating/nps/csat       ⇒ avg + distribution numérique
 *   - date                  ⇒ comptage textuel (groupé par YYYY-MM-DD)
 *
 * Pure (zéro IO). L'appelant charge questions + answers avec son propre SQL
 * borné tenant.
 */
export function aggregateResponses(
  questions: QuestionLike[],
  answers: Array<{
    question_id: string;
    answer_text?: string | null;
    answer_value?: number | null;
  }>,
): {
  by_question: AggregatedQuestion[];
  nps?: ReturnType<typeof computeNpsFromAnswers>;
  csat?: ReturnType<typeof computeCsat>;
} {
  const byQid = new Map<string, AggregatedQuestion>();
  for (const q of questions) {
    if (!q?.id) continue;
    byQid.set(q.id, {
      question_id: q.id,
      type: String(q.type ?? 'text'),
      total: 0,
      text_counts: {},
      numeric: { avg: 0, min: null, max: null, distribution: {} },
    });
  }
  // Buckets globaux pour NPS/CSAT agrégés.
  const npsValues: Array<number | null> = [];
  const csatValues: Array<number | null> = [];

  for (const a of answers) {
    const slot = byQid.get(a.question_id);
    if (!slot) continue; // answer à une question inconnue ⇒ ignorée
    slot.total++;
    const type = slot.type;
    if (type === 'rating' || type === 'nps' || type === 'csat') {
      const n = Number(a.answer_value);
      if (Number.isFinite(n)) {
        const key = String(n);
        slot.numeric.distribution[key] =
          (slot.numeric.distribution[key] ?? 0) + 1;
        slot.numeric.min = slot.numeric.min == null ? n : Math.min(slot.numeric.min, n);
        slot.numeric.max = slot.numeric.max == null ? n : Math.max(slot.numeric.max, n);
        if (type === 'nps') npsValues.push(n);
        if (type === 'csat') csatValues.push(n);
      }
    } else {
      const key = (a.answer_text ?? '').toString().trim();
      if (!key) continue;
      slot.text_counts![key] = (slot.text_counts![key] ?? 0) + 1;
    }
  }

  // 2nd pass — calcul des moyennes numériques.
  for (const slot of byQid.values()) {
    if (slot.type === 'rating' || slot.type === 'nps' || slot.type === 'csat') {
      let sum = 0;
      let count = 0;
      for (const [k, v] of Object.entries(slot.numeric.distribution)) {
        sum += Number(k) * v;
        count += v;
      }
      slot.numeric.avg = count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
    }
  }

  const result: ReturnType<typeof aggregateResponses> = {
    by_question: Array.from(byQid.values()),
  };
  if (npsValues.length > 0) result.nps = computeNpsFromAnswers(npsValues);
  if (csatValues.length > 0) result.csat = computeCsat(csatValues, 5);
  return result;
}

// ── Helpers internes (non exportés) ────────────────────────────────────────

function sanitizeCount(v: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function parseOptions(question: QuestionLike): unknown {
  if (question.options !== undefined) return question.options;
  if (!question.options_json) return null;
  try {
    return JSON.parse(question.options_json);
  } catch {
    return null;
  }
}

function readScale(opts: unknown, fallback: number): number {
  if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
    const o = opts as Record<string, unknown>;
    const candidates = [o.scale, o.max];
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n) && n >= 2 && n <= 100) return Math.floor(n);
    }
  }
  return fallback;
}

function readMin(opts: unknown, fallback: number): number {
  if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
    const o = opts as Record<string, unknown>;
    const n = Number(o.min);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return fallback;
}

// NB : 12 helpers Sprint 50+51. Signatures FIGÉES pour Phase A (3 premiers).
// Ajouts Phase B (9 helpers) : classifyNps, computeNpsFromAnswers, computeCsat,
// computeCes, validateAnswer, getNextQuestionId, isWithinSurveyWindow,
// hashRespondentIp, aggregateResponses. Imports RELATIFS uniquement. PAS de
// throw, best-effort total (calque affiliate-engine). Multi-tenant bornage
// côté HANDLER (engine pure ou D1 best-effort SELECT). Choix figés
// docs/LOT-SURVEYS-DNS-S50.md §6.
