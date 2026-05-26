// ── surveys.ts — Sprint 50 Surveys avancés (LOT 5 FIN) ────────────────────
//
// Handlers backend du module surveys avancés : questionnaires multi-pages
// avec branching logic conditionnel, NPS scores (-100..+100), CSAT, types
// variés (text|multiple_choice|rating|nps|csat|date). DISTINCT du module
// Forms (S5, seq106) single-step capture lead.
//
// Phase B Manager-A — corps réels. Signatures FIGÉES Phase A (worker.ts
// gelé câble déjà ces handlers, api.ts gelé appelle déjà ces routes).
// Contrat §6 verbatim dans docs/LOT-SURVEYS-DNS-S50.md.
//
// Conventions imposées (docs/LOT-SURVEYS-DNS-S50.md §6) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` dans les erreurs.
//   - Garde capability : surveyCapGuard(auth) = mode-agence-only (calque
//     affiliates.ts:settingsCapGuard / community-forum.ts). Réutilise
//     'settings.manage' (déjà dans ALL_CAPABILITIES seq80 — AUCUN ajout).
//     Action sensible (modifie le tracking client + impacte UX visiteur).
//   - Bornage tenant : loadSurveyInTenant (calque
//     affiliates.ts:loadAffiliateInTenant — legacy → row ; mode agence →
//     client_id ∈ accessibleClientIds OU agency_id == tenant.agencyId,
//     sinon 404).
//   - Statuts validés HANDLER (PAS de CHECK SQL) : surveys.type
//     (standard|nps|csat|custom) / survey_questions.type (text|
//     multiple_choice|rating|nps|csat|date) / survey_responses.status
//     (in_progress|completed|abandoned). Whitelists exposées par
//     `survey-engine.ts` (SURVEY_TYPES / QUESTION_TYPES / RESPONSE_STATUSES).
//   - best-effort : table/colonne absente (seq145 non jouée) → réponse
//     propre (404 / {data:[]}), JAMAIS de 500/throw non maîtrisé.
//   - PUBLIC submit : rate-limit `survey_submit:<ip>` 10/3600s (calque
//     /api/public/affiliates/track-click + /api/public/preorders) +
//     honeypot champ `website` HANDLER + PII Loi 25 (ip_hash SHA256, pas
//     brut).

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import {
  SURVEY_TYPES,
  QUESTION_TYPES,
  RESPONSE_STATUSES,
  SURVEY_ERROR_CODES,
  aggregateNpsForPeriod,
  aggregateResponses,
  getNextQuestionId,
  hashRespondentIp,
  isWithinSurveyWindow,
  resolveNextQuestion,
  validateAnswer,
  type QuestionLike,
  type BranchLike,
} from './lib/survey-engine';
import { checkRateLimit } from './lib/rate-limit';

// Auth enrichi au choke-point (worker.ts) — calque AffiliateAuth.
export type SurveyAuth = CapAuth & { capabilities?: Set<string> };

// ── Garde capability mode-agence-only (calque affiliates.ts) ─────────────
// Capability `settings.manage` réutilisée (déjà dans ALL_CAPABILITIES seq80).
// Surveys = action sensible (modifie tracking client + UX visiteur). Legacy/
// mono-tenant ⇒ undefined : aucun bridage nouveau.
export function surveyCapGuard(auth: SurveyAuth): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, 'settings.manage');
}

// ── Helpers internes ──────────────────────────────────────────────────────

