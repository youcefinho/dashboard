// @vitest-environment jsdom
// ── TaxRulesEditor.test — Sprint 39 Agent B3 ────────────────────────────────
//
// Couvre :
//  1. Render au mount → listTaxRules(regionId) appelé + 3 lignes affichées.
//  2. Submit add valide → createTaxRule(regionId, input) appelé + refresh.
//  3. Delete rule (confirm = true) → deleteTaxRule(id) appelé + refresh.
//  4. Delete rule (confirm = false) → deleteTaxRule NON appelé.
//  5. Validation rate < 0 → bouton Add disabled, createTaxRule NON appelé.
//  6. Validation rate > 1 → bouton Add disabled, createTaxRule NON appelé.
//  7. Validation rate = 0.5 (limite valide) → bouton Add actif.

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
const listTaxRulesMock = vi.fn();
const createTaxRuleMock = vi.fn();
const deleteTaxRuleMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listTaxRules: (...a: unknown[]) => listTaxRulesMock(...(a as [])),
  createTaxRule: (...a: unknown[]) => createTaxRuleMock(...(a as [])),
  deleteTaxRule: (...a: unknown[]) => deleteTaxRuleMock(...(a as [])),
}));

// i18n : renvoie la clé brute.
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

// formatDate : stub pass-through.
vi.mock('../../lib/i18n/datetime', () => ({
  formatDate: (iso: string) => iso,
}));

// useConfirm : override par test via variable module-level.
let confirmReturn = true;

// Stable toast instance — sinon useToast() = nouvel objet à chaque render
// → fetchRules recréé → useEffect re-fire infini → tests faux positifs.
const stableToast = {
  success: vi.fn(),
  error: vi.fn(),
  toast: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  remove: vi.fn(),
};

vi.mock('../ui', async () => {
  const React = await import('react');
  return {
    Card: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    Input: ({
      id,
      value,
      onChange,
      'aria-label': ariaLabel,
      type,
      error,
      'data-testid': testId,
    }: {
      id?: string;
      value?: string;
      onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
      'aria-label'?: string;
      type?: string;
      error?: string | boolean;
      'data-testid'?: string;
    }) => (
      <>
        <input
          id={id}
          type={type ?? 'text'}
          value={value ?? ''}
          onChange={onChange}
          aria-label={ariaLabel}
          data-testid={testId ?? `input-${id ?? 'unknown'}`}
          aria-invalid={Boolean(error) || undefined}
        />
        {typeof error === 'string' && error ? (
          <span data-testid={`${testId ?? id}-error`}>{error}</span>
        ) : null}
      </>
    ),
    Button: ({
      children,
      onClick,
      disabled,
      isLoading,
      type,
      'aria-label': ariaLabel,
      'data-testid': testId,
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
        data-testid={testId}
      >
        {children}
      </button>
    ),
    Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Skeleton: ({ className }: { className?: string }) => (
      <div className={className} data-testid="skeleton-stub" />
    ),
    EmptyState: ({
      title,
      description,
      'data-testid': testId,
    }: {
      title: string;
      description?: string;
      'data-testid'?: string;
    }) => (
      <div data-testid={testId}>
        <p>{title}</p>
        {description ? <p>{description}</p> : null}
      </div>
    ),
    useToast: () => stableToast,
    useConfirm: () => async () => confirmReturn,
    Icon: ({ size }: { size?: number | string }) => (
      <span data-testid="icon-stub" data-size={String(size)} />
    ),
    // Inutilisé directement mais ré-exporté côté UI.
    _react: React,
  };
});

// Imports APRÈS les mocks.
import { TaxRulesEditor } from './TaxRulesEditor';
import type { TaxRule } from '../../lib/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeRule(over: Partial<TaxRule> = {}): TaxRule {
  return {
    id: over.id ?? 'tr_1',
    region_id: over.region_id ?? 'reg_qc',
    product_category: over.product_category ?? 'standard',
    rate: over.rate ?? 0.14975,
    compound: over.compound ?? false,
    applies_from: over.applies_from ?? '2026-01-01',
  };
}

