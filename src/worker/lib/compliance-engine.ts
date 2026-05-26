// ── compliance-engine.ts — Security P0-8 compliance helpers ──────────────
//
// PURE helpers (zero I/O) for Loi 25 (Québec) + GDPR/RGPD (EU) flows:
//   • LOI_25_CONSENT_TYPES        : frozen list (marketing|analytics|personalization|profiling|cookies|data_processing|third_party_sharing)
//   • GDPR_REQUEST_TYPES          : frozen list (export|deletion|rectification|portability)
//   • validateConsentInput        : type whitelist + boolean granted
//   • computeConsentStatus        : derive active state from history
//   • validateGdprRequest         : type whitelist + email validation
//   • isWithinGdprWindow          : 30 days max to respond (GDPR Art 12.3)
//   • redactPii                   : re-export of audit-engine for symmetry
//
// 100% ADDITIF — complements `compliance.ts` handlers (which do DB). These
// helpers can be plugged at any time without touching SQL.

import { redactPii as redactPiiCore } from './audit-engine';

// ── Codes d'erreur figés ──────────────────────────────────────────────────
export const COMPLIANCE_ERROR_CODES = Object.freeze({
  CONSENT_TYPE_INVALID: 'CONSENT_TYPE_INVALID',
  CONSENT_GRANTED_INVALID: 'CONSENT_GRANTED_INVALID',
  CONSENT_INPUT_INVALID: 'CONSENT_INPUT_INVALID',
  GDPR_TYPE_INVALID: 'GDPR_TYPE_INVALID',
  GDPR_EMAIL_INVALID: 'GDPR_EMAIL_INVALID',
  GDPR_REQUEST_INVALID: 'GDPR_REQUEST_INVALID',
  GDPR_WINDOW_EXPIRED: 'GDPR_WINDOW_EXPIRED',
} as const);

export type ComplianceErrorCode =
  (typeof COMPLIANCE_ERROR_CODES)[keyof typeof COMPLIANCE_ERROR_CODES];

// ── Loi 25 consent types ──────────────────────────────────────────────────
// Aligns with `compliance.ts:handleLogConsent` allowedTypes + adds the
// granular Loi 25 categories (marketing/analytics/personalization/profiling).
export const LOI_25_CONSENT_TYPES = Object.freeze([
  'marketing',
  'marketing_email',
  'marketing_sms',
  'analytics',
  'personalization',
  'profiling',
  'cookies',
  'data_processing',
  'third_party_sharing',
] as const);

export type Loi25ConsentType = (typeof LOI_25_CONSENT_TYPES)[number];

const LOI_25_CONSENT_SET: ReadonlySet<string> = new Set<string>(LOI_25_CONSENT_TYPES);

// ── GDPR request types ────────────────────────────────────────────────────
// GDPR rights:
//   Art 15 → access (export)
//   Art 16 → rectification
//   Art 17 → erasure (deletion)
//   Art 20 → portability
export const GDPR_REQUEST_TYPES = Object.freeze([
  'export',
  'deletion',
  'rectification',
  'portability',
] as const);

export type GdprRequestType = (typeof GDPR_REQUEST_TYPES)[number];

const GDPR_TYPE_SET: ReadonlySet<string> = new Set<string>(GDPR_REQUEST_TYPES);

// ── GDPR response window (Art 12.3) ───────────────────────────────────────
// 30 days max to respond (extendable +60 with notice). We enforce the 30-day
// SLA at the engine layer; extension logic is caller's responsibility.
export const GDPR_RESPONSE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// ── validateConsentInput ──────────────────────────────────────────────────

export interface ConsentInput {
  consent_type?: unknown;
  granted?: unknown;
}

export interface ConsentInputValidation {
  ok: boolean;
  error?: ComplianceErrorCode;
  consentType?: Loi25ConsentType;
  granted?: boolean;
}

export function validateConsentInput(input: ConsentInput): ConsentInputValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: COMPLIANCE_ERROR_CODES.CONSENT_INPUT_INVALID };
  }
  const t = input.consent_type;
  const g = input.granted;
  if (typeof t !== 'string' || !LOI_25_CONSENT_SET.has(t)) {
    return { ok: false, error: COMPLIANCE_ERROR_CODES.CONSENT_TYPE_INVALID };
  }
  if (typeof g !== 'boolean') {
    return { ok: false, error: COMPLIANCE_ERROR_CODES.CONSENT_GRANTED_INVALID };
  }
  return { ok: true, consentType: t as Loi25ConsentType, granted: g };
}

// ── computeConsentStatus ──────────────────────────────────────────────────

export interface ConsentRecord {
  consent_type: string;
  granted: 0 | 1 | boolean;
  granted_at?: string | null;
  withdrawn_at?: string | null;
  created_at?: string | null;
}

