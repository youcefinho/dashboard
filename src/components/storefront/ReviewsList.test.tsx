// @vitest-environment jsdom
// ── ReviewsList + ReviewSubmitForm — Sprint 40 (Agent B2) — tests ────────────
// Pattern calque de calls/OutboundDialer.test.tsx :
//   - vi.mock du module relatif `../../lib/api` + `../../lib/i18n` (t identity)
//   - ToastProvider wrapper requis (ReviewSubmitForm utilise useToast)
//   - Imports APRÈS les mocks
//
// Cas couverts :
//   <ReviewsList />
//     1. Render avec 3 reviews mock → 3 cards visibles
//     2. Click "Utile" → voteReviewHelpful appelé + count refresh
//     3. Empty state quand reviews=[]
//   <ReviewSubmitForm />
//     4. Render → form visible (rating + body + email + submit)
//     5. Submit valid → submitProductReview appelé avec args + honeypot vide
//     6. Submit rating=0 → validation error (submitProductReview PAS appelé)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Mocks api ──────────────────────────────────────────────────────────────
const getProductReviewsMock = vi.fn();
const voteReviewHelpfulMock = vi.fn();
const submitProductReviewMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getProductReviews: (...args: unknown[]) => getProductReviewsMock(...args),
  voteReviewHelpful: (...args: unknown[]) => voteReviewHelpfulMock(...args),
  submitProductReview: (...args: unknown[]) => submitProductReviewMock(...args),
}));

vi.mock('../../lib/i18n', () => ({
  t: (key: string, vars?: Record<string, string | number>) => {
    if (!vars) return key;
    let out = key;
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
    return out;
  },
  getLocale: () => 'fr-CA',
}));

// Imports APRÈS les mocks
import { ReviewsList } from './ReviewsList';
import { ReviewSubmitForm } from './ReviewSubmitForm';
import { ToastProvider } from '../ui/Toast';
import type { ProductReview } from '../../lib/types';

function withProviders(ui: ReactNode) {
  return <ToastProvider>{ui}</ToastProvider>;
}

function mockReview(over: Partial<ProductReview> = {}): ProductReview {
  return {
    id: 'rev_1',
    client_id: 'client_1',
    product_id: 'prod_1',
    customer_id: null,
    order_id: null,
    rating: 5,
    title: 'Excellent',
    body: 'Vraiment satisfait, je recommande.',
    photos: null,
    verified_buyer: true,
    status: 'approved',
    moderation_notes: null,
    helpful_count: 2,
    spam_score: 0,
    created_at: '2026-05-20T12:00:00Z',
    updated_at: '2026-05-20T12:00:00Z',
    ...over,
  };
}

describe('<ReviewsList /> — Sprint 40 (Agent B2)', () => {
  beforeEach(() => {
    getProductReviewsMock.mockReset();
    voteReviewHelpfulMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('render 3 reviews mock → 3 cards', async () => {
    const reviews: ProductReview[] = [
      mockReview({ id: 'rev_1', title: 'A', body: 'Body un body un body un' }),
      mockReview({
        id: 'rev_2',
        title: 'B',
        body: 'Body deux body deux body deux',
        verified_buyer: false,
        helpful_count: 7,
      }),
      mockReview({
        id: 'rev_3',
        title: 'C',
        body: 'Body trois body trois body trois',
        rating: 3,
        helpful_count: 0,
      }),
    ];
    getProductReviewsMock.mockResolvedValue({ data: reviews });

    render(withProviders(<ReviewsList productId="prod_1" />));

    await waitFor(() => {
      expect(getProductReviewsMock).toHaveBeenCalledWith('prod_1', {});
    });

    const cards = await screen.findAllByTestId('review-card');
    expect(cards).toHaveLength(3);
    expect(screen.getAllByTestId('review-verified-badge')).toHaveLength(2); // rev_1 + rev_3
  });

  it('click "Utile" → voteReviewHelpful appelé et count refresh', async () => {
    getProductReviewsMock.mockResolvedValue({
      data: [mockReview({ id: 'rev_helpful', helpful_count: 4 })],
    });
    voteReviewHelpfulMock.mockResolvedValue({ data: { helpful_count: 5 } });

    render(withProviders(<ReviewsList productId="prod_1" />));

    const btn = await screen.findByTestId('review-helpful-btn');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(voteReviewHelpfulMock).toHaveBeenCalledWith('rev_helpful');
    });
    await waitFor(() => {
      expect(screen.getByTestId('review-helpful-count').textContent).toBe('5');
    });
  });

  it('empty state quand 0 reviews', async () => {
    getProductReviewsMock.mockResolvedValue({ data: [] });

    render(withProviders(<ReviewsList productId="prod_empty" />));

    await waitFor(() => {
      expect(screen.getByTestId('reviews-empty')).toBeInTheDocument();
    });
  });
});

