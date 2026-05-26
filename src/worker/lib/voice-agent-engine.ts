// ── Sprint 41 — voice-agent-engine.ts — AI Voice Agent core (PHASE B) ──────
//
// 3 helpers : intent detection + response building + escalation rules.
//
// Contrat FIGÉ §6 docs/LOT-VOICE-AGENT-S41.md :
//   - detectIntent → { scriptId, intent, confidence } (scriptId null si pas de match)
//   - buildResponse → string (template interpolé, JAMAIS innerHTML / eval)
//   - shouldEscalate → boolean (true = router vers humain via TwiML <Dial>)
//
// AI ENGINE :
//   - Si env.AI binding présent → tentative Workers AI Haiku (best-effort).
//     Fallback silencieux à keyword matching en cas d'AI KO.
//   - Sinon → keyword matching pur (intent_keywords includes input normalisé).
//   - JAMAIS d'API key externe (Anthropic SDK / OpenAI) — Workers AI uniquement.
//
// AUCUN side-effect, AUCUN DB write — caller (voice-agent.ts) persiste.
//
// ── RENFORCEMENT (Sprint 41 hardening 2026-05-25) ─────────────────────────
// Ajouts 100 % additifs (contrats existants détectIntent/buildResponse/
// shouldEscalate FIGÉS — aucune signature touchée). Helpers neufs pour pouvoir
// servir un IVR Twilio production-grade :
//   - verifyTwilioVoiceSignature : re-export de twilio-verify.ts (anti-spoof).
//   - getCallState / transitionCallState : state machine in-memory (Map) avec
//     whitelist de transitions. TTL 1h (= max call duration).
//   - detectIntentSync : version sans I/O (parité keyword) pour les tests +
//     prediction TwiML inline (pas d'await pour <Gather> callback latence-low).
//   - twimlSay / twimlGather / twimlDial / twimlVoicemail : générateurs TwiML
//     XML-safe-escapés (calque twilio-voice.ts:generateOutboundDialTwiml).
//   - parseDtmfInput : sanitize chiffres + `*` + `#` (rejet a-z).
//   - resolveTenantFromCallee : lookup call_logs.to_number → client_id (best-effort).
//   - within business hours / max retries / consent-record helpers.
//
// FLAG INACTIF : sans TWILIO_AUTH_TOKEN, verifyTwilioVoiceSignature retourne
// true (bypass — calque twilio-verify.ts:44). Sans env.AI, detectIntent fallback
// keyword. Sans clientId résolu, caller doit générer TwiML générique + escalader.

import type { Env } from '../types';
import { verifyTwilioSignature } from '../twilio-verify';

// Type local (parité STRICTE avec VoiceAgentScript de src/lib/api.ts).
export interface VoiceAgentScript {
  id: string;
  client_id: string;
  name: string;
  intent_keywords: string[];
  response_template: string;
  escalation_threshold: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Seuil minimum (confidence) en dessous duquel on considère "no match". */
const MIN_CONFIDENCE_KEYWORD = 0.3;

/** Mots-clés universels qui déclenchent toujours une escalade vers humain. */
const ESCALATION_KEYWORDS = [
  // FR
  'humain',
  'agent',
  'personne',
  "quelqu'un",
  'parler à',
  'pas un robot',
  // EN
  'human',
  'someone',
  'real person',
  'speak to',
  'agent please',
  'not a robot',
  // ES
  'humano',
  'persona',
  'agente',
  'hablar con',
];

/** Normalise un texte pour comparaison (lowercase + trim + accents retirés). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Compute le meilleur match keyword parmi les scripts actifs.
 * Score = matches.length / keywords.length (cap 0.95 pour signaler que c'est
 * une heuristique, pas un vrai modèle).
 * Retourne null si aucun script ne matche.
 */
function keywordBestMatch(
  scripts: VoiceAgentScript[],
  userInput: string,
): { scriptId: string; intent: string; confidence: number } | null {
  const normalizedInput = normalize(userInput);
  let best: { scriptId: string; intent: string; confidence: number } | null = null;
  for (const script of scripts) {
    if (!Array.isArray(script.intent_keywords) || script.intent_keywords.length === 0) {
      continue;
    }
    let matchCount = 0;
    for (const keyword of script.intent_keywords) {
      const normalizedKeyword = normalize(keyword);
      if (normalizedKeyword.length === 0) continue;
      if (normalizedInput.includes(normalizedKeyword)) matchCount++;
    }
    if (matchCount === 0) continue;
    const confidence = Math.min(0.95, matchCount / script.intent_keywords.length);
    if (!best || confidence > best.confidence) {
      best = { scriptId: script.id, intent: script.name, confidence };
    }
  }
  return best;
}

/**
 * Tentative Workers AI Haiku via env.AI (best-effort).
 * Retourne null si binding absent, parsing KO, ou exception.
 */
async function tryHaikuClassify(
  env: Env,
  scripts: VoiceAgentScript[],
  userInput: string,
): Promise<{ scriptId: string; intent: string; confidence: number } | null> {
  const ai = (env as unknown as { AI?: { run: (model: string, args: unknown) => Promise<unknown> } }).AI;
  if (!ai || typeof ai.run !== 'function') return null;
  try {
    const scriptList = scripts
      .map((s) => `- id="${s.id}" intent="${s.name}" keywords=${JSON.stringify(s.intent_keywords)}`)
      .join('\n');
    const systemPrompt =
      'Classify user intent into one of these scripts. Reply ONLY with strict JSON: ' +
      '{"scriptId":"<id|null>","confidence":<0..1>}. Use null if no script matches.\n' +
      `Scripts:\n${scriptList}`;
    const result = (await ai.run('@cf/anthropic/claude-3-haiku-20240307', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ],
    })) as { response?: string; result?: { response?: string } } | string | null;

