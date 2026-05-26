// ── DropshipOrdersDashboard — Sprint 47 (Agent B2) ──────────────────────────
// Vue dashboard sur les dropship_orders (table dropship_orders, seq142).
// Affiche les commandes dispatchées chez les fournisseurs avec leur statut,
// numéro de suivi, ref fournisseur. Permet de re-router manuellement un order
// e-commerce vers son/ses supplier(s) via routeOrderToSupplier().
//
// Helpers async FIGÉS (api.ts §Sprint 47 — Dropship Orders) :
//   listDropshipOrders / routeOrderToSupplier + listDropshipSuppliers
//   (pour résoudre supplier_name dans la table).
//
// Style : Stripe-clean (Card + Select + Tag color-coded). Imports RELATIFS.
// aria-labels via t() i18n.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, ShoppingBag, Filter, RefreshCw } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Tag } from '../ui/Tag';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useConfirm } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import {
  listDropshipOrders,
  routeOrderToSupplier,
  listDropshipSuppliers,
} from '../../lib/api';
import type {
  DropshipOrder,
  DropshipOrderStatus,
  DropshipSupplier,
} from '../../lib/api';
import { t } from '../../lib/i18n';

// ── Status color-coding (Stripe soft tints) ─────────────────────────────────

type TagVariant = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

const STATUS_VARIANTS: Record<DropshipOrderStatus, TagVariant> = {
  pending: 'warning',
  sent: 'info',
  confirmed: 'brand',
  shipped: 'accent',
  delivered: 'success',
  failed: 'danger',
};

/**
 * Labels statut — résolus via t() au runtime (Sprint S52 audit/renfort).
 * Conservé en fonction pour permettre la résolution dynamique de la locale.
 */
function getStatusLabels(): Record<DropshipOrderStatus, string> {
  return {
    pending: t('dropship.orders.status.pending'),
    sent: t('dropship.orders.status.sent'),
    confirmed: t('dropship.orders.status.confirmed'),
    shipped: t('dropship.orders.status.shipped'),
    delivered: t('dropship.orders.status.delivered'),
    failed: t('dropship.orders.status.failed'),
  };
}

type StatusFilter = 'all' | DropshipOrderStatus;

const STATUS_FILTER_VALUES: StatusFilter[] = [
  'all',
  'pending',
  'sent',
  'confirmed',
  'shipped',
  'delivered',
  'failed',
];

// ── Composant ───────────────────────────────────────────────────────────────

