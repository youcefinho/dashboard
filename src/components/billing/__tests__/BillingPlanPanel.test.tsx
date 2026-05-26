// @vitest-environment jsdom
// ── Sprint 22 — Billing Stripe prod (E4 flag mock) — Manager-C ──────────────
// Test du contrat panel enrichi `<BillingPlanPanel />` :
//   1.  Rend les 4 plans (free/starter/pro/unlimited) après fetch.
//   2.  Indique le plan courant via badge "Plan actuel".
//   3.  Toggle monthly/yearly fonctionne (change le prix affiché).
//   4.  Click "Mettre à niveau" → confirm dialog → changeSubscriptionPlan
//       appelé avec { planTier:'pro', billingPeriod:'monthly' }.
//   5.  Si changeSubscriptionPlan renvoie data.mock:true → message i18n
//       `billing.mock.banner.message` (toast info).
//   6.  Click "Annuler" → confirm → cancelSubscription({ atPeriodEnd:true }).
//   7.  Si sub status='canceled' → bouton "Reprendre" → resumeSubscription.
//   8.  BillingPortalButton click → createBillingPortalSession ; mock=true →
//       pas de window.open ; live → window.open appelé avec url.
//   9.  BillingInvoicesList empty state si liste vide.
//   10. WebhookConfigPanel affiche modeMock=true via badge.
//   11. État loading affiché pendant fetch initial.
//   12. État erreur (tous endpoints down) → fallback gracieux + bouton retry.
//
// Pattern repris de OnboardingChecklistPanel.test.tsx (vi.mock('@/lib/api'),
// ToastProvider + ConfirmProvider wrappers, t() vrai i18n).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import { t } from '@/lib/i18n';

// ── Mocks API ───────────────────────────────────────────────────────────────

const getBillingPlansMock = vi.fn();
const getCurrentSubscriptionMock = vi.fn();
const getBillingUsageMock = vi.fn();
const getBillingWebhookConfigMock = vi.fn();
const listBillingInvoicesMock = vi.fn();
const changeSubscriptionPlanMock = vi.fn();
const cancelSubscriptionMock = vi.fn();
const resumeSubscriptionMock = vi.fn();
const createBillingPortalSessionMock = vi.fn();
// ── Sprint 31 ───────────────────────────────────────────────────────────────
const listStripePaymentMethodsMock = vi.fn();
const getConnectAccountStatusMock = vi.fn();

vi.mock('@/lib/api', () => ({
  getBillingPlans: (...args: unknown[]) => getBillingPlansMock(...args),
  getCurrentSubscription: (...args: unknown[]) => getCurrentSubscriptionMock(...args),
  getBillingUsage: (...args: unknown[]) => getBillingUsageMock(...args),
  getBillingWebhookConfig: (...args: unknown[]) => getBillingWebhookConfigMock(...args),
  listBillingInvoices: (...args: unknown[]) => listBillingInvoicesMock(...args),
  changeSubscriptionPlan: (...args: unknown[]) => changeSubscriptionPlanMock(...args),
  cancelSubscription: (...args: unknown[]) => cancelSubscriptionMock(...args),
  resumeSubscription: (...args: unknown[]) => resumeSubscriptionMock(...args),
  createBillingPortalSession: (...args: unknown[]) => createBillingPortalSessionMock(...args),
  listStripePaymentMethods: (...args: unknown[]) => listStripePaymentMethodsMock(...args),
  getConnectAccountStatus: (...args: unknown[]) => getConnectAccountStatusMock(...args),
}));

// ── Sprint 31 — mocks des composants frères (owned par Agents C1/C2/C3) ────
// Permet d'asserter le contrat d'intégration sans dépendre de leur
// implémentation interne (tests parallèles).
vi.mock('../PaymentMethodsList', () => ({
  PaymentMethodsList: ({ onAddClick }: { onAddClick?: () => void }) => (
    <div data-testid="payment-methods-list">
      <button type="button" onClick={onAddClick} data-testid="pm-add-trigger">
        Ajouter une carte
      </button>
    </div>
  ),
}));

