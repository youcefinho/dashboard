// ── tickets-engine.test.ts — Tests RENFORCEMENT tickets-engine.ts ──────────

import { describe, it, expect } from 'vitest';
import {
  TICKETS_ERROR_CODES,
  VALID_STATUSES,
  VALID_STATUSES_LEGACY,
  VALID_PRIORITIES,
  SLA_HOURS,
  TICKET_SUBJECT_MAX,
  TICKET_BODY_MAX,
  isValidStatus,
  isValidStatusLegacy,
  isValidPriority,
  isValidEmail,
  validateStatusTransition,
  computeSlaDeadline,
  isOverdue,
  validateTicketInput,
} from '../lib/tickets-engine';

// ════════════════════════════════════════════════════════════════════════════
// Error codes & frozen constants
// ════════════════════════════════════════════════════════════════════════════

describe('TICKETS_ERROR_CODES', () => {
  it('expose >= 8 codes', () => {
    expect(Object.keys(TICKETS_ERROR_CODES).length).toBeGreaterThanOrEqual(8);
  });
  it('codes critiques présents', () => {
    expect(TICKETS_ERROR_CODES.INVALID_TRANSITION).toBe('INVALID_TRANSITION');
    expect(TICKETS_ERROR_CODES.INVALID_PRIORITY).toBe('INVALID_PRIORITY');
    expect(TICKETS_ERROR_CODES.MISSING_SUBJECT).toBe('MISSING_SUBJECT');
  });
});

describe('VALID_STATUSES / VALID_PRIORITIES (frozen)', () => {
  it('canonique : open/pending/resolved/closed', () => {
    expect(VALID_STATUSES).toContain('open');
    expect(VALID_STATUSES).toContain('pending');
    expect(VALID_STATUSES).toContain('resolved');
    expect(VALID_STATUSES).toContain('closed');
    expect(VALID_STATUSES.length).toBe(4);
  });
  it('legacy : ouvert/en_cours/attente_client/resolu/escale', () => {
    expect(VALID_STATUSES_LEGACY).toContain('ouvert');
    expect(VALID_STATUSES_LEGACY).toContain('en_cours');
  });
  it('VALID_PRIORITIES low/medium/high/urgent', () => {
    expect(VALID_PRIORITIES).toContain('low');
    expect(VALID_PRIORITIES).toContain('urgent');
    expect(VALID_PRIORITIES.length).toBe(4);
  });
  it('frozen', () => {
    expect(Object.isFrozen(VALID_STATUSES)).toBe(true);
    expect(Object.isFrozen(VALID_PRIORITIES)).toBe(true);
    expect(Object.isFrozen(SLA_HOURS)).toBe(true);
  });
});

