// ── lib/calls-outbound-engine.ts — RENFORCEMENT Communication P2 ─────────────
//
// Helpers PURS (zéro I/O, zéro D1, zéro fetch — pas de Twilio API) extraits/
// dérivés de calls-outbound.ts pour rendre testables :
//   - validation requête outbound (to E.164 + jurisdiction CRTC vs FCC),
//   - shouldRecordCall (opt-in CRTC QC bi-party / opt-out hors-QC US two-party),
//   - retry schedule exponentiel borné,
//   - whitelist call reason (sales/support/followup/scheduled/other),
//   - validation jurisdiction (qc/ca/us/eu) pour règles consent.
//
// AUCUNE dépendance Worker (Env, D1, fetch) → 100 % unit-testable.
// Module ADDITIF : calls-outbound.ts continue de fonctionner inchangé.

import { validatePhoneE164 } from './telephony-engine';

// ════════════════════════════════════════════════════════════════════════════
//  CODES ERREUR STABLES
// ════════════════════════════════════════════════════════════════════════════

export const CALLS_OUTBOUND_ERROR_CODES = {
  INVALID_TO: 'invalid_to',
  INVALID_FROM: 'invalid_from',
  INVALID_LEAD_ID: 'invalid_lead_id',
  CONSENT_REQUIRED: 'consent_required',
  INVALID_REASON: 'invalid_reason',
  INVALID_JURISDICTION: 'invalid_jurisdiction',
  RETRY_EXHAUSTED: 'retry_exhausted',
} as const;

