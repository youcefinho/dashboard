// ── lib/chat-widgets-engine.ts — RENFORCEMENT Communication P3 (chat-widgets.ts)
//
// Helpers PURS (zéro I/O, zéro D1, zéro fetch) pour :
//   - validation config widget (name, position, theme, colors, welcome).
//   - validation hex color (#RRGGBB / #RGB).
//   - sanitization welcome message (strip HTML defensive — XSS).
//   - validation allowed_origins (array string, URL-like).
//   - génération snippet embed JS déterministe (avec V1/V2 toggle).
//   - validation business_hours (objet days→{open, close}).
//
// AUCUNE dépendance Worker (Env, D1, fetch) → 100 % unit-testable.
// Module ADDITIF : chat-widgets.ts continue de fonctionner inchangé.

// ════════════════════════════════════════════════════════════════════════════
//  CODES ERREUR STABLES
// ════════════════════════════════════════════════════════════════════════════

export const CHAT_WIDGETS_ERROR_CODES = {
  INVALID_NAME: 'invalid_name',
  INVALID_POSITION: 'invalid_position',
  INVALID_THEME: 'invalid_theme',
  INVALID_COLOR: 'invalid_color',
  INVALID_WELCOME_MESSAGE: 'invalid_welcome_message',
  WELCOME_TOO_LONG: 'welcome_too_long',
  INVALID_ALLOWED_ORIGINS: 'invalid_allowed_origins',
  INVALID_BUSINESS_HOURS: 'invalid_business_hours',
  INVALID_CLIENT_ID: 'invalid_client_id',
  INVALID_WIDGET_ID: 'invalid_widget_id',
} as const;

