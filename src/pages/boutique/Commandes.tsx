// ── Boutique — Commandes (réelles) — Sprint E3 M3 A1 ────────────────────────
// Remplace le scaffolding E1. Table-premium (pattern Produits.tsx) : n° /
// client+courriel / date / statut Tag dot / paiement / préparation / total CAD.
// Filtres (statut, recherche n°/courriel debounced), tri client, pagination.
// Wirée getEcommerceOrders. EmptyState Sprint 45 (first-time → ManualOrderModal
// / filtered → reset). Clic ligne → OrderDetailPanel.
// <ModuleGuard module="ecommerce"> appliqué au niveau route par E1 (App.tsx).

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  PageHero, Card, EmptyState, Button, Skeleton, Tag, Input, Select, Icon,
} from '@/components/ui';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { getEcommerceOrders } from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import type { Order } from '@/lib/types';
import {
  OrderDetailPanel, orderStatusLabel, orderStatusVariant,
  financialLabel, fulfillmentLabel,
} from '@/components/ecommerce/OrderDetailPanel';
import { ManualOrderModal } from '@/components/ecommerce/ManualOrderModal';
import { ShoppingCart, Plus, Search, RefreshCw, AlertTriangle } from 'lucide-react';

const PAGE_SIZE = 25;

export function CommandesPage() {
  const locale = getLocale();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  // S6 M1.1 — erreur réseau : évite l'écran "première commande" trompeur
  // quand l'API échoue (state visuel pur, logique inchangée).
  const [loadError, setLoadError] = useState(false);

  // Filtres
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Sprint E5 M3.4 — filtre fulfillment ADDITIF (client-side, ne touche pas
  // les filtres E3 statut/recherche/tri ni la pagination serveur).
  const [fulfillmentFilter, setFulfillmentFilter] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(0);

  // Panels
  const [detailId, setDetailId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  // Debounce recherche
  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 320);
    return () => clearTimeout(h);
  }, [search]);

  const load = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await getEcommerceOrders({
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setOrders((res.data as Order[]) || []);
      setTotal(res.total ?? (res.data?.length ?? 0));
    } catch {
      /* silencieux : pas de donnée fictive — état d'erreur visuel honnête */
      setLoadError(true);
    }
    setIsLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [statusFilter, page]);
  // Reset page si filtre statut change
  useEffect(() => { setPage(0); }, [statusFilter]);

  // Recherche + tri côté client (l'API ne filtre que par statut/pagination).
  const visible = useMemo(() => {
    let rows = orders;
    if (debouncedSearch) {
      rows = rows.filter((o) => {
        const num = (o.order_number || o.id).toLowerCase();
        const mail = (o.customer_email || o.email || '').toLowerCase();
        return num.includes(debouncedSearch) || mail.includes(debouncedSearch);
      });
    }
    // Sprint E5 M3.4 — filtre fulfillment ADDITIF (après recherche, avant tri).
    if (fulfillmentFilter) {
      rows = rows.filter((o) => o.fulfillment_status === fulfillmentFilter);
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const da = a.placed_at || a.created_at;
      const db = b.placed_at || b.created_at;
      switch (sort) {
        case 'oldest': return da < db ? -1 : 1;
        case 'total_desc': return b.total_cents - a.total_cents;
        case 'total_asc': return a.total_cents - b.total_cents;
        default: return da < db ? 1 : -1; // recent
      }
    });
    return sorted;
  }, [orders, debouncedSearch, fulfillmentFilter, sort]);

  // Pull-to-refresh (pattern Produits)
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await load(); }, { scrollParent: scrollParentRef });

  const hasFilters = Boolean(debouncedSearch || statusFilter || fulfillmentFilter);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppLayout title={t('shop.orders')}>
      <div ref={ptr.containerRef}>
        <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
        <PageHero
          meta={t('shop.nav')}
          title={t('shop.orders')}
          highlight={t('shop.orders')}
          description="Toutes les commandes de ta boutique : statut, paiement, préparation et total."
          actions={
            <Button className="gap-2" onClick={() => setManualOpen(true)}>
              <Icon as={Plus} size="md" /> {t('shop.order.create')}
            </Button>
          }
        />

        {/* Filtres */}
        <div className="flex flex-col md:flex-row gap-3 mb-5">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
            <Input className="pl-9" placeholder={t('shop.order.search')}
              value={search} onChange={(e: any) => setSearch(e.target.value)} />
          </div>
          <Select className="md:w-52" value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)} aria-label={t('shop.order.status')}>
            <option value="">{t('shop.order.filter_all_status')}</option>
            <option value="pending">{t('shop.order.st_pending')}</option>
            <option value="paid">{t('shop.order.st_paid')}</option>
            <option value="preparing">{t('shop.order.st_preparing')}</option>
            <option value="shipped">{t('shop.order.st_shipped')}</option>
            <option value="delivered">{t('shop.order.st_delivered')}</option>
            <option value="cancelled">{t('shop.order.st_cancelled')}</option>
            <option value="refunded">{t('shop.order.st_refunded')}</option>
          </Select>
          <Select className="md:w-52" value={fulfillmentFilter}
            onChange={(e: any) => setFulfillmentFilter(e.target.value)}
            aria-label={t('shop.order.fulfillment')}>
            <option value="">{t('shop.shipment.filter_all_fulfillment')}</option>
            <option value="unfulfilled">{t('shop.order.ful_unfulfilled')}</option>
            <option value="partial">{t('shop.order.ful_partial')}</option>
            <option value="fulfilled">{t('shop.order.ful_fulfilled')}</option>
          </Select>
          <Select className="md:w-52" value={sort}
            onChange={(e: any) => setSort(e.target.value)} aria-label="Tri">
            <option value="recent">{t('shop.order.sort_recent')}</option>
            <option value="oldest">{t('shop.order.sort_oldest')}</option>
            <option value="total_desc">{t('shop.order.sort_total_desc')}</option>
            <option value="total_asc">{t('shop.order.sort_total_asc')}</option>
          </Select>
        </div>

        {isLoading ? (
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-3 w-20 rounded" />)}
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-1/5 rounded" />
                  <Skeleton className="h-3 w-1/4 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-3 w-16 rounded ml-auto" />
                </div>
              ))}
            </div>
          </Card>
        ) : loadError ? (
          <Card className="p-0 overflow-hidden">
            <EmptyState
              variant="compact"
              icon={<AlertTriangle size={32} strokeWidth={1.8} />}
              meta={t('shop.nav')}
              title="Impossible de charger les commandes"
              description="Une erreur réseau est survenue. Vérifie ta connexion puis réessaie."
              action={
                <Button onClick={() => void load()} leftIcon={<RefreshCw size={14} />}>
                  Réessayer
                </Button>
              }
            />
          </Card>
        ) : visible.length === 0 ? (
          <Card className="p-0 overflow-hidden">
            <EmptyState
              variant={hasFilters ? 'filtered' : 'first-time'}
              icon={<ShoppingCart size={32} strokeWidth={1.8} />}
              meta={t('shop.nav')}
              title={hasFilters ? t('shop.order.empty_filtered_title') : t('shop.order.empty_title')}
              description={hasFilters ? t('shop.order.empty_filtered_desc') : t('shop.order.empty_desc')}
              action={
                !hasFilters && (
                  <Button onClick={() => setManualOpen(true)} leftIcon={<Plus size={14} />}>
                    {t('shop.order.create')}
                  </Button>
                )
              }
              secondaryAction={
                hasFilters && (
                  <Button variant="ghost" leftIcon={<RefreshCw size={14} />}
                    onClick={() => { setSearch(''); setStatusFilter(''); setFulfillmentFilter(''); }}>
                    {t('shop.order.reset_filters')}
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="table-premium-container overflow-x-auto">
              <table className="table-premium">
                <thead>
                  <tr>
                    <th className="col-frozen text-left" style={{ minWidth: 180 }}>
                      {t('shop.order.number')}
                    </th>
                    <th className="text-left">{t('shop.order.customer')}</th>
                    <th className="text-left">{t('shop.order.date')}</th>
                    <th className="text-left">{t('shop.order.status')}</th>
                    <th className="text-left">{t('shop.order.financial')}</th>
                    <th className="text-left">{t('shop.order.fulfillment')}</th>
                    <th className="text-right">{t('shop.order.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((o, idx) => (
                    <tr
                      key={o.id}
                      className="list-item-enter cursor-pointer"
                      style={{ animationDelay: `${idx * 24}ms` }}
                      onClick={() => setDetailId(o.id)}
                      tabIndex={0}
                      role="button"
                      aria-label={`${t('shop.order.title')} ${o.order_number || o.id}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setDetailId(o.id);
                        }
                      }}
                    >
                      <td className="col-frozen font-medium">
                        {o.order_number || `#${o.id.slice(0, 8)}`}
                      </td>
                      <td className="text-[13px]">
                        <span className="block truncate max-w-[220px]">
                          {[o.customer_first_name, o.customer_last_name].filter(Boolean).join(' ')
                            || o.customer_email || o.email || '—'}
                        </span>
                        {(o.customer_email || o.email) && (
                          <span className="block text-[11px] text-[var(--text-muted)] truncate max-w-[220px]">
                            {o.customer_email || o.email}
                          </span>
                        )}
                      </td>
                      <td className="text-[12px] text-[var(--text-secondary)] whitespace-nowrap">
                        {o.placed_at || o.created_at
                          ? formatDate(o.placed_at || o.created_at, locale)
                          : '—'}
                      </td>
                      <td>
                        <Tag dot size="sm" variant={orderStatusVariant(o.status)}>
                          {orderStatusLabel(o.status)}
                        </Tag>
                      </td>
                      <td className="text-[12px]">
                        <Tag size="sm" variant="neutral">{financialLabel(o.financial_status)}</Tag>
                      </td>
                      <td className="text-[12px]">
                        <Tag size="sm" variant="neutral">{fulfillmentLabel(o.fulfillment_status)}</Tag>
                      </td>
                      <td className="text-right font-semibold t-mono-num" style={{ color: 'var(--primary)' }}>
                        {formatMoneyCents(o.total_cents ?? 0, locale, o.currency || 'CAD')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination (serveur — par statut/offset) */}
            {!debouncedSearch && totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border-subtle)] text-[12px]">
                <span className="text-[var(--text-muted)]">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    ← Précédent
                  </Button>
                  <Button variant="ghost" size="sm" disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}>
                    Suivant →
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      <OrderDetailPanel
        orderId={detailId}
        open={Boolean(detailId)}
        onOpenChange={(o) => { if (!o) setDetailId(null); }}
        onChanged={load}
      />
      <ManualOrderModal
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={(id) => setDetailId(id)}
      />
    </AppLayout>
  );
}
