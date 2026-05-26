// ── POSReceiptPreview — Sprint 37 (POS retail) ──────────────────────────────
// Modal d'aperçu reçu thermique 80mm + actions (Imprimer / Email / PDF /
// Réimprimer). Aperçu rendu en monospace 280px de large pour matcher la sortie
// imprimante. Imports relatifs (règle Sprint 37), aria-labels i18n, style
// Stripe-clean (modal blanc, surface reçu fond gris léger).
//
// CSS @media print : seule la zone `.pos-receipt-print-area` est imprimée — le
// reste du chrome (boutons, header modal) est masqué pour produire un ticket
// propre. Cette feuille de style est injectée localement via <style> scoped
// au composant (pas de pollution globale).
import { useState } from 'react';
import type { ReceiptPayload, PosPaymentMethod } from '../../lib/api';
import { t, getLocale } from '../../lib/i18n';
import { formatMoneyCents } from '../../lib/i18n/number';
import { formatDateTime } from '../../lib/i18n/datetime';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

export interface POSReceiptPreviewProps {
  payload: ReceiptPayload;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onReprint?: () => void;
  onEmail?: (email: string) => void;
  receiptUrl?: string;
}

// Tronque un titre d'article à N chars (default 20) pour respecter la largeur
// d'un ticket thermique 80mm en monospace.
function truncateTitle(title: string, max: number = 20): string {
  if (title.length <= max) return title;
  return title.slice(0, max - 1) + '…';
}

function paymentMethodLabel(method: PosPaymentMethod): string {
  switch (method) {
    case 'cash':
      return t('pos.payment_cash');
    case 'card_terminal':
      return t('pos.payment_card');
    case 'split':
      return t('pos.payment_split');
    case 'gift_card':
      return 'Carte cadeau';
    case 'other':
      return 'Autre';
    default:
      return String(method);
  }
}

// Formatte la date du reçu — utilise formatDateTime du module datetime.
// Locale active via getLocale().
function formatReceiptDate(iso: string): string {
  try {
    return formatDateTime(iso, getLocale());
  } catch {
    return iso;
  }
}

