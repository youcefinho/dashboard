// ── ai-engine.test.ts — Marketing/AI P1-1 (ai.ts) helpers ─────────────────
// Covers model whitelist, prompt validation, token estimation, template
// interpolation, log sanitization, context window truncation. 24+ tests.

import { describe, it, expect } from 'vitest';
import {
  AI_ERROR_CODES,
  VALID_MODELS,
  MAX_PROMPT_LENGTH,
  MAX_RESPONSE_TOKENS,
  isValidModel,
  estimateTokens,
  validatePromptInput,
  interpolatePromptTemplate,
  sanitizePromptForLog,
  truncateContext,
} from '../lib/ai-engine';

describe('AI_ERROR_CODES', () => {
  it('exposes canonical codes', () => {
    expect(AI_ERROR_CODES.PROMPT_EMPTY).toBe('PROMPT_EMPTY');
    expect(AI_ERROR_CODES.MODEL_INVALID).toBe('MODEL_INVALID');
  });
  it('is frozen', () => {
    expect(Object.isFrozen(AI_ERROR_CODES)).toBe(true);
  });
});

describe('VALID_MODELS whitelist', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(VALID_MODELS)).toBe(true);
  });
  it('contains current runtime defaults', () => {
    expect(VALID_MODELS).toContain('claude-haiku-4-5');
    expect(VALID_MODELS).toContain('gpt-4o-mini');
  });
  it('isValidModel accepts whitelisted, rejects unknown', () => {
    expect(isValidModel('claude-haiku-4-5')).toBe(true);
    expect(isValidModel('claude-3-opus')).toBe(false);
    expect(isValidModel('')).toBe(false);
    expect(isValidModel(null)).toBe(false);
  });
});

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });
  it('handles non-string defensively', () => {
    expect(estimateTokens(null)).toBe(0);
    // @ts-expect-error runtime guard
    expect(estimateTokens(42)).toBe(0);
  });
});

describe('validatePromptInput', () => {
  it('accepts minimal valid input', () => {
    expect(validatePromptInput({ prompt: 'hello world' }).ok).toBe(true);
  });
  it('rejects empty prompt', () => {
    const r = validatePromptInput({ prompt: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(AI_ERROR_CODES.PROMPT_EMPTY);
  });
  it('rejects oversized prompt', () => {
    const r = validatePromptInput({ prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(AI_ERROR_CODES.PROMPT_TOO_LONG);
  });
  it('rejects unknown model', () => {
    const r = validatePromptInput({ prompt: 'hi', model: 'gemini-pro' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(AI_ERROR_CODES.MODEL_INVALID);
  });
  it('rejects out-of-range maxTokens', () => {
    expect(validatePromptInput({ prompt: 'hi', maxTokens: 0 }).error).toBe(AI_ERROR_CODES.MAX_TOKENS_INVALID);
    expect(validatePromptInput({ prompt: 'hi', maxTokens: MAX_RESPONSE_TOKENS + 1 }).error).toBe(AI_ERROR_CODES.MAX_TOKENS_INVALID);
  });
  it('rejects out-of-range temperature', () => {
    expect(validatePromptInput({ prompt: 'hi', temperature: -0.1 }).error).toBe(AI_ERROR_CODES.TEMPERATURE_INVALID);
    expect(validatePromptInput({ prompt: 'hi', temperature: 2.5 }).error).toBe(AI_ERROR_CODES.TEMPERATURE_INVALID);
    expect(validatePromptInput({ prompt: 'hi', temperature: 0.7 }).ok).toBe(true);
  });
});

describe('interpolatePromptTemplate', () => {
  it('replaces flat vars', () => {
    expect(interpolatePromptTemplate('Hi {{name}}', { name: 'Bob' })).toBe('Hi Bob');
  });
  it('replaces nested paths', () => {
    expect(interpolatePromptTemplate('Order {{order.id}}', { order: { id: 42 } })).toBe('Order 42');
  });
  it('returns empty for missing path', () => {
    expect(interpolatePromptTemplate('{{missing}}', {})).toBe('');
  });
  it('caps long templates', () => {
    const long = 'x'.repeat(MAX_PROMPT_LENGTH + 1000);
    const out = interpolatePromptTemplate(long, {});
    expect(out.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
  });
});

describe('sanitizePromptForLog', () => {
  it('redacts email PII', () => {
    expect(sanitizePromptForLog('email me at alice@bob.com')).toContain('[REDACTED]');
  });
  it('redacts phone numbers', () => {
    expect(sanitizePromptForLog('call 514-555-0142')).toContain('[REDACTED]');
  });
  it('truncates long prompts', () => {
    const long = 'a'.repeat(8000);
    const out = sanitizePromptForLog(long);
    expect(out).toContain('[truncated]');
  });
  it('returns empty string for non-string input', () => {
    expect(sanitizePromptForLog(null)).toBe('');
    // @ts-expect-error runtime guard
    expect(sanitizePromptForLog(42)).toBe('');
  });
});

describe('truncateContext', () => {
  it('returns empty for empty input', () => {
    expect(truncateContext([], 1000)).toEqual([]);
  });
  it('keeps all messages within budget', () => {
    const msgs = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello' },
    ];
    expect(truncateContext(msgs, 1000)).toHaveLength(2);
  });
  it('prefers most recent when budget tight', () => {
    const msgs = [
      { role: 'user' as const, content: 'a'.repeat(40) },
      { role: 'user' as const, content: 'b'.repeat(40) },
      { role: 'user' as const, content: 'c'.repeat(40) },
    ];
    // budget = 20 tokens → ~80 chars → fits 2 messages
    const out = truncateContext(msgs, 20);
    expect(out[out.length - 1]!.content[0]).toBe('c');
  });
  it('always keeps system messages first', () => {
    const msgs = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'a'.repeat(40) },
      { role: 'assistant' as const, content: 'b'.repeat(40) },
    ];
    const out = truncateContext(msgs, 30);
    expect(out[0]!.role).toBe('system');
  });
});
