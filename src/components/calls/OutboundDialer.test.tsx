// @vitest-environment jsdom
// ── OutboundDialer — Sprint 34 (Agent B1) — tests ────────────────────────────
// Pattern repris de PaymentMethodsList.test.tsx :
//   - vi.mock du module relatif `../../lib/api` + `../../lib/i18n` (t identity)
//   - ToastProvider wrapper requis (le composant utilise useToast)
//   - Imports APRÈS les mocks
//
// Cas couverts :
//   1. Render base (titre + input + 12 touches numpad + bouton "call" disabled)
//   2. Click 1-2-3 → input vaut "123"
//   3. Backspace → input vaut "12"
//   4. Type "+15145551234" → bouton enabled
//   5. Toggle record ON → checkbox consent visible → bouton disabled tant que !consent
//   6. Mock initiateOutboundCall → { data: { mock: true } } → toast warning
//   7. initiateOutboundCall succès réel → toast success
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Mocks ──────────────────────────────────────────────────────────────────
const initiateOutboundCallMock = vi.fn();

vi.mock('../../lib/api', () => ({
  initiateOutboundCall: (...args: unknown[]) => initiateOutboundCallMock(...args),
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
import { OutboundDialer } from './OutboundDialer';
import { ToastProvider } from '../ui/Toast';

function withProviders(ui: ReactNode) {
  return <ToastProvider>{ui}</ToastProvider>;
}

function getCallButton() {
  return screen.getByTestId('dialer-call-button') as HTMLButtonElement;
}

function getNumberInput() {
  return screen.getByTestId('dialer-number-input') as HTMLInputElement;
}

describe('<OutboundDialer /> — Sprint 34 (Agent B1)', () => {
  beforeEach(() => {
    initiateOutboundCallMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('rend le titre, l\'input, 12 touches numpad et le bouton call disabled au mount', () => {
    render(withProviders(<OutboundDialer />));

    // Titre (via clé i18n)
    expect(screen.getAllByText('voice.outbound.cta').length).toBeGreaterThan(0);

    // Input numéro présent et vide
    const input = getNumberInput();
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('');

    // 12 touches numpad présentes
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    for (const k of keys) {
      expect(screen.getByTestId(`dialer-key-${k}`)).toBeInTheDocument();
    }
    const numpad = screen.getByTestId('dialer-numpad');
    expect(within(numpad).getAllByRole('button')).toHaveLength(12);

    // Bouton call disabled (numéro vide)
    expect(getCallButton()).toBeDisabled();
  });

  it('click sur 1-2-3 → input vaut "123"', () => {
    render(withProviders(<OutboundDialer />));
    fireEvent.click(screen.getByTestId('dialer-key-1'));
    fireEvent.click(screen.getByTestId('dialer-key-2'));
    fireEvent.click(screen.getByTestId('dialer-key-3'));
    expect(getNumberInput().value).toBe('123');
  });

  it('backspace → retire le dernier chiffre ("123" → "12")', () => {
    render(withProviders(<OutboundDialer />));
    fireEvent.click(screen.getByTestId('dialer-key-1'));
    fireEvent.click(screen.getByTestId('dialer-key-2'));
    fireEvent.click(screen.getByTestId('dialer-key-3'));
    expect(getNumberInput().value).toBe('123');

    fireEvent.click(screen.getByTestId('dialer-backspace'));
    expect(getNumberInput().value).toBe('12');
  });

  it('type "+15145551234" → bouton enabled (E.164 valide)', () => {
    render(withProviders(<OutboundDialer />));
    const input = getNumberInput();
    fireEvent.change(input, { target: { value: '+15145551234' } });
    expect(input.value).toBe('+15145551234');
    expect(getCallButton()).not.toBeDisabled();
  });

  it('toggle record ON → checkbox consent visible → bouton disabled tant que !consent', () => {
    render(withProviders(<OutboundDialer />));

    // Numéro valide
    fireEvent.change(getNumberInput(), { target: { value: '+15145551234' } });
    expect(getCallButton()).not.toBeDisabled();

    // Pas de consent visible au mount (record OFF)
    expect(screen.queryByTestId('dialer-consent-checkbox')).not.toBeInTheDocument();

    // Active le record via le Switch (role=switch)
    const recordSwitch = screen.getByRole('switch');
    fireEvent.click(recordSwitch);

    // Consent checkbox apparaît
    const consentCheckbox = screen.getByTestId('dialer-consent-checkbox') as HTMLInputElement;
    expect(consentCheckbox).toBeInTheDocument();
    expect(consentCheckbox.checked).toBe(false);

    // Bouton call disabled car record+!consent
    expect(getCallButton()).toBeDisabled();

    // Coche le consent → bouton enabled
    fireEvent.click(consentCheckbox);
    expect(consentCheckbox.checked).toBe(true);
    expect(getCallButton()).not.toBeDisabled();
  });

  it('initiateOutboundCall retourne { data: { mock: true } } → toast "voice.outbound.mock"', async () => {
    initiateOutboundCallMock.mockResolvedValue({
      data: { id: 'cl_mock_1', status: 'mock', mock: true, conversation_id: null },
    });

    render(withProviders(<OutboundDialer />));
    fireEvent.change(getNumberInput(), { target: { value: '+15145551234' } });
    fireEvent.click(getCallButton());

    await waitFor(() => {
      expect(initiateOutboundCallMock).toHaveBeenCalledTimes(1);
    });
    expect(initiateOutboundCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+15145551234', record: false }),
    );

    // Toast warning "voice.outbound.mock" rendu
    await waitFor(() => {
      expect(screen.getByText('voice.outbound.mock')).toBeInTheDocument();
    });
  });

  it('initiateOutboundCall succès réel → toast "voice.outbound.success"', async () => {
    initiateOutboundCallMock.mockResolvedValue({
      data: { id: 'cl_real_1', status: 'queued', conversation_id: 'conv_1' },
    });

    render(withProviders(<OutboundDialer />));
    fireEvent.change(getNumberInput(), { target: { value: '+15145551234' } });
    fireEvent.click(getCallButton());

    await waitFor(() => {
      expect(initiateOutboundCallMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText('voice.outbound.success')).toBeInTheDocument();
    });
  });
});
