// ── documents-engine.test.ts — Tests RENFORCEMENT documents-engine.ts ───────
//
// Couvre les helpers PURS documents + e-signature : validation input,
// validation signers (ordre/email/role), state machine status, expiration,
// computeNextSigner multi-signer, validateDeadline.
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  DOCUMENTS_ERROR_CODES,
  VALID_DOC_STATUSES,
  VALID_DOC_TYPES,
  VALID_SIGNER_ROLES,
  MAX_SIGNERS_PER_DOC,
  validateDocumentInput,
  validateSigners,
  validateStatusTransition,
  isDocumentExpired,
  computeNextSigner,
  computeAllSigned,
  validateDeadline,
  type Signer,
} from '../lib/documents-engine';

// ── Constants ───────────────────────────────────────────────

describe('documents-engine — constants', () => {
  it('DOCUMENTS_ERROR_CODES is frozen', () => {
    expect(Object.isFrozen(DOCUMENTS_ERROR_CODES)).toBe(true);
  });

  it('VALID_DOC_STATUSES is frozen and includes core statuses', () => {
    expect(Object.isFrozen(VALID_DOC_STATUSES)).toBe(true);
    expect(VALID_DOC_STATUSES).toContain('draft');
    expect(VALID_DOC_STATUSES).toContain('sent');
    expect(VALID_DOC_STATUSES).toContain('signed');
    expect(VALID_DOC_STATUSES).toContain('won'); // legacy alias
    expect(VALID_DOC_STATUSES).toContain('expired');
    expect(VALID_DOC_STATUSES).toContain('voided');
    expect(VALID_DOC_STATUSES).toContain('declined');
    expect(VALID_DOC_STATUSES).toContain('completed');
  });

  it('VALID_DOC_TYPES is frozen and contains brief types', () => {
    expect(Object.isFrozen(VALID_DOC_TYPES)).toBe(true);
    expect(VALID_DOC_TYPES).toContain('contract');
    expect(VALID_DOC_TYPES).toContain('proposal');
    expect(VALID_DOC_TYPES).toContain('nda');
    expect(VALID_DOC_TYPES).toContain('sow');
    expect(VALID_DOC_TYPES).toContain('invoice');
    expect(VALID_DOC_TYPES).toContain('receipt');
  });

  it('VALID_SIGNER_ROLES frozen', () => {
    expect(Object.isFrozen(VALID_SIGNER_ROLES)).toBe(true);
    expect(VALID_SIGNER_ROLES).toContain('signer');
    expect(VALID_SIGNER_ROLES).toContain('approver');
    expect(VALID_SIGNER_ROLES).toContain('witness');
  });
});

// ── validateDocumentInput ───────────────────────────────────

