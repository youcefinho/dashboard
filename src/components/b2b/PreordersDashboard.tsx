// ── PreordersDashboard — Sprint 48 (Agent B2) ────────────────────────────────
// Vue dashboard sur preorder_queue (table seq143). Liste tableau avec
// variant_id, customer_id, email, quantity, status badge, created_at +
// actions (Notify si queued, Cancel, Convert si notified → show order_id).
//
// API back FIGÉE (api.ts §Sprint 48 — Pre-orders) :
//   listPreorders(filters?)                       → ApiResponse<PreorderEntry[]>
//   notifyPreorder(id)                            → ApiResponse<{ notified, email_sent }>
//   cancelPreorder(id)                            → ApiResponse<PreorderEntry>
//   convertPreorderToOrder(id, orderId?)          → ApiResponse<{ preorder, order_id }>
//
// Style : Stripe-clean (Card + Select + Tag color-coded). Imports RELATIFS.
// aria-labels via t() i18n.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Send,
  Ban,
  CheckCircle2,
  Filter,
  ListChecks,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Tag } from '../ui/Tag';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t } from '../../lib/i18n';
import {
  listPreorders,
  notifyPreorder,
  cancelPreorder,
  convertPreorderToOrder,
  type PreorderEntry,
  type PreorderStatus,
} from '../../lib/api';

// ── Status color-coding (Stripe soft tints) ─────────────────────────────────

type TagVariant =
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'accent';

const STATUS_VARIANTS: Record<PreorderStatus, TagVariant> = {
  queued: 'warning',
  notified: 'info',
  converted: 'success',
  cancelled: 'neutral',
};

function statusLabel(s: PreorderStatus): string {
  switch (s) {
    case 'queued':
      return t('preorders.status.queued');
    case 'notified':
      return t('preorders.status.notified');
    case 'converted':
      return t('preorders.status.converted');
    case 'cancelled':
      return t('preorders.status.cancelled');
  }
}

type StatusFilter = 'all' | PreorderStatus;

const STATUS_FILTER_VALUES: StatusFilter[] = [
  'all',
  'queued',
  'notified',
  'converted',
  'cancelled',
];

// ── Helpers format ──────────────────────────────────────────────────────────

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

// ── Composant ───────────────────────────────────────────────────────────────

