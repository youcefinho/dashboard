// ── documents-engine.ts — Helpers PURS documents + e-signature (P2-1) ───────
//
// 100% ADDITIF — complète `documents.ts` (handlers DB). Helpers PURS (zéro
// I/O) pour :
//   - Validation des inputs document (template/lead/title/body_html)
//   - Validation des signers (ordre, email, role)
//   - State machine status (draft|sent|viewed|signed|completed|expired|voided|declined)
//   - Expiry detection (isDocumentExpired)
//   - Calcul du prochain signer (computeNextSigner)
//
// COMPATIBILITÉ : `documents.ts` disque utilise `'won'` comme statut signé
// (legacy mapping). On expose 'signed' ET 'won' (alias) pour rester
// compatible sans casser les routes existantes. Voir VALID_DOC_STATUSES.

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const DOCUMENTS_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  TITLE_REQUIRED: 'TITLE_REQUIRED',
  TITLE_TOO_LONG: 'TITLE_TOO_LONG',
  LEAD_REQUIRED: 'LEAD_REQUIRED',
  BODY_OR_TEMPLATE_REQUIRED: 'BODY_OR_TEMPLATE_REQUIRED',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  INVALID_SIGNERS: 'INVALID_SIGNERS',
  EMPTY_SIGNERS: 'EMPTY_SIGNERS',
  DUPLICATE_SIGNER_EMAIL: 'DUPLICATE_SIGNER_EMAIL',
  DUPLICATE_SIGNER_ORDER: 'DUPLICATE_SIGNER_ORDER',
  INVALID_SIGNER_EMAIL: 'INVALID_SIGNER_EMAIL',
  INVALID_SIGNER_ROLE: 'INVALID_SIGNER_ROLE',
  INVALID_SIGNER_ORDER: 'INVALID_SIGNER_ORDER',
  INVALID_DEADLINE: 'INVALID_DEADLINE',
  EXPIRED: 'EXPIRED',
} as const);

