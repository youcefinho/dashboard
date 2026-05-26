// @vitest-environment jsdom
// ── Sprint 32 — GBP : tests <GbpReviewsTab /> (Manager-C4) ─────────────────
//
// Couvre :
//   1. Render initial → GbpLocationsList visible (pas de location sélectionnée
//      par défaut → encore en mode picker).
//   2. Sélectionner location → getGbpReviewsList(locationId) appelé.
//   3. Reviews vide → EmptyState `gbp.reviews.empty` rendu.
//   4. Click "Sync now" → syncGbpReviews(locationId) appelé.
//   5. Submit reply sur une review → replyGbpReview(reviewId, replyText) appelé.

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
const getGbpReviewsListMock = vi.fn();
const syncGbpReviewsMock = vi.fn();
const replyGbpReviewMock = vi.fn();
const setDefaultGbpLocationMock = vi.fn();

vi.mock('@/lib/api', () => ({
  listGbpLocations: (...args: unknown[]) => listGbpLocationsMock(...args),
  getGbpReviewsList: (...args: unknown[]) => getGbpReviewsListMock(...args),
  syncGbpReviews: (...args: unknown[]) => syncGbpReviewsMock(...args),
  replyGbpReview: (...args: unknown[]) => replyGbpReviewMock(...args),
  setDefaultGbpLocation: (...args: unknown[]) => setDefaultGbpLocationMock(...args),
}));

// Imports APRÈS les mocks
import { GbpReviewsTab } from '../GbpReviewsTab';

// ── Fixtures ───────────────────────────────────────────────────────────────

function oneLocation() {
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
      ],
    },
  };
}

function emptyReviews() {
  return { data: { reviews: [], average_rating: 0, total_count: 0 } };
}

function reviewsWithOne() {
  return {
    data: {
      reviews: [
        {
          id: 'rev_1',
          gbpReviewName: 'accounts/x/locations/y/reviews/abc',
          reviewer: 'Marie L.',
          rating: 5,
          comment: 'Service impeccable.',
          replyStatus: 'none',
          createdAt: '2026-05-20T10:00:00Z',
        },
      ],
      average_rating: 5,
      total_count: 1,
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<GbpReviewsTab /> — Sprint 32', () => {
  beforeEach(() => {
    listGbpLocationsMock.mockReset();
    getGbpReviewsListMock.mockReset();
    syncGbpReviewsMock.mockReset();
    replyGbpReviewMock.mockReset();
    setDefaultGbpLocationMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. render initial → GbpLocationsList visible (pas de location sélectionnée)', async () => {
    listGbpLocationsMock.mockResolvedValue(oneLocation());
    render(<GbpReviewsTab clientId="client_1" />);

    // La liste des locations est rendue → row visible
    await waitFor(() =>
      expect(screen.getByTestId('gbp-location-row-loc_1')).toBeInTheDocument(),
    );

    // Pas de panel reviews encore (aucune sélection)
    expect(screen.queryByTestId('gbp-reviews-panel')).not.toBeInTheDocument();
    expect(getGbpReviewsListMock).not.toHaveBeenCalled();
  });

  it('2. sélectionner une location → reviews fetched', async () => {
    listGbpLocationsMock.mockResolvedValue(oneLocation());
    getGbpReviewsListMock.mockResolvedValue(reviewsWithOne());

    render(<GbpReviewsTab clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-location-row-loc_1')).toBeInTheDocument(),
    );

    // Sélection via data-testid de la ligne de location
    fireEvent.click(screen.getByTestId('gbp-location-select-loc_1'));

    await waitFor(() => expect(getGbpReviewsListMock).toHaveBeenCalledTimes(1));
    expect(getGbpReviewsListMock).toHaveBeenCalledWith('loc_1');
  });

  it('3. reviews vide → EmptyState gbp.reviews.empty', async () => {
    listGbpLocationsMock.mockResolvedValue(oneLocation());
    getGbpReviewsListMock.mockResolvedValue(emptyReviews());

    render(<GbpReviewsTab clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-location-row-loc_1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('gbp-location-select-loc_1'));

    await waitFor(() =>
      expect(screen.getByText('gbp.reviews.empty')).toBeInTheDocument(),
    );
  });

  it('4. click "Sync now" → syncGbpReviews(locationId) appelé', async () => {
    listGbpLocationsMock.mockResolvedValue(oneLocation());
    getGbpReviewsListMock.mockResolvedValue(reviewsWithOne());
    syncGbpReviewsMock.mockResolvedValue({ data: { ok: true, synced: 1 } });

    render(<GbpReviewsTab clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-location-row-loc_1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('gbp-location-select-loc_1'));

    await waitFor(() =>
      expect(screen.getByTestId('gbp-reviews-sync-btn')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('gbp-reviews-sync-btn'));

    await waitFor(() => expect(syncGbpReviewsMock).toHaveBeenCalledTimes(1));
    expect(syncGbpReviewsMock).toHaveBeenCalledWith('loc_1');
  });

  it('5. submit reply sur une review → replyGbpReview appelé', async () => {
    listGbpLocationsMock.mockResolvedValue(oneLocation());
    getGbpReviewsListMock.mockResolvedValue(reviewsWithOne());
    replyGbpReviewMock.mockResolvedValue({ data: { ok: true } });

    render(<GbpReviewsTab clientId="client_1" />);

    await waitFor(() =>
      expect(screen.getByTestId('gbp-location-row-loc_1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('gbp-location-select-loc_1'));

    await waitFor(() =>
      expect(screen.getByTestId('gbp-review-reply-input-rev_1')).toBeInTheDocument(),
    );

    // Saisir un texte de réponse
    const replyInput = screen.getByTestId('gbp-review-reply-input-rev_1');
    fireEvent.change(replyInput, { target: { value: 'Merci Marie !' } });

    // Submit
    fireEvent.click(screen.getByTestId('gbp-review-reply-submit-rev_1'));

    await waitFor(() => expect(replyGbpReviewMock).toHaveBeenCalledTimes(1));
    expect(replyGbpReviewMock).toHaveBeenCalledWith('rev_1', 'Merci Marie !');
  });
});
