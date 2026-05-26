// ── audit-engine.ts — Security P0-8 audit log helpers ────────────────────
//
// PURE helpers (zero I/O) for the audit_log subsystem:
//   • VALID_ACTIONS              : frozen whitelist of allowed audit actions
//   • validateAuditAction        : whitelist check
//   • formatAuditEntry           : normalize shape before persist
//   • isWithinRetention          : compute retention window (default 90d)
//   • sanitizeMetadata           : strip PII (emails, phones, IPs, CC) from metadata
//
// Complements `audit-redact.ts` (which redacts SECRETS by KEY): this engine
// redacts PII by VALUE pattern. Together they guarantee audit_log.details
// contains neither secrets (keys) nor PII (free-text values).
//
// Immutability is enforced at the DB layer (no UPDATE/DELETE handlers on
// audit_log) — this engine is the gate on the WRITE path.

// ── Codes d'erreur figés ──────────────────────────────────────────────────
export const AUDIT_ERROR_CODES = Object.freeze({
  ACTION_INVALID: 'ACTION_INVALID',
  ACTION_UNKNOWN: 'ACTION_UNKNOWN',
  RETENTION_EXPIRED: 'RETENTION_EXPIRED',
  METADATA_INVALID: 'METADATA_INVALID',
} as const);

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[keyof typeof AUDIT_ERROR_CODES];

// ── Retention default ─────────────────────────────────────────────────────
export const RETENTION_DAYS_DEFAULT = 90;
export const RETENTION_DAYS_MAX = 3650; // 10 years (legal max for some QC sectors)

// ── Valid actions whitelist ───────────────────────────────────────────────
// FROZEN — extend ONLY via migration (new action → audit_actions migration
// + tests). The whitelist covers all known emitters (catalog.ts, leads.ts,
// auth.ts, billing.ts, etc.) verified by `audit-coverage.test.ts`.
//
// Convention : `<domain>.<resource?>.<action>` lowercase, dot-separated,
// no spaces. `*` (wildcard) is NOT allowed.
export const VALID_ACTIONS = Object.freeze([
  // Auth & session
  'auth.login', 'auth.logout', 'auth.login_failed', 'auth.session_revoked',
  'auth.password_reset_requested', 'auth.password_reset_completed',
  'auth.2fa_enabled', 'auth.2fa_disabled', 'auth.2fa_verified',
  'auth.backup_code_used', 'auth.backup_codes_regenerated',
  // Users
  'user.created', 'user.updated', 'user.deleted', 'user.role_changed',
  'user.invited', 'user.invite_accepted', 'user.suspended', 'user.reactivated',
  // RBAC
  'rbac.override.set', 'rbac.override.delete',
  // Leads / contacts
  'lead.created', 'lead.updated', 'lead.deleted', 'lead.forget',
  'lead.export_pii', 'lead.merged',
  // Catalog
  'catalog.product.created', 'catalog.product.updated', 'catalog.product.deleted',
  'catalog.import', 'catalog.export',
  // Billing / payments
  'billing.subscribed', 'billing.cancelled', 'billing.refunded',
  'billing.invoice_created', 'billing.payment_failed',
  // Settings
  'settings.updated', 'settings.api_key_generated', 'settings.api_key_revoked',
  // Workflows
  'workflow.created', 'workflow.updated', 'workflow.deleted', 'workflow.run',
  // Admin
  'admin.audit_log.viewed', 'admin.user.impersonated',
  'admin.tenant.created', 'admin.tenant.suspended',
  // Compliance
  'consent.log', 'consent.withdrawn',
  'compliance.gdpr.export_requested', 'compliance.gdpr.deletion_requested',
  'compliance.gdpr.rectification_requested', 'compliance.gdpr.portability_requested',
  // AI
  'ai.chat.message', 'ai.content.generated', 'ai.quota_exceeded',
  // Bookings / appointments
  'booking.created', 'booking.updated', 'booking.cancelled',
  // Misc
  'export.created', 'import.created', 'webhook.delivered', 'webhook.failed',
] as const);

export type AuditAction = (typeof VALID_ACTIONS)[number];

const VALID_ACTIONS_SET: ReadonlySet<string> = new Set<string>(VALID_ACTIONS);

/** Action format validator (lowercase, dot-segments). */
const ACTION_FORMAT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function isValidActionFormat(action: unknown): boolean {
  return typeof action === 'string' && action.length > 0 && action.length <= 100 && ACTION_FORMAT.test(action);
}

/** Whitelist + format validation. Returns true only if BOTH pass. */
export function validateAuditAction(action: unknown): boolean {
  if (!isValidActionFormat(action)) return false;
  return VALID_ACTIONS_SET.has(action as string);
}

// ── Retention ─────────────────────────────────────────────────────────────

/**
 * Returns true if a record created at `createdAt` is still within the
 * retention window. Useful for pre-purge filters and read-time gating.
 *
 * `createdAt` may be an ISO string, ms epoch, or seconds epoch.
 */