export function POSReceiptPreview({
  payload,
  open = true,
  onOpenChange,
  onReprint,
  onEmail,
  receiptUrl,
}: POSReceiptPreviewProps) {
  const [emailPromptOpen, setEmailPromptOpen] = useState(false);
  const [emailInput, setEmailInput] = useState('');

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const handleReprint = () => {
    handlePrint();
    onReprint?.();
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    onEmail?.(trimmed);
    setEmailInput('');
    setEmailPromptOpen(false);
  };

  const subtotalFormatted = formatMoneyCents(payload.subtotalCents, getLocale());
  const totalFormatted = formatMoneyCents(payload.totalCents, getLocale());
  const tenderedFormatted =
    payload.tenderedCents !== undefined
      ? formatMoneyCents(payload.tenderedCents, getLocale())
      : null;
  const changeFormatted =
    payload.changeCents !== undefined
      ? formatMoneyCents(payload.changeCents, getLocale())
      : null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange ?? (() => {})}
      title={t('pos.receipt')}
      size="md"
    >
      {/* Print-only CSS : masque tout sauf la zone reçu lors de window.print() */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .pos-receipt-print-area,
          .pos-receipt-print-area * { visibility: visible !important; }
          .pos-receipt-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 80mm !important;
            padding: 4mm !important;
            background: white !important;
            color: black !important;
            box-shadow: none !important;
            border: none !important;
          }
          .pos-receipt-no-print { display: none !important; }
        }
      `}</style>

      <div className="flex flex-col gap-5">
        {/* Aperçu reçu — monospace 280px (~80mm), fond gris léger Stripe-clean */}
        <div
          className="pos-receipt-print-area mx-auto"
          style={{
            width: '280px',
            padding: '16px',
            background: 'var(--bg-muted, #F7F8FA)',
            border: '1px solid var(--border, #E5E7EB)',
            borderRadius: 'var(--radius-md, 6px)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: '12px',
            lineHeight: '1.5',
            color: 'var(--text-primary, #0F111A)',
          }}
          role="region"
          aria-label={t('pos.receipt')}
          data-testid="pos-receipt-preview-area"
        >
          {/* Header — tenantName centré */}
          <div
            className="text-center font-semibold"
            style={{ fontSize: '13px', marginBottom: '8px' }}
            data-testid="pos-receipt-tenant"
          >
            {payload.tenantName}
          </div>

          {/* Méta : n° transaction + n° order + date */}
          <div
            style={{
              borderTop: '1px dashed currentColor',
              borderBottom: '1px dashed currentColor',
              padding: '6px 0',
              marginBottom: '8px',
            }}
          >
            <div className="flex justify-between">
              <span>Tx</span>
              <span data-testid="pos-receipt-txid">{payload.transactionId}</span>
            </div>
            <div className="flex justify-between">
              <span>Cmd</span>
              <span data-testid="pos-receipt-order">{payload.orderNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Date</span>
              <span data-testid="pos-receipt-date">{formatReceiptDate(payload.placedAt)}</span>
            </div>
          </div>

          {/* Lignes items — tableau monospace */}
          <table
            style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}
            aria-label="Items"
          >
            <tbody>
              {payload.items.map((item, idx) => {
                const lineTotal = formatMoneyCents(item.line_total_cents, getLocale());
                return (
                  <tr key={`${item.sku ?? item.title}-${idx}`} data-testid={`pos-receipt-item-${idx}`}>
                    <td style={{ padding: '2px 0', wordBreak: 'break-word' }}>
                      {truncateTitle(item.title)}
                    </td>
                    <td style={{ padding: '2px 4px', textAlign: 'right' }}>×{item.quantity}</td>
                    <td style={{ padding: '2px 0', textAlign: 'right' }}>{lineTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Totaux */}
          <div
            style={{
              borderTop: '1px dashed currentColor',
              paddingTop: '6px',
              marginBottom: '8px',
            }}
          >
            <div className="flex justify-between">
              <span>Sous-total</span>
              <span data-testid="pos-receipt-subtotal">{subtotalFormatted}</span>
            </div>
            {payload.taxLines.map((tax, idx) => (
              <div className="flex justify-between" key={`${tax.label}-${idx}`}>
                <span>{tax.label}</span>
                <span data-testid={`pos-receipt-tax-${idx}`}>
                  {formatMoneyCents(tax.amount_cents, getLocale())}
                </span>
              </div>
            ))}
            <div
              className="flex justify-between font-semibold"
              style={{ marginTop: '4px', fontSize: '13px' }}
            >
              <span>Total</span>
              <span data-testid="pos-receipt-total">{totalFormatted}</span>
            </div>
          </div>

          {/* Paiement */}
          <div
            style={{
              borderTop: '1px dashed currentColor',
              paddingTop: '6px',
              marginBottom: '8px',
            }}
          >
            <div className="flex justify-between">
              <span>Paiement</span>
              <span data-testid="pos-receipt-payment-method">
                {paymentMethodLabel(payload.paymentMethod)}
              </span>
            </div>
            {payload.paymentMethod === 'cash' && tenderedFormatted && (
              <>
                <div className="flex justify-between">
                  <span>{t('pos.tendered')}</span>
                  <span data-testid="pos-receipt-tendered">{tenderedFormatted}</span>
                </div>
                {changeFormatted && (
                  <div className="flex justify-between">
                    <span>{t('pos.change_due')}</span>
                    <span data-testid="pos-receipt-change">{changeFormatted}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer : cashier + register */}
          <div
            className="text-center"
            style={{
              borderTop: '1px dashed currentColor',
              paddingTop: '6px',
              fontSize: '11px',
            }}
          >
            <div data-testid="pos-receipt-cashier">{payload.cashierName}</div>
            <div data-testid="pos-receipt-register">{payload.registerName}</div>
          </div>
        </div>

        {/* Actions — masquées en print */}
        <div className="pos-receipt-no-print flex flex-wrap gap-2 justify-end">
          <Button
            variant="secondary"
            size="md"
            onClick={handlePrint}
            aria-label={t('pos.print_receipt')}
            data-testid="pos-receipt-btn-print"
          >
            {t('pos.print_receipt')}
          </Button>

          <Button
            variant="secondary"
            size="md"
            onClick={() => setEmailPromptOpen(true)}
            aria-label={t('pos.email_receipt')}
            data-testid="pos-receipt-btn-email"
          >
            {t('pos.email_receipt')}
          </Button>

          {receiptUrl ? (
            <a
              href={receiptUrl}
              download
              className="inline-flex items-center justify-center h-9 px-4 text-sm font-medium rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] shadow-[var(--shadow-xs)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
              aria-label={t('pos.download_pdf')}
              data-testid="pos-receipt-btn-pdf"
            >
              {t('pos.download_pdf')}
            </a>
          ) : (
            <Button
              variant="secondary"
              size="md"
              disabled
              aria-label={t('pos.download_pdf')}
              data-testid="pos-receipt-btn-pdf"
            >
              {t('pos.download_pdf')}
            </Button>
          )}

          <Button
            variant="primary"
            size="md"
            onClick={handleReprint}
            aria-label={t('pos.reprint')}
            data-testid="pos-receipt-btn-reprint"
          >
            {t('pos.reprint')}
          </Button>
        </div>

        {/* Mini-prompt email — inline form (pas de window.prompt natif pour rester
            testable + cohérent Stripe-clean) */}
        {emailPromptOpen && (
          <form
            onSubmit={handleEmailSubmit}
            className="pos-receipt-no-print flex gap-2 items-center border-t border-[var(--border)] pt-4"
            data-testid="pos-receipt-email-form"
          >
            <input
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="adresse@exemple.com"
              aria-label={t('pos.email_receipt')}
              data-testid="pos-receipt-email-input"
              className="flex-1 h-9 px-3 text-sm rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              data-testid="pos-receipt-email-submit"
            >
              {t('pos.email_receipt')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => {
                setEmailPromptOpen(false);
                setEmailInput('');
              }}
            >
              Annuler
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}

// Re-export helper utilitaire pour cohérence imports ailleurs si besoin.
export { truncateTitle as __posReceiptTruncateTitle };

export default POSReceiptPreview;
