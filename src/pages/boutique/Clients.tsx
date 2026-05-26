// ── Boutique — Clients + Customer 360 (enrichi) — Sprint E1 M3.3 / E7 M3.2 ──
// ⚠️ NE PAS confondre avec src/pages/Clients.tsx (clients-tenant CRM).
// Namespace boutique/ distinct. Table premium + EmptyState + SlidePanel
// Customer 360 : KPI LTV/AOV multi-devise ventilé (jamais sommé), badge
// segment RFM, timeline unifiée (commandes/remboursements/expéditions/RMA),
// panier actif, lien CRM. Données réelles uniquement (getCustomer360).

import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  PageHero, Card, EmptyState, Skeleton, SlidePanel, Button, Tag, Avatar, Icon,
} from '@/components/ui';
import { RefreshCw } from 'lucide-react';
import { getEcommerceCustomers, getCustomer360 } from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import { rfmSegmentLabelKey, rfmSegmentVariant } from '@/lib/rfm';
import type { Customer, Customer360, RfmSegment } from '@/lib/types';
import {
  Contact, ExternalLink, ShoppingBag, BarChart3, Link2, ShoppingCart,
  RotateCcw, Truck, Undo2, DollarSign,
} from 'lucide-react';

function customerName(c: Customer): string {
  const full = `${c.first_name || ''} ${c.last_name || ''}`.trim();
  return full || c.email;
}

// Timeline unifiée : on normalise les 4 collections de Customer360 en
// événements datés triables. Les payloads refunds/shipments/returns sont
// Record<string,unknown> côté contrat M1 → lecture défensive.
type TlKind = 'order' | 'refund' | 'shipment' | 'return';
interface TlEvent {
  kind: TlKind;
  at: string;
  label: string;
  sub?: string;
  amountCents?: number;
  currency?: string;
}

