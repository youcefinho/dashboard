// @vitest-environment jsdom
// ── Sprint 31 — Payment methods list (Manager-C / Agent C2) — tests ──────────
// Cas couverts :
//   1. Render vide → EmptyState (clé i18n "not_activated") rendu
//   2. Render avec 2 cartes → 2 items + brand + last4 affichés
//   3. Default badge sur carte par défaut
//   4. Click "set default" sur carte NON par défaut → setDefaultStripePaymentMethod appelé
//      avec le `stripePaymentMethodId` correct
//   5. Click "remove" → window.confirm() + deleteStripePaymentMethod appelé
//   6. Click "add" → onAddClick prop appelé
//
// Pattern repris de BillingPlanPanel.test.tsx :
//   - vi.mock('@/lib/api') + vi.mock('@/lib/i18n') (t identity)
//   - ToastProvider wrapper requis (le composant utilise useToast)
//   - import APRÈS les mocks
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';

// ── Mocks API ───────────────────────────────────────────────────────────────

const listStripePaymentMethodsMock = vi.fn();
const setDefaultStripePaymentMethodMock = vi.fn();
const deleteStripePaymentMethodMock = vi.fn();

vi.mock('@/lib/api', () => ({
  listStripePaymentMethods: (...args: unknown[]) => listStripePaymentMethodsMock(...args),
  setDefaultStripePaymentMethod: (...args: unknown[]) =>
    setDefaultStripePaymentMethodMock(...args),
  deleteStripePaymentMethod: (...args: unknown[]) => deleteStripePaymentMethodMock(...args),
}));