export type DocumentsErrorCode =
  (typeof DOCUMENTS_ERROR_CODES)[keyof typeof DOCUMENTS_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Constantes
// ════════════════════════════════════════════════════════════════════════════

// Statuts canoniques. `won` est l'alias legacy de `signed` utilisé dans
// `documents.ts` (table `documents.status`). `completed` n'est pas dans la DB
// actuelle mais réservé pour multi-signers (tous signé → completed).
export const VALID_DOC_STATUSES = Object.freeze([
  'draft',
  'sent',
  'viewed',
  'signed',
  'won', // alias legacy de 'signed' (cf documents.ts)
  'completed',
  'expired',
  'voided',
  'declined',
] as const);
export type DocumentStatus = (typeof VALID_DOC_STATUSES)[number];

const DOC_STATUS_SET: ReadonlySet<string> = new Set<string>(VALID_DOC_STATUSES);

// Types de documents canoniques.
export const VALID_DOC_TYPES = Object.freeze([
  'contract',
  'proposal',
  'nda',
  'sow',
  'invoice',
  'receipt',
  'oaciq_mandate', // legacy compat (cf handleGenerateOaciq)
  'mandate',
  'other',
] as const);
export type DocumentType = (typeof VALID_DOC_TYPES)[number];

const DOC_TYPE_SET: ReadonlySet<string> = new Set<string>(VALID_DOC_TYPES);

// Rôles de signers.
export const VALID_SIGNER_ROLES = Object.freeze([
  'signer',
  'approver',
  'witness',
  'cc',
  'receiver',
] as const);
export type SignerRole = (typeof VALID_SIGNER_ROLES)[number];

const SIGNER_ROLE_SET: ReadonlySet<string> = new Set<string>(VALID_SIGNER_ROLES);

// Constantes métier.
export const DOC_EXPIRY_DAYS_DEFAULT = 30;
export const DOC_TITLE_MAX_LEN = 200;
export const DOC_BODY_MAX_LEN = 1_000_000; // 1 Mo HTML max
export const SIGNER_EMAIL_MAX_LEN = 320;
export const MAX_SIGNERS_PER_DOC = 50;

// ════════════════════════════════════════════════════════════════════════════
// Email validation (RFC 5322 light — aligned avec compliance-engine)
// ════════════════════════════════════════════════════════════════════════════

const EMAIL_VALID_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(email: unknown): email is string {
  return (
    typeof email === 'string' &&
    email.length > 0 &&
    email.length <= SIGNER_EMAIL_MAX_LEN &&
    EMAIL_VALID_RE.test(email)
  );
}

// ════════════════════════════════════════════════════════════════════════════
// State machine : transitions valides
// ════════════════════════════════════════════════════════════════════════════
//
// Règles (alignées sur documents.ts) :
//   draft     → sent | voided | declined
//   sent      → viewed | signed | won | expired | voided | declined
//   viewed    → signed | won | expired | declined
//   signed    → completed | voided
//   won       → completed | voided (alias signed)
//   completed → (terminal)
//   expired   → (terminal) — peut être ré-ouvert par admin via voided→draft (out of scope)
//   voided    → (terminal)
//   declined  → (terminal)

const TRANSITIONS: ReadonlyMap<DocumentStatus, ReadonlySet<DocumentStatus>> = new Map<
  DocumentStatus,
  ReadonlySet<DocumentStatus>
>([
  ['draft', new Set(['sent', 'voided', 'declined'] as DocumentStatus[])],
  [
    'sent',
    new Set([
      'viewed',
      'signed',
      'won',
      'expired',
      'voided',
      'declined',
    ] as DocumentStatus[]),
  ],
  ['viewed', new Set(['signed', 'won', 'expired', 'declined', 'voided'] as DocumentStatus[])],
  ['signed', new Set(['completed', 'voided'] as DocumentStatus[])],
  ['won', new Set(['completed', 'voided'] as DocumentStatus[])],
  ['completed', new Set<DocumentStatus>()],
  ['expired', new Set<DocumentStatus>()],
  ['voided', new Set<DocumentStatus>()],
  ['declined', new Set<DocumentStatus>()],
]);

// ════════════════════════════════════════════════════════════════════════════
// validateDocumentInput
// ════════════════════════════════════════════════════════════════════════════

export interface DocumentInput {
  lead_id?: unknown;
  title?: unknown;
  body_html?: unknown;
  template_id?: unknown;
  type?: unknown;
}

export interface DocumentInputValidation {
  ok: boolean;
  error?: DocumentsErrorCode;
  field?: string;
}

export function validateDocumentInput(input: DocumentInput): DocumentInputValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_INPUT };
  }
  const leadId = input.lead_id;
  if (typeof leadId !== 'string' || leadId.length === 0) {
    return {
      ok: false,
      error: DOCUMENTS_ERROR_CODES.LEAD_REQUIRED,
      field: 'lead_id',
    };
  }
  const title = input.title;
  if (typeof title === 'string' && title.length > DOC_TITLE_MAX_LEN) {
    return {
      ok: false,
      error: DOCUMENTS_ERROR_CODES.TITLE_TOO_LONG,
      field: 'title',
    };
  }
  const bodyHtml = input.body_html;
  const templateId = input.template_id;
  const hasBody = typeof bodyHtml === 'string' && bodyHtml.length > 0;
  const hasTemplate = typeof templateId === 'string' && templateId.length > 0;
  if (!hasBody && !hasTemplate) {
    return {
      ok: false,
      error: DOCUMENTS_ERROR_CODES.BODY_OR_TEMPLATE_REQUIRED,
      field: 'body_html',
    };
  }
  if (hasBody && (bodyHtml as string).length > DOC_BODY_MAX_LEN) {
    return {
      ok: false,
      error: DOCUMENTS_ERROR_CODES.INVALID_INPUT,
      field: 'body_html',
    };
  }
  if (input.type !== undefined) {
    if (typeof input.type !== 'string' || !DOC_TYPE_SET.has(input.type)) {
      return {
        ok: false,
        error: DOCUMENTS_ERROR_CODES.INVALID_TYPE,
        field: 'type',
      };
    }
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// validateSigners
// ════════════════════════════════════════════════════════════════════════════

export interface Signer {
  email: string;
  role?: SignerRole | string;
  order?: number;
  name?: string;
  signed_at?: string | null;
}

export interface SignersValidation {
  ok: boolean;
  error?: DocumentsErrorCode;
  field?: string;
  index?: number;
}

export function validateSigners(signers: unknown): SignersValidation {
  if (!Array.isArray(signers)) {
    return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_SIGNERS };
  }
  if (signers.length === 0) {
    return { ok: false, error: DOCUMENTS_ERROR_CODES.EMPTY_SIGNERS };
  }
  if (signers.length > MAX_SIGNERS_PER_DOC) {
    return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_SIGNERS };
  }
  const emails = new Set<string>();
  const orders = new Set<number>();
  for (let i = 0; i < signers.length; i++) {
    const s = signers[i] as Signer | null;
    if (!s || typeof s !== 'object') {
      return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_SIGNERS, index: i };
    }
    if (!isValidEmail(s.email)) {
      return {
        ok: false,
        error: DOCUMENTS_ERROR_CODES.INVALID_SIGNER_EMAIL,
        field: 'email',
        index: i,
      };
    }
    const emailLower = s.email.toLowerCase();
    if (emails.has(emailLower)) {
      return {
        ok: false,
        error: DOCUMENTS_ERROR_CODES.DUPLICATE_SIGNER_EMAIL,
        field: 'email',
        index: i,
      };
    }
    emails.add(emailLower);
    if (s.role !== undefined) {
      if (typeof s.role !== 'string' || !SIGNER_ROLE_SET.has(s.role)) {
        return {
          ok: false,
          error: DOCUMENTS_ERROR_CODES.INVALID_SIGNER_ROLE,
          field: 'role',
          index: i,
        };
      }
    }
    if (s.order !== undefined) {
      if (
        typeof s.order !== 'number' ||
        !Number.isFinite(s.order) ||
        !Number.isInteger(s.order) ||
        s.order < 0
      ) {
        return {
          ok: false,
          error: DOCUMENTS_ERROR_CODES.INVALID_SIGNER_ORDER,
          field: 'order',
          index: i,
        };
      }
      if (orders.has(s.order)) {
        return {
          ok: false,
          error: DOCUMENTS_ERROR_CODES.DUPLICATE_SIGNER_ORDER,
          field: 'order',
          index: i,
        };
      }
      orders.add(s.order);
    }
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// validateStatusTransition
// ════════════════════════════════════════════════════════════════════════════