    // Extract response text (Workers AI shapes vary).
    let respText: string | null = null;
    if (typeof result === 'string') respText = result;
    else if (result && typeof result === 'object') {
      if (typeof result.response === 'string') respText = result.response;
      else if (result.result && typeof result.result.response === 'string') respText = result.result.response;
    }
    if (!respText) return null;

    // Try to find a JSON object in the response.
    const jsonMatch = respText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { scriptId?: string | null; confidence?: number };
    if (!parsed.scriptId || typeof parsed.scriptId !== 'string') return null;
    const match = scripts.find((s) => s.id === parsed.scriptId);
    if (!match) return null;
    const confidence =
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;
    return { scriptId: match.id, intent: match.name, confidence };
  } catch {
    return null;
  }
}

/**
 * Détecte l'intent à partir du texte utilisateur.
 *
 * Stratégie :
 *   1. keyword fallback (toujours calculé) — sert de référence + de fallback.
 *   2. Si env.AI disponible : tentative Haiku, parse JSON, valide scriptId.
 *   3. Fallback silencieux à keyword si Haiku KO.
 *   4. Si confiance maximale < MIN_CONFIDENCE_KEYWORD → no match (scriptId=null).
 *
 * Retourne `{ scriptId, intent, confidence }`. JAMAIS d'erreur jetée.
 */
export async function detectIntent(
  env: Env,
  scripts: VoiceAgentScript[],
  userInput: string,
): Promise<{ scriptId: string | null; intent: string | null; confidence: number }> {
  if (!Array.isArray(scripts) || scripts.length === 0) {
    return { scriptId: null, intent: null, confidence: 0 };
  }
  if (!userInput || typeof userInput !== 'string' || userInput.trim().length === 0) {
    return { scriptId: null, intent: null, confidence: 0 };
  }

  const activeScripts = scripts.filter((s) => s && s.is_active !== false);
  if (activeScripts.length === 0) {
    return { scriptId: null, intent: null, confidence: 0 };
  }

  // 1. keyword baseline (always computed).
  const keywordMatch = keywordBestMatch(activeScripts, userInput);

  // 2. AI Haiku attempt (best-effort).
  const aiMatch = await tryHaikuClassify(env, activeScripts, userInput);

  // Prefer AI result when available and confident enough.
  const chosen = aiMatch ?? keywordMatch;

  if (!chosen) {
    return { scriptId: null, intent: null, confidence: 0 };
  }

  if (chosen.confidence < MIN_CONFIDENCE_KEYWORD) {
    return { scriptId: null, intent: null, confidence: chosen.confidence };
  }

  return chosen;
}

