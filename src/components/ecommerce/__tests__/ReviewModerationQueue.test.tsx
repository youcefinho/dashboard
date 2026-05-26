// @vitest-environment jsdom
// ── ReviewModerationQueue.test — Sprint 40 (Agent B1) ───────────────────────
// Couvre :
//  1. Mount → getModerationQueue() appelé + 3 reviews affichés.
//  2. Click "Approve" → moderateReview({ action: 'approve' }) appelé.
//  3. Click "Reject" → moderateReview({ action: 'reject' }) appelé.
//  4. Click "Détail" → drawer ouvre + body full rendu.
//  5. Change filter status=flagged → getModerationQueue({ status: 'flagged' }).
//  6. Liste vide → empty state visible.
//  7. Erreur réseau au mount → toast erreur.

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

// ── Mocks api ──────────────────────────────────────────────────────────────
const getModerationQueueMock = vi.fn();
const moderateReviewMock = vi.fn();
const deleteReviewMock = vi.fn();

vi.mock('../../../lib/api', () => ({
  getModerationQueue: (...a: unknown[]) =>
    getModerationQueueMock(...(a as [])),
  moderateReview: (...a: unknown[]) => moderateReviewMock(...(a as [])),
  deleteReview: (...a: unknown[]) => deleteReviewMock(...(a as [])),
}));

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

vi.mock('../../../lib/i18n/datetime', () => ({
  formatRelativeTime: (_d: unknown, _l: string) => 'il y a 2 h',
}));

// Button : stub pass-through.
vi.mock('../../ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    type,
    'aria-label': ariaLabel,
    'data-testid': dataTestId,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    type?: 'button' | 'submit' | 'reset';
    'aria-label'?: string;
    'data-testid'?: string;
  }) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      data-loading={isLoading ? 'true' : 'false'}
      aria-label={ariaLabel}
      data-testid={dataTestId}
    >
      {children}
    </button>
  ),
}));

// Tag : stub — rend children + variant en data.
vi.mock('../../ui/Tag', () => ({
  Tag: ({
    children,
    variant,
    size,
  }: {
    children: ReactNode;
    variant?: string;
    size?: string;
  }) => (
    <span data-testid="tag-stub" data-variant={variant} data-size={size}>
      {children}
    </span>
  ),
}));

// Icon : stub.
vi.mock('../../ui/Icon', () => ({
  Icon: ({ size }: { size?: number }) => (
    <span data-testid="icon-stub" data-size={size} />
  ),
}));

// Skeleton : stub.
vi.mock('../../ui/Skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

// EmptyState : stub.
vi.mock('../../ui/EmptyState', () => ({
  EmptyState: ({
    title,
    description,
  }: {
    title: ReactNode;
    description?: ReactNode;
  }) => (
    <div data-testid="empty-state">
      <div data-testid="empty-title">{title}</div>
      <div data-testid="empty-description">{description}</div>
    </div>
  ),
}));

// SlidePanel : stub — rend children + footer quand open=true.
vi.mock('../../ui/SlidePanel', () => ({
  SlidePanel: ({
    open,
    title,
    children,
    footer,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
    footer?: ReactNode;
    onOpenChange: (o: boolean) => void;
  }) =>
    open ? (
      <div data-testid="slide-panel-stub" role="dialog" aria-label={title}>
        <div data-testid="slide-panel-title">{title}</div>
        <div data-testid="slide-panel-body">{children}</div>
        {footer ? (
          <div data-testid="slide-panel-footer">{footer}</div>
        ) : null}
      </div>
    ) : null,
}));

// Tooltip : pass-through children (radix portal pas testable jsdom simple).
vi.mock('../../ui/Tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Toast : capture success/error.
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('../../ui/Toast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    toast: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    remove: vi.fn(),
  }),
}));

// Imports APRÈS les mocks.
import { ReviewModerationQueue } from '../ReviewModerationQueue';
import type { ProductReview } from '../../../lib/types';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeReview(over: Partial<ProductReview> = {}): ProductReview {
  return {
    id: over.id ?? 'rev_1',
    client_id: over.client_id ?? 'cli_1',
    product_id: over.product_id ?? 'prod_abc12345',
    customer_id: over.customer_id ?? 'cust_1',
    order_id: over.order_id ?? 'ord_1',
    rating: over.rating ?? 4,
    title: over.title ?? 'Excellent produit',
    body:
      over.body ??
      "Très bon achat, livraison rapide, produit conforme aux attentes du client.",
    photos: over.photos ?? null,
    verified_buyer: over.verified_buyer ?? true,
    status: over.status ?? 'pending',
    moderation_notes: over.moderation_notes ?? null,
    helpful_count: over.helpful_count ?? 0,
    spam_score: over.spam_score ?? 10,
    created_at: over.created_at ?? '2026-05-22T10:00:00Z',
    updated_at: over.updated_at ?? '2026-05-22T10:00:00Z',
  };
}

