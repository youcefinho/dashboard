// ── ai-engine.ts — Marketing/AI P1-1 (ai.ts) helpers ──────────────────────
//
// PURE helpers (zero I/O) extracted from `src/worker/ai.ts` to harden prompt
// validation, model whitelisting, token estimation and template
// interpolation BEFORE calling the LLM. Mirrors `audit-engine.ts` shape.
//
// 100% ADDITIVE — `ai.ts` keeps its current bodies intact.

import { redactPii } from './audit-engine';

// ── Error codes (frozen) ──────────────────────────────────────────────────
export const AI_ERROR_CODES = Object.freeze({
  PROMPT_EMPTY: 'PROMPT_EMPTY',
  PROMPT_TOO_LONG: 'PROMPT_TOO_LONG',
  MODEL_INVALID: 'MODEL_INVALID',
  MAX_TOKENS_INVALID: 'MAX_TOKENS_INVALID',
  TEMPERATURE_INVALID: 'TEMPERATURE_INVALID',
  TEMPLATE_VAR_INVALID: 'TEMPLATE_VAR_INVALID',
} as const);

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

// ── Model whitelist (frozen) ──────────────────────────────────────────────
// The runtime in ai.ts pins `claude-haiku-4-5`; this whitelist documents the
// allowed values for endpoints that accept a `model` override (e.g. agent
// step types or future bring-your-own-model flows).
export const VALID_MODELS = Object.freeze([
  'claude-haiku-4-5',
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'gpt-4o-mini',
  'gpt-4o',
] as const);

export type AiModel = (typeof VALID_MODELS)[number];

const VALID_MODELS_SET: ReadonlySet<string> = new Set<string>(VALID_MODELS);

export function isValidModel(m: unknown): m is AiModel {
  return typeof m === 'string' && VALID_MODELS_SET.has(m);
}

// ── Limits ────────────────────────────────────────────────────────────────
export const MAX_PROMPT_LENGTH = 100_000;
export const MAX_RESPONSE_TOKENS = 4096;
export const MIN_RESPONSE_TOKENS = 1;
export const MIN_TEMPERATURE = 0;
export const MAX_TEMPERATURE = 2;

// ── Token estimation ──────────────────────────────────────────────────────
// ~4 chars per token is the standard rough rule for both Claude and GPT-4
// family (English+French). Used for budget pre-checks; the real billing comes
// from the provider's `usage` block.
export function estimateTokens(text: unknown): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

// ── Prompt input validation ───────────────────────────────────────────────
export interface PromptInput {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AiValidationResult {
  ok: boolean;
  error?: AiErrorCode;
  field?: string;
}

export function validatePromptInput(input: PromptInput): AiValidationResult {
  if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
    return { ok: false, error: AI_ERROR_CODES.PROMPT_EMPTY, field: 'prompt' };
  }
  if (input.prompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false, error: AI_ERROR_CODES.PROMPT_TOO_LONG, field: 'prompt' };
  }
  if (input.model !== undefined && !isValidModel(input.model)) {
    return { ok: false, error: AI_ERROR_CODES.MODEL_INVALID, field: 'model' };
  }
  if (input.maxTokens !== undefined) {
    const n = input.maxTokens;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < MIN_RESPONSE_TOKENS || n > MAX_RESPONSE_TOKENS) {
      return { ok: false, error: AI_ERROR_CODES.MAX_TOKENS_INVALID, field: 'maxTokens' };
    }
  }
  if (input.temperature !== undefined) {
    const t = input.temperature;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < MIN_TEMPERATURE || t > MAX_TEMPERATURE) {
      return { ok: false, error: AI_ERROR_CODES.TEMPERATURE_INVALID, field: 'temperature' };
    }
  }
  return { ok: true };
}

// ── Template interpolation (shared shape with workflow-engine) ────────────
// Supports `{{var}}` and `{{nested.path}}`. Missing → ''. Capped depth/length.

const TEMPLATE_TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
const MAX_PATH_DEPTH = 5;

function resolvePath(vars: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').slice(0, MAX_PATH_DEPTH);
  let cur: unknown = vars;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function interpolatePromptTemplate(template: string, vars: Record<string, unknown>): string {
  if (typeof template !== 'string') return '';
  const capped = template.length > MAX_PROMPT_LENGTH ? template.slice(0, MAX_PROMPT_LENGTH) : template;
  const v = vars && typeof vars === 'object' ? vars : {};
  return capped.replace(TEMPLATE_TOKEN_RE, (_, key: string) => {
    const val = resolvePath(v, key);
    if (val == null) return '';
    if (typeof val === 'object') {
      try { return JSON.stringify(val); } catch { return ''; }
    }
    return String(val);
  });
}

// ── PII redaction for logs ────────────────────────────────────────────────
// Re-exports `redactPii` from audit-engine and applies a hard truncate so
// large prompts don't blow up logs.
const LOG_PROMPT_CAP = 4096;

export function sanitizePromptForLog(prompt: unknown): string {
  if (typeof prompt !== 'string' || prompt.length === 0) return '';
  const truncated = prompt.length > LOG_PROMPT_CAP
    ? prompt.slice(0, LOG_PROMPT_CAP) + '…[truncated]'
    : prompt;
  return redactPii(truncated);
}

// ── Context window management ─────────────────────────────────────────────
export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Truncate a list of messages to fit within `maxTokens`. Keeps:
 *   - all `system` messages (placed first in output)
 *   - the MOST RECENT user/assistant pairs
 * Older messages are dropped first (head-pruning). The returned list is in
 * chronological order (system → oldest kept → newest).
 *
 * Best-effort: if a SINGLE message exceeds the budget, it is kept (we never
 * return an empty list) but the input is reported truncated by the caller.
 */
export function truncateContext(messages: AiMessage[], maxTokens: number): AiMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return messages.slice();
  const systems = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const kept: AiMessage[] = [];
  let budget = maxTokens - systems.reduce((acc, m) => acc + estimateTokens(m.content), 0);
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i]!;
    const cost = estimateTokens(m.content);
    if (cost > budget && kept.length > 0) break;
    kept.unshift(m);
    budget -= cost;
  }
  return [...systems, ...kept];
}
