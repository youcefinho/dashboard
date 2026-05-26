// ── lib/telephony-engine.ts — RENFORCEMENT Communication P1 (telephony.ts) ───
//
// Helpers PURS (zéro I/O, zéro D1, zéro fetch — pas de Twilio API) extraits/
// dérivés de telephony.ts pour rendre testables :
//   - validation E.164 stricte (anti-injection),
//   - whitelist statut Twilio (queued/initiated/ringing/answered/in-progress/
//     completed/busy/no-answer/canceled/failed),
//   - validation consentement CRTC pour outbound QC,
//   - parse webhook Twilio (status-callback form-urlencoded),
//   - construction TwiML XML (Say/Gather/Dial/Hangup/Redirect/Record),
//   - validation config IVR (max-depth + options whitelist).
//
// AUCUNE dépendance Worker (Env, D1, fetch) → 100 % unit-testable.
// Module ADDITIF : telephony.ts continue de fonctionner inchangé.

// ════════════════════════════════════════════════════════════════════════════
//  CODES ERREUR STABLES
// ════════════════════════════════════════════════════════════════════════════

export const TELEPHONY_ERROR_CODES = {
  INVALID_PHONE: 'invalid_phone',
  INVALID_CALL_STATUS: 'invalid_call_status',
  CONSENT_REQUIRED: 'consent_required',
  CONSENT_INVALID: 'consent_invalid',
  INVALID_IVR_CONFIG: 'invalid_ivr_config',
  IVR_DEPTH_EXCEEDED: 'ivr_depth_exceeded',
  IVR_OPTION_INVALID: 'ivr_option_invalid',
  INVALID_STATUS_CALLBACK: 'invalid_status_callback',
  INVALID_TWIML_INPUT: 'invalid_twiml_input',
} as const;