vi.mock('../AddPaymentMethodDialog', () => ({
  AddPaymentMethodDialog: ({
    open,
    onClose,
    onAdded,
  }: {
    open: boolean;
    onClose?: () => void;
    onAdded?: () => void;
  }) =>
    open ? (
      <div role="dialog" data-testid="add-pm-dialog">
        <button type="button" onClick={onClose} data-testid="pm-close">close</button>
        <button type="button" onClick={onAdded} data-testid="pm-added">added</button>
      </div>
    ) : null,
}));

vi.mock('../ConnectOnboardingCard', () => ({
  ConnectOnboardingCard: () => (
    <div data-testid="connect-onboarding-card">Connect</div>
  ),
}));

// Imports APRÈS les mocks
import { BillingPlanPanel } from '../BillingPlanPanel';
import { ToastProvider, ConfirmProvider } from '@/components/ui';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makePlans() {
  return {
    data: [
      {
        id: 'plan_free',
        tier: 'free',
        displayName: 'Free',
        description: null,
        priceMonthlyCents: 0,
        priceYearlyCents: 0,
        currency: 'CAD',
        limits: { maxSubAccounts: 1, maxLeads: 100, maxUsers: 1 },
        features: [],
        displayOrder: 0,
        isActive: true,
      },
      {
        id: 'plan_starter',
        tier: 'starter',
        displayName: 'Starter',
        description: null,
        priceMonthlyCents: 4900,
        priceYearlyCents: 49000,
        currency: 'CAD',
        limits: { maxSubAccounts: 3, maxLeads: 1000, maxUsers: 3 },
        features: [],
        displayOrder: 1,
        isActive: true,
      },
      {
        id: 'plan_pro',
        tier: 'pro',
        displayName: 'Pro',
        description: null,
        priceMonthlyCents: 9900,
        priceYearlyCents: 99000,
        currency: 'CAD',
        limits: { maxSubAccounts: 10, maxLeads: 10000, maxUsers: 10 },
        features: [],
        displayOrder: 2,
        isActive: true,
      },
      {
        id: 'plan_unlimited',
        tier: 'unlimited',
        displayName: 'Unlimited',
        description: null,
        priceMonthlyCents: 29900,
        priceYearlyCents: 299000,
        currency: 'CAD',
        limits: { maxSubAccounts: null, maxLeads: null, maxUsers: null },
        features: [],
        displayOrder: 3,
        isActive: true,
      },
    ],
  };
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'sub_1',
      agencyId: 'ag_1',
      clientId: 'cli_1',
      planTier: 'free',
      status: 'active',
      billingPeriod: 'monthly',
      provider: 'mock',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      trialEndsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      isMock: true,
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: null,
      ...overrides,
    },
  };
}

function makeUsage() {
  return {
    data: {
      subAccounts: { current: 0, limit: 1 },
      leads: { current: 12, limit: 100 },
      users: { current: 1, limit: 1 },
    },
  };
}

function makeWebhookConfig(modeMock = true) {
  return {
    data: {
      endpointUrl: 'https://intralys.test/api/webhook/stripe',
      signingSecretConfigured: false,
      stripeKeyConfigured: false,
      modeMock,
      supportedEvents: [
        'customer.subscription.created',
        'customer.subscription.updated',
        'invoice.paid',
      ],
    },
  };
}

function emptyInvoices() {
  return { data: [] };
}

