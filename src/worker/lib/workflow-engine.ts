// ── workflow-engine.ts — Marketing/AI P1-1 (workflows) helpers ─────────────
//
// PURE helpers (zero I/O) extracted from `src/worker/workflows.ts` to harden
// validation, branching, wait scheduling, quiet-hours and template
// interpolation BEFORE they reach D1. Mirrors `audit-engine.ts` shape.
//
// Existing handlers in `workflows.ts` keep their current bodies intact — these
// helpers are 100% ADDITIVE so they can be invoked progressively (no
// regression on the 3767+ test baseline).

// ── Error codes (frozen) ──────────────────────────────────────────────────
export const WORKFLOW_ERROR_CODES = Object.freeze({
  STEP_TYPE_INVALID: 'STEP_TYPE_INVALID',
  STEP_CONFIG_INVALID: 'STEP_CONFIG_INVALID',
  STEP_FIELD_MISSING: 'STEP_FIELD_MISSING',
  TRIGGER_INVALID: 'TRIGGER_INVALID',
  BRANCH_CONDITION_INVALID: 'BRANCH_CONDITION_INVALID',
  BRANCH_OPERATOR_INVALID: 'BRANCH_OPERATOR_INVALID',
  QUIET_HOURS_FORMAT_INVALID: 'QUIET_HOURS_FORMAT_INVALID',
  WAIT_DURATION_INVALID: 'WAIT_DURATION_INVALID',
  WAIT_UNIT_INVALID: 'WAIT_UNIT_INVALID',
  TEMPLATE_VAR_INVALID: 'TEMPLATE_VAR_INVALID',
} as const);

export type WorkflowErrorCode =
  (typeof WORKFLOW_ERROR_CODES)[keyof typeof WORKFLOW_ERROR_CODES];

// ── Step type whitelist (frozen — matches executeStep switch in workflows.ts) ─
// Convention : lowercase snake_case. Extending this list requires both a
// `case` in `executeStep` AND a UI option in the workflow builder.
export const VALID_STEP_TYPES = Object.freeze([
  'wait',
  'condition',
  'send_email',
  'send_internal_email',
  'send_sms',
  'add_tag',
  'remove_tag',
  'change_status',
  'assign',
  'notify',
  'webhook',
  'update_pipeline',
  'update_stage',
  'create_task',
  'create_appointment',
  'create_opportunity',
  'update_opportunity',
  'update_custom_field',
  'trigger_another_workflow',
  'end_other_workflow',
  'ai_action',
  'math_operation',
  'add_to_smart_list',
  'goal_reached',
  'request_review',
] as const);

export type WorkflowStepType = (typeof VALID_STEP_TYPES)[number];

const VALID_STEP_TYPES_SET: ReadonlySet<string> = new Set<string>(VALID_STEP_TYPES);

export function isValidStepType(t: unknown): t is WorkflowStepType {
  return typeof t === 'string' && VALID_STEP_TYPES_SET.has(t);
}

// ── Trigger event whitelist (frozen) ───────────────────────────────────────
// CRM triggers (sprint 46) + e-comm triggers (sprint E9 M1) + manual.
export const VALID_TRIGGER_EVENTS = Object.freeze([
  // CRM
  'manual',
  'lead_created',
  'lead_updated',
  'lead_status_changed',
  'form_submitted',
  'tag_added',
  'tag_removed',
  'appointment_booked',
  'appointment_cancelled',
  'task_completed',
  'lead_scored',
  'message_received',
  'tracking_event',
  // E-comm (sprint E9)
  'order_created',
  'order_paid',
  'cart_abandoned',
  'post_purchase',
  'win_back',
  'refund_issued',
] as const);

export type WorkflowTriggerEvent = (typeof VALID_TRIGGER_EVENTS)[number];

const VALID_TRIGGER_EVENTS_SET: ReadonlySet<string> = new Set<string>(VALID_TRIGGER_EVENTS);

export function isValidTriggerEvent(t: unknown): t is WorkflowTriggerEvent {
  return typeof t === 'string' && VALID_TRIGGER_EVENTS_SET.has(t);
}

// ── Branch operators ──────────────────────────────────────────────────────
export const VALID_BRANCH_OPERATORS = Object.freeze([
  'equals',
  'not_equals',
  'contains',
  'greater_than',
  'less_than',
] as const);

export type BranchOperator = (typeof VALID_BRANCH_OPERATORS)[number];

const VALID_BRANCH_OPERATORS_SET: ReadonlySet<string> = new Set<string>(VALID_BRANCH_OPERATORS);

// ── Step input validation ─────────────────────────────────────────────────
export interface ValidationResult {
  ok: boolean;
  error?: WorkflowErrorCode;
  field?: string;
}