export type ChatWidgetsErrorCode =
  (typeof CHAT_WIDGETS_ERROR_CODES)[keyof typeof CHAT_WIDGETS_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
//  CAPS / ENUMS
// ════════════════════════════════════════════════════════════════════════════

export const MAX_WELCOME_LENGTH = 200;
export const MAX_OFFLINE_LENGTH = 2000;
export const MAX_NAME_LENGTH = 200;
export const MAX_ALLOWED_ORIGINS = 50;
export const MAX_ORIGIN_LENGTH = 500;

export const VALID_POSITIONS = Object.freeze([
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
] as const);
export type WidgetPosition = (typeof VALID_POSITIONS)[number];
const VALID_POSITION_SET = new Set<string>(VALID_POSITIONS);

export const VALID_THEMES = Object.freeze(['light', 'dark', 'auto'] as const);
export type WidgetTheme = (typeof VALID_THEMES)[number];
const VALID_THEME_SET = new Set<string>(VALID_THEMES);

const VALID_WEEKDAYS = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

// ════════════════════════════════════════════════════════════════════════════
//  Helpers purs — couleurs
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hex strict : #RRGGBB (6 hex) ou #RGB (3 hex). Accepte uppercase + lowercase.
 * Rejette tout autre format (rgb(), rgba(), nom, valeur vide).
 */
export function validateColorHex(color: unknown): boolean {
  if (typeof color !== 'string') return false;
  const s = color.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

// ════════════════════════════════════════════════════════════════════════════
//  Helpers purs — strings sanitization (defensive HTML strip)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Strip basique tags HTML + entités dangereuses + javascript:/data: URIs.
 * Sert pour welcome_message / offline_message avant render côté widget.
 * Pas un parseur HTML5 complet (zéro deps) — defensive layer.
 */
export function sanitizeWelcomeMessage(msg: unknown): string {
  if (typeof msg !== 'string') return '';
  let s = msg;
  // Strip <script>...</script> et <style>...</style> (contenu + balise).
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Strip tous les autres tags HTML restants.
  s = s.replace(/<\/?[^>]+>/g, '');
  // Strip javascript: et data: URIs (au cas où ils sortent en texte plain).
  s = s.replace(/javascript:/gi, '');
  s = s.replace(/data:\s*text\/html/gi, '');
  // on:* event handlers (defense)
  s = s.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  // Trim final
  return s.trim();
}

// ════════════════════════════════════════════════════════════════════════════
//  Validators
// ════════════════════════════════════════════════════════════════════════════

export interface WidgetConfigInput {
  name?: unknown;
  position?: unknown;
  theme?: unknown;
  primary_color?: unknown;
  welcome_message?: unknown;
  offline_message?: unknown;
  allowed_origins?: unknown;
  business_hours?: unknown;
}

export interface WidgetConfigValidation {
  ok: boolean;
  error?: string;
  code?: ChatWidgetsErrorCode;
  field?: keyof WidgetConfigInput;
}

/**
 * Validation orchestrée d'un widget config (utilisable par handlers
 * create/update). Tous champs OPTIONNELS sauf name (requis non-vide). Renvoie
 * { ok, error, code, field } ⇒ handlers peuvent mapper sur i18n.
 */
export function validateWidgetConfig(config: WidgetConfigInput): WidgetConfigValidation {
  if (config === null || typeof config !== 'object') {
    return { ok: false, error: 'config invalide', code: CHAT_WIDGETS_ERROR_CODES.INVALID_NAME };
  }
  // name : requis non vide
  if (typeof config.name !== 'string' || !config.name.trim() || config.name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: 'name requis non vide ≤ 200',
      code: CHAT_WIDGETS_ERROR_CODES.INVALID_NAME,
      field: 'name',
    };
  }
  if (config.position !== undefined && config.position !== null && config.position !== '') {
    if (typeof config.position !== 'string' || !VALID_POSITION_SET.has(config.position)) {
      return {
        ok: false,
        error: 'position invalide',
        code: CHAT_WIDGETS_ERROR_CODES.INVALID_POSITION,
        field: 'position',
      };
    }
  }
  if (config.theme !== undefined && config.theme !== null && config.theme !== '') {
    if (typeof config.theme !== 'string' || !VALID_THEME_SET.has(config.theme)) {
      return {
        ok: false,
        error: 'theme invalide',
        code: CHAT_WIDGETS_ERROR_CODES.INVALID_THEME,
        field: 'theme',
      };
    }
  }
  if (config.primary_color !== undefined && config.primary_color !== null && config.primary_color !== '') {
    if (!validateColorHex(config.primary_color)) {
      return {
        ok: false,
        error: 'primary_color doit être un hex (#RGB / #RRGGBB)',
        code: CHAT_WIDGETS_ERROR_CODES.INVALID_COLOR,
        field: 'primary_color',
      };
    }
  }
  if (config.welcome_message !== undefined && config.welcome_message !== null) {
    if (typeof config.welcome_message !== 'string') {
      return {
        ok: false,
        error: 'welcome_message doit être une string',
        code: CHAT_WIDGETS_ERROR_CODES.INVALID_WELCOME_MESSAGE,
        field: 'welcome_message',
      };
    }
    if (config.welcome_message.length > MAX_WELCOME_LENGTH) {
      return {
        ok: false,
        error: `welcome_message trop long (max ${MAX_WELCOME_LENGTH})`,
        code: CHAT_WIDGETS_ERROR_CODES.WELCOME_TOO_LONG,
        field: 'welcome_message',
      };
    }
  }
  if (config.offline_message !== undefined && config.offline_message !== null) {
    if (typeof config.offline_message !== 'string') {
      return {
        ok: false,
        error: 'offline_message doit être une string',
        code: CHAT_WIDGETS_ERROR_CODES.INVALID_WELCOME_MESSAGE,
        field: 'offline_message',
      };
    }
    if (config.offline_message.length > MAX_OFFLINE_LENGTH) {
      return {
        ok: false,
        error: `offline_message trop long (max ${MAX_OFFLINE_LENGTH})`,
        code: CHAT_WIDGETS_ERROR_CODES.WELCOME_TOO_LONG,
        field: 'offline_message',
      };
    }
  }
  if (config.allowed_origins !== undefined && config.allowed_origins !== null) {
    const ao = validateAllowedOrigins(config.allowed_origins);
    if (!ao.ok) {
      return {
        ok: false,
        error: ao.error,
        code: CHAT_WIDGETS_ERROR_CODES.INVALID_ALLOWED_ORIGINS,
        field: 'allowed_origins',
      };
    }
  }
  if (config.business_hours !== undefined && config.business_hours !== null) {
    const bh = validateBusinessHours(config.business_hours);
    if (!bh.ok) {
      return {
        ok: false,
        error: bh.error,
        code: CHAT_WIDGETS_ERROR_CODES.INVALID_BUSINESS_HOURS,
        field: 'business_hours',
      };
    }
  }
  return { ok: true };
}

export interface AllowedOriginsValidation {
  ok: boolean;
  value?: string[];
  error?: string;
}

/**
 * Valide allowed_origins : array string non vide ≤ MAX_ORIGIN_LENGTH chaque,
 * total ≤ MAX_ALLOWED_ORIGINS. Accepte null/undefined ⇒ ok value:[].
 */
export function validateAllowedOrigins(raw: unknown): AllowedOriginsValidation {
  if (raw === null || raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'allowed_origins doit être un tableau' };
  if (raw.length > MAX_ALLOWED_ORIGINS) {
    return { ok: false, error: `Trop d'origines (max ${MAX_ALLOWED_ORIGINS})` };
  }
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || !v.length || v.length > MAX_ORIGIN_LENGTH) {
      return { ok: false, error: 'allowed_origins contient une entrée invalide' };
    }
    out.push(v.trim());
  }
  return { ok: true, value: out };
}