describe('<ReviewSubmitForm /> — Sprint 40 (Agent B2)', () => {
  beforeEach(() => {
    submitProductReviewMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('render → form visible avec champs rating, body, email, submit', () => {
    render(withProviders(<ReviewSubmitForm productId="prod_1" />));

    expect(screen.getByTestId('review-submit-form')).toBeInTheDocument();
    expect(screen.getByTestId('rating-stars')).toBeInTheDocument();
    expect(screen.getByTestId('review-body')).toBeInTheDocument();
    expect(screen.getByTestId('review-email')).toBeInTheDocument();
    expect(screen.getByTestId('review-submit-btn')).toBeInTheDocument();
    // Honeypot présent mais caché
    const hp = screen.getByTestId('review-honeypot') as HTMLInputElement;
    expect(hp).toBeInTheDocument();
    expect(hp.value).toBe('');
  });

  it('submit valid → submitProductReview appelé avec args + honeypot vide', async () => {
    submitProductReviewMock.mockResolvedValue({ data: { id: 'rev_new', status: 'pending' } });
    const onSubmitted = vi.fn();

    render(withProviders(<ReviewSubmitForm productId="prod_1" onSubmitted={onSubmitted} />));

    // Click 5e étoile → rating = 5
    fireEvent.click(screen.getByTestId('rating-star-5'));

    fireEvent.change(screen.getByTestId('review-body'), {
      target: { value: 'Vraiment satisfait du service, je recommande.' },
    });
    fireEvent.change(screen.getByTestId('review-email'), {
      target: { value: 'client@example.com' },
    });
    fireEvent.change(screen.getByTestId('review-name'), {
      target: { value: 'Claudine' },
    });

    fireEvent.submit(screen.getByTestId('review-submit-form'));

    await waitFor(() => {
      expect(submitProductReviewMock).toHaveBeenCalledTimes(1);
    });

    const call = submitProductReviewMock.mock.calls[0] ?? [];
    const [productId, input] = call as [string, Record<string, unknown>];
    expect(productId).toBe('prod_1');
    expect(input).toMatchObject({
      rating: 5,
      body: 'Vraiment satisfait du service, je recommande.',
      email: 'client@example.com',
      name: 'Claudine',
      website_url: '', // honeypot vide
    });

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
  });

  it('submit rating=0 → validation error (submitProductReview PAS appelé)', async () => {
    render(withProviders(<ReviewSubmitForm productId="prod_1" />));

    fireEvent.change(screen.getByTestId('review-body'), {
      target: { value: 'Texte assez long pour passer la validation min.' },
    });
    fireEvent.change(screen.getByTestId('review-email'), {
      target: { value: 'client@example.com' },
    });

    fireEvent.submit(screen.getByTestId('review-submit-form'));

    await waitFor(() => {
      expect(screen.getByTestId('review-error')).toBeInTheDocument();
    });
    expect(submitProductReviewMock).not.toHaveBeenCalled();
  });
});
