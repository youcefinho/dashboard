// ── tickets-engine.ts — Helpers PURS support tickets (RENFORCEMENT P1-6) ───
//
// Contrat ADDITIF — 100% : aucun import depuis tickets.ts existant. Helpers
// PURS (zéro I/O) pour :
//   - Validation des inputs tickets (subject, body, priority, status)
//   - State machine status (open/pending/resolved/closed + tickets.ts legacy)
//   - SLA deadline computation (par priorité)
//   - isOverdue (ticket vs now)
//
// Compatibilité tickets.ts : on supporte LES DEUX vocabulaires de status :
//   - canonique (open/pending/resolved/closed) demandé par P1-6
//   - tickets.ts disque (ouvert/en_cours/attente_client/resolu/escale)
// Les deux vocabulaires sont validés ; transitions définies pour chaque.

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const TICKETS_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_SUBJECT: 'MISSING_SUBJECT',
  SUBJECT_TOO_LONG: 'SUBJECT_TOO_LONG',
  BODY_TOO_LONG: 'BODY_TOO_LONG',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_PRIORITY: 'INVALID_PRIORITY',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  TICKET_CLOSED: 'TICKET_CLOSED',
  TICKET_NOT_FOUND: 'TICKET_NOT_FOUND',
  INVALID_SLA: 'INVALID_SLA',
  INVALID_EMAIL: 'INVALID_EMAIL',
} as const;

