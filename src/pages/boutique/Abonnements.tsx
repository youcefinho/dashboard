// ── Boutique — Abonnements produit (réels) — Sprint 4 LOT E-COMMERCE B2 ─────
// ⚠ NE PAS confondre avec les abonnements billing SaaS agences : namespace
//   boutique/ distinct, table product_subscriptions (seq 85).
//
// PHASE C (Manager-C) = CORPS RÉEL. Table-premium (pattern Commandes.tsx) :
// client / variante / quantité / intervalle / prochaine commande / cycles /
// statut Tag dot. Création + édition via Modal, actions pause/reprise/
// annulation + suppression, bouton « lancer le cycle » (run-due).
// Wirée getEcommerceSubscriptions / create / update / delete / runDue
// (helpers FIGÉS Phase A). i18n 100% ecommerce.subscriptions.* (clés FIGÉES).
//
// MODÈLE COD/mock — AUCUN PAIEMENT EXPOSÉ : un abonnement = renouvellement
// automatique de commande (cycle logique), zéro champ/écran de prélèvement.
// docs/LOT-ECOM4.md §6.E. <ModuleGuard module="ecommerce"> au niveau route.

import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  PageHero, Card, EmptyState, Button, Skeleton, Tag, Input, Select, Modal,
  useToast, useConfirm,
} from '@/components/ui';
import {
  getEcommerceSubscriptions,
  createEcommerceSubscription,
  updateEcommerceSubscription,
  deleteEcommerceSubscription,
  runDueSubscriptions,
  type ProductSubscription,
} from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import { Repeat, Plus, RefreshCw, AlertTriangle, Play, Pause, Trash2, X } from 'lucide-react';

const PAGE_SIZE = 25;

type IntervalUnit = 'day' | 'week' | 'month';

interface FormState {
  customer_id: string;
  variant_id: string;
  quantity: number;
  interval_unit: IntervalUnit;
  interval_count: number;
  unit_price_cents: number;
  currency: string;
}

const EMPTY_FORM: FormState = {
  customer_id: '',
  variant_id: '',
  quantity: 1,
  interval_unit: 'month',
  interval_count: 1,
  unit_price_cents: 0,
  currency: 'CAD',
};

function intervalLabel(unit: string): string {
  if (unit === 'day') return t('ecommerce.subscriptions.interval_day');
  if (unit === 'week') return t('ecommerce.subscriptions.interval_week');
  return t('ecommerce.subscriptions.interval_month');
}

function statusLabel(status: string): string {
  if (status === 'paused') return t('ecommerce.subscriptions.status_paused');
  if (status === 'cancelled') return t('ecommerce.subscriptions.status_cancelled');
  return t('ecommerce.subscriptions.status_active');
}

function statusVariant(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'paused') return 'warning';
  if (status === 'cancelled') return 'neutral';
  return 'success';
}