describe('validateDocumentInput', () => {
  it('accepts valid input with body_html', () => {
    const r = validateDocumentInput({
      lead_id: 'lead_1',
      title: 'Test',
      body_html: '<p>X</p>',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts valid input with template_id (no body)', () => {
    const r = validateDocumentInput({
      lead_id: 'lead_1',
      template_id: 'tpl_1',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects null input', () => {
    const r = validateDocumentInput(null as never);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_INPUT);
  });

  it('rejects missing lead_id', () => {
    const r = validateDocumentInput({ body_html: '<p>X</p>' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.LEAD_REQUIRED);
    expect(r.field).toBe('lead_id');
  });

  it('rejects empty lead_id string', () => {
    const r = validateDocumentInput({ lead_id: '', body_html: '<p>X</p>' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.LEAD_REQUIRED);
  });

  it('rejects title too long', () => {
    const r = validateDocumentInput({
      lead_id: 'lead_1',
      title: 'a'.repeat(201),
      body_html: '<p>X</p>',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.TITLE_TOO_LONG);
  });

  it('rejects missing both body_html and template_id', () => {
    const r = validateDocumentInput({ lead_id: 'lead_1' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.BODY_OR_TEMPLATE_REQUIRED);
  });

  it('rejects invalid type', () => {
    const r = validateDocumentInput({
      lead_id: 'lead_1',
      body_html: '<p>X</p>',
      type: 'evil',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_TYPE);
  });

  it('accepts a known type', () => {
    const r = validateDocumentInput({
      lead_id: 'lead_1',
      body_html: '<p>X</p>',
      type: 'contract',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects body_html too large (>1Mo)', () => {
    const r = validateDocumentInput({
      lead_id: 'lead_1',
      body_html: 'a'.repeat(1_000_001),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_INPUT);
  });
});

// ── validateSigners ─────────────────────────────────────────

describe('validateSigners', () => {
  it('accepts a single valid signer', () => {
    const r = validateSigners([{ email: 'a@b.co' }]);
    expect(r.ok).toBe(true);
  });

  it('accepts multiple signers with unique emails and orders', () => {
    const r = validateSigners([
      { email: 'a@b.co', order: 0, role: 'signer' },
      { email: 'b@b.co', order: 1, role: 'approver' },
    ]);
    expect(r.ok).toBe(true);
  });

  it('rejects non-array', () => {
    const r = validateSigners('nope' as never);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_SIGNERS);
  });

  it('rejects empty array', () => {
    const r = validateSigners([]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.EMPTY_SIGNERS);
  });

  it('rejects too many signers', () => {
    const arr = Array.from({ length: MAX_SIGNERS_PER_DOC + 1 }, (_, i) => ({
      email: `a${i}@b.co`,
    }));
    const r = validateSigners(arr);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_SIGNERS);
  });

  it('rejects invalid email', () => {
    const r = validateSigners([{ email: 'not-an-email' }]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_SIGNER_EMAIL);
    expect(r.index).toBe(0);
  });

  it('rejects duplicate email (case-insensitive)', () => {
    const r = validateSigners([
      { email: 'a@b.co' },
      { email: 'A@B.CO' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.DUPLICATE_SIGNER_EMAIL);
    expect(r.index).toBe(1);
  });

  it('rejects duplicate order', () => {
    const r = validateSigners([
      { email: 'a@b.co', order: 0 },
      { email: 'b@b.co', order: 0 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.DUPLICATE_SIGNER_ORDER);
  });

  it('rejects invalid role', () => {
    const r = validateSigners([{ email: 'a@b.co', role: 'pirate' }]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_SIGNER_ROLE);
  });

  it('rejects negative order', () => {
    const r = validateSigners([{ email: 'a@b.co', order: -1 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_SIGNER_ORDER);
  });

  it('rejects non-integer order', () => {
    const r = validateSigners([{ email: 'a@b.co', order: 1.5 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_SIGNER_ORDER);
  });
});

// ── validateStatusTransition ────────────────────────────────

describe('validateStatusTransition', () => {
  it('allows draft → sent', () => {
    expect(validateStatusTransition('draft', 'sent').ok).toBe(true);
  });

  it('allows sent → viewed', () => {
    expect(validateStatusTransition('sent', 'viewed').ok).toBe(true);
  });

  it('allows sent → signed', () => {
    expect(validateStatusTransition('sent', 'signed').ok).toBe(true);
  });

  it('allows sent → won (legacy alias)', () => {
    expect(validateStatusTransition('sent', 'won').ok).toBe(true);
  });

  it('allows signed → completed', () => {
    expect(validateStatusTransition('signed', 'completed').ok).toBe(true);
  });

  it('rejects same status (no-op)', () => {
    const r = validateStatusTransition('draft', 'draft');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_TRANSITION);
  });

  it('rejects completed → draft (terminal)', () => {
    const r = validateStatusTransition('completed', 'draft');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_TRANSITION);
  });

  it('rejects voided → sent (terminal)', () => {
    expect(validateStatusTransition('voided', 'sent').ok).toBe(false);
  });

  it('rejects unknown status', () => {
    const r = validateStatusTransition('zorglub', 'sent');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_STATUS);
  });

  it('rejects unknown target', () => {
    const r = validateStatusTransition('draft', 'zorglub');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_STATUS);
  });
});

// ── isDocumentExpired ───────────────────────────────────────

describe('isDocumentExpired', () => {
  const NOW = Date.parse('2026-05-26T12:00:00Z');

  it('returns false when expires_at is null', () => {
    expect(isDocumentExpired({ expires_at: null }, NOW)).toBe(false);
  });

  it('returns true when expires_at in the past', () => {
    expect(isDocumentExpired({ expires_at: '2026-04-01T00:00:00Z' }, NOW)).toBe(true);
  });

  it('returns false when expires_at in the future', () => {
    expect(isDocumentExpired({ expires_at: '2026-12-31T00:00:00Z' }, NOW)).toBe(false);
  });

  it('accepts a Date object directly', () => {
    expect(isDocumentExpired(new Date('2026-01-01T00:00:00Z'), NOW)).toBe(true);
  });

  it('returns false on invalid string', () => {
    expect(isDocumentExpired({ expires_at: 'not-a-date' }, NOW)).toBe(false);
  });

  it('returns false on null input', () => {
    expect(isDocumentExpired(null, NOW)).toBe(false);
  });
});

// ── computeNextSigner ───────────────────────────────────────

describe('computeNextSigner', () => {
  it('returns first unsigned signer by order', () => {
    const signers: Signer[] = [
      { email: 'a@b.co', order: 1, signed_at: null },
      { email: 'b@b.co', order: 0, signed_at: '2026-05-01T00:00:00Z' },
    ];
    const next = computeNextSigner(signers);
    expect(next?.email).toBe('a@b.co');
  });

  it('returns null if all signed', () => {
    const signers: Signer[] = [
      { email: 'a@b.co', signed_at: '2026-01-01T00:00:00Z' },
      { email: 'b@b.co', signed_at: '2026-02-01T00:00:00Z' },
    ];
    expect(computeNextSigner(signers)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(computeNextSigner([])).toBeNull();
  });

  it('handles signers without order (placed at end)', () => {
    const signers: Signer[] = [
      { email: 'a@b.co' },
      { email: 'b@b.co', order: 0 },
    ];
    const next = computeNextSigner(signers);
    expect(next?.email).toBe('b@b.co');
  });

  it('returns next in tri order when currentIndex provided', () => {
    const signers: Signer[] = [
      { email: 'a@b.co', order: 0 },
      { email: 'b@b.co', order: 1 },
      { email: 'c@b.co', order: 2 },
    ];
    const next = computeNextSigner(signers, 0);
    expect(next?.email).toBe('b@b.co');
  });
});

// ── computeAllSigned ────────────────────────────────────────

describe('computeAllSigned', () => {
  it('returns true if all signed', () => {
    expect(
      computeAllSigned([
        { email: 'a@b.co', signed_at: '2026-01-01' },
        { email: 'b@b.co', signed_at: '2026-01-02' },
      ]),
    ).toBe(true);
  });

  it('returns false if any unsigned', () => {
    expect(
      computeAllSigned([
        { email: 'a@b.co', signed_at: '2026-01-01' },
        { email: 'b@b.co' },
      ]),
    ).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(computeAllSigned([])).toBe(false);
  });
});

// ── validateDeadline ────────────────────────────────────────

describe('validateDeadline', () => {
  const NOW = Date.parse('2026-05-26T12:00:00Z');

  it('accepts a future ISO date', () => {
    expect(validateDeadline('2026-12-31T00:00:00Z', NOW).ok).toBe(true);
  });

  it('rejects a past date', () => {
    const r = validateDeadline('2026-01-01T00:00:00Z', NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(DOCUMENTS_ERROR_CODES.INVALID_DEADLINE);
  });

  it('rejects empty string', () => {
    expect(validateDeadline('', NOW).ok).toBe(false);
  });

  it('rejects invalid string', () => {
    expect(validateDeadline('not-a-date', NOW).ok).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(validateDeadline(12345 as never, NOW).ok).toBe(false);
  });
});