export interface WorkflowStepInput {
  step_type: string;
  config?: Record<string, unknown> | null;
}

const VALID_STATUSES: ReadonlySet<string> = new Set(['new', 'contacted', 'qualified', 'won', 'closed', 'lost']);

/** Per-step-type config validation. Returns `{ok:true}` if no issue. */
export function validateStepInput(step: WorkflowStepInput): ValidationResult {
  if (!isValidStepType(step.step_type)) {
    return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_TYPE_INVALID, field: 'step_type' };
  }
  const cfg = (step.config ?? {}) as Record<string, unknown>;
  if (cfg && typeof cfg !== 'object') {
    return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_CONFIG_INVALID, field: 'config' };
  }

  switch (step.step_type as WorkflowStepType) {
    case 'wait': {
      // Either delay_minutes (number) OR wait_type+wait_date|wait_time|for_event.
      if (cfg.wait_type === 'until_date' && !cfg.wait_date) {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'wait_date' };
      }
      if (cfg.wait_type === 'until_time' && !cfg.wait_time) {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'wait_time' };
      }
      if (cfg.delay_minutes != null && typeof cfg.delay_minutes !== 'number') {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_CONFIG_INVALID, field: 'delay_minutes' };
      }
      return { ok: true };
    }
    case 'condition': {
      const cond = validateBranchCondition({
        field: cfg.field,
        operator: cfg.operator,
        value: cfg.value,
      });
      if (!cond.ok) return cond;
      return { ok: true };
    }
    case 'send_email':
      if (!cfg.template_id || typeof cfg.template_id !== 'string') {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'template_id' };
      }
      return { ok: true };
    case 'send_sms':
      if (cfg.message != null && typeof cfg.message !== 'string') {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_CONFIG_INVALID, field: 'message' };
      }
      return { ok: true };
    case 'send_internal_email':
      return { ok: true };
    case 'add_tag':
    case 'remove_tag':
      if (!cfg.tag || typeof cfg.tag !== 'string') {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'tag' };
      }
      return { ok: true };
    case 'change_status':
      if (!cfg.status || typeof cfg.status !== 'string' || !VALID_STATUSES.has(cfg.status as string)) {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'status' };
      }
      return { ok: true };
    case 'assign':
      if (!cfg.assigned_to || typeof cfg.assigned_to !== 'string') {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'assigned_to' };
      }
      return { ok: true };
    case 'notify':
      return { ok: true };
    case 'webhook':
      if (!cfg.url || typeof cfg.url !== 'string' || !/^https:\/\//i.test(cfg.url as string)) {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'url' };
      }
      return { ok: true };
    case 'update_pipeline':
      if (!cfg.pipeline_id) return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'pipeline_id' };
      return { ok: true };
    case 'update_stage':
      if (!cfg.stage_id) return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'stage_id' };
      return { ok: true };
    case 'create_task':
      if (!cfg.title) return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'title' };
      return { ok: true };
    case 'create_appointment':
      return { ok: true };
    case 'create_opportunity':
    case 'update_opportunity':
      if (cfg.deal_value != null && isNaN(parseFloat(String(cfg.deal_value)))) {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_CONFIG_INVALID, field: 'deal_value' };
      }
      return { ok: true };
    case 'update_custom_field':
      if (!cfg.field_id) return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'field_id' };
      return { ok: true };
    case 'trigger_another_workflow':
    case 'end_other_workflow':
      if (!cfg.workflow_id) return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'workflow_id' };
      return { ok: true };
    case 'ai_action':
      if (!cfg.prompt || typeof cfg.prompt !== 'string') {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'prompt' };
      }
      return { ok: true };
    case 'math_operation': {
      if (!cfg.field_id) return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'field_id' };
      const op = String(cfg.operator || 'set');
      if (!['add', 'subtract', 'multiply', 'divide', 'set'].includes(op)) {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_CONFIG_INVALID, field: 'operator' };
      }
      if (cfg.operand != null && isNaN(parseFloat(String(cfg.operand)))) {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_CONFIG_INVALID, field: 'operand' };
      }
      return { ok: true };
    }
    case 'add_to_smart_list':
      if (!cfg.smart_list_id && !cfg.list_name) {
        return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_FIELD_MISSING, field: 'smart_list_id' };
      }
      return { ok: true };
    case 'goal_reached':
    case 'request_review':
      return { ok: true };
    default:
      // Shouldn't reach here — isValidStepType guards above.
      return { ok: false, error: WORKFLOW_ERROR_CODES.STEP_TYPE_INVALID, field: 'step_type' };
  }
}

