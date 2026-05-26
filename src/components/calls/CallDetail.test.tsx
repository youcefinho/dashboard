// @vitest-environment jsdom
// ── CallDetail — Sprint 34 (Agent B4) tests ─────────────────────────────────
// Contrat :
//   1. Mock callLog complet → rend les 3 sections (header / recording /
//      transcription) avec from→to, status badge, duration formatée mm:ss.
//   2. Sans recording_r2_key → "Aucun enregistrement disponible" + pas de
//      <CallRecordingPlayer />.
//   3. transcription_status='pending' → badge intent warning (bg warning-soft).
//   4. transcription_status='failed' → badge intent danger (bg danger-soft).
//   5. Duration 90s → "01:30".
//   6. Direction badge couleur : inbound→success / outbound→info / missed→danger.
//
// Pattern repris des autres test/__tests__ : vi.mock du player (évite fetch),
// render direct du composant, asserts via screen + within. testing-library/jest-dom
// pour matcher toHaveClass / toBeInTheDocument.

import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

import { CallDetail } from './CallDetail';
import type { CallLog } from '../../lib/api';

// ── Mock CallRecordingPlayer (évite fetch signedUrl R2) ────────────────────
vi.mock('./CallRecordingPlayer', () => ({
  CallRecordingPlayer: ({ callLogId }: { callLogId: string }) => (
    <div data-testid="mock-recording-player">player-{callLogId}</div>
  ),
}));

