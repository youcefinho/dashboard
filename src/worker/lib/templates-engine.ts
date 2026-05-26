// ── templates-engine.ts ─────────────────────────────────────────────────────
// Helpers PURS pour `templates.ts` (Marketing P1-5, renforcement 2026-05-26) :
//   - VALID_TEMPLATE_CHANNELS (email|sms) frozen
//   - validateTemplateInput (name, subject, body, channel)
//   - extractTemplateVariables ({{var}} placeholders)
//   - interpolateTemplate (replace {{var}} from vars object)
//   - validateVariableNames (whitelist snake_case)
//   - sanitizeHtmlBody (strip script/iframe/event handlers)
//
// Bornage tenant : assuré par le handler templates.ts (admin role + DB). Ces
// helpers sont PURS — pas de DB, pas d'I/O.
// Best-effort STRICT : retours Result `{ ok; error? }`.

/** Codes d'erreur normalisés. */
export const TEMPLATES_ERROR_CODES = Object.freeze({
  NAME_REQUIRED: 'NAME_REQUIRED',
  NAME_TOO_LONG: 'NAME_TOO_LONG',
  SUBJECT_REQUIRED: 'SUBJECT_REQUIRED',
  SUBJECT_TOO_LONG: 'SUBJECT_TOO_LONG',
  BODY_TOO_LONG: 'BODY_TOO_LONG',
  CHANNEL_INVALID: 'CHANNEL_INVALID',
  SMS_TOO_LONG: 'SMS_TOO_LONG',
  SMS_MISSING_OPTOUT: 'SMS_MISSING_OPTOUT',
  VARIABLE_NAME_INVALID: 'VARIABLE_NAME_INVALID',
} as const);

export type TemplatesErrorCode =
  (typeof TEMPLATES_ERROR_CODES)[keyof typeof TEMPLATES_ERROR_CODES];

/** Plafonds. */
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 100000;
export const MAX_NAME_LENGTH = 100;
export const MAX_SMS_LENGTH = 1000;

/** Canaux valides (frozen). */
export const VALID_TEMPLATE_CHANNELS = Object.freeze(['email', 'sms'] as const);
export type TemplateChannel = (typeof VALID_TEMPLATE_CHANNELS)[number];

/** Pattern variable : snake_case ASCII (sécurité + lisibilité). */
const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Pattern reconnaissance placeholder. */
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

