// @vitest-environment jsdom
// ── LoyaltyProgramSettings.test — Sprint 38 (Agent B2) ──────────────────────
// Couvre :
//  1. Render mode create → champs visibles avec defaults (1 / 1 / 100 / JSON tiers).
//  2. Submit avec earn_rate=2 → createLoyaltyProgram appelé avec args attendus.
//  3. Mode édition (programId) → getLoyaltyPrograms + form pré-rempli.
//  4. Submit en mode édition → updateLoyaltyProgram appelé avec is_active.
//  5. Edit tier thresholds → JSON valide, pas d'erreur, payload propagé.
//  6. Edit tier thresholds avec JSON invalide → erreur visible + submit disabled.
//  7. Toggle is_active → state change → propagation au payload update.
//  8. Erreur createLoyaltyProgram → toast error, pas de onSaved.
//  9. Live helper text : 1 point = $X varie quand redeem_rate change.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Mocks api ───────────────────────────────────────────────────────────────
const getLoyaltyProgramsMock = vi.fn();
const createLoyaltyProgramMock = vi.fn();
const updateLoyaltyProgramMock = vi.fn();
const deleteLoyaltyProgramMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getLoyaltyPrograms: (...a: unknown[]) =>
    getLoyaltyProgramsMock(...(a as [])),
  createLoyaltyProgram: (...a: unknown[]) =>
    createLoyaltyProgramMock(...(a as [])),
  updateLoyaltyProgram: (...a: unknown[]) =>
    updateLoyaltyProgramMock(...(a as [])),
  deleteLoyaltyProgram: (...a: unknown[]) =>
    deleteLoyaltyProgramMock(...(a as [])),
}));

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

// ── Mocks UI primitives ─────────────────────────────────────────────────────

// Button : stub pass-through (gère type/onClick/disabled/isLoading).
vi.mock('../ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    type,
    'aria-label': ariaLabel,
    'data-testid': dataTestId,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    type?: 'button' | 'submit' | 'reset';
    'aria-label'?: string;
    'data-testid'?: string;
  }) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      data-loading={isLoading ? 'true' : 'false'}
      aria-label={ariaLabel}
      data-testid={dataTestId}
    >
      {children}
    </button>
  ),
}));

// Input : stub avec id + value + onChange + type.
vi.mock('../ui/Input', () => ({
  Input: ({
    id,
    value,
    onChange,
    type,
    'aria-label': ariaLabel,
    'data-testid': dataTestId,
    required,
    placeholder,
  }: {
    id?: string;
    value?: string | number;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    type?: string;
    'aria-label'?: string;
    'data-testid'?: string;
    required?: boolean;
    placeholder?: string;
  }) => (
    <input
      id={id}
      type={type ?? 'text'}
      value={value ?? ''}
      onChange={onChange}
      aria-label={ariaLabel}
      required={required}
      placeholder={placeholder}
      data-testid={dataTestId ?? `input-${id ?? 'unknown'}`}
    />
  ),
}));

// Textarea : stub.
vi.mock('../ui/Textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
    'aria-label': ariaLabel,
    'data-testid': dataTestId,
  }: {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    'aria-label'?: string;
    'data-testid'?: string;
  }) => (
    <textarea
      id={id}
      value={value ?? ''}
      onChange={onChange}
      aria-label={ariaLabel}
      data-testid={dataTestId ?? `textarea-${id ?? 'unknown'}`}
    />
  ),
}));

// Switch : stub <button role="switch">.
vi.mock('../ui/Switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    'aria-label': ariaLabel,
    'data-testid': dataTestId,
    id,
  }: {
    checked: boolean;
    onCheckedChange: (c: boolean) => void;
    'aria-label'?: string;
    'data-testid'?: string;
    id?: string;
  }) => (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      data-testid={dataTestId ?? 'switch-stub'}
      onClick={() => onCheckedChange(!checked)}
    >
      {checked ? 'ON' : 'OFF'}
    </button>
  ),
}));

// Icon : stub.
vi.mock('../ui/Icon', () => ({
  Icon: ({ size }: { size?: number | string }) => (
    <span data-testid="icon-stub" data-size={String(size ?? '')} />
  ),
}));

// Skeleton : stub.
vi.mock('../ui/Skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

// Toast : capture success/error.
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('../ui/Toast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    toast: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    remove: vi.fn(),
  }),
}));

