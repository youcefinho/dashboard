// @vitest-environment jsdom
// ── VoicemailInbox.test — Sprint 34 (Agent B2) ──────────────────────────────
// Couvre :
//  1. Render 3 voicemails → liste affichée + 1er auto-sélectionné.
//  2. Click item → selected updated → détail visible (audio load button).
//  3. Toggle "Non écoutés" → re-fetch avec unread=true.
//  4. Click play audio → getCallRecordingUrl appelé → src signed url + audio rendu.
//  5. Mark listened → markVoicemailListened appelé + re-fetch.
//  6. Delete confirm → deleteVoicemail appelé + re-fetch.
//  7. Empty list → EmptyState rendu.

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

// ─ Mocks ──────────────────────────────────────────────────────
// On mocke par les MÊMES specifiers que ceux importés depuis le composant
// (chemin relatif `../../lib/api` depuis src/components/calls/).
const getVoicemailsMock = vi.fn();
const markVoicemailListenedMock = vi.fn(async () => ({
  data: { success: true, listened_at: 'now', listened_by: 'u1' },
}));
const deleteVoicemailMock = vi.fn(async () => ({ data: { success: true } }));
const getCallRecordingUrlMock = vi.fn(async () => ({
  data: {
    url: 'https://signed.example.com/rec.mp3',
    expires_at: '2099-01-01T00:00:00Z',
    duration_sec: 12,
    transcription_status: null,
  },
}));

vi.mock('../../lib/api', () => ({
  getVoicemails: (...a: unknown[]) => getVoicemailsMock(...(a as [])),
  markVoicemailListened: (...a: unknown[]) =>
    markVoicemailListenedMock(...(a as [])),
  deleteVoicemail: (...a: unknown[]) => deleteVoicemailMock(...(a as [])),
  getCallRecordingUrl: (...a: unknown[]) =>
    getCallRecordingUrlMock(...(a as [])),
}));

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
}));

// datetime : neutralise Intl.RelativeTimeFormat (renvoie label stable).
vi.mock('../../lib/i18n/datetime', () => ({
  formatRelativeTime: (_d: unknown, _l: string) => 'recently',
  formatDateTime: () => '',
  formatDate: () => '',
}));

// ConfirmDialog : court-circuite la modale, renvoie true direct.
let confirmReturn = true;
vi.mock('../ui/ConfirmDialog', () => ({
  useConfirm: () => async () => confirmReturn,
}));

// EmptyState : stub minimal pour reconnaitre via title.
vi.mock('../ui/EmptyState', () => ({
  EmptyState: ({ title, icon }: { title: string; icon?: ReactNode }) => (
    <div data-testid="emptystate-stub">
      {icon}
      <span>{title}</span>
    </div>
  ),
}));

// Import APRÈS les mocks.
import { VoicemailInbox } from './VoicemailInbox';

// ─ Fixtures ──────────────────────────────────────────────────
function vm(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'vm_1',
    client_id: 'c_1',
    agency_id: null,
    call_log_id: 'cl_1',
    lead_id: null,
    conversation_id: null,
    from_number: '+15145550100',
    to_number: '+15145550199',
    recording_url: null,
    recording_sid: null,
    recording_r2_key: 'r2/key.mp3',
    duration_sec: 42,
    transcription: 'Bonjour, je rappelle au sujet de mon dossier.',
    transcription_status: 'completed',
    transcription_lang: 'fr',
    listened_at: null,
    listened_by: null,
    deleted_at: null,
    created_at: '2026-05-24T12:00:00Z',
    audio_url: null,
    expires_at: null,
    lead_name: null,
    ...overrides,
  };
}

const THREE_VMS = [
  vm({ id: 'vm_1', from_number: '+15145550101' }),
  vm({
    id: 'vm_2',
    from_number: '+15145550102',
    listened_at: '2026-05-23T10:00:00Z',
  }),
  vm({
    id: 'vm_3',
    from_number: '+15145550103',
    transcription: null,
    call_log_id: 'cl_3',
  }),
];

beforeEach(() => {
  confirmReturn = true;
  getVoicemailsMock.mockReset();
  markVoicemailListenedMock.mockClear();
  deleteVoicemailMock.mockClear();
  getCallRecordingUrlMock.mockClear();
  // Default : 3 voicemails.
  getVoicemailsMock.mockResolvedValue({ data: THREE_VMS });
});

afterEach(() => {
  cleanup();
});

// ─ Tests ─────────────────────────────────────────────────────

