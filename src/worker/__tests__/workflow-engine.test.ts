// ── workflow-engine.test.ts — Marketing/AI P1-1 workflows helpers ─────────
// Covers step type whitelist, branch conditions, quiet hours, wait duration
// parsing, template interpolation. 30+ tests.

import { describe, it, expect } from 'vitest';
import {
  WORKFLOW_ERROR_CODES,
  VALID_STEP_TYPES,
  VALID_TRIGGER_EVENTS,
  VALID_BRANCH_OPERATORS,
  isValidStepType,
  isValidTriggerEvent,
  validateStepInput,
  validateBranchCondition,
  validateQuietHours,
  isWithinQuietHours,
  parseWaitDuration,
  interpolateTemplate,
} from '../lib/workflow-engine';

describe('WORKFLOW_ERROR_CODES', () => {
  it('exposes canonical codes', () => {
    expect(WORKFLOW_ERROR_CODES.STEP_TYPE_INVALID).toBe('STEP_TYPE_INVALID');
    expect(WORKFLOW_ERROR_CODES.QUIET_HOURS_FORMAT_INVALID).toBe('QUIET_HOURS_FORMAT_INVALID');
  });
  it('is frozen', () => {
    expect(Object.isFrozen(WORKFLOW_ERROR_CODES)).toBe(true);
  });
});

describe('VALID_STEP_TYPES whitelist', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(VALID_STEP_TYPES)).toBe(true);
  });
  it('contains the core step types', () => {
    expect(VALID_STEP_TYPES).toContain('wait');
    expect(VALID_STEP_TYPES).toContain('send_email');
    expect(VALID_STEP_TYPES).toContain('send_sms');
    expect(VALID_STEP_TYPES).toContain('condition');
    expect(VALID_STEP_TYPES).toContain('goal_reached');
    expect(VALID_STEP_TYPES).toContain('request_review');
    expect(VALID_STEP_TYPES).toContain('ai_action');
  });
  it('isValidStepType accepts valid, rejects unknown', () => {
    expect(isValidStepType('wait')).toBe(true);
    expect(isValidStepType('unknown')).toBe(false);
    expect(isValidStepType('')).toBe(false);
    expect(isValidStepType(null)).toBe(false);
  });
});

describe('VALID_TRIGGER_EVENTS whitelist', () => {
  it('covers CRM and e-comm triggers', () => {
    expect(VALID_TRIGGER_EVENTS).toContain('lead_created');
    expect(VALID_TRIGGER_EVENTS).toContain('order_paid');
    expect(VALID_TRIGGER_EVENTS).toContain('cart_abandoned');
    expect(VALID_TRIGGER_EVENTS).toContain('manual');
  });
  it('isValidTriggerEvent', () => {
    expect(isValidTriggerEvent('order_paid')).toBe(true);
    expect(isValidTriggerEvent('not_real_event')).toBe(false);
  });
});