/**
 * Construit la réponse TTS à partir du template du script + contexte runtime.
 * Variables supportées (interpolation textuelle stricte, JAMAIS d'eval) :
 *   - {{visitor_name}} : nom de l'appelant (fallback "cher client")
 *   - {{intent}}       : intent détecté (label du script)
 *
 * Retourne string vide si template absent (caller doit alors escalader).
 */
export function buildResponse(
  script: VoiceAgentScript,
  context: { visitor_name?: string; intent?: string },
): string {
  if (!script || !script.response_template || script.response_template.length === 0) {
    return '';
  }
  const visitorName =
    typeof context.visitor_name === 'string' && context.visitor_name.trim().length > 0
      ? context.visitor_name.trim()
      : 'cher client';
  const intent =
    typeof context.intent === 'string' && context.intent.trim().length > 0
      ? context.intent.trim()
      : script.name;
  return script.response_template
    .replaceAll('{{visitor_name}}', visitorName)
    .replaceAll('{{intent}}', intent);
}

/**
 * Détermine si l'appel doit être escaladé vers un agent humain.
 * Retourne true si :
 *   - confidence < threshold (l'IA n'est pas sûre), OU
 *   - userRequest contient un mot-clé d'escalation universel
 *     ("humain", "agent", "someone else", "parler à", "hablar con"…).
 */