export function isWithinRetention(
  createdAt: string | number | Date,
  retentionDays: number = RETENTION_DAYS_DEFAULT,
  now: number = Date.now(),
): boolean {
  const days = Math.max(0, Math.min(retentionDays, RETENTION_DAYS_MAX));
  const ttlMs = days * 24 * 60 * 60 * 1000;
  let createdMs: number;
  if (createdAt instanceof Date) {
    createdMs = createdAt.getTime();
  } else if (typeof createdAt === 'number') {
    // Heuristic: numbers < 1e12 are likely seconds-epoch (pre-2001 in ms).
    createdMs = createdAt < 1e12 ? createdAt * 1000 : createdAt;
  } else if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt);
    if (!Number.isFinite(parsed)) return false;
    createdMs = parsed;
  } else {
    return false;
  }
  if (!Number.isFinite(createdMs)) return false;
  return now - createdMs <= ttlMs;
}

// ── PII sanitization ──────────────────────────────────────────────────────

// Email: RFC 5322 simplified.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Phone: international + 10-15 digits, optional spaces/dashes/parens.
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g;
// IPv4
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// IPv6 (simplified)
const IPV6_RE = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g;
// Credit card: 13-19 digits, optional dashes/spaces (Luhn check skipped — pattern is enough for redaction).
const CC_RE = /\b(?:\d[ -]?){13,19}\b/g;
// SIN / SSN (Canadian/US 9-digit, with optional separators).
const SIN_RE = /\b\d{3}[-\s]?\d{2,3}[-\s]?\d{3,4}\b/g;

const REDACTED = '[REDACTED]';

/**
 * Redact PII from a free-text string. Order matters: CC/SIN BEFORE phone
 * (overlap), email BEFORE generic patterns.
 */
export function redactPii(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  // Email first (specific).
  out = out.replace(EMAIL_RE, REDACTED);
  // IP addresses.
  out = out.replace(IPV6_RE, REDACTED);
  out = out.replace(IPV4_RE, REDACTED);
  // Credit cards (must come before phones — they overlap).
  out = out.replace(CC_RE, REDACTED);
  // SIN/SSN.
  out = out.replace(SIN_RE, REDACTED);
  // Phone last (least specific, most permissive pattern).
  out = out.replace(PHONE_RE, REDACTED);
  return out;
}

/**
 * Walk arbitrary metadata and redact PII from all string VALUES. Object
 * KEYS are preserved untouched. Null/undefined/numbers/booleans are passed
 * through as-is.
 *
 * Returns a plain `Record<string, unknown>` (drops Maps/Sets/functions —
 * which have no business in audit metadata). Throws never.
 */
export function sanitizeMetadata(meta: unknown): Record<string, unknown> {
  if (meta == null || typeof meta !== 'object') return {};
  if (Array.isArray(meta)) {
    // Top-level arrays get wrapped under `_array` to keep return shape
    // consistent (audit_log.details is a JSON object, not array).
    return { _array: walkArray(meta) };
  }
  const src = meta as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) {
    out[k] = walkValue(src[k]);
  }
  return out;
}

function walkValue(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === 'string') return redactPii(v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return walkArray(v);
  if (typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) out[k] = walkValue(src[k]);
    return out;
  }
  // function / symbol / bigint → drop.
  return null;
}

function walkArray(arr: unknown[]): unknown[] {
  return arr.map(walkValue);
}

// ── formatAuditEntry ──────────────────────────────────────────────────────

export interface AuditEntryInput {
  userId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  tenantId?: string | null;
}

export interface AuditEntryFormatted {
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  tenant_id: string | null;
  redacted: 0 | 1;
}

/**
 * Format an audit entry input for DB insert. Sanitizes metadata (PII),
 * normalizes null fields, and flips `redacted = 1` if any PII was stripped.
 *
 * Caller is responsible for adding `id` and `created_at` at the SQL layer
 * (typically `lower(hex(randomblob(16)))` and `datetime('now')`).
 */
export function formatAuditEntry(input: AuditEntryInput): AuditEntryFormatted {
  const cleanMetadata = sanitizeMetadata(input.metadata);
  // Detect if redaction actually happened by comparing serialized inputs.
  // Cheap heuristic — only used to set `redacted` flag, not for security.
  let redacted: 0 | 1 = 0;
  try {
    const before = input.metadata != null ? JSON.stringify(input.metadata) : '';
    const after = JSON.stringify(cleanMetadata);
    if (before.includes(REDACTED) === false && after.includes(REDACTED)) {
      redacted = 1;
    }
  } catch {
    // Circular reference / BigInt → can't compare; default 0.
    redacted = 0;
  }
  return {
    user_id: input.userId ?? null,
    action: String(input.action ?? ''),
    resource_type: input.resourceType ?? null,
    resource_id: input.resourceId ?? null,
    details: cleanMetadata,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    request_id: input.requestId ?? null,
    tenant_id: input.tenantId ?? null,
    redacted,
  };
}
