// @vitest-environment jsdom
// ── POSReceiptPreview tests — Sprint 37 (POS retail) ────────────────────────
// Couvre : rendu payload (header / items / totals / cashier), action Imprimer
// (window.print mocké), action Email (prompt → callback onEmail), PDF enabled
// avec href correct si receiptUrl fourni, PDF disabled si receiptUrl absent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { POSReceiptPreview } from './POSReceiptPreview';
import type { ReceiptPayload } from '../../lib/api';

const mockPayload: ReceiptPayload = {
  tenantName: 'Boutique Demo Intralys',
  transactionId: 'tx_abc123',
  orderNumber: 'ORD-00042',
  placedAt: '2026-05-24T14:30:00.000Z',
  items: [
    {
      title: 'Café Espresso Single',
      sku: 'CAFE-ESP-01',
      quantity: 2,
      unit_price_cents: 350,
      line_total_cents: 700,
    },
    {
      title: 'Croissant beurre AOP — extra long name to truncate',
      sku: 'PAT-CRO-01',
      quantity: 1,
      unit_price_cents: 425,
      line_total_cents: 425,
    },
  ],
  subtotalCents: 1125,
  taxLines: [
    { label: 'TPS 5%', rate: 0.05, amount_cents: 56 },
    { label: 'TVQ 9.975%', rate: 0.09975, amount_cents: 112 },
  ],
  totalCents: 1293,
  paymentMethod: 'cash',
  tenderedCents: 1500,
  changeCents: 207,
  cashierName: 'Alice T.',
  registerName: 'Caisse 1',
};

describe('POSReceiptPreview', () => {
  beforeEach(() => {
    // Mock window.print — jsdom ne l'implémente pas par défaut.
    Object.defineProperty(window, 'print', {
      writable: true,
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders payload tenant, transaction id, order number and items', () => {
    render(<POSReceiptPreview payload={mockPayload} />);

    expect(screen.getByTestId('pos-receipt-tenant').textContent).toBe(
      'Boutique Demo Intralys',
    );
    expect(screen.getByTestId('pos-receipt-txid').textContent).toBe('tx_abc123');
    expect(screen.getByTestId('pos-receipt-order').textContent).toBe('ORD-00042');

    // 2 items, premier non tronqué, second tronqué à 20 chars (… inclus)
    const item0 = screen.getByTestId('pos-receipt-item-0');
    expect(item0.textContent).toContain('Café Espresso Single');
    expect(item0.textContent).toContain('×2');

    const item1 = screen.getByTestId('pos-receipt-item-1');
    // Titre original 55 chars → tronqué à 20 avec ellipsis
    expect(item1.textContent).toContain('…');
    expect(item1.textContent).toContain('×1');
  });

  it('renders subtotal, tax lines, total and cash payment details', () => {
    render(<POSReceiptPreview payload={mockPayload} />);

    expect(screen.getByTestId('pos-receipt-subtotal').textContent).toMatch(/11[,.]25/);
    expect(screen.getByTestId('pos-receipt-tax-0').textContent).toMatch(/0[,.]56/);
    expect(screen.getByTestId('pos-receipt-tax-1').textContent).toMatch(/1[,.]12/);
    expect(screen.getByTestId('pos-receipt-total').textContent).toMatch(/12[,.]93/);

    // Cash → tendered + change visibles
    expect(screen.getByTestId('pos-receipt-tendered').textContent).toMatch(/15[,.]00/);
    expect(screen.getByTestId('pos-receipt-change').textContent).toMatch(/2[,.]07/);

    expect(screen.getByTestId('pos-receipt-cashier').textContent).toBe('Alice T.');
    expect(screen.getByTestId('pos-receipt-register').textContent).toBe('Caisse 1');
  });

  it('hides tendered/change when payment method is not cash', () => {
    const cardPayload: ReceiptPayload = {
      ...mockPayload,
      paymentMethod: 'card_terminal',
      tenderedCents: undefined,
      changeCents: undefined,
    };
    render(<POSReceiptPreview payload={cardPayload} />);

    expect(screen.queryByTestId('pos-receipt-tendered')).toBeNull();
    expect(screen.queryByTestId('pos-receipt-change')).toBeNull();
  });

  it('calls window.print when "Imprimer" button is clicked', () => {
    render(<POSReceiptPreview payload={mockPayload} />);

    const printBtn = screen.getByTestId('pos-receipt-btn-print');
    fireEvent.click(printBtn);

    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('opens email prompt and invokes onEmail callback on submit', () => {
    const onEmail = vi.fn();
    render(<POSReceiptPreview payload={mockPayload} onEmail={onEmail} />);

    // Prompt absent au mount
    expect(screen.queryByTestId('pos-receipt-email-form')).toBeNull();

    // Click bouton Email → prompt s'ouvre
    fireEvent.click(screen.getByTestId('pos-receipt-btn-email'));
    const form = screen.getByTestId('pos-receipt-email-form');
    expect(form).not.toBeNull();

    // Saisie + submit
    const input = screen.getByTestId('pos-receipt-email-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'client@exemple.com' } });
    fireEvent.submit(form);

    expect(onEmail).toHaveBeenCalledTimes(1);
    expect(onEmail).toHaveBeenCalledWith('client@exemple.com');

    // Prompt referme après submit
    expect(screen.queryByTestId('pos-receipt-email-form')).toBeNull();
  });

  it('does not call onEmail when input is empty', () => {
    const onEmail = vi.fn();
    render(<POSReceiptPreview payload={mockPayload} onEmail={onEmail} />);

    fireEvent.click(screen.getByTestId('pos-receipt-btn-email'));
    const form = screen.getByTestId('pos-receipt-email-form');

    // Submit avec input vide → required HTML5 + guard interne empêchent appel
    // (on bypass la validation native avec preventDefault sur submit handler)
    fireEvent.submit(form);

    expect(onEmail).not.toHaveBeenCalled();
  });

  it('renders PDF button as anchor with download attr when receiptUrl provided', () => {
    render(
      <POSReceiptPreview
        payload={mockPayload}
        receiptUrl="https://cdn.example.com/receipts/tx_abc123.pdf"
      />,
    );

    const pdfBtn = screen.getByTestId('pos-receipt-btn-pdf') as HTMLAnchorElement;
    expect(pdfBtn.tagName).toBe('A');
    expect(pdfBtn.getAttribute('href')).toBe(
      'https://cdn.example.com/receipts/tx_abc123.pdf',
    );
    expect(pdfBtn.hasAttribute('download')).toBe(true);
  });

  it('renders PDF button as disabled button when receiptUrl absent', () => {
    render(<POSReceiptPreview payload={mockPayload} />);

    const pdfBtn = screen.getByTestId('pos-receipt-btn-pdf') as HTMLButtonElement;
    expect(pdfBtn.tagName).toBe('BUTTON');
    expect(pdfBtn.disabled).toBe(true);
  });

  it('calls window.print AND onReprint callback when "Réimprimer" clicked', () => {
    const onReprint = vi.fn();
    render(<POSReceiptPreview payload={mockPayload} onReprint={onReprint} />);

    fireEvent.click(screen.getByTestId('pos-receipt-btn-reprint'));

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(onReprint).toHaveBeenCalledTimes(1);
  });
});
