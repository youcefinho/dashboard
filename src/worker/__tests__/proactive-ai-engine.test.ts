// ── proactive-ai-engine.test.ts — Marketing/AI P1-1 (proactive-ai.ts) ─────
// Covers inactivity detection, milestone detection, suggestion ranking,
// trigger input validation. 20+ tests.

import { describe, it, expect } from 'vitest';
import {
  PROACTIVE_AI_ERROR_CODES,
  SUGGESTION_TYPES,
  MILESTONE_TYPES,
  isValidSuggestionType,
  detectInactivity,
  detectMilestone,
  rankSuggestions,
  validateSuggestionTrigger,
} from '../lib/proactive-ai-engine';

describe('PROACTIVE_AI_ERROR_CODES', () => {
  it('exposes canonical codes', () => {
    expect(PROACTIVE_AI_ERROR_CODES.SUGGESTION_TYPE_INVALID).toBe('SUGGESTION_TYPE_INVALID');
    expect(PROACTIVE_AI_ERROR_CODES.MILESTONE_INVALID).toBe('MILESTONE_INVALID');
  });
  it('is frozen', () => {
    expect(Object.isFrozen(PROACTIVE_AI_ERROR_CODES)).toBe(true);
  });
});

describe('SUGGESTION_TYPES whitelist', () => {
  it('is frozen + covers core types', () => {
    expect(Object.isFrozen(SUGGESTION_TYPES)).toBe(true);
    expect(SUGGESTION_TYPES).toContain('churn_risk');
    expect(SUGGESTION_TYPES).toContain('next_best_action');
    expect(SUGGESTION_TYPES).toContain('milestone_outreach');
    expect(SUGGESTION_TYPES).toContain('inactivity_followup');
  });
  it('isValidSuggestionType', () => {
    expect(isValidSuggestionType('churn_risk')).toBe(true);
    expect(isValidSuggestionType('not_real')).toBe(false);
    expect(isValidSuggestionType('')).toBe(false);
    expect(isValidSuggestionType(null)).toBe(false);
  });
});

describe('MILESTONE_TYPES whitelist', () => {
  it('is frozen + covers core milestones', () => {
    expect(Object.isFrozen(MILESTONE_TYPES)).toBe(true);
    expect(MILESTONE_TYPES).toContain('birthday');
    expect(MILESTONE_TYPES).toContain('anniversary');
    expect(MILESTONE_TYPES).toContain('custom');
  });
});

describe('detectInactivity', () => {
  const now = new Date(2026, 4, 26, 12, 0, 0).getTime();
  it('returns true when last activity is older than threshold', () => {
    const lead = { last_activity_at: new Date(2026, 4, 1).toISOString() };
    expect(detectInactivity(lead, 7, now)).toBe(true);
  });
  it('returns false when last activity is recent', () => {
    const lead = { last_activity_at: new Date(2026, 4, 25).toISOString() };
    expect(detectInactivity(lead, 7, now)).toBe(false);
  });
  it('falls back to updated_at when last_activity_at missing', () => {
    const lead = { updated_at: new Date(2026, 4, 10).toISOString() };
    expect(detectInactivity(lead, 7, now)).toBe(true);
  });
  it('treats both-missing as inactive (safe default)', () => {
    expect(detectInactivity({}, 7, now)).toBe(true);
  });
  it('treats null lead as inactive', () => {
    expect(detectInactivity(null, 7, now)).toBe(true);
  });
  it('rejects invalid threshold', () => {
    const lead = { last_activity_at: new Date(2026, 4, 1).toISOString() };
    expect(detectInactivity(lead, -1, now)).toBe(false);
    expect(detectInactivity(lead, NaN, now)).toBe(false);
  });
  it('handles SQLite "YYYY-MM-DD HH:MM:SS" datetime format', () => {
    const lead = { last_activity_at: '2026-05-01 10:00:00' };
    expect(detectInactivity(lead, 7, now)).toBe(true);
  });
});

