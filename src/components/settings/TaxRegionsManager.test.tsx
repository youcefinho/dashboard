// @vitest-environment jsdom
// ── TaxRegionsManager.test — Sprint 39 (Agent B2) ───────────────────────────
// Couvre :
//  1. Render 2 régions mock → 2 cards visibles + listTaxRegions appelé au mount.
//  2. Click "Ajouter région fiscale" → modal CRUD ouverte (champs visibles).
//  3. Submit valide (création) → createTaxRegion(payload) appelé.
//  4. rates_json invalide → submit disabled (createTaxRegion non appelé).
//  5. Delete + confirm → deleteTaxRegion(id) appelé.

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
const listTaxRegionsMock = vi.fn();
const createTaxRegionMock = vi.fn();
const updateTaxRegionMock = vi.fn();
const deleteTaxRegionMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listTaxRegions: (...a: unknown[]) => listTaxRegionsMock(...(a as [])),
  createTaxRegion: (...a: unknown[]) => createTaxRegionMock(...(a as [])),
  updateTaxRegion: (...a: unknown[]) => updateTaxRegionMock(...(a as [])),
  deleteTaxRegion: (...a: unknown[]) => deleteTaxRegionMock(...(a as [])),
}));

// i18n : renvoie la clé brute.
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

// ── Mocks UI primitives ─────────────────────────────────────────────────────

vi.mock('../ui/Card', () => ({
  Card: ({
    children,
    className,
    'data-testid': testId,
  }: {
    children: ReactNode;
    className?: string;
    'data-testid'?: string;
  }) => (
    <div className={className} data-testid={testId}>
      {children}
    </div>
  ),
}));

vi.mock('../ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    'aria-label': ariaLabel,
    'data-testid': testId,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    'aria-label'?: string;
    'data-testid'?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      data-loading={isLoading ? 'true' : 'false'}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {children}
    </button>
  ),
}));

vi.mock('../ui/Input', () => ({
  Input: ({
    id,
    value,
    onChange,
    'aria-label': ariaLabel,
    'data-testid': testId,
    placeholder,
    required,
  }: {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    'aria-label'?: string;
    'data-testid'?: string;
    placeholder?: string;
    required?: boolean;
  }) => (
    <input
      id={id}
      value={value ?? ''}
      onChange={onChange}
      aria-label={ariaLabel}
      placeholder={placeholder}
      required={required}
      data-testid={testId ?? `input-${id ?? 'unknown'}`}
    />
  ),
}));

vi.mock('../ui/Select', () => ({
  Select: ({
    value,
    onChange,
    children,
    'aria-label': ariaLabel,
    'data-testid': testId,
  }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    children?: ReactNode;
    'aria-label'?: string;
    'data-testid'?: string;
  }) => (
    <select
      value={value ?? ''}
      onChange={onChange}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {children}
    </select>
  ),
}));

vi.mock('../ui/Textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
    'aria-label': ariaLabel,
    'data-testid': testId,
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
      data-testid={testId ?? `textarea-${id ?? 'unknown'}`}
    />
  ),
}));

vi.mock('../ui/Switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    label,
    'data-testid': testId,
  }: {
    checked: boolean;
    onCheckedChange: (c: boolean) => void;
    label?: string;
    'data-testid'?: string;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onCheckedChange(!checked)}
    >
      {label}
    </button>
  ),
}));

