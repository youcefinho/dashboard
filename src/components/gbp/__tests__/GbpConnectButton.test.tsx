// @vitest-environment jsdom
// ── Sprint 32 — GBP : tests <GbpConnectButton /> (Manager-C4) ──────────────
//
// Couvre :
//   1. Render sans connection → bouton "Connect" visible (clé i18n gbp.connect).
//   2. Click Connect → connectGbp() appelé → window.location.href set vers
//      l'URL d'autorisation OAuth retournée.
//   3. Render avec connection active → texte "Connected as <accountName>"
//      + bouton "Disconnect" visible.
//   4. Click Disconnect → window.confirm appelé + disconnectGbp(connectionId).
//   5. connectGbp retourne erreur → message d'erreur affiché (pas de redirect).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react';

// ── Mock i18n : retourne la clé telle quelle (assertion littérale) ─────────
vi.mock('@/lib/i18n', () => ({
  t: (k: string) => k,
}));

// ── Mock API ───────────────────────────────────────────────────────────────
const connectGbpMock = vi.fn();
const disconnectGbpMock = vi.fn();
const getGbpConnectionMock = vi.fn();

vi.mock('@/lib/api', () => ({
  connectGbp: (...args: unknown[]) => connectGbpMock(...args),
  disconnectGbp: (...args: unknown[]) => disconnectGbpMock(...args),
  getGbpConnection: (...args: unknown[]) => getGbpConnectionMock(...args),
}));

// Imports APRÈS les mocks
import { GbpConnectButton } from '../GbpConnectButton';

// ── Fixtures ───────────────────────────────────────────────────────────────

function noConnection() {
  return { data: null };
}

function activeConnection() {
  return {
    data: {
      id: 'conn_1',
      clientId: 'client_1',
      agencyId: null,
      oauthConnectionId: 'oauth_1',
      gbpAccountId: 'accounts/123',
      gbpAccountName: 'Intralys Inc',
      status: 'active' as const,
      lastSyncAt: '2026-05-24T10:00:00Z',
      createdAt: '2026-05-20T10:00:00Z',
      updatedAt: '2026-05-24T10:00:00Z',
    },
  };
}

// ── Helper : mock window.location.href (jsdom) ─────────────────────────────
function mockWindowLocation() {
  const original = window.location;
  // Restore-able mock — supprime/restaure une seule fois par test.
  const hrefSetter = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...original,
      get href() {
        return '';
      },
      set href(v: string) {
        hrefSetter(v);
      },
    },
  });
  return { hrefSetter, restore: () => Object.defineProperty(window, 'location', { configurable: true, value: original }) };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<GbpConnectButton /> — Sprint 32', () => {
  beforeEach(() => {
    connectGbpMock.mockReset();
    disconnectGbpMock.mockReset();
    getGbpConnectionMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('1. render sans connection → bouton Connect visible', async () => {
    getGbpConnectionMock.mockResolvedValue(noConnection());
    render(<GbpConnectButton clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByText('gbp.connect')).toBeInTheDocument(),
    );
    // Bouton "Connect" interrogeable
    expect(screen.getByTestId('gbp-connect-btn')).toBeInTheDocument();
    // Pas de "Disconnect" visible
    expect(screen.queryByTestId('gbp-disconnect-btn')).not.toBeInTheDocument();
  });

  it('2. click Connect → connectGbp + window.location.href set', async () => {
    const { hrefSetter, restore } = mockWindowLocation();

    getGbpConnectionMock.mockResolvedValue(noConnection());
    connectGbpMock.mockResolvedValue({
      data: { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?xxx' },
    });

    render(<GbpConnectButton clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-connect-btn')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('gbp-connect-btn'));

    await waitFor(() => expect(connectGbpMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(hrefSetter).toHaveBeenCalledWith(
        'https://accounts.google.com/o/oauth2/v2/auth?xxx',
      ),
    );

    restore();
  });

  it('3. render avec connection active → Connected as XXX + bouton Disconnect', async () => {
    getGbpConnectionMock.mockResolvedValue(activeConnection());
    render(<GbpConnectButton clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-disconnect-btn')).toBeInTheDocument(),
    );
    // Nom de compte rendu (literal, pas via i18n)
    expect(screen.getByText(/Intralys Inc/)).toBeInTheDocument();
    // "Connect" bouton n'est plus là
    expect(screen.queryByTestId('gbp-connect-btn')).not.toBeInTheDocument();
  });

  it('4. click Disconnect → confirm + disconnectGbp(connectionId)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    getGbpConnectionMock.mockResolvedValue(activeConnection());
    disconnectGbpMock.mockResolvedValue({ data: { ok: true } });

    render(<GbpConnectButton clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-disconnect-btn')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('gbp-disconnect-btn'));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(disconnectGbpMock).toHaveBeenCalledTimes(1));
    expect(disconnectGbpMock).toHaveBeenCalledWith('conn_1');

    confirmSpy.mockRestore();
  });

  it('5. connectGbp retourne erreur → message d\'erreur affiché (pas de redirect)', async () => {
    const { hrefSetter, restore } = mockWindowLocation();

    getGbpConnectionMock.mockResolvedValue(noConnection());
    connectGbpMock.mockResolvedValue({ error: 'oauth_init_failed' });

    render(<GbpConnectButton clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-connect-btn')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('gbp-connect-btn'));

    await waitFor(() => expect(connectGbpMock).toHaveBeenCalledTimes(1));
    // Message d'erreur visible (clé i18n ou texte raw)
    await waitFor(() =>
      expect(screen.getByText(/oauth_init_failed|gbp\.error/)).toBeInTheDocument(),
    );
    // Pas de redirect
    expect(hrefSetter).not.toHaveBeenCalled();

    restore();
  });
});