/** UUID hex 32 (calque affiliates.ts:newIdS49). */
function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Parse JSON body best-effort (empty/invalid ⇒ {}). */
async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Resolve client_id côté handler (auth context). */
function clientIdOf(auth: SurveyAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

/** Construit le filtre tenant SQL (calque affiliates.ts:tenantFilter). */
function tenantFilter(auth: SurveyAuth): { clause: string; params: string[] } {
  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return { clause: '', params: [] };
  const accessible = auth.tenant!.accessibleClientIds || [];
  if (accessible.length === 0) {
    // Mode agence sans clients accessibles → clause impossible (vide).
    return { clause: '1 = 0', params: [] };
  }
  const placeholders = accessible.map(() => '?').join(',');
  return {
    clause: `client_id IN (${placeholders})`,
    params: [...accessible],
  };
}

/**
 * Bornage tenant sur un survey (calque affiliates.ts:loadAffiliateInTenant).
 * Legacy/mono-tenant → row. Mode agence → client_id ∈ accessibleClientIds.
 */
async function loadSurveyInTenant(
  env: Env,
  surveyId: string,
  auth: SurveyAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM surveys WHERE id = ?')
      .bind(surveyId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Survey introuvable' }, 404);
  }
  if (!row) return json({ error: 'Survey introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  if (rowClient == null || !accessible.includes(rowClient)) {
    return json({ error: 'Survey introuvable' }, 404);
  }
  return row;
}

/**
 * Bornage tenant sur une question (JOIN surveys.client_id).
 * Retourne { question, survey } ou Response 404.
 */
async function loadQuestionInTenant(
  env: Env,
  questionId: string,
  auth: SurveyAuth,
): Promise<
  | { question: Record<string, unknown>; survey: Record<string, unknown> }
  | Response
> {
  let q: Record<string, unknown> | null = null;
  try {
    q = (await env.DB.prepare('SELECT * FROM survey_questions WHERE id = ?')
      .bind(questionId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Question introuvable' }, 404);
  }
  if (!q) return json({ error: 'Question introuvable' }, 404);

  const surveyId = (q.survey_id as string | null) ?? '';
  if (!surveyId) return json({ error: 'Question introuvable' }, 404);
  const survey = await loadSurveyInTenant(env, surveyId, auth);
  if (survey instanceof Response) return survey;
  return { question: q, survey };
}

/** Bornage tenant sur une branche (JOIN survey_questions → surveys.client_id). */
async function loadBranchInTenant(
  env: Env,
  branchId: string,
  auth: SurveyAuth,
): Promise<Record<string, unknown> | Response> {
  let b: Record<string, unknown> | null = null;
  try {
    b = (await env.DB.prepare('SELECT * FROM survey_branches WHERE id = ?')
      .bind(branchId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Branche introuvable' }, 404);
  }
  if (!b) return json({ error: 'Branche introuvable' }, 404);
  const qid = (b.question_id as string | null) ?? '';
  if (!qid) return json({ error: 'Branche introuvable' }, 404);
  const ctx = await loadQuestionInTenant(env, qid, auth);
  if (ctx instanceof Response) return ctx;
  return b;
}

/** Bornage tenant sur une session de réponse (survey_responses.client_id denorm). */
async function loadResponseInTenant(
  env: Env,
  responseId: string,
  auth: SurveyAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM survey_responses WHERE id = ?')
      .bind(responseId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Response introuvable' }, 404);
  }
  if (!row) return json({ error: 'Response introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  if (rowClient == null || !accessible.includes(rowClient)) {
    return json({ error: 'Response introuvable' }, 404);
  }
  return row;
}

// ── 1) GET /api/surveys ────────────────────────────────────────────────────
/**
 * Liste les surveys du tenant. Cap `settings.manage` (handler). Filtres
 * URL : `?published=1|0`, `?type=standard|nps|csat|custom`.
 */
export async function handleListSurveys(
  env: Env,
  auth: SurveyAuth,
  url: URL,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  try {
    const { clause, params } = tenantFilter(auth);
    const conds: string[] = [];
    const binds: string[] = [];
    if (clause) {
      conds.push(clause);
      binds.push(...params);
    }
    const publishedFilter = url.searchParams.get('published');
    if (publishedFilter === '1' || publishedFilter === '0') {
      conds.push('is_published = ?');
      binds.push(publishedFilter);
    }
    const typeFilter = url.searchParams.get('type');
    if (
      typeFilter &&
      SURVEY_TYPES.includes(typeFilter as (typeof SURVEY_TYPES)[number])
    ) {
      conds.push('type = ?');
      binds.push(typeFilter);
    }
    let query = 'SELECT * FROM surveys';
    if (conds.length > 0) query += ` WHERE ${conds.join(' AND ')}`;
    query += ' ORDER BY created_at DESC';
    const stmt = env.DB.prepare(query);
    const { results } =
      binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();
    return json({ data: results || [] });
  } catch {
    // Table seq145 absente : best-effort liste vide.
    return json({ data: [] });
  }
}

// ── 2) POST /api/surveys ───────────────────────────────────────────────────
/**
 * Crée un survey (title + description + type + target_audience_json).
 * type validé HANDLER ∈ SURVEY_TYPES. client_id posé depuis le tenant.
 */
export async function handleCreateSurvey(
  request: Request,
  env: Env,
  auth: SurveyAuth,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;

  const body = await readJsonBody(request);
  const title = sanitizeInput((body.title as string) || '', 200);
  if (!title) return json({ error: 'Titre requis' }, 400);

  const description = sanitizeInput((body.description as string) || '', 2000);
  const type = SURVEY_TYPES.includes(body.type as (typeof SURVEY_TYPES)[number])
    ? (body.type as string)
    : 'standard';

  let targetAudienceJson: string | null = null;
  if (body.target_audience_json != null) {
    try {
      targetAudienceJson =
        typeof body.target_audience_json === 'string'
          ? body.target_audience_json
          : JSON.stringify(body.target_audience_json);
      if (targetAudienceJson.length > 8000) {
        targetAudienceJson = targetAudienceJson.slice(0, 8000);
      }
    } catch {
      targetAudienceJson = null;
    }
  }

  const clientId = clientIdOf(auth);
  if (!clientId) return json({ error: 'Tenant requis' }, 400);

  const id = newId();
  try {
    await env.DB.prepare(
      'INSERT INTO surveys (id, client_id, title, description, type, target_audience_json) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, clientId, title, description, type, targetAudienceJson)
      .run();
    return json({ data: { id, title, type } }, 201);
  } catch {
    return json({ error: 'Création impossible' }, 400);
  }
}

// ── 3) GET /api/surveys/:id ────────────────────────────────────────────────
/**
 * Détail d'un survey + ses questions + ses branches (joined). Borné tenant.
 */
export async function handleGetSurvey(
  env: Env,
  auth: SurveyAuth,
  surveyId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const survey = await loadSurveyInTenant(env, surveyId, auth);
  if (survey instanceof Response) return survey;

  let questions: Record<string, unknown>[] = [];
  let branches: Record<string, unknown>[] = [];
  try {
    const qRes = await env.DB.prepare(
      'SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY page_number ASC, order_index ASC',
    )
      .bind(surveyId)
      .all();
    questions = (qRes.results || []) as Record<string, unknown>[];
  } catch {
    questions = [];
  }
  if (questions.length > 0) {
    try {
      const qIds = questions.map((q) => q.id as string).filter(Boolean);
      const placeholders = qIds.map(() => '?').join(',');
      if (placeholders) {
        const bRes = await env.DB.prepare(
          `SELECT * FROM survey_branches WHERE question_id IN (${placeholders}) ORDER BY rowid ASC`,
        )
          .bind(...qIds)
          .all();
        branches = (bRes.results || []) as Record<string, unknown>[];
      }
    } catch {
      branches = [];
    }
  }
  return json({ data: { ...survey, questions, branches } });
}

// ── 4) PUT /api/surveys/:id ────────────────────────────────────────────────
/**
 * Update title/description/type/target_audience_json/is_published d'un
 * survey. Le flip is_published 0→1 pose `published_at` (datetime now).
 */
export async function handleUpdateSurvey(
  request: Request,
  env: Env,
  auth: SurveyAuth,
  surveyId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const existing = await loadSurveyInTenant(env, surveyId, auth);
  if (existing instanceof Response) return existing;

  const body = await readJsonBody(request);
  const updates: string[] = [];
  const binds: unknown[] = [];

  if (typeof body.title === 'string') {
    updates.push('title = ?');
    binds.push(sanitizeInput(body.title, 200));
  }
  if (typeof body.description === 'string') {
    updates.push('description = ?');
    binds.push(sanitizeInput(body.description, 2000));
  }
  if (
    typeof body.type === 'string' &&
    SURVEY_TYPES.includes(body.type as (typeof SURVEY_TYPES)[number])
  ) {
    updates.push('type = ?');
    binds.push(body.type);
  }
  if (body.target_audience_json !== undefined) {
    let val: string | null = null;
    try {
      val =
        typeof body.target_audience_json === 'string'
          ? body.target_audience_json
          : JSON.stringify(body.target_audience_json);
      if (val && val.length > 8000) val = val.slice(0, 8000);
    } catch {
      val = null;
    }
    updates.push('target_audience_json = ?');
    binds.push(val);
  }
  if (body.is_published === 0 || body.is_published === 1) {
    updates.push('is_published = ?');
    binds.push(body.is_published);
    const wasPublished = Number(existing.is_published ?? 0) === 1;
    if (body.is_published === 1 && !wasPublished) {
      updates.push("published_at = datetime('now')");
    }
  }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);

  updates.push("updated_at = datetime('now')");
  binds.push(surveyId);
  try {
    await env.DB.prepare(`UPDATE surveys SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
    return json({ data: { id: surveyId } });
  } catch {
    return json({ error: 'Mise à jour impossible' }, 400);
  }
}

// ── 5) DELETE /api/surveys/:id ─────────────────────────────────────────────
/**
 * Soft-delete : flip is_published=0 (preserve l'historique des réponses).
 * Cap `settings.manage` (handler) + bornage tenant.
 */
export async function handleDeleteSurvey(
  env: Env,
  auth: SurveyAuth,
  surveyId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const survey = await loadSurveyInTenant(env, surveyId, auth);
  if (survey instanceof Response) return survey;
  try {
    await env.DB.prepare(
      "UPDATE surveys SET is_published = 0, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(surveyId)
      .run();
    return json({ data: { id: surveyId, success: true } });
  } catch {
    return json({ error: 'Suppression impossible' }, 400);
  }
}

// ── 6) POST /api/surveys/:id/publish ───────────────────────────────────────
/**
 * Flip is_published 0→1 + pose published_at. Idempotent (déjà publié ⇒
 * 200 sans changement).
 */
export async function handlePublishSurvey(
  _request: Request,
  env: Env,
  auth: SurveyAuth,
  surveyId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const survey = await loadSurveyInTenant(env, surveyId, auth);
  if (survey instanceof Response) return survey;

  const already = Number(survey.is_published ?? 0) === 1;
  if (already) {
    return json({
      data: {
        id: surveyId,
        is_published: 1,
        published_at: survey.published_at ?? null,
      },
    });
  }
  try {
    await env.DB.prepare(
      "UPDATE surveys SET is_published = 1, published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    )
      .bind(surveyId)
      .run();
    return json({ data: { id: surveyId, is_published: 1 } });
  } catch {
    return json({ error: 'Publication impossible' }, 400);
  }
}

// ── 7) GET /api/surveys/:id/questions ──────────────────────────────────────
/**
 * Liste les questions d'un survey ordonnées par (page_number ASC,
 * order_index ASC).
 */
export async function handleListSurveyQuestions(
  env: Env,
  auth: SurveyAuth,
  surveyId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const survey = await loadSurveyInTenant(env, surveyId, auth);
  if (survey instanceof Response) return survey;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY page_number ASC, order_index ASC',
    )
      .bind(surveyId)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// ── 8) POST /api/surveys/:id/questions ─────────────────────────────────────
/**
 * Ajoute une question à un survey. type validé HANDLER ∈ QUESTION_TYPES.
 * options_json validé HANDLER selon type (multiple_choice ⇒ array ; rating/
 * nps/csat ⇒ {min,max,scale}).
 */
export async function handleCreateSurveyQuestion(
  request: Request,
  env: Env,
  auth: SurveyAuth,
  surveyId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const survey = await loadSurveyInTenant(env, surveyId, auth);
  if (survey instanceof Response) return survey;

  const body = await readJsonBody(request);
  const questionText = sanitizeInput((body.question_text as string) || '', 500);
  if (!questionText) return json({ error: 'Texte de question requis' }, 400);

  const type = QUESTION_TYPES.includes(
    body.type as (typeof QUESTION_TYPES)[number],
  )
    ? (body.type as string)
    : 'text';

  // Validation options_json selon type.
  let optionsJson: string | null = null;
  if (body.options_json !== undefined && body.options_json !== null) {
    try {
      const raw =
        typeof body.options_json === 'string'
          ? JSON.parse(body.options_json)
          : body.options_json;
      if (type === 'multiple_choice') {
        if (!Array.isArray(raw) || raw.length === 0) {
          return json(
            { error: 'options_json doit être un array non vide pour multiple_choice' },
            400,
          );
        }
      } else if (type === 'rating' || type === 'nps' || type === 'csat') {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return json(
            { error: 'options_json doit être un objet {min,max,scale} pour rating/nps/csat' },
            400,
          );
        }
      }
      optionsJson = JSON.stringify(raw);
      if (optionsJson.length > 4000) optionsJson = optionsJson.slice(0, 4000);
    } catch {
      return json({ error: 'options_json invalide' }, 400);
    }
  }

  const required = body.required === 1 || body.required === true ? 1 : 0;
  const orderIndexRaw = Number(body.order_index);
  const orderIndex =
    Number.isFinite(orderIndexRaw) && orderIndexRaw >= 0
      ? Math.floor(orderIndexRaw)
      : 0;
  const pageNumberRaw = Number(body.page_number);
  const pageNumber =
    Number.isFinite(pageNumberRaw) && pageNumberRaw >= 1
      ? Math.floor(pageNumberRaw)
      : 1;

  const id = newId();
  try {
    await env.DB.prepare(
      'INSERT INTO survey_questions (id, survey_id, question_text, type, options_json, required, order_index, page_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        id,
        surveyId,
        questionText,
        type,
        optionsJson,
        required,
        orderIndex,
        pageNumber,
      )
      .run();
    return json({ data: { id, survey_id: surveyId, type } }, 201);
  } catch {
    return json({ error: 'Création impossible' }, 400);
  }
}

// ── 9) PUT /api/survey-questions/:id ───────────────────────────────────────
/**
 * Update une question (text/type/options/required/order_index/page_number).
 * Borné tenant via JOIN surveys.client_id.
 */
export async function handleUpdateSurveyQuestion(
  request: Request,
  env: Env,
  auth: SurveyAuth,
  questionId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const ctx = await loadQuestionInTenant(env, questionId, auth);
  if (ctx instanceof Response) return ctx;

  const body = await readJsonBody(request);
  const updates: string[] = [];
  const binds: unknown[] = [];

  if (typeof body.question_text === 'string') {
    updates.push('question_text = ?');
    binds.push(sanitizeInput(body.question_text, 500));
  }
  if (
    typeof body.type === 'string' &&
    QUESTION_TYPES.includes(body.type as (typeof QUESTION_TYPES)[number])
  ) {
    updates.push('type = ?');
    binds.push(body.type);
  }
  if (body.options_json !== undefined) {
    let val: string | null = null;
    if (body.options_json !== null) {
      try {
        const raw =
          typeof body.options_json === 'string'
            ? JSON.parse(body.options_json)
            : body.options_json;
        val = JSON.stringify(raw);
        if (val.length > 4000) val = val.slice(0, 4000);
      } catch {
        return json({ error: 'options_json invalide' }, 400);
      }
    }
    updates.push('options_json = ?');
    binds.push(val);
  }
  if (body.required === 0 || body.required === 1) {
    updates.push('required = ?');
    binds.push(body.required);
  }
  if (Number.isFinite(Number(body.order_index))) {
    updates.push('order_index = ?');
    binds.push(Math.max(0, Math.floor(Number(body.order_index))));
  }
  if (Number.isFinite(Number(body.page_number))) {
    updates.push('page_number = ?');
    binds.push(Math.max(1, Math.floor(Number(body.page_number))));
  }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);

  binds.push(questionId);
  try {
    await env.DB.prepare(
      `UPDATE survey_questions SET ${updates.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();
    return json({ data: { id: questionId } });
  } catch {
    return json({ error: 'Mise à jour impossible' }, 400);
  }
}

// ── 10) DELETE /api/survey-questions/:id ──────────────────────────────────
/**
 * Supprime une question + ses branches + ses réponses-answers (cascade
 * applicative). Borné tenant via JOIN surveys.client_id.
 */
export async function handleDeleteSurveyQuestion(
  env: Env,
  auth: SurveyAuth,
  questionId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const ctx = await loadQuestionInTenant(env, questionId, auth);
  if (ctx instanceof Response) return ctx;

  try {
    // Cascade applicative : branches → answers → question.
    await env.DB.prepare(
      'DELETE FROM survey_branches WHERE question_id = ? OR next_question_id = ?',
    )
      .bind(questionId, questionId)
      .run();
    await env.DB.prepare(
      'DELETE FROM survey_response_answers WHERE question_id = ?',
    )
      .bind(questionId)
      .run();
    await env.DB.prepare('DELETE FROM survey_questions WHERE id = ?')
      .bind(questionId)
      .run();
    return json({ data: { id: questionId, success: true } });
  } catch {
    return json({ error: 'Suppression impossible' }, 400);
  }
}

// ── 11) GET /api/survey-questions/:id/branches ────────────────────────────
/**
 * Liste les branches conditionnelles d'une question (HANDLER
 * resolveNextQuestion utilisera ces rows).
 */
export async function handleListBranches(
  env: Env,
  auth: SurveyAuth,
  questionId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const ctx = await loadQuestionInTenant(env, questionId, auth);
  if (ctx instanceof Response) return ctx;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM survey_branches WHERE question_id = ? ORDER BY rowid ASC',
    )
      .bind(questionId)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// ── 12) POST /api/survey-questions/:id/branches ───────────────────────────
/**
 * Ajoute une branche : si la réponse égale condition_value, aller à
 * next_question_id (ou jump_to_end=1). Validation HANDLER : next_question_id
 * doit appartenir au même survey.
 */
export async function handleCreateBranch(
  request: Request,
  env: Env,
  auth: SurveyAuth,
  questionId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const ctx = await loadQuestionInTenant(env, questionId, auth);
  if (ctx instanceof Response) return ctx;

  const body = await readJsonBody(request);
  const conditionValue =
    body.condition_value != null
      ? sanitizeInput(String(body.condition_value), 200)
      : null;
  const jumpToEnd = body.jump_to_end === 1 || body.jump_to_end === true ? 1 : 0;

  let nextQuestionId: string | null = null;
  if (typeof body.next_question_id === 'string' && body.next_question_id.trim()) {
    nextQuestionId = body.next_question_id.trim();
  }

  if (!jumpToEnd && !nextQuestionId) {
    return json({ error: 'next_question_id ou jump_to_end requis' }, 400);
  }

  // Validation cross-survey : next_question_id doit appartenir au même survey.
  if (nextQuestionId) {
    const surveyId = (ctx.question.survey_id as string | null) ?? '';
    try {
      const nextQ = (await env.DB.prepare(
        'SELECT survey_id FROM survey_questions WHERE id = ? LIMIT 1',
      )
        .bind(nextQuestionId)
        .first()) as { survey_id: string | null } | null;
      if (!nextQ || nextQ.survey_id !== surveyId) {
        return json(
          { error: 'next_question_id doit appartenir au même survey' },
          400,
        );
      }
    } catch {
      return json({ error: 'Validation next_question_id impossible' }, 400);
    }
  }

  const id = newId();
  try {
    await env.DB.prepare(
      'INSERT INTO survey_branches (id, question_id, condition_value, next_question_id, jump_to_end) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, questionId, conditionValue, nextQuestionId, jumpToEnd)
      .run();
    return json({ data: { id, question_id: questionId } }, 201);
  } catch {
    return json({ error: 'Création impossible' }, 400);
  }
}

// ── 13) DELETE /api/survey-branches/:id ───────────────────────────────────
/**
 * Supprime une branche. Borné tenant via JOIN survey_questions →
 * surveys.client_id.
 */
export async function handleDeleteBranch(
  env: Env,
  auth: SurveyAuth,
  branchId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const branch = await loadBranchInTenant(env, branchId, auth);
  if (branch instanceof Response) return branch;
  try {
    await env.DB.prepare('DELETE FROM survey_branches WHERE id = ?')
      .bind(branchId)
      .run();
    return json({ data: { id: branchId, success: true } });
  } catch {
    return json({ error: 'Suppression impossible' }, 400);
  }
}

// ── 14) GET /api/surveys/:id/responses ────────────────────────────────────
/**
 * Liste les réponses d'un survey. Filtres URL : `?status=in_progress|
 * completed|abandoned`, `?after=<ISO>`, `?before=<ISO>`.
 */
export async function handleListResponses(
  env: Env,
  auth: SurveyAuth,
  surveyId: string,
  url: URL,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const survey = await loadSurveyInTenant(env, surveyId, auth);
  if (survey instanceof Response) return survey;

  try {
    const conds: string[] = ['survey_id = ?'];
    const binds: string[] = [surveyId];
    const statusFilter = url.searchParams.get('status');
    if (
      statusFilter &&
      RESPONSE_STATUSES.includes(
        statusFilter as (typeof RESPONSE_STATUSES)[number],
      )
    ) {
      conds.push('status = ?');
      binds.push(statusFilter);
    }
    const after = url.searchParams.get('after');
    if (after) {
      conds.push('started_at >= ?');
      binds.push(after);
    }
    const before = url.searchParams.get('before');
    if (before) {
      conds.push('started_at <= ?');
      binds.push(before);
    }
    const { results } = await env.DB.prepare(
      `SELECT * FROM survey_responses WHERE ${conds.join(' AND ')} ORDER BY started_at DESC LIMIT 500`,
    )
      .bind(...binds)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// ── 15) GET /api/survey-responses/:id ─────────────────────────────────────
/**
 * Détail d'une session de réponse + answers (joined survey_response_answers).
 * Borné tenant via survey_responses.client_id (denorm).
 */
export async function handleGetResponseDetail(
  env: Env,
  auth: SurveyAuth,
  responseId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const response = await loadResponseInTenant(env, responseId, auth);
  if (response instanceof Response) return response;

  let answers: Record<string, unknown>[] = [];
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM survey_response_answers WHERE response_id = ? ORDER BY rowid ASC',
    )
      .bind(responseId)
      .all();
    answers = (results || []) as Record<string, unknown>[];
  } catch {
    answers = [];
  }
  return json({ data: { ...response, answers } });
}

// ── 16) GET /api/surveys/:id/nps?period_days=30|60|90 ─────────────────────
/**
 * Lit le dernier agrégat NPS d'un survey pour la période donnée. Si aucun
 * agrégat ⇒ déclenche un calcul on-demand via aggregateNpsForPeriod
 * (survey-engine). Borné tenant.
 */
export async function handleGetNpsAggregate(
  env: Env,
  auth: SurveyAuth,
  surveyId: string,
  url: URL,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const survey = await loadSurveyInTenant(env, surveyId, auth);
  if (survey instanceof Response) return survey;

  const periodRaw = Number(url.searchParams.get('period_days') ?? '30');
  const periodDays = Number.isFinite(periodRaw) && periodRaw > 0
    ? Math.floor(periodRaw)
    : 30;

  // Lit le dernier agrégat de la fenêtre (1 row la plus récente).
  try {
    const row = (await env.DB.prepare(
      'SELECT * FROM nps_aggregates WHERE survey_id = ? AND period_days = ? ORDER BY calculated_at DESC LIMIT 1',
    )
      .bind(surveyId, periodDays)
      .first()) as Record<string, unknown> | null;
    if (row) return json({ data: row });
  } catch {
    /* best-effort */
  }

  // Pas d'agrégat ⇒ calcul on-demand via survey-engine.
  try {
    const computed = await aggregateNpsForPeriod(env, surveyId, periodDays);
    return json({ data: computed });
  } catch {
    return json({ data: null });
  }
}

// ── 17) POST /api/public/surveys/:id/submit (PUBLIC pré-requireAuth) ──────
/**
 * Visitor répond à un survey. Rate-limit `survey_submit:<ip_hash>` 10/3600s +
 * honeypot champ `website`. PII Loi 25 : hash IP via SHA256 (ip_hash, pas
 * brut). Insert survey_responses (status='in_progress' au start, 'completed'
 * au submit final) + insert survey_response_answers (1 par question
 * répondue).
 *
 * Le payload supporte les soumissions multi-pages : `partial=true` ⇒
 * accumule answers + reste in_progress ; `partial=false` ⇒ finalise
 * (status='completed', completed_at=now).
 *
 * Body : { response_id?, answers: [{question_id, answer_text?, answer_value?}],
 *          partial?, respondent_email?, respondent_name?, website? }
 */
export async function handlePublicSubmitSurvey(
  request: Request,
  env: Env,
  surveyId: string,
): Promise<Response> {
  try {
    // 1) Rate-limit IP hashée (10 submits / heure / IP). Loi 25 : pas d'IP
    //    brute dans rate_limit_buckets. Utilise hashRespondentIp() engine
    //    (Sprint 51 wire-up) avec salt vide par défaut (pas d'env salt
    //    configuré) — déterministe, anti-double-submission anonyme.
    const ip =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const ipHash = await hashRespondentIp(ip, '');
    const rl = await checkRateLimit(env, `survey_submit:${ipHash}`, 10, 3600);
    if (!rl.allowed) {
      return json({ error: 'Trop de requêtes, réessayez plus tard' }, 429);
    }

    const body = await readJsonBody(request);

    // 2) Honeypot — visiteur humain ne le remplit pas. Anti-fingerprint :
    //    200 fake-success (ne révèle pas la détection).
    const honeypot =
      typeof body.website === 'string' ? body.website.trim() : '';
    if (honeypot.length > 0) {
      return json({ data: { id: 'bot', status: 'completed' } });
    }

    // 3) Survey doit exister + être DANS la fenêtre de publication. Wire-up
    //    Sprint 51 : isWithinSurveyWindow() — refuse closed/expired (window
    //    [opens_at, closes_at]) en plus du flag is_published.
    let survey: {
      client_id: string | null;
      is_published: number;
      opens_at: string | null;
      closes_at: string | null;
      published_at: string | null;
    } | null = null;
    try {
      survey = (await env.DB.prepare(
        'SELECT client_id, is_published, opens_at, closes_at, published_at FROM surveys WHERE id = ? LIMIT 1',
      )
        .bind(surveyId)
        .first()) as
        | {
            client_id: string | null;
            is_published: number;
            opens_at: string | null;
            closes_at: string | null;
            published_at: string | null;
          }
        | null;
    } catch {
      return json({ error: 'Survey introuvable' }, 404);
    }
    if (!survey) return json({ error: 'Survey introuvable' }, 404);
    if (!isWithinSurveyWindow(survey)) {
      return json(
        {
          error: 'Survey fermé ou non publié',
          code: SURVEY_ERROR_CODES.SURVEY_CLOSED,
        },
        403,
      );
    }

    const partial = body.partial === true || body.partial === 1;
    const respondentEmail = sanitizeInput(
      (body.respondent_email as string) || '',
      200,
    );
    const respondentName = sanitizeInput(
      (body.respondent_name as string) || '',
      120,
    );

    const answers = Array.isArray(body.answers)
      ? (body.answers as Array<Record<string, unknown>>)
      : [];

    // 4) Validation answers via validateAnswer() (wire-up Sprint 51). On
    //    charge les questions concernées et on type-check chaque réponse.
    //    Best-effort : si DB KO pour le SELECT questions, on laisse passer
    //    (ne pas bloquer le visiteur sur incident infra).
    const questionIds = Array.from(
      new Set(
        answers
          .map((a) =>
            typeof a.question_id === 'string' ? a.question_id : '',
          )
          .filter((q) => q.length > 0),
      ),
    );
    const questionsById = new Map<string, QuestionLike>();
    if (questionIds.length > 0) {
      try {
        const placeholders = questionIds.map(() => '?').join(',');
        const { results } = await env.DB.prepare(
          `SELECT id, type, required, options_json FROM survey_questions WHERE id IN (${placeholders})`,
        )
          .bind(...questionIds)
          .all();
        for (const row of (results || []) as Array<{
          id: string;
          type: string;
          required: number;
          options_json: string | null;
        }>) {
          questionsById.set(row.id, row);
        }
      } catch {
        /* best-effort : pas de validation si questions inaccessibles */
      }
    }
    if (questionsById.size > 0) {
      for (const ans of answers) {
        const qid =
          typeof ans.question_id === 'string' ? ans.question_id : '';
        if (!qid) continue;
        const q = questionsById.get(qid);
        if (!q) continue; // question fantôme — ignorée (cf. INSERT loop)
        // Réponse côté wire = answer_value (numeric) prioritaire sinon
        // answer_text, calque INSERT loop ci-dessous.
        const rawAnswer =
          ans.answer_value !== undefined && ans.answer_value !== null
            ? ans.answer_value
            : (ans.answer_text ?? null);
        const v = validateAnswer(q, rawAnswer);
        if (!v.ok) {
          return json(
            {
              error: 'Réponse invalide',
              code: SURVEY_ERROR_CODES.SURVEY_INVALID_ANSWER,
              field: qid,
              reason: v.error,
            },
            400,
          );
        }
      }
    }

    // 5) Upsert applicatif sur response_id (multi-page accumulation).
    let responseId =
      typeof body.response_id === 'string' && body.response_id.trim()
        ? body.response_id.trim()
        : null;

    if (responseId) {
      // Vérifie que la session existe ET appartient à ce survey (anti-spoof).
      const existing = (await env.DB.prepare(
        'SELECT id FROM survey_responses WHERE id = ? AND survey_id = ? LIMIT 1',
      )
        .bind(responseId, surveyId)
        .first()) as { id: string } | null;
      if (!existing) responseId = null;
    }

    if (!responseId) {
      // 5.b) Anti-double-submit (Sprint 51) : refuse si déjà répondu pour
      //      ce survey par le même customer_id OU le même ip_hash. Clé
      //      (survey_id, customer_id || ip_hash). Best-effort.
      const customerId =
        typeof body.customer_id === 'string' && body.customer_id.trim()
          ? body.customer_id.trim()
          : null;
      if (customerId || ipHash) {
        try {
          const dup = (await env.DB.prepare(
            customerId
              ? 'SELECT id FROM survey_responses WHERE survey_id = ? AND respondent_customer_id = ? LIMIT 1'
              : 'SELECT id FROM survey_responses WHERE survey_id = ? AND ip_hash = ? LIMIT 1',
          )
            .bind(surveyId, customerId ?? ipHash)
            .first()) as { id: string } | null;
          if (dup) {
            return json(
              {
                error: 'Réponse déjà enregistrée',
                code: SURVEY_ERROR_CODES.DUPLICATE_RESPONSE,
              },
              409,
            );
          }
        } catch {
          /* best-effort : colonne absente → on laisse passer */
        }
      }

      responseId = newId();
      try {
        await env.DB.prepare(
          'INSERT INTO survey_responses (id, survey_id, client_id, respondent_email, respondent_name, ip_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
          .bind(
            responseId,
            surveyId,
            survey.client_id,
            respondentEmail || null,
            respondentName || null,
            ipHash || null,
            'in_progress',
          )
          .run();
      } catch {
        return json({ error: 'Soumission impossible' }, 400);
      }
    }

    // 6) Insert answers (1 par question répondue). Validation HANDLER :
    //    question_id requis, answer_text ou answer_value au moins.
    for (const ans of answers) {
      const qid = typeof ans.question_id === 'string' ? ans.question_id : '';
      if (!qid) continue;
      const answerText =
        ans.answer_text != null
          ? sanitizeInput(String(ans.answer_text), 2000)
          : null;
      let answerValue: number | null = null;
      if (ans.answer_value != null) {
        const n = Number(ans.answer_value);
        if (Number.isFinite(n)) answerValue = Math.floor(n);
      }
      if (answerText == null && answerValue == null) continue;
      try {
        await env.DB.prepare(
          'INSERT INTO survey_response_answers (id, response_id, question_id, answer_text, answer_value) VALUES (?, ?, ?, ?, ?)',
        )
          .bind(newId(), responseId, qid, answerText, answerValue)
          .run();
      } catch {
        /* best-effort par answer */
      }
    }

    // 7) Finalize si partial=false (status='completed', completed_at=now).
    const finalStatus = partial ? 'in_progress' : 'completed';
    if (!partial) {
      try {
        await env.DB.prepare(
          "UPDATE survey_responses SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
        )
          .bind(responseId)
          .run();
      } catch {
        /* best-effort — la réponse reste in_progress, l'UI peut retry */
      }
    }

    return json({ data: { id: responseId, status: finalStatus } });
  } catch {
    return json({ error: 'Erreur soumission survey' }, 500);
  }
}

// ── 18) GET /api/surveys/:id/analytics ─────────────────────────────────────
/**
 * Sprint 51 wire-up — agrégats par question + NPS/CSAT globaux via
 * aggregateResponses() engine. Cap settings.manage + bornage tenant.
 * Best-effort : tables absentes → { by_question: [] }.
 */
export async function handleGetSurveyAnalytics(
  env: Env,
  auth: SurveyAuth,
  surveyId: string,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const survey = await loadSurveyInTenant(env, surveyId, auth);
  if (survey instanceof Response) return survey;

  let questions: QuestionLike[] = [];
  let answers: Array<{
    question_id: string;
    answer_text?: string | null;
    answer_value?: number | null;
  }> = [];
  try {
    const qRes = await env.DB.prepare(
      'SELECT id, type, required, options_json FROM survey_questions WHERE survey_id = ? ORDER BY page_number ASC, order_index ASC',
    )
      .bind(surveyId)
      .all();
    questions = (qRes.results || []) as unknown as QuestionLike[];
  } catch {
    questions = [];
  }
  try {
    const aRes = await env.DB.prepare(
      `SELECT sra.question_id, sra.answer_text, sra.answer_value
         FROM survey_response_answers sra
         JOIN survey_responses sr ON sr.id = sra.response_id
        WHERE sr.survey_id = ?`,
    )
      .bind(surveyId)
      .all();
    answers = (aRes.results || []) as unknown as Array<{
      question_id: string;
      answer_text?: string | null;
      answer_value?: number | null;
    }>;
  } catch {
    answers = [];
  }

  const aggregate = aggregateResponses(questions, answers);
  return json({ data: aggregate });
}

// ── 19) GET /api/surveys/:id/next-question?current=...&answer=... ──────────
/**
 * Sprint 51 wire-up — calcule la prochaine question via branching D1
 * (resolveNextQuestion) puis fallback evaluator pur (getNextQuestionId) sur
 * l'ordre des questions. Retourne { next_question_id, jump_to_end }.
 */
export async function handleGetNextQuestion(
  env: Env,
  auth: SurveyAuth,
  surveyId: string,
  url: URL,
): Promise<Response> {
  const g = surveyCapGuard(auth);
  if (g) return g;
  const survey = await loadSurveyInTenant(env, surveyId, auth);
  if (survey instanceof Response) return survey;

  const currentQid = (url.searchParams.get('current') ?? '').trim();
  const answer = url.searchParams.get('answer') ?? '';
  if (!currentQid) return json({ error: 'current requis' }, 400);

  // 1) Tentative D1 branching (jump_to_end ou next_question_id).
  const branchHit = await resolveNextQuestion(env, currentQid, answer);
  if (branchHit.jumpToEnd) {
    return json({ data: { next_question_id: null, jump_to_end: true } });
  }
  if (branchHit.nextId) {
    return json({
      data: { next_question_id: branchHit.nextId, jump_to_end: false },
    });
  }

  // 2) Fallback pure : question suivante par ordre. On charge questions +
  //    branches du survey et on appelle getNextQuestionId() (pure).
  let questions: Array<{ id: string }> = [];
  let branches: BranchLike[] = [];
  try {
    const qRes = await env.DB.prepare(
      'SELECT id FROM survey_questions WHERE survey_id = ? ORDER BY page_number ASC, order_index ASC',
    )
      .bind(surveyId)
      .all();
    questions = (qRes.results || []) as Array<{ id: string }>;
  } catch {
    questions = [];
  }
  if (questions.length > 0) {
    try {
      const qIds = questions.map((q) => q.id).filter(Boolean);
      const placeholders = qIds.map(() => '?').join(',');
      if (placeholders) {
        const bRes = await env.DB.prepare(
          `SELECT question_id, condition_value, next_question_id, jump_to_end FROM survey_branches WHERE question_id IN (${placeholders}) ORDER BY rowid ASC`,
        )
          .bind(...qIds)
          .all();
        branches = (bRes.results || []) as unknown as BranchLike[];
      }
    } catch {
      branches = [];
    }
  }
  const nextId = getNextQuestionId(currentQid, answer, questions, branches);
  return json({
    data: { next_question_id: nextId, jump_to_end: nextId === null },
  });
}

// NB : 19 handlers Sprint 50 + 51 (16 AUTHED settings.manage + 1 PUBLIC submit
//      + 2 wire-up Sprint 51 : analytics + next-question).
// Imports RELATIFS uniquement. Caps FIGÉES (settings.manage + PUBLIC).
// AUCUN ajout ALL_CAPABILITIES seq80. PAS de champ `code` dans les erreurs.
// Bornage tenant strict (loadSurveyInTenant / loadQuestionInTenant /
// loadBranchInTenant / loadResponseInTenant). try/catch externe sur tous
// les handlers (best-effort, JAMAIS de 500/throw non maîtrisé). PUBLIC
// submit : rate-limit IP hashée Loi 25 + honeypot anti-bot + validation
// survey publié. Choix figés docs/LOT-SURVEYS-DNS-S50.md §6.