describe('validateStepInput', () => {
  it('rejects unknown step type', () => {
    const r = validateStepInput({ step_type: 'not_a_step' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(WORKFLOW_ERROR_CODES.STEP_TYPE_INVALID);
  });
  it('validates wait with delay_minutes', () => {
    expect(validateStepInput({ step_type: 'wait', config: { delay_minutes: 30 } }).ok).toBe(true);
    expect(validateStepInput({ step_type: 'wait', config: { delay_minutes: 'thirty' } }).ok).toBe(false);
  });
  it('validates wait until_date missing field', () => {
    const r = validateStepInput({ step_type: 'wait', config: { wait_type: 'until_date' } });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('wait_date');
  });
  it('validates send_email requires template_id', () => {
    expect(validateStepInput({ step_type: 'send_email', config: {} }).ok).toBe(false);
    expect(validateStepInput({ step_type: 'send_email', config: { template_id: 'tpl-1' } }).ok).toBe(true);
  });
  it('validates add_tag requires tag', () => {
    expect(validateStepInput({ step_type: 'add_tag', config: {} }).ok).toBe(false);
    expect(validateStepInput({ step_type: 'add_tag', config: { tag: 'vip' } }).ok).toBe(true);
  });
  it('validates change_status against whitelist', () => {
    expect(validateStepInput({ step_type: 'change_status', config: { status: 'won' } }).ok).toBe(true);
    expect(validateStepInput({ step_type: 'change_status', config: { status: 'in_progress' } }).ok).toBe(false);
  });
  it('validates webhook requires https URL', () => {
    expect(validateStepInput({ step_type: 'webhook', config: { url: 'http://insecure.com' } }).ok).toBe(false);
    expect(validateStepInput({ step_type: 'webhook', config: { url: 'https://secure.com' } }).ok).toBe(true);
  });
  it('validates ai_action requires prompt', () => {
    expect(validateStepInput({ step_type: 'ai_action', config: {} }).ok).toBe(false);
    expect(validateStepInput({ step_type: 'ai_action', config: { prompt: 'hi' } }).ok).toBe(true);
  });
  it('validates math_operation requires field_id and valid operator', () => {
    expect(validateStepInput({ step_type: 'math_operation', config: { field_id: 'f1', operator: 'add', operand: 5 } }).ok).toBe(true);
    expect(validateStepInput({ step_type: 'math_operation', config: { field_id: 'f1', operator: 'sqrt' } }).ok).toBe(false);
    expect(validateStepInput({ step_type: 'math_operation', config: { operator: 'add' } }).ok).toBe(false);
  });
  it('validates condition delegates to branch validator', () => {
    expect(validateStepInput({ step_type: 'condition', config: { field: 'status', operator: 'equals', value: 'won' } }).ok).toBe(true);
    expect(validateStepInput({ step_type: 'condition', config: { field: 'status' } }).ok).toBe(false);
  });
});

describe('validateBranchCondition', () => {
  it('accepts valid operators', () => {
    for (const op of VALID_BRANCH_OPERATORS) {
      expect(validateBranchCondition({ field: 'status', operator: op, value: 'x' }).ok).toBe(true);
    }
  });
  it('rejects missing field/operator/value', () => {
    expect(validateBranchCondition({ operator: 'equals', value: 'x' }).ok).toBe(false);
    expect(validateBranchCondition({ field: 'status', value: 'x' }).ok).toBe(false);
    expect(validateBranchCondition({ field: 'status', operator: 'equals' }).ok).toBe(false);
  });
  it('rejects unknown operator', () => {
    const r = validateBranchCondition({ field: 'f', operator: 'matches_regex', value: '.*' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(WORKFLOW_ERROR_CODES.BRANCH_OPERATOR_INVALID);
  });
});

describe('validateQuietHours', () => {
  it('accepts HH:MM 24h format', () => {
    expect(validateQuietHours('09:00', '17:00').ok).toBe(true);
    expect(validateQuietHours('22:30', '07:15').ok).toBe(true);
  });
  it('rejects malformed', () => {
    expect(validateQuietHours('9:00', '17:00').ok).toBe(false);
    expect(validateQuietHours('25:00', '17:00').ok).toBe(false);
    expect(validateQuietHours('09:60', '17:00').ok).toBe(false);
    expect(validateQuietHours('abc', '17:00').ok).toBe(false);
  });
});

describe('isWithinQuietHours', () => {
  // 14:30 local time on a fixed day.
  const noon = new Date(2026, 4, 1, 14, 30, 0).getTime();
  const lateNight = new Date(2026, 4, 1, 23, 0, 0).getTime();
  const earlyMorning = new Date(2026, 4, 1, 6, 0, 0).getTime();
  it('returns true inside a normal window', () => {
    expect(isWithinQuietHours({ start: '09:00', end: '17:00' }, null, noon)).toBe(true);
  });
  it('returns false outside a normal window', () => {
    expect(isWithinQuietHours({ start: '09:00', end: '13:00' }, null, noon)).toBe(false);
  });
  it('supports overnight (wrap midnight)', () => {
    expect(isWithinQuietHours({ start: '22:00', end: '07:00' }, null, lateNight)).toBe(true);
    expect(isWithinQuietHours({ start: '22:00', end: '07:00' }, null, earlyMorning)).toBe(true);
    expect(isWithinQuietHours({ start: '22:00', end: '07:00' }, null, noon)).toBe(false);
  });
  it('returns false for null / malformed', () => {
    expect(isWithinQuietHours(null, null, noon)).toBe(false);
    expect(isWithinQuietHours({ start: 'bad', end: '17:00' }, null, noon)).toBe(false);
  });
});

describe('parseWaitDuration', () => {
  it('parses common units', () => {
    expect(parseWaitDuration(5, 'minutes').ms).toBe(5 * 60_000);
    expect(parseWaitDuration(2, 'hours').ms).toBe(2 * 3_600_000);
    expect(parseWaitDuration(1, 'days').ms).toBe(86_400_000);
    expect(parseWaitDuration(1, 'weeks').ms).toBe(7 * 86_400_000);
  });
  it('rejects negative or non-numeric', () => {
    expect(parseWaitDuration(-1, 'minutes').error).toBe(WORKFLOW_ERROR_CODES.WAIT_DURATION_INVALID);
    expect(parseWaitDuration('abc', 'minutes').error).toBe(WORKFLOW_ERROR_CODES.WAIT_DURATION_INVALID);
  });
  it('rejects unknown unit', () => {
    expect(parseWaitDuration(5, 'months').error).toBe(WORKFLOW_ERROR_CODES.WAIT_UNIT_INVALID);
  });
  it('caps at 365 days', () => {
    const r = parseWaitDuration(10_000, 'days');
    expect(r.error).toBeUndefined();
    expect(r.ms).toBe(365 * 86_400_000);
  });
});

describe('interpolateTemplate', () => {
  it('replaces flat vars', () => {
    expect(interpolateTemplate('Hello {{name}}!', { name: 'Alice' })).toBe('Hello Alice!');
  });
  it('replaces nested paths', () => {
    expect(interpolateTemplate('From {{lead.email}}', { lead: { email: 'a@b.co' } })).toBe('From a@b.co');
  });
  it('returns empty string for missing path', () => {
    expect(interpolateTemplate('Hi {{missing.path}}', {})).toBe('Hi ');
  });
  it('serializes object values defensively', () => {
    const out = interpolateTemplate('{{obj}}', { obj: { a: 1 } });
    expect(out).toContain('"a"');
  });
  it('handles non-string template gracefully', () => {
    // @ts-expect-error testing runtime guard
    expect(interpolateTemplate(123, {})).toBe('');
  });
  it('preserves text without tokens', () => {
    expect(interpolateTemplate('plain text', { a: 1 })).toBe('plain text');
  });
});
