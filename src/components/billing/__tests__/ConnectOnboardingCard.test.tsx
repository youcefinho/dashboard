// @vitest-environment jsdom
// ── Sprint 31 — Stripe Connect UI (Manager-C C3) ─────────────────────────────
// Tests du contrat <ConnectOnboardingCard /> :
//   1. account=null  → bouton "Configurer" visible + badge neutral "—".
//   2. Click bouton  → createStripeConnectOnboarding appelé + redirection
//                      via window.location.href = url Stripe-hosted.
//   3. chargesEnabled+payoutsEnabled=true → badge success + message active,
//                      PAS de bouton "Configurer/Continuer".
//   4. detailsSubmitted=false → bouton "Configurer" + badge warning pending.
//   5. detailsSubmitted=true & chargesEnabled=false → badge danger restricted
//                      + requirements affichés (N items currently_due).
//
// Pattern repris de BillingPlanPanel.test.tsx (vi.mock('@/lib/api'),
// ToastProvider wrapper, t() vrai i18n).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { t } from '@/lib/i18n';
import type { StripeConnectAccount } from '@/lib/types';

// ── Mocks API ───────────────────────────────────────────────────────────────

const getStripeConnectStatusMock = vi.fn();
const createStripeConnectOnboardingMock = vi.fn();

vi.mock('@/lib/api', () => ({
  getStripeConnectStatus: (...args: unknown[]) => getStripeConnectStatusMock(...args),
  createStripeConnectOnboarding: (...args: unknown[]) =>
    createStripeConnectOnboardingMock(...args),
}));

// Imports APRÈS les mocks
import { ConnectOnboardingCard } from '../ConnectOnboardingCard';
import { ToastProvider } from '@/components/ui';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<StripeConnectAccount> = {}): StripeConnectAccount {
  return {
    id: 'sca_1',
    clientId: 'cli_1',
    stripeAccountId: 'acct_test_123',
    accountType: 'express',
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    capabilities: {},
    requirements: { currently_due: [], eventually_due: [], past_due: [] },
    onboardingCompletedAt: null,
    ...overrides,
  };
}

