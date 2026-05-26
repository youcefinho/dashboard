// ── Disputes engine — Sprint E6 M2 helpers PURS (2026-05-26) ───────────────-
//
// Helpers PURS (zéro I/O) pour renforcer le webhook dispute. Additif : NE
// remplace PAS handleDisputeWebhook (ecommerce-disputes.ts), il fournit des
// bricks pour parser les events Stripe dispute + valider la fenêtre de preuve.
//
// ⚠️ FRONTIÈRE RÉGULÉE — handleDisputeWebhook = ENREGISTREMENT DB SEUL, AUCUN
// mouvement de fonds. Ces helpers respectent strictement cette règle (PURS).

// ── Codes erreur stables ──────────────────────────────────────────────────-

export const DISPUTE_ERROR_CODES = {
  UNKNOWN_EVENT: 'unknown_event',
  MISSING_DATA: 'missing_data',
  EVIDENCE_WINDOW_EXPIRED: 'evidence_window_expired',
  EVIDENCE_INCOMPLETE: 'evidence_incomplete',
  INVALID_STATUS: 'invalid_status',
  INVALID_AMOUNT: 'invalid_amount',
} as const;

export type DisputeErrorCode =
  (typeof DISPUTE_ERROR_CODES)[keyof typeof DISPUTE_ERROR_CODES];

// ── Status enum aligné Stripe + machine locale ─────────────────────────────-

export const DISPUTE_STATUSES = [
  'open',
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'charge_refunded',
  'won',
  'lost',
  'closed',
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * Fenêtre de soumission de preuve (jours).
 *
 * Stripe par défaut donne 7-21 jours (varie selon réseau carte). On retient un
 * SAFE défaut conservateur 7 jours côté Intralys — le handler peut surcharger.
 */
export const EVIDENCE_WINDOW_DAYS = 7;

// ── Helpers ────────────────────────────────────────────────────────────────-

/** Vrai si status appartient à DISPUTE_STATUSES. */
export function isValidDisputeStatus(s: unknown): s is DisputeStatus {
  if (typeof s !== 'string') return false;
  return (DISPUTE_STATUSES as readonly string[]).includes(s);
}

/**
 * Vrai si l'instant de référence est dans la fenêtre de soumission de preuve.
 *
 * @param disputeCreatedAt date création du litige
 * @param now              instant de référence (default Date.now())
 * @param windowDays       défaut EVIDENCE_WINDOW_DAYS
 */
export function isWithinEvidenceWindow(
  disputeCreatedAt: Date | string | null,
  now: Date | string = new Date(),
  windowDays: number = EVIDENCE_WINDOW_DAYS,
): boolean {
  if (disputeCreatedAt == null) return false;
  const base =
    disputeCreatedAt instanceof Date
      ? disputeCreatedAt
      : new Date(disputeCreatedAt);
  const ref = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(base.getTime()) || Number.isNaN(ref.getTime())) return false;
  if (!Number.isFinite(windowDays) || windowDays < 0) return false;
  const elapsedDays = (ref.getTime() - base.getTime()) / (24 * 60 * 60 * 1000);
  if (elapsedDays < 0) return false;
  return elapsedDays <= windowDays;
}

// ── Evidence validation ────────────────────────────────────────────────────-

/**
 * Champs evidence Stripe communément requis pour un rebuttal carte-non-présente.
 * Liste minimale (le handler peut exiger plus) :
 *   - customer_email_address
 *   - customer_name
 *   - product_description
 *   - service_documentation OR receipt
 *
 * NOTE : si receipt fourni → service_documentation devient optionnel et vice-versa.
 */
export const EVIDENCE_REQUIRED_FIELDS = [
  'customer_email_address',
  'customer_name',
  'product_description',
] as const;

export const EVIDENCE_OR_FIELDS = ['service_documentation', 'receipt'] as const;

export interface ValidateEvidenceResult {
  ok: boolean;
  error?: string;
  missing?: string[];
  code?: DisputeErrorCode;
}

/**
 * Valide que l'evidence object contient les champs obligatoires.
 * Champs string non-vides après trim().
 */
