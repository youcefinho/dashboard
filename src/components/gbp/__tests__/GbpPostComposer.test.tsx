// @vitest-environment jsdom
// ── Sprint 32 — GBP : tests <GbpPostComposer /> (Manager-C4) ───────────────
//
// Couvre :
//   1. Render → listGbpLocations() fetched + location default pré-sélectionnée
//      dans le <select>.
//   2. Pas de locations → message empty `gbp.locations.empty` affiché.
//   3. Submit valide (locationId + summary) → createGbpPost appelé avec body
//      correct {locationId, summary, topicType}.
//   4. createGbpPost retourne erreur → message d'erreur affiché (form non reset).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react';

// ── Mock i18n : retourne la clé telle quelle ───────────────────────────────
vi.mock('@/lib/i18n', () => ({
  t: (k: string) => k,
}));

// ── Mock API ───────────────────────────────────────────────────────────────
const listGbpLocationsMock = vi.fn();
const createGbpPostMock = vi.fn();

vi.mock('@/lib/api', () => ({
  listGbpLocations: (...args: unknown[]) => listGbpLocationsMock(...args),
  createGbpPost: (...args: unknown[]) => createGbpPostMock(...args),
}));

// Imports APRÈS les mocks
import { GbpPostComposer } from '../GbpPostComposer';

// ── Fixtures ───────────────────────────────────────────────────────────────

function emptyLocations() {
  return { data: { locations: [] } };
}

function twoLocationsWithDefault() {
  return {
    data: {
      locations: [
        {
          id: 'loc_1',
          gbpLocationId: 'locations/111',
          locationTitle: 'Intralys Montréal',
          primaryPhone: '+15145551234',
          primaryCategory: 'Marketing Agency',
          storeCode: 'MTL-01',
          isDefault: false,
        },
        {
          id: 'loc_2',
          gbpLocationId: 'locations/222',
          locationTitle: 'Intralys Québec',
          primaryPhone: '+14185551234',
          primaryCategory: 'Marketing Agency',
          storeCode: 'QC-01',
          isDefault: true,
        },
      ],
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<GbpPostComposer /> — Sprint 32', () => {
  beforeEach(() => {
    listGbpLocationsMock.mockReset();
    createGbpPostMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. render → fetch locations + select default pré-rempli', async () => {
    listGbpLocationsMock.mockResolvedValue(twoLocationsWithDefault());
    render(<GbpPostComposer clientId="client_1" />);

    await waitFor(() => expect(listGbpLocationsMock).toHaveBeenCalledTimes(1));

    // Select rendu après fetch
    await waitFor(() =>
      expect(screen.getByTestId('gbp-post-location-select')).toBeInTheDocument(),
    );
    const select = screen.getByTestId(
      'gbp-post-location-select',
    ) as HTMLSelectElement;
    // Default = loc_2 (isDefault=true)
    expect(select.value).toBe('loc_2');
  });

  it('2. pas de locations → message empty affiché', async () => {
    listGbpLocationsMock.mockResolvedValue(emptyLocations());
    render(<GbpPostComposer clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByText('gbp.locations.empty')).toBeInTheDocument(),
    );
    // Pas de form rendu
    expect(screen.queryByTestId('gbp-post-submit-btn')).not.toBeInTheDocument();
  });

  it('3. submit valide → createGbpPost appelé avec body correct', async () => {
    listGbpLocationsMock.mockResolvedValue(twoLocationsWithDefault());
    createGbpPostMock.mockResolvedValue({ data: { id: 'post_1' } });

    render(<GbpPostComposer clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-post-summary-input')).toBeInTheDocument(),
    );

    // Saisir summary
    const summary = screen.getByTestId('gbp-post-summary-input');
    fireEvent.change(summary, {
      target: { value: 'Promo printemps — 20% sur les forfaits SEO local !' },
    });

    // Submit
    fireEvent.click(screen.getByTestId('gbp-post-submit-btn'));

    await waitFor(() => expect(createGbpPostMock).toHaveBeenCalledTimes(1));
    const callArg = createGbpPostMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg).toMatchObject({
      locationId: 'loc_2',
      summary: 'Promo printemps — 20% sur les forfaits SEO local !',
      topicType: 'STANDARD',
    });
  });

  it('4. error API → message d\'erreur affiché (form non reset)', async () => {
    listGbpLocationsMock.mockResolvedValue(twoLocationsWithDefault());
    createGbpPostMock.mockResolvedValue({ error: 'gbp_api_unavailable' });

    render(<GbpPostComposer clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-post-summary-input')).toBeInTheDocument(),
    );

    const summary = screen.getByTestId(
      'gbp-post-summary-input',
    ) as HTMLTextAreaElement | HTMLInputElement;
    fireEvent.change(summary, { target: { value: 'Hello GBP' } });
    fireEvent.click(screen.getByTestId('gbp-post-submit-btn'));

    await waitFor(() => expect(createGbpPostMock).toHaveBeenCalledTimes(1));

    // Message d'erreur visible (clé i18n ou texte raw)
    await waitFor(() =>
      expect(
        screen.getByText(/gbp_api_unavailable|gbp\.error/),
      ).toBeInTheDocument(),
    );

    // Form non reset → summary conserve sa valeur (anti-perte de données utilisateur)
    expect(summary.value).toBe('Hello GBP');
  });
});
