// ── proactive-ai-engine.ts — Marketing/AI P1-1 (proactive-ai.ts) helpers ──
//
// PURE helpers (zero I/O) for the proactive suggestions module
// (`src/worker/proactive-ai.ts`):
//   - inactivity detection
//   - milestone detection (birthday, anniversary, custom)
//   - suggestion ranking (descending by score)
//   - trigger input validation
//
// 100% ADDITIVE — `proactive-ai.ts` keeps its current bodies intact.

// ── Error codes (frozen) ──────────────────────────────────────────────────
export const PROACTIVE_AI_ERROR_CODES = Object.freeze({
  SUGGESTION_TYPE_INVALID: 'SUGGESTION_TYPE_INVALID',
  THRESHOLD_INVALID: 'THRESHOLD_INVALID',
  MILESTONE_INVALID: 'MILESTONE_INVALID',
  LEAD_INVALID: 'LEAD_INVALID',
  RANKING_FN_INVALID: 'RANKING_FN_INVALID',
} as const);

export type ProactiveAiErrorCode =
  (typeof PROACTIVE_AI_ERROR_CODES)[keyof typeof PROACTIVE_AI_ERROR_CODES];

// ── Suggestion types (frozen) ─────────────────────────────────────────────
// Aligned with kind enum from migration-proactive-ai-seq99.sql + intended
// NBA categories.
export const SUGGESTION_TYPES = Object.freeze([
  'churn_risk',
  'next_best_action',
  'milestone_outreach',
  'inactivity_followup',
  'upsell_opportunity',
  'cross_sell',
  'win_back',
  'summary',
] as const);

export type SuggestionType = (typeof SUGGESTION_TYPES)[number];

const SUGGESTION_TYPES_SET: ReadonlySet<string> = new Set<string>(SUGGESTION_TYPES);

export function isValidSuggestionType(t: unknown): t is SuggestionType {
  return typeof t === 'string' && SUGGESTION_TYPES_SET.has(t);
}

// ── Milestone types (frozen) ──────────────────────────────────────────────
export const MILESTONE_TYPES = Object.freeze([
  'birthday',
  'anniversary',
  'first_purchase_anniversary',
  'membership_renewal',
  'custom',
] as const);

export type MilestoneType = (typeof MILESTONE_TYPES)[number];

const MILESTONE_TYPES_SET: ReadonlySet<string> = new Set<string>(MILESTONE_TYPES);

// ── Inactivity detection ──────────────────────────────────────────────────
export interface InactivityLead {
  last_activity_at?: string | number | Date | null;
  updated_at?: string | number | Date | null;
}

