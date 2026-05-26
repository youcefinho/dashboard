// ── ai-chat-engine.ts — Marketing/AI P1-1 (ai-chat.ts) helpers ────────────
//
// PURE helpers (zero I/O) for the copilot v2 (`src/worker/ai-chat.ts`):
//   - intent parsing (keyword-based, fast path before LLM)
//   - chat message normalization
//   - history truncation (preserve system + recent)
//   - entity extraction (emails / phones / dates)
//
// 100% ADDITIVE — `ai-chat.ts` keeps its current bodies intact.

// ── Error codes (frozen) ──────────────────────────────────────────────────
export const AI_CHAT_ERROR_CODES = Object.freeze({
  MESSAGE_EMPTY: 'MESSAGE_EMPTY',
  MESSAGE_TOO_LONG: 'MESSAGE_TOO_LONG',
  ROLE_INVALID: 'ROLE_INVALID',
  HISTORY_INVALID: 'HISTORY_INVALID',
} as const);

export type AiChatErrorCode = (typeof AI_CHAT_ERROR_CODES)[keyof typeof AI_CHAT_ERROR_CODES];

// ── Limits ────────────────────────────────────────────────────────────────
export const MAX_CONVERSATION_LENGTH = 50;
export const MAX_MESSAGE_LENGTH = 16_000;

// ── Intents (frozen) ──────────────────────────────────────────────────────
export const INTENT_TYPES = Object.freeze([
  'book_meeting',
  'ask_pricing',
  'support_request',
  'request_demo',
  'cancel_subscription',
  'update_info',
  'feedback',
  'unknown',
] as const);

export type IntentType = (typeof INTENT_TYPES)[number];

interface IntentRule {
  intent: IntentType;
  re: RegExp;
  weight: number;
}

// Bilingual (FR québécois + EN) keyword rules. Weight tunes confidence when
// several intents match the same message — highest wins.
const INTENT_RULES: ReadonlyArray<IntentRule> = [
  { intent: 'book_meeting',        re: /\b(rendez-vous|rencontre|appel|c[ée]dul[ée]r?|booker|book|schedule|meeting|call|disponib(le|ilit[ée]))\b/i, weight: 0.85 },
  { intent: 'ask_pricing',         re: /\b(prix|tarif|combien|co[ûu]te?|budget|devis|soumission|pricing|cost|how much|quote)\b/i,                   weight: 0.80 },
  { intent: 'support_request',     re: /\b(probl[èe]me|bug|aide|help|support|ne (marche|fonctionne) pas|broken|error|issue)\b/i,                    weight: 0.78 },
  { intent: 'request_demo',        re: /\b(d[ée]mo|d[ée]monstration|essai|trial|try it|voir le produit|product tour)\b/i,                            weight: 0.82 },
  { intent: 'cancel_subscription', re: /\b(annul(er|ation)|r[ée]sili(er|ation)|cancel|unsubscribe|fermer (mon )?compte|close my account)\b/i,        weight: 0.88 },
  { intent: 'update_info',         re: /\b(mettre [àa] jour|modifier|changer|update|change my|edit (my )?(email|address|profile|phone))\b/i,         weight: 0.70 },
  { intent: 'feedback',            re: /\b(feedback|avis|commentaire|suggestion|am[ée]lior(er|ation)|improve)\b/i,                                   weight: 0.65 },
];

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  entities: ExtractedEntities;
}

/** Lightweight keyword/regex intent classifier — runs BEFORE LLM as a fast path. */
export function parseIntent(message: unknown): IntentResult {
  const text = typeof message === 'string' ? message : '';
  const entities = extractEntities(text);
  if (text.trim().length === 0) {
    return { intent: 'unknown', confidence: 0, entities };
  }
  let best: IntentResult = { intent: 'unknown', confidence: 0, entities };
  for (const rule of INTENT_RULES) {
    if (rule.re.test(text) && rule.weight > best.confidence) {
      best = { intent: rule.intent, confidence: rule.weight, entities };
    }
  }
  return best;
}

// ── Chat message normalization ────────────────────────────────────────────
export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessageInput {
  role: string;
  content: unknown;
  ts?: number | string | Date;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  ts: number;
}

const VALID_ROLES: ReadonlySet<string> = new Set(['user', 'assistant', 'system']);

export function formatChatMessage(input: ChatMessageInput): ChatMessage {
  const role: ChatRole = VALID_ROLES.has(input.role) ? (input.role as ChatRole) : 'user';
  let content = '';
  if (typeof input.content === 'string') content = input.content;
  else if (input.content != null) {
    try { content = JSON.stringify(input.content); } catch { content = String(input.content); }
  }
  if (content.length > MAX_MESSAGE_LENGTH) {
    content = content.slice(0, MAX_MESSAGE_LENGTH);
  }
  let ts: number;
  if (input.ts instanceof Date) ts = input.ts.getTime();
  else if (typeof input.ts === 'number' && Number.isFinite(input.ts)) ts = input.ts;
  else if (typeof input.ts === 'string') {
    const parsed = Date.parse(input.ts);
    ts = Number.isFinite(parsed) ? parsed : Date.now();
  } else ts = Date.now();
  return { role, content, ts };
}

// ── History truncation ────────────────────────────────────────────────────
/**
 * Trim history to `maxMessages`. Preserves ALL system messages first, then
 * the most recent N user/assistant messages. Chronological order returned.
 *
 * If `maxMessages` is 0 or negative, returns systems only.
 */
export function truncateHistory(history: ChatMessage[], maxMessages: number = MAX_CONVERSATION_LENGTH): ChatMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  const cap = Math.min(Math.max(0, Math.floor(maxMessages)), MAX_CONVERSATION_LENGTH);
  const systems = history.filter((m) => m.role === 'system');
  const rest = history.filter((m) => m.role !== 'system');
  if (cap === 0) return systems.slice();
  const recent = rest.slice(-cap);
  return [...systems, ...recent];
}

// ── Entity extraction ─────────────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Phone: international with country prefix or 10-digit NA / 8-digit EU.
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g;
// Date: ISO (2026-05-26), slash (26/05/2026, 5/26/2026), FR ("26 mai 2026"),
// EN ("May 26, 2026"). Conservative — does not parse relative dates.
const DATE_RE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre|january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{2,4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{2,4})\b/gi;

export interface ExtractedEntities {
  emails: string[];
  phones: string[];
  dates: string[];
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

export function extractEntities(text: unknown): ExtractedEntities {
  if (typeof text !== 'string' || text.length === 0) {
    return { emails: [], phones: [], dates: [] };
  }
  const emails = uniq(text.match(EMAIL_RE) || []);
  // Strip emails from text BEFORE phone-matching to avoid the "1234567890"
  // segment of an email being matched as a phone.
  const stripped = text.replace(EMAIL_RE, ' ');
  const dates = uniq(stripped.match(DATE_RE) || []);
  // Strip dates too so "2026-05-26" doesn't leak into the phone match.
  const phoneCandidates = stripped.replace(DATE_RE, ' ').match(PHONE_RE) || [];
  const phones = uniq(phoneCandidates.map((p) => p.trim()).filter((p) => {
    // Require ≥ 7 digits to filter out short numbers.
    return (p.match(/\d/g) || []).length >= 7;
  }));
  return { emails, phones, dates };
}
