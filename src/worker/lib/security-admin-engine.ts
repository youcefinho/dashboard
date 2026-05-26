// ── security-admin-engine.ts — Security P0-8 admin helpers ───────────────
//
// PURE helpers (zero I/O) for `security-admin.ts` handlers:
//   • validateCapabilityOverride : enforce subset of frozen seq80 cap list
//   • parseAuditFilters          : URL → typed filters with bounds clamping
//   • extractUserIdFromPath      : safe path-param extraction
//   • formatAuditLogEntry        : DB row → AuditLogEntry shape
//
// 100% ADDITIF — duplicates the inline logic of `security-admin.ts` so the
// handlers can be refactored to delegate to these helpers at any time,
// without touching DB code paths. The frozen capability list is COPIED from
// `capabilities.ts:ALL_CAPABILITIES` (seq80) — DO NOT extend it here; if
// a new capability is added in seq80, also extend the list there.

// ── Codes d'erreur figés ──────────────────────────────────────────────────
export const SECURITY_ADMIN_ERROR_CODES = Object.freeze({
  AGENCY_ONLY: 'AGENCY_ONLY',
  OVERRIDE_INVALID: 'OVERRIDE_INVALID',
  CAPABILITY_UNKNOWN: 'CAPABILITY_UNKNOWN',
  INVALID_INPUT: 'INVALID_INPUT',
} as const);

export type SecurityAdminErrorCode =
  (typeof SECURITY_ADMIN_ERROR_CODES)[keyof typeof SECURITY_ADMIN_ERROR_CODES];

// ── Frozen capability whitelist (mirror of seq80 ALL_CAPABILITIES) ────────
// Kept LOCAL (not re-exported from capabilities.ts) to keep this engine pure
// and tree-shakeable. Sync if seq80 is extended.
export const SEQ80_CAPABILITIES = Object.freeze([
  'leads.read',
  'leads.write',
  'leads.delete',
  'export',
  'team.manage',
  'billing.view',
  'clients.manage',
  'reports.view',
  'workflows.manage',
  'invoices.write',
  'settings.manage',
  'ai.use',
] as const);

export type Seq80Capability = (typeof SEQ80_CAPABILITIES)[number];

// ── parseAuditFilters ─────────────────────────────────────────────────────

export interface AuditFilters {
  action?: string;
  userId?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;
const OFFSET_MAX = 1_000_000; // safety cap

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (raw == null) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function safeString(raw: string | null, maxLen: number): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLen) return trimmed.slice(0, maxLen);
  return trimmed;
}

/**
 * Parse audit log filters from URLSearchParams. Bounds-clamps limit/offset,
 * trims strings, drops empty values. Accepts both snake_case and camelCase
 * keys (handler legacy uses snake_case; this helper supports both).
 */
export function parseAuditFilters(query: URLSearchParams): AuditFilters {
  const action = safeString(query.get('action'), 100);
  const userId = safeString(query.get('user_id') ?? query.get('userId'), 100);
  const resourceType = safeString(
    query.get('resource_type') ?? query.get('resourceType'),
    50,
  );
  const from = safeString(query.get('date_from') ?? query.get('from'), 30);
  const to = safeString(query.get('date_to') ?? query.get('to'), 30);
  const limit = clampInt(query.get('limit'), LIMIT_DEFAULT, 1, LIMIT_MAX);
  const offset = clampInt(query.get('offset'), 0, 0, OFFSET_MAX);
  return { action, userId, resourceType, from, to, limit, offset };
}

// ── validateCapabilityOverride ────────────────────────────────────────────

export interface CapabilityOverrideInput {
  capability?: unknown;
  granted?: unknown;
}

export interface CapabilityOverrideValidation {
  ok: boolean;
  error?: SecurityAdminErrorCode;
  capability?: Seq80Capability;
  granted?: boolean;
}