export function AbonnementsPage() {
  const locale = getLocale();
  const { success, error } = useToast();
  const confirm = useConfirm();

  const [subs, setSubs] = useState<ProductSubscription[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);

  // Modal création / édition
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await getEcommerceSubscriptions({
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setSubs((res.data as ProductSubscription[]) || []);
      setTotal(res.total ?? (res.data?.length ?? 0));
    } catch {
      setLoadError(true);
    }
    setIsLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [statusFilter, page]);
  useEffect(() => { setPage(0); }, [statusFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(statusFilter);

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (s: ProductSubscription) => {
    setEditId(s.id);
    setForm({
      customer_id: s.customer_id || '',
      variant_id: s.variant_id || '',
      quantity: s.quantity || 1,
      interval_unit: (['day', 'week', 'month'].includes(s.interval_unit)
        ? s.interval_unit
        : 'month') as IntervalUnit,
      interval_count: s.interval_count || 1,
      unit_price_cents: s.unit_price_cents || 0,
      currency: s.currency || 'CAD',
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.variant_id.trim()) {
      error(t('ecommerce.subscriptions.error_save'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        customer_id: form.customer_id.trim() || null,
        variant_id: form.variant_id.trim(),
        quantity: form.quantity,
        interval_unit: form.interval_unit,
        interval_count: form.interval_count,
        unit_price_cents: form.unit_price_cents,
        currency: form.currency,
      };
      const res = editId
        ? await updateEcommerceSubscription(editId, payload)
        : await createEcommerceSubscription(payload);
      // Discrimination erreur = absence data / présence texte error (JAMAIS code).
      if (!res.data || res.error) {
        error(res.error || t('ecommerce.subscriptions.error_save'));
      } else {
        success(t('ecommerce.subscriptions.title'));
        setModalOpen(false);
        await load();
      }
    } catch {
      error(t('ecommerce.subscriptions.error_save'));
    }
    setSaving(false);
  };

  const setStatus = async (s: ProductSubscription, status: 'active' | 'paused' | 'cancelled') => {
    if (status === 'cancelled') {
      const ok = await confirm({
        title: t('ecommerce.subscriptions.cancel'),
        description: t('ecommerce.subscriptions.confirm_cancel_desc'),
        confirmLabel: t('ecommerce.subscriptions.cancel'),
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const res = await updateEcommerceSubscription(s.id, { status });
      if (!res.data || res.error) {
        error(res.error || t('ecommerce.subscriptions.error_save'));
      } else {
        success(statusLabel(status));
        await load();
      }
    } catch {
      error(t('ecommerce.subscriptions.error_save'));
    }
  };

  const remove = async (s: ProductSubscription) => {
    const ok = await confirm({
      title: t('common.delete'),
      description: t('ecommerce.subscriptions.confirm_delete_desc'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await deleteEcommerceSubscription(s.id);
      if (res.error) {
        error(res.error || t('ecommerce.subscriptions.error_save'));
      } else {
        success(t('common.delete'));
        await load();
      }
    } catch {
      error(t('ecommerce.subscriptions.error_save'));
    }
  };

  const runDue = async () => {
    const ok = await confirm({
      title: t('ecommerce.subscriptions.next_run'),
      description: t('ecommerce.subscriptions.confirm_run_due'),
      confirmLabel: t('ecommerce.subscriptions.next_run'),
    });
    if (!ok) return;
    setRunning(true);
    try {
      const res = await runDueSubscriptions();
      if (!res.data || res.error) {
        error(res.error || t('ecommerce.subscriptions.error_load'));
      } else {
        success(`${t('ecommerce.subscriptions.cycles')}: ${res.data.processed}`);
        await load();
      }
    } catch {
      error(t('ecommerce.subscriptions.error_load'));
    }
    setRunning(false);
  };

  const subsView = useMemo(() => subs, [subs]);

  return (
    <AppLayout title={t('ecommerce.subscriptions.title')}>
      <PageHero
        meta={t('shop.nav')}
        title={t('ecommerce.subscriptions.title')}
        highlight={t('ecommerce.subscriptions.title')}
        description={t('ecommerce.subscriptions.subtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" className="gap-2" disabled={running} onClick={() => void runDue()}>
              <RefreshCw size={16} /> {t('ecommerce.subscriptions.next_run')}
            </Button>
            <Button className="gap-2" onClick={openCreate}>
              <Plus size={16} /> {t('ecommerce.subscriptions.new')}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <Select className="md:w-52" value={statusFilter}
          onChange={(e: any) => setStatusFilter(e.target.value)}
          aria-label={t('ecommerce.subscriptions.status_active')}>
          <option value="">{t('ecommerce.subscriptions.status_active')} / {t('ecommerce.subscriptions.status_paused')} / {t('ecommerce.subscriptions.status_cancelled')}</option>
          <option value="active">{t('ecommerce.subscriptions.status_active')}</option>
          <option value="paused">{t('ecommerce.subscriptions.status_paused')}</option>
          <option value="cancelled">{t('ecommerce.subscriptions.status_cancelled')}</option>
        </Select>
      </div>

      {isLoading ? (
        <Card className="p-0 overflow-hidden" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">{t('common.loading')}</span>
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-3 w-20 rounded" />)}
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
        <Card className="p-0 overflow-hidden">
          <EmptyState
            variant="compact"
            icon={<AlertTriangle size={32} strokeWidth={1.8} />}
            meta={t('shop.nav')}
            title={t('ecommerce.subscriptions.error_load')}
            description={t('ecommerce.subscriptions.error_load')}
            action={
              <Button onClick={() => void load()} leftIcon={<RefreshCw size={14} />}>
                {t('ecommerce.subscriptions.next_run')}
              </Button>
            }
          />
        </Card>
      ) : subsView.length === 0 ? (
        <Card className="p-0 overflow-hidden">
          <EmptyState
            variant={hasFilters ? 'filtered' : 'first-time'}
            icon={<Repeat size={32} strokeWidth={1.8} />}
            meta={t('shop.nav')}
            title={t('ecommerce.subscriptions.empty_title')}
            description={t('ecommerce.subscriptions.empty_desc')}
            action={
              !hasFilters && (
                <Button onClick={openCreate} leftIcon={<Plus size={14} />}>
                  {t('ecommerce.subscriptions.new')}
                </Button>
              )
            }
            secondaryAction={
              hasFilters && (
                <Button variant="ghost" leftIcon={<RefreshCw size={14} />}
                  onClick={() => setStatusFilter('')}>
                  {t('ecommerce.subscriptions.status_active')}
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
                  <th className="col-frozen text-left" style={{ minWidth: 160 }}>
                    {t('ecommerce.subscriptions.customer')}
                  </th>
                  <th className="text-left">{t('ecommerce.subscriptions.variant')}</th>
                  <th className="text-right">{t('ecommerce.subscriptions.quantity')}</th>
                  <th className="text-left">{t('ecommerce.subscriptions.interval')}</th>
                  <th className="text-left">{t('ecommerce.subscriptions.next_run')}</th>
                  <th className="text-right">{t('ecommerce.subscriptions.cycles')}</th>
                  <th className="text-left">{t('ecommerce.subscriptions.status_active')}</th>
                  <th className="text-right">{t('common.close')}</th>
                </tr>
              </thead>
              <tbody>
                {subsView.map((s, idx) => (
                  <tr
                    key={s.id}
                    className="list-item-enter cursor-pointer"
                    style={{ animationDelay: `${idx * 24}ms` }}
                    onClick={() => openEdit(s)}
                  >
                    <td className="col-frozen font-medium">
                      <span className="block truncate max-w-[200px]">{s.customer_id || '—'}</span>
                    </td>
                    <td className="text-[13px]">
                      <span className="block truncate max-w-[220px]">{s.variant_id || '—'}</span>
                      {s.unit_price_cents > 0 && (
                        <span className="block text-[11px] text-[var(--text-muted)]">
                          {formatMoneyCents(s.unit_price_cents, locale, s.currency || 'CAD')}
                        </span>
                      )}
                    </td>
                    <td className="text-right t-mono-num">{s.quantity}</td>
                    <td className="text-[12px] text-[var(--text-secondary)] whitespace-nowrap">
                      {s.interval_count > 1 ? `${s.interval_count} ` : ''}
                      {intervalLabel(s.interval_unit)}
                    </td>
                    <td className="text-[12px] text-[var(--text-secondary)] whitespace-nowrap">
                      {s.next_run_at ? formatDate(s.next_run_at, locale) : '—'}
                    </td>
                    <td className="text-right t-mono-num">{s.cycles_completed}</td>
                    <td>
                      <Tag dot size="sm" variant={statusVariant(s.status)}>
                        {statusLabel(s.status)}
                      </Tag>
                    </td>
                    <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex gap-1">
                        {s.status === 'active' ? (
                          <Button variant="ghost" size="sm" title={t('ecommerce.subscriptions.pause')}
                            onClick={() => void setStatus(s, 'paused')}>
                            <Pause size={14} />
                          </Button>
                        ) : s.status === 'paused' ? (
                          <Button variant="ghost" size="sm" title={t('ecommerce.subscriptions.resume')}
                            onClick={() => void setStatus(s, 'active')}>
                            <Play size={14} />
                          </Button>
                        ) : null}
                        {s.status !== 'cancelled' && (
                          <Button variant="ghost" size="sm" title={t('ecommerce.subscriptions.cancel')}
                            onClick={() => void setStatus(s, 'cancelled')}>
                            <X size={14} />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" title={t('common.delete')}
                          onClick={() => void remove(s)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border-subtle)] text-[12px]">
              <span className="text-[var(--text-muted)]">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={page === 0}
                  aria-label={t('action.previous')}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  ←
                </Button>
                <Button variant="ghost" size="sm" disabled={page >= totalPages - 1}
                  aria-label={t('action.next')}
                  onClick={() => setPage((p) => p + 1)}>
                  →
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editId ? t('ecommerce.subscriptions.title') : t('ecommerce.subscriptions.new')}
        description={t('ecommerce.subscriptions.subtitle')}
        closeLabel={t('common.close')}
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="text-[var(--text-secondary)]">{t('ecommerce.subscriptions.customer')}</span>
            <Input value={form.customer_id}
              onChange={(e: any) => setForm((f) => ({ ...f, customer_id: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="text-[var(--text-secondary)]">{t('ecommerce.subscriptions.variant')}</span>
            <Input value={form.variant_id}
              onChange={(e: any) => setForm((f) => ({ ...f, variant_id: e.target.value }))} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="text-[var(--text-secondary)]">{t('ecommerce.subscriptions.quantity')}</span>
              <Input type="number" min={1} value={form.quantity}
                onChange={(e: any) => setForm((f) => ({ ...f, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }))} />
            </label>
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="text-[var(--text-secondary)]">{t('ecommerce.subscriptions.interval')}</span>
              <Select value={form.interval_unit}
                onChange={(e: any) => setForm((f) => ({ ...f, interval_unit: e.target.value as IntervalUnit }))}>
                <option value="day">{t('ecommerce.subscriptions.interval_day')}</option>
                <option value="week">{t('ecommerce.subscriptions.interval_week')}</option>
                <option value="month">{t('ecommerce.subscriptions.interval_month')}</option>
              </Select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="text-[var(--text-secondary)]">{t('ecommerce.subscriptions.interval')}</span>
              <Input type="number" min={1} value={form.interval_count}
                onChange={(e: any) => setForm((f) => ({ ...f, interval_count: Math.max(1, parseInt(e.target.value, 10) || 1) }))} />
            </label>
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="text-[var(--text-secondary)]">{t('ecommerce.currency.CAD')}</span>
              <Select value={form.currency}
                onChange={(e: any) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                <option value="CAD">{t('ecommerce.currency.CAD')}</option>
                <option value="EUR">{t('ecommerce.currency.EUR')}</option>
                <option value="DZD">{t('ecommerce.currency.DZD')}</option>
              </Select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="text-[var(--text-secondary)]">{t('ecommerce.subscriptions.variant')}</span>
            <Input type="number" min={0} value={form.unit_price_cents}
              onChange={(e: any) => setForm((f) => ({ ...f, unit_price_cents: Math.max(0, parseInt(e.target.value, 10) || 0) }))} />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              {t('common.close')}
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {t('ecommerce.subscriptions.new')}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