export function validateEvidenceFields(
  evidence: Record<string, unknown> | null | undefined,
): ValidateEvidenceResult {
  if (evidence == null || typeof evidence !== 'object') {
    return {
      ok: false,
      error: 'Evidence object manquant.',
      missing: [...EVIDENCE_REQUIRED_FIELDS],
      code: DISPUTE_ERROR_CODES.EVIDENCE_INCOMPLETE,
    };
  }
  const missing: string[] = [];
  for (const f of EVIDENCE_REQUIRED_FIELDS) {
    const v = evidence[f];
    if (typeof v !== 'string' || v.trim().length === 0) {
      missing.push(f);
    }
  }
  // OR-fields : au moins UN doit être présent.
  const hasOne = EVIDENCE_OR_FIELDS.some((f) => {
    const v = evidence[f];
    return typeof v === 'string' && v.trim().length > 0;
  });
  if (!hasOne) missing.push(`one_of:${EVIDENCE_OR_FIELDS.join('|')}`);

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Champs evidence manquants : ${missing.join(', ')}.`,
      missing,
      code: DISPUTE_ERROR_CODES.EVIDENCE_INCOMPLETE,
    };
  }
  return { ok: true };
}

// ── Stripe dispute event parser ────────────────────────────────────────────-

export type ParsedDisputeKind =
  | 'created'
  | 'funds_withdrawn'
  | 'funds_reinstated'
  | 'updated'
  | 'closed'
  | 'won'
  | 'lost';

export interface ParsedDisputeData {
  dispute_ref: string;
  charge_ref: string | null;
  amount_cents: number;
  currency: string | null;
  status: string | null;
  reason: string | null;
  created_at: number | null; // unix seconds
}

export type ParseStripeDisputeResult =
  | { kind: ParsedDisputeKind; data: ParsedDisputeData }
  | { error: string; code: DisputeErrorCode };

/**
 * Parse un event Stripe `charge.dispute.*` en un outcome typé.
 *
 * Mapping :
 *   - charge.dispute.created         → kind:'created'
 *   - charge.dispute.funds_withdrawn → kind:'funds_withdrawn'
 *   - charge.dispute.funds_reinstated → kind:'funds_reinstated'
 *   - charge.dispute.updated         → kind:'updated'
 *   - charge.dispute.closed          → kind:'closed' (avec status='won'/'lost' parsé séparément)
 *
 * NE déclenche AUCUN mouvement de fonds (helper pur). Le handler décide quoi
 * faire à partir du kind + data (cf. ⚠️ ZONE RÉGULÉE handleDisputeWebhook).
 */
export function parseStripeDispute(
  event: { type?: unknown; data?: { object?: Record<string, unknown> } } | null | undefined,
): ParseStripeDisputeResult {
  if (event == null || typeof event !== 'object') {
    return {
      error: 'Event Stripe invalide.',
      code: DISPUTE_ERROR_CODES.UNKNOWN_EVENT,
    };
  }
  const type = typeof event.type === 'string' ? event.type : '';
  const obj = event.data?.object ?? null;
  if (!obj || typeof obj !== 'object') {
    return {
      error: 'Event Stripe sans data.object.',
      code: DISPUTE_ERROR_CODES.MISSING_DATA,
    };
  }

  const kindMap: Record<string, ParsedDisputeKind> = {
    'charge.dispute.created': 'created',
    'charge.dispute.funds_withdrawn': 'funds_withdrawn',
    'charge.dispute.funds_reinstated': 'funds_reinstated',
    'charge.dispute.updated': 'updated',
    'charge.dispute.closed': 'closed',
  };
  const kind = kindMap[type];
  if (!kind) {
    return {
      error: `Type d'event Stripe dispute inconnu : ${type || '(vide)'}`,
      code: DISPUTE_ERROR_CODES.UNKNOWN_EVENT,
    };
  }

  const o = obj as Record<string, unknown>;
  const disputeRef = typeof o.id === 'string' ? o.id : '';
  if (!disputeRef) {
    return {
      error: 'Dispute Stripe sans id.',
      code: DISPUTE_ERROR_CODES.MISSING_DATA,
    };
  }

  const amount = Math.max(0, Math.round(Number(o.amount) || 0));
  const currency =
    typeof o.currency === 'string' ? o.currency.toUpperCase() : null;
  const status = typeof o.status === 'string' ? o.status : null;
  const reason = typeof o.reason === 'string' ? o.reason : null;
  const chargeRef = typeof o.charge === 'string' ? o.charge : null;
  const created =
    typeof o.created === 'number' && Number.isFinite(o.created)
      ? Math.round(o.created)
      : null;

  // À 'closed', sub-kind selon status (won/lost) — exposé séparément pour
  // permettre au handler de discriminer sans re-parse.
  let finalKind: ParsedDisputeKind = kind;
  if (kind === 'closed') {
    if (status === 'won') finalKind = 'won';
    else if (status === 'lost') finalKind = 'lost';
  }

  return {
    kind: finalKind,
    data: {
      dispute_ref: disputeRef,
      charge_ref: chargeRef,
      amount_cents: amount,
      currency,
      status,
      reason,
      created_at: created,
    },
  };
}