function withProviders(ui: React.ReactNode) {
  return (
    <ToastProvider>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </ToastProvider>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function defaultHappyPath() {
  getBillingPlansMock.mockResolvedValue(makePlans());
  getCurrentSubscriptionMock.mockResolvedValue(makeSubscription());
  getBillingUsageMock.mockResolvedValue(makeUsage());
  getBillingWebhookConfigMock.mockResolvedValue(makeWebhookConfig(true));
  listBillingInvoicesMock.mockResolvedValue(emptyInvoices());
  changeSubscriptionPlanMock.mockResolvedValue({
    data: { success: true, mock: true, subscription: makeSubscription().data },
  });
  cancelSubscriptionMock.mockResolvedValue({ data: { success: true, mock: true } });
  resumeSubscriptionMock.mockResolvedValue({ data: { success: true, mock: true } });
  createBillingPortalSessionMock.mockResolvedValue({
    data: {
      url: 'https://billing.stripe.test/p/session/123',
      expiresAt: '2026-05-22T23:59:59Z',
      isMock: true,
    },
  });
  // ── Sprint 31 happy path defaults ────────────────────────────────────────
  listStripePaymentMethodsMock.mockResolvedValue({ data: [] });
  getConnectAccountStatusMock.mockResolvedValue({
    data: { status: 'not_onboarded', chargesEnabled: false, payoutsEnabled: false },
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<BillingPlanPanel /> — Sprint 22 (E4 flag mock)', () => {
  beforeEach(() => {
    defaultHappyPath();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. fetch + rend les 4 plans (free/starter/pro/unlimited)', async () => {
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getBillingPlansMock).toHaveBeenCalled());

    const grid = await screen.findByLabelText(t('billing.plans.period.toggle'));
    expect(grid).toBeInTheDocument();

    // 4 cartes data-tier
    await waitFor(() => {
      const cards = document.querySelectorAll('[data-tier]');
      expect(cards.length).toBe(4);
    });
  });

  it('2. indique le plan courant via badge "Plan actuel"', async () => {
    getCurrentSubscriptionMock.mockResolvedValue(
      makeSubscription({ planTier: 'pro' }),
    );
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => {
      const current = document.querySelector('[data-tier="pro"][data-current="true"]');
      expect(current).not.toBeNull();
    });
  });

  it('3. toggle monthly/yearly bascule la période active', async () => {
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getBillingPlansMock).toHaveBeenCalled());

    const monthlyTab = await screen.findByRole('tab', {
      name: t('billing.plans.period.monthly'),
    });
    const yearlyTab = screen.getByRole('tab', {
      name: t('billing.plans.period.yearly'),
    });
    expect(monthlyTab).toHaveAttribute('aria-selected', 'true');
    expect(yearlyTab).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(yearlyTab);
    expect(yearlyTab).toHaveAttribute('aria-selected', 'true');
    expect(monthlyTab).toHaveAttribute('aria-selected', 'false');
  });

  it('4+5. click "Mettre à niveau" → confirm → changeSubscriptionPlan + toast mock', async () => {
    // Sub courant = free → pro = upgrade
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getBillingPlansMock).toHaveBeenCalled());

    const proCard = (await waitFor(() => {
      const el = document.querySelector('[data-tier="pro"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    })) as HTMLElement;

    const upgradeBtn = within(proCard).getByRole('button', {
      name: new RegExp(t('billing.plans.cta_upgrade'), 'i'),
    });
    fireEvent.click(upgradeBtn);

    // Confirm dialog s'ouvre — bouton "Confirmer le changement" présent
    const confirmBtn = await screen.findByRole('button', {
      name: new RegExp(t('billing.action.confirm_change'), 'i'),
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(changeSubscriptionPlanMock).toHaveBeenCalledTimes(1);
    });
    expect(changeSubscriptionPlanMock).toHaveBeenCalledWith({
      planTier: 'pro',
      billingPeriod: 'monthly',
    });

    // Toast mock message i18n
    await waitFor(() => {
      expect(screen.queryByText(t('billing.mock.banner.message'))).not.toBeNull();
    });
  });

  it('6. click "Annuler l\'abonnement" → confirm danger → cancelSubscription({ atPeriodEnd:true })', async () => {
    getCurrentSubscriptionMock.mockResolvedValue(
      makeSubscription({ planTier: 'pro', status: 'active', cancelAtPeriodEnd: false }),
    );
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getCurrentSubscriptionMock).toHaveBeenCalled());

    const cancelBtn = await screen.findByRole('button', {
      name: new RegExp(t('billing.action.cancel_subscription'), 'i'),
    });
    fireEvent.click(cancelBtn);

    // Confirm dialog danger — utilise le label confirm passé
    const confirmCancel = await screen.findByRole('button', {
      name: new RegExp(t('billing.action.confirm_cancel'), 'i'),
    });
    fireEvent.click(confirmCancel);

    await waitFor(() => {
      expect(cancelSubscriptionMock).toHaveBeenCalledTimes(1);
    });
    expect(cancelSubscriptionMock).toHaveBeenCalledWith({ atPeriodEnd: true });
  });

  it('7. status=canceled → bouton "Reprendre" appelle resumeSubscription', async () => {
    getCurrentSubscriptionMock.mockResolvedValue(
      makeSubscription({ status: 'canceled', canceledAt: '2026-05-15T00:00:00Z' }),
    );
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getCurrentSubscriptionMock).toHaveBeenCalled());

    const resumeBtn = await screen.findByRole('button', {
      name: new RegExp(t('billing.action.resume_subscription'), 'i'),
    });
    fireEvent.click(resumeBtn);

    await waitFor(() => {
      expect(resumeSubscriptionMock).toHaveBeenCalledTimes(1);
    });
  });

  it('8a. BillingPortalButton mock → pas de window.open + notice affichée', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getBillingPlansMock).toHaveBeenCalled());

    const portalBtn = await screen.findByRole('button', {
      name: new RegExp(t('billing.action.manage_in_portal'), 'i'),
    });
    fireEvent.click(portalBtn);

    await waitFor(() => {
      expect(createBillingPortalSessionMock).toHaveBeenCalledTimes(1);
    });
    // isMock=true par défaut → pas de window.open
    expect(openSpy).not.toHaveBeenCalled();
    // Toast notice mock
    await waitFor(() => {
      expect(screen.queryByText(t('billing.mock.action_unavailable'))).not.toBeNull();
    });
    openSpy.mockRestore();
  });

  it('8b. BillingPortalButton live (isMock:false) → window.open appelé avec url', async () => {
    createBillingPortalSessionMock.mockResolvedValue({
      data: {
        url: 'https://billing.stripe.com/p/session/live_abc',
        expiresAt: '2026-05-22T23:59:59Z',
        isMock: false,
      },
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getBillingPlansMock).toHaveBeenCalled());

    const portalBtn = await screen.findByRole('button', {
      name: new RegExp(t('billing.action.manage_in_portal'), 'i'),
    });
    fireEvent.click(portalBtn);

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        'https://billing.stripe.com/p/session/live_abc',
        '_blank',
        expect.any(String),
      );
    });
    openSpy.mockRestore();
  });

  it('9. BillingInvoicesList empty state si liste vide', async () => {
    listBillingInvoicesMock.mockResolvedValue({ data: [] });
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(listBillingInvoicesMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByText(t('billing.invoices.empty'))).not.toBeNull();
    });
  });

  it('10. WebhookConfigPanel affiche le badge mode mock quand modeMock=true', async () => {
    getBillingWebhookConfigMock.mockResolvedValue(makeWebhookConfig(true));
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getBillingWebhookConfigMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByText(t('billing.webhook.mode_mock'))).not.toBeNull();
    });
    // Et badge "Clé API manquante" car stripeKeyConfigured=false
    expect(screen.queryByText(t('billing.webhook.key_missing'))).not.toBeNull();
  });

  it('11. état loading affiché pendant fetch initial (skeleton placeholders)', async () => {
    // Promesse jamais résolue → composant reste en loading
    let resolvePlans: ((v: unknown) => void) | null = null;
    getBillingPlansMock.mockImplementation(
      () => new Promise((resolve) => { resolvePlans = resolve; }),
    );
    getCurrentSubscriptionMock.mockImplementation(() => new Promise(() => {}));
    getBillingUsageMock.mockImplementation(() => new Promise(() => {}));
    getBillingWebhookConfigMock.mockImplementation(() => new Promise(() => {}));
    listBillingInvoicesMock.mockImplementation(() => new Promise(() => {}));

    const { container } = render(withProviders(<BillingPlanPanel />));
    expect(
      container.querySelector('[data-component="BillingPlanPanel"][data-loading="true"]'),
    ).not.toBeNull();

    // Libère pour cleanup
    resolvePlans?.(makePlans());
  });

  it('12. tous endpoints en erreur → fallback gracieux + bouton retry', async () => {
    getBillingPlansMock.mockResolvedValue({ error: 'down' });
    getCurrentSubscriptionMock.mockResolvedValue({ error: 'down' });
    getBillingUsageMock.mockResolvedValue({ error: 'down' });
    getBillingWebhookConfigMock.mockResolvedValue({ error: 'down' });
    listBillingInvoicesMock.mockResolvedValue({ error: 'down' });

    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => {
      const errorContainer = document.querySelector(
        '[data-component="BillingPlanPanel"][data-error="true"]',
      );
      expect(errorContainer).not.toBeNull();
    });

    // Retry button présent
    const retryBtn = screen.getByRole('button', {
      name: new RegExp(t('action.retry'), 'i'),
    });
    expect(retryBtn).toBeInTheDocument();

    // Click retry → ré-appelle les endpoints
    getBillingPlansMock.mockClear();
    fireEvent.click(retryBtn);
    await waitFor(() => expect(getBillingPlansMock).toHaveBeenCalled());
  });

  // ── Sprint 31 — Payment Methods + Stripe Connect intégration ──────────────

  it('S31-1. <PaymentMethodsList /> est rendu après fetch initial', async () => {
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getBillingPlansMock).toHaveBeenCalled());
    expect(await screen.findByTestId('payment-methods-list')).toBeInTheDocument();
  });

  it('S31-2. <ConnectOnboardingCard /> est rendu après fetch initial', async () => {
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getBillingPlansMock).toHaveBeenCalled());
    expect(await screen.findByTestId('connect-onboarding-card')).toBeInTheDocument();
  });

  it('S31-3. <AddPaymentMethodDialog /> fermée par défaut, ouverte au click "Ajouter une carte"', async () => {
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getBillingPlansMock).toHaveBeenCalled());

    // Fermée par défaut
    expect(screen.queryByTestId('add-pm-dialog')).toBeNull();

    // Click sur le trigger fourni par PaymentMethodsList → open=true
    const addTrigger = await screen.findByTestId('pm-add-trigger');
    fireEvent.click(addTrigger);

    expect(await screen.findByTestId('add-pm-dialog')).toBeInTheDocument();
  });

  it('S31-4. onClose ferme la dialog ; onAdded ferme aussi et refresh la liste', async () => {
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getBillingPlansMock).toHaveBeenCalled());

    // Open
    fireEvent.click(await screen.findByTestId('pm-add-trigger'));
    expect(await screen.findByTestId('add-pm-dialog')).toBeInTheDocument();

    // Close
    fireEvent.click(screen.getByTestId('pm-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('add-pm-dialog')).toBeNull();
    });

    // Re-open + simuler onAdded → ferme aussi (et le key bump force le refresh
    // côté PaymentMethodsList — pas observable depuis le mock, mais on vérifie
    // la fermeture).
    fireEvent.click(screen.getByTestId('pm-add-trigger'));
    fireEvent.click(await screen.findByTestId('pm-added'));
    await waitFor(() => {
      expect(screen.queryByTestId('add-pm-dialog')).toBeNull();
    });
  });

  it('S31-5. subscription.isMock=false (+ webhook live, pas d\'invoices mock) → <BillingMockBanner /> PAS rendu', async () => {
    getCurrentSubscriptionMock.mockResolvedValue(
      makeSubscription({
        planTier: 'pro',
        status: 'active',
        provider: 'stripe',
        stripeCustomerId: 'cus_live',
        stripeSubscriptionId: 'sub_live',
        isMock: false,
      }),
    );
    getBillingWebhookConfigMock.mockResolvedValue(makeWebhookConfig(false));
    listBillingInvoicesMock.mockResolvedValue({ data: [] });

    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getCurrentSubscriptionMock).toHaveBeenCalled());
    await waitFor(() => expect(getBillingWebhookConfigMock).toHaveBeenCalled());

    // Le banner ne doit pas être rendu (parent décide via anyMock)
    expect(
      document.querySelector('[data-component="BillingMockBanner"]'),
    ).toBeNull();
  });

  it('S31-6. subscription.isMock=true → <BillingMockBanner /> reste rendu (Sprint 22 préservé)', async () => {
    // defaultHappyPath() = subscription.isMock:true + webhook modeMock:true
    render(withProviders(<BillingPlanPanel />));
    await waitFor(() => expect(getCurrentSubscriptionMock).toHaveBeenCalled());

    await waitFor(() => {
      expect(
        document.querySelector('[data-component="BillingMockBanner"]'),
      ).not.toBeNull();
    });
  });
});
