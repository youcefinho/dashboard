// @vitest-environment jsdom
// ── GiftCardsLoyaltyPage.test — Sprint 38 (Agent B4) ────────────────────────
// Couvre :
//  1. Render → tab nav visible (2 onglets).
//  2. Default tab=giftcards → <GiftCardManager /> rendered (stub).
//  3. Click tab loyalty → getLoyaltyPrograms appelé + liste programmes visible.
//  4. Click "Créer programme" → drawer ouvert en mode create (programId vide).
//  5. Click sur un program existant → drawer ouvert en mode edit (programId set).
//  6. Liste loyalty vide → empty state visible avec bouton Créer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Mocks api ───────────────────────────────────────────────────────────────
const getLoyaltyProgramsMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getLoyaltyPrograms: (...a: unknown[]) => getLoyaltyProgramsMock(...(a as [])),
}));

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

// ── Mocks composants enfants (focus = la page, pas les sous-modules) ─────

vi.mock('../../components/giftcards/GiftCardManager', () => ({
  GiftCardManager: () => (
    <div data-testid="giftcard-manager-stub">GiftCardManager (B1)</div>
  ),
}));

// LoyaltyProgramSettings : capture les props pour vérifier mode create/edit.
const loyaltySettingsProps = vi.fn();
vi.mock('../../components/loyalty/LoyaltyProgramSettings', () => ({
  LoyaltyProgramSettings: (props: {
    programId?: string;
    onSaved?: () => void;
  }) => {
    loyaltySettingsProps(props);
    return (
      <div
        data-testid="loyalty-settings-stub"
        data-program-id={props.programId ?? ''}
        data-mode={props.programId ? 'edit' : 'create'}
      >
        LoyaltyProgramSettings (B2)
      </div>
    );
  },
}));

// AppLayout : stub pass-through (rend juste les children + le title pour debug).
vi.mock('../../components/layout/AppLayout', () => ({
  AppLayout: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="app-layout" data-title={title}>
      {children}
    </div>
  ),
}));

// PageHero : stub pass-through.
vi.mock('../../components/ui/PageHero', () => ({
  PageHero: ({
    title,
    description,
  }: {
    meta?: string;
    title: string;
    description?: string;
  }) => (
    <header data-testid="page-hero">
      <h1 data-testid="page-hero-title">{title}</h1>
      {description ? (
        <p data-testid="page-hero-description">{description}</p>
      ) : null}
    </header>
  ),
}));

// ModuleGuard : stub pass-through (le gating réel est testé dans ModuleGuard.test).
vi.mock('../../components/ecommerce/ModuleGuard', () => ({
  ModuleGuard: ({ children }: { children: ReactNode }) => (
    <div data-testid="module-guard">{children}</div>
  ),
}));

// Button : stub pass-through.
vi.mock('../../components/ui/Button', () => ({
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
      aria-label={ariaLabel}
      data-testid={dataTestId}
    >
      {children}
    </button>
  ),
}));

// Icon : stub.
vi.mock('../../components/ui/Icon', () => ({
  Icon: ({ size }: { size?: number | string }) => (
    <span data-testid="icon-stub" data-size={String(size ?? '')} />
  ),
}));

// Skeleton : stub.
vi.mock('../../components/ui/Skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

// EmptyState : stub.
vi.mock('../../components/ui/EmptyState', () => ({
  EmptyState: ({
    title,
    description,
    action,
  }: {
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
  }) => (
    <div data-testid="empty-state">
      <div data-testid="empty-title">{title}</div>
      <div data-testid="empty-description">{description}</div>
      <div data-testid="empty-action">{action}</div>
    </div>
  ),
}));

// SlidePanel : stub — rend children quand open=true.
vi.mock('../../components/ui/SlidePanel', () => ({
  SlidePanel: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
    onOpenChange: (o: boolean) => void;
  }) =>
    open ? (
      <div data-testid="slidepanel-stub" role="dialog" aria-label={title}>
        <div data-testid="slidepanel-title">{title}</div>
        {children}
      </div>
    ) : null,
}));

// Toast.
const toastErrorMock = vi.fn();
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: toastErrorMock,
    toast: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    remove: vi.fn(),
  }),
}));

// Imports APRÈS les mocks.
import { GiftCardsLoyaltyPage } from './GiftCardsLoyaltyPage';
import type { LoyaltyProgram } from '../../lib/api';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeProgram(over: Partial<LoyaltyProgram> = {}): LoyaltyProgram {
  return {
    id: over.id ?? 'lp_1',
    name: over.name ?? 'Programme Or',
    earn_rate_per_dollar: over.earn_rate_per_dollar ?? 1,
    redeem_rate_cents_per_point: over.redeem_rate_cents_per_point ?? 1,
    min_redeem_points: over.min_redeem_points ?? 100,
    points_expiry_days: over.points_expiry_days ?? null,
    tier_thresholds_json: over.tier_thresholds_json ?? null,
    tier_benefits_json: over.tier_benefits_json ?? null,
    is_active: over.is_active ?? 1,
    created_at: over.created_at ?? '2026-05-22T10:00:00Z',
  };
}