export function PreordersDashboard() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [preorders, setPreorders] = useState<PreorderEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const filters =
      filterStatus === 'all' ? undefined : { status: filterStatus };
    const res = await listPreorders(filters);
    if (res.error) {
      toastError(res.error);
      setLoadError(res.error);
      setPreorders([]);
    } else if (res.data) {
      setPreorders(res.data);
    }
    setLoading(false);
  }, [filterStatus, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Filtre côté client (en plus de la query — robustesse) ───────────────
  const filteredPreorders = useMemo(() => {
    if (filterStatus === 'all') return preorders;
    return preorders.filter((p) => p.status === filterStatus);
  }, [preorders, filterStatus]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleNotify = useCallback(
    async (p: PreorderEntry) => {
      setBusyId(p.id);
      const res = await notifyPreorder(p.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      if (res.data) {
        success(
          res.data.email_sent
            ? `${t('preorders.notify')} ✓`
            : `${t('preorders.notify')} (${t('preorders.email_deferred')})`,
        );
      } else {
        success(t('preorders.notify'));
      }
      void load();
    },
    [success, toastError, load],
  );

  const handleCancel = useCallback(
    async (p: PreorderEntry) => {
      const ok = await confirm({
        title: t('preorders.cancel'),
        description: `${t('preorders.cancel')} — ${p.email ?? p.id}`,
        confirmLabel: t('preorders.cancel'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(p.id);
      const res = await cancelPreorder(p.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('preorders.cancel'));
      void load();
    },
    [confirm, success, toastError, load],
  );

  const handleConvert = useCallback(
    async (p: PreorderEntry) => {
      setBusyId(p.id);
      const res = await convertPreorderToOrder(p.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      if (res.data?.order_id) {
        success(`${t('preorders.convert')} → ${res.data.order_id}`);
      } else {
        success(t('preorders.convert'));
      }
      void load();
    },
    [success, toastError, load],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" data-testid="preorders-dashboard">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2
            className="text-lg font-semibold flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <Icon as={ListChecks} size={18} /> {t('preorders.title')}
          </h2>
          <p
            className="text-sm mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('preorders.subtitle')}
          </p>
        </div>
      </div>

      {/* ── Filtre statut ─────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="min-w-[200px]">
            <Select
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Icon as={Filter} size={13} />
                  {t('preorders.filter_status')}
                </span>
              }
              value={filterStatus}
              onChange={(e) =>
                setFilterStatus(e.target.value as StatusFilter)
              }
              data-testid="preorders-filter-status"
              aria-label={t('preorders.filter_status')}
            >
              {STATUS_FILTER_VALUES.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? t('preorders.filter_all') : statusLabel(s)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {/* ── Liste tableau ────────────────────────────────────────────────── */}
      {loading ? (
        <Card className="p-4">
          <div
            className="space-y-2"
            data-testid="preorders-loading"
            role="status"
            aria-busy="true"
            aria-live="polite"
            aria-label={t('state.loading')}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        </Card>
      ) : loadError ? (
        <Card className="p-4">
          <div
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)] flex items-start justify-between gap-3 flex-wrap"
            role="alert"
            data-testid="preorders-error"
          >
            <div className="min-w-0">
              <p className="font-medium mb-0.5">{t('common.error.title')}</p>
              <p className="text-xs opacity-80 break-words">{loadError}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load()}
              aria-label={t('common.retry')}
            >
              {t('common.retry')}
            </Button>
          </div>
        </Card>
      ) : filteredPreorders.length === 0 ? (
        <EmptyState
          icon={<Icon as={ListChecks} size={40} />}
          title={t('preorders.empty')}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              data-testid="preorders-list"
              aria-label={t('preorders.title')}
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
                  <th className="px-4 py-2.5 font-semibold">{t('preorders.column.variant_id')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('preorders.column.customer_id')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('preorders.column.email')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('preorders.column.quantity')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('preorders.column.status')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('preorders.column.created_at')}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">
                    {t('preorders.column.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredPreorders.map((p) => {
                  const isBusy = busyId === p.id;
                  const canNotify = p.status === 'queued';
                  const canConvert = p.status === 'notified';
                  const canCancel =
                    p.status === 'queued' || p.status === 'notified';
                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                      data-testid={`preorder-row-${p.id}`}
                    >
                      <td
                        className="px-4 py-3 align-top font-mono text-xs"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {p.variant_id}
                      </td>
                      <td
                        className="px-4 py-3 align-top font-mono text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {p.customer_id}
                      </td>
                      <td
                        className="px-4 py-3 align-top text-xs"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {p.email ?? (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 align-top text-sm"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {p.quantity}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span data-testid={`preorder-status-${p.id}`}>
                          <Tag
                            variant={STATUS_VARIANTS[p.status]}
                            size="sm"
                          >
                            {statusLabel(p.status)}
                          </Tag>
                        </span>
                        {p.converted_order_id ? (
                          <div
                            className="mt-1 text-[10px] font-mono"
                            style={{ color: 'var(--text-muted)' }}
                            data-testid={`preorder-order-id-${p.id}`}
                          >
                            → {p.converted_order_id}
                          </div>
                        ) : null}
                      </td>
                      <td
                        className="px-4 py-3 align-top text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {fmtDate(p.created_at)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {canNotify ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              leftIcon={<Icon as={Send} size="sm" />}
                              onClick={() => void handleNotify(p)}
                              disabled={isBusy}
                              aria-label={`${t('preorders.notify')} — ${p.email ?? p.id}`}
                              data-testid={`preorder-notify-${p.id}`}
                            >
                              {t('preorders.notify')}
                            </Button>
                          ) : null}
                          {canConvert ? (
                            <Button
                              variant="primary"
                              size="sm"
                              leftIcon={<Icon as={CheckCircle2} size="sm" />}
                              onClick={() => void handleConvert(p)}
                              disabled={isBusy}
                              aria-label={`${t('preorders.convert')} — ${p.email ?? p.id}`}
                              data-testid={`preorder-convert-${p.id}`}
                            >
                              {t('preorders.convert')}
                            </Button>
                          ) : null}
                          {canCancel ? (
                            <Button
                              variant="danger"
                              size="sm"
                              leftIcon={<Icon as={Ban} size="sm" />}
                              onClick={() => void handleCancel(p)}
                              disabled={isBusy}
                              aria-label={`${t('preorders.cancel')} — ${p.email ?? p.id}`}
                              data-testid={`preorder-cancel-${p.id}`}
                            >
                              {t('preorders.cancel')}
                            </Button>
                          ) : null}
                        </div>
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

export default PreordersDashboard;