function str(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}
function num(o: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

function buildTimeline(d: Customer360): TlEvent[] {
  const ev: TlEvent[] = [];
  for (const o of d.orders || []) {
    const at = o.placed_at || o.created_at;
    if (!at) continue;
    ev.push({
      kind: 'order',
      at,
      label: t('shop.customer.ev_order'),
      sub: o.order_number || `#${o.id.slice(0, 8)}`,
      amountCents: o.total_cents ?? undefined,
      currency: o.currency || undefined,
    });
  }
  for (const r of d.refunds || []) {
    const at = str(r, 'created_at', 'refunded_at', 'updated_at');
    if (!at) continue;
    ev.push({
      kind: 'refund',
      at,
      label: t('shop.customer.ev_refund'),
      sub: str(r, 'reason', 'note'),
      amountCents: num(r, 'amount_cents', 'total_cents'),
      currency: str(r, 'currency'),
    });
  }
  for (const s of d.shipments || []) {
    const at = str(s, 'shipped_at', 'created_at', 'updated_at');
    if (!at) continue;
    ev.push({
      kind: 'shipment',
      at,
      label: t('shop.customer.ev_shipment'),
      sub: str(s, 'tracking_number', 'carrier', 'status'),
    });
  }
  for (const rt of d.returns || []) {
    const at = str(rt, 'created_at', 'requested_at', 'updated_at');
    if (!at) continue;
    ev.push({
      kind: 'return',
      at,
      label: t('shop.customer.ev_return'),
      sub: str(rt, 'status', 'reason'),
    });
  }
  return ev.sort((a, b) => (a.at < b.at ? 1 : -1));
}

const TL_ICON: Record<TlKind, typeof ShoppingCart> = {
  order: ShoppingCart,
  refund: RotateCcw,
  shipment: Truck,
  return: Undo2,
};
const TL_COLOR: Record<TlKind, string> = {
  order: 'var(--success)',
  refund: 'var(--warning)',
  shipment: 'var(--primary)',
  return: 'var(--text-muted)',
};

export function BoutiqueClientsPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [detail, setDetail] = useState<Customer360 | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // reloadKey : bump pour relancer le fetch principal après erreur.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    getEcommerceCustomers()
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setLoadError(res.error);
          setCustomers([]);
        } else {
          setCustomers(res.data || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(t('shop.customers.error.load_failed'));
          setCustomers([]);
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Charge l'agrégat 360 à chaque sélection (dégrade : panneau reste
  // utilisable avec les infos de base si l'endpoint M1 échoue).
  useEffect(() => {
    if (!selected) { setDetail(null); setDetailError(null); return; }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    getCustomer360(selected.id)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setDetailError(res.error);
        } else if (res.data) {
          setDetail(res.data);
        }
      })
      .catch(() => {
        if (!cancelled) setDetailError(t('common.error.load_failed'));
      })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const timeline = detail ? buildTimeline(detail) : [];
  const seg: RfmSegment | null =
    (detail?.customer.rfm_segment ?? selected?.rfm_segment) ?? null;
  const hasAnyData =
    !!detail &&
    ((detail.metrics?.orders_count ?? 0) > 0 ||
      timeline.length > 0 ||
      !!detail.active_cart ||
      (detail.spend_by_currency?.length ?? 0) > 0);

  return (
    <AppLayout title={t('shop.customers')}>
      <PageHero
        meta={t('shop.nav')}
        title={t('shop.customers')}
        highlight={t('shop.customers')}
        description="Tes clients boutique, reliés automatiquement à tes leads CRM, avec leur valeur vie, leur segment RFM et leur historique unifié."
      />

      {isLoading ? (
        <Card className="p-0 overflow-hidden" aria-busy="true" data-testid="boutique-clients-loading">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-3 w-20 rounded" />)}
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 w-1/4 rounded" />
                <Skeleton className="h-3 w-32 rounded" />
                <Skeleton className="h-3 w-20 rounded ml-auto" />
              </div>
            ))}
          </div>
        </Card>
      ) : loadError ? (
        <Card className="p-6" aria-live="polite" data-testid="boutique-clients-error">
          <p className="text-sm text-[var(--danger-text)] mb-3">{loadError}</p>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Icon as={RefreshCw} size="sm" />}
            onClick={() => setReloadKey((k) => k + 1)}
            aria-label={t('action.retry')}
            data-testid="boutique-clients-retry"
          >
            {t('action.retry')}
          </Button>
        </Card>
      ) : customers.length === 0 ? (
        <Card className="p-0 overflow-hidden">
          <EmptyState
            variant="first-time"
            icon={<Contact size={32} strokeWidth={1.8} />}
            meta={t('shop.nav')}
            title={t('shop.empty.customers_title')}
            description={t('shop.empty.customers_desc')}
          />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="table-premium-container overflow-x-auto">
            <table className="table-premium">
              <thead>
                <tr>
                  <th className="col-frozen text-left" style={{ minWidth: 220 }}>{t('shop.customers')}</th>
                  <th className="text-left">{t('qc.email')}</th>
                  <th className="text-left">{t('qc.phone')}</th>
                  <th className="text-left">{t('shop.rfm.segment')}</th>
                  <th data-print-hide style={{ width: 48 }}></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c, idx) => (
                  <tr
                    key={c.id}
                    className="list-item-enter cursor-pointer"
                    style={{ animationDelay: `${idx * 28}ms` }}
                    onClick={() => setSelected(c)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(c);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${t('shop.customer_detail')} — ${customerName(c)}`}
                  >
                    <td className="col-frozen font-medium">{customerName(c)}</td>
                    <td className="text-[var(--text-muted)]">{c.email}</td>
                    <td className="text-[var(--text-muted)]">{c.phone || '—'}</td>
                    <td>
                      {c.rfm_segment ? (
                        <Tag size="sm" dot variant={rfmSegmentVariant(c.rfm_segment)}>
                          {t(rfmSegmentLabelKey(c.rfm_segment))}
                        </Tag>
                      ) : (
                        <span className="text-[var(--text-muted)] text-[12px]">{t('shop.rfm.none')}</span>
                      )}
                    </td>
                    <td className="text-right">
                      <ExternalLink size={14} className="text-[var(--text-muted)]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Customer 360 (E7 M3.2) — read-only, données réelles ── */}
      <SlidePanel
        open={!!selected}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
        title={selected ? customerName(selected) : t('shop.customer_detail')}
        description={selected?.email}
        size="md"
      >
        {selected && (
          <div className="space-y-6">
            {/* En-tête client : avatar + identité + badge RFM */}
            <section className="flex items-start gap-3">
              <Avatar name={customerName(selected)} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="t-h3 truncate">{customerName(selected)}</p>
                <p className="text-[13px] text-[var(--text-muted)] break-all">{selected.email}</p>
                {selected.phone && (
                  <p className="text-[12px] text-[var(--text-muted)]">{selected.phone}</p>
                )}
                <div className="mt-2">
                  {seg ? (
                    <Tag size="sm" dot variant={rfmSegmentVariant(seg)}>
                      {t(rfmSegmentLabelKey(seg))}
                    </Tag>
                  ) : (
                    <Tag size="sm" variant="neutral">{t('shop.rfm.none')}</Tag>
                  )}
                </div>
              </div>
            </section>

            {/* KPI LTV / AOV / nb commandes — devise boutique de référence */}
            <section className="pt-4 border-t border-[var(--border-subtle)]">
              {detailLoading && !detail ? (
                <div className="grid grid-cols-3 gap-3" aria-busy="true">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
                </div>
              ) : detailError && !detail ? (
                <p
                  className="text-xs text-[var(--danger-text)] italic"
                  aria-live="polite"
                  data-testid="boutique-customer-detail-error"
                >
                  {detailError}
                </p>
              ) : detail ? (
                <div className="grid grid-cols-3 gap-3">
                  {([
                    ['shop.customer.kpi_ltv', formatMoneyCents(detail.metrics.total_spent_cents, getLocale(), detail.metrics.currency)],
                    ['shop.customer.kpi_aov', formatMoneyCents(detail.metrics.avg_order_value_cents, getLocale(), detail.metrics.currency)],
                    ['shop.customer.kpi_orders', String(detail.metrics.orders_count)],
                  ] as const).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">{t(k)}</p>
                      <p className="t-mono-num font-semibold text-[15px]">{v}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)] italic">{t('shop.customer.no_data')}</p>
              )}

              {/* Ventilation par devise — JAMAIS sommée cross-devise */}
              {detail && detail.spend_by_currency.length > 1 && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                    {t('shop.customer.spend_by_currency')}
                  </p>
                  <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                    {detail.spend_by_currency.map((s) => (
                      <div key={s.currency} className="flex items-center justify-between py-1.5 text-[12px]">
                        <span className="text-[var(--text-secondary)]">
                          {s.currency} · {s.orders_count}×
                        </span>
                        <span className="t-mono-num font-semibold">
                          {formatMoneyCents(s.net_spent_cents, getLocale(), s.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail && (detail.metrics.first_order_at || detail.metrics.last_order_at) && (
                <dl className="grid grid-cols-2 gap-3 text-sm mt-3">
                  {detail.metrics.first_order_at && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">{t('shop.customer.first_order')}</dt>
                      <dd className="text-[13px]">{formatDate(detail.metrics.first_order_at, getLocale())}</dd>
                    </div>
                  )}
                  {detail.metrics.last_order_at && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">{t('shop.customer.last_order')}</dt>
                      <dd className="text-[13px]">{formatDate(detail.metrics.last_order_at, getLocale())}</dd>
                    </div>
                  )}
                </dl>
              )}
            </section>

            {/* Panier actif (si présent) */}
            {detail?.active_cart && (
              <section className="pt-4 border-t border-[var(--border-subtle)]">
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 flex items-center gap-2">
                  <ShoppingCart size={14} strokeWidth={1.8} /> {t('shop.customer.active_cart')}
                </h3>
                {(() => {
                  const c = detail.active_cart as Record<string, unknown>;
                  const items = num(c, 'items_count');
                  const sub = num(c, 'subtotal_cents');
                  const cur = str(c, 'currency') || detail.metrics.currency;
                  return (
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-[var(--text-secondary)]">
                        {t('shop.customer.active_cart_items').replace('{n}', String(items ?? 0))}
                      </span>
                      {sub != null && (
                        <span className="t-mono-num font-semibold">
                          {formatMoneyCents(sub, getLocale(), cur)}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </section>
            )}

            {/* Timeline unifiée — commandes / remboursements / expéditions / RMA */}
            <section className="pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
                <ShoppingBag size={14} strokeWidth={1.8} /> {t('shop.customer.timeline')}
              </h3>
              {detailLoading && !detail ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 rounded" />)}
                </div>
              ) : timeline.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] italic">{t('shop.customer.timeline_empty')}</p>
              ) : (
                <ol className="flex flex-col divide-y divide-[var(--border-subtle)]">
                  {timeline.map((e, i) => {
                    const I = TL_ICON[e.kind];
                    return (
                      <li key={`${e.kind}-${e.at}-${i}`} className="flex items-center gap-3 py-2.5 text-[13px]">
                        <span
                          className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full border border-[var(--border-subtle)]"
                          style={{ color: TL_COLOR[e.kind] }}
                          aria-hidden="true"
                        >
                          <Icon as={I} size="sm" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{e.label}</span>
                          {e.sub && (
                            <span className="text-[var(--text-muted)]"> · {e.sub}</span>
                          )}
                        </span>
                        {e.amountCents != null && (
                          <span className="t-mono-num font-semibold whitespace-nowrap">
                            {formatMoneyCents(e.amountCents, getLocale(), e.currency || detail?.metrics.currency || 'CAD')}
                          </span>
                        )}
                        <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                          {formatDate(e.at, getLocale())}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {!detailLoading && detail && !hasAnyData && (
                <p className="text-xs text-[var(--text-muted)] italic mt-2 inline-flex items-center gap-1.5">
                  <Icon as={DollarSign} size="sm" /> {t('shop.customer.no_data')}
                </p>
              )}
            </section>

            {/* Segment RFM — détail textuel */}
            <section className="pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 flex items-center gap-2">
                <BarChart3 size={14} strokeWidth={1.8} /> {t('shop.section.rfm')}
              </h3>
              {seg ? (
                <Tag size="md" dot variant={rfmSegmentVariant(seg)}>
                  {t(rfmSegmentLabelKey(seg))}
                </Tag>
              ) : (
                <p className="text-xs text-[var(--text-muted)] italic">{t('shop.section.rfm_soon')}</p>
              )}
            </section>

            {/* Lien CRM — réconciliation lead_id (linked_lead M1 prioritaire) */}
            <section className="pt-4 border-t border-[var(--border-subtle)]">
              <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 flex items-center gap-2">
                <Link2 size={14} strokeWidth={1.8} /> {t('shop.section.crm_link')}
              </h3>
              {(() => {
                const leadId = detail?.linked_lead?.id ?? selected.lead_id;
                if (!leadId) {
                  return <p className="text-xs text-[var(--text-muted)] italic">{t('shop.no_linked_lead')}</p>;
                }
                return (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<ExternalLink size={14} />}
                    onClick={() => void navigate({ to: `/leads/${leadId}` })}
                  >
                    {detail?.linked_lead?.name
                      ? `${t('shop.linked_lead')} · ${detail.linked_lead.name}`
                      : t('shop.linked_lead')}
                  </Button>
                );
              })()}
            </section>
          </div>
        )}
      </SlidePanel>
    </AppLayout>
  );
}
