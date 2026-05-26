// @vitest-environment jsdom
// ── SnapshotImportWizard.test — Sprint 35 (Agent B2) ────────────────────────
// Couvre :
//  1. Render → step 1 (upload) visible.
//  2. Upload JSON valide → dry_run mock OK → step 2 + SnapshotPreview affiché.
//  3. Upload tampered → dry_run mock signature_mismatch → reste step 1 + msg.
//  4. Step 2 confirmer → step 3 + commit appelé.
//  5. Commit succès → onClose appelé.
//  6. Commit erreur → message + retry visible → retry réinvoque commit.

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

// ── Mocks api ────────────────────────────────────────────────────────────────
const importSnapshotMock = vi.fn();

vi.mock('../../lib/api', () => ({
  importSnapshot: (...a: unknown[]) => importSnapshotMock(...(a as [])),
}));

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
}));

// Modal : stub minimal. Rend les children quand open=true.
vi.mock('../ui/Modal', () => ({
  Modal: ({
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
      <div data-testid="modal-stub" role="dialog" aria-label={title}>
        <div data-testid="modal-title">{title}</div>
        {children}
      </div>
    ) : null,
}));

// Button : stub pass-through avec onClick. Préserve isLoading/disabled.
vi.mock('../ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    type,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      data-loading={isLoading ? 'true' : 'false'}
    >
      {children}
    </button>
  ),
}));

// Icon : stub.
vi.mock('../ui/Icon', () => ({
  Icon: ({ size }: { size?: number }) => (
    <span data-testid="icon-stub" data-size={size} />
  ),
}));

// Toast : capture success/error appels.
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

// SnapshotPreview (B3) : stub minimal qui affiche un marker.
vi.mock('./SnapshotPreview', () => ({
  SnapshotPreview: ({
    summary,
  }: {
    summary: { total_entities: number };
    log: unknown[];
  }) => (
    <div data-testid="snapshot-preview-stub">
      preview:{summary.total_entities}
    </div>
  ),
}));

// Import APRÈS les mocks.
import { SnapshotImportWizard } from './SnapshotImportWizard';

// ── Helpers ──────────────────────────────────────────────────────────────────

const validBundle = {
  schema_version: 1,
  metadata: { id: 'snap_1', name: 'demo' },
  entities: {},
};

function makeFile(content: string, name = 'snapshot.json'): File {
  return new File([content], name, { type: 'application/json' });
}

function uploadFile(file: File) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
}

