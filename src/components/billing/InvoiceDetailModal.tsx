// ── InvoiceDetailModal — vue détail facture (getInvoice) ─────────────────────
// Surface l'opération invisible `getInvoice(id)` : la liste (getInvoices) ne
// renvoie PAS les lignes d'articles (`items[]`). Ce modal récupère la pièce
// COMPLÈTE à la demande et affiche les lignes + taxes STOCKÉES serveur.
// 100% additif : ne touche ni api.ts, ni les catalogues i18n.
//   - taxes/total = champs STOCKÉS serveur (§6.C), jamais recalculés front
//   - total affiché = `total ?? amount` (rétro-compat legacy §6.I)
//   - état: chargement (Skeleton) / erreur (role="alert" + retry) / contenu

import { useState, useEffect, useCallback } from 'react';
import { getInvoice, type Invoice } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button, Skeleton, Tag } from '@/components/ui';
import { formatCurrency } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import { getLocale, t } from '@/lib/i18n';

interface InvoiceDetailModalProps {
  /** id de la facture à afficher ; null = fermé */
  invoiceId: string | null;
  onClose: () => void;
}

const statusVariant: Record<Invoice['status'], 'neutral' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  sent: 'warning',
  paid: 'success',
  cancelled: 'danger',
};

export function InvoiceDetailModal({ invoiceId, onClose }: InvoiceDetailModalProps) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getInvoice(id);
      // §6.A : apiFetch GELÉ ⇒ discrimination sur présence de data / texte error
      if (res.data) setInvoice(res.data);
      else setError(res.error || t('common.error.load_failed'));
    } catch (err) {
      console.error(err);
      setError(t('common.error.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (invoiceId) {
      setInvoice(null);
      void load(invoiceId);
    }
  }, [invoiceId, load]);

  const locale = getLocale();
  const currency = invoice?.currency || 'CAD';
  const money = (v: number | null | undefined) => formatCurrency(v ?? 0, locale, currency);
  const total = invoice ? (invoice.total ?? invoice.amount ?? 0) : 0;
  const hasBreakdown =
    invoice != null && invoice.subtotal != null && invoice.tax_tps != null && invoice.tax_tvq != null;
  const items = invoice?.items ?? [];

  return (
    <Modal
      open={invoiceId != null}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title={t('invoices.detail.title')}
      size="lg"
      closeLabel={t('invoices.modal.cancel')}
    >
      <div className="space-y-5">
        {isLoading && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-5 w-40 rounded" />
            <Skeleton className="h-3 w-64 rounded" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        )}

        {!isLoading && error && (
          <div
            role="alert"
            className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[var(--danger-soft)] px-4 py-3 flex items-center justify-between gap-3"
          >
            <span className="text-[13px] text-[var(--danger)]">{error}</span>
            {invoiceId && (
              <Button size="sm" variant="secondary" onClick={() => void load(invoiceId)}>
                {t('common.retry')}
              </Button>
            )}
          </div>
        )}

        {!isLoading && !error && invoice && (
          <>
            {/* En-tête : numéro + statut + parties */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[14px] font-semibold text-[var(--primary)]">
                  {invoice.invoice_number || invoice.id}
                </div>
                <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
                  {t('invoices.table.date')} :{' '}
                  {formatDate(invoice.created_at, locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
              <Tag dot size="xs" variant={statusVariant[invoice.status] || 'neutral'}>
                {t(`invoices.status.${invoice.status}`)}
              </Tag>
            </div>

            <div className="grid grid-cols-2 gap-4 text-[12px]">
              <div>
                <div className="text-[var(--text-muted)] uppercase tracking-wide text-[10px] font-bold mb-0.5">
                  {t('invoices.table.client')}
                </div>
                <div className="text-[var(--text-primary)]">
                  {invoice.lead_name || invoice.client_id || '—'}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)] uppercase tracking-wide text-[10px] font-bold mb-0.5">
                  {t('invoice.due_date')}
                </div>
                <div className="text-[var(--text-primary)]">
                  {invoice.due_date
                    ? formatDate(invoice.due_date, locale, { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'}
                </div>
              </div>
            </div>

            {invoice.description && (
              <div className="text-[12px]">
                <div className="text-[var(--text-muted)] uppercase tracking-wide text-[10px] font-bold mb-0.5">
                  {t('invoices.table.desc')}
                </div>
                <div className="text-[var(--text-primary)] leading-relaxed">{invoice.description}</div>
              </div>
            )}

            {/* Lignes d'articles — SEULEMENT disponibles via getInvoice (pas dans la liste) */}
            <div>
              <div className="text-[var(--text-muted)] uppercase tracking-wide text-[10px] font-bold mb-2">
                {t('invoice.items.title')}
              </div>
              {items.length === 0 ? (
                <div className="text-[12px] text-[var(--text-muted)] italic">
                  {t('invoices.detail.items_empty')}
                </div>
              ) : (
                <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-[var(--bg-subtle)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-3 py-2">{t('invoice.items.label')}</th>
                        <th className="text-right font-semibold px-3 py-2 w-16">{t('invoice.items.qty')}</th>
                        <th className="text-right font-semibold px-3 py-2 w-28">{t('invoice.items.unit_price')}</th>
                        <th className="text-right font-semibold px-3 py-2 w-28">{t('invoice.items.line_total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {items.map((it) => (
                        <tr key={it.id}>
                          <td className="px-3 py-2 text-[var(--text-primary)]">{it.label}</td>
                          <td className="px-3 py-2 text-right t-mono-num">{it.qty}</td>
                          <td className="px-3 py-2 text-right t-mono-num">{money(it.unit_price)}</td>
                          <td className="px-3 py-2 text-right t-mono-num font-medium">{money(it.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Totaux — champs STOCKÉS serveur (§6.C), jamais recalculés */}
            <div className="flex justify-end">
              <div className="w-full max-w-xs flex flex-col gap-1 text-[12px]">
                {hasBreakdown ? (
                  <>
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--text-muted)]">{t('invoice.subtotal')}</span>
                      <span className="t-mono-num">{money(invoice.subtotal)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--text-muted)]">{t('invoice.tax_tps')}</span>
                      <span className="t-mono-num">{money(invoice.tax_tps)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--text-muted)]">{t('invoice.tax_tvq')}</span>
                      <span className="t-mono-num">{money(invoice.tax_tvq)}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-[var(--text-muted)] italic">
                    {t('invoices.expand.no_tax_breakdown')}
                  </div>
                )}
                <div className="flex justify-between gap-4 pt-1.5 mt-0.5 border-t border-[var(--border-subtle)]">
                  <span className="font-semibold">{t('invoice.total')}</span>
                  <span className="t-mono-num font-bold" style={{ color: 'var(--primary)' }}>
                    {money(total)}
                  </span>
                </div>
              </div>
            </div>

            {/* Paiement honnête (§6.E) — pas de lien Stripe factice */}
            <div className="text-[11px] text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-3">
              {invoice.status === 'paid' ? t('invoices.status.paid') : t('invoice.payment_offline')}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={onClose}>{t('invoices.modal.cancel')}</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