vi.mock('../ui/Tag', () => ({
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('../ui/Modal', () => ({
  Modal: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    onOpenChange?: (o: boolean) => void;
    title: string;
    children: ReactNode;
  }) =>
    open ? (
      <div role="dialog" aria-label={title} data-testid="tax-region-modal">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

vi.mock('../ui/Icon', () => ({
  Icon: ({ size }: { size?: number | string }) => (
    <span data-testid="icon-stub" data-size={String(size)} />
  ),
}));

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
import { TaxRegionsManager } from './TaxRegionsManager';
import type { TaxRegion } from '../../lib/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeRegion(over: Partial<TaxRegion> = {}): TaxRegion {
  return {
    id: over.id ?? 'tr_1',
    client_id: over.client_id ?? 'cli_1',
    code: over.code ?? 'QC-CA',
    name: over.name ?? 'Québec',
    country: over.country ?? 'CA',
    country_subdiv: over.country_subdiv ?? 'QC',
    type: over.type ?? 'gst_pst',
    rates_json: over.rates_json ?? { standard: 14.975 },
    tax_inclusive: over.tax_inclusive ?? false,
    active: over.active ?? true,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<TaxRegionsManager /> — Sprint 39 B2', () => {
  beforeEach(() => {
    listTaxRegionsMock.mockResolvedValue({
      data: [
        makeRegion({ id: 'tr_1', code: 'QC-CA', name: 'Québec' }),
        makeRegion({
          id: 'tr_2',
          code: 'NY-US',
          name: 'New York',
          country: 'US',
          country_subdiv: 'NY',
          type: 'sales_tax',
          rates_json: { standard: 8.875 },
        }),
      ],
    });
    createTaxRegionMock.mockResolvedValue({
      data: makeRegion({ id: 'tr_new', code: 'ON-CA', name: 'Ontario' }),
    });
    updateTaxRegionMock.mockResolvedValue({
      data: makeRegion({ name: 'Updated' }),
    });
    deleteTaxRegionMock.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. mount → listTaxRegions appelé + 2 cards rendues', async () => {
    render(<TaxRegionsManager />);

    await waitFor(() =>
      expect(listTaxRegionsMock).toHaveBeenCalledTimes(1),
    );

    expect(await screen.findByTestId('tax-region-card-QC-CA')).toBeInTheDocument();
    expect(screen.getByTestId('tax-region-card-NY-US')).toBeInTheDocument();
  });

  it('2. click "Ajouter" → modal ouverte avec champs CRUD', async () => {
    render(<TaxRegionsManager />);
    await screen.findByTestId('tax-region-card-QC-CA');

    fireEvent.click(screen.getByTestId('tax-region-add'));

    expect(await screen.findByTestId('tax-region-modal')).toBeInTheDocument();
    expect(screen.getByTestId('tax-region-form-code')).toBeInTheDocument();
    expect(screen.getByTestId('tax-region-form-name')).toBeInTheDocument();
    expect(screen.getByTestId('tax-region-form-country')).toBeInTheDocument();
    expect(screen.getByTestId('tax-region-form-subdiv')).toBeInTheDocument();
    expect(screen.getByTestId('tax-region-form-type')).toBeInTheDocument();
    expect(screen.getByTestId('tax-region-form-rates')).toBeInTheDocument();
    expect(screen.getByTestId('tax-region-form-tax-inclusive')).toBeInTheDocument();
    expect(screen.getByTestId('tax-region-form-submit')).toBeInTheDocument();
  });

  it('3. submit valide → createTaxRegion appelé avec payload', async () => {
    render(<TaxRegionsManager />);
    await screen.findByTestId('tax-region-card-QC-CA');

    fireEvent.click(screen.getByTestId('tax-region-add'));
    await screen.findByTestId('tax-region-modal');

    fireEvent.change(screen.getByTestId('tax-region-form-code'), {
      target: { value: 'ON-CA' },
    });
    fireEvent.change(screen.getByTestId('tax-region-form-name'), {
      target: { value: 'Ontario' },
    });
    fireEvent.change(screen.getByTestId('tax-region-form-country'), {
      target: { value: 'CA' },
    });
    fireEvent.change(screen.getByTestId('tax-region-form-subdiv'), {
      target: { value: 'ON' },
    });
    fireEvent.change(screen.getByTestId('tax-region-form-type'), {
      target: { value: 'gst_pst' },
    });
    fireEvent.change(screen.getByTestId('tax-region-form-rates'), {
      target: { value: '{ "standard": 13 }' },
    });

    const submitBtn = screen.getByTestId('tax-region-form-submit');
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(createTaxRegionMock).toHaveBeenCalledTimes(1),
    );

    const arg = createTaxRegionMock.mock.calls[0]?.[0] as {
      code: string;
      name: string;
      country: string;
      country_subdiv: string | null;
      type: string;
      rates_json: Record<string, number>;
      tax_inclusive: boolean;
    };
    expect(arg.code).toBe('ON-CA');
    expect(arg.name).toBe('Ontario');
    expect(arg.country).toBe('CA');
    expect(arg.country_subdiv).toBe('ON');
    expect(arg.type).toBe('gst_pst');
    expect(arg.rates_json).toEqual({ standard: 13 });
    expect(arg.tax_inclusive).toBe(false);
  });

  it('4. rates_json invalide → submit disabled + createTaxRegion NON appelé', async () => {
    render(<TaxRegionsManager />);
    await screen.findByTestId('tax-region-card-QC-CA');

    fireEvent.click(screen.getByTestId('tax-region-add'));
    await screen.findByTestId('tax-region-modal');

    // Champs requis OK
    fireEvent.change(screen.getByTestId('tax-region-form-code'), {
      target: { value: 'XX' },
    });
    fireEvent.change(screen.getByTestId('tax-region-form-name'), {
      target: { value: 'X' },
    });
    fireEvent.change(screen.getByTestId('tax-region-form-country'), {
      target: { value: 'CA' },
    });
    // JSON cassé
    fireEvent.change(screen.getByTestId('tax-region-form-rates'), {
      target: { value: '{ not json' },
    });

    const submitBtn = screen.getByTestId('tax-region-form-submit');
    expect(submitBtn).toBeDisabled();

    fireEvent.click(submitBtn);
    expect(createTaxRegionMock).not.toHaveBeenCalled();
  });

  it('5. delete + confirm → deleteTaxRegion appelé', async () => {
    render(<TaxRegionsManager />);
    await screen.findByTestId('tax-region-card-QC-CA');

    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockReturnValue(true);

    fireEvent.click(screen.getByTestId('tax-region-delete-QC-CA'));

    await waitFor(() =>
      expect(deleteTaxRegionMock).toHaveBeenCalledTimes(1),
    );
    expect(deleteTaxRegionMock).toHaveBeenCalledWith('tr_1');

    confirmSpy.mockRestore();
  });
});