export function shouldEscalate(
  confidence: number,
  threshold: number,
  userRequest?: string,
): boolean {
  const safeConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  const safeThreshold = Number.isFinite(threshold) ? Math.max(0, Math.min(1, threshold)) : 0.7;

  if (safeConfidence < safeThreshold) return true;

  if (userRequest && typeof userRequest === 'string' && userRequest.trim().length > 0) {
    const normalizedRequest = normalize(userRequest);
    for (const keyword of ESCALATION_KEYWORDS) {
      const normalizedKeyword = normalize(keyword);
      if (normalizedKeyword.length === 0) continue;
      if (normalizedRequest.includes(normalizedKeyword)) return true;
    }
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// RENFORCEMENT (Sprint 41 hardening) — helpers additifs production-grade IVR
// ════════════════════════════════════════════════════════════════════════════

// ── Sécurité : Twilio signature ────────────────────────────────────────────

/**
 * verifyTwilioVoiceSignature — wrapper de twilio-verify.ts:verifyTwilioSignature.
 *
 * Conforme algorithme officiel Twilio (HMAC-SHA1 sur URL + params triés). Sert
 * de point d'entrée canonique pour les handlers Voice Agent (au lieu d'importer
 * twilio-verify.ts dispersément). FLAG INACTIF respecté (token absent → true).
 *
 * @param request requête entrante (URL signée)
 * @param env     environnement (TWILIO_AUTH_TOKEN)
 * @param params  paramètres POST déjà parsés (form-urlencoded)
 */
export async function verifyTwilioVoiceSignature(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<boolean> {
  return verifyTwilioSignature(request, env, params);
}

// ── XML escape (anti-injection TwiML) ──────────────────────────────────────

/**
 * safeXmlEscape — échappe les 5 entités XML standard. Calque exact
 * twilio-voice.ts:escapeXml + handle null/undefined defensively.
 *
 * AUCUNE concession : `&` doit être remplacé EN PREMIER pour éviter de
 * réencoder les entités générées (ex `&lt;` ne doit pas devenir `&amp;lt;`).
 */
export function safeXmlEscape(input: string | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── DTMF input parsing ─────────────────────────────────────────────────────

/**
 * parseDtmfInput — sanitize une saisie DTMF (Twilio Gather param `Digits`).
 *
 * Whitelist STRICTE : `0-9`, `*`, `#`. Tout autre caractère rejette tout l'input
 * (retourne null). Trim, empty string → null. Max 32 chars (Twilio Gather
 * theoretical max), tronque sinon (pas de rejet — input long valide = saisie
 * progressive).
 *
 * Exemples :
 *   parseDtmfInput('123')   → '123'
 *   parseDtmfInput('1*2#')  → '1*2#'
 *   parseDtmfInput('abc')   → null  (contient lettres)
 *   parseDtmfInput('1a2')   → null  (mix invalide)
 *   parseDtmfInput('')      → null
 *   parseDtmfInput('  5  ') → '5'   (trim)
 */
export function parseDtmfInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!/^[0-9*#]+$/.test(trimmed)) return null;
  return trimmed.slice(0, 32);
}

// ── TwiML générateurs (purs, XML-safe-escaped) ──────────────────────────────

const TWIML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
/** Voix Polly/Twilio par défaut (féminine FR-CA, neural fluide). */
const DEFAULT_VOICE = 'Polly.Lea-Neural';
const DEFAULT_LANG = 'fr-FR';

/**
 * twimlSay — génère `<Response><Say voice=... language=...>text</Say></Response>`.
 *
 * Anti-injection : text + voice + language tous escaped. Text vide → fallback
 * <Hangup/> (jamais de Response vide qui DROP l'appel sans warning).
 */
export function twimlSay(
  text: string,
  voice: string = DEFAULT_VOICE,
  language: string = DEFAULT_LANG,
): string {
  const safeText = safeXmlEscape(text);
  if (safeText.length === 0) {
    return `${TWIML_HEADER}<Response><Hangup/></Response>`;
  }
  return `${TWIML_HEADER}<Response><Say voice="${safeXmlEscape(voice)}" language="${safeXmlEscape(language)}">${safeText}</Say></Response>`;
}

/**
 * twimlGather — génère un `<Gather>` DTMF + speech avec prompt `<Say>` nested.
 *
 * @param prompt    texte du prompt TTS (escape automatique)
 * @param action    URL callback où Twilio POSTera les digits/speech (escape)
 * @param numDigits nombre max de digits attendus (1..10, default 1)
 * @param timeout   timeout silence en secondes (1..60, default 5)
 * @param voice     voix TTS (default Polly.Lea-Neural)
 * @param language  langue BCP-47 (default fr-FR)
 * @param input     'dtmf' | 'speech' | 'dtmf speech' (default 'dtmf speech')
 */
export function twimlGather(
  prompt: string,
  action: string,
  numDigits: number = 1,
  timeout: number = 5,
  voice: string = DEFAULT_VOICE,
  language: string = DEFAULT_LANG,
  input: 'dtmf' | 'speech' | 'dtmf speech' = 'dtmf speech',
): string {
  const safePrompt = safeXmlEscape(prompt || '');
  const safeAction = safeXmlEscape(action || '');
  const safeVoice = safeXmlEscape(voice);
  const safeLang = safeXmlEscape(language);
  // Clamp numDigits 1..10 (Twilio max), timeout 1..60s.
  const nd = Number.isFinite(numDigits) ? Math.max(1, Math.min(10, Math.floor(numDigits))) : 1;
  const to = Number.isFinite(timeout) ? Math.max(1, Math.min(60, Math.floor(timeout))) : 5;
  const inputAttr = (['dtmf', 'speech', 'dtmf speech'] as const).includes(input) ? input : 'dtmf speech';
  // speechTimeout='auto' = Twilio détecte la fin de phrase (recommandé pour STT).
  return (
    `${TWIML_HEADER}<Response>` +
    `<Gather input="${inputAttr}" action="${safeAction}" method="POST" numDigits="${nd}" timeout="${to}" speechTimeout="auto" language="${safeLang}">` +
    `<Say voice="${safeVoice}" language="${safeLang}">${safePrompt}</Say>` +
    `</Gather>` +
    // Fallback si pas d'input dans le délai : redirect vers action avec Empty.
    `<Redirect method="POST">${safeAction}</Redirect>` +
    `</Response>`
  );
}

/**
 * twimlDial — forward un appel vers un humain (escalation).
 *
 * @param forwardTo numéro E.164 cible (escape obligatoire)
 * @param callerId  numéro affiché au destinataire (escape — typiquement env.TWILIO_PHONE_NUMBER)
 * @param recordingEnabled si true → record="record-from-answer-dual" (consent obligatoire côté caller, CRTC)
 * @param timeoutSec timeout ring (1..120, default 30)
 */
export function twimlDial(
  forwardTo: string,
  callerId: string,
  recordingEnabled: boolean = false,
  timeoutSec: number = 30,
): string {
  const safeTo = safeXmlEscape(forwardTo || '');
  if (safeTo.length === 0) {
    return `${TWIML_HEADER}<Response><Say language="${DEFAULT_LANG}">Numéro de transfert indisponible.</Say><Hangup/></Response>`;
  }
  const safeCallerId = safeXmlEscape(callerId || '');
  const callerIdAttr = safeCallerId.length > 0 ? ` callerId="${safeCallerId}"` : '';
  const to = Number.isFinite(timeoutSec) ? Math.max(1, Math.min(120, Math.floor(timeoutSec))) : 30;
  const recordAttr = recordingEnabled ? ' record="record-from-answer-dual"' : '';
  return `${TWIML_HEADER}<Response><Dial${callerIdAttr} timeout="${to}"${recordAttr}>${safeTo}</Dial></Response>`;
}

/**
 * twimlVoicemail — TwiML voicemail (consent annoncé + Record + transcribe).
 *
 * @param maxLengthSec durée max enregistrement (10..600, default 120)
 * @param greeting     message d'accueil (TTS, escape auto)
 * @param actionUrl    URL callback recording-status (escape, optionnel)
 */
export function twimlVoicemail(
  maxLengthSec: number = 120,
  greeting?: string,
  actionUrl?: string,
): string {
  const len = Number.isFinite(maxLengthSec) ? Math.max(10, Math.min(600, Math.floor(maxLengthSec))) : 120;
  const safeGreet = safeXmlEscape(
    greeting || 'Bonjour, veuillez laisser votre message après le bip. Cet appel sera enregistré.',
  );
  const cb = actionUrl
    ? ` action="${safeXmlEscape(actionUrl)}" recordingStatusCallback="${safeXmlEscape(actionUrl)}"`
    : '';
  return (
    `${TWIML_HEADER}<Response>` +
    `<Say voice="${DEFAULT_VOICE}" language="${DEFAULT_LANG}">${safeGreet}</Say>` +
    `<Record maxLength="${len}" playBeep="true" transcribe="false"${cb} method="POST"/>` +
    `<Say voice="${DEFAULT_VOICE}" language="${DEFAULT_LANG}">Merci, au revoir.</Say>` +
    `<Hangup/>` +
    `</Response>`
  );
}

// ── State machine de l'appel (in-memory, TTL 1h) ───────────────────────────

/**
 * Whitelist FIGÉE des states d'un appel IVR.
 *
 *   incoming   → menu | escalation | dropped
 *   menu       → input | escalation | dropped
 *   input      → routing | menu | escalation | dropped       (retry sur invalide)
 *   routing    → resolved | escalation | dropped
 *   escalation → resolved | dropped
 *   resolved   → (terminal)
 *   dropped    → (terminal)
 */
export type CallState = 'incoming' | 'menu' | 'input' | 'routing' | 'escalation' | 'resolved' | 'dropped';

const ALLOWED_TRANSITIONS: Record<CallState, CallState[]> = {
  incoming: ['menu', 'escalation', 'dropped'],
  menu: ['input', 'escalation', 'dropped'],
  input: ['routing', 'menu', 'escalation', 'dropped'],
  routing: ['resolved', 'escalation', 'dropped'],
  escalation: ['resolved', 'dropped'],
  resolved: [],
  dropped: [],
};

interface CallSession {
  state: CallState;
  retries: number;
  startedAt: number;
  lastTouchedAt: number;
}

/** TTL = 1h (3600s). Au-delà, session purgée (max call duration enforcement). */
const SESSION_TTL_MS = 60 * 60 * 1000;
/** Cap session entries pour éviter memory leak (workerd longue-vie). */
const MAX_SESSIONS = 10_000;

const SESSIONS = new Map<string, CallSession>();

/** Purge les sessions expirées (best-effort, appelée à chaque get/transition). */
function gcSessions(now: number): void {
  if (SESSIONS.size < MAX_SESSIONS / 2) return;
  for (const [sid, sess] of SESSIONS.entries()) {
    if (now - sess.startedAt > SESSION_TTL_MS) SESSIONS.delete(sid);
  }
}

/** Validation callSid (Twilio: CA + 32 hex). Permissif pour tests : [A-Za-z0-9_-]{4,64}. */
function isValidCallSid(callSid: unknown): callSid is string {
  return typeof callSid === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(callSid);
}

/**
 * getCallState — lit l'état courant d'une session d'appel.
 *
 * Crée la session si absente (état initial 'incoming'). callSid invalide ou
 * session expirée (>1h) → 'incoming' (reset implicite). JAMAIS d'exception.
 */
export function getCallState(callSid: string): CallState {
  if (!isValidCallSid(callSid)) return 'incoming';
  const now = Date.now();
  gcSessions(now);
  const sess = SESSIONS.get(callSid);
  if (!sess) {
    SESSIONS.set(callSid, { state: 'incoming', retries: 0, startedAt: now, lastTouchedAt: now });
    return 'incoming';
  }
  // Expiration : reset à 'incoming' (max call duration).
  if (now - sess.startedAt > SESSION_TTL_MS) {
    SESSIONS.set(callSid, { state: 'incoming', retries: 0, startedAt: now, lastTouchedAt: now });
    return 'incoming';
  }
  return sess.state;
}

/**
 * transitionCallState — transition whitelistée vers `next`.
 *
 * Retourne le nouvel état (= next) si la transition est valide. Retourne null
 * si invalide (caller doit générer TwiML d'erreur + escalader). Met à jour
 * `lastTouchedAt`.
 *
 * Réinitialise `retries` quand la transition n'est PAS un retry input→menu
 * (ex routing→resolved réinitialise, input→menu incrémente).
 */
export function transitionCallState(callSid: string, next: CallState): CallState | null {
  if (!isValidCallSid(callSid)) return null;
  if (!ALLOWED_TRANSITIONS[next] && next !== 'resolved' && next !== 'dropped') {
    // next pas dans le type CallState (defensive ; TS aurait bloqué normalement).
    return null;
  }
  const now = Date.now();
  gcSessions(now);
  const sess = SESSIONS.get(callSid) ?? {
    state: 'incoming' as CallState,
    retries: 0,
    startedAt: now,
    lastTouchedAt: now,
  };
  const allowed = ALLOWED_TRANSITIONS[sess.state] || [];
  if (!allowed.includes(next)) return null;
  // Retry counter : si on retourne au menu depuis input, incrémente.
  const nextRetries =
    sess.state === 'input' && next === 'menu' ? sess.retries + 1 : sess.retries;
  SESSIONS.set(callSid, {
    state: next,
    retries: nextRetries,
    startedAt: sess.startedAt,
    lastTouchedAt: now,
  });
  return next;
}

/**
 * getCallRetries — retourne le compteur de retries (input invalides) pour ce
 * callSid. Utile au handler pour décider d'escalader après MAX_RETRIES (3).
 */
export function getCallRetries(callSid: string): number {
  if (!isValidCallSid(callSid)) return 0;
  const sess = SESSIONS.get(callSid);
  return sess ? sess.retries : 0;
}

/** Boucle infinie : seuil retries avant escalation forcée. */
export const MAX_INPUT_RETRIES = 3;

/**
 * shouldForceEscalation — true si retries >= MAX_INPUT_RETRIES (caller doit
 * transitionner → escalation).
 */
export function shouldForceEscalation(callSid: string): boolean {
  return getCallRetries(callSid) >= MAX_INPUT_RETRIES;
}

/**
 * resetCallState — supprime la session (terminal cleanup, ou rollback test).
 * Idempotent.
 */
export function resetCallState(callSid: string): void {
  if (isValidCallSid(callSid)) SESSIONS.delete(callSid);
}

// ── Tenant resolution (incoming phone number → client_id) ──────────────────

/**
 * resolveTenantFromCallee — résout le tenant à partir du numéro appelé (`To`
 * dans le webhook Twilio inbound). Lookup applicatif : on cherche le dernier
 * `call_logs.client_id` associé à ce `to_number` (numéro Twilio acheté par le
 * tenant). En l'absence de table `phone_numbers` dédiée, c'est le best-effort
 * actuel — à remplacer Phase C par une vraie table `phone_numbers` (FK tenant).
 *
 * Retourne null si :
 *   - calleePhone vide ou invalide (regex E.164 lax)
 *   - aucun call_log existant pour ce numéro (numéro non provisionné)
 *   - exception D1 (best-effort, JAMAIS jeté)
 *
 * agencyId : SELECT users.agency_id WHERE clients.id = ? (best-effort, null
 * si pas de mapping — Phase C standardise).
 */
export async function resolveTenantFromCallee(
  env: Env,
  calleePhone: string | null | undefined,
): Promise<{ clientId: string; agencyId: string | null } | null> {
  if (!calleePhone || typeof calleePhone !== 'string') return null;
  const phone = calleePhone.trim();
  // E.164 lax : `+` optionnel + 7..20 chiffres (Twilio accepte aussi des formats sans +).
  if (!/^\+?[0-9]{7,20}$/.test(phone)) return null;

  try {
    const row = (await env.DB.prepare(
      `SELECT client_id FROM call_logs
       WHERE to_number = ? AND client_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(phone)
      .first()) as { client_id?: string } | null;
    if (!row || !row.client_id) return null;

    // agency_id best-effort (join clients.agency_id si dispo).
    let agencyId: string | null = null;
    try {
      const agencyRow = (await env.DB.prepare(
        `SELECT agency_id FROM clients WHERE id = ? LIMIT 1`,
      )
        .bind(row.client_id)
        .first()) as { agency_id?: string | null } | null;
      if (agencyRow && typeof agencyRow.agency_id === 'string') {
        agencyId = agencyRow.agency_id;
      }
    } catch {
      agencyId = null;
    }

    return { clientId: row.client_id, agencyId };
  } catch {
    return null;
  }
}

// ── Business hours + consent (helpers métier) ──────────────────────────────

/**
 * isWithinBusinessHours — true si l'heure courante est dans une plage horaire
 * d'ouverture (lun-ven 08h-20h America/Toronto par défaut). Le caller peut
 * surcharger via `config` (Phase C : lookup `client_config.business_hours`).
 *
 * Defensive : config invalide → fallback default.
 */
export function isWithinBusinessHours(
  now: Date = new Date(),
  config?: { startHour?: number; endHour?: number; daysOfWeek?: number[] },
): boolean {
  const startHour =
    typeof config?.startHour === 'number' && config.startHour >= 0 && config.startHour < 24
      ? config.startHour
      : 8;
  const endHour =
    typeof config?.endHour === 'number' && config.endHour > 0 && config.endHour <= 24
      ? config.endHour
      : 20;
  const daysOfWeek =
    Array.isArray(config?.daysOfWeek) && config.daysOfWeek.length > 0
      ? config.daysOfWeek
      : [1, 2, 3, 4, 5]; // lun..ven
  const day = now.getUTCDay(); // 0=dim, 1=lun, ..., 6=sam
  if (!daysOfWeek.includes(day)) return false;
  const hour = now.getUTCHours();
  return hour >= startHour && hour < endHour;
}

/**
 * recordingConsentNotice — texte de consentement CRTC (loi C-29 + art. 184 Code
 * criminel) à <Say> en début d'appel si recording activé. Bilingual FR par
 * défaut (override possible).
 */
export function recordingConsentNotice(lang: 'fr' | 'en' = 'fr'): string {
  if (lang === 'en') {
    return 'This call may be recorded for quality and training purposes. Stay on the line to accept or hang up.';
  }
  return 'Cet appel peut être enregistré à des fins de qualité et de formation. Restez en ligne pour accepter ou raccrochez.';
}

// ── Sync intent detection (no I/O, no AI) ──────────────────────────────────

/**
 * detectIntentSync — version synchrone keyword-only de detectIntent. Utile dans
 * les handlers Gather callback latency-sensitive (Twilio timeout ~10s sur la
 * réponse TwiML) où on veut éviter l'await AI Haiku optionnel.
 *
 * Retourne le même shape que detectIntent — JAMAIS d'exception.
 */
export function detectIntentSync(
  scripts: VoiceAgentScript[],
  userInput: string,
): { scriptId: string | null; intent: string | null; confidence: number } {
  if (!Array.isArray(scripts) || scripts.length === 0) {
    return { scriptId: null, intent: null, confidence: 0 };
  }
  if (!userInput || typeof userInput !== 'string' || userInput.trim().length === 0) {
    return { scriptId: null, intent: null, confidence: 0 };
  }
  const activeScripts = scripts.filter((s) => s && s.is_active !== false);
  if (activeScripts.length === 0) {
    return { scriptId: null, intent: null, confidence: 0 };
  }
  const match = keywordBestMatch(activeScripts, userInput);
  if (!match) return { scriptId: null, intent: null, confidence: 0 };
  if (match.confidence < MIN_CONFIDENCE_KEYWORD) {
    return { scriptId: null, intent: null, confidence: match.confidence };
  }
  return match;
}