export interface BusinessHoursValidation {
  ok: boolean;
  error?: string;
}

/**
 * Valide business_hours : objet {monday: {open: 'HH:MM', close: 'HH:MM'}, ...}.
 * Tous days optionnels. open/close au format HH:MM 24h.
 */
export function validateBusinessHours(raw: unknown): BusinessHoursValidation {
  if (raw === null || raw === undefined) return { ok: true };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'business_hours doit être un objet' };
  }
  for (const [day, slot] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_WEEKDAYS.has(day)) {
      return { ok: false, error: `Jour invalide "${day}"` };
    }
    if (slot === null) continue; // jour fermé
    if (typeof slot !== 'object' || Array.isArray(slot)) {
      return { ok: false, error: `Créneau invalide pour ${day}` };
    }
    const { open, close } = slot as { open?: unknown; close?: unknown };
    if (!isHHMM(open) || !isHHMM(close)) {
      return { ok: false, error: `open/close invalide pour ${day} (HH:MM 24h requis)` };
    }
    if (compareHHMM(open as string, close as string) >= 0) {
      return { ok: false, error: `open >= close pour ${day}` };
    }
  }
  return { ok: true };
}

function isHHMM(v: unknown): v is string {
  return typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function compareHHMM(a: string, b: string): number {
  // a, b déjà validés HH:MM → comparaison string lexicographique = numérique.
  return a < b ? -1 : a > b ? 1 : 0;
}

// ════════════════════════════════════════════════════════════════════════════
//  Embed snippet generator
// ════════════════════════════════════════════════════════════════════════════

export interface EmbedSnippetInput {
  clientId: string;
  widgetId: string;
  useV2?: boolean;
  origin?: string;
}

/**
 * Génère un snippet JS déterministe à coller sur le site client.
 *   - V1 : embed inline script tag + window.IntralysChat config.
 *   - V2 : ESM module + async loader (plus moderne, no-blocking).
 *
 * clientId / widgetId DOIVENT être [A-Za-z0-9_-] (anti-injection JS — escape
 * tag.  Throw si pattern violé (handler doit valider en amont).
 */
export function generateEmbedSnippet(input: EmbedSnippetInput): string {
  const { clientId, widgetId, useV2 = false, origin = 'https://chat.intralys.app' } = input;
  if (!isSafeJsIdent(clientId)) {
    throw new Error(CHAT_WIDGETS_ERROR_CODES.INVALID_CLIENT_ID);
  }
  if (!isSafeJsIdent(widgetId)) {
    throw new Error(CHAT_WIDGETS_ERROR_CODES.INVALID_WIDGET_ID);
  }
  const safeOrigin = origin.replace(/[<>"']/g, '');

  if (useV2) {
    return [
      '<!-- Intralys Chat Widget v2 -->',
      `<script type="module" async src="${safeOrigin}/widget/v2/loader.js"`,
      `  data-client-id="${clientId}"`,
      `  data-widget-id="${widgetId}"></script>`,
    ].join('\n');
  }

  return [
    '<!-- Intralys Chat Widget v1 -->',
    '<script>',
    '(function(w,d){',
    `  w.IntralysChat = w.IntralysChat || { clientId: "${clientId}", widgetId: "${widgetId}" };`,
    '  var s = d.createElement("script");',
    `  s.async = 1; s.src = "${safeOrigin}/widget/v1/embed.js";`,
    '  d.head.appendChild(s);',
    '})(window, document);',
    '</script>',
  ].join('\n');
}

function isSafeJsIdent(s: unknown): boolean {
  return typeof s === 'string' && s.length > 0 && s.length <= 64 && /^[A-Za-z0-9_-]+$/.test(s);
}
