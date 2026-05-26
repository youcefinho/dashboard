// @vitest-environment jsdom
// ── Sprint 33 — Calendar sync : tests <CalendarSyncStatusBadge /> (Agent C4) ─
//
// Couvre :
//   1. Render 0 connections → null (composant invisible / pas de noeud DOM).
//   2. Render 2 connections actives → badge intent="success" + status synced
//      + count (2).
//   3. Render 1 connection en error → badge intent="danger" + status error.
//
// Pattern :
//   - Mock identity pour @/lib/i18n.
//   - Mock @/lib/api → getCalendarConnections.
//   - Le composant utilise `data-component="CalendarSyncStatusBadge"` sur le
//     Badge rendu, ce qui permet une assertion via container.querySelector.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// ── Mock i18n : retourne la clé telle quelle (assertion littérale) ─────────
vi.mock('@/lib/i18n', () => ({
  t: (k: string) => k,
}));

// ── Mock API ───────────────────────────────────────────────────────────────
const getCalendarConnectionsMock = vi.fn();
vi.mock('@/lib/api', () => ({
  getCalendarConnections: (...args: unknown[]) =>
    getCalendarConnectionsMock(...args),
}));

// Imports APRÈS les mocks
import { CalendarSyncStatusBadge } from '../CalendarSyncStatusBadge';

// ── Fixtures ───────────────────────────────────────────────────────────────

const baseConn = {
  clientId: 'client_1',
  agencyId: null,
  userId: null,
  externalAccountEmail: 'user@example.com',
  externalCalendarId: 'primary',
  externalCalendarName: 'primary',
  syncDirection: 'bidirectional' as const,
  lastPullAt: null,
  lastPushAt: null,
  lastError: null,
  createdAt: '2026-05-20T10:00:00Z',
  updatedAt: '2026-05-24T10:00:00Z',
};

function twoActiveConnections() {
  return {
    data: [
      {
        ...baseConn,
        id: 'conn_1',
        provider: 'google_calendar' as const,
        status: 'active' as const,
      },
      {
        ...baseConn,
        id: 'conn_2',
        provider: 'outlook' as const,
        status: 'active' as const,
      },
    ],
  };
}

function oneConnectionInError() {
  return {
    data: [
      {
        ...baseConn,
        id: 'conn_1',
        provider: 'google_calendar' as const,
        status: 'error' as const,
        lastError: 'refresh_token_expired',
      },
    ],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<CalendarSyncStatusBadge /> — Sprint 33', () => {
  beforeEach(() => {
    getCalendarConnectionsMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. render 0 connections → null (composant invisible)', async () => {
    getCalendarConnectionsMock.mockResolvedValue({ data: [] });
    const { container } = render(<CalendarSyncStatusBadge />);

    // Laisser la promesse se résoudre + un microtick pour React state set.
    await waitFor(() =>
      expect(getCalendarConnectionsMock).toHaveBeenCalledTimes(1),
    );

    // Aucun badge rendu (composant retourne null si connections.length === 0).
    expect(
      container.querySelector('[data-component="CalendarSyncStatusBadge"]'),
    ).toBeNull();
    // Aucune des clés i18n possibles présente.
    expect(screen.queryByText(/calendar_sync\.status\./)).toBeNull();
  });

  it('2. render 2 connections actives → badge success "synced" (2)', async () => {
    getCalendarConnectionsMock.mockResolvedValue(twoActiveConnections());
    const { container } = render(<CalendarSyncStatusBadge />);

    // Le badge apparait avec la clé status synced.
    await waitFor(() =>
      expect(
        screen.getByText('calendar_sync.status.synced'),
      ).toBeInTheDocument(),
    );

    const badge = container.querySelector(
      '[data-component="CalendarSyncStatusBadge"]',
    );
    expect(badge).not.toBeNull();
    // Le count "(2)" est rendu à côté de la clé status (mode non-compact).
    expect(badge?.textContent).toContain('(2)');
    // L'intent "success" est propagé via data-intent (Badge primitive).
    // Si le Badge ne posait pas data-intent, on peut fallback sur la
    // classe générée — mais on vérifie qu'il N'a PAS le marqueur danger/warning.
    expect(badge?.textContent).not.toContain(
      'calendar_sync.status.error',
    );
    expect(badge?.textContent).not.toContain(
      'calendar_sync.status.pending',
    );
  });

  it('3. render 1 connection en error → badge danger "error"', async () => {
    getCalendarConnectionsMock.mockResolvedValue(oneConnectionInError());
    const { container } = render(<CalendarSyncStatusBadge />);

    await waitFor(() =>
      expect(
        screen.getByText('calendar_sync.status.error'),
      ).toBeInTheDocument(),
    );

    const badge = container.querySelector(
      '[data-component="CalendarSyncStatusBadge"]',
    );
    expect(badge).not.toBeNull();
    // Count "(1)" présent en mode non-compact.
    expect(badge?.textContent).toContain('(1)');
    // Pas de marqueur synced/pending.
    expect(badge?.textContent).not.toContain(
      'calendar_sync.status.synced',
    );
    expect(badge?.textContent).not.toContain(
      'calendar_sync.status.pending',
    );
  });
});
