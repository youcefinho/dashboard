// @vitest-environment jsdom
// ── SnapshotsPage.test — Sprint 35 (Agent B4) ───────────────────────────────
// Couvre :
//  1. Mount → header + bouton import visible, wizard fermé.
//  2. Click bouton import → SnapshotImportWizard rendu avec open=true.
//  3. onClose du wizard → wizardOpen=false (wizard reçoit open=false).
//  4. targetClientId résolu via getActiveSubAccount() → wizard reçoit la valeur.
//  5. Fallback sur user.id si aucun sous-compte actif.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

// Auth : user solo par défaut.
const useAuthMock = vi.fn();
vi.mock('../lib/auth', () => ({
  useAuth: () => useAuthMock(),
}));

// API : getActiveSubAccount mockable (null par défaut → fallback user.id).
// importOriginal conserve getSnapshots + tous les autres exports (évite les
// unhandled rejections de SnapshotManager qui en dépend).
const getActiveSubAccountMock = vi.fn();
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    getActiveSubAccount: () => getActiveSubAccountMock(),
  };
});

// AppLayout : stub minimal — rend les children + title.
vi.mock('../components/layout/AppLayout', () => ({
  AppLayout: ({
    title,
    children,
  }: {
    title?: string;
    children: ReactNode;
  }) => (
    <div data-testid="app-layout" data-title={title}>
      {children}
    </div>
  ),
}));

// PageHero : stub minimal — rend title + description + actions.
vi.mock('../components/ui/PageHero', () => ({
  PageHero: ({
    title,
    description,
    actions,
  }: {
    title?: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    meta?: ReactNode;
    highlight?: ReactNode;
  }) => (
    <div data-testid="page-hero">
      <h1 data-testid="page-hero-title">{title}</h1>
      <p data-testid="page-hero-description">{description}</p>
      <div data-testid="page-hero-actions">{actions}</div>
    </div>
  ),
}));

// Button : stub pass-through.
vi.mock('../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode;
    onClick?: () => void;
    'aria-label'?: string;
    variant?: string;
    leftIcon?: ReactNode;
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

// Icon : stub.
vi.mock('../components/ui/Icon', () => ({
  Icon: ({ size }: { size?: number | string }) => (
    <span data-testid="icon-stub" data-size={String(size ?? '')} />
  ),
}));

// SnapshotManager : stub — marqueur de présence.
vi.mock('../components/snapshots/SnapshotManager', () => ({
  SnapshotManager: () => (
    <div data-testid="snapshot-manager-stub">SnapshotManager</div>
  ),
}));

// SnapshotDetail : stub — évite useToast sans ToastProvider.
vi.mock('../components/snapshots/SnapshotDetail', () => ({
  SnapshotDetail: () => (
    <div data-testid="snapshot-detail-stub">SnapshotDetail</div>
  ),
}));

// SnapshotImportWizard : stub — expose open, onClose, targetClientId.
const lastWizardProps: {
  open: boolean | null;
  targetClientId: string | null;
  onClose: (() => void) | null;
} = { open: null, targetClientId: null, onClose: null };

vi.mock('../components/snapshots/SnapshotImportWizard', () => ({
  SnapshotImportWizard: ({
    open,
    onClose,
    targetClientId,
  }: {
    open: boolean;
    onClose: () => void;
    targetClientId: string;
  }) => {
    lastWizardProps.open = open;
    lastWizardProps.onClose = onClose;
    lastWizardProps.targetClientId = targetClientId;
    return (
      <div
        data-testid="snapshot-import-wizard-stub"
        data-open={open ? 'true' : 'false'}
        data-target-client-id={targetClientId}
      >
        {open ? (
          <button
            type="button"
            data-testid="wizard-close-trigger"
            onClick={onClose}
          >
            close
          </button>
        ) : null}
      </div>
    );
  },
}));

// Imports APRÈS les mocks.
import { SnapshotsPage } from './SnapshotsPage';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<SnapshotsPage /> — Sprint 35 B4', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({
      isLoggedIn: true,
      user: { id: 'user_42', name: 'Rochdi', role: 'admin', email: 'r@x.io' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    getActiveSubAccountMock.mockReturnValue(null);
    lastWizardProps.open = null;
    lastWizardProps.targetClientId = null;
    lastWizardProps.onClose = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. mount → header + bouton import visibles, wizard fermé', () => {
    render(<SnapshotsPage />);

    // Header (titre via PageHero).
    expect(
      screen.getByTestId('page-hero-title'),
    ).toHaveTextContent('snapshots.page.title');
    expect(
      screen.getByTestId('page-hero-description'),
    ).toHaveTextContent('snapshots.page.description');

    // Bouton import présent avec aria-label i18n.
    const btn = screen.getByRole('button', {
      name: 'snapshots.action.import',
    });
    expect(btn).toBeInTheDocument();

    // SnapshotManager rendu.
    expect(screen.getByTestId('snapshot-manager-stub')).toBeInTheDocument();

    // Wizard fermé par défaut.
    expect(
      screen.getByTestId('snapshot-import-wizard-stub'),
    ).toHaveAttribute('data-open', 'false');
    expect(lastWizardProps.open).toBe(false);
  });

  it('2. click bouton import → wizard reçoit open=true', () => {
    render(<SnapshotsPage />);
    const btn = screen.getByRole('button', {
      name: 'snapshots.action.import',
    });
    act(() => {
      fireEvent.click(btn);
    });
    expect(
      screen.getByTestId('snapshot-import-wizard-stub'),
    ).toHaveAttribute('data-open', 'true');
    expect(lastWizardProps.open).toBe(true);
  });

  it('3. onClose du wizard → wizardOpen revient à false', () => {
    render(<SnapshotsPage />);
    const btn = screen.getByRole('button', {
      name: 'snapshots.action.import',
    });
    act(() => {
      fireEvent.click(btn);
    });
    expect(lastWizardProps.open).toBe(true);

    // Déclenche onClose via le stub.
    const closeBtn = screen.getByTestId('wizard-close-trigger');
    act(() => {
      fireEvent.click(closeBtn);
    });
    expect(
      screen.getByTestId('snapshot-import-wizard-stub'),
    ).toHaveAttribute('data-open', 'false');
    expect(lastWizardProps.open).toBe(false);
  });

  it('4. targetClientId résolu via getActiveSubAccount() quand sous-compte actif', () => {
    getActiveSubAccountMock.mockReturnValue('sub_abc');
    render(<SnapshotsPage />);
    expect(lastWizardProps.targetClientId).toBe('sub_abc');
    expect(
      screen.getByTestId('snapshot-import-wizard-stub'),
    ).toHaveAttribute('data-target-client-id', 'sub_abc');
  });

  it('5. fallback sur user.id si aucun sous-compte actif', () => {
    getActiveSubAccountMock.mockReturnValue(null);
    render(<SnapshotsPage />);
    expect(lastWizardProps.targetClientId).toBe('user_42');
  });

  it('6. fallback chaîne vide si ni sous-compte ni user', () => {
    getActiveSubAccountMock.mockReturnValue(null);
    useAuthMock.mockReturnValue({
      isLoggedIn: false,
      user: null,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(<SnapshotsPage />);
    expect(lastWizardProps.targetClientId).toBe('');
  });
});