// ── Mock i18n (identity sur la clé) ─────────────────────────────────────────
// La fonction `t` retourne la clé telle quelle, ce qui permet d'asserter sur
// les clés sans dépendre du dictionnaire réel (qui peut ne pas exister encore
// au moment où ce test tourne — sprint en cours).
vi.mock('@/lib/i18n', () => ({
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
import { PaymentMethodsList } from '../PaymentMethodsList';
import { ToastProvider } from '@/components/ui';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'spm_local_1',
    stripePaymentMethodId: 'pm_1',
    clientId: 'cli_1',
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2030,
    isDefault: false,
    createdAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function withProviders(ui: React.ReactNode) {
  return <ToastProvider>{ui}</ToastProvider>;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<PaymentMethodsList /> — Sprint 31 (Manager-C / Agent C2)', () => {
  beforeEach(() => {
    // Default happy path : liste vide. Chaque test override si besoin.
    listStripePaymentMethodsMock.mockResolvedValue({ data: [] });
    setDefaultStripePaymentMethodMock.mockResolvedValue({ data: { success: true } });
    deleteStripePaymentMethodMock.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Test 1 — empty state ──────────────────────────────────────────────────
  it('1. render vide → EmptyState (not_activated) affiché', async () => {
    listStripePaymentMethodsMock.mockResolvedValue({ data: [] });

    render(withProviders(<PaymentMethodsList />));

    await waitFor(() => expect(listStripePaymentMethodsMock).toHaveBeenCalledTimes(1));

    // Container marqué empty
    await waitFor(() => {
      const container = document.querySelector(
        '[data-component="PaymentMethodsList"][data-empty="true"]',
      );
      expect(container).not.toBeNull();
    });

    // Description = clé i18n "not_activated"
    expect(screen.getByText('billing.real.error.not_activated')).toBeInTheDocument();
  });

  // ── Test 2 — render 2 cartes ──────────────────────────────────────────────
  it('2. render 2 cartes → 2 items + brand + last4 affichés', async () => {
    listStripePaymentMethodsMock.mockResolvedValue({
      data: [
        makeCard({ id: 'spm_1', stripePaymentMethodId: 'pm_1', brand: 'visa', last4: '4242' }),
        makeCard({
          id: 'spm_2',
          stripePaymentMethodId: 'pm_2',
          brand: 'mastercard',
          last4: '5555',
        }),
      ],
    });

    render(withProviders(<PaymentMethodsList />));

    await waitFor(() => expect(listStripePaymentMethodsMock).toHaveBeenCalled());

    // 2 list items
    await waitFor(() => {
      expect(screen.getByTestId('pm-pm_1')).toBeInTheDocument();
      expect(screen.getByTestId('pm-pm_2')).toBeInTheDocument();
    });

    // Visa •••• 4242 et Mastercard •••• 5555 affichés (clés brand renvoyées
    // telles quelles par notre mock i18n — donc on cherche la clé + last4).
    const item1 = screen.getByTestId('pm-pm_1');
    expect(within(item1).getByText(/billing\.real\.payment_method\.brand_visa/)).toBeInTheDocument();
    expect(within(item1).getByText(/4242/)).toBeInTheDocument();

    const item2 = screen.getByTestId('pm-pm_2');
    expect(
      within(item2).getByText(/billing\.real\.payment_method\.brand_mastercard/),
    ).toBeInTheDocument();
    expect(within(item2).getByText(/5555/)).toBeInTheDocument();
  });

  // ── Test 3 — default badge ────────────────────────────────────────────────
  it('3. carte isDefault → badge "is_default" affiché uniquement sur cette carte', async () => {
    listStripePaymentMethodsMock.mockResolvedValue({
      data: [
        makeCard({ id: 'spm_1', stripePaymentMethodId: 'pm_1', isDefault: true }),
        makeCard({
          id: 'spm_2',
          stripePaymentMethodId: 'pm_2',
          brand: 'mastercard',
          last4: '5555',
          isDefault: false,
        }),
      ],
    });

    render(withProviders(<PaymentMethodsList />));

    await waitFor(() => expect(listStripePaymentMethodsMock).toHaveBeenCalled());

    const defaultItem = await waitFor(() => screen.getByTestId('pm-pm_1'));
    expect(
      within(defaultItem).getByText('billing.real.payment_method.is_default'),
    ).toBeInTheDocument();

    const otherItem = screen.getByTestId('pm-pm_2');
    expect(
      within(otherItem).queryByText('billing.real.payment_method.is_default'),
    ).not.toBeInTheDocument();
  });

  // ── Test 4 — set default ──────────────────────────────────────────────────
  it('4. click "set default" → setDefaultStripePaymentMethod(pm_id) appelé', async () => {
    listStripePaymentMethodsMock.mockResolvedValue({
      data: [
        makeCard({ id: 'spm_1', stripePaymentMethodId: 'pm_1', isDefault: true }),
        makeCard({
          id: 'spm_2',
          stripePaymentMethodId: 'pm_2',
          brand: 'mastercard',
          last4: '5555',
          isDefault: false,
        }),
      ],
    });

    render(withProviders(<PaymentMethodsList />));

    await waitFor(() => expect(listStripePaymentMethodsMock).toHaveBeenCalled());

    const otherItem = await waitFor(() => screen.getByTestId('pm-pm_2'));
    const setDefaultBtn = within(otherItem).getByRole('button', {
      name: /billing\.real\.payment_method\.set_default/,
    });

    fireEvent.click(setDefaultBtn);

    await waitFor(() => {
      expect(setDefaultStripePaymentMethodMock).toHaveBeenCalledTimes(1);
    });
    expect(setDefaultStripePaymentMethodMock).toHaveBeenCalledWith('pm_2');

    // Et list reload après update
    await waitFor(() => {
      expect(listStripePaymentMethodsMock).toHaveBeenCalledTimes(2);
    });
  });

  // ── Test 5 — remove avec confirm ──────────────────────────────────────────
  it('5. click "remove" → window.confirm + deleteStripePaymentMethod(pm_id) appelé', async () => {
    listStripePaymentMethodsMock.mockResolvedValue({
      data: [makeCard({ id: 'spm_1', stripePaymentMethodId: 'pm_1', isDefault: true })],
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(withProviders(<PaymentMethodsList />));

    await waitFor(() => expect(listStripePaymentMethodsMock).toHaveBeenCalled());

    const item = await waitFor(() => screen.getByTestId('pm-pm_1'));
    const removeBtn = within(item).getByRole('button', {
      name: /billing\.real\.payment_method\.remove/,
    });

    fireEvent.click(removeBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith('billing.real.payment_method.remove_confirm');

    await waitFor(() => {
      expect(deleteStripePaymentMethodMock).toHaveBeenCalledTimes(1);
    });
    expect(deleteStripePaymentMethodMock).toHaveBeenCalledWith('pm_1');

    confirmSpy.mockRestore();
  });

  it('5b. confirm → cancel → delete NON appelé', async () => {
    listStripePaymentMethodsMock.mockResolvedValue({
      data: [makeCard({ id: 'spm_1', stripePaymentMethodId: 'pm_1', isDefault: true })],
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(withProviders(<PaymentMethodsList />));
    await waitFor(() => expect(listStripePaymentMethodsMock).toHaveBeenCalled());

    const item = await waitFor(() => screen.getByTestId('pm-pm_1'));
    const removeBtn = within(item).getByRole('button', {
      name: /billing\.real\.payment_method\.remove/,
    });
    fireEvent.click(removeBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteStripePaymentMethodMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // ── Test 6 — onAddClick ───────────────────────────────────────────────────
  it('6. click "add" → onAddClick prop appelé', async () => {
    listStripePaymentMethodsMock.mockResolvedValue({
      data: [makeCard({ id: 'spm_1', stripePaymentMethodId: 'pm_1', isDefault: true })],
    });
    const onAddClick = vi.fn();

    render(withProviders(<PaymentMethodsList onAddClick={onAddClick} />));

    await waitFor(() => expect(listStripePaymentMethodsMock).toHaveBeenCalled());

    // Le bouton "add" est dans le header (toujours rendu si onAddClick fourni).
    // Comme il peut y avoir plusieurs occurrences (header + empty state CTA),
    // on prend le premier match dans le header.
    const addBtns = await screen.findAllByRole('button', {
      name: /billing\.real\.payment_method\.add/,
    });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(addBtns[0]!);
    expect(onAddClick).toHaveBeenCalledTimes(1);
  });

  it('6b. onAddClick non fourni → pas de bouton "add"', async () => {
    listStripePaymentMethodsMock.mockResolvedValue({
      data: [makeCard({ id: 'spm_1', stripePaymentMethodId: 'pm_1', isDefault: true })],
    });

    render(withProviders(<PaymentMethodsList />));
    await waitFor(() => expect(listStripePaymentMethodsMock).toHaveBeenCalled());

    expect(
      screen.queryByRole('button', { name: /billing\.real\.payment_method\.add/ }),
    ).not.toBeInTheDocument();
  });
});