/** Result type uniforme. */
export interface TemplateValidation {
  ok: boolean;
  error?: string;
  code?: TemplatesErrorCode;
  field?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// validateTemplateInput — valide { name, channel, subject, body }.
// ────────────────────────────────────────────────────────────────────────────

export interface TemplateInput {
  name?: unknown;
  channel?: unknown;
  subject?: unknown;
  body_html?: unknown;
  body_text?: unknown;
}

export function validateTemplateInput(input: TemplateInput): TemplateValidation {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Entrée template requise',
      code: TEMPLATES_ERROR_CODES.NAME_REQUIRED,
    };
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return {
      ok: false,
      error: 'Nom requis',
      code: TEMPLATES_ERROR_CODES.NAME_REQUIRED,
      field: 'name',
    };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Nom trop long (max ${MAX_NAME_LENGTH})`,
      code: TEMPLATES_ERROR_CODES.NAME_TOO_LONG,
      field: 'name',
    };
  }
  const channel = typeof input.channel === 'string' ? input.channel : 'email';
  if (!VALID_TEMPLATE_CHANNELS.includes(channel as TemplateChannel)) {
    return {
      ok: false,
      error: `Channel invalide (valeurs : ${VALID_TEMPLATE_CHANNELS.join('|')})`,
      code: TEMPLATES_ERROR_CODES.CHANNEL_INVALID,
      field: 'channel',
    };
  }
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (channel === 'email' && !subject) {
    return {
      ok: false,
      error: 'Sujet requis pour un template email',
      code: TEMPLATES_ERROR_CODES.SUBJECT_REQUIRED,
      field: 'subject',
    };
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return {
      ok: false,
      error: `Sujet trop long (max ${MAX_SUBJECT_LENGTH})`,
      code: TEMPLATES_ERROR_CODES.SUBJECT_TOO_LONG,
      field: 'subject',
    };
  }
  const bodyHtml = typeof input.body_html === 'string' ? input.body_html : '';
  const bodyText = typeof input.body_text === 'string' ? input.body_text : '';
  const body = bodyHtml || bodyText;
  if (body.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      error: `Contenu trop long (max ${MAX_BODY_LENGTH})`,
      code: TEMPLATES_ERROR_CODES.BODY_TOO_LONG,
      field: 'body_html',
    };
  }
  if (channel === 'sms') {
    if (body.length > MAX_SMS_LENGTH) {
      return {
        ok: false,
        error: `SMS limité à ${MAX_SMS_LENGTH} caractères`,
        code: TEMPLATES_ERROR_CODES.SMS_TOO_LONG,
        field: 'body',
      };
    }
    // Compliance CASL : opt-out STOP/ARRÊT obligatoire dans le corps SMS.
    if (body && !/STOP|ARR[EÊ]T/i.test(body)) {
      return {
        ok: false,
        error: 'SMS doit contenir STOP ou ARRÊT pour conformité CASL',
        code: TEMPLATES_ERROR_CODES.SMS_MISSING_OPTOUT,
        field: 'body',
      };
    }
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// extractTemplateVariables — trouve tous les {{xxx}} placeholders.
// ────────────────────────────────────────────────────────────────────────────

export function extractTemplateVariables(text: string): string[] {
  if (typeof text !== 'string' || !text) return [];
  const found = new Set<string>();
  // Reset lastIndex pour réutiliser la regex globale.
  PLACEHOLDER_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_PATTERN.exec(text)) !== null) {
    if (m[1]) found.add(m[1]);
  }
  return Array.from(found).sort();
}

// ────────────────────────────────────────────────────────────────────────────
// interpolateTemplate — remplace {{xxx}} depuis vars.
// ────────────────────────────────────────────────────────────────────────────

export interface InterpolationVars {
  [key: string]: string | number | null | undefined;
}

export function interpolateTemplate(
  text: string,
  vars: InterpolationVars,
): string {
  if (typeof text !== 'string' || !text) return '';
  if (!vars || typeof vars !== 'object') return text;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return text.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    // Support 'lead.name', 'custom.slug' (dotted) via accès direct dans vars.
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      const v = vars[name];
      return v == null ? '' : String(v);
    }
    // Inconnu : on conserve le placeholder (évite de leaker des secrets et
    // permet à un layer aval de le résoudre).
    return _match;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// validateVariableNames — whitelist snake_case ASCII.
// ────────────────────────────────────────────────────────────────────────────

export interface VariableValidationResult {
  ok: boolean;
  invalid?: string[];
}

export function validateVariableNames(
  vars: InterpolationVars,
): VariableValidationResult {
  if (!vars || typeof vars !== 'object') return { ok: true };
  const invalid: string[] = [];
  for (const key of Object.keys(vars)) {
    // Support dotted (lead.name, custom.slug) — chaque segment doit matcher.
    const segments = key.split('.');
    let allValid = true;
    for (const seg of segments) {
      if (!VARIABLE_NAME_PATTERN.test(seg)) {
        allValid = false;
        break;
      }
    }
    if (!allValid) invalid.push(key);
  }
  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// sanitizeHtmlBody — strip script/iframe/event handlers.
// ────────────────────────────────────────────────────────────────────────────

const SCRIPT_TAG = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const STYLE_TAG = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi;
const IFRAME_TAG = /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi;
const OBJECT_TAG = /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi;
const EMBED_TAG = /<embed\b[^>]*\/?\s*>/gi;
const EVENT_HANDLER = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JAVASCRIPT_URL = /(href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi;

export function sanitizeHtmlBody(html: string): string {
  if (typeof html !== 'string' || !html) return '';
  let out = html;
  // Drop script/style/iframe/object/embed (corps entier).
  out = out.replace(SCRIPT_TAG, '');
  out = out.replace(STYLE_TAG, '');
  out = out.replace(IFRAME_TAG, '');
  out = out.replace(OBJECT_TAG, '');
  out = out.replace(EMBED_TAG, '');
  // Drop event handlers (onclick, onerror, etc.) sur n'importe quelle balise.
  out = out.replace(EVENT_HANDLER, '');
  // Drop javascript: dans href/src/action.
  out = out.replace(JAVASCRIPT_URL, '$1=$2$2');
  return out;
}
