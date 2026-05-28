// ── Boutique — Retours & RMA — Sprint 69 ─────────────────────────────────────
// Gestion globale des demandes de retour (RMA) du tenant.
// Table premium avec recherche (ID retour ou commande), filtre de statut,
// tri, et Pull-to-refresh.
// Clic sur une ligne → SlidePanel de détail avec inspection des articles,
// remise en stock (restock) et actions d'administration (approuver/rejeter/recevoir).
// Gated par <ModuleGuard module="ecommerce">.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  PageHero, Card, EmptyState, Button, Skeleton, Tag, Input, Select, Icon,
  useToast, SlidePanel,
} from '@/components/ui';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { useAuth } from '@/lib/auth';
import {
  listAllReturns, updateOrderReturn, getEcommerceOrder, rmaStatusKey,
} from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';
import type { ReturnRequest, Order } from '@/lib/types';
import {
  RotateCcw, Search, RefreshCw, AlertTriangle, ChevronRight, CheckCircle2, XCircle, PackageOpen, ClipboardList,
} from 'lucide-react';



function rmaStatusVariant(s: string) {
  switch (s) {
    case 'refunded': return 'success';
    case 'rejected': return 'danger';
    case 'received':
    case 'approved': return 'info';
    default: return 'neutral';
  }
}