describe('VoicemailInbox — Sprint 34 B2', () => {
  it('1. rend les 3 voicemails et fetch initial avec unread=false limit=50', async () => {
    render(<VoicemailInbox />);
    await waitFor(() => {
      expect(getVoicemailsMock).toHaveBeenCalledTimes(1);
    });
    expect(getVoicemailsMock).toHaveBeenCalledWith({
      unread: false,
      limit: 50,
    });

    // Les 3 items rendus
    await waitFor(() => {
      expect(screen.getByTestId('vm-item-vm_1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('vm-item-vm_2')).toBeInTheDocument();
    expect(screen.getByTestId('vm-item-vm_3')).toBeInTheDocument();
  });

  it('2. click sur un item met à jour le détail visible', async () => {
    render(<VoicemailInbox />);
    await waitFor(() => screen.getByTestId('vm-item-vm_2'));

    fireEvent.click(screen.getByTestId('vm-item-vm_2'));

    // Le bouton load audio est rendu (lazy state — pas d'audio tag tant qu'on
    // n'a pas cliqué play).
    await waitFor(() => {
      expect(screen.getByTestId('vm-audio-load')).toBeInTheDocument();
    });

    // vm_2 est déjà listened → pas de bouton "Marquer écouté".
    expect(screen.queryByTestId('vm-mark-listened')).not.toBeInTheDocument();
  });

  it('3. toggle "Non écoutés" → re-fetch avec unread=true', async () => {
    render(<VoicemailInbox />);
    await waitFor(() => expect(getVoicemailsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('vm-filter-unread'));

    await waitFor(() => expect(getVoicemailsMock).toHaveBeenCalledTimes(2));
    expect(getVoicemailsMock).toHaveBeenLastCalledWith({
      unread: true,
      limit: 50,
    });
  });

  it('4. click play audio → getCallRecordingUrl appelé → audio src = signed url', async () => {
    render(<VoicemailInbox />);
    await waitFor(() => screen.getByTestId('vm-item-vm_1'));

    // vm_1 est auto-sélectionné (1er de la liste).
    const loadBtn = await screen.findByTestId('vm-audio-load');
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(getCallRecordingUrlMock).toHaveBeenCalledWith('cl_1');
    });

    const audio = await screen.findByTestId('vm-audio');
    expect(audio).toHaveAttribute('src', 'https://signed.example.com/rec.mp3');

    // vm_1 était unread → markVoicemailListened auto-appelé au 1er play.
    await waitFor(() => {
      expect(markVoicemailListenedMock).toHaveBeenCalledWith('vm_1');
    });
  });

  it('5. bouton "Marquer écouté" → markVoicemailListened + refresh', async () => {
    render(<VoicemailInbox />);
    await waitFor(() => screen.getByTestId('vm-item-vm_1'));

    // vm_1 unread → bouton présent.
    const markBtn = await screen.findByTestId('vm-mark-listened');
    fireEvent.click(markBtn);

    await waitFor(() => {
      expect(markVoicemailListenedMock).toHaveBeenCalledWith('vm_1');
    });
    // Refresh = un getVoicemails supplémentaire.
    await waitFor(() => {
      expect(getVoicemailsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('6. delete confirmé → deleteVoicemail + refresh', async () => {
    confirmReturn = true;
    render(<VoicemailInbox />);
    await waitFor(() => screen.getByTestId('vm-item-vm_1'));

    const delBtn = await screen.findByTestId('vm-delete');
    fireEvent.click(delBtn);

    await waitFor(() => {
      expect(deleteVoicemailMock).toHaveBeenCalledWith('vm_1');
    });
    await waitFor(() => {
      expect(getVoicemailsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('6b. delete annulé → deleteVoicemail PAS appelé', async () => {
    confirmReturn = false;
    render(<VoicemailInbox />);
    await waitFor(() => screen.getByTestId('vm-item-vm_1'));

    fireEvent.click(screen.getByTestId('vm-delete'));

    // Laisse la microtask se résoudre.
    await Promise.resolve();
    await Promise.resolve();

    expect(deleteVoicemailMock).not.toHaveBeenCalled();
    // Pas de refresh non plus.
    expect(getVoicemailsMock).toHaveBeenCalledTimes(1);
  });

  it('7. liste vide → EmptyState rendu', async () => {
    getVoicemailsMock.mockResolvedValue({ data: [] });
    render(<VoicemailInbox />);

    const empty = await screen.findByTestId('vm-empty');
    expect(empty).toBeInTheDocument();
    // L'EmptyState stub contient le title brut.
    expect(
      within(empty).getByText('voice.voicemail.empty'),
    ).toBeInTheDocument();

    // Pas de liste rendue.
    expect(screen.queryByTestId('vm-list')).not.toBeInTheDocument();
  });
});