export type TelephonyErrorCode =
  (typeof TELEPHONY_ERROR_CODES)[keyof typeof TELEPHONY_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
//  ENUMS FROZEN — Twilio call status (officiel)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Statuts Twilio officiels (https://www.twilio.com/docs/voice/api/call-resource#call-status-values)
 * + 'mock' interne (FLAG INACTIF sans credentials).
 */
export const VALID_CALL_STATUSES = Object.freeze([
  'queued',
  'initiated',
  'ringing',
  'in-progress',
  'answered',
  'completed',
  'busy',
  'no-answer',
  'canceled',
  'failed',
  'mock',
] as const);
export type CallStatus = (typeof VALID_CALL_STATUSES)[number];

const VALID_CALL_STATUS_SET = new Set<string>(VALID_CALL_STATUSES);

/** Statuts qui qualifient un appel manqué (déclenchent tâche rappel). */
export const MISSED_CALL_STATUSES = Object.freeze(['no-answer', 'failed', 'busy', 'canceled'] as const);
const MISSED_CALL_STATUS_SET = new Set<string>(MISSED_CALL_STATUSES);

/** Directions valides (calque telephony.ts CallLogRow). */
export const VALID_CALL_DIRECTIONS = Object.freeze(['inbound', 'outbound'] as const);
export type CallDirection = (typeof VALID_CALL_DIRECTIONS)[number];

// ════════════════════════════════════════════════════════════════════════════
//  CAPS
// ════════════════════════════════════════════════════════════════════════════

export const IVR_MAX_DEPTH = 3;
export const IVR_MAX_OPTIONS_PER_MENU = 10;
export const IVR_VALID_ACTIONS = Object.freeze(['dial', 'voicemail', 'submenu', 'hangup'] as const);
const IVR_VALID_ACTION_SET = new Set<string>(IVR_VALID_ACTIONS);

// ════════════════════════════════════════════════════════════════════════════
//  Helpers purs
// ════════════════════════════════════════════════════════════════════════════

/**
 * E.164 strict : `+`, premier digit 1-9, total 8-15 chiffres.
 * Pas d'espaces, pas de tirets, pas de parenthèses.
 */
export function validatePhoneE164(phone: unknown): boolean {
  if (typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  if (!trimmed) return false;
  return /^\+[1-9]\d{7,14}$/.test(trimmed);
}

/** Guard rapide pour un statut Twilio (frozen whitelist). */
export function isValidCallStatus(status: unknown): status is CallStatus {
  return typeof status === 'string' && VALID_CALL_STATUS_SET.has(status);
}

/** Statut "manqué" — sert à créer une tâche rappel (cf. telephony.ts:663). */
export function isMissedCallStatus(status: unknown): boolean {
  return typeof status === 'string' && MISSED_CALL_STATUS_SET.has(status);
}

/**
 * CRTC bi-party : pour outbound QC avec enregistrement, le consent doit être
 * explicitement obtenu (true) avant la mise en relation. Tout autre input
 * (false, undefined, string) ⇒ rejet.
 */
export function validateCrtcConsent(consent: unknown): boolean {
  return consent === true;
}

/** Échappement XML pour TwiML (calque telephony.ts:174). */
export function escapeXml(input: string): string {
  return (input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ════════════════════════════════════════════════════════════════════════════
//  Parse status callback Twilio
// ════════════════════════════════════════════════════════════════════════════

export interface ParsedStatusCallback {
  callSid: string | null;
  status: CallStatus | null;
  from: string | null;
  to: string | null;
  duration: number | null;
  recordingUrl: string | null;
  errorCode: string | null;
}

/**
 * Parse un body Twilio status-callback (form-urlencoded déjà transformé en
 * Record<string, string>) en structure typée. Tolérant aux clés manquantes ;
 * status hors whitelist ⇒ null (force fallback handler).
 */
export function parseStatusCallback(body: Record<string, unknown> | null | undefined): ParsedStatusCallback {
  const safe = body && typeof body === 'object' ? body : {};
  const callSid = typeof safe.CallSid === 'string' ? safe.CallSid.trim() || null : null;
  const rawStatus = typeof safe.CallStatus === 'string' ? safe.CallStatus.trim() : '';
  const status: CallStatus | null = VALID_CALL_STATUS_SET.has(rawStatus) ? (rawStatus as CallStatus) : null;
  const from = typeof safe.From === 'string' ? safe.From.trim() || null : null;
  const to = typeof safe.To === 'string' ? safe.To.trim() || null : null;
  const rawDuration = typeof safe.CallDuration === 'string' ? safe.CallDuration.trim() : '';
  const parsedDuration = rawDuration ? Number.parseInt(rawDuration, 10) : Number.NaN;
  const duration = Number.isFinite(parsedDuration) && parsedDuration >= 0 ? parsedDuration : null;
  const recordingUrl =
    typeof safe.RecordingUrl === 'string' && safe.RecordingUrl.trim() ? safe.RecordingUrl.trim() : null;
  const errorCode =
    typeof safe.ErrorCode === 'string' && safe.ErrorCode.trim() ? safe.ErrorCode.trim() : null;
  return { callSid, status, from, to, duration, recordingUrl, errorCode };
}

// ════════════════════════════════════════════════════════════════════════════
//  TwiML builder
// ════════════════════════════════════════════════════════════════════════════

export interface TwimlParts {
  /** Say verb : message vocal (escapeXml automatique). */
  say?: string;
  /** Gather verb : digits attendus avant action. */
  gather?: {
    numDigits?: number;
    action?: string;
    method?: 'GET' | 'POST';
    prompt?: string;
    timeoutSec?: number;
  };
  /** Dial verb : transfert vers un numéro E.164. */
  dial?: string;
  /** Record verb : enregistre un message vocal. */
  record?: {
    action?: string;
    method?: 'GET' | 'POST';
    maxLength?: number;
    playBeep?: boolean;
  };
  /** Redirect verb : ré-appelle un endpoint. */
  redirect?: { url: string; method?: 'GET' | 'POST' };
  /** Hangup : raccroche. */
  hangup?: boolean;
  /** Langue par défaut (fr-CA — calque telephony.ts). */
  language?: string;
}

/**
 * Construit un TwiML XML déterministe à partir d'un objet `parts`. Toutes les
 * valeurs dynamiques sont escapeXml. L'ordre des verbes suit l'ordre du
 * paramètre `parts` Object.keys (Say → Gather → Dial → Record → Redirect →
 * Hangup pour rester déterministe en pratique).
 */
export function formatTwimlResponse(parts: TwimlParts): string {
  const lang = parts.language || 'fr-CA';
  const verbs: string[] = [];

  if (parts.say) {
    verbs.push(`  <Say language="${escapeXml(lang)}">${escapeXml(parts.say)}</Say>`);
  }

  if (parts.gather) {
    const { numDigits = 1, action, method = 'POST', prompt, timeoutSec } = parts.gather;
    const attrs: string[] = [`numDigits="${Math.max(1, Math.min(10, Math.floor(numDigits)))}"`];
    if (action) attrs.push(`action="${escapeXml(action)}"`);
    attrs.push(`method="${method === 'GET' ? 'GET' : 'POST'}"`);
    if (typeof timeoutSec === 'number' && timeoutSec > 0) {
      attrs.push(`timeout="${Math.floor(timeoutSec)}"`);
    }
    const inner = prompt
      ? `\n    <Say language="${escapeXml(lang)}">${escapeXml(prompt)}</Say>\n  `
      : '';
    verbs.push(`  <Gather ${attrs.join(' ')}>${inner}</Gather>`);
  }

  if (parts.dial) {
    verbs.push(`  <Dial>${escapeXml(parts.dial)}</Dial>`);
  }

  if (parts.record) {
    const { action, method = 'POST', maxLength, playBeep } = parts.record;
    const attrs: string[] = [];
    if (action) attrs.push(`action="${escapeXml(action)}"`);
    attrs.push(`method="${method === 'GET' ? 'GET' : 'POST'}"`);
    if (typeof maxLength === 'number' && maxLength > 0) {
      attrs.push(`maxLength="${Math.floor(maxLength)}"`);
    }
    if (playBeep === true) attrs.push('playBeep="true"');
    verbs.push(`  <Record ${attrs.join(' ')} />`);
  }

  if (parts.redirect) {
    const m = parts.redirect.method === 'GET' ? 'GET' : 'POST';
    verbs.push(`  <Redirect method="${m}">${escapeXml(parts.redirect.url)}</Redirect>`);
  }

  if (parts.hangup) {
    verbs.push('  <Hangup />');
  }

  const body = verbs.length > 0 ? verbs.join('\n') : '  <Hangup />';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${body}\n</Response>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  IVR config validator
// ════════════════════════════════════════════════════════════════════════════

export interface IvrOption {
  digit?: string;
  action?: string;
  target?: string;
  submenu?: IvrConfig;
}

export interface IvrConfig {
  greeting?: string;
  options?: IvrOption[];
}

export interface IvrValidationResult {
  ok: boolean;
  error?: string;
  code?: TelephonyErrorCode;
  depth?: number;
}

/**
 * Valide un IvrConfig :
 *   - greeting string (optionnel).
 *   - options array (max IVR_MAX_OPTIONS_PER_MENU).
 *   - chaque option : digit ∈ '0'..'9' / '*' / '#', action ∈ IVR_VALID_ACTIONS.
 *   - submenu récursif jusqu'à IVR_MAX_DEPTH.
 *   - dial → target requis (E.164 ou phone sanitized).
 */
export function validateIvrConfig(config: unknown, depth = 1): IvrValidationResult {
  if (depth > IVR_MAX_DEPTH) {
    return {
      ok: false,
      error: `Profondeur IVR > ${IVR_MAX_DEPTH}`,
      code: TELEPHONY_ERROR_CODES.IVR_DEPTH_EXCEEDED,
      depth,
    };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      ok: false,
      error: 'Config IVR invalide (doit être un objet)',
      code: TELEPHONY_ERROR_CODES.INVALID_IVR_CONFIG,
    };
  }
  const c = config as IvrConfig;
  if (c.greeting !== undefined && typeof c.greeting !== 'string') {
    return { ok: false, error: 'greeting doit être une chaîne', code: TELEPHONY_ERROR_CODES.INVALID_IVR_CONFIG };
  }
  if (typeof c.greeting === 'string' && c.greeting.length > 500) {
    return { ok: false, error: 'greeting trop long (max 500)', code: TELEPHONY_ERROR_CODES.INVALID_IVR_CONFIG };
  }
  const options = Array.isArray(c.options) ? c.options : [];
  if (options.length > IVR_MAX_OPTIONS_PER_MENU) {
    return {
      ok: false,
      error: `Trop d'options (max ${IVR_MAX_OPTIONS_PER_MENU})`,
      code: TELEPHONY_ERROR_CODES.INVALID_IVR_CONFIG,
    };
  }
  const seenDigits = new Set<string>();
  for (const opt of options) {
    if (!opt || typeof opt !== 'object') {
      return { ok: false, error: 'Option IVR invalide', code: TELEPHONY_ERROR_CODES.IVR_OPTION_INVALID };
    }
    const digit = typeof opt.digit === 'string' ? opt.digit.trim() : '';
    if (!/^[0-9*#]$/.test(digit)) {
      return {
        ok: false,
        error: `digit invalide (attendu 0-9/*/#, reçu "${digit}")`,
        code: TELEPHONY_ERROR_CODES.IVR_OPTION_INVALID,
      };
    }
    if (seenDigits.has(digit)) {
      return {
        ok: false,
        error: `digit duppliqué "${digit}"`,
        code: TELEPHONY_ERROR_CODES.IVR_OPTION_INVALID,
      };
    }
    seenDigits.add(digit);
    const action = typeof opt.action === 'string' ? opt.action : '';
    if (!IVR_VALID_ACTION_SET.has(action)) {
      return {
        ok: false,
        error: `action invalide "${action}"`,
        code: TELEPHONY_ERROR_CODES.IVR_OPTION_INVALID,
      };
    }
    if (action === 'dial') {
      const target = typeof opt.target === 'string' ? opt.target.trim() : '';
      if (!target) {
        return {
          ok: false,
          error: `dial: target requis (digit ${digit})`,
          code: TELEPHONY_ERROR_CODES.IVR_OPTION_INVALID,
        };
      }
    }
    if (action === 'submenu') {
      if (!opt.submenu) {
        return {
          ok: false,
          error: `submenu: config sous-menu requise (digit ${digit})`,
          code: TELEPHONY_ERROR_CODES.IVR_OPTION_INVALID,
        };
      }
      const sub = validateIvrConfig(opt.submenu, depth + 1);
      if (!sub.ok) return sub;
    }
  }
  return { ok: true, depth };
}
