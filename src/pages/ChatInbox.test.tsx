// @vitest-environment jsdom
// ── ChatInbox.test — Sprint 36 (Agent B2) ────────────────────────────────────
// Couvre :
//  1. Mount → liste sessions visible (widgets actifs uniquement, agrégés).
//  2. Heartbeat presence : appel immédiat 'online' + setInterval 30s.
//  3. Unmount → 'offline' + interval cleared.
//  4. Click session → getChatSessionDetail appelé, transcript chargé.
//  5. Send message → WebSocket.send appelé avec body JSON correct.
//  6. Receive message via WS onmessage → ajout dans transcript.
//  7. Receive {type:'typing'} via WS → indicateur "écrit…" affiché.

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

// ── Mocks API ───────────────────────────────────────────────────────────────

const getChatWidgetsMock = vi.fn();
const getChatWidgetSessionsMock = vi.fn();
const getChatSessionDetailMock = vi.fn();
const postChatPresenceHeartbeatMock = vi.fn();

vi.mock('../lib/api', () => ({
  getChatWidgets: (...args: unknown[]) => getChatWidgetsMock(...args),
  getChatWidgetSessions: (...args: unknown[]) =>
    getChatWidgetSessionsMock(...args),
  getChatSessionDetail: (...args: unknown[]) =>
    getChatSessionDetailMock(...args),
  postChatPresenceHeartbeat: (...args: unknown[]) =>
    postChatPresenceHeartbeatMock(...args),
}));

// ── Mocks i18n ──────────────────────────────────────────────────────────────

vi.mock('../lib/i18n', () => ({
  t: (k: string) => k,
  getLocale: () => 'fr-CA',
}));

// ── Mocks UI (stubs minimalistes pass-through) ──────────────────────────────

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
      <h1>{title}</h1>
      <p>{description}</p>
      <div>{actions}</div>
    </div>
  ),
}));

vi.mock('../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    type,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode;
    onClick?: () => void;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    'aria-label'?: string;
    variant?: string;
    size?: string;
    isLoading?: boolean;
    leftIcon?: ReactNode;
  }) => (
    <button
      type={type ?? 'button'}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
}));

vi.mock('../components/ui/Badge', () => ({
  Badge: ({
    children,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode;
    'aria-label'?: string;
    intent?: string;
    fill?: string;
    size?: string;
    dot?: boolean;
    pulse?: boolean;
  }) => <span aria-label={ariaLabel}>{children}</span>,
}));

vi.mock('../components/ui/Input', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    'aria-label': ariaLabel,
    disabled,
  }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    'aria-label'?: string;
    disabled?: boolean;
  }) => (
    <input
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
    />
  ),
}));

vi.mock('../components/ui/Card', () => ({
  Card: ({
    children,
    'aria-label': ariaLabel,
    className,
  }: {
    children: ReactNode;
    'aria-label'?: string;
    className?: string;
  }) => (
    <div aria-label={ariaLabel} className={className}>
      {children}
    </div>
  ),
}));

vi.mock('../components/ui/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => (
    <div data-testid="empty-state">{title}</div>
  ),
}));

vi.mock('../components/ui/Skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

vi.mock('../components/ui/Icon', () => ({
  Icon: () => <span data-testid="icon-stub" />,
}));

// ── Mock global WebSocket ───────────────────────────────────────────────────

interface MockWsInstance {
  url: string;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}

const wsInstances: MockWsInstance[] = [];

class MockWebSocket implements MockWsInstance {
  static OPEN = 1;
  static CLOSED = 3;
  url: string;
  readyState: number = MockWebSocket.OPEN;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    wsInstances.push(this);
    // simule open async
    queueMicrotask(() => {
      this.onopen?.();
    });
  }
}