export function DropshipOrdersDashboard() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const STATUS_LABELS = getStatusLabels();

  const [orders, setOrders] = useState<DropshipOrder[]>([]);
  const [suppliers, setSuppliers] = useState<DropshipSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');

  // "Router order" inline input
  const [routeOrderId, setRouteOrderId] = useState('');
  const [routing, setRouting] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ordersRes, suppliersRes] = await Promise.all([
        listDropshipOrders(),
        listDropshipSuppliers(),
      ]);
      if (ordersRes.data) setOrders(ordersRes.data);
      else if (ordersRes.error) {
        toastError(ordersRes.error);
        setLoadError(ordersRes.error);
      }
      if (suppliersRes.data) setSuppliers(suppliersRes.data);
      else if (suppliersRes.error) {
        toastError(suppliersRes.error);
        if (!ordersRes.error) setLoadError(suppliersRes.error);
      }
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── Index suppliers par id pour lookup name dans la table ───────────────
  const supplierById = useMemo(() => {
    const map = new Map<string, DropshipSupplier>();
    for (const s of suppliers) map.set(s.id, s);
    return map;
  }, [suppliers]);

  // ── Filtre par statut ───────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    if (filterStatus === 'all') return orders;
    return orders.filter((o) => o.status === filterStatus);
  }, [orders, filterStatus]);

  // ── Route order action ──────────────────────────────────────────────────
  const submitRoute = async () => {
    const id = routeOrderId.trim();
    if (!id) {
      toastError(t('dropship.orders.order_id_required'));
      return;
    }
    // Confirm dispatch (notifie le fournisseur — Sprint S52 audit/renfort).
    const ok = await confirm({
      title: t('dropship.orders.route_confirm.title'),
      description: t('dropship.orders.route_confirm.description'),
      confirmLabel: t('dropship.orders.route'),
    });
    if (!ok) return;
    setRouting(true);
    try {
      const res = await routeOrderToSupplier(id);
      if (res.error) {
        toastError(res.error);
        return;
      }
      const result = res.data;
      if (result) {
        success(
          t('dropship.orders.route_success')
            .replace('{routed}', String(result.items_routed))
            .replace('{created}', String(result.dropship_orders.length)),
        );
      } else {
        success(t('dropship.orders.route'));
      }
      setRouteOrderId('');
      await loadAll();
    } finally {
      setRouting(false);
    }
  };

  // ── Format date Intl natif (pas d'override locale ici, le wrapper page le fait) ──
  const fmtDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString('fr-CA', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2
            className="text-lg font-semibold flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <Icon as={ShoppingBag} size={18} /> {t('dropship.orders.title')}
          </h2>
          <p
            className="text-sm mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('dropship.orders.route')} {t('dropship.orders.route_hint')}
          </p>
        </div>
      </div>

      {/* ── Bandeau "Router order" + filtre statut ──────────────────────── */}
      <Card className="p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Input
              label={t('dropship.orders.route')}
              value={routeOrderId}
              onChange={(e) => setRouteOrderId(e.target.value)}
              placeholder="ord_xxxxxxxxxxxx"
              data-testid="dropship-order-route-input"
              aria-label={t('dropship.orders.route')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && routeOrderId.trim() && !routing) {
                  e.preventDefault();
                  void submitRoute();
                }
              }}
            />
          </div>
          <Button
            onClick={() => void submitRoute()}
            disabled={!routeOrderId.trim() || routing}
            isLoading={routing}
            data-testid="dropship-order-route-submit"
            aria-label={t('dropship.orders.route')}
          >
            <Icon as={Send} size={15} /> {t('dropship.orders.route')}
          </Button>

          <div className="min-w-[180px]">
            <Select
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Icon as={Filter} size={13} />
                  {t('common.status') || 'Statut'}
                </span>
              }
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as StatusFilter)}
              data-testid="dropship-order-filter-status"
              aria-label={t('common.status') || 'Statut'}
            >
              {STATUS_FILTER_VALUES.map((s) => (
                <option key={s} value={s}>
                  {s === 'all'
                    ? t('common.all') || 'Tous'
                    : STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {/* ── Inline error (Sprint S52 audit/renfort — additif) ─────────────── */}
      {loadError && !loading ? (
        <div
          role="alert"
          data-testid="dropship-orders-error"
          className="p-4 rounded-lg border border-[var(--danger-soft,var(--border-subtle))] bg-[var(--danger-soft,var(--bg-subtle))] flex items-start justify-between gap-3 flex-wrap"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--danger,var(--text-primary))]">
              {t('common.error.title')}
            </p>
            <p className="text-xs text-[var(--text-secondary)] break-words">
              {loadError}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Icon as={RefreshCw} size={14} aria-hidden="true" />}
            onClick={() => void loadAll()}
            aria-label={t('common.retry')}
            data-testid="dropship-orders-retry"
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {/* ── Liste tableau ────────────────────────────────────────────────── */}
      {loading ? (
        <Card className="p-4" data-testid="dropship-orders-loading" aria-busy="true" aria-live="polite">
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded" />
            <Skeleton className="h-8 w-full rounded" />
            <Skeleton className="h-8 w-full rounded" />
            <Skeleton className="h-8 w-2/3 rounded" />
          </div>
        </Card>
      ) : filteredOrders.length === 0 ? (
        <Card className="p-0" data-testid="dropship-orders-empty">
          <EmptyState
            icon={<Icon as={ShoppingBag} size={32} aria-hidden="true" />}
            title={t('dropship.orders.empty')}
            variant={filterStatus === 'all' ? 'first-time' : 'filtered'}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              data-testid="dropship-order-list"
            >
              <thead>
                <tr
                  className="text-left text-xs uppercase tracking-wide"
                  style={{
                    color: 'var(--text-muted)',
                    background: 'var(--bg-subtle)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <th className="px-4 py-2.5 font-semibold">order_id</th>
                  <th className="px-4 py-2.5 font-semibold">
                    {t('dropship.suppliers.title')}
                  </th>
                  <th className="px-4 py-2.5 font-semibold">supplier_order_ref</th>
                  <th className="px-4 py-2.5 font-semibold">
                    {t('common.status') || 'Statut'}
                  </th>
                  <th className="px-4 py-2.5 font-semibold">
                    {t('dropship.orders.tracking')}
                  </th>
                  <th className="px-4 py-2.5 font-semibold">created_at</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((o) => {
                  const supplier = o.supplier_id
                    ? supplierById.get(o.supplier_id)
                    : null;
                  return (
                    <tr
                      key={o.id}
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      data-testid={`dropship-order-row-${o.id}`}
                    >
                      <td className="px-4 py-3 align-top">
                        {o.order_id ? (
                          <a
                            href={`/orders/${o.order_id}`}
                            className="text-xs font-mono underline-offset-2 hover:underline"
                            style={{ color: 'var(--primary)' }}
                            data-testid={`dropship-order-link-${o.id}`}
                            aria-label={`Order ${o.order_id}`}
                          >
                            {o.order_id}
                          </a>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 align-top"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {supplier?.name ?? (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {o.supplier_id ?? '—'}
                          </span>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 align-top font-mono text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {o.supplier_order_ref ?? '—'}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span data-testid={`dropship-order-status-${o.id}`}>
                          <Tag
                            variant={STATUS_VARIANTS[o.status]}
                            size="sm"
                          >
                            {STATUS_LABELS[o.status]}
                          </Tag>
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 align-top font-mono text-xs"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {o.tracking_number ?? (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 align-top text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {fmtDate(o.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default DropshipOrdersDashboard;