function withProviders(ui: React.ReactNode) {
  return <ToastProvider>{ui}</ToastProvider>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// jsdom : window.location.href est read-only par défaut, on remplace `location`
// par un mock object pour pouvoir spy l'assignation.
function mockLocationHref() {
  const original = window.location;
  const setter = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      ...original,
      origin: 'https://app.test',
      get href() {
        return original.href;
      },
      set href(v: string) {
        setter(v);
      },
    },
  });
  return {
    setter,
    restore: () => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<ConnectOnboardingCard /> — Sprint 31 (Stripe Connect onboarding)', () => {
  beforeEach(() => {
    // Default : pas de compte connecté
    getStripeConnectStatusMock.mockResolvedValue({ data: null });
    createStripeConnectOnboardingMock.mockResolvedValue({
      data: {
        url: 'https://connect.stripe.test/onboard/acct_test_123',
        expiresAt: '2026-05-25T00:00:00Z',
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. render avec account=null → bouton "Configurer" visible + badge neutral', async () => {
    render(withProviders(<ConnectOnboardingCard />));
    await waitFor(() => expect(getStripeConnectStatusMock).toHaveBeenCalled());

    // Bouton onboard CTA
    const cta = await screen.findByRole('button', {
      name: new RegExp(t('billing.real.connect.onboard_cta'), 'i'),
    });
    expect(cta).toBeInTheDocument();

    // Badge neutral (état "none")
    const badge = document.querySelector(
      '[data-component="ConnectStatusBadge"][data-state="none"]',
    );
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('—');

    // Card data-state none
    const card = document.querySelector(
      '[data-component="ConnectOnboardingCard"][data-state="none"]',
    );
    expect(card).not.toBeNull();
  });

  it('2. click bouton → createStripeConnectOnboarding appelé + window.location.href set', async () => {
    const loc = mockLocationHref();
    try {
      render(withProviders(<ConnectOnboardingCard />));
      await waitFor(() => expect(getStripeConnectStatusMock).toHaveBeenCalled());

      const cta = await screen.findByRole('button', {
        name: new RegExp(t('billing.real.connect.onboard_cta'), 'i'),
      });
      fireEvent.click(cta);

      await waitFor(() => {
        expect(createStripeConnectOnboardingMock).toHaveBeenCalledTimes(1);
      });

      // Vérifie le payload : refresh + return URLs construits depuis window.location.origin
      const callArgs = createStripeConnectOnboardingMock.mock.calls[0]![0] as {
        refreshUrl: string;
        returnUrl: string;
      };
      expect(callArgs.refreshUrl).toMatch(/\/settings\/billing\?refresh=1$/);
      expect(callArgs.returnUrl).toMatch(/\/settings\/billing\?return=1$/);
      expect(callArgs.refreshUrl.startsWith('https://app.test')).toBe(true);

      // window.location.href assigné à l'URL Stripe
      await waitFor(() => {
        expect(loc.setter).toHaveBeenCalledWith(
          'https://connect.stripe.test/onboard/acct_test_123',
        );
      });
    } finally {
      loc.restore();
    }
  });

  it('3. account chargesEnabled+payoutsEnabled=true → badge success + pas de bouton', async () => {
    getStripeConnectStatusMock.mockResolvedValue({
      data: makeAccount({
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        onboardingCompletedAt: '2026-05-20T00:00:00Z',
      }),
    });

    render(withProviders(<ConnectOnboardingCard />));
    await waitFor(() => expect(getStripeConnectStatusMock).toHaveBeenCalled());

    // Badge success
    await waitFor(() => {
      const badge = document.querySelector(
        '[data-component="ConnectStatusBadge"][data-state="active"]',
      );
      expect(badge).not.toBeNull();
    });

    // Card state active
    expect(
      document.querySelector('[data-component="ConnectOnboardingCard"][data-state="active"]'),
    ).not.toBeNull();

    // Pas de bouton CTA "Configurer/Continuer"
    expect(
      screen.queryByRole('button', {
        name: new RegExp(t('billing.real.connect.onboard_cta'), 'i'),
      }),
    ).toBeNull();

    // Message active visible (au moins une instance — badge ET paragraphe partagent
    // le même label `status_active`, donc on cherche le paragraphe dédié)
    const activeParagraph = document.querySelector(
      '[data-component="ConnectOnboardingCard"] p[data-state="active"]',
    );
    expect(activeParagraph).not.toBeNull();
    expect(activeParagraph?.textContent).toBe(t('billing.real.connect.status_active'));
  });

  it('4. account detailsSubmitted=false → bouton "Configurer" + badge pending', async () => {
    getStripeConnectStatusMock.mockResolvedValue({
      data: makeAccount({
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      }),
    });

    render(withProviders(<ConnectOnboardingCard />));
    await waitFor(() => expect(getStripeConnectStatusMock).toHaveBeenCalled());

    // Badge pending
    await waitFor(() => {
      const badge = document.querySelector(
        '[data-component="ConnectStatusBadge"][data-state="pending"]',
      );
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe(t('billing.real.connect.status_pending'));
    });

    // Bouton CTA visible
    const cta = await screen.findByRole('button', {
      name: new RegExp(t('billing.real.connect.onboard_cta'), 'i'),
    });
    expect(cta).toBeInTheDocument();

    // Card state pending
    expect(
      document.querySelector('[data-component="ConnectOnboardingCard"][data-state="pending"]'),
    ).not.toBeNull();
  });

  it('5. account detailsSubmitted=true + chargesEnabled=false → badge restricted + requirements affichés', async () => {
    getStripeConnectStatusMock.mockResolvedValue({
      data: makeAccount({
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: true,
        requirements: {
          currently_due: ['tos_acceptance.ip', 'individual.verification.document'],
          eventually_due: [],
          past_due: [],
        },
      }),
    });

    render(withProviders(<ConnectOnboardingCard />));
    await waitFor(() => expect(getStripeConnectStatusMock).toHaveBeenCalled());

    // Badge restricted
    await waitFor(() => {
      const badge = document.querySelector(
        '[data-component="ConnectStatusBadge"][data-state="restricted"]',
      );
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe(t('billing.real.connect.status_restricted'));
    });

    // Requirements paragraphe avec count=2
    const requirements = document.querySelector(
      '[data-component="ConnectOnboardingCard-requirements"]',
    );
    expect(requirements).not.toBeNull();
    expect(requirements?.getAttribute('data-count')).toBe('2');

    // Card state restricted
    expect(
      document.querySelector(
        '[data-component="ConnectOnboardingCard"][data-state="restricted"]',
      ),
    ).not.toBeNull();

    // Bouton "Continuer/Configurer" présent (CTA encore actif tant que pas active)
    expect(
      screen.getByRole('button', {
        name: new RegExp(t('billing.real.connect.onboard_cta'), 'i'),
      }),
    ).toBeInTheDocument();
  });
});
