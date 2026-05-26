// ── Sprint 22 — Billing Stripe prod (E4 flag mock) — Manager-C ──────────────
// Liste tabulaire des invoices mock. Colonnes : Date / Numéro / Montant /
// Statut / Actions. Empty state si vide. Status mappé via i18n.
// Fetch interne via listBillingInvoices() au mount si `invoices` non fourni.
import { useEffect, useState } from 'react';
import { Card, Badge, Skeleton, EmptyState, Icon } from '@/components/ui';
import { Receipt, Download, ExternalLink } from 'lucide-react';
import { t, getLocale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';
import { formatMoneyCents } from '@/lib/i18n/number';
import { listBillingInvoices } from '@/lib/api';
import type { BillingInvoiceMock } from '@/lib/types';

export interface BillingInvoicesListProps {
  invoices?: BillingInvoiceMock[];
  loading?: boolean;
}

type InvoiceStatus = BillingInvoiceMock['status'];

const STATUS_INTENT: Record<InvoiceStatus, 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'> = {
  draft: 'neutral',
  open: 'info',
  paid: 'success',
  void: 'neutral',
  uncollectible: 'danger',
};

function statusLabel(status: InvoiceStatus): string {
  switch (status) {
    case 'draft': return t('billing.invoices.status.draft');
    case 'open': return t('billing.invoices.status.open');
    case 'paid': return t('billing.invoices.status.paid');
    case 'void': return t('billing.invoices.status.void');
    case 'uncollectible': return t('billing.invoices.status.uncollectible');
  }
}

export function BillingInvoicesList(props: BillingInvoicesListProps) {
  const [internalInvoices, setInternalInvoices] = useState<BillingInvoiceMock[] | undefined>(
    props.invoices,
  );
  const [internalLoading, setInternalLoading] = useState<boolean>(
    props.loading ?? props.invoices === undefined,
  );

  useEffect(() => {
    if (props.invoices !== undefined) {
      setInternalInvoices(props.invoices);
      setInternalLoading(props.loading ?? false);
      return;
    }
    let active = true;
    setInternalLoading(true);
    listBillingInvoices()
      .then((res) => {
        if (!active) return;
        if (res.error || !res.data) {
          // Dégrade gracieusement : liste vide
          setInternalInvoices([]);
          return;
        }
        setInternalInvoices(res.data);
      })
      .catch(() => {
        if (active) setInternalInvoices([]);
      })
      .finally(() => {
        if (active) setInternalLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.invoices, props.loading]);

  if (internalLoading) {
    return (
      <Card className="p-0 overflow-hidden" data-component="BillingInvoicesList">
        <div className="p-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </Card>
    );
  }

  const invoices = internalInvoices ?? [];

  if (invoices.length === 0) {
    return (
      <Card className="p-0" data-component="BillingInvoicesList">
        <EmptyState
          icon={<Icon as={Receipt} size={48} />}
          title={t('billing.invoices.empty')}
          description={t('billing.invoices.empty_desc')}
          variant="compact"
        />
      </Card>
    );
  }

  const locale = getLocale();

  return (
    <Card className="p-0 overflow-hidden" data-component="BillingInvoicesList">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)]">
              <th className="text-left px-4 py-2.5 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                {t('billing.invoices.col_date')}
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                {t('billing.invoices.col_number')}
              </th>
              <th className="text-right px-4 py-2.5 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                {t('billing.invoices.col_amount')}
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                {t('billing.invoices.col_status')}
              </th>
              <th className="text-right px-4 py-2.5 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                {t('billing.invoices.col_actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const dateStr = inv.createdAt
                ? formatDate(new Date(inv.createdAt), locale)
                : '—';
              const amountStr = formatMoneyCents(inv.amountDueCents, locale, inv.currency || 'CAD');
              const intent = STATUS_INTENT[inv.status] ?? 'neutral';
              const url = inv.pdfUrl || inv.hostedInvoiceUrl;
              return (
                <tr
                  key={inv.id}
                  className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-subtle)] transition-colors"
                >
                  <td className="px-4 py-3 text-[var(--text-secondary)] whitespace-nowrap">
                    {dateStr}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[var(--text-primary)]">
                    {inv.number || '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[var(--text-primary)] whitespace-nowrap">
                    {amountStr}
                  </td>
                  <td className="px-4 py-3">
                    <Badge intent={intent} fill="soft" size="sm">
                      {statusLabel(inv.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {url ? (
                      <div className="inline-flex items-center gap-2">
                        {inv.pdfUrl && (
                          <a
                            href={inv.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--primary)] hover:underline"
                            aria-label={t('billing.invoices.download')}
                          >
                            <Icon as={Download} size={13} />
                            {t('billing.invoices.download')}
                          </a>
                        )}
                        {inv.hostedInvoiceUrl && (
                          <a
                            href={inv.hostedInvoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--primary)] hover:underline"
                            aria-label={t('billing.invoices.view_online')}
                          >
                            <Icon as={ExternalLink} size={13} />
                            {t('billing.invoices.view_online')}
                          </a>
                        )}
                      </div>
                    ) : (
                      <span className="text-[var(--text-muted)] text-[12px]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default BillingInvoicesList;