// ── Fixture base ────────────────────────────────────────────────────────────
function makeCallLog(overrides: Partial<CallLog> = {}): CallLog {
  return {
    id: 'cl_test_001',
    client_id: 'cli_001',
    agency_id: 'ag_001',
    lead_id: null,
    conversation_id: null,
    direction: 'inbound',
    from_number: '+15145551234',
    to_number: '+14185557890',
    status: 'completed',
    duration_sec: 90,
    recording_url: null,
    transcription: 'Bonjour, j’aimerais avoir plus d’information.',
    twilio_sid: 'CAxxx',
    created_at: '2026-05-24T14:30:00.000Z',
    disposition: 'qualified',
    notes: 'Lead chaud — rappeler demain matin.',
    recording_sid: 'REC_001',
    recording_duration_sec: 85,
    recording_r2_key: 'recordings/2026-05/cl_test_001.mp3',
    transcription_status: 'done',
    transcription_lang: 'fr',
    recording_consent_obtained_at: '2026-05-24T14:29:55.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CallDetail', () => {
  it('1. rend les 3 sections avec callLog complet', () => {
    const callLog = makeCallLog();
    render(<CallDetail callLog={callLog} />);

    // Header présent + from/to/status/duration/disposition/notes
    expect(screen.getByTestId('call-detail-header')).toBeInTheDocument();
    expect(screen.getByTestId('call-detail-from')).toHaveTextContent('+15145551234');
    expect(screen.getByTestId('call-detail-to')).toHaveTextContent('+14185557890');
    expect(screen.getByTestId('call-detail-status')).toHaveTextContent('completed');
    expect(screen.getByTestId('call-detail-duration')).toHaveTextContent('01:30');
    expect(screen.getByTestId('call-detail-disposition')).toHaveTextContent('qualified');
    expect(screen.getByTestId('call-detail-notes')).toHaveTextContent('Lead chaud');

    // Recording section : player monté + durée + consent badge
    expect(screen.getByTestId('call-detail-recording-section')).toBeInTheDocument();
    expect(screen.getByTestId('mock-recording-player')).toHaveTextContent('player-cl_test_001');
    expect(screen.getByTestId('call-detail-recording-duration')).toHaveTextContent('01:25');
    expect(screen.getByTestId('call-detail-consent-badge')).toHaveTextContent('Consentement obtenu');

    // Transcription section : texte + badge done + lang
    expect(screen.getByTestId('call-detail-transcription-section')).toBeInTheDocument();
    expect(screen.getByTestId('call-detail-transcription-text')).toHaveTextContent(
      'Bonjour, j’aimerais avoir plus d’information.',
    );
    expect(screen.getByTestId('call-detail-transcription-status')).toBeInTheDocument();
    expect(screen.getByTestId('call-detail-transcription-lang')).toHaveTextContent('fr');
  });

  it('2. sans recording_r2_key → "Aucun enregistrement disponible"', () => {
    const callLog = makeCallLog({
      recording_r2_key: null,
      recording_duration_sec: null,
      recording_consent_obtained_at: null,
    });
    render(<CallDetail callLog={callLog} />);

    expect(screen.getByTestId('call-detail-no-recording')).toHaveTextContent(
      'Aucun enregistrement disponible',
    );
    expect(screen.queryByTestId('mock-recording-player')).not.toBeInTheDocument();
    expect(screen.queryByTestId('call-detail-consent-badge')).not.toBeInTheDocument();
  });

  it('3. transcription_status=pending → badge intent warning', () => {
    const callLog = makeCallLog({
      transcription_status: 'pending',
      transcription: null,
    });
    render(<CallDetail callLog={callLog} />);

    const badge = screen.getByTestId('call-detail-transcription-status');
    expect(badge).toBeInTheDocument();
    // Intent warning → classe text-warning-text + bg-warning-soft (Badge.tsx soft mapping)
    expect(badge.className).toMatch(/warning-soft/);
    // Aucun texte de transcription rendu si status != done
    expect(screen.queryByTestId('call-detail-transcription-text')).not.toBeInTheDocument();
  });

  it('4. transcription_status=failed → badge intent danger', () => {
    const callLog = makeCallLog({
      transcription_status: 'failed',
      transcription: null,
    });
    render(<CallDetail callLog={callLog} />);

    const badge = screen.getByTestId('call-detail-transcription-status');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/danger-soft/);
    expect(screen.queryByTestId('call-detail-transcription-text')).not.toBeInTheDocument();
  });

  it('5. format duration 90s → "01:30"', () => {
    const callLog = makeCallLog({ duration_sec: 90 });
    render(<CallDetail callLog={callLog} />);
    expect(screen.getByTestId('call-detail-duration')).toHaveTextContent('01:30');
  });

  it('5b. format duration edge cases (0 → "00:00", 3661 → "61:01", null → "—")', () => {
    const { rerender } = render(<CallDetail callLog={makeCallLog({ duration_sec: 0 })} />);
    expect(screen.getByTestId('call-detail-duration')).toHaveTextContent('00:00');

    rerender(<CallDetail callLog={makeCallLog({ duration_sec: 3661 })} />);
    expect(screen.getByTestId('call-detail-duration')).toHaveTextContent('61:01');

    // duration_sec est number (non-null par contract) ; on teste recording_duration_sec null
    rerender(
      <CallDetail
        callLog={makeCallLog({ recording_duration_sec: null, recording_r2_key: null })}
      />,
    );
    expect(screen.queryByTestId('call-detail-recording-duration')).not.toBeInTheDocument();
  });

  it('6a. direction inbound → badge intent success ("Entrant")', () => {
    const callLog = makeCallLog({ direction: 'inbound', status: 'completed' });
    render(<CallDetail callLog={callLog} />);
    const badge = screen.getByTestId('call-detail-direction');
    expect(badge).toHaveTextContent('Entrant');
    expect(badge.className).toMatch(/success-soft/);
  });

  it('6b. direction outbound → badge intent info ("Sortant")', () => {
    const callLog = makeCallLog({ direction: 'outbound', status: 'completed' });
    render(<CallDetail callLog={callLog} />);
    const badge = screen.getByTestId('call-detail-direction');
    expect(badge).toHaveTextContent('Sortant');
    expect(badge.className).toMatch(/info-soft/);
  });

  it('6c. direction inbound + status no-answer → badge intent danger ("Manqué")', () => {
    const callLog = makeCallLog({ direction: 'inbound', status: 'no-answer' });
    render(<CallDetail callLog={callLog} />);
    const badge = screen.getByTestId('call-detail-direction');
    expect(badge).toHaveTextContent('Manqué');
    expect(badge.className).toMatch(/danger-soft/);
  });

  it('7. omits disposition + notes quand absents', () => {
    const callLog = makeCallLog({ disposition: null, notes: null });
    render(<CallDetail callLog={callLog} />);
    expect(screen.queryByTestId('call-detail-disposition')).not.toBeInTheDocument();
    expect(screen.queryByTestId('call-detail-notes')).not.toBeInTheDocument();
  });

  it('8. transcription_status=done sans texte → pas de bloc texte affiché', () => {
    const callLog = makeCallLog({ transcription_status: 'done', transcription: null });
    render(<CallDetail callLog={callLog} />);
    // Status badge OK
    expect(screen.getByTestId('call-detail-transcription-status')).toBeInTheDocument();
    // Mais pas de paragraphe (transcription === null)
    expect(screen.queryByTestId('call-detail-transcription-text')).not.toBeInTheDocument();
  });

  it('9. from→to séparateur fléché présent et aria-hidden', () => {
    const callLog = makeCallLog();
    const { container } = render(<CallDetail callLog={callLog} />);
    // L'élément aria-hidden contient la flèche
    const arrows = within(container).getAllByText('→');
    expect(arrows.length).toBeGreaterThanOrEqual(1);
    expect(arrows[0]).toHaveAttribute('aria-hidden', 'true');
  });
});
