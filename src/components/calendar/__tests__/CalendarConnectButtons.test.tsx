// @vitest-environment jsdom
// ── Sprint 33 — Calendar sync : tests <CalendarConnectButtons /> (Agent C4) ─
//
// Couvre :
//   1. Render no connections → 2 boutons "Connect GCal" + "Connect Outlook".
//   2. Render avec gcal connection → "Connected as XXX" + "Disconnect" pour
//      GCal (le bouton Connect Outlook reste visible côté Outlook).
//   3. Click Connect GCal → connectGcalSync() appelé + window.location.href
//      set vers l'URL d'authorize retournée (mock via Object.defineProperty).
//   4. Click Connect Outlook → connectOutlookSync() appelé.
//   5. Click Disconnect → window.confirm + disconnectCalendarConnection(id).
//
// Pattern calqué sur GbpConnectButton.test.tsx (Sprint 32 C4) :
//   - Mock identity pour @/lib/i18n (assertions littérales sur clés).
//   - Mock @/lib/api pour TOUTES les fonctions importées par le composant
//     (sinon Vite résout l'import et casse).
//   - mockWindowLocation() helper pour intercepter href= setter.

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
const getCalendarConnectionsMock = vi.fn();
const connectGcalSyncMock = vi.fn();
const connectOutlookSyncMock = vi.fn();
const disconnectCalendarConnectionMock = vi.fn();

vi.mock('@/lib/api', () => ({
  getCalendarConnections: (...args: unknown[]) =>
    getCalendarConnectionsMock(...args),
  connectGcalSync: (...args: unknown[]) => connectGcalSyncMock(...args),
  connectOutlookSync: (...args: unknown[]) => connectOutlookSyncMock(...args),
  disconnectCalendarConnection: (...args: unknown[]) =>
    disconnectCalendarConnectionMock(...args),
}));

// Imports APRÈS les mocks
import { CalendarConnectButtons } from '../CalendarConnectButtons';

// ── Fixtures ───────────────────────────────────────────────────────────────

function noConnections() {
  return { data: [] };
}

function gcalConnection() {
  return {
    data: [
      {
        id: 'conn_gcal_1',
        clientId: 'client_1',
        agencyId: null,
        userId: null,
        provider: 'google_calendar' as const,
        externalAccountEmail: 'rochdi@intralys.dev',
        externalCalendarId: 'primary',
        externalCalendarName: 'rochdi@intralys.dev',
        syncDirection: 'bidirectional' as const,
        status: 'active' as const,
        lastPullAt: '2026-05-24T10:00:00Z',
        lastPushAt: '2026-05-24T10:00:00Z',
        lastError: null,
        createdAt: '2026-05-20T10:00:00Z',
        updatedAt: '2026-05-24T10:00:00Z',
      },
    ],
  };
}

// ── Helper : mock window.location.href (jsdom) ─────────────────────────────
function mockWindowLocation() {
  const original = window.location;
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
  return {
    hrefSetter,
    restore: () =>
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<CalendarConnectButtons /> — Sprint 33', () => {
  beforeEach(() => {
    getCalendarConnectionsMock.mockReset();
    connectGcalSyncMock.mockReset();
    connectOutlookSyncMock.mockReset();
    disconnectCalendarConnectionMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('1. render no connections → 2 boutons Connect GCal + Connect Outlook', async () => {
    getCalendarConnectionsMock.mockResolvedValue(noConnections());
    render(<CalendarConnectButtons />);

    // Les deux clés i18n des boutons doivent être affichées (mock identity).
    await waitFor(() =>
      expect(
        screen.getByText('calendar_sync.connect.gcal'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText('calendar_sync.connect.outlook'),
    ).toBeInTheDocument();

    // Les labels providers (literaux, pas via i18n) doivent être affichés.
    expect(screen.getByText('Google Calendar')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Outlook')).toBeInTheDocument();

    // Aucun bouton "Disconnect" visible.
    expect(
      screen.queryByText('calendar_sync.disconnect'),
    ).not.toBeInTheDocument();
  });

  it('2. render avec gcal connection → Connected as XXX + Disconnect pour GCal', async () => {
    getCalendarConnectionsMock.mockResolvedValue(gcalConnection());
    render(<CalendarConnectButtons />);

    // Le bouton "Disconnect" GCal apparait (clé i18n forwardée).
    await waitFor(() =>
      expect(
        screen.getByText('calendar_sync.disconnect'),
      ).toBeInTheDocument(),
    );

    // L'email de la connexion gcal est rendu (literal, pas via i18n) dans la
    // ligne "Connected as ..." (template avec {{email}} substitué côté
    // composant via .replace).
    expect(screen.getByText(/rochdi@intralys\.dev/)).toBeInTheDocument();

    // Le bouton "Connect GCal" n'est PLUS rendu (connexion active).
    expect(
      screen.queryByText('calendar_sync.connect.gcal'),
    ).not.toBeInTheDocument();

    // Mais le bouton "Connect Outlook" reste rendu (pas connecté à Outlook).
    expect(
      screen.getByText('calendar_sync.connect.outlook'),
    ).toBeInTheDocument();
  });

  it('3. click Connect GCal → connectGcalSync + window.location.href set', async () => {
    const { hrefSetter, restore } = mockWindowLocation();

    getCalendarConnectionsMock.mockResolvedValue(noConnections());
    connectGcalSyncMock.mockResolvedValue({
      data: {
        url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=calendar',
      },
    });

    render(<CalendarConnectButtons />);

    await waitFor(() =>
      expect(
        screen.getByText('calendar_sync.connect.gcal'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('calendar_sync.connect.gcal'));

    await waitFor(() =>
      expect(connectGcalSyncMock).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(hrefSetter).toHaveBeenCalledWith(
        'https://accounts.google.com/o/oauth2/v2/auth?scope=calendar',
      ),
    );
    // Pas d'appel Outlook.
    expect(connectOutlookSyncMock).not.toHaveBeenCalled();

    restore();
  });

  it('4. click Connect Outlook → connectOutlookSync appelé', async () => {
    const { hrefSetter, restore } = mockWindowLocation();

    getCalendarConnectionsMock.mockResolvedValue(noConnections());
    connectOutlookSyncMock.mockResolvedValue({
      data: {
        url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?scope=calendars.readwrite',
      },
    });

    render(<CalendarConnectButtons />);

    await waitFor(() =>
      expect(
        screen.getByText('calendar_sync.connect.outlook'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('calendar_sync.connect.outlook'));

    await waitFor(() =>
      expect(connectOutlookSyncMock).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(hrefSetter).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?scope=calendars.readwrite',
      ),
    );
    // Pas d'appel GCal.
    expect(connectGcalSyncMock).not.toHaveBeenCalled();

    restore();
  });

  it('5. click Disconnect → confirm + disconnectCalendarConnection(id)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    // Render initial avec connexion gcal active.
    getCalendarConnectionsMock.mockResolvedValueOnce(gcalConnection());
    disconnectCalendarConnectionMock.mockResolvedValue({ data: { ok: true } });
    // Reload après disconnect → plus de connexion.
    getCalendarConnectionsMock.mockResolvedValueOnce(noConnections());

    render(<CalendarConnectButtons />);

    await waitFor(() =>
      expect(
        screen.getByText('calendar_sync.disconnect'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('calendar_sync.disconnect'));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(disconnectCalendarConnectionMock).toHaveBeenCalledTimes(1),
    );
    expect(disconnectCalendarConnectionMock).toHaveBeenCalledWith(
      'conn_gcal_1',
    );

    confirmSpy.mockRestore();
  });
});