// Imports APRÈS les mocks.
import { LoyaltyProgramSettings } from './LoyaltyProgramSettings';
import type { LoyaltyProgram } from '../../lib/api';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeProgram(over: Partial<LoyaltyProgram> = {}): LoyaltyProgram {
  return {
    id: over.id ?? 'lp_1',
    name: over.name ?? 'Programme VIP',
    earn_rate_per_dollar: over.earn_rate_per_dollar ?? 1.5,
    redeem_rate_cents_per_point: over.redeem_rate_cents_per_point ?? 2,
    min_redeem_points: over.min_redeem_points ?? 250,
    points_expiry_days:
      over.points_expiry_days === undefined ? 365 : over.points_expiry_days,
    tier_thresholds_json:
      over.tier_thresholds_json ??
      JSON.stringify({ bronze: 0, silver: 1000, gold: 5000 }),
    tier_benefits_json:
      over.tier_benefits_json ??
      JSON.stringify({
        silver: { earn_multiplier: 1.5 },
        gold: { earn_multiplier: 3.0 },
      }),
    is_active: over.is_active ?? 1,
    created_at: over.created_at ?? '2026-05-22T10:00:00Z',
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<LoyaltyProgramSettings /> — Sprint 38 B2', () => {
  beforeEach(() => {
    getLoyaltyProgramsMock.mockResolvedValue({ data: [] });
    createLoyaltyProgramMock.mockResolvedValue({
      data: makeProgram({ id: 'lp_new', name: 'Nouveau' }),
    });
    updateLoyaltyProgramMock.mockResolvedValue({
      data: makeProgram({ id: 'lp_1', name: 'Programme VIP MAJ' }),
    });
    deleteLoyaltyProgramMock.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. mode create → champs visibles avec defaults (1 / 1 / 100)', () => {
    render(<LoyaltyProgramSettings />);

    expect(screen.getByTestId('loyalty-program-settings')).toBeInTheDocument();
    expect(screen.getByTestId('loyalty-name-input')).toHaveValue('');
    expect(screen.getByTestId('loyalty-earn-rate-input')).toHaveValue(1);
    expect(screen.getByTestId('loyalty-redeem-rate-input')).toHaveValue(1);
    expect(screen.getByTestId('loyalty-min-redeem-input')).toHaveValue(100);

    // Expiry vide = jamais.
    expect(screen.getByTestId('loyalty-expiry-input')).toHaveValue(null);

    // Tier editors pré-remplis avec defaults JSON.
    const thresholds = screen.getByTestId(
      'loyalty-tier-thresholds-input',
    ) as HTMLTextAreaElement;
    expect(thresholds.value).toContain('bronze');
    expect(thresholds.value).toContain('"silver": 500');
    expect(thresholds.value).toContain('"gold": 2000');

    const benefits = screen.getByTestId(
      'loyalty-tier-benefits-input',
    ) as HTMLTextAreaElement;
    expect(benefits.value).toContain('gold');
    expect(benefits.value).toContain('earn_multiplier');

    // Pas de toggle is_active en mode create.
    expect(screen.queryByTestId('loyalty-active-section')).toBeNull();
  });

  it('2. submit avec earn_rate=2 → createLoyaltyProgram appelé avec args', async () => {
    const onSaved = vi.fn();
    render(<LoyaltyProgramSettings onSaved={onSaved} />);

    fireEvent.change(screen.getByTestId('loyalty-name-input'), {
      target: { value: 'Mon programme' },
    });
    fireEvent.change(screen.getByTestId('loyalty-earn-rate-input'), {
      target: { value: '2' },
    });

    fireEvent.click(screen.getByTestId('loyalty-submit-button'));

    await waitFor(() => {
      expect(createLoyaltyProgramMock).toHaveBeenCalledTimes(1);
    });
    const args = createLoyaltyProgramMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(args.name).toBe('Mon programme');
    expect(args.earn_rate_per_dollar).toBe(2);
    expect(args.redeem_rate_cents_per_point).toBe(1);
    expect(args.min_redeem_points).toBe(100);
    expect(args.points_expiry_days).toBeNull();
    expect(typeof args.tier_thresholds_json).toBe('string');
    expect(typeof args.tier_benefits_json).toBe('string');
    expect(JSON.parse(args.tier_thresholds_json as string)).toEqual({
      bronze: 0,
      silver: 500,
      gold: 2000,
    });

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('loyalty.program.created');
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('3. mode édition (programId) → getLoyaltyPrograms + form pré-rempli', async () => {
    getLoyaltyProgramsMock.mockResolvedValue({
      data: [makeProgram({ id: 'lp_1' })],
    });

    render(<LoyaltyProgramSettings programId="lp_1" />);

    await waitFor(() => {
      expect(getLoyaltyProgramsMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('loyalty-program-settings')).toBeInTheDocument();
    });

    expect(screen.getByTestId('loyalty-name-input')).toHaveValue('Programme VIP');
    expect(screen.getByTestId('loyalty-earn-rate-input')).toHaveValue(1.5);
    expect(screen.getByTestId('loyalty-redeem-rate-input')).toHaveValue(2);
    expect(screen.getByTestId('loyalty-min-redeem-input')).toHaveValue(250);
    expect(screen.getByTestId('loyalty-expiry-input')).toHaveValue(365);

    // Section is_active visible (mode edit).
    expect(screen.getByTestId('loyalty-active-section')).toBeInTheDocument();
    expect(screen.getByTestId('loyalty-active-toggle')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('4. submit update → updateLoyaltyProgram(id, payload) appelé', async () => {
    getLoyaltyProgramsMock.mockResolvedValue({
      data: [makeProgram({ id: 'lp_1' })],
    });
    const onSaved = vi.fn();

    render(<LoyaltyProgramSettings programId="lp_1" onSaved={onSaved} />);

    await waitFor(() => {
      expect(screen.getByTestId('loyalty-name-input')).toHaveValue(
        'Programme VIP',
      );
    });

    fireEvent.change(screen.getByTestId('loyalty-name-input'), {
      target: { value: 'Programme VIP MAJ' },
    });
    fireEvent.click(screen.getByTestId('loyalty-submit-button'));

    await waitFor(() => {
      expect(updateLoyaltyProgramMock).toHaveBeenCalledTimes(1);
    });
    const [id, payload] = updateLoyaltyProgramMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe('lp_1');
    expect(payload.name).toBe('Programme VIP MAJ');
    expect(payload.is_active).toBe(1);
    expect(payload.points_expiry_days).toBe(365);

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('loyalty.program.updated');
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('5. edit tier thresholds → JSON parse correct, payload propagé', async () => {
    render(<LoyaltyProgramSettings />);

    fireEvent.change(screen.getByTestId('loyalty-name-input'), {
      target: { value: 'Tier custom' },
    });
    const customThresholds = JSON.stringify({
      bronze: 0,
      silver: 1500,
      gold: 7500,
      platinum: 20000,
    });
    fireEvent.change(screen.getByTestId('loyalty-tier-thresholds-input'), {
      target: { value: customThresholds },
    });

    // Pas d'erreur d'affichée.
    expect(screen.queryByTestId('loyalty-tier-thresholds-error')).toBeNull();

    fireEvent.click(screen.getByTestId('loyalty-submit-button'));

    await waitFor(() => {
      expect(createLoyaltyProgramMock).toHaveBeenCalledTimes(1);
    });
    const args = createLoyaltyProgramMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(JSON.parse(args.tier_thresholds_json as string)).toEqual({
      bronze: 0,
      silver: 1500,
      gold: 7500,
      platinum: 20000,
    });
  });

  it('6. tier thresholds JSON invalide → erreur visible + submit disabled', () => {
    render(<LoyaltyProgramSettings />);

    fireEvent.change(screen.getByTestId('loyalty-name-input'), {
      target: { value: 'Nom valide' },
    });
    fireEvent.change(screen.getByTestId('loyalty-tier-thresholds-input'), {
      target: { value: '{ this is not json' },
    });

    expect(
      screen.getByTestId('loyalty-tier-thresholds-error'),
    ).toBeInTheDocument();

    const submitBtn = screen.getByTestId('loyalty-submit-button');
    expect(submitBtn).toBeDisabled();

    // Click sur submit ne déclenche pas create.
    fireEvent.click(submitBtn);
    expect(createLoyaltyProgramMock).not.toHaveBeenCalled();
  });

  it('7. toggle is_active (mode edit) → state change → payload is_active=0', async () => {
    getLoyaltyProgramsMock.mockResolvedValue({
      data: [makeProgram({ id: 'lp_1', is_active: 1 })],
    });

    render(<LoyaltyProgramSettings programId="lp_1" />);

    await waitFor(() => {
      expect(screen.getByTestId('loyalty-active-toggle')).toBeInTheDocument();
    });

    const toggle = screen.getByTestId('loyalty-active-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByTestId('loyalty-submit-button'));

    await waitFor(() => {
      expect(updateLoyaltyProgramMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateLoyaltyProgramMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(payload.is_active).toBe(0);
  });

  it('8. erreur createLoyaltyProgram → toast error, pas de onSaved', async () => {
    createLoyaltyProgramMock.mockResolvedValue({ error: 'Quota exceeded' });
    const onSaved = vi.fn();

    render(<LoyaltyProgramSettings onSaved={onSaved} />);

    fireEvent.change(screen.getByTestId('loyalty-name-input'), {
      target: { value: 'Bad' },
    });
    fireEvent.click(screen.getByTestId('loyalty-submit-button'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Quota exceeded');
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('9. live helper text — 1 point = $X varie quand redeem_rate change', () => {
    render(<LoyaltyProgramSettings />);

    const helper = screen.getByTestId('loyalty-redeem-helper');
    expect(helper.textContent).toContain('0.01 $'); // 1 cent = $0.01

    fireEvent.change(screen.getByTestId('loyalty-redeem-rate-input'), {
      target: { value: '5' },
    });
    expect(helper.textContent).toContain('0.05 $'); // 5 cents = $0.05

    fireEvent.change(screen.getByTestId('loyalty-redeem-rate-input'), {
      target: { value: '100' },
    });
    expect(helper.textContent).toContain('1.00 $'); // 100 cents = $1.00
  });
});
