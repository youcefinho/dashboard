// @vitest-environment jsdom
// ── Sprint 33 — Calendar sync : tests <CalendarConflictResolver /> (Agent C4) ─
//
// Couvre :
//   1. Render closed (open=false) → null (composant retourne null avant Modal).
//   2. Render open → fetch conflicts + 2 cartes Intralys vs External rendues
//      avec les bons titres + summaries.
//   3. Click "Garder Intralys" → resolveCalendarConflict(syncId, 'keep_intralys').
//   4. Click "Garder External" → resolveCalendarConflict(syncId, 'keep_external').
//
// Note : le composant utilise Modal (Radix Dialog wrapper). Quand open=true,
// le contenu est porté dans un Portal (document.body), donc on utilise
// screen.findByText plutôt que container.querySelector pour les assertions.

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
const getCalendarConflictsMock = vi.fn();
const resolveCalendarConflictMock = vi.fn();

vi.mock('@/lib/api', () => ({
  getCalendarConflicts: (...args: unknown[]) =>
    getCalendarConflictsMock(...args),
  resolveCalendarConflict: (...args: unknown[]) =>
    resolveCalendarConflictMock(...args),
}));

// Imports APRÈS les mocks
import { CalendarConflictResolver } from '../CalendarConflictResolver';

// ── Fixtures ───────────────────────────────────────────────────────────────

function oneGcalConflict() {
  return {
    data: [
      {
        syncId: 'sync_1',
        appointmentId: 'appt_1',
        externalEventId: 'gcal_evt_1',
        provider: 'google_calendar' as const,
        intralysUpdatedAt: '2026-05-24T10:00:00Z',
        externalUpdatedAt: '2026-05-24T10:05:00Z',
        intralysSummary: 'RDV Maya — déjeuner Intralys',
        externalSummary: 'RDV Maya — Brunch (Google)',
      },
    ],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<CalendarConflictResolver /> — Sprint 33', () => {
  beforeEach(() => {
    getCalendarConflictsMock.mockReset();
    resolveCalendarConflictMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. render closed (open=false) → null', () => {
    const onClose = vi.fn();
    const { container } = render(
      <CalendarConflictResolver
        conflictId="sync_1"
        open={false}
        onClose={onClose}
      />,
    );

    // Composant return null si open=false → pas de DOM root.
    expect(
      container.querySelector('[data-component="CalendarConflictResolver"]'),
    ).toBeNull();
    // Aucun fetch déclenché.
    expect(getCalendarConflictsMock).not.toHaveBeenCalled();
  });

  it('2. render open → fetch conflicts + 2 cartes (Intralys vs External)', async () => {
    getCalendarConflictsMock.mockResolvedValue(oneGcalConflict());

    render(
      <CalendarConflictResolver
        conflictId="sync_1"
        open={true}
        onClose={() => {}}
      />,
    );

    // Fetch déclenché au mount (open=true + conflictId présent).
    await waitFor(() =>
      expect(getCalendarConflictsMock).toHaveBeenCalledTimes(1),
    );

    // Les 2 cartes rendues : Intralys + Google (provider google_calendar).
    await waitFor(() =>
      expect(screen.getByText('Version Intralys')).toBeInTheDocument(),
    );
    expect(screen.getByText('Version Google')).toBeInTheDocument();

    // Summaries littérales rendues.
    expect(
      screen.getByText('RDV Maya — déjeuner Intralys'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('RDV Maya — Brunch (Google)'),
    ).toBeInTheDocument();

    // Boutons d'action (clés i18n).
    expect(
      screen.getByText('calendar_sync.conflict.keep_intralys'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('calendar_sync.conflict.keep_external'),
    ).toBeInTheDocument();
  });

  it('3. click "Garder Intralys" → resolveCalendarConflict(syncId, keep_intralys)', async () => {
    const onClose = vi.fn();
    const onResolved = vi.fn();

    getCalendarConflictsMock.mockResolvedValue(oneGcalConflict());
    resolveCalendarConflictMock.mockResolvedValue({ data: { ok: true } });

    render(
      <CalendarConflictResolver
        conflictId="sync_1"
        open={true}
        onClose={onClose}
        onResolved={onResolved}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText('calendar_sync.conflict.keep_intralys'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByText('calendar_sync.conflict.keep_intralys'),
    );

    await waitFor(() =>
      expect(resolveCalendarConflictMock).toHaveBeenCalledTimes(1),
    );
    expect(resolveCalendarConflictMock).toHaveBeenCalledWith(
      'sync_1',
      'keep_intralys',
    );

    // Callbacks invoqués post-résolution.
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('4. click "Garder External" → resolveCalendarConflict(syncId, keep_external)', async () => {
    const onClose = vi.fn();

    getCalendarConflictsMock.mockResolvedValue(oneGcalConflict());
    resolveCalendarConflictMock.mockResolvedValue({ data: { ok: true } });

    render(
      <CalendarConflictResolver
        conflictId="sync_1"
        open={true}
        onClose={onClose}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText('calendar_sync.conflict.keep_external'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByText('calendar_sync.conflict.keep_external'),
    );

    await waitFor(() =>
      expect(resolveCalendarConflictMock).toHaveBeenCalledTimes(1),
    );
    expect(resolveCalendarConflictMock).toHaveBeenCalledWith(
      'sync_1',
      'keep_external',
    );

    // onClose appelé même sans onResolved fourni.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
