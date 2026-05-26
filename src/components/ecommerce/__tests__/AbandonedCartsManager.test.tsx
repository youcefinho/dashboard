// @vitest-environment jsdom
// ── Sprint 40 — Agent B3 — Tests AbandonedCartsManager ──────────────────────
//
// Couvre :
//  1. Render 2 carts mock → tableau (1 row par cart, triés par next_due ASC).
//  2. Click "Skip" → updateRecoveryConfig(cartId, { skip: true }).
//     ⚠️ La consigne sprint mentionne `{ recovery_email_sent_count: +1 }` mais
//     le helper `updateRecoveryConfig` est FIGÉ (cf. src/lib/api.ts) — son
//     input n'accepte que `{ skip?, force_resend?, override_coupon_code? }`.
//     La sémantique "skip step" passe donc par `skip: true` côté serveur (qui
//     marque la séquence complétée). Test cohérent avec le contrat figé.
//  3. Click "Pause" → updateRecoveryConfig(cartId, { skip: true }).
//     Idem : "pause" et "skip" partagent le même mapping API (le contrat figé
//     ne distingue pas les 2 — la distinction vit côté UX/toast seulement).
//  4. Empty (0 carts actifs) → EmptyState rendu.
//
// Imports RELATIFS (consigne sprint).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { RecoverySequenceState } from '../../../lib/types';

// ── Mocks ───────────────────────────────────────────────────────────────────

// i18n : t() renvoie la clé (assertions déterministes).
vi.mock('../../../lib/i18n', () => ({
  t: (k: string) => k,
  getLocale: () => 'fr-CA',
}));
vi.mock('../../lib/i18n/datetime', () => ({
  formatDate: (s: string) => `DATE(${s})`,
}));

// api : mock les 2 helpers utilisés.
const getRecoverySequenceStatesMock = vi.fn();
const updateRecoveryConfigMock = vi.fn();
vi.mock('../../../lib/api', () => ({
  getRecoverySequenceStates: (...args: unknown[]) =>
    getRecoverySequenceStatesMock(...args),
  updateRecoveryConfig: (...args: unknown[]) =>
    updateRecoveryConfigMock(...args),
}));