describe('detectMilestone', () => {
  const may26 = new Date(2026, 4, 26);
  it('matches birthday by month+day (year ignored)', () => {
    expect(detectMilestone({ birthday: '1985-05-26' }, 'birthday', may26)).toBe(true);
  });
  it('does not match different month/day', () => {
    expect(detectMilestone({ birthday: '1985-12-25' }, 'birthday', may26)).toBe(false);
  });
  it('supports MM-DD-only format', () => {
    expect(detectMilestone({ birthday: '05-26' }, 'birthday', may26)).toBe(true);
  });
  it('matches anniversary', () => {
    expect(detectMilestone({ anniversary_date: '2020-05-26' }, 'anniversary', may26)).toBe(true);
  });
  it('returns false for unknown milestone type', () => {
    expect(detectMilestone({ birthday: '1985-05-26' }, 'not_real', may26)).toBe(false);
  });
  it('returns false when field is missing', () => {
    expect(detectMilestone({}, 'birthday', may26)).toBe(false);
  });
  it('returns false for malformed date', () => {
    expect(detectMilestone({ birthday: 'not-a-date' }, 'birthday', may26)).toBe(false);
  });
});

describe('rankSuggestions', () => {
  it('sorts descending by score', () => {
    const list = [{ id: 'a', score: 0.3 }, { id: 'b', score: 0.9 }, { id: 'c', score: 0.5 }];
    const out = rankSuggestions(list, (s) => Number(s.score));
    expect(out.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });
  it('is stable on ties (preserves insertion order)', () => {
    const list = [{ id: 'a', score: 0.5 }, { id: 'b', score: 0.5 }, { id: 'c', score: 0.5 }];
    const out = rankSuggestions(list, (s) => Number(s.score));
    expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
  it('handles non-finite scores as 0', () => {
    const list = [{ id: 'a', score: NaN }, { id: 'b', score: 0.5 }];
    const out = rankSuggestions(list, (s) => Number(s.score));
    expect(out[0]!.id).toBe('b');
  });
  it('returns [] for non-array input', () => {
    // @ts-expect-error runtime guard
    expect(rankSuggestions(null, () => 0)).toEqual([]);
  });
  it('returns input unchanged when scoring fn is invalid', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    // @ts-expect-error runtime guard
    const out = rankSuggestions(list, null);
    expect(out).toHaveLength(2);
  });
});

describe('validateSuggestionTrigger', () => {
  it('accepts next_best_action without threshold', () => {
    expect(validateSuggestionTrigger({ suggestion_type: 'next_best_action' }).ok).toBe(true);
  });
  it('rejects unknown suggestion type', () => {
    const r = validateSuggestionTrigger({ suggestion_type: 'spam' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PROACTIVE_AI_ERROR_CODES.SUGGESTION_TYPE_INVALID);
  });
  it('requires threshold_days for inactivity_followup', () => {
    expect(validateSuggestionTrigger({ suggestion_type: 'inactivity_followup' }).ok).toBe(false);
    expect(validateSuggestionTrigger({ suggestion_type: 'inactivity_followup', threshold_days: 7 }).ok).toBe(true);
  });
  it('requires threshold_days for churn_risk', () => {
    expect(validateSuggestionTrigger({ suggestion_type: 'churn_risk' }).ok).toBe(false);
    expect(validateSuggestionTrigger({ suggestion_type: 'churn_risk', threshold_days: 30 }).ok).toBe(true);
  });
  it('rejects negative threshold', () => {
    const r = validateSuggestionTrigger({ suggestion_type: 'inactivity_followup', threshold_days: -1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PROACTIVE_AI_ERROR_CODES.THRESHOLD_INVALID);
  });
  it('requires milestone_type for milestone_outreach', () => {
    expect(validateSuggestionTrigger({ suggestion_type: 'milestone_outreach' }).ok).toBe(false);
    expect(validateSuggestionTrigger({ suggestion_type: 'milestone_outreach', milestone_type: 'birthday' }).ok).toBe(true);
  });
  it('rejects unknown milestone_type', () => {
    const r = validateSuggestionTrigger({ suggestion_type: 'milestone_outreach', milestone_type: 'graduation' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PROACTIVE_AI_ERROR_CODES.MILESTONE_INVALID);
  });
  it('rejects non-string lead_id', () => {
    const r = validateSuggestionTrigger({ suggestion_type: 'next_best_action', lead_id: 123 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PROACTIVE_AI_ERROR_CODES.LEAD_INVALID);
  });
});