export interface TransitionValidation {
  ok: boolean;
  error?: DocumentsErrorCode;
}

export function validateStatusTransition(
  from: unknown,
  to: unknown,
): TransitionValidation {
  if (typeof from !== 'string' || !DOC_STATUS_SET.has(from)) {
    return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_STATUS };
  }
  if (typeof to !== 'string' || !DOC_STATUS_SET.has(to)) {
    return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_STATUS };
  }
  if (from === to) {
    // Pas une transition (no-op) — refusé.
    return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_TRANSITION };
  }
  const allowed = TRANSITIONS.get(from as DocumentStatus);
  if (!allowed || !allowed.has(to as DocumentStatus)) {
    return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_TRANSITION };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// isDocumentExpired
// ════════════════════════════════════════════════════════════════════════════
//
// Retourne true si le document a expiré. `expires_at` accepte ISO string, ms
// epoch, Date, ou objet `{ expires_at }`. `now` injecté pour testability.

export function isDocumentExpired(
  doc:
    | { expires_at?: string | number | Date | null }
    | string
    | number
    | Date
    | null
    | undefined,
  now: number = Date.now(),
): boolean {
  let raw: string | number | Date | null | undefined;
  if (doc && typeof doc === 'object' && !(doc instanceof Date)) {
    raw = (doc as { expires_at?: string | number | Date | null }).expires_at;
  } else {
    raw = doc as string | number | Date | null | undefined;
  }
  if (raw == null) return false;
  let expiresMs: number;
  if (raw instanceof Date) {
    expiresMs = raw.getTime();
  } else if (typeof raw === 'number') {
    expiresMs = raw < 1e12 ? raw * 1000 : raw;
  } else if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return false;
    expiresMs = parsed;
  } else {
    return false;
  }
  if (!Number.isFinite(expiresMs)) return false;
  return expiresMs < now;
}

// ════════════════════════════════════════════════════════════════════════════
// computeNextSigner — multi-signer flow
// ════════════════════════════════════════════════════════════════════════════
//
// Retourne le prochain signer non encore signé. Tri par `order` ascendant.
// Signers sans `order` sont placés en fin. Si `currentIndex` est fourni,
// on cherche le prochain signer dans l'ordre APRÈS cet index (signé ou non).
// Si tous ont signé → null.

export function computeNextSigner(
  signers: Signer[],
  currentIndex?: number,
): Signer | null {
  if (!Array.isArray(signers) || signers.length === 0) return null;
  // Tri par order ascendant (undefined en fin).
  const sorted = signers
    .slice()
    .map((s, i) => ({ s, i, order: typeof s?.order === 'number' ? s.order : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.order - b.order || a.i - b.i);

  if (typeof currentIndex === 'number' && Number.isFinite(currentIndex)) {
    // Trouve position du signer courant dans le tri.
    const pos = sorted.findIndex((x) => x.i === currentIndex);
    if (pos === -1) return null;
    // Prochain dans l'ordre (signé ou non).
    const next = sorted[pos + 1];
    return next ? next.s : null;
  }

  // Premier signer non encore signé.
  for (const x of sorted) {
    if (!x.s.signed_at) return x.s;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// computeAllSigned — utilitaire complémentaire
// ════════════════════════════════════════════════════════════════════════════

export function computeAllSigned(signers: Signer[]): boolean {
  if (!Array.isArray(signers) || signers.length === 0) return false;
  return signers.every((s) => !!s && !!s.signed_at);
}

// ════════════════════════════════════════════════════════════════════════════
// validateDeadline — utilitaire
// ════════════════════════════════════════════════════════════════════════════
//
// Vérifie qu'une deadline ISO est valide ET dans le futur (par rapport à `now`).

export function validateDeadline(
  deadline: unknown,
  now: number = Date.now(),
): TransitionValidation {
  if (typeof deadline !== 'string' || deadline.length === 0) {
    return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_DEADLINE };
  }
  const parsed = Date.parse(deadline);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_DEADLINE };
  }
  if (parsed <= now) {
    return { ok: false, error: DOCUMENTS_ERROR_CODES.INVALID_DEADLINE };
  }
  return { ok: true };
}
