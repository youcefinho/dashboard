// @vitest-environment jsdom
// ── SnapshotManager.test — Sprint 35 (Agent B1) ─────────────────────────────
// Couvre :
//  1. Mount → getSnapshots appelé + 3 snapshots affichés.
//  2. Click "Créer" → modal apparaît.
//  3. Submit form → createSnapshot(args) + refresh + toast created.
//  4. Click "Télécharger" → downloadSnapshot(id) + trigger blob download.
//  5. Click "Publier" sur draft → publishSnapshot(id) appelé.
//  6. Liste vide → empty state visible.
//  7. Mock erreur réseau → toast erreur affiché.

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
const getSnapshotsMock = vi.fn();
const createSnapshotMock = vi.fn();
const downloadSnapshotMock = vi.fn();
const publishSnapshotMock = vi.fn();
const archiveSnapshotMock = vi.fn();
const deleteSnapshotMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getSnapshots: (...a: unknown[]) => getSnapshotsMock(...(a as [])),
  createSnapshot: (...a: unknown[]) => createSnapshotMock(...(a as [])),
  downloadSnapshot: (...a: unknown[]) => downloadSnapshotMock(...(a as [])),
  publishSnapshot: (...a: unknown[]) => publishSnapshotMock(...(a as [])),
  archiveSnapshot: (...a: unknown[]) => archiveSnapshotMock(...(a as [])),
  deleteSnapshot: (...a: unknown[]) => deleteSnapshotMock(...(a as [])),
}));

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

vi.mock('../../lib/i18n/datetime', () => ({
  formatRelativeTime: (_d: unknown, _l: string) => 'il y a 2 h',
}));

// Modal : stub minimal — rend les children quand open=true.
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

// Button : stub pass-through avec onClick/type/disabled/isLoading.
vi.mock('../ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    type,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    type?: 'button' | 'submit' | 'reset';
    'aria-label'?: string;
  }) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      data-loading={isLoading ? 'true' : 'false'}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
}));

// Input : passe label htmlFor + onChange.
vi.mock('../ui/Input', () => ({
  Input: ({
    id,
    value,
    onChange,
    'aria-label': ariaLabel,
    required,
  }: {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    'aria-label'?: string;
    required?: boolean;
  }) => (
    <input
      id={id}
      value={value ?? ''}
      onChange={onChange}
      aria-label={ariaLabel}
      required={required}
      data-testid={`input-${id ?? 'unknown'}`}
    />
  ),
}));

// Textarea : idem.
vi.mock('../ui/Textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
    'aria-label': ariaLabel,
  }: {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    'aria-label'?: string;
  }) => (
    <textarea
      id={id}
      value={value ?? ''}
      onChange={onChange}
      aria-label={ariaLabel}
      data-testid={`textarea-${id ?? 'unknown'}`}
    />
  ),
}));

// Icon : stub.
vi.mock('../ui/Icon', () => ({
  Icon: ({ size }: { size?: number }) => (
    <span data-testid="icon-stub" data-size={size} />
  ),
}));