const baseProps = {
  open: true,
  onClose: vi.fn(),
  targetClientId: 'tenant_target_1',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SnapshotImportWizard', () => {
  beforeEach(() => {
    importSnapshotMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    baseProps.onClose = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Render → step 1 (upload) visible', () => {
    render(<SnapshotImportWizard {...baseProps} />);
    expect(screen.getByTestId('modal-stub')).toBeInTheDocument();
    expect(
      screen.getByText('snapshots.import.dry_run_button'),
    ).toBeInTheDocument();
    // Pas encore de preview stub à l'écran (step 1).
    expect(
      screen.queryByTestId('snapshot-preview-stub'),
    ).not.toBeInTheDocument();
  });

  it('2. Upload JSON valide → dry_run OK → step 2 + preview affiché', async () => {
    importSnapshotMock.mockResolvedValueOnce({
      data: {
        import_id: 'imp_1',
        summary: {
          total_entities: 42,
          totals: {},
          id_mapping: {},
        },
        log: [],
      },
    });

    render(<SnapshotImportWizard {...baseProps} />);
    uploadFile(makeFile(JSON.stringify(validBundle)));

    // FileReader async → wait que le bouton soit enabled.
    await waitFor(() => {
      const btn = screen.getByText('snapshots.import.dry_run_button')
        .closest('button')!;
      expect(btn).not.toBeDisabled();
    });

    fireEvent.click(
      screen.getByText('snapshots.import.dry_run_button').closest('button')!,
    );

    await waitFor(() => {
      expect(screen.getByTestId('snapshot-preview-stub')).toBeInTheDocument();
    });

    expect(importSnapshotMock).toHaveBeenCalledWith({
      bundle: validBundle,
      target_client_id: 'tenant_target_1',
      mode: 'dry_run',
    });
    expect(
      within(screen.getByTestId('snapshot-preview-stub')).getByText(
        /preview:42/,
      ),
    ).toBeInTheDocument();
    // Commit button visible step 2.
    expect(
      screen.getByText('snapshots.import.commit_button'),
    ).toBeInTheDocument();
  });

  it('3. Upload tampered → dry_run signature_mismatch → reste step 1 + msg', async () => {
    importSnapshotMock.mockResolvedValueOnce({
      error: 'signature mismatch expected=abc123def received=999fffeee',
    });

    render(<SnapshotImportWizard {...baseProps} />);
    uploadFile(makeFile(JSON.stringify(validBundle)));

    await waitFor(() => {
      const btn = screen.getByText('snapshots.import.dry_run_button')
        .closest('button')!;
      expect(btn).not.toBeDisabled();
    });

    fireEvent.click(
      screen.getByText('snapshots.import.dry_run_button').closest('button')!,
    );

    await waitFor(() => {
      expect(
        screen.getByText('snapshots.error.signature_mismatch'),
      ).toBeInTheDocument();
    });

    // Hashes affichés (meta extraite).
    expect(screen.getByText(/abc123def/)).toBeInTheDocument();
    expect(screen.getByText(/999fffeee/)).toBeInTheDocument();
    // Reste sur step 1 : pas de preview stub.
    expect(
      screen.queryByTestId('snapshot-preview-stub'),
    ).not.toBeInTheDocument();
  });

  it('3bis. Upload JSON invalide → toast + reste step 1', async () => {
    render(<SnapshotImportWizard {...baseProps} />);
    uploadFile(makeFile('not-json-{{{', 'broken.json'));

    await waitFor(() => {
      expect(
        screen.getByText('snapshots.error.invalid_schema'),
      ).toBeInTheDocument();
    });

    // Bouton dry-run reste disabled (pas de bundle).
    const btn = screen
      .getByText('snapshots.import.dry_run_button')
      .closest('button')!;
    expect(btn).toBeDisabled();
    // Aucun appel back.
    expect(importSnapshotMock).not.toHaveBeenCalled();
  });

  it('4. Step 2 confirmer → step 3 + commit appelé', async () => {
    importSnapshotMock
      .mockResolvedValueOnce({
        data: {
          import_id: 'imp_2',
          summary: { total_entities: 7, totals: {}, id_mapping: {} },
          log: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          import_id: 'imp_2_committed',
          summary: { total_entities: 7, totals: {}, id_mapping: {} },
          log: [],
        },
      });

    render(<SnapshotImportWizard {...baseProps} />);
    uploadFile(makeFile(JSON.stringify(validBundle)));

    await waitFor(() => {
      expect(
        screen.getByText('snapshots.import.dry_run_button').closest('button')!,
      ).not.toBeDisabled();
    });
    fireEvent.click(
      screen.getByText('snapshots.import.dry_run_button').closest('button')!,
    );

    await waitFor(() =>
      expect(screen.getByTestId('snapshot-preview-stub')).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByText('snapshots.import.commit_button').closest('button')!,
    );

    // Commit appelé avec mode=commit.
    await waitFor(() => {
      expect(importSnapshotMock).toHaveBeenCalledTimes(2);
    });
    expect(importSnapshotMock).toHaveBeenLastCalledWith({
      bundle: validBundle,
      target_client_id: 'tenant_target_1',
      mode: 'commit',
    });
  });

  it('5. Commit succès → onClose appelé + toast success', async () => {
    importSnapshotMock
      .mockResolvedValueOnce({
        data: {
          import_id: 'imp_3',
          summary: { total_entities: 3, totals: {}, id_mapping: {} },
          log: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          import_id: 'imp_3_committed',
          summary: { total_entities: 3, totals: {}, id_mapping: {} },
          log: [],
        },
      });

    render(<SnapshotImportWizard {...baseProps} />);
    uploadFile(makeFile(JSON.stringify(validBundle)));

    await waitFor(() => {
      expect(
        screen.getByText('snapshots.import.dry_run_button').closest('button')!,
      ).not.toBeDisabled();
    });
    fireEvent.click(
      screen.getByText('snapshots.import.dry_run_button').closest('button')!,
    );

    await waitFor(() =>
      expect(screen.getByTestId('snapshot-preview-stub')).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByText('snapshots.import.commit_button').closest('button')!,
    );

    await waitFor(() => {
      expect(baseProps.onClose).toHaveBeenCalledTimes(1);
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('snapshots.toast.imported');
  });

  it('6. Commit erreur → message + retry visible → retry réinvoque commit', async () => {
    importSnapshotMock
      .mockResolvedValueOnce({
        data: {
          import_id: 'imp_4',
          summary: { total_entities: 1, totals: {}, id_mapping: {} },
          log: [],
        },
      })
      .mockResolvedValueOnce({ error: 'boom backend error' })
      .mockResolvedValueOnce({
        data: {
          import_id: 'imp_4_committed_retry',
          summary: { total_entities: 1, totals: {}, id_mapping: {} },
          log: [],
        },
      });

    render(<SnapshotImportWizard {...baseProps} />);
    uploadFile(makeFile(JSON.stringify(validBundle)));

    await waitFor(() => {
      expect(
        screen.getByText('snapshots.import.dry_run_button').closest('button')!,
      ).not.toBeDisabled();
    });
    fireEvent.click(
      screen.getByText('snapshots.import.dry_run_button').closest('button')!,
    );

    await waitFor(() =>
      expect(screen.getByTestId('snapshot-preview-stub')).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByText('snapshots.import.commit_button').closest('button')!,
    );

    // Erreur visible + bouton retry.
    await waitFor(() => {
      expect(screen.getByText('boom backend error')).toBeInTheDocument();
    });
    expect(screen.getByText('action.retry')).toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalledWith('boom backend error');

    // Click retry → 3ème call commit.
    fireEvent.click(screen.getByText('action.retry').closest('button')!);

    await waitFor(() => {
      expect(importSnapshotMock).toHaveBeenCalledTimes(3);
    });
    // Reussite cette fois → onClose.
    await waitFor(() => {
      expect(baseProps.onClose).toHaveBeenCalledTimes(1);
    });
  });
});