export function RetoursPage() {
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Filtres
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('recent');


  // Detail panel
  const [selectedReturn, setSelectedReturn] = useState<ReturnRequest | null>(null);

  // Debounce recherche
  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 320);
    return () => clearTimeout(h);
  }, [search]);

  const load = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      // Le backend supporte de lister tous les retours du tenant.
      // S'il y a un debouncedSearch, on filtre côté client sur cette page paginée
      const res = await listAllReturns();
      setReturns(res.data || []);
    } catch {
      setLoadError(true);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    void load();
  }, [statusFilter]);

  // Tri et filtrage côté client
  const visible = useMemo(() => {
    let rows = returns;
    if (debouncedSearch) {
      rows = rows.filter((r) => {
        const rid = r.id.toLowerCase();
        const oid = r.order_id.toLowerCase();
        return rid.includes(debouncedSearch) || oid.includes(debouncedSearch);
      });
    }
    if (statusFilter) {
      rows = rows.filter((r) => r.status === statusFilter);
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const da = a.created_at;
      const db = b.created_at;
      return sort === 'oldest' ? (da < db ? -1 : 1) : (da < db ? 1 : -1);
    });
    return sorted;
  }, [returns, debouncedSearch, statusFilter, sort]);

  // Pull-to-refresh
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await load(); }, { scrollParent: scrollParentRef });

  const hasFilters = Boolean(debouncedSearch || statusFilter);

  return (
    <AppLayout title={t('shop.returns.title')}>
      <div ref={ptr.containerRef}>
        <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
        <PageHero
          meta={t('shop.nav')}
          title={t('shop.returns.title')}
          highlight={t('shop.returns.title')}
          description={t('shop.returns.description')}
        />

        {/* Filtres */}
        <div className="flex flex-col md:flex-row gap-3 mb-5">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
            <Input
              className="pl-9"
              placeholder={t('shop.returns.search')}
              aria-label={t('shop.returns.search')}
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
            />
          </div>
          <Select
            className="md:w-52"
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            aria-label={t('shop.returns.filter_all_status')}
          >
            <option value="">{t('shop.returns.filter_all_status')}</option>
            <option value="pending">{t('shop.rma.st_pending')}</option>
            <option value="approved">{t('shop.rma.st_approved')}</option>
            <option value="received">{t('shop.rma.st_received')}</option>
            <option value="refunded">{t('shop.rma.st_refunded')}</option>
            <option value="rejected">{t('shop.rma.st_rejected')}</option>
          </Select>
          <Select
            className="md:w-52"
            value={sort}
            onChange={(e: any) => setSort(e.target.value)}
            aria-label={t('shop.order.sort_aria')}
          >
            <option value="recent">{t('shop.order.sort_recent')}</option>
            <option value="oldest">{t('shop.order.sort_oldest')}</option>
          </Select>
        </div>

        {isLoading ? (
          <Card className="p-0 overflow-hidden" aria-busy="true" role="status">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-3 w-20 rounded" />)}
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {[1, 2, 3, 4, 5].map((i) => (
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
          <Card className="p-0 overflow-hidden" role="alert" aria-live="assertive">
            <EmptyState
              variant="compact"
              icon={<AlertTriangle size={32} strokeWidth={1.8} />}
              meta={t('shop.nav')}
              title={t('shop.order.error_title')}
              description={t('shop.order.error_desc')}
              action={
                <Button onClick={() => void load()} leftIcon={<RefreshCw size={14} />}>
                  {t('shop.order.retry')}
                </Button>
              }
            />
          </Card>
        ) : visible.length === 0 ? (
          <Card className="p-0 overflow-hidden">
            <EmptyState
              variant={hasFilters ? 'filtered' : 'first-time'}
              icon={<RotateCcw size={32} strokeWidth={1.8} />}
              meta={t('shop.nav')}
              title={hasFilters ? t('shop.returns.empty_filtered_title') : t('shop.returns.empty_title')}
              description={hasFilters ? t('shop.returns.empty_filtered_desc') : t('shop.returns.empty_desc')}
              action={
                hasFilters && (
                  <Button
                    variant="ghost"
                    leftIcon={<RefreshCw size={14} />}
                    onClick={() => { setSearch(''); setStatusFilter(''); }}
                  >
                    {t('shop.reset_filters')}
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
                    <th>{t('shop.returns.col_return')}</th>
                    <th>{t('shop.returns.col_order')}</th>
                    <th>{t('shop.returns.col_reason')}</th>
                    <th>{t('shop.returns.col_date')}</th>
                    <th>{t('shop.returns.col_status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                      onClick={() => setSelectedReturn(r)}
                    >
                      <td className="font-medium text-[13px]">
                        <span className="flex items-center gap-1.5 hover:text-[var(--primary)] font-semibold">
                          #{r.id.slice(0, 8)} <ChevronRight size={14} className="text-[var(--text-muted)]" />
                        </span>
                      </td>
                      <td className="text-[12px] font-mono text-[var(--text-secondary)]">
                        #{r.order_id.slice(0, 8)}
                      </td>
                      <td className="text-[12px] text-[var(--text-secondary)] truncate max-w-xs" title={r.reason || ''}>
                        {r.reason || '—'}
                      </td>
                      <td className="text-[12px] text-[var(--text-muted)]">
                        {formatDate(r.created_at, getLocale())}
                      </td>
                      <td>
                        <Tag dot size="sm" variant={rmaStatusVariant(r.status)}>
                          {t(rmaStatusKey(r.status))}
                        </Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <ReturnDetailPanel
        rma={selectedReturn}
        open={Boolean(selectedReturn)}
        onOpenChange={(o) => { if (!o) setSelectedReturn(null); }}
        onChanged={() => { void load(); setSelectedReturn(null); }}
      />
    </AppLayout>
  );
}

interface ReturnDetailPanelProps {
  rma: ReturnRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

function ReturnDetailPanel({ rma, open, onOpenChange, onChanged }: ReturnDetailPanelProps) {
  const { success, error: toastError } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && rma) {
      setOrder(null);
      setLoading(true);
      getEcommerceOrder(rma.order_id)
        .then((res) => {
          setOrder(res.data || null);
        })
        .catch(() => {
          setOrder(null);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, rma]);

  const handleAction = async (action: 'approve' | 'receive' | 'reject') => {
    if (!rma) return;
    setBusy(true);
    try {
      const res = await updateOrderReturn(rma.id, action);
      if (res.error) {
        toastError(res.error || t('shop.returns.error'));
      } else {
        success(t('shop.rma.updated'));
        onChanged();
      }
    } catch {
      toastError(t('shop.returns.error'));
    } finally {
      setBusy(false);
    }
  };

  // Met en relation les rma_items avec les order_items correspondants
  const itemsWithDetails = useMemo(() => {
    if (!rma?.items || !order?.items) return [];
    return rma.items.map((it) => {
      const oi = order.items?.find((x) => x.id === it.order_item_id);
      return {
        ...it,
        title: oi?.product_title_snapshot || t('shop.untitled'),
        variantTitle: oi?.variant_title_snapshot,
        sku: oi?.sku_snapshot,
      };
    });
  }, [rma, order]);

  if (!rma) return null;

  return (
    <SlidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={`${t('shop.returns.detail_title')} #${rma.id.slice(0, 8)}`}
      size="md"
    >
      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-1/2 rounded" />
          <Skeleton className="h-24 w-full rounded" />
          <Skeleton className="h-32 w-full rounded" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Statut du retour */}
          <section className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-1">
                {t('shop.returns.col_status')}
              </span>
              <Tag dot variant={rmaStatusVariant(rma.status)}>
                {t(rmaStatusKey(rma.status))}
              </Tag>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-1 text-right">
                {t('shop.returns.col_date')}
              </span>
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                {formatDate(rma.created_at, getLocale())}
              </span>
            </div>
          </section>

          {/* Commande associée */}
          <section>
            <h4 className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2 uppercase tracking-[0.05em]">
              {t('shop.returns.col_order')}
            </h4>
            <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3 flex justify-between items-center">
              <div>
                <p className="text-[13px] font-semibold">
                  {t('shop.order.title')} {order?.order_number || `#${rma.order_id.slice(0, 8)}`}
                </p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {order?.customer_email || order?.email}
                </p>
              </div>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                ID: {rma.order_id.slice(0, 8)}
              </span>
            </div>
          </section>

          {/* Raison */}
          <section>
            <h4 className="text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5 uppercase tracking-[0.05em]">
              {t('shop.returns.col_reason')}
            </h4>
            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed italic bg-[var(--bg-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
              {rma.reason || '—'}
            </p>
          </section>

          {/* Liste des articles retournés */}
          <section>
            <h4 className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2.5 uppercase tracking-[0.05em] flex items-center gap-1.5">
              <Icon as={ClipboardList} size="sm" className="text-[var(--text-muted)]" />
              {t('shop.returns.items_returned')}
            </h4>
            <ul className="flex flex-col gap-2">
              {itemsWithDetails.map((it) => (
                <li
                  key={it.id}
                  className="flex items-center gap-3 text-[13px] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 bg-[var(--bg-surface)] hover:shadow-xs transition-shadow"
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold block truncate" title={it.title}>
                      {it.title}
                    </span>
                    {it.variantTitle && (
                      <span className="text-[11px] text-[var(--text-muted)] block truncate mt-0.5">
                        {it.variantTitle}
                      </span>
                    )}
                    {it.sku && (
                      <span className="text-[10px] font-mono text-[var(--text-muted)] block mt-0.5">
                        SKU: {it.sku}
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                    <span className="font-semibold text-[13px]">
                      Qté: {it.quantity}
                    </span>
                    <Tag size="sm" variant={it.restock ? 'success' : 'neutral'}>
                      {it.restock ? t('shop.returns.restock_yes') : t('shop.returns.restock_no')}
                    </Tag>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Actions d'administration */}
          {isAdmin && (
            <section className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
              <h4 className="text-[12px] font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-[0.05em]">
                {t('shop.order.actions')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {rma.status === 'pending' && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-1.5 text-[var(--success)]"
                      disabled={busy}
                      onClick={() => handleAction('approve')}
                    >
                      <Icon as={CheckCircle2} size="sm" />
                      {t('shop.returns.act_approve')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-[var(--danger)]"
                      disabled={busy}
                      onClick={() => handleAction('reject')}
                    >
                      <Icon as={XCircle} size="sm" />
                      {t('shop.returns.act_reject')}
                    </Button>
                  </>
                )}
                {rma.status === 'approved' && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-1.5"
                      disabled={busy}
                      onClick={() => handleAction('receive')}
                    >
                      <Icon as={PackageOpen} size="sm" />
                      {t('shop.returns.act_receive')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-[var(--danger)]"
                      disabled={busy}
                      onClick={() => handleAction('reject')}
                    >
                      <Icon as={XCircle} size="sm" />
                      {t('shop.returns.act_reject')}
                    </Button>
                  </>
                )}
              </div>
            </section>
          )}

          {/* Timeline de cycle de vie */}
          <section className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-2">
              Historique
            </span>
            <div className="text-[11px] text-[var(--text-muted)] space-y-1">
              <p>Demandé le : {formatDate(rma.created_at, getLocale())}</p>
              {rma.updated_at !== rma.created_at && (
                <p>Dernière mise à jour le : {formatDate(rma.updated_at, getLocale())}</p>
              )}
            </div>
          </section>
        </div>
      )}
    </SlidePanel>
  );
}