export type TicketsErrorCode =
  (typeof TICKETS_ERROR_CODES)[keyof typeof TICKETS_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Constantes énumérations (frozen)
// ════════════════════════════════════════════════════════════════════════════

// Vocabulaire CANONIQUE (P1-6 brief).
export const VALID_STATUSES = Object.freeze([
  'open',
  'pending',
  'resolved',
  'closed',
] as const);
export type TicketStatus = (typeof VALID_STATUSES)[number];

// Vocabulaire LEGACY (tickets.ts disque, gardé pour compat refactor opt-in).
export const VALID_STATUSES_LEGACY = Object.freeze([
  'ouvert',
  'en_cours',
  'attente_client',
  'resolu',
  'escale',
] as const);
export type TicketStatusLegacy = (typeof VALID_STATUSES_LEGACY)[number];

export const VALID_PRIORITIES = Object.freeze([
  'low',
  'medium',
  'high',
  'urgent',
] as const);
export type TicketPriority = (typeof VALID_PRIORITIES)[number];

// SLA heures par priorité (canonique).
export const SLA_HOURS: Readonly<Record<TicketPriority, number>> = Object.freeze(
  {
    low: 24,
    medium: 8,
    high: 4,
    urgent: 1,
  },
);

// Bornes max applicatives.
export const TICKET_SUBJECT_MAX = 200;
export const TICKET_BODY_MAX = 5000;
export const TICKET_NAME_MAX = 100;
export const TICKET_EMAIL_MAX = 200;
export const TICKET_PHONE_MAX = 30;

// ════════════════════════════════════════════════════════════════════════════
// isValid* helpers
// ════════════════════════════════════════════════════════════════════════════

export function isValidStatus(v: unknown): v is TicketStatus {
  return typeof v === 'string' && (VALID_STATUSES as readonly string[]).includes(v);
}

export function isValidStatusLegacy(v: unknown): v is TicketStatusLegacy {
  return (
    typeof v === 'string' &&
    (VALID_STATUSES_LEGACY as readonly string[]).includes(v)
  );
}

export function isValidPriority(v: unknown): v is TicketPriority {
  return (
    typeof v === 'string' && (VALID_PRIORITIES as readonly string[]).includes(v)
  );
}

// Format email basique (pas RFC complet — calque sanitize handler).
export function isValidEmail(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  if (v.length === 0 || v.length > TICKET_EMAIL_MAX) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// ════════════════════════════════════════════════════════════════════════════
// State machine — validateStatusTransition
// ════════════════════════════════════════════════════════════════════════════

// Transitions canoniques (open→pending→resolved→closed avec re-open possibles).
const ALLOWED_TRANSITIONS: Readonly<Record<TicketStatus, ReadonlyArray<TicketStatus>>> = {
  open: ['pending', 'resolved', 'closed'],
  pending: ['open', 'resolved', 'closed'],
  resolved: ['open', 'pending', 'closed'], // re-open accepté avant closed
  closed: [], // closed = terminal (re-open via reopen explicite hors scope ici)
};

// Transitions LEGACY (tickets.ts disque) — open/closed-like.
const ALLOWED_TRANSITIONS_LEGACY: Readonly<
  Record<TicketStatusLegacy, ReadonlyArray<TicketStatusLegacy>>
> = {
  ouvert: ['en_cours', 'attente_client', 'resolu', 'escale'],
  en_cours: ['ouvert', 'attente_client', 'resolu', 'escale'],
  attente_client: ['ouvert', 'en_cours', 'resolu', 'escale'],
  resolu: ['ouvert', 'en_cours'], // re-open
  escale: ['en_cours', 'resolu'],
};

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string; code: TicketsErrorCode };

/**
 * Valide une transition de statut (state machine).
 * Détecte automatiquement le vocabulaire (canonique vs legacy).
 * Same-state (from === to) : ok (no-op).
 */
export function validateStatusTransition(
  from: unknown,
  to: unknown,
): TransitionResult {
  if (typeof from !== 'string' || typeof to !== 'string') {
    return {
      ok: false,
      error: 'Statut invalide',
      code: TICKETS_ERROR_CODES.INVALID_STATUS,
    };
  }
  if (from === to) return { ok: true };

  if (isValidStatus(from) && isValidStatus(to)) {
    const allowed = ALLOWED_TRANSITIONS[from];
    if (allowed.includes(to)) return { ok: true };
    return {
      ok: false,
      error: `Transition ${from} → ${to} interdite`,
      code: TICKETS_ERROR_CODES.INVALID_TRANSITION,
    };
  }

  if (isValidStatusLegacy(from) && isValidStatusLegacy(to)) {
    const allowed = ALLOWED_TRANSITIONS_LEGACY[from];
    if (allowed.includes(to)) return { ok: true };
    return {
      ok: false,
      error: `Transition ${from} → ${to} interdite`,
      code: TICKETS_ERROR_CODES.INVALID_TRANSITION,
    };
  }

  return {
    ok: false,
    error: 'Statut invalide',
    code: TICKETS_ERROR_CODES.INVALID_STATUS,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SLA — computeSlaDeadline + isOverdue
// ════════════════════════════════════════════════════════════════════════════

/**
 * Calcule la deadline SLA selon priorité.
 * createdAt : Date | timestamp(ms) | timestamp(s) | ISO string.
 * Retourne Date (UTC).
 */
export function computeSlaDeadline(
  createdAt: Date | number | string,
  priority: TicketPriority,
): Date {
  let ms: number;
  if (createdAt instanceof Date) {
    ms = createdAt.getTime();
  } else if (typeof createdAt === 'number') {
    // Epoch s si < 1e12, sinon ms.
    ms = createdAt < 1e12 ? createdAt * 1000 : createdAt;
  } else {
    ms = Date.parse(String(createdAt));
  }
  if (!Number.isFinite(ms)) ms = Date.now();
  const hours = SLA_HOURS[priority];
  return new Date(ms + hours * 60 * 60 * 1000);
}

export type TicketForOverdue = {
  created_at?: number | string | Date | null;
  sla_due_at?: number | string | Date | null;
  priority?: TicketPriority | string | null;
  status?: string | null;
};

/**
 * Détermine si un ticket est en retard SLA.
 * - Si status est resolved/closed/resolu → jamais overdue.
 * - Si sla_due_at fourni : compare à now.
 * - Sinon : recalcul depuis created_at + priority.
 */
export function isOverdue(
  ticket: TicketForOverdue | null | undefined,
  now: Date | number = Date.now(),
): boolean {
  if (!ticket) return false;
  const status = String(ticket.status ?? '');
  // Statuts terminaux : pas overdue.
  if (
    status === 'resolved' ||
    status === 'closed' ||
    status === 'resolu'
  ) {
    return false;
  }
  const nowMs = now instanceof Date ? now.getTime() : Number(now);

  // 1) sla_due_at explicite (epoch s/ms ou ISO).
  if (ticket.sla_due_at != null) {
    let dueMs: number;
    if (ticket.sla_due_at instanceof Date) {
      dueMs = ticket.sla_due_at.getTime();
    } else if (typeof ticket.sla_due_at === 'number') {
      dueMs =
        ticket.sla_due_at < 1e12
          ? ticket.sla_due_at * 1000
          : ticket.sla_due_at;
    } else {
      dueMs = Date.parse(String(ticket.sla_due_at));
    }
    if (Number.isFinite(dueMs)) return nowMs > dueMs;
  }

  // 2) fallback : recalc depuis created_at + priority.
  if (ticket.created_at != null && isValidPriority(ticket.priority)) {
    const deadline = computeSlaDeadline(
      ticket.created_at as Date | number | string,
      ticket.priority,
    );
    return nowMs > deadline.getTime();
  }

  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// validateTicketInput
// ════════════════════════════════════════════════════════════════════════════

export type TicketInput = {
  subject?: unknown;
  body?: unknown;
  requester_name?: unknown;
  requester_email?: unknown;
  requester_phone?: unknown;
  priority?: unknown;
  status?: unknown;
};

export type TicketValidationResult =
  | { ok: true }
  | { ok: false; error: string; field?: string; code: TicketsErrorCode };

/**
 * Valide un input ticket (create ou update).
 * - mode 'create' : subject requis.
 * - mode 'update' : champs partiels (si fournis → validés).
 * - Au moins email OU phone si requester_* fournis (pour matching CRM).
 */
export function validateTicketInput(
  input: TicketInput | null | undefined,
  mode: 'create' | 'update' = 'create',
): TicketValidationResult {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Requête invalide',
      code: TICKETS_ERROR_CODES.INVALID_INPUT,
    };
  }

  // subject
  if (mode === 'create') {
    if (typeof input.subject !== 'string' || input.subject.trim() === '') {
      return {
        ok: false,
        error: "L'objet est requis",
        field: 'subject',
        code: TICKETS_ERROR_CODES.MISSING_SUBJECT,
      };
    }
    if (input.subject.length > TICKET_SUBJECT_MAX) {
      return {
        ok: false,
        error: 'Objet trop long',
        field: 'subject',
        code: TICKETS_ERROR_CODES.SUBJECT_TOO_LONG,
      };
    }
  } else if (input.subject !== undefined) {
    if (typeof input.subject !== 'string' || input.subject.trim() === '') {
      return {
        ok: false,
        error: "L'objet ne peut pas être vide",
        field: 'subject',
        code: TICKETS_ERROR_CODES.MISSING_SUBJECT,
      };
    }
    if (input.subject.length > TICKET_SUBJECT_MAX) {
      return {
        ok: false,
        error: 'Objet trop long',
        field: 'subject',
        code: TICKETS_ERROR_CODES.SUBJECT_TOO_LONG,
      };
    }
  }

  // body
  if (input.body !== undefined && input.body !== null) {
    if (typeof input.body !== 'string') {
      return {
        ok: false,
        error: 'Body invalide',
        field: 'body',
        code: TICKETS_ERROR_CODES.INVALID_INPUT,
      };
    }
    if (input.body.length > TICKET_BODY_MAX) {
      return {
        ok: false,
        error: 'Message trop long',
        field: 'body',
        code: TICKETS_ERROR_CODES.BODY_TOO_LONG,
      };
    }
  }

  // priority (optionnel)
  if (input.priority !== undefined && input.priority !== null && input.priority !== '') {
    if (!isValidPriority(input.priority)) {
      return {
        ok: false,
        error: 'Priorité invalide',
        field: 'priority',
        code: TICKETS_ERROR_CODES.INVALID_PRIORITY,
      };
    }
  }

  // status (optionnel) — accepte canonique OU legacy.
  if (input.status !== undefined && input.status !== null && input.status !== '') {
    if (!isValidStatus(input.status) && !isValidStatusLegacy(input.status)) {
      return {
        ok: false,
        error: 'Statut invalide',
        field: 'status',
        code: TICKETS_ERROR_CODES.INVALID_STATUS,
      };
    }
  }

  // requester_email (si fourni → format)
  if (
    input.requester_email !== undefined &&
    input.requester_email !== null &&
    input.requester_email !== ''
  ) {
    if (!isValidEmail(input.requester_email)) {
      return {
        ok: false,
        error: 'Email invalide',
        field: 'requester_email',
        code: TICKETS_ERROR_CODES.INVALID_EMAIL,
      };
    }
  }

  return { ok: true };
}