function twoPrograms(): LoyaltyProgram[] {
  return [
    makeProgram({ id: 'lp_1', name: 'VIP Or', is_active: 1 }),
    makeProgram({ id: 'lp_2', name: 'Silver', is_active: 0 }),
  ];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<GiftCardsLoyaltyPage /> — Sprint 38 B4', () => {
  beforeEach(() => {
    getLoyaltyProgramsMock.mockResolvedValue({ data: twoPrograms() });
    loyaltySettingsProps.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. render → tab nav visible (2 onglets giftcards + loyalty)', () => {
    render(<GiftCardsLoyaltyPage />);
    expect(screen.getByTestId('giftcards-loyalty-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('tab-giftcards')).toBeInTheDocument();
    expect(screen.getByTestId('tab-loyalty')).toBeInTheDocument();
    expect(screen.getByTestId('tab-giftcards')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('tab-loyalty')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('2. default tab=giftcards → <GiftCardManager /> rendu', () => {
    render(<GiftCardsLoyaltyPage />);
    expect(screen.getByTestId('panel-giftcards')).toBeInTheDocument();
    expect(screen.getByTestId('giftcard-manager-stub')).toBeInTheDocument();
    // Loyalty list pas encore monté ni fetché.
    expect(screen.queryByTestId('panel-loyalty')).toBeNull();
    expect(getLoyaltyProgramsMock).not.toHaveBeenCalled();
  });

  it('3. click tab loyalty → getLoyaltyPrograms appelé + liste programmes visible', async () => {
    render(<GiftCardsLoyaltyPage />);
    fireEvent.click(screen.getByTestId('tab-loyalty'));

    await waitFor(() => {
      expect(getLoyaltyProgramsMock).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByTestId('loyalty-programs-list')).toBeInTheDocument();
    expect(screen.getByTestId('loyalty-program-row-lp_1')).toBeInTheDocument();
    expect(screen.getByTestId('loyalty-program-row-lp_2')).toBeInTheDocument();
    expect(screen.getByTestId('loyalty-program-status-lp_1')).toHaveTextContent(
      'loyalty.program.active',
    );
    expect(screen.getByTestId('loyalty-program-status-lp_2')).toHaveTextContent(
      'loyalty.program.inactive',
    );

    // Tab giftcards plus actif.
    expect(screen.getByTestId('tab-loyalty')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // GiftCardManager n'est plus monté.
    expect(screen.queryByTestId('giftcard-manager-stub')).toBeNull();
  });

  it('4. click "Créer programme" → drawer ouvert en mode create (programId undefined)', async () => {
    render(<GiftCardsLoyaltyPage />);
    fireEvent.click(screen.getByTestId('tab-loyalty'));
    await screen.findByTestId('loyalty-programs-list');

    fireEvent.click(screen.getByTestId('loyalty-create-button'));

    const drawer = await screen.findByTestId('slidepanel-stub');
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByTestId('slidepanel-title')).toHaveTextContent(
      'loyalty.program.createTitle',
    );
    const settings = within(drawer).getByTestId('loyalty-settings-stub');
    expect(settings).toHaveAttribute('data-mode', 'create');
    expect(settings).toHaveAttribute('data-program-id', '');
  });

  it('5. click sur un programme existant → drawer ouvert mode edit (programId set)', async () => {
    render(<GiftCardsLoyaltyPage />);
    fireEvent.click(screen.getByTestId('tab-loyalty'));
    await screen.findByTestId('loyalty-programs-list');

    fireEvent.click(screen.getByTestId('loyalty-program-row-lp_1'));

    const drawer = await screen.findByTestId('slidepanel-stub');
    expect(within(drawer).getByTestId('slidepanel-title')).toHaveTextContent(
      'loyalty.program.editTitle',
    );
    const settings = within(drawer).getByTestId('loyalty-settings-stub');
    expect(settings).toHaveAttribute('data-mode', 'edit');
    expect(settings).toHaveAttribute('data-program-id', 'lp_1');

    // onSaved a bien été propagé (fonction).
    const lastCall =
      loyaltySettingsProps.mock.calls[loyaltySettingsProps.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const props = lastCall ? (lastCall[0] as { onSaved?: () => void }) : null;
    expect(typeof props?.onSaved).toBe('function');
  });

  it('6. liste loyalty vide → empty state visible + bouton Créer dans empty', async () => {
    getLoyaltyProgramsMock.mockResolvedValue({ data: [] });
    render(<GiftCardsLoyaltyPage />);
    fireEvent.click(screen.getByTestId('tab-loyalty'));

    await waitFor(() => {
      expect(getLoyaltyProgramsMock).toHaveBeenCalled();
    });
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('empty-title')).toHaveTextContent(
      'loyalty.programs.empty',
    );
    const emptyAction = screen.getByTestId('empty-action');
    expect(
      within(emptyAction).getByRole('button', {
        name: /loyalty\.program\.create/,
      }),
    ).toBeInTheDocument();
  });

  it('7. erreur réseau au load loyalty → toast erreur + empty state', async () => {
    getLoyaltyProgramsMock.mockResolvedValue({ error: 'Network down' });
    render(<GiftCardsLoyaltyPage />);
    fireEvent.click(screen.getByTestId('tab-loyalty'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Network down');
    });
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
  });

  it('8. header titre change selon tab actif', async () => {
    render(<GiftCardsLoyaltyPage />);
    expect(screen.getByTestId('page-hero-title')).toHaveTextContent(
      'giftCards.title',
    );

    fireEvent.click(screen.getByTestId('tab-loyalty'));
    await waitFor(() => {
      expect(screen.getByTestId('page-hero-title')).toHaveTextContent(
        'loyalty.title',
      );
    });
  });
});