const MOCK_RULES: TaxRule[] = [
  makeRule({ id: 'tr_1', product_category: 'standard', rate: 0.05 }),
  makeRule({
    id: 'tr_2',
    product_category: 'food',
    rate: 0,
    compound: false,
  }),
  makeRule({
    id: 'tr_3',
    product_category: 'digital',
    rate: 0.09975,
    compound: true,
  }),
];

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<TaxRulesEditor /> — Sprint 39 B3', () => {
  beforeEach(() => {
    confirmReturn = true;
    listTaxRulesMock.mockResolvedValue({ data: MOCK_RULES });
    createTaxRuleMock.mockResolvedValue({
      data: makeRule({ id: 'tr_new', product_category: 'luxury', rate: 0.2 }),
    });
    deleteTaxRuleMock.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. mount → listTaxRules(regionId) appelé + 3 lignes affichées', async () => {
    render(<TaxRulesEditor regionId="reg_qc" />);

    await waitFor(() =>
      expect(listTaxRulesMock).toHaveBeenCalledWith('reg_qc'),
    );

    await waitFor(() => {
      expect(screen.getByTestId('tax-rule-row-tr_1')).toBeInTheDocument();
      expect(screen.getByTestId('tax-rule-row-tr_2')).toBeInTheDocument();
      expect(screen.getByTestId('tax-rule-row-tr_3')).toBeInTheDocument();
    });
  });

  it('2. submit add valide → createTaxRule(regionId, input) appelé + refresh', async () => {
    render(<TaxRulesEditor regionId="reg_qc" />);
    await waitFor(() => expect(listTaxRulesMock).toHaveBeenCalledTimes(1));

    // Renseigne le form.
    fireEvent.change(screen.getByTestId('tax-rule-input-category'), {
      target: { value: 'luxury' },
    });
    fireEvent.change(screen.getByTestId('tax-rule-input-rate'), {
      target: { value: '0.2' },
    });
    fireEvent.click(screen.getByTestId('tax-rule-input-compound'));

    const addBtn = screen.getByTestId('tax-rule-btn-add');
    expect(addBtn).not.toBeDisabled();
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(createTaxRuleMock).toHaveBeenCalledTimes(1);
      expect(createTaxRuleMock).toHaveBeenCalledWith('reg_qc', {
        product_category: 'luxury',
        rate: 0.2,
        compound: true,
      });
    });

    // Refresh : listTaxRules ré-appelé.
    await waitFor(() =>
      expect(listTaxRulesMock).toHaveBeenCalledTimes(2),
    );
  });

  it('3. delete rule (confirm true) → deleteTaxRule appelé + refresh', async () => {
    confirmReturn = true;
    render(<TaxRulesEditor regionId="reg_qc" />);
    await waitFor(() =>
      expect(screen.getByTestId('tax-rule-row-tr_2')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('tax-rule-btn-delete-tr_2'));

    await waitFor(() => {
      expect(deleteTaxRuleMock).toHaveBeenCalledTimes(1);
      expect(deleteTaxRuleMock).toHaveBeenCalledWith('tr_2');
    });
    await waitFor(() =>
      expect(listTaxRulesMock).toHaveBeenCalledTimes(2),
    );
  });

  it('4. delete rule (confirm false) → deleteTaxRule NON appelé', async () => {
    confirmReturn = false;
    render(<TaxRulesEditor regionId="reg_qc" />);
    await waitFor(() =>
      expect(screen.getByTestId('tax-rule-row-tr_1')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('tax-rule-btn-delete-tr_1'));

    // Wait a tick to ensure the async confirm resolves.
    await new Promise((r) => setTimeout(r, 0));

    expect(deleteTaxRuleMock).not.toHaveBeenCalled();
    // Pas de refresh non plus.
    expect(listTaxRulesMock).toHaveBeenCalledTimes(1);
  });

  it('5. rate < 0 → bouton Add disabled, createTaxRule NON appelé', async () => {
    render(<TaxRulesEditor regionId="reg_qc" />);
    await waitFor(() => expect(listTaxRulesMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId('tax-rule-input-category'), {
      target: { value: 'standard' },
    });
    fireEvent.change(screen.getByTestId('tax-rule-input-rate'), {
      target: { value: '-0.1' },
    });

    const addBtn = screen.getByTestId('tax-rule-btn-add');
    expect(addBtn).toBeDisabled();

    fireEvent.click(addBtn);
    await new Promise((r) => setTimeout(r, 0));
    expect(createTaxRuleMock).not.toHaveBeenCalled();
  });

  it('6. rate > 1 → bouton Add disabled, createTaxRule NON appelé', async () => {
    render(<TaxRulesEditor regionId="reg_qc" />);
    await waitFor(() => expect(listTaxRulesMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId('tax-rule-input-category'), {
      target: { value: 'standard' },
    });
    fireEvent.change(screen.getByTestId('tax-rule-input-rate'), {
      target: { value: '1.5' },
    });

    const addBtn = screen.getByTestId('tax-rule-btn-add');
    expect(addBtn).toBeDisabled();

    fireEvent.click(addBtn);
    await new Promise((r) => setTimeout(r, 0));
    expect(createTaxRuleMock).not.toHaveBeenCalled();
  });

  it('7. rate = 0.5 (limite valide) → bouton Add actif', async () => {
    render(<TaxRulesEditor regionId="reg_qc" />);
    await waitFor(() => expect(listTaxRulesMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId('tax-rule-input-category'), {
      target: { value: 'mid' },
    });
    fireEvent.change(screen.getByTestId('tax-rule-input-rate'), {
      target: { value: '0.5' },
    });

    expect(screen.getByTestId('tax-rule-btn-add')).not.toBeDisabled();
  });
});
