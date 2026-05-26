// ── ai-chat-engine.test.ts — Marketing/AI P1-1 (ai-chat.ts) helpers ───────
// Covers intent parsing, chat message normalization, history truncation,
// entity extraction. 24+ tests.

import { describe, it, expect } from 'vitest';
import {
  AI_CHAT_ERROR_CODES,
  INTENT_TYPES,
  MAX_CONVERSATION_LENGTH,
  parseIntent,
  formatChatMessage,
  truncateHistory,
  extractEntities,
} from '../lib/ai-chat-engine';

describe('AI_CHAT_ERROR_CODES', () => {
  it('exposes canonical codes', () => {
    expect(AI_CHAT_ERROR_CODES.MESSAGE_EMPTY).toBe('MESSAGE_EMPTY');
  });
  it('is frozen', () => {
    expect(Object.isFrozen(AI_CHAT_ERROR_CODES)).toBe(true);
  });
});

describe('INTENT_TYPES', () => {
  it('is frozen + contains core intents', () => {
    expect(Object.isFrozen(INTENT_TYPES)).toBe(true);
    expect(INTENT_TYPES).toContain('book_meeting');
    expect(INTENT_TYPES).toContain('ask_pricing');
    expect(INTENT_TYPES).toContain('support_request');
    expect(INTENT_TYPES).toContain('unknown');
  });
});

describe('parseIntent', () => {
  it('detects book_meeting FR/EN', () => {
    expect(parseIntent('Je voudrais un rendez-vous').intent).toBe('book_meeting');
    expect(parseIntent('Can we schedule a meeting').intent).toBe('book_meeting');
  });
  it('detects ask_pricing', () => {
    expect(parseIntent('Combien ça coûte ?').intent).toBe('ask_pricing');
    expect(parseIntent('What is the pricing').intent).toBe('ask_pricing');
  });
  it('detects support_request', () => {
    expect(parseIntent('I have a bug').intent).toBe('support_request');
    expect(parseIntent('ça ne fonctionne pas').intent).toBe('support_request');
  });
  it('detects cancel_subscription', () => {
    expect(parseIntent('Je veux résilier mon abonnement').intent).toBe('cancel_subscription');
    expect(parseIntent('cancel my subscription').intent).toBe('cancel_subscription');
  });
  it('returns unknown when nothing matches', () => {
    const r = parseIntent('Lorem ipsum dolor sit amet');
    expect(r.intent).toBe('unknown');
    expect(r.confidence).toBe(0);
  });
  it('returns unknown for empty input', () => {
    expect(parseIntent('').intent).toBe('unknown');
    expect(parseIntent(null).intent).toBe('unknown');
  });
  it('attaches extracted entities', () => {
    const r = parseIntent('Call me at 514-555-0142');
    expect(r.entities.phones.length).toBeGreaterThan(0);
  });
  it('returns highest-confidence intent when multiple match', () => {
    const r = parseIntent('I want to cancel and also ask about pricing');
    // cancel_subscription (0.88) > ask_pricing (0.80)
    expect(r.intent).toBe('cancel_subscription');
  });
});

describe('formatChatMessage', () => {
  it('normalizes string content', () => {
    const m = formatChatMessage({ role: 'user', content: 'hi', ts: 1000 });
    expect(m).toEqual({ role: 'user', content: 'hi', ts: 1000 });
  });
  it('coerces unknown role to user', () => {
    expect(formatChatMessage({ role: 'admin', content: 'x' }).role).toBe('user');
  });
  it('serializes non-string content', () => {
    const m = formatChatMessage({ role: 'assistant', content: { a: 1 } });
    expect(m.content).toContain('"a"');
  });
  it('parses ISO ts string', () => {
    const m = formatChatMessage({ role: 'user', content: 'x', ts: '2026-01-01T00:00:00Z' });
    expect(m.ts).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });
  it('falls back to Date.now for missing ts', () => {
    const before = Date.now();
    const m = formatChatMessage({ role: 'user', content: 'x' });
    expect(m.ts).toBeGreaterThanOrEqual(before);
  });
  it('truncates oversized content', () => {
    const m = formatChatMessage({ role: 'user', content: 'x'.repeat(20_000) });
    expect(m.content.length).toBeLessThanOrEqual(16_000);
  });
});

describe('truncateHistory', () => {
  const sysMsg = { role: 'system' as const, content: 'sys', ts: 1 };
  const userMsg = (i: number) => ({ role: 'user' as const, content: `u${i}`, ts: i + 100 });

  it('returns empty for empty history', () => {
    expect(truncateHistory([])).toEqual([]);
  });
  it('keeps under cap as-is', () => {
    const h = [sysMsg, userMsg(1), userMsg(2)];
    expect(truncateHistory(h, 10)).toHaveLength(3);
  });
  it('preserves system + keeps most recent', () => {
    const h = [sysMsg, userMsg(1), userMsg(2), userMsg(3), userMsg(4)];
    const out = truncateHistory(h, 2);
    expect(out).toHaveLength(3); // system + 2 recent
    expect(out[0]!.role).toBe('system');
    expect(out[out.length - 1]!.content).toBe('u4');
  });
  it('cap of 0 returns systems only', () => {
    const h = [sysMsg, userMsg(1), userMsg(2)];
    expect(truncateHistory(h, 0)).toEqual([sysMsg]);
  });
  it('clamps to MAX_CONVERSATION_LENGTH', () => {
    const h = Array.from({ length: 200 }, (_, i) => userMsg(i));
    expect(truncateHistory(h, 99999).length).toBe(MAX_CONVERSATION_LENGTH);
  });
});

describe('extractEntities', () => {
  it('extracts emails', () => {
    const e = extractEntities('Mail me at alice@bob.com or charlie@dee.fr');
    expect(e.emails).toEqual(expect.arrayContaining(['alice@bob.com', 'charlie@dee.fr']));
  });
  it('extracts phones (NA + intl)', () => {
    const e = extractEntities('Call 514-555-0142 or +33 1 23 45 67 89');
    expect(e.phones.length).toBeGreaterThanOrEqual(1);
  });
  it('extracts ISO dates', () => {
    const e = extractEntities('Schedule on 2026-05-26 please');
    expect(e.dates).toContain('2026-05-26');
  });
  it('extracts FR text dates', () => {
    const e = extractEntities('le 26 mai 2026 à 14h');
    expect(e.dates.length).toBeGreaterThan(0);
  });
  it('extracts EN text dates', () => {
    const e = extractEntities('on May 26, 2026 at 2pm');
    expect(e.dates.length).toBeGreaterThan(0);
  });
  it('returns empty arrays for empty/non-string', () => {
    expect(extractEntities('')).toEqual({ emails: [], phones: [], dates: [] });
    expect(extractEntities(null)).toEqual({ emails: [], phones: [], dates: [] });
  });
  it('does not match digit-only short codes as phones', () => {
    const e = extractEntities('Press 12345');
    expect(e.phones).toEqual([]);
  });
  it('deduplicates repeated entities', () => {
    const e = extractEntities('alice@bob.com again alice@bob.com');
    expect(e.emails).toEqual(['alice@bob.com']);
  });
});