export type CallsOutboundErrorCode =
  (typeof CALLS_OUTBOUND_ERROR_CODES)[keyof typeof CALLS_OUTBOUND_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
//  ENUMS FROZEN
// ════════════════════════════════════════════════════════════════════════════

/**
 * Raisons whitelistées (audit trail + classification). 'other' permet une
 * raison libre seulement si fournie en clair par l'agent (handler la rejette
 * sans note).
 */
export const VALID_CALL_REASONS = Object.freeze([
  'sales',
  'support',
  'followup',
  'scheduled',
  'other',
] as const);
export type CallReason = (typeof VALID_CALL_REASONS)[number];
const VALID_CALL_REASON_SET = new Set<string>(VALID_CALL_REASONS);

/**
 * Juridiction de la cible — gouverne les règles de consent :
 *   - qc / ca : CRTC bi-party (consent EXPLICITE des 2 parties pour record).
 *   - us      : two-party states (par défaut CRTC strict OK ; one-party non
 *               appliqué côté Intralys — politique conservative).
 *   - eu      : RGPD — consent EXPLICITE (équivalent CRTC).
 *   - other   : inconnu → consent EXPLICITE par défaut.
 */
export const VALID_JURISDICTIONS = Object.freeze(['qc', 'ca', 'us', 'eu', 'other'] as const);
export type Jurisdiction = (typeof VALID_JURISDICTIONS)[number];
const VALID_JURISDICTION_SET = new Set<string>(VALID_JURISDICTIONS);

// ════════════════════════════════════════════════════════════════════════════
//  Retry policy (exponential backoff)
// ════════════════════════════════════════════════════════════════════════════

export const RETRY_BASE_DELAY_MS = 1000;
export const RETRY_MAX_DELAY_MS = 60_000; // 60s plafond
export const RETRY_MAX_ATTEMPTS = 5;

export interface RetrySchedule {
  attempt: number;
  delayMs: number;
  finalAttempt: boolean;
}

/**
 * Backoff exponentiel borné : delay = min(BASE * 2^(n-1), MAX). n=1 → 1s,
 * n=2 → 2s, …, n=5 → 16s, n>=6 → finalAttempt true. Aucun jitter aléatoire
 * (purement déterministe pour test).
 */
export function computeRetrySchedule(attemptN: number): RetrySchedule {
  const n = Math.max(1, Math.floor(attemptN));
  if (n > RETRY_MAX_ATTEMPTS) {
    return { attempt: n, delayMs: 0, finalAttempt: true };
  }
  const exp = Math.pow(2, n - 1);
  const raw = RETRY_BASE_DELAY_MS * exp;
  const delayMs = Math.min(raw, RETRY_MAX_DELAY_MS);
  return { attempt: n, delayMs, finalAttempt: n === RETRY_MAX_ATTEMPTS };
}

// ════════════════════════════════════════════════════════════════════════════
//  Validators
// ════════════════════════════════════════════════════════════════════════════

export interface OutboundRequest {
  to?: unknown;
  from?: unknown;
  leadId?: unknown;
  record?: unknown;
  consentObtained?: unknown;
  reason?: unknown;
  jurisdiction?: unknown;
}

export interface OutboundValidationResult {
  ok: boolean;
  error?: string;
  code?: CallsOutboundErrorCode;
  field?: keyof OutboundRequest;
}

/**
 * Valide une requête outbound (additif au handler — ne remplace pas la
 * validation in-handler de calls-outbound.ts:96, complémentaire).
 *
 *   - to       : requis, E.164 strict.
 *   - from     : optionnel, E.164 strict si fourni.
 *   - leadId   : optionnel, string non vide (sanitization déjà handler).
 *   - record   : optionnel boolean.
 *   - consent  : si record=true alors consent doit être true (bi-party CRTC).
 *   - reason   : optionnel, ∈ VALID_CALL_REASONS.
 *   - jurisdiction : optionnel, ∈ VALID_JURISDICTIONS.
 */
export function validateOutboundRequest(req: OutboundRequest): OutboundValidationResult {
  if (!validatePhoneE164(req.to)) {
    return {
      ok: false,
      error: 'to invalide (E.164 strict requis)',
      code: CALLS_OUTBOUND_ERROR_CODES.INVALID_TO,
      field: 'to',
    };
  }
  if (req.from !== undefined && req.from !== null && req.from !== '') {
    if (!validatePhoneE164(req.from)) {
      return {
        ok: false,
        error: 'from invalide (E.164 strict si fourni)',
        code: CALLS_OUTBOUND_ERROR_CODES.INVALID_FROM,
        field: 'from',
      };
    }
  }
  if (req.leadId !== undefined && req.leadId !== null && req.leadId !== '') {
    if (typeof req.leadId !== 'string' || req.leadId.length > 64) {
      return {
        ok: false,
        error: 'leadId invalide (string ≤ 64)',
        code: CALLS_OUTBOUND_ERROR_CODES.INVALID_LEAD_ID,
        field: 'leadId',
      };
    }
  }
  const wantRecord = req.record === true;
  const consent = req.consentObtained === true;
  if (wantRecord && !consent) {
    return {
      ok: false,
      error: 'Consentement enregistrement requis (CRTC bi-party)',
      code: CALLS_OUTBOUND_ERROR_CODES.CONSENT_REQUIRED,
      field: 'consentObtained',
    };
  }
  if (req.reason !== undefined && req.reason !== null && req.reason !== '') {
    if (typeof req.reason !== 'string' || !VALID_CALL_REASON_SET.has(req.reason)) {
      return {
        ok: false,
        error: 'reason invalide',
        code: CALLS_OUTBOUND_ERROR_CODES.INVALID_REASON,
        field: 'reason',
      };
    }
  }
  if (req.jurisdiction !== undefined && req.jurisdiction !== null && req.jurisdiction !== '') {
    if (typeof req.jurisdiction !== 'string' || !VALID_JURISDICTION_SET.has(req.jurisdiction)) {
      return {
        ok: false,
        error: 'jurisdiction invalide',
        code: CALLS_OUTBOUND_ERROR_CODES.INVALID_JURISDICTION,
        field: 'jurisdiction',
      };
    }
  }
  return { ok: true };
}

/**
 * Décision d'enregistrement par juridiction :
 *   - QC/CA/EU : opt-in strict — record ssi consent === true.
 *   - US       : two-party par défaut (Intralys politique conservative) →
 *                record ssi consent === true (jamais one-party silencieux).
 *   - other    : par défaut consent EXPLICITE requis.
 *
 * Inconnu ou consent absent ⇒ false.
 */
export function shouldRecordCall(consent: unknown, jurisdiction: unknown): boolean {
  if (consent !== true) return false;
  if (typeof jurisdiction !== 'string') return true; // consent obtenu, juridiction inconnue → safe
  if (!VALID_JURISDICTION_SET.has(jurisdiction)) return false;
  // Toutes juridictions whitelistées : consent=true suffit. Politique unifiée
  // (CRTC strict cross-juridictions), évite trous légaux.
  return true;
}

/** Whitelist call reason (string → boolean). */
export function validateCallReason(reason: unknown): boolean {
  return typeof reason === 'string' && VALID_CALL_REASON_SET.has(reason);
}

/** Whitelist jurisdiction (string → boolean). */
export function validateJurisdiction(jurisdiction: unknown): boolean {
  return typeof jurisdiction === 'string' && VALID_JURISDICTION_SET.has(jurisdiction);
}
