// @vitest-environment jsdom
// ── ChatWidgetsPage.test — Sprint 36 (Agent B4) ─────────────────────────────
// Couvre :
//  1. Mount → header + bouton "Créer" + 2 cards rendues (2 widgets mock).
//  2. Sessions count fetché (badge "0" / "2" affiché après resolve).
//  3. Click "Créer" → drawer ouvert en mode create (widgetId undefined).
//  4. Click "Modifier" sur une card → drawer ouvert mode edit avec widgetId.
//  5. Click "Supprimer" + confirm → deleteChatWidget appelé + card retirée.
//  6. Click "Supprimer" + cancel → deleteChatWidget NON appelé.
//  7. Liste vide → empty state + CTA create visible.
//  8. Toggle is_active → updateChatWidget({ is_active: false }) appelé.
//  9. onSaved du drawer → refresh + drawer fermé.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

// i18n : renvoie la clé brute pour assertions stables.
vi.mock('../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

// API : 4 helpers mockés. getChatWidgets contrôlé via fixture.
const getChatWidgetsMock = vi.fn();
const updateChatWidgetMock = vi.fn();
const deleteChatWidgetMock = vi.fn();
const getChatWidgetSessionsMock = vi.fn();

vi.mock('../lib/api', () => ({
  getChatWidgets: () => getChatWidgetsMock(),
  updateChatWidget: (id: string, input: unknown) =>
    updateChatWidgetMock(id, input),
  deleteChatWidget: (id: string) => deleteChatWidgetMock(id),
  getChatWidgetSessions: (id: string, filters?: unknown) =>
    getChatWidgetSessionsMock(id, filters),
}));

// AppLayout : stub minimal.
vi.mock('../components/layout/AppLayout', () => ({
  AppLayout: ({ children, title }: { children: ReactNode; title?: string }) => (
    <div data-testid="app-layout" data-title={title}>
      {children}
    </div>
  ),
}));

// PageHero : stub minimal.
vi.mock('../components/ui/PageHero', () => ({
  PageHero: ({
    title,
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
      <div data-testid="page-hero-actions">{actions}</div>
    </div>
  ),
}));

// Button : stub pass-through (préserve onClick + aria-label + data-testid).
vi.mock('../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
    'data-testid': testId,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    'aria-label'?: string;
    'data-testid'?: string;
    leftIcon?: ReactNode;
    variant?: string;
    size?: string;
    className?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {children}
    </button>
  ),
}));

// Badge / Card / Icon / Skeleton / EmptyState : stubs pass-through.
vi.mock('../components/ui/Badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => (
    <span data-testid="badge-stub">{children}</span>
  ),
}));
vi.mock('../components/ui/Card', () => ({
  Card: ({
    children,
    'data-testid': testId,
  }: {
    children: ReactNode;
    className?: string;
    'data-testid'?: string;
  }) => (
    <div data-testid={testId ?? 'card-stub'}>{children}</div>
  ),
}));
vi.mock('../components/ui/Icon', () => ({
  Icon: () => <span data-testid="icon-stub" />,
}));
vi.mock('../components/ui/Skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton-stub" />,
}));
vi.mock('../components/ui/EmptyState', () => ({
  EmptyState: ({
    title,
    action,
  }: {
    icon?: ReactNode;
    title?: string;
    action?: ReactNode;
  }) => (
    <div data-testid="empty-state-stub">
      <p>{title}</p>
      <div>{action}</div>
    </div>
  ),
}));

// SlidePanel : stub — capture open + children + onOpenChange.
const lastPanelProps: {
  open: boolean | null;
  title: string | null;
  onOpenChange: ((o: boolean) => void) | null;
} = { open: null, title: null, onOpenChange: null };

vi.mock('../components/ui/SlidePanel', () => ({
  SlidePanel: ({
    open,
    onOpenChange,
    title,
    children,
  }: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    title: string;
    children: ReactNode;
    size?: string;
    closeLabel?: string;
    bodyClassName?: string;
  }) => {
    lastPanelProps.open = open;
    lastPanelProps.title = title;
    lastPanelProps.onOpenChange = onOpenChange;
    return (
      <div
        data-testid="slide-panel-stub"
        data-open={open ? 'true' : 'false'}
        data-title={title}
      >
        {open ? children : null}
        <button
          type="button"
          data-testid="slide-panel-close"
          onClick={() => onOpenChange(false)}
        >
          close
        </button>
      </div>
    );
  },
}));

// useToast : capture success / error calls.
const successMock = vi.fn();
const errorMock = vi.fn();
vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ success: successMock, error: errorMock }),
}));

// useConfirm : retour Promise contrôlable.
const confirmMock = vi.fn();
vi.mock('../components/ui/ConfirmDialog', () => ({
  useConfirm: () => confirmMock,
}));