// Constantes globales pour le code applicatif (WebSocket.OPEN etc.)
(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
  MockWebSocket;

// ── Imports APRÈS les mocks ─────────────────────────────────────────────────

import { ChatInbox } from './ChatInbox';

// ── Helpers fixtures ────────────────────────────────────────────────────────

function widgetFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wid_1',
    client_id: 'cli_1',
    agency_id: null,
    name: 'Widget principal',
    primary_color: null,
    welcome_message: null,
    offline_message: null,
    position: 'bottom-right',
    allowed_origins: null,
    avatar_url: null,
    show_powered_by: 1,
    business_hours_json: null,
    bot_initial_replies_json: null,
    turnstile_enabled: 0,
    is_active: 1,
    created_at: '2026-05-24T10:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

function sessionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess_1',
    widget_id: 'wid_1',
    conversation_id: 'conv_1',
    visitor_name: 'Alice Dupont',
    visitor_email: 'alice@example.com',
    page_url: 'https://intralys.com/pricing',
    referrer: 'https://google.com',
    user_agent: 'Mozilla/5.0',
    ip_hash: 'a1b2c3d4e5f6',
    started_at: new Date(Date.now() - 60_000).toISOString(),
    ended_at: null,
    last_seen_at: new Date().toISOString(),
    status: 'active',
    unread_agent_count: 2,
    agent_user_id: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<ChatInbox /> — Sprint 36 B2', () => {
  beforeEach(() => {
    wsInstances.length = 0;
    getChatWidgetsMock.mockReset();
    getChatWidgetSessionsMock.mockReset();
    getChatSessionDetailMock.mockReset();
    postChatPresenceHeartbeatMock.mockReset();
    postChatPresenceHeartbeatMock.mockResolvedValue({ data: { ok: true } });

    getChatWidgetsMock.mockResolvedValue({
      data: [widgetFixture(), widgetFixture({ id: 'wid_2', is_active: 0 })],
    });
    getChatWidgetSessionsMock.mockResolvedValue({
      data: [sessionFixture()],
    });
    getChatSessionDetailMock.mockResolvedValue({
      data: {
        ...sessionFixture(),
        messages: [
          {
            id: 'm1',
            direction: 'inbound',
            body: 'Bonjour !',
            sent_by: null,
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    // stub localStorage token
    window.localStorage.setItem('intralys_token', 'tk_test');
  });

  afterEach(() => {
    cleanup();
    if (vi.isFakeTimers()) vi.useRealTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('1. mount → liste sessions visible (uniquement widgets actifs)', async () => {
    render(<ChatInbox />);

    // attend que le bouton de la session apparaisse (chaîne async résolue)
    expect(
      await screen.findByRole('button', {
        name: /Conversation Alice Dupont/i,
      }),
    ).toBeInTheDocument();

    expect(getChatWidgetsMock).toHaveBeenCalledTimes(1);
    // 1 widget actif sur 2 → 1 seul appel getChatWidgetSessions
    expect(getChatWidgetSessionsMock).toHaveBeenCalledTimes(1);
    expect(getChatWidgetSessionsMock).toHaveBeenCalledWith('wid_1', {
      status: 'active',
      limit: 50,
    });
  });

  it('2. heartbeat presence : appel immédiat online + setInterval 30s', async () => {
    vi.useFakeTimers();
    render(<ChatInbox />);

    // appel immédiat au mount → 'online'
    expect(postChatPresenceHeartbeatMock).toHaveBeenCalledTimes(1);
    expect(postChatPresenceHeartbeatMock).toHaveBeenCalledWith('online');

    // après 30s → 2e appel
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(postChatPresenceHeartbeatMock).toHaveBeenCalledTimes(2);

    // après 60s → 3e appel
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(postChatPresenceHeartbeatMock).toHaveBeenCalledTimes(3);
  });

  it('3. unmount → heartbeat offline envoyé + interval cleared', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<ChatInbox />);

    expect(postChatPresenceHeartbeatMock).toHaveBeenCalledTimes(1);

    unmount();

    // dernier appel = offline
    const calls = postChatPresenceHeartbeatMock.mock.calls;
    expect(calls.at(-1)?.[0]).toBe('offline');

    // l'interval ne tire plus
    const before = postChatPresenceHeartbeatMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(postChatPresenceHeartbeatMock.mock.calls.length).toBe(before);
  });

  it('4. click session → getChatSessionDetail appelé + transcript visible', async () => {
    render(<ChatInbox />);

    const btn = await screen.findByRole('button', {
      name: /Conversation Alice Dupont/i,
    });

    fireEvent.click(btn);

    await waitFor(() => {
      expect(getChatSessionDetailMock).toHaveBeenCalledWith('wid_1', 'sess_1');
    });

    await waitFor(() => {
      expect(screen.getByText('Bonjour !')).toBeInTheDocument();
    });
  });

  it('5. send message → WebSocket.send appelé avec body JSON correct', async () => {
    render(<ChatInbox />);

    const sessionBtn = await screen.findByRole('button', {
      name: /Conversation Alice Dupont/i,
    });
    fireEvent.click(sessionBtn);

    // attend l'ouverture WS (microtask)
    await waitFor(() => {
      expect(wsInstances.length).toBeGreaterThan(0);
    });
    const ws = wsInstances[wsInstances.length - 1]!;
    expect(ws.url).toContain('/api/webchat/ws');
    expect(ws.url).toContain('conversation_id=conv_1');
    expect(ws.url).toContain('role=agent');
    expect(ws.url).toContain('token=tk_test');

    // attend que le composer apparaisse (selected propagé)
    const input = (await screen.findByLabelText(
      'Message',
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Salut Alice' } });

    const sendBtn = screen.getByRole('button', { name: /Envoyer/i });
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });
    const payload = JSON.parse(ws.send.mock.calls[0]![0] as string);
    expect(payload).toMatchObject({ type: 'message', body: 'Salut Alice' });

    // optimistic local : le message apparaît dans le transcript
    await waitFor(() => {
      expect(screen.getByText('Salut Alice')).toBeInTheDocument();
    });
  });

  it('6. receive message via WS onmessage → ajout dans transcript', async () => {
    render(<ChatInbox />);

    const sessionBtn = await screen.findByRole('button', {
      name: /Conversation Alice Dupont/i,
    });
    fireEvent.click(sessionBtn);

    await waitFor(() => {
      expect(wsInstances.length).toBeGreaterThan(0);
    });
    const ws = wsInstances[wsInstances.length - 1]!;
    await waitFor(() => {
      expect(ws.onmessage).not.toBeNull();
    });

    await act(async () => {
      ws.onmessage!({
        data: JSON.stringify({
          type: 'message',
          sender: 'visitor',
          body: 'Vous êtes là ?',
          timestamp: new Date().toISOString(),
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Vous êtes là ?')).toBeInTheDocument();
    });
  });

  it('7. receive {type:"typing"} via WS → indicateur "écrit…" visible 3s', async () => {
    render(<ChatInbox />);

    const sessionBtn = await screen.findByRole('button', {
      name: /Conversation Alice Dupont/i,
    });
    fireEvent.click(sessionBtn);

    await waitFor(() => {
      expect(wsInstances.length).toBeGreaterThan(0);
    });
    const ws = wsInstances[wsInstances.length - 1]!;
    await waitFor(() => {
      expect(ws.onmessage).not.toBeNull();
    });

    // bascule en fake timers pour avancer 3 sec
    vi.useFakeTimers();

    act(() => {
      ws.onmessage!({ data: JSON.stringify({ type: 'typing' }) });
    });

    expect(screen.getByTestId('typing-indicator')).toBeInTheDocument();

    // après 3 sec, l'indicateur disparaît
    act(() => {
      vi.advanceTimersByTime(3_100);
    });

    expect(screen.queryByTestId('typing-indicator')).not.toBeInTheDocument();
  });
});