// ── Branch condition validation ───────────────────────────────────────────
export interface BranchConditionInput {
  field?: unknown;
  operator?: unknown;
  value?: unknown;
}

export function validateBranchCondition(cond: BranchConditionInput): ValidationResult {
  if (!cond.field || typeof cond.field !== 'string') {
    return { ok: false, error: WORKFLOW_ERROR_CODES.BRANCH_CONDITION_INVALID, field: 'field' };
  }
  if (!cond.operator || typeof cond.operator !== 'string' || !VALID_BRANCH_OPERATORS_SET.has(cond.operator)) {
    return { ok: false, error: WORKFLOW_ERROR_CODES.BRANCH_OPERATOR_INVALID, field: 'operator' };
  }
  if (cond.value == null) {
    return { ok: false, error: WORKFLOW_ERROR_CODES.BRANCH_CONDITION_INVALID, field: 'value' };
  }
  return { ok: true };
}

// ── Quiet hours ───────────────────────────────────────────────────────────
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateQuietHours(start: unknown, end: unknown): ValidationResult {
  if (typeof start !== 'string' || !HHMM_RE.test(start)) {
    return { ok: false, error: WORKFLOW_ERROR_CODES.QUIET_HOURS_FORMAT_INVALID, field: 'start' };
  }
  if (typeof end !== 'string' || !HHMM_RE.test(end)) {
    return { ok: false, error: WORKFLOW_ERROR_CODES.QUIET_HOURS_FORMAT_INVALID, field: 'end' };
  }
  return { ok: true };
}

/**
 * True if `now` (ms epoch OR Date) falls within the quiet-hours window.
 * Supports overnight windows (start > end → wraps midnight). `tz` is
 * accepted for API parity (workflow trigger_config exposes it) but the
 * runtime computes against local time of the passed `now` — matches the
 * existing `advanceEnrollment` behaviour in workflows.ts.
 */
export function isWithinQuietHours(
  quietHours: { start: string; end: string } | null | undefined,
  _tz: string | null | undefined,
  now: number | Date = Date.now(),
): boolean {
  if (!quietHours) return false;
  const v = validateQuietHours(quietHours.start, quietHours.end);
  if (!v.ok) return false;
  const d = now instanceof Date ? now : new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  const [sh, sm] = quietHours.start.split(':').map(Number) as [number, number];
  const [eh, em] = quietHours.end.split(':').map(Number) as [number, number];
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s === e) return false; // empty window
  if (s < e) return cur >= s && cur < e;
  // Overnight: e.g. 22:00 → 07:00.
  return cur >= s || cur < e;
}

// ── Wait duration parsing ─────────────────────────────────────────────────
export type WaitUnit = 'minutes' | 'hours' | 'days' | 'weeks';

const UNIT_TO_MS: Record<WaitUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

export interface WaitDurationResult {
  ms: number;
  error?: WorkflowErrorCode;
}

export function parseWaitDuration(value: unknown, unit: unknown): WaitDurationResult {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n) || n < 0) {
    return { ms: 0, error: WORKFLOW_ERROR_CODES.WAIT_DURATION_INVALID };
  }
  const u = String(unit || '').toLowerCase() as WaitUnit;
  if (!(u in UNIT_TO_MS)) {
    return { ms: 0, error: WORKFLOW_ERROR_CODES.WAIT_UNIT_INVALID };
  }
  // Cap at 365 days to prevent absurd schedules.
  const ms = Math.min(n * UNIT_TO_MS[u], 365 * 86_400_000);
  return { ms };
}

// ── Template interpolation ────────────────────────────────────────────────
// Supports `{{var}}` and `{{nested.path}}` (depth ≤ 5). Missing path → ''.
// PRESERVES the legacy `{{key}}` flat-record behaviour used by workflows.ts
// (calling code passes lead as Record<string, unknown>).

const TEMPLATE_TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
const MAX_PATH_DEPTH = 5;
const MAX_TEMPLATE_LENGTH = 100_000;

function resolvePath(vars: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').slice(0, MAX_PATH_DEPTH);
  let cur: unknown = vars;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function interpolateTemplate(template: string, vars: Record<string, unknown>): string {
  if (typeof template !== 'string') return '';
  if (template.length > MAX_TEMPLATE_LENGTH) {
    // Truncate defensively — keeps memory bounded.
    template = template.slice(0, MAX_TEMPLATE_LENGTH);
  }
  if (!vars || typeof vars !== 'object') vars = {};
  return template.replace(TEMPLATE_TOKEN_RE, (_, key: string) => {
    const v = resolvePath(vars, key);
    if (v == null) return '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch { return ''; }
    }
    return String(v);
  });
}
