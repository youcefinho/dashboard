// ── Sprint 41 — voice-agent.ts — Handlers REST AI Voice Agent (PHASE B) ────
// 7 handlers : 4 CRUD scripts + 1 test + 2 calls (list+detail).
// Routes câblées dans worker.ts dans le bloc protected AUTHED (après bloc S40
// abandoned-carts, AVANT bloc Sprint 23 sécurité).
// Ordre anti-shadowing strict : /scripts/:id/test AVANT /scripts/:id.
//
// Contrats GELÉS (docs/LOT-VOICE-AGENT-S41.md §6) :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)   ← JAMAIS de champ `code`
//
// Bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth IDOR).
// Garde capability `settings.manage` (FIGÉE seq80) au top de chaque handler.
// resolveClientId() = calque chat-widgets.ts:26 (getClientModules).

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit, sanitizeInput } from './helpers';
import { getClientModules } from './modules';
import {
  detectIntent,
  buildResponse,
  shouldEscalate,
  type VoiceAgentScript,
  // ── Sprint 41 renforcement (helpers IVR production-grade) ─────────────
  verifyTwilioVoiceSignature,
  safeXmlEscape,
  parseDtmfInput,
  twimlSay,
  twimlGather,
  twimlDial,
  twimlVoicemail,
  getCallState,
  transitionCallState,
  shouldForceEscalation,
  resetCallState,
  resolveTenantFromCallee,
  isWithinBusinessHours,
  recordingConsentNotice,
  detectIntentSync,
  MAX_INPUT_RETRIES,
} from './lib/voice-agent-engine';

type VoiceAgentAuth = CapAuth & { capabilities?: Set<string> };

// ── helpers locaux ──────────────────────────────────────────────────────────

/** Résout le client_id du tenant courant (calque chat-widgets.ts:26). */
async function resolveClientId(
  env: Env,
  auth: VoiceAgentAuth,
): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/** Parse intent_keywords_json en array de strings (best-effort). */
function parseKeywords(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

/** Normalise une row script DB → objet API (parse intent_keywords_json). */
function mapScriptRow(row: Record<string, unknown>): VoiceAgentScript {
  return {
    id: String(row.id ?? ''),
    client_id: String(row.client_id ?? ''),
    name: String(row.name ?? ''),
    intent_keywords: parseKeywords(row.intent_keywords_json),
    response_template: String(row.response_template ?? ''),
    escalation_threshold:
      typeof row.escalation_threshold === 'number' ? row.escalation_threshold : 0.7,
    is_active: row.is_active === 1 || row.is_active === true,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/** Valide un array d'intent_keywords (strings non vides). */
function validateKeywords(
  raw: unknown,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'intent_keywords doit être un tableau' };
  }
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || v.trim().length === 0 || v.length > 200) {
      return { ok: false, error: 'intent_keywords contient une entrée invalide' };
    }
    out.push(v.trim());
  }
  return { ok: true, value: out };
}

/** Clamp un threshold dans [0..1] avec défaut 0.7. */
function clampThreshold(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0.7;
  return Math.max(0, Math.min(1, raw));
}

// ── 4 handlers CRUD scripts ────────────────────────────────────────────────