/**
 * Validate a capability override payload:
 *   - `capability` must be a string in SEQ80_CAPABILITIES (frozen).
 *   - `granted` must be a boolean.
 *
 * Optional `userCaps` arg: when the *caller* is operating under capability
 * enforcement (mode-agence-only), we additionally ensure they cannot override
 * a capability they don't themselves hold. In legacy/mono-tenant (no caps
 * set passed), no extra check.
 */
export function validateCapabilityOverride(
  input: CapabilityOverrideInput,
  userCaps?: ReadonlySet<string> | null,
): CapabilityOverrideValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: SECURITY_ADMIN_ERROR_CODES.OVERRIDE_INVALID };
  }
  const cap = input.capability;
  const granted = input.granted;
  if (typeof cap !== 'string' || cap.length === 0) {
    return { ok: false, error: SECURITY_ADMIN_ERROR_CODES.OVERRIDE_INVALID };
  }
  if (typeof granted !== 'boolean') {
    return { ok: false, error: SECURITY_ADMIN_ERROR_CODES.OVERRIDE_INVALID };
  }
  if (!(SEQ80_CAPABILITIES as readonly string[]).includes(cap)) {
    return { ok: false, error: SECURITY_ADMIN_ERROR_CODES.CAPABILITY_UNKNOWN };
  }
  if (userCaps && userCaps.size > 0 && !userCaps.has(cap) && granted) {
    // Caller is trying to grant a capability they do not have → block.
    return { ok: false, error: SECURITY_ADMIN_ERROR_CODES.AGENCY_ONLY };
  }
  return { ok: true, capability: cap as Seq80Capability, granted };
}

// ── extractUserIdFromPath ─────────────────────────────────────────────────

/**
 * Extract :userId (and optional :capability) from RBAC override paths:
 *   /api/admin/capability-overrides/<userId>
 *   /api/admin/capability-overrides/<userId>/<capability>
 *
 * Robust: strips query/hash, decodes URI components, returns empty strings
 * (not throws) for malformed inputs.
 */
export function extractUserIdFromPath(
  path: string,
): { userId: string; capability: string | null } {
  if (typeof path !== 'string' || path.length === 0) {
    return { userId: '', capability: null };
  }
  const clean = (path.split('?')[0] ?? path).split('#')[0] ?? '';
  const parts = clean.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'capability-overrides');
  if (idx < 0 || idx + 1 >= parts.length) return { userId: '', capability: null };
  let userId = '';
  let capability: string | null = null;
  const rawUserId = parts[idx + 1] ?? '';
  try {
    userId = decodeURIComponent(rawUserId);
  } catch {
    userId = rawUserId;
  }
  const rawCap = parts[idx + 2];
  if (rawCap) {
    try {
      capability = decodeURIComponent(rawCap);
    } catch {
      capability = rawCap;
    }
  }
  return { userId, capability };
}

// ── formatAuditLogEntry ───────────────────────────────────────────────────

export interface AuditLogEntryShape {
  id: number;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  tenant_id: string | null;
  redacted: number;
  created_at: string;
}

function parseDetailsField(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Normalize a D1 audit_log row into the AuditLogEntry shape the API returns.
 * Coerces nullable columns and parses `details` JSON best-effort.
 */
export function formatAuditLogEntry(row: Record<string, unknown>): AuditLogEntryShape {
  return {
    id: Number(row.id ?? 0),
    user_id: (row.user_id as string | null) ?? null,
    action: String(row.action ?? ''),
    resource_type: (row.resource_type as string | null) ?? null,
    resource_id: (row.resource_id as string | null) ?? null,
    details: parseDetailsField(row.details),
    ip: (row.ip as string | null) ?? null,
    user_agent: (row.user_agent as string | null) ?? null,
    request_id: (row.request_id as string | null) ?? null,
    tenant_id: (row.tenant_id as string | null) ?? null,
    redacted: Number(row.redacted ?? 0),
    created_at: String(row.created_at ?? ''),
  };
}

// ── isSeq80Capability ─────────────────────────────────────────────────────
export function isSeq80Capability(cap: unknown): cap is Seq80Capability {
  return typeof cap === 'string' && (SEQ80_CAPABILITIES as readonly string[]).includes(cap);
}