describe('SLA_HOURS', () => {
  it('low=24, medium=8, high=4, urgent=1', () => {
    expect(SLA_HOURS.low).toBe(24);
    expect(SLA_HOURS.medium).toBe(8);
    expect(SLA_HOURS.high).toBe(4);
    expect(SLA_HOURS.urgent).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isValid* helpers
// ════════════════════════════════════════════════════════════════════════════

describe('isValidStatus / isValidStatusLegacy / isValidPriority', () => {
  it('isValidStatus accepte open, rejette ouvert', () => {
    expect(isValidStatus('open')).toBe(true);
    expect(isValidStatus('ouvert')).toBe(false);
    expect(isValidStatus(null)).toBe(false);
  });
  it('isValidStatusLegacy accepte ouvert, rejette open', () => {
    expect(isValidStatusLegacy('ouvert')).toBe(true);
    expect(isValidStatusLegacy('open')).toBe(false);
  });
  it('isValidPriority accepte urgent', () => {
    expect(isValidPriority('urgent')).toBe(true);
    expect(isValidPriority('emergency')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('accepte alice@example.com', () => {
    expect(isValidEmail('alice@example.com')).toBe(true);
  });
  it('rejette format invalide', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
  it('rejette non-string', () => {
    expect(isValidEmail(42)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateStatusTransition (state machine)
// ════════════════════════════════════════════════════════════════════════════

describe('validateStatusTransition (canonique)', () => {
  it('open → pending OK', () => {
    expect(validateStatusTransition('open', 'pending').ok).toBe(true);
  });
  it('open → resolved OK', () => {
    expect(validateStatusTransition('open', 'resolved').ok).toBe(true);
  });
  it('pending → open OK (réouverture)', () => {
    expect(validateStatusTransition('pending', 'open').ok).toBe(true);
  });
  it('closed → open INTERDIT (terminal)', () => {
    const r = validateStatusTransition('closed', 'open');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(TICKETS_ERROR_CODES.INVALID_TRANSITION);
  });
  it('resolved → closed OK', () => {
    expect(validateStatusTransition('resolved', 'closed').ok).toBe(true);
  });
  it('open → open OK (no-op)', () => {
    expect(validateStatusTransition('open', 'open').ok).toBe(true);
  });
  it('rejette statuts mixtes (canonique + legacy)', () => {
    expect(validateStatusTransition('open', 'ouvert').ok).toBe(false);
  });
});

describe('validateStatusTransition (legacy)', () => {
  it('ouvert → en_cours OK', () => {
    expect(validateStatusTransition('ouvert', 'en_cours').ok).toBe(true);
  });
  it('resolu → en_cours OK (réouverture)', () => {
    expect(validateStatusTransition('resolu', 'en_cours').ok).toBe(true);
  });
  it('escale → en_cours OK', () => {
    expect(validateStatusTransition('escale', 'en_cours').ok).toBe(true);
  });
  it('rejette statut inconnu', () => {
    expect(validateStatusTransition('open', 'foo').ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// computeSlaDeadline
// ════════════════════════════════════════════════════════════════════════════

describe('computeSlaDeadline', () => {
  it('urgent → +1h', () => {
    const created = new Date('2026-01-01T10:00:00Z');
    const d = computeSlaDeadline(created, 'urgent');
    expect(d.getTime() - created.getTime()).toBe(60 * 60 * 1000);
  });
  it('low → +24h', () => {
    const created = new Date('2026-01-01T10:00:00Z');
    const d = computeSlaDeadline(created, 'low');
    expect(d.getTime() - created.getTime()).toBe(24 * 60 * 60 * 1000);
  });
  it('accepte timestamp ms', () => {
    const ms = Date.now();
    const d = computeSlaDeadline(ms, 'high');
    expect(d.getTime() - ms).toBe(4 * 60 * 60 * 1000);
  });
  it('accepte timestamp s (< 1e12)', () => {
    const s = Math.floor(Date.now() / 1000);
    const d = computeSlaDeadline(s, 'medium');
    expect(d.getTime() - s * 1000).toBe(8 * 60 * 60 * 1000);
  });
  it('accepte ISO string', () => {
    const d = computeSlaDeadline('2026-01-01T10:00:00Z', 'urgent');
    expect(d instanceof Date).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isOverdue
// ════════════════════════════════════════════════════════════════════════════

describe('isOverdue', () => {
  it('null ticket → false', () => {
    expect(isOverdue(null)).toBe(false);
  });
  it('ticket resolved → false (terminal)', () => {
    expect(
      isOverdue({
        status: 'resolved',
        sla_due_at: Date.now() - 1000,
      }),
    ).toBe(false);
  });
  it('ticket closed → false', () => {
    expect(
      isOverdue({
        status: 'closed',
        sla_due_at: Date.now() - 1000,
      }),
    ).toBe(false);
  });
  it('sla_due_at dans le futur → false', () => {
    expect(
      isOverdue(
        { status: 'open', sla_due_at: Date.now() + 60 * 60 * 1000 },
        Date.now(),
      ),
    ).toBe(false);
  });
  it('sla_due_at dans le passé → true', () => {
    expect(
      isOverdue(
        { status: 'open', sla_due_at: Date.now() - 60 * 60 * 1000 },
        Date.now(),
      ),
    ).toBe(true);
  });
  it('fallback created_at + priority urgent (passé > 1h)', () => {
    const now = Date.now();
    expect(
      isOverdue(
        {
          status: 'open',
          created_at: now - 2 * 60 * 60 * 1000,
          priority: 'urgent',
        },
        now,
      ),
    ).toBe(true);
  });
  it('fallback created_at + priority low (1h passé < 24h)', () => {
    const now = Date.now();
    expect(
      isOverdue(
        {
          status: 'open',
          created_at: now - 60 * 60 * 1000,
          priority: 'low',
        },
        now,
      ),
    ).toBe(false);
  });
  it('sans created_at ni sla_due_at → false', () => {
    expect(isOverdue({ status: 'open' })).toBe(false);
  });
  it('accepte epoch seconds dans sla_due_at', () => {
    const nowS = Math.floor(Date.now() / 1000);
    expect(
      isOverdue(
        { status: 'open', sla_due_at: nowS - 100 },
        Date.now(),
      ),
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateTicketInput
// ════════════════════════════════════════════════════════════════════════════

describe('validateTicketInput (create)', () => {
  it('accepte input minimal', () => {
    expect(validateTicketInput({ subject: 'Help' }).ok).toBe(true);
  });
  it('rejette subject manquant', () => {
    const r = validateTicketInput({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(TICKETS_ERROR_CODES.MISSING_SUBJECT);
  });
  it('rejette subject vide', () => {
    expect(validateTicketInput({ subject: '' }).ok).toBe(false);
  });
  it('rejette subject > MAX', () => {
    const r = validateTicketInput({
      subject: 'a'.repeat(TICKET_SUBJECT_MAX + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(TICKETS_ERROR_CODES.SUBJECT_TOO_LONG);
  });
  it('rejette body > MAX', () => {
    const r = validateTicketInput({
      subject: 'X',
      body: 'b'.repeat(TICKET_BODY_MAX + 1),
    });
    expect(r.ok).toBe(false);
  });
  it('rejette priority invalide', () => {
    expect(
      validateTicketInput({ subject: 'X', priority: 'emergency' }).ok,
    ).toBe(false);
  });
  it('accepte priority high', () => {
    expect(validateTicketInput({ subject: 'X', priority: 'high' }).ok).toBe(true);
  });
  it('accepte status legacy (ouvert)', () => {
    expect(validateTicketInput({ subject: 'X', status: 'ouvert' }).ok).toBe(true);
  });
  it('accepte status canonique (open)', () => {
    expect(validateTicketInput({ subject: 'X', status: 'open' }).ok).toBe(true);
  });
  it('rejette status inconnu', () => {
    expect(validateTicketInput({ subject: 'X', status: 'limbo' }).ok).toBe(false);
  });
  it('rejette email invalide', () => {
    const r = validateTicketInput({
      subject: 'X',
      requester_email: 'not-an-email',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(TICKETS_ERROR_CODES.INVALID_EMAIL);
  });
  it('accepte email valide', () => {
    expect(
      validateTicketInput({
        subject: 'X',
        requester_email: 'a@b.com',
      }).ok,
    ).toBe(true);
  });
});

describe('validateTicketInput (update)', () => {
  it('accepte input vide (no-op)', () => {
    expect(validateTicketInput({}, 'update').ok).toBe(true);
  });
  it('rejette subject vide en update si fourni', () => {
    expect(validateTicketInput({ subject: '' }, 'update').ok).toBe(false);
  });
  it('accepte status seul en update', () => {
    expect(
      validateTicketInput({ status: 'resolved' }, 'update').ok,
    ).toBe(true);
  });
});