// Skeleton : stub.
vi.mock('../ui/Skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

// EmptyState : stub — rend titre + action.
vi.mock('../ui/EmptyState', () => ({
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
import { SnapshotManager } from './SnapshotManager';
import type { SnapshotMeta } from '../../lib/api';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeSnap(over: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    id: over.id ?? 'snap_1',
    client_id: over.client_id ?? 'cli_1',
    name: over.name ?? 'Baseline pipelines',
    description: over.description ?? 'Bundle initial pour onboarding',
    schema_version: over.schema_version ?? 1,
    payload_size_bytes: over.payload_size_bytes ?? 245760,
    tables_summary:
      over.tables_summary === undefined
        ? ({
            workflows: 12,
            forms: 4,
            email_templates: 7,
          } as SnapshotMeta['tables_summary'])
        : over.tables_summary,
    status: over.status ?? 'draft',
    created_by: over.created_by ?? 'user_1',
    created_at: over.created_at ?? '2026-05-22T10:00:00Z',
  };
}

function threeSnapshots(): SnapshotMeta[] {
  return [
    makeSnap({ id: 'snap_1', name: 'Baseline pipelines', status: 'draft' }),
    makeSnap({ id: 'snap_2', name: 'Workflows Q1', status: 'published' }),
    makeSnap({ id: 'snap_3', name: 'Archive 2025', status: 'archived' }),
  ];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<SnapshotManager /> — Sprint 35 B1', () => {
  beforeEach(() => {
    getSnapshotsMock.mockResolvedValue({ data: threeSnapshots() });
    createSnapshotMock.mockResolvedValue({
      data: makeSnap({ id: 'snap_new', name: 'New snap' }),
    });
    downloadSnapshotMock.mockResolvedValue({ data: new Blob(['{}']) });
    publishSnapshotMock.mockResolvedValue({
      data: makeSnap({ status: 'published' }),
    });
    archiveSnapshotMock.mockResolvedValue({
      data: makeSnap({ status: 'archived' }),
    });
    deleteSnapshotMock.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. mount → getSnapshots appelé + 3 snapshots rendus', async () => {
    render(<SnapshotManager />);
    await waitFor(() => expect(getSnapshotsMock).toHaveBeenCalledTimes(1));

    expect(await screen.findByText('Baseline pipelines')).toBeInTheDocument();
    expect(screen.getByText('Workflows Q1')).toBeInTheDocument();
    expect(screen.getByText('Archive 2025')).toBeInTheDocument();
    expect(screen.getByTestId('snapshot-row-snap_1')).toBeInTheDocument();
    expect(screen.getByTestId('snapshot-row-snap_2')).toBeInTheDocument();
    expect(screen.getByTestId('snapshot-row-snap_3')).toBeInTheDocument();
  });

  it('2. click "Créer" → modal apparaît', async () => {
    render(<SnapshotManager />);
    await screen.findByText('Baseline pipelines');

    // Le bouton header porte aria-label = snapshots.action.create
    const createButtons = screen.getAllByRole('button', {
      name: 'snapshots.action.create',
    });
    const firstCreate = createButtons[0];
    if (!firstCreate) throw new Error('create button not found');
    fireEvent.click(firstCreate);

    expect(await screen.findByTestId('modal-stub')).toBeInTheDocument();
    expect(screen.getByTestId('modal-title')).toHaveTextContent(
      'snapshots.create.modal_title',
    );
  });

  it('3. submit form → createSnapshot(args) + refresh + toast created', async () => {
    render(<SnapshotManager />);
    await screen.findByText('Baseline pipelines');

    // Ouvre la modal.
    const createBtn = screen.getAllByRole('button', {
      name: 'snapshots.action.create',
    })[0];
    if (!createBtn) throw new Error('create button not found');
    fireEvent.click(createBtn);
    const modal = await screen.findByTestId('modal-stub');

    // Remplit le nom + description.
    const nameInput = within(modal).getByTestId('input-snapshot-name');
    fireEvent.change(nameInput, { target: { value: 'My new bundle' } });

    const descTextarea = within(modal).getByTestId('textarea-snapshot-desc');
    fireEvent.change(descTextarea, { target: { value: 'For client X' } });

    // Soumission via le bouton submit.
    const submitBtn = within(modal).getByRole('button', {
      name: 'snapshots.create.submit',
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createSnapshotMock).toHaveBeenCalledWith({
        name: 'My new bundle',
        description: 'For client X',
      });
    });
    // Toast created
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('snapshots.toast.created');
    });
    // Refresh (2nd appel)
    await waitFor(() => {
      expect(getSnapshotsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('4. click "Télécharger" → downloadSnapshot(id) + trigger blob download', async () => {
    // Spy sur URL.createObjectURL + revokeObjectURL (jsdom les expose pas).
    const createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    const revokeObjectURLSpy = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy,
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    render(<SnapshotManager />);
    await screen.findByText('Baseline pipelines');

    const row = screen.getByTestId('snapshot-row-snap_1');
    const dlBtn = within(row).getByRole('button', {
      name: /snapshots\.action\.download/i,
    });
    fireEvent.click(dlBtn);

    await waitFor(() => {
      expect(downloadSnapshotMock).toHaveBeenCalledWith('snap_1');
    });
    await waitFor(() => {
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  it('5. click "Publier" sur draft → publishSnapshot(id) appelé + refresh', async () => {
    render(<SnapshotManager />);
    await screen.findByText('Baseline pipelines');

    const row = screen.getByTestId('snapshot-row-snap_1'); // draft
    const publishBtn = within(row).getByRole('button', {
      name: /snapshots\.action\.publish/i,
    });
    fireEvent.click(publishBtn);

    await waitFor(() => {
      expect(publishSnapshotMock).toHaveBeenCalledWith('snap_1');
    });
    await waitFor(() => {
      expect(getSnapshotsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Pas de bouton Publier sur le snapshot publié snap_2.
    const row2 = screen.getByTestId('snapshot-row-snap_2');
    expect(
      within(row2).queryByRole('button', { name: /snapshots\.action\.publish/i }),
    ).toBeNull();
  });

  it('6. liste vide → empty state visible + bouton create dans empty state', async () => {
    getSnapshotsMock.mockResolvedValue({ data: [] });

    render(<SnapshotManager />);
    await waitFor(() => expect(getSnapshotsMock).toHaveBeenCalled());

    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('empty-title')).toHaveTextContent(
      'snapshots.list.empty',
    );
    // Action button rendu dans l'empty state
    const emptyAction = screen.getByTestId('empty-action');
    expect(
      within(emptyAction).getByRole('button', {
        name: /snapshots\.action\.create/i,
      }),
    ).toBeInTheDocument();
  });

  it('7. mock erreur réseau au mount → toast erreur affiché', async () => {
    getSnapshotsMock.mockResolvedValue({ error: 'Network down' });

    render(<SnapshotManager />);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Network down');
    });
    // Liste vide → empty state.
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
  });

  it('8. erreur createSnapshot → toast error, modal reste ouverte', async () => {
    createSnapshotMock.mockResolvedValue({ error: 'Quota exceeded' });

    render(<SnapshotManager />);
    await screen.findByText('Baseline pipelines');

    const createBtn2 = screen.getAllByRole('button', {
      name: 'snapshots.action.create',
    })[0];
    if (!createBtn2) throw new Error('create button not found');
    fireEvent.click(createBtn2);
    const modal = await screen.findByTestId('modal-stub');
    const nameInput = within(modal).getByTestId('input-snapshot-name');
    fireEvent.change(nameInput, { target: { value: 'Bad bundle' } });

    fireEvent.click(
      within(modal).getByRole('button', { name: 'snapshots.create.submit' }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Quota exceeded');
    });
    // Modal toujours visible (pas de close auto sur erreur).
    expect(screen.getByTestId('modal-stub')).toBeInTheDocument();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