// ChatWidgetSettings : stub — capture widgetId + onSaved trigger.
const lastSettingsProps: {
  widgetId: string | undefined | null;
  onSaved: (() => void) | null;
} = { widgetId: null, onSaved: null };

vi.mock('../components/settings/ChatWidgetSettings', () => ({
  ChatWidgetSettings: ({
    widgetId,
    onSaved,
  }: {
    widgetId?: string;
    onSaved?: () => void;
  }) => {
    lastSettingsProps.widgetId = widgetId;
    lastSettingsProps.onSaved = onSaved ?? null;
    return (
      <div
        data-testid="chat-widget-settings-stub"
        data-widget-id={widgetId ?? ''}
      >
        <button
          type="button"
          data-testid="cws-trigger-saved"
          onClick={() => onSaved?.()}
        >
          fire-saved
        </button>
      </div>
    );
  },
}));

// ── Import APRÈS mocks ──────────────────────────────────────────────────────
import { ChatWidgetsPage } from './ChatWidgetsPage';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeWidget(overrides: Partial<{
  id: string;
  name: string | null;
  primary_color: string | null;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  allowed_origins: string[] | null;
  is_active: 0 | 1;
}> = {}) {
  return {
    id: overrides.id ?? 'wid_1',
    client_id: 'cli_1',
    agency_id: null,
    name: overrides.name ?? 'Widget alpha',
    primary_color: overrides.primary_color ?? '#00B5F5',
    welcome_message: null,
    offline_message: null,
    position: overrides.position ?? 'bottom-right',
    allowed_origins:
      overrides.allowed_origins === undefined
        ? ['https://example.com', 'https://blog.example.com']
        : overrides.allowed_origins,
    avatar_url: null,
    show_powered_by: 1 as 0 | 1,
    business_hours_json: null,
    bot_initial_replies_json: null,
    turnstile_enabled: 0 as 0 | 1,
    is_active: overrides.is_active ?? 1,
    created_at: '2026-05-24T00:00:00.000Z',
    updated_at: null,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<ChatWidgetsPage /> — Sprint 36 B4', () => {
  beforeEach(() => {
    getChatWidgetsMock.mockReset();
    updateChatWidgetMock.mockReset();
    deleteChatWidgetMock.mockReset();
    getChatWidgetSessionsMock.mockReset();
    successMock.mockReset();
    errorMock.mockReset();
    confirmMock.mockReset();
    lastPanelProps.open = null;
    lastPanelProps.title = null;
    lastPanelProps.onOpenChange = null;
    lastSettingsProps.widgetId = null;
    lastSettingsProps.onSaved = null;
    // Default API stubs.
    getChatWidgetSessionsMock.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. mount → header + bouton create + 2 cards rendues', async () => {
    getChatWidgetsMock.mockResolvedValue({
      data: [
        makeWidget({ id: 'wid_a', name: 'Alpha' }),
        makeWidget({ id: 'wid_b', name: 'Beta', is_active: 0 }),
      ],
      error: null,
    });

    await act(async () => {
      render(<ChatWidgetsPage />);
    });

    expect(screen.getByTestId('page-hero-title')).toHaveTextContent(
      'chat_widgets.title',
    );
    expect(screen.getByTestId('cwp-btn-create')).toBeInTheDocument();
    expect(screen.getByTestId('cwp-card-wid_a')).toBeInTheDocument();
    expect(screen.getByTestId('cwp-card-wid_b')).toBeInTheDocument();
  });

  it('2. sessions count fetché et affiché après resolve', async () => {
    getChatWidgetsMock.mockResolvedValue({
      data: [makeWidget({ id: 'wid_a', name: 'Alpha' })],
      error: null,
    });
    getChatWidgetSessionsMock.mockResolvedValue({
      data: [
        { id: 's1' },
        { id: 's2' },
        { id: 's3' },
      ],
      error: null,
    });

    await act(async () => {
      render(<ChatWidgetsPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('cwp-sessions-wid_a')).toHaveTextContent('3');
    });
    expect(getChatWidgetSessionsMock).toHaveBeenCalledWith(
      'wid_a',
      expect.objectContaining({ limit: 200 }),
    );
  });

  it('3. click "Créer" → drawer ouvert mode create (widgetId undefined)', async () => {
    getChatWidgetsMock.mockResolvedValue({
      data: [makeWidget({ id: 'wid_a' })],
      error: null,
    });

    await act(async () => {
      render(<ChatWidgetsPage />);
    });

    const btn = screen.getByTestId('cwp-btn-create');
    act(() => {
      fireEvent.click(btn);
    });

    expect(screen.getByTestId('slide-panel-stub')).toHaveAttribute(
      'data-open',
      'true',
    );
    expect(lastSettingsProps.widgetId).toBeUndefined();
  });

  it('4. click "Modifier" sur une card → drawer ouvert mode edit avec widgetId', async () => {
    getChatWidgetsMock.mockResolvedValue({
      data: [makeWidget({ id: 'wid_42', name: 'Magic' })],
      error: null,
    });

    await act(async () => {
      render(<ChatWidgetsPage />);
    });

    const editBtn = screen.getByTestId('cwp-btn-edit-wid_42');
    act(() => {
      fireEvent.click(editBtn);
    });

    expect(screen.getByTestId('slide-panel-stub')).toHaveAttribute(
      'data-open',
      'true',
    );
    expect(lastSettingsProps.widgetId).toBe('wid_42');
  });

  it('5. click "Supprimer" + confirm → deleteChatWidget appelé + card retirée', async () => {
    getChatWidgetsMock.mockResolvedValue({
      data: [
        makeWidget({ id: 'wid_a', name: 'Alpha' }),
        makeWidget({ id: 'wid_b', name: 'Beta' }),
      ],
      error: null,
    });
    confirmMock.mockResolvedValue(true);
    deleteChatWidgetMock.mockResolvedValue({
      data: { ok: true },
      error: null,
    });

    await act(async () => {
      render(<ChatWidgetsPage />);
    });

    const delBtn = screen.getByTestId('cwp-btn-delete-wid_a');
    await act(async () => {
      fireEvent.click(delBtn);
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(deleteChatWidgetMock).toHaveBeenCalledWith('wid_a');

    await waitFor(() => {
      expect(screen.queryByTestId('cwp-card-wid_a')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('cwp-card-wid_b')).toBeInTheDocument();
    expect(successMock).toHaveBeenCalled();
  });

  it('6. click "Supprimer" + cancel → deleteChatWidget NON appelé', async () => {
    getChatWidgetsMock.mockResolvedValue({
      data: [makeWidget({ id: 'wid_a' })],
      error: null,
    });
    confirmMock.mockResolvedValue(false);

    await act(async () => {
      render(<ChatWidgetsPage />);
    });

    const delBtn = screen.getByTestId('cwp-btn-delete-wid_a');
    await act(async () => {
      fireEvent.click(delBtn);
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(deleteChatWidgetMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('cwp-card-wid_a')).toBeInTheDocument();
  });

  it('7. liste vide → empty state + CTA create', async () => {
    getChatWidgetsMock.mockResolvedValue({ data: [], error: null });

    await act(async () => {
      render(<ChatWidgetsPage />);
    });

    expect(screen.getByTestId('empty-state-stub')).toBeInTheDocument();
    expect(screen.getByTestId('cwp-btn-create-empty')).toBeInTheDocument();
  });

  it('8. toggle is_active → updateChatWidget({ is_active: false })', async () => {
    getChatWidgetsMock.mockResolvedValue({
      data: [makeWidget({ id: 'wid_a', is_active: 1 })],
      error: null,
    });
    updateChatWidgetMock.mockResolvedValue({
      data: makeWidget({ id: 'wid_a', is_active: 0 }),
      error: null,
    });

    await act(async () => {
      render(<ChatWidgetsPage />);
    });

    const toggleBtn = screen.getByTestId('cwp-btn-toggle-wid_a');
    await act(async () => {
      fireEvent.click(toggleBtn);
    });

    expect(updateChatWidgetMock).toHaveBeenCalledWith('wid_a', {
      is_active: false,
    });
    expect(successMock).toHaveBeenCalled();
  });

  it('9. onSaved du drawer → drawer fermé + getChatWidgets re-appelé', async () => {
    getChatWidgetsMock.mockResolvedValue({
      data: [makeWidget({ id: 'wid_a' })],
      error: null,
    });

    await act(async () => {
      render(<ChatWidgetsPage />);
    });

    // ouvre le drawer en mode create
    act(() => {
      fireEvent.click(screen.getByTestId('cwp-btn-create'));
    });
    expect(screen.getByTestId('slide-panel-stub')).toHaveAttribute(
      'data-open',
      'true',
    );

    const beforeCalls = getChatWidgetsMock.mock.calls.length;

    // déclenche onSaved depuis le stub ChatWidgetSettings
    await act(async () => {
      fireEvent.click(screen.getByTestId('cws-trigger-saved'));
    });

    expect(screen.getByTestId('slide-panel-stub')).toHaveAttribute(
      'data-open',
      'false',
    );
    expect(getChatWidgetsMock.mock.calls.length).toBeGreaterThan(beforeCalls);
  });

  it('10. update erreur → toast error + state inchangé', async () => {
    getChatWidgetsMock.mockResolvedValue({
      data: [makeWidget({ id: 'wid_a', is_active: 1 })],
      error: null,
    });
    updateChatWidgetMock.mockResolvedValue({
      data: null,
      error: 'boom',
    });

    await act(async () => {
      render(<ChatWidgetsPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('cwp-btn-toggle-wid_a'));
    });

    expect(errorMock).toHaveBeenCalledWith('boom');
    expect(successMock).not.toHaveBeenCalled();
  });
});
