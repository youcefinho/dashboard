// @vitest-environment jsdom
// ── Sprint 40 — Agent B4 — Tests RecoveryWorkflowEditor ────────────────────
//
// Couvre :
//  1. Render → 3 step cards visibles (test-id step-card-1/2/3).
//  2. Default values match les constants RECOVERY_DELAYS_MIN /
//     RECOVERY_DISCOUNT_PCT (60/1440/4320 min, 0/5/10 %).
//  3. Edit delay → input value updated (controlled component).
//  4. Click Reset → values back to defaults après avoir édité.
//  5. Preview email body update — mutation textarea reflétée dans le preview.
//
// Imports RELATIFS (consigne sprint).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from '@testing-library/react';

// ── Mocks ───────────────────────────────────────────────────────────────────

// i18n : t() renvoie la clé (assertions déterministes).
vi.mock('../../../lib/i18n', () => ({
  t: (k: string) => k,
  getLocale: () => 'fr-CA',
}));

// UI primitives : mocks minimalistes (on teste la logique métier, pas le
// rendu visuel des primitives DS). On garde les a11y attributes essentiels
// + les data-testid passés en prop.
vi.mock('../../ui', () => {
  return {
    Button: ({
      children,
      onClick,
      disabled,
      'aria-label': ariaLabel,
      'data-testid': testid,
      ...rest
    }: any) => (
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testid}
        {...rest}
      >
        {children}
      </button>
    ),
    Card: ({ children, 'data-testid': testid, ...rest }: any) => (
      <div data-testid={testid} {...rest}>
        {children}
      </div>
    ),
    Input: ({
      label,
      value,
      onChange,
      'aria-label': ariaLabel,
      'data-testid': testid,
      ...rest
    }: any) => (
      <label>
        {label && <span>{label}</span>}
        <input
          value={value}
          onChange={onChange}
          aria-label={ariaLabel}
          data-testid={testid}
          {...rest}
        />
      </label>
    ),
    Select: ({
      label,
      value,
      onChange,
      children,
      'aria-label': ariaLabel,
      'data-testid': testid,
      ...rest
    }: any) => (
      <label>
        {label && <span>{label}</span>}
        <select
          value={value}
          onChange={onChange}
          aria-label={ariaLabel}
          data-testid={testid}
          {...rest}
        >
          {children}
        </select>
      </label>
    ),
    Textarea: ({
      label,
      value,
      onChange,
      'aria-label': ariaLabel,
      'data-testid': testid,
      ...rest
    }: any) => (
      <label>
        {label && <span>{label}</span>}
        <textarea
          value={value}
          onChange={onChange}
          aria-label={ariaLabel}
          data-testid={testid}
          {...rest}
        />
      </label>
    ),
    Tag: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
    Icon: () => null,
    useToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    }),
  };
});

// Import APRÈS les mocks.
import { RecoveryWorkflowEditor } from '../RecoveryWorkflowEditor';
import {
  RECOVERY_DELAYS_MIN,
  RECOVERY_DISCOUNT_PCT,
} from '../../../lib/types';

// ── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset DOM entre tests.
});

afterEach(() => {
  cleanup();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RecoveryWorkflowEditor', () => {
  it('rend les 3 step cards (1/2/3)', () => {
    render(<RecoveryWorkflowEditor />);
    expect(screen.getByTestId('step-card-1')).toBeTruthy();
    expect(screen.getByTestId('step-card-2')).toBeTruthy();
    expect(screen.getByTestId('step-card-3')).toBeTruthy();
  });

  it('valeurs par défaut alignées sur RECOVERY_DELAYS_MIN et RECOVERY_DISCOUNT_PCT', () => {
    render(<RecoveryWorkflowEditor />);

    // Delay inputs
    const d1 = screen.getByTestId('delay-1') as HTMLInputElement;
    const d2 = screen.getByTestId('delay-2') as HTMLInputElement;
    const d3 = screen.getByTestId('delay-3') as HTMLInputElement;
    expect(Number(d1.value)).toBe(RECOVERY_DELAYS_MIN[1]);
    expect(Number(d2.value)).toBe(RECOVERY_DELAYS_MIN[2]);
    expect(Number(d3.value)).toBe(RECOVERY_DELAYS_MIN[3]);

    // Discount inputs
    const pct1 = screen.getByTestId('discount-1') as HTMLInputElement;
    const pct2 = screen.getByTestId('discount-2') as HTMLInputElement;
    const pct3 = screen.getByTestId('discount-3') as HTMLInputElement;
    expect(Number(pct1.value)).toBe(RECOVERY_DISCOUNT_PCT[1]);
    expect(Number(pct2.value)).toBe(RECOVERY_DISCOUNT_PCT[2]);
    expect(Number(pct3.value)).toBe(RECOVERY_DISCOUNT_PCT[3]);
  });

  it('edit delay → input value updated (controlled)', () => {
    render(<RecoveryWorkflowEditor />);
    const d1 = screen.getByTestId('delay-1') as HTMLInputElement;
    expect(Number(d1.value)).toBe(RECOVERY_DELAYS_MIN[1]);

    fireEvent.change(d1, { target: { value: '120' } });

    const updated = screen.getByTestId('delay-1') as HTMLInputElement;
    expect(Number(updated.value)).toBe(120);
  });

  it('click Reset → valeurs back to defaults', () => {
    render(<RecoveryWorkflowEditor />);

    // Modifier delay step 2 + discount step 3
    const d2 = screen.getByTestId('delay-2') as HTMLInputElement;
    fireEvent.change(d2, { target: { value: '999' } });
    expect(Number((screen.getByTestId('delay-2') as HTMLInputElement).value)).toBe(999);

    const pct3 = screen.getByTestId('discount-3') as HTMLInputElement;
    fireEvent.change(pct3, { target: { value: '42' } });
    expect(Number((screen.getByTestId('discount-3') as HTMLInputElement).value)).toBe(42);

    // Reset
    fireEvent.click(screen.getByTestId('reset-defaults'));

    // Valeurs back to defaults
    expect(Number((screen.getByTestId('delay-2') as HTMLInputElement).value)).toBe(
      RECOVERY_DELAYS_MIN[2],
    );
    expect(Number((screen.getByTestId('discount-3') as HTMLInputElement).value)).toBe(
      RECOVERY_DISCOUNT_PCT[3],
    );
  });

  it('preview email body se met à jour quand textarea change', () => {
    render(<RecoveryWorkflowEditor />);

    const body1 = screen.getByTestId('body-1') as HTMLTextAreaElement;
    fireEvent.change(body1, {
      target: { value: 'Nouveau corps test — discount {{discount_pct}}%' },
    });

    const preview = screen.getByTestId('preview-body-1');
    // Le preview doit refléter le nouveau body avec token {{discount_pct}}
    // remplacé par la valeur courante du step (0 par défaut sur step 1).
    expect(preview.textContent).toContain('Nouveau corps test');
    expect(preview.textContent).toContain('discount 0%');
  });
});