function toMs(d: string | number | Date | null | undefined): number | null {
  if (d == null) return null;
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'number') return d < 1e12 ? d * 1000 : d;
  if (typeof d === 'string') {
    const norm = d.includes('T') ? d : d.replace(' ', 'T') + (d.endsWith('Z') ? '' : 'Z');
    const t = Date.parse(norm);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * True if the lead's last interaction is older than `thresholdDays`. Falls
 * back to `updated_at` if `last_activity_at` is missing. If both missing →
 * true (treat as inactive — safe default for outreach proactivity).
 */
export function detectInactivity(lead: InactivityLead | null | undefined, thresholdDays: number, now: number = Date.now()): boolean {
  if (!lead) return true;
  if (!Number.isFinite(thresholdDays) || thresholdDays < 0) return false;
  const ms = toMs(lead.last_activity_at) ?? toMs(lead.updated_at);
  if (ms == null) return true;
  const days = Math.max(0, Math.floor((now - ms) / 86_400_000));
  return days >= thresholdDays;
}

// ── Milestone detection ───────────────────────────────────────────────────
export interface MilestoneLead {
  birthday?: string | null;       // 'YYYY-MM-DD' or 'MM-DD'
  first_purchase_at?: string | null;
  membership_started_at?: string | null;
  anniversary_date?: string | null;
  custom_milestone_at?: string | null;
}

function isSameMonthDay(a: Date, b: Date): boolean {
  return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseDateField(v: string | null | undefined): Date | null {
  if (!v) return null;
  // MM-DD only (no year) — pad with current year.
  const mmdd = /^(\d{2})-(\d{2})$/.exec(v);
  if (mmdd) {
    const d = new Date();
    d.setMonth(parseInt(mmdd[1]!, 10) - 1, parseInt(mmdd[2]!, 10));
    return d;
  }
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t);
}

/**
 * True if `now` is on the same month+day as the milestone date stored on
 * the lead. Year is ignored (a birthday is yearly). Unknown milestone type
 * or missing field → false.
 */
export function detectMilestone(
  lead: MilestoneLead | null | undefined,
  milestoneType: string,
  now: Date = new Date(),
): boolean {
  if (!lead || !MILESTONE_TYPES_SET.has(milestoneType)) return false;
  let raw: string | null | undefined;
  switch (milestoneType as MilestoneType) {
    case 'birthday':                    raw = lead.birthday; break;
    case 'first_purchase_anniversary':  raw = lead.first_purchase_at; break;
    case 'anniversary':                 raw = lead.anniversary_date; break;
    case 'membership_renewal':          raw = lead.membership_started_at; break;
    case 'custom':                      raw = lead.custom_milestone_at; break;
  }
  const d = parseDateField(raw);
  if (!d) return false;
  return isSameMonthDay(d, now);
}

// ── Suggestion ranking ────────────────────────────────────────────────────
export interface Suggestion {
  id?: string;
  type?: string;
  title?: string;
  score?: number;
  [key: string]: unknown;
}

/**
 * Sort suggestions descending by the scoring function. Stable: original
 * insertion order preserved on score ties. Defensive: non-array → []; non-
 * function scoringFn → returns input unchanged.
 */
export function rankSuggestions(
  suggestions: Suggestion[],
  scoringFn: (s: Suggestion) => number,
): Suggestion[] {
  if (!Array.isArray(suggestions)) return [];
  if (typeof scoringFn !== 'function') return suggestions.slice();
  // Decorate for stability (preserve original index on score ties).
  const decorated = suggestions.map((s, i) => {
    const raw = scoringFn(s);
    const score = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    return { s, i, score };
  });
  decorated.sort((a, b) => (b.score - a.score) || (a.i - b.i));
  return decorated.map((d) => d.s);
}

// ── Trigger input validation ──────────────────────────────────────────────
export interface SuggestionTriggerInput {
  suggestion_type?: unknown;
  threshold_days?: unknown;
  milestone_type?: unknown;
  lead_id?: unknown;
}

export interface ProactiveValidationResult {
  ok: boolean;
  error?: ProactiveAiErrorCode;
  field?: string;
}

export function validateSuggestionTrigger(input: SuggestionTriggerInput): ProactiveValidationResult {
  if (!isValidSuggestionType(input.suggestion_type)) {
    return { ok: false, error: PROACTIVE_AI_ERROR_CODES.SUGGESTION_TYPE_INVALID, field: 'suggestion_type' };
  }
  // Thresholds: only required for inactivity-flavoured types.
  if (input.suggestion_type === 'inactivity_followup' || input.suggestion_type === 'win_back' || input.suggestion_type === 'churn_risk') {
    if (input.threshold_days == null || typeof input.threshold_days !== 'number' || !Number.isFinite(input.threshold_days) || input.threshold_days < 0) {
      return { ok: false, error: PROACTIVE_AI_ERROR_CODES.THRESHOLD_INVALID, field: 'threshold_days' };
    }
  }
  // Milestone: required only when type is milestone-flavoured.
  if (input.suggestion_type === 'milestone_outreach') {
    if (typeof input.milestone_type !== 'string' || !MILESTONE_TYPES_SET.has(input.milestone_type)) {
      return { ok: false, error: PROACTIVE_AI_ERROR_CODES.MILESTONE_INVALID, field: 'milestone_type' };
    }
  }
  if (input.lead_id !== undefined && typeof input.lead_id !== 'string') {
    return { ok: false, error: PROACTIVE_AI_ERROR_CODES.LEAD_INVALID, field: 'lead_id' };
  }
  return { ok: true };
}