export interface ConsentStatus {
  active: boolean;
  grantedAt?: string;
  withdrawnAt?: string;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

function timestamp(r: ConsentRecord): number {
  const raw = r.granted_at ?? r.created_at ?? r.withdrawn_at;
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Compute the CURRENT consent status for a given type from a list of
 * records (history). Latest record wins (sorted by granted_at/created_at).
 * Returns `{active: false}` if no record exists for this type.
 *
 * - If latest record is granted=true AND no withdrawn_at → active.
 * - If latest record is granted=false OR has withdrawn_at → inactive.
 */
export function computeConsentStatus(
  records: ConsentRecord[],
  consentType: string,
): ConsentStatus {
  if (!Array.isArray(records) || records.length === 0) return { active: false };
  const filtered = records.filter((r) => r && r.consent_type === consentType);
  if (filtered.length === 0) return { active: false };
  // Sort by timestamp DESC (latest first).
  const sorted = filtered.slice().sort((a, b) => timestamp(b) - timestamp(a));
  const latest = sorted[0];
  if (!latest) return { active: false };
  const granted = toBool(latest.granted);
  const withdrawn = !!latest.withdrawn_at;
  const active = granted && !withdrawn;
  const out: ConsentStatus = { active };
  if (latest.granted_at) out.grantedAt = latest.granted_at;
  if (latest.withdrawn_at) out.withdrawnAt = latest.withdrawn_at;
  return out;
}

// ── validateGdprRequest ───────────────────────────────────────────────────

export interface GdprRequestInput {
  type?: unknown;
  email?: unknown;
}

export interface GdprRequestValidation {
  ok: boolean;
  error?: ComplianceErrorCode;
  type?: GdprRequestType;
  email?: string;
}

// Minimal RFC 5322 email validation. Aligned with zod's `z.email()` for
// consistency with `schemas.ts`.
const EMAIL_VALID_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length > 0 && email.length <= 320 && EMAIL_VALID_RE.test(email);
}

export function validateGdprRequest(input: GdprRequestInput): GdprRequestValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: COMPLIANCE_ERROR_CODES.GDPR_REQUEST_INVALID };
  }
  const t = input.type;
  const e = input.email;
  if (typeof t !== 'string' || !GDPR_TYPE_SET.has(t)) {
    return { ok: false, error: COMPLIANCE_ERROR_CODES.GDPR_TYPE_INVALID };
  }
  if (!isValidEmail(e)) {
    return { ok: false, error: COMPLIANCE_ERROR_CODES.GDPR_EMAIL_INVALID };
  }
  return { ok: true, type: t as GdprRequestType, email: (e as string).toLowerCase() };
}

// ── isWithinGdprWindow ────────────────────────────────────────────────────

/**
 * Returns true if a request `requestedAt` is still within the GDPR Art 12.3
 * 30-day response window. Pure — `now` injected for testability.
 *
 * `requestedAt` accepts ISO string or ms epoch.
 */
export function isWithinGdprWindow(
  requestedAt: string | number | Date,
  now: number = Date.now(),
): boolean {
  let createdMs: number;
  if (requestedAt instanceof Date) {
    createdMs = requestedAt.getTime();
  } else if (typeof requestedAt === 'number') {
    createdMs = requestedAt < 1e12 ? requestedAt * 1000 : requestedAt;
  } else if (typeof requestedAt === 'string') {
    const parsed = Date.parse(requestedAt);
    if (!Number.isFinite(parsed)) return false;
    createdMs = parsed;
  } else {
    return false;
  }
  if (!Number.isFinite(createdMs)) return false;
  return now - createdMs <= GDPR_RESPONSE_WINDOW_MS;
}

// ── redactPii — re-export for symmetry with the engine surface ────────────
export function redactPii(text: string): string {
  return redactPiiCore(text);
}

// ── computeDataExport (Art 15) ────────────────────────────────────────────

export interface DataExportShape {
  lead: Record<string, unknown> | null;
  messages: unknown[];
  consents: unknown[];
  activities: unknown[];
  exported_at: string;
  purpose: string;
}

/**
 * Build the canonical GDPR Art 15 export shape. Pure aggregation — caller
 * fetches the DB rows. Adds the standard `exported_at` + `purpose` fields
 * required by Loi 25 / GDPR audit trails.
 */
export function buildDataExport(args: {
  lead: Record<string, unknown> | null;
  messages?: unknown[];
  consents?: unknown[];
  activities?: unknown[];
  now?: Date;
  purpose?: string;
}): DataExportShape {
  const now = args.now ?? new Date();
  return {
    lead: args.lead,
    messages: args.messages ?? [],
    consents: args.consents ?? [],
    activities: args.activities ?? [],
    exported_at: now.toISOString(),
    purpose:
      args.purpose ??
      'Export de données personnelles — Loi 25 sur la protection des renseignements personnels (Québec) / RGPD Art 15',
  };
}
