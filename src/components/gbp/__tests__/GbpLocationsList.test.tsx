// @vitest-environment jsdom
// ── Sprint 32 — GBP : tests <GbpLocationsList /> (Manager-C4) ──────────────
//
// Couvre :
//   1. Liste vide → EmptyState `gbp.locations.empty` rendu.
//   2. 2 locations → 2 rows rendues avec locationTitle + primaryCategory.
//   3. Location isDefault=true → badge "default" visible sur cette ligne.
//   4. Click "set default" → setDefaultGbpLocation(locationId) appelé.

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
const setDefaultGbpLocationMock = vi.fn();

vi.mock('@/lib/api', () => ({
  listGbpLocations: (...args: unknown[]) => listGbpLocationsMock(...args),
  setDefaultGbpLocation: (...args: unknown[]) => setDefaultGbpLocationMock(...args),
}));

// Imports APRÈS les mocks
import { GbpLocationsList } from '../GbpLocationsList';

// ── Fixtures ───────────────────────────────────────────────────────────────

function emptyLocations() {
  return { data: { locations: [] } };
}

function twoLocations() {
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
          isDefault: true,
        },
        {
          id: 'loc_2',
          gbpLocationId: 'locations/222',
          locationTitle: 'Intralys Québec',
          primaryPhone: '+14185551234',
          primaryCategory: 'Marketing Agency',
          storeCode: 'QC-01',
          isDefault: false,
        },
      ],
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<GbpLocationsList /> — Sprint 32', () => {
  beforeEach(() => {
    listGbpLocationsMock.mockReset();
    setDefaultGbpLocationMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. liste vide → EmptyState gbp.locations.empty', async () => {
    listGbpLocationsMock.mockResolvedValue(emptyLocations());
    render(<GbpLocationsList clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByText('gbp.locations.empty')).toBeInTheDocument(),
    );
    // Pas de rows rendues
    expect(screen.queryByTestId('gbp-location-row-loc_1')).not.toBeInTheDocument();
  });

  it('2. 2 locations → 2 rows rendues avec titre + catégorie', async () => {
    listGbpLocationsMock.mockResolvedValue(twoLocations());
    render(<GbpLocationsList clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-location-row-loc_1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('gbp-location-row-loc_2')).toBeInTheDocument();

    // Titres rendus
    expect(screen.getByText('Intralys Montréal')).toBeInTheDocument();
    expect(screen.getByText('Intralys Québec')).toBeInTheDocument();

    // Catégorie rendue au moins 1x (peut apparaître 2x — même valeur)
    expect(screen.getAllByText('Marketing Agency').length).toBeGreaterThanOrEqual(2);
  });

  it('3. Default badge sur location.isDefault=true', async () => {
    listGbpLocationsMock.mockResolvedValue(twoLocations());
    render(<GbpLocationsList clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-location-row-loc_1')).toBeInTheDocument(),
    );

    const defaultRow = screen.getByTestId('gbp-location-row-loc_1');
    const otherRow = screen.getByTestId('gbp-location-row-loc_2');

    // Le badge "default" est sur loc_1 (isDefault=true), pas sur loc_2
    expect(defaultRow).toHaveTextContent('gbp.locations.default');
    expect(otherRow).not.toHaveTextContent('gbp.locations.default');
  });

  it('4. click "set default" sur location non-default → setDefaultGbpLocation appelé', async () => {
    listGbpLocationsMock.mockResolvedValue(twoLocations());
    setDefaultGbpLocationMock.mockResolvedValue({ data: { ok: true } });

    render(<GbpLocationsList clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-location-row-loc_2')).toBeInTheDocument(),
    );

    // Bouton "set default" exposé via data-testid sur la ligne non-default
    const setDefaultBtn = screen.getByTestId('gbp-location-set-default-loc_2');
    fireEvent.click(setDefaultBtn);

    await waitFor(() =>
      expect(setDefaultGbpLocationMock).toHaveBeenCalledTimes(1),
    );
    expect(setDefaultGbpLocationMock).toHaveBeenCalledWith('loc_2');
  });
});