// UI : mocks minimaux découplés du design system (on teste la logique, pas
// le rendu visuel des primitives). useToast → no-op success/error.
vi.mock('../../ui', () => {
  const passthrough = ({ children, ...props }: any) =>
    // span pour neutralité (pas de side-effect form/button)
    // — mais on garde <button> pour Button (a11y + click events).
    null && children;
  void passthrough;
  return {
    Button: ({ children, onClick, disabled, 'aria-label': ariaLabel, ...rest }: any) => (
      <button onClick={onClick} disabled={disabled} aria-label={ariaLabel} {...rest}>
        {children}
      </button>
    ),
    Tag: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
    Skeleton: (props: any) => <div data-testid="skeleton" {...props} />,
    EmptyState: ({ title }: any) => (
      <div data-testid="empty-state">{title}</div>
    ),
    Icon: () => null,
    useToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Import APRÈS les mocks.
import { AbandonedCartsManager } from '../AbandonedCartsManager';

// ── Fixtures ────────────────────────────────────────────────────────────────

function mkCart(over: Partial<RecoverySequenceState> = {}): RecoverySequenceState {
  return {
    cart_id: 'cart_01',
    cart_token: 'tok_abcdef0123456789abcdef',
    recovery_email_sent_count: 1,
    last_recovery_at: '2026-05-23T10:00:00Z',
    next_recovery_due_at: '2026-05-24T10:00:00Z',
    recovery_discount_code: 'SAVE5',
    recovery_completed_at: null,
    attempts: [
      {
        step: 1,
        channel: 'email',
        sent_at: '2026-05-23T10:00:00Z',
        coupon_code: null,
      },
    ],
    ...over,
  };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  getRecoverySequenceStatesMock.mockReset();
  updateRecoveryConfigMock.mockReset();
  // Default: succès, retour vide (override par test).
  updateRecoveryConfigMock.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  cleanup();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AbandonedCartsManager', () => {
  it('rend une rangée de tableau par cart actif (2 carts mock)', async () => {
    const cartA = mkCart({
      cart_id: 'cart_A',
      next_recovery_due_at: '2026-05-25T10:00:00Z',
    });
    const cartB = mkCart({
      cart_id: 'cart_B',
      next_recovery_due_at: '2026-05-24T09:00:00Z',
    });
    getRecoverySequenceStatesMock.mockResolvedValue({
      data: [cartA, cartB],
      error: null,
    });

    render(<AbandonedCartsManager />);

    // Attendre la fin du load (table apparaît).
    await waitFor(() =>
      expect(screen.getByTestId('abandoned-carts-table')).toBeTruthy(),
    );

    // 2 rangées rendues.
    expect(screen.getByTestId('cart-row-cart_A')).toBeTruthy();
    expect(screen.getByTestId('cart-row-cart_B')).toBeTruthy();

    // Tri ASC par next_recovery_due_at → cart_B (24 mai) avant cart_A (25 mai).
    const tbody = screen.getByTestId('abandoned-carts-table').querySelector('tbody');
    const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];
    expect(rows[0]?.getAttribute('data-testid')).toBe('cart-row-cart_B');
    expect(rows[1]?.getAttribute('data-testid')).toBe('cart-row-cart_A');
  });

  it('Skip → updateRecoveryConfig appelé avec { skip: true } pour le bon cart', async () => {
    const cart = mkCart({ cart_id: 'cart_skip' });
    getRecoverySequenceStatesMock.mockResolvedValue({
      data: [cart],
      error: null,
    });

    render(<AbandonedCartsManager />);
    await waitFor(() => screen.getByTestId('skip-cart_skip'));

    fireEvent.click(screen.getByTestId('skip-cart_skip'));

    await waitFor(() =>
      expect(updateRecoveryConfigMock).toHaveBeenCalledTimes(1),
    );
    expect(updateRecoveryConfigMock).toHaveBeenCalledWith('cart_skip', {
      skip: true,
    });
  });

  it('Pause → updateRecoveryConfig appelé avec { skip: true } (stop séquence)', async () => {
    const cart = mkCart({ cart_id: 'cart_pause' });
    getRecoverySequenceStatesMock.mockResolvedValue({
      data: [cart],
      error: null,
    });

    render(<AbandonedCartsManager />);
    await waitFor(() => screen.getByTestId('pause-cart_pause'));

    fireEvent.click(screen.getByTestId('pause-cart_pause'));

    await waitFor(() =>
      expect(updateRecoveryConfigMock).toHaveBeenCalledTimes(1),
    );
    expect(updateRecoveryConfigMock).toHaveBeenCalledWith('cart_pause', {
      skip: true,
    });
  });

  it('Re-send → updateRecoveryConfig appelé avec { force_resend: true }', async () => {
    const cart = mkCart({ cart_id: 'cart_resend' });
    getRecoverySequenceStatesMock.mockResolvedValue({
      data: [cart],
      error: null,
    });

    render(<AbandonedCartsManager />);
    await waitFor(() => screen.getByTestId('resend-cart_resend'));

    fireEvent.click(screen.getByTestId('resend-cart_resend'));

    await waitFor(() =>
      expect(updateRecoveryConfigMock).toHaveBeenCalledTimes(1),
    );
    expect(updateRecoveryConfigMock).toHaveBeenCalledWith('cart_resend', {
      force_resend: true,
    });
  });

  it('Empty (0 carts) → EmptyState rendu', async () => {
    getRecoverySequenceStatesMock.mockResolvedValue({
      data: [],
      error: null,
    });

    render(<AbandonedCartsManager />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeTruthy());
    expect(screen.getByTestId('empty-state').textContent).toBe(
      'ecommerce.abandonedCarts.empty',
    );
    // Pas de table rendue.
    expect(screen.queryByTestId('abandoned-carts-table')).toBeNull();
  });

  it('Empty (que des carts complétés) → EmptyState rendu (filtre actifs)', async () => {
    const completed = mkCart({
      cart_id: 'cart_done',
      recovery_completed_at: '2026-05-24T00:00:00Z',
    });
    getRecoverySequenceStatesMock.mockResolvedValue({
      data: [completed],
      error: null,
    });

    render(<AbandonedCartsManager />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeTruthy());
    expect(screen.queryByTestId('cart-row-cart_done')).toBeNull();
  });
});