/** GET /api/voice-agent/scripts — liste scripts du tenant courant. */
export async function handleListScripts(
  env: Env,
  auth: VoiceAgentAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, client_id, name, intent_keywords_json, response_template,
              escalation_threshold, is_active, created_at, updated_at
       FROM voice_agent_scripts
       WHERE client_id = ?
       ORDER BY name`,
    )
      .bind(clientId)
      .all();

    const rows = ((results || []) as Array<Record<string, unknown>>).map(mapScriptRow);
    return json({ data: rows });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** POST /api/voice-agent/scripts — créer un script. */
export async function handleCreateScript(
  request: Request,
  env: Env,
  auth: VoiceAgentAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // ── validation name ───────────────────────────────────────────────────
    const name = sanitizeInput(typeof body.name === 'string' ? body.name : '', 200);
    if (!name) {
      return json({ error: 'Le nom du script est requis' }, 400);
    }

    // ── validation intent_keywords ────────────────────────────────────────
    const kw = validateKeywords(body.intent_keywords);
    if (!kw.ok) return json({ error: kw.error }, 400);

    // ── validation response_template ──────────────────────────────────────
    const responseTemplate = sanitizeInput(
      typeof body.response_template === 'string' ? body.response_template : '',
      2000,
    );
    if (!responseTemplate) {
      return json({ error: 'Le response_template est requis' }, 400);
    }

    const escalationThreshold = clampThreshold(body.escalation_threshold);
    const isActive = body.is_active === false ? 0 : 1;

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const keywordsJson = JSON.stringify(kw.value);

    await env.DB.prepare(
      `INSERT INTO voice_agent_scripts
         (id, client_id, name, intent_keywords_json, response_template,
          escalation_threshold, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        clientId,
        name,
        keywordsJson,
        responseTemplate,
        escalationThreshold,
        isActive,
        nowIso,
        nowIso,
      )
      .run();

    await audit(env, auth.userId, 'voice_agent_script_created', 'voice_agent_script', id, {
      name,
      intent_keywords: kw.value,
      escalation_threshold: escalationThreshold,
    });

    const created: VoiceAgentScript = {
      id,
      client_id: clientId,
      name,
      intent_keywords: kw.value,
      response_template: responseTemplate,
      escalation_threshold: escalationThreshold,
      is_active: isActive === 1,
      created_at: nowIso,
      updated_at: nowIso,
    };
    return json({ data: created });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** PATCH /api/voice-agent/scripts/:id — update un script. */
export async function handleUpdateScript(
  request: Request,
  env: Env,
  auth: VoiceAgentAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    if (!id || typeof id !== 'string') {
      return json({ error: 'id invalide' }, 400);
    }
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Load existing (borné tenant) — refuse si pas trouvé.
    const existing = (await env.DB.prepare(
      `SELECT id, client_id, name, intent_keywords_json, response_template,
              escalation_threshold, is_active, created_at, updated_at
       FROM voice_agent_scripts
       WHERE id = ? AND client_id = ?`,
    )
      .bind(id, clientId)
      .first()) as Record<string, unknown> | null;
    if (!existing) {
      return json({ error: 'Script introuvable' }, 404);
    }

    // Build partial update.
    const updates: string[] = [];
    const params: unknown[] = [];

    let nextName: string | undefined;
    if (body.name !== undefined) {
      const n = sanitizeInput(typeof body.name === 'string' ? body.name : '', 200);
      if (!n) return json({ error: 'Le nom du script est requis' }, 400);
      nextName = n;
      updates.push('name = ?');
      params.push(n);
    }

    let nextKeywords: string[] | undefined;
    if (body.intent_keywords !== undefined) {
      const kw = validateKeywords(body.intent_keywords);
      if (!kw.ok) return json({ error: kw.error }, 400);
      nextKeywords = kw.value;
      updates.push('intent_keywords_json = ?');
      params.push(JSON.stringify(kw.value));
    }

    let nextTemplate: string | undefined;
    if (body.response_template !== undefined) {
      const t = sanitizeInput(
        typeof body.response_template === 'string' ? body.response_template : '',
        2000,
      );
      if (!t) return json({ error: 'Le response_template est requis' }, 400);
      nextTemplate = t;
      updates.push('response_template = ?');
      params.push(t);
    }

    let nextThreshold: number | undefined;
    if (body.escalation_threshold !== undefined) {
      nextThreshold = clampThreshold(body.escalation_threshold);
      updates.push('escalation_threshold = ?');
      params.push(nextThreshold);
    }

    let nextIsActive: number | undefined;
    if (body.is_active !== undefined) {
      nextIsActive = body.is_active === false || body.is_active === 0 ? 0 : 1;
      updates.push('is_active = ?');
      params.push(nextIsActive);
    }

    if (updates.length === 0) {
      // Rien à modifier — renvoyer l'existant tel quel.
      return json({ data: mapScriptRow(existing) });
    }

    const nowIso = new Date().toISOString();
    updates.push('updated_at = ?');
    params.push(nowIso);

    // bornage tenant : id + client_id
    params.push(id, clientId);

    await env.DB.prepare(
      `UPDATE voice_agent_scripts SET ${updates.join(', ')} WHERE id = ? AND client_id = ?`,
    )
      .bind(...params)
      .run();

    await audit(env, auth.userId, 'voice_agent_script_updated', 'voice_agent_script', id, {
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(nextKeywords !== undefined ? { intent_keywords: nextKeywords } : {}),
      ...(nextThreshold !== undefined ? { escalation_threshold: nextThreshold } : {}),
      ...(nextIsActive !== undefined ? { is_active: nextIsActive === 1 } : {}),
    });

    const merged: VoiceAgentScript = {
      id,
      client_id: clientId,
      name: nextName ?? String(existing.name ?? ''),
      intent_keywords:
        nextKeywords ?? parseKeywords(existing.intent_keywords_json),
      response_template: nextTemplate ?? String(existing.response_template ?? ''),
      escalation_threshold:
        nextThreshold ??
        (typeof existing.escalation_threshold === 'number'
          ? existing.escalation_threshold
          : 0.7),
      is_active:
        nextIsActive !== undefined
          ? nextIsActive === 1
          : existing.is_active === 1 || existing.is_active === true,
      created_at: String(existing.created_at ?? ''),
      updated_at: nowIso,
    };
    return json({ data: merged });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** DELETE /api/voice-agent/scripts/:id — soft-disable (is_active=0). */
export async function handleDeleteScript(
  env: Env,
  auth: VoiceAgentAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    if (!id || typeof id !== 'string') {
      return json({ error: 'id invalide' }, 400);
    }
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const existing = (await env.DB.prepare(
      'SELECT id FROM voice_agent_scripts WHERE id = ? AND client_id = ?',
    )
      .bind(id, clientId)
      .first()) as { id: string } | null;
    if (!existing) {
      return json({ error: 'Script introuvable' }, 404);
    }

    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      'UPDATE voice_agent_scripts SET is_active = 0, updated_at = ? WHERE id = ? AND client_id = ?',
    )
      .bind(nowIso, id, clientId)
      .run();

    await audit(env, auth.userId, 'voice_agent_script_deleted', 'voice_agent_script', id, {});

    return json({ data: { id, deleted: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 1 handler test (prédiction sans réel appel) ────────────────────────────

/**
 * POST /api/voice-agent/scripts/:id/test — teste le script avec un input échantillon.
 * AUCUN INSERT voice_agent_calls (test pur, pas d'audit).
 */
export async function handleTestScript(
  request: Request,
  env: Env,
  auth: VoiceAgentAuth,
  scriptId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    if (!scriptId || typeof scriptId !== 'string') {
      return json({ error: 'id invalide' }, 400);
    }
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const sampleInput = sanitizeInput(
      typeof body.sample_input === 'string' ? body.sample_input : '',
      2000,
    );
    if (!sampleInput) {
      return json({ error: 'sample_input est requis' }, 400);
    }
    const visitorName =
      typeof body.visitor_name === 'string' ? sanitizeInput(body.visitor_name, 200) : '';

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const row = (await env.DB.prepare(
      `SELECT id, client_id, name, intent_keywords_json, response_template,
              escalation_threshold, is_active, created_at, updated_at
       FROM voice_agent_scripts
       WHERE id = ? AND client_id = ?`,
    )
      .bind(scriptId, clientId)
      .first()) as Record<string, unknown> | null;
    if (!row) {
      return json({ error: 'Script introuvable' }, 404);
    }

    const script = mapScriptRow(row);
    const intentResult = await detectIntent(env, [script], sampleInput);

    if (intentResult.scriptId === script.id) {
      const responseText = buildResponse(script, {
        visitor_name: visitorName || undefined,
        intent: intentResult.intent || undefined,
      });
      const escalate = shouldEscalate(
        intentResult.confidence,
        script.escalation_threshold,
        sampleInput,
      );
      return json({
        data: {
          confidence: intentResult.confidence,
          response_text: responseText,
          would_escalate: escalate,
        },
      });
    }

    return json({
      data: {
        confidence: intentResult.confidence,
        response_text: null,
        would_escalate: true,
        reason: 'no_intent_match',
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 2 handlers calls (history + detail) ────────────────────────────────────

/** GET /api/voice-agent/calls — liste appels traités par l'AI. */
export async function handleListCalls(
  env: Env,
  auth: VoiceAgentAuth,
  url: URL,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const escalatedParam = url.searchParams.get('escalated');
    const scriptIdParam = url.searchParams.get('script_id');
    const limitRaw = url.searchParams.get('limit');
    let limit = 50;
    if (limitRaw) {
      const parsed = parseInt(limitRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) limit = Math.min(100, parsed);
    }

    const where: string[] = ['client_id = ?'];
    const params: unknown[] = [clientId];

    if (escalatedParam === '1' || escalatedParam === 'true') {
      where.push('escalated = 1');
    } else if (escalatedParam === '0' || escalatedParam === 'false') {
      where.push('escalated = 0');
    }

    if (scriptIdParam && typeof scriptIdParam === 'string') {
      where.push('script_id = ?');
      params.push(scriptIdParam);
    }

    params.push(limit);

    const { results } = await env.DB.prepare(
      `SELECT id, call_log_id, client_id, script_id, intent_detected, confidence,
              response_text, escalated, escalation_reason, duration_sec,
              transcript_full, created_at
       FROM voice_agent_calls
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
      .bind(...params)
      .all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** GET /api/voice-agent/calls/:id — détail d'un appel AI (+ join call_log). */
export async function handleGetCallDetail(
  env: Env,
  auth: VoiceAgentAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    if (!id || typeof id !== 'string') {
      return json({ error: 'id invalide' }, 400);
    }
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const call = (await env.DB.prepare(
      `SELECT id, call_log_id, client_id, script_id, intent_detected, confidence,
              response_text, escalated, escalation_reason, duration_sec,
              transcript_full, created_at
       FROM voice_agent_calls
       WHERE id = ? AND client_id = ?`,
    )
      .bind(id, clientId)
      .first()) as Record<string, unknown> | null;
    if (!call) {
      return json({ error: 'Appel introuvable' }, 404);
    }

    // Best-effort join call_logs (from_number, to_number, duration_sec).
    let callLog: Record<string, unknown> | null = null;
    if (call.call_log_id && typeof call.call_log_id === 'string') {
      try {
        callLog = (await env.DB.prepare(
          'SELECT from_number, to_number, duration_sec FROM call_logs WHERE id = ? AND client_id = ?',
        )
          .bind(call.call_log_id, clientId)
          .first()) as Record<string, unknown> | null;
      } catch {
        callLog = null;
      }
    }

    return json({ data: { ...call, call_log: callLog } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint 41 RENFORCEMENT — Twilio webhook handlers PUBLICS (IVR production-grade)
// ════════════════════════════════════════════════════════════════════════════
//
// 3 handlers neufs câblés sur les helpers renforcés de voice-agent-engine.ts :
//   - handleVoiceAgentIncoming   POST /api/voice-agent/twilio/incoming
//   - handleVoiceAgentGather     POST /api/voice-agent/twilio/gather
//   - handleVoiceAgentEscalate   POST /api/voice-agent/twilio/escalate
//
// SÉCURITÉ : signature Twilio TOUJOURS vérifiée via verifyTwilioVoiceSignature.
//   - FLAG INACTIF TWILIO_AUTH_TOKEN absent → bypass (mode dev, warning console).
//   - Token présent + signature invalide → 403 (rejet immédiat, pas de TwiML).
//
// MULTI-TENANT : tenant résolu via resolveTenantFromCallee(To) → clientId.
//   - Tenant introuvable → TwiML générique "numéro non attribué" + Hangup.
//
// STATE MACHINE : transitionCallState à chaque step, retries trackés.
//   - retries >= MAX_INPUT_RETRIES (3) → escalation forcée vers humain.
//
// XML-SAFE : tous les générateurs TwiML escapent automatiquement (anti-injection).
//
// CONTRAT : Twilio attend Content-Type: text/xml (PAS application/xml).
//   Status 200 sauf erreur signature (403) ou parse body (400).

/**
 * Callback URLs canoniques (sub-routes Twilio). Centralisé pour éviter le
 * hardcoding dispersé dans les TwiML generators.
 */
const GATHER_CALLBACK_PATH = '/api/voice-agent/twilio/gather';
const ESCALATE_CALLBACK_PATH = '/api/voice-agent/twilio/escalate';

/** Wrap TwiML payload dans une Response 200 text/xml. */
function twimlResponse(xml: string, status: number = 200): Response {
  return new Response(xml, {
    status,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/** Parse body form-urlencoded Twilio en Record<string,string> (best-effort). */
async function parseTwilioForm(request: Request): Promise<Record<string, string>> {
  try {
    const form = await request.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Vérifie la signature Twilio + warn console si bypass (FLAG INACTIF dev).
 * Retourne `null` si OK, `Response 403` si rejet (caller doit return).
 */
async function guardTwilioSignature(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response | null> {
  const token = (env as unknown as { TWILIO_AUTH_TOKEN?: string }).TWILIO_AUTH_TOKEN;
  if (!token) {
    // eslint-disable-next-line no-console
    console.warn(
      '[voice-agent] TWILIO_AUTH_TOKEN absent — signature bypass (dev mode).',
    );
    return null;
  }
  const ok = await verifyTwilioVoiceSignature(request, env, params);
  if (!ok) {
    return new Response('Forbidden — invalid Twilio signature', { status: 403 });
  }
  return null;
}

/**
 * Récupère les scripts actifs d'un tenant (best-effort, retourne [] si KO).
 */
async function loadActiveScripts(
  env: Env,
  clientId: string,
): Promise<VoiceAgentScript[]> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, name, intent_keywords_json, response_template,
              escalation_threshold, is_active, created_at, updated_at
       FROM voice_agent_scripts
       WHERE client_id = ? AND is_active = 1
       ORDER BY name`,
    )
      .bind(clientId)
      .all();
    return ((results || []) as Array<Record<string, unknown>>).map(mapScriptRow);
  } catch {
    return [];
  }
}

/**
 * POST /api/voice-agent/twilio/incoming — Twilio webhook entrant (premier hit).
 *
 * Pipeline :
 *   1. Vérifie signature Twilio (403 si invalide + token configuré)
 *   2. Parse body form-urlencoded (To, From, CallSid)
 *   3. Resolve tenant via To → clientId (best-effort)
 *   4. State machine : init session (incoming) puis transition → menu
 *   5. Business hours check → voicemail si fermé
 *   6. Génère TwiML <Gather> via twimlGather (DTMF + speech, redirect fallback)
 */
export async function handleVoiceAgentIncoming(
  request: Request,
  env: Env,
): Promise<Response> {
  // 1. Parse body AVANT verify (signature couvre les params POST).
  const params = await parseTwilioForm(request);

  // 2. Signature guard (403 si KO).
  const sigBlock = await guardTwilioSignature(request, env, params);
  if (sigBlock) return sigBlock;

  const callSid = typeof params.CallSid === 'string' ? params.CallSid : '';
  const toNumber = typeof params.To === 'string' ? params.To : '';

  // 3. State machine : init + transition incoming → (menu | escalation).
  if (callSid) {
    getCallState(callSid); // crée session 'incoming' si absente
  }

  // 4. Tenant resolution.
  const tenant = await resolveTenantFromCallee(env, toNumber);
  if (!tenant) {
    return twimlResponse(
      twimlSay(
        'Désolé, ce numéro n\'est pas attribué à un compte actif. Au revoir.',
      ),
    );
  }

  // 5. Business hours check (default lun-ven 8-20 UTC).
  if (!isWithinBusinessHours()) {
    // Hors heures : annonce + voicemail (PAS de menu interactif).
    const xml = twimlVoicemail(
      120,
      `Bonjour, vous avez joint notre service en dehors des heures d'ouverture. ${recordingConsentNotice('fr')} Veuillez laisser un message après le bip.`,
      ESCALATE_CALLBACK_PATH + '?mode=voicemail',
    );
    if (callSid) {
      transitionCallState(callSid, 'escalation');
    }
    return twimlResponse(xml);
  }

  // 6. Heures ouvrées : transition vers menu + TwiML <Gather>.
  if (callSid) {
    transitionCallState(callSid, 'menu');
  }
  const prompt =
    'Bonjour, vous avez joint notre assistant vocal. ' +
    'Décrivez en quelques mots la raison de votre appel, ou appuyez sur une touche.';
  const xml = twimlGather(prompt, GATHER_CALLBACK_PATH, 1, 6);
  return twimlResponse(xml);
}

/**
 * POST /api/voice-agent/twilio/gather — callback DTMF/speech depuis <Gather>.
 *
 * Pipeline :
 *   1. Signature guard
 *   2. Parse body (Digits, SpeechResult, CallSid, To)
 *   3. State machine : transition menu → input
 *   4. Sanitize input : parseDtmfInput pour Digits, sanitizeInput pour SpeechResult
 *   5. Resolve tenant + load scripts actifs
 *   6. detectIntentSync (no I/O latency-sensitive Twilio timeout ~10s)
 *   7. retries >= 3 → shouldForceEscalation → escalation TwiML
 *   8. Match intent → buildResponse + check shouldEscalate
 *   9. No match → input → menu (retry) avec compteur, ou escalation si seuil atteint
 */
export async function handleVoiceAgentGather(
  request: Request,
  env: Env,
): Promise<Response> {
  const params = await parseTwilioForm(request);
  const sigBlock = await guardTwilioSignature(request, env, params);
  if (sigBlock) return sigBlock;

  const callSid = typeof params.CallSid === 'string' ? params.CallSid : '';
  const toNumber = typeof params.To === 'string' ? params.To : '';
  const rawDigits = typeof params.Digits === 'string' ? params.Digits : '';
  const rawSpeech = typeof params.SpeechResult === 'string' ? params.SpeechResult : '';

  // 3. State machine : menu → input.
  if (callSid) {
    // Tolérant : si la session est 'incoming' (cas direct gather sans incoming
    // préalable, ex tests), on transitionne d'abord vers menu.
    if (getCallState(callSid) === 'incoming') {
      transitionCallState(callSid, 'menu');
    }
    transitionCallState(callSid, 'input');
  }

  // 4. Sanitize input.
  const dtmf = parseDtmfInput(rawDigits); // null si invalide (lettres etc.)
  const speech = rawSpeech ? sanitizeInput(rawSpeech, 500) : '';
  const userInput = dtmf || speech;

  // Input vide ou invalide (ex DTMF 'abc' rejeté + pas de speech).
  if (!userInput) {
    if (callSid) {
      transitionCallState(callSid, 'menu'); // retry (incrémente retries)
      if (shouldForceEscalation(callSid)) {
        transitionCallState(callSid, 'escalation');
        return handleEscalationFlow(env, toNumber, callSid, 'max_retries');
      }
    }
    const retryPrompt =
      `Je n'ai pas bien compris. Veuillez répéter ou taper une touche entre 0 et 9.`;
    return twimlResponse(twimlGather(retryPrompt, GATHER_CALLBACK_PATH, 1, 6));
  }

  // 5. Resolve tenant + scripts.
  const tenant = await resolveTenantFromCallee(env, toNumber);
  if (!tenant) {
    return twimlResponse(
      twimlSay('Désolé, votre compte n\'est plus actif. Au revoir.'),
    );
  }

  const scripts = await loadActiveScripts(env, tenant.clientId);

  // 6. detectIntentSync (no I/O, latency-safe).
  const intent = detectIntentSync(scripts, userInput);

  // 7. No match → retry ou escalation.
  if (!intent.scriptId || !intent.intent) {
    if (callSid) {
      transitionCallState(callSid, 'menu');
      if (shouldForceEscalation(callSid)) {
        transitionCallState(callSid, 'escalation');
        return handleEscalationFlow(env, toNumber, callSid, 'no_intent_match');
      }
    }
    return twimlResponse(
      twimlGather(
        'Désolé, je n\'ai pas compris votre demande. Pouvez-vous reformuler ?',
        GATHER_CALLBACK_PATH,
        1,
        6,
      ),
    );
  }

  // 8. Match → buildResponse + check escalation explicite (keyword "humain" etc.).
  const matchedScript = scripts.find((s) => s.id === intent.scriptId);
  if (!matchedScript) {
    // Race condition improbable (script supprimé entre detect et fetch).
    return handleEscalationFlow(env, toNumber, callSid, 'script_lost');
  }

  if (shouldEscalate(intent.confidence, matchedScript.escalation_threshold, userInput)) {
    if (callSid) transitionCallState(callSid, 'escalation');
    return handleEscalationFlow(env, toNumber, callSid, 'low_confidence_or_keyword');
  }

  // 9. Réponse confiante → buildResponse + transition routing → resolved.
  const responseText = buildResponse(matchedScript, {
    intent: matchedScript.name,
    visitor_name: '',
  });

  if (callSid) {
    transitionCallState(callSid, 'routing');
    transitionCallState(callSid, 'resolved');
  }

  return twimlResponse(twimlSay(responseText));
}

/**
 * POST /api/voice-agent/twilio/escalate — escalation endpoint (Dial humain ou Voicemail).
 *
 * Mode :
 *   - ?mode=voicemail → twimlVoicemail (CRTC consent annoncé)
 *   - default         → twimlDial vers TWILIO_FORWARD_TO (callerId TWILIO_PHONE_NUMBER)
 */
export async function handleVoiceAgentEscalate(
  request: Request,
  env: Env,
): Promise<Response> {
  const params = await parseTwilioForm(request);
  const sigBlock = await guardTwilioSignature(request, env, params);
  if (sigBlock) return sigBlock;

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'dial';
  const callSid = typeof params.CallSid === 'string' ? params.CallSid : '';
  const toNumber = typeof params.To === 'string' ? params.To : '';

  if (mode === 'voicemail') {
    if (callSid) {
      // Garde-fou : si état déjà terminal (resolved/dropped), reset puis init.
      const state = getCallState(callSid);
      if (state !== 'escalation') {
        // Best-effort, ignore si transition invalide.
        transitionCallState(callSid, 'escalation');
      }
    }
    const greeting =
      `${recordingConsentNotice('fr')} Veuillez laisser votre message après le bip.`;
    const xml = twimlVoicemail(120, greeting);
    if (callSid) {
      transitionCallState(callSid, 'resolved');
    }
    return twimlResponse(xml);
  }

  return handleEscalationFlow(env, toNumber, callSid, 'manual_escalate');
}

/**
 * Helper interne — génère TwiML escalation (Dial humain si configuré, sinon
 * voicemail). Centralise la logique partagée entre /gather (auto-escalate) et
 * /escalate (manual).
 */
async function handleEscalationFlow(
  env: Env,
  toNumber: string,
  callSid: string,
  reason: string,
): Promise<Response> {
  const envAny = env as unknown as {
    TWILIO_FORWARD_TO?: string;
    TWILIO_PHONE_NUMBER?: string;
  };
  const forwardTo = envAny.TWILIO_FORWARD_TO || '';
  const callerId = envAny.TWILIO_PHONE_NUMBER || toNumber || '';

  // Audit best-effort (non-bloquant, table call_logs si dispo).
  try {
    if (callSid) {
      await env.DB.prepare(
        `INSERT INTO voice_agent_calls
           (id, call_log_id, client_id, script_id, intent_detected, confidence,
            response_text, escalated, escalation_reason, duration_sec,
            transcript_full, created_at)
         VALUES (?, ?, NULL, NULL, NULL, 0, NULL, 1, ?, 0, NULL, ?)`,
      )
        .bind(crypto.randomUUID(), callSid, reason, new Date().toISOString())
        .run();
    }
  } catch {
    // best-effort, table peut ne pas exister en dev.
  }

  if (!forwardTo) {
    // Pas de numéro humain configuré → fallback voicemail consent CRTC.
    const greeting =
      `Notre équipe est indisponible pour l'instant. ${recordingConsentNotice('fr')} Veuillez laisser votre message après le bip.`;
    if (callSid) {
      // Force terminal (cleanup session).
      resetCallState(callSid);
    }
    return twimlResponse(twimlVoicemail(120, greeting));
  }

  // Forward vers humain (recording activé conformément CRTC + consent annoncé).
  const noticeXml = recordingConsentNotice('fr');
  // On annonce d'abord le consent (Say court), puis Dial. Twilio exécute en séquence.
  const dialXml = twimlDial(forwardTo, callerId, true, 30);
  // Compose : on prepend un Say de consent dans le Response (mini-merge XML safe).
  // twimlDial génère <?xml...?><Response><Dial...>…</Dial></Response>. On injecte
  // le Say juste après <Response>.
  const composed = dialXml.replace(
    '<Response>',
    `<Response><Say voice="Polly.Lea-Neural" language="fr-FR">${safeXmlEscape(noticeXml)}</Say>`,
  );

  if (callSid) {
    // Pas de transition strict vers 'resolved' ici : Twilio appellera potentiellement
    // status-callback. On laisse la session en 'escalation'.
    void MAX_INPUT_RETRIES; // tree-shake guard (helper importé mais peut être non-utilisé ailleurs)
  }
  return twimlResponse(composed);
}