function threeReviews(): ProductReview[] {
  return [
    makeReview({ id: 'rev_1', title: 'Excellent produit', status: 'pending', spam_score: 10 }),
    makeReview({
      id: 'rev_2',
      title: 'Pas top',
      status: 'flagged',
      spam_score: 65,
      photos: ['https://cdn.example.com/p1.jpg', 'https://cdn.example.com/p2.jpg'],
    }),
    makeReview({
      id: 'rev_3',
      title: 'Bof',
      status: 'pending',
      spam_score: 35,
      verified_buyer: false,
    }),
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<ReviewModerationQueue /> — Sprint 40 B1', () => {
  beforeEach(() => {
    getModerationQueueMock.mockResolvedValue({ data: threeReviews() });
    moderateReviewMock.mockResolvedValue({
      data: makeReview({ status: 'approved' }),
    });
    deleteReviewMock.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. mount → getModerationQueue appelé + 3 reviews rendus', async () => {
    render(<ReviewModerationQueue />);
    await waitFor(() =>
      expect(getModerationQueueMock).toHaveBeenCalledTimes(1),
    );
    // Premier appel = filter "all" → pas d'argument.
    expect(getModerationQueueMock).toHaveBeenCalledWith(undefined);

    expect(await screen.findByText('Excellent produit')).toBeInTheDocument();
    expect(screen.getByText('Pas top')).toBeInTheDocument();
    expect(screen.getByText('Bof')).toBeInTheDocument();
    expect(screen.getByTestId('review-row-rev_1')).toBeInTheDocument();
    expect(screen.getByTestId('review-row-rev_2')).toBeInTheDocument();
    expect(screen.getByTestId('review-row-rev_3')).toBeInTheDocument();
  });

  it('2. click "Approve" → moderateReview({ action: "approve" }) appelé', async () => {
    render(<ReviewModerationQueue />);
    await screen.findByText('Excellent produit');

    const approveBtn = screen.getByTestId('approve-rev_1');
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(moderateReviewMock).toHaveBeenCalledWith('rev_1', {
        action: 'approve',
      });
    });
    // Toast success
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith(
        'products.reviews.moderation.approve',
      );
    });
    // Refresh (>=2 appels).
    await waitFor(() => {
      expect(getModerationQueueMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('3. click "Reject" → moderateReview({ action: "reject" }) appelé', async () => {
    render(<ReviewModerationQueue />);
    await screen.findByText('Excellent produit');

    const rejectBtn = screen.getByTestId('reject-rev_1');
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(moderateReviewMock).toHaveBeenCalledWith('rev_1', {
        action: 'reject',
      });
    });
  });

  it('4. click "Détail" → drawer ouvre + body full rendu', async () => {
    render(<ReviewModerationQueue />);
    await screen.findByText('Excellent produit');

    // Pas de drawer initialement.
    expect(screen.queryByTestId('slide-panel-stub')).toBeNull();

    const detailBtn = screen.getByTestId('detail-rev_2');
    fireEvent.click(detailBtn);

    const panel = await screen.findByTestId('slide-panel-stub');
    expect(panel).toBeInTheDocument();
    // Title = review.title
    expect(screen.getByTestId('slide-panel-title')).toHaveTextContent(
      'Pas top',
    );
    // Body complet visible.
    const detail = within(panel).getByTestId('review-detail');
    expect(within(detail).getByTestId('detail-body')).toHaveTextContent(
      /Très bon achat/,
    );
    // Photos rendues (rev_2 a 2 photos).
    expect(within(panel).getByTestId('detail-photos')).toBeInTheDocument();
    // Footer drawer = 3 actions modération.
    const footer = within(panel).getByTestId('slide-panel-footer');
    expect(
      within(footer).getByRole('button', {
        name: /products\.reviews\.moderation\.approve/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(footer).getByRole('button', {
        name: /products\.reviews\.moderation\.reject/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(footer).getByRole('button', {
        name: /products\.reviews\.moderation\.flag/i,
      }),
    ).toBeInTheDocument();
  });

  it('5. filter status=flagged → re-fetch avec { status: "flagged" }', async () => {
    render(<ReviewModerationQueue />);
    await screen.findByText('Excellent produit');
    expect(getModerationQueueMock).toHaveBeenCalledTimes(1);

    const filter = screen.getByTestId('status-filter');
    fireEvent.change(filter, { target: { value: 'flagged' } });

    await waitFor(() => {
      expect(getModerationQueueMock).toHaveBeenCalledWith({
        status: 'flagged',
      });
    });
    await waitFor(() => {
      expect(getModerationQueueMock.mock.calls.length).toBeGreaterThanOrEqual(
        2,
      );
    });
  });

  it('6. liste vide → empty state visible', async () => {
    getModerationQueueMock.mockResolvedValue({ data: [] });

    render(<ReviewModerationQueue />);
    await waitFor(() => expect(getModerationQueueMock).toHaveBeenCalled());

    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('empty-title')).toHaveTextContent(
      'reviews.empty.reviews',
    );
  });

  it('7. erreur réseau au mount → toast erreur affiché', async () => {
    getModerationQueueMock.mockResolvedValue({ error: 'Network down' });

    render(<ReviewModerationQueue />);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Network down');
    });
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
  });

  it('8. erreur moderateReview → toast error, pas de toast success', async () => {
    moderateReviewMock.mockResolvedValue({ error: 'Forbidden' });

    render(<ReviewModerationQueue />);
    await screen.findByText('Excellent produit');

    fireEvent.click(screen.getByTestId('approve-rev_1'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Forbidden');
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
