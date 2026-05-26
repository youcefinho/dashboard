// ── PayoutsManager — Sprint 49 (Agent B2) ────────────────────────────────────
//
// Gestion des versements (payouts mensuels) d'affiliés (LOT AFFILIATES S49,
// seq144). Liste les payouts du tenant avec filtre par statut, modale de
// création de batch (period_start → period_end), et action `Mark Paid` par
// ligne pour les payouts pending (V1 = payout MANUEL admin, Stripe Connect
// inactif).
//
// Helpers FIGÉS consommés (cf src/lib/api.ts §11267-11311) :
//   - listAffiliates()                              → ApiResponse<AffiliateExtended[]>
//   - listPayouts(filters?)                         → ApiResponse<AffiliatePayout[]>
//   - createPayoutBatch({ period_start, period_end }) → ApiResponse<{ payouts_created, total_cents }>
//   - markPayoutPaid(id, body?)                     → ApiResponse<AffiliatePayout>
//
// Capability HANDLER : `settings.manage` (action sensible, escalade vs
// `clients.manage`). Le front N'IMPOSE PAS le gate (HANDLER source de vérité).
//
// i18n : namespace `affiliates.payouts.*` (clés FIGÉES, cf fr-CA.ts §6073-6076)
// + clés communes (`action.*`, `common.*`). Parité 4 catalogues garantie côté
// Manager-A. Aria-labels traduits.
//
// Style : Stripe-clean (Card surfaces + table-premium + Tag status + Modal
// sobre). Imports RELATIFS (consigne agent B2 sprint 49).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listAffiliates,
  listPayouts,
  createPayoutBatch,
  markPayoutPaid,
  type AffiliateExtended,
  type AffiliatePayout,
  type AffiliatePayoutStatus,
} from '../../lib/api';
import { t } from '../../lib/i18n';
import { Card } from '../ui/Card';
import { Tag } from '../ui/Tag';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { DollarSign, Plus, CheckCircle2 } from 'lucide-react';

// ── Helpers présentation ────────────────────────────────────────────────────

/** Mapping statut payout → variant Tag (Stripe-sober color-code). */
const PAYOUT_TAG: Record<AffiliatePayoutStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  paid: 'success',
  failed: 'danger',
};

/** Libellé statut payout — passe par i18n (clés `affiliates.payouts.status.*`
 *  ajoutées au sprint S52 reinforcement). Pas de fallback FR-hardcode. */
function payoutStatusLabel(status: AffiliatePayoutStatus): string {
  switch (status) {
    case 'pending':
      return t('affiliates.payouts.status.pending');
    case 'paid':
      return t('affiliates.payouts.status.paid');
    case 'failed':
      return t('affiliates.payouts.status.failed');
    default:
      return status;
  }
}

/** Formatage montant cents → CAD (fr-CA). */
function fmtCents(cents?: number | null): string {
  const n = typeof cents === 'number' ? cents / 100 : 0;
  try {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(n);
  } catch {
    return `${n.toFixed(2)} CAD`;
  }
}

/** Formatage date ISO → fr-CA court (YYYY-MM-DD). */
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-CA');
}

// ── Composant ────────────────────────────────────────────────────────────────

export function PayoutsManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [payouts, setPayouts] = useState<AffiliatePayout[]>([]);
  const [affiliates, setAffiliates] = useState<AffiliateExtended[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filtre statut (all par défaut). `all` = pas de filtre côté API.
  const [filterStatus, setFilterStatus] = useState<AffiliatePayoutStatus | 'all'>('all');

  // Modale createBatch
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchPeriodStart, setBatchPeriodStart] = useState('');
  const [batchPeriodEnd, setBatchPeriodEnd] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);

  // Action markPaid (track ligne en cours pour disable bouton)
  const [markingId, setMarkingId] = useState<string | null>(null);

  // ── Chargement liste payouts + affiliates (pour lookup nom) ───────────────
  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const filters: { status?: AffiliatePayoutStatus } = {};
    if (filterStatus !== 'all') filters.status = filterStatus;
    const [pRes, aRes] = await Promise.all([
      listPayouts(filters),
      listAffiliates(),
    ]);
    if (pRes.error) {
      setLoadError(pRes.error);
    } else if (pRes.data) {
      setPayouts(pRes.data);
    }
    if (aRes.data) {
      setAffiliates(aRes.data);
    }
    setIsLoading(false);
  }, [filterStatus]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Lookup affiliate_id → nom affichable (fallback email/code/id).
  const affiliateNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of affiliates) {
      map.set(a.id, a.name || a.email || a.code || a.id);
    }
    return map;
  }, [affiliates]);

  // ── Action createBatch ────────────────────────────────────────────────────
  const openCreateBatch = () => {
    setBatchPeriodStart('');
    setBatchPeriodEnd('');
    setBatchModalOpen(true);
  };

  const handleCreateBatch = async () => {
    if (!batchPeriodStart || !batchPeriodEnd) return;
    setBatchBusy(true);
    const res = await createPayoutBatch({
      period_start: batchPeriodStart,
      period_end: batchPeriodEnd,
    });
    setBatchBusy(false);
    if (res.data) {
      setBatchModalOpen(false);
      success(
        `${res.data.payouts_created} ${t('affiliates.payouts.title')} · ${fmtCents(res.data.total_cents)}`,
      );
      void loadAll();
    } else {
      toastError(res.error || t('affiliates.payouts.create_batch'));
    }
  };

  // ── Action markPaid (confirm avant action destructive Stripe-equivalent) ──
  const handleMarkPaid = async (p: AffiliatePayout) => {
    const ok = await confirm({
      title: t('affiliates.payouts.mark_paid'),
      description: `${t('affiliates.payouts.mark_paid.confirm')} — ${fmtCents(p.total_cents)}`,
      confirmLabel: t('affiliates.payouts.mark_paid'),
      cancelLabel: t('action.cancel'),
    });
    if (!ok) return;
    setMarkingId(p.id);
    const res = await markPayoutPaid(p.id);
    setMarkingId(null);
    if (res.data) {
      // Update optimistic dans l'état local (et re-filter si filtre actif).
      setPayouts((prev) =>
        prev
          .map((x) => (x.id === p.id ? { ...x, ...res.data } : x))
          .filter((x) =>
            filterStatus === 'all' ? true : x.status === filterStatus,
          ),
      );
      success(t('affiliates.payouts.mark_paid'));
    } else {
      toastError(res.error || t('affiliates.payouts.mark_paid'));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const canSubmitBatch =
    batchPeriodStart.trim().length > 0 &&
    batchPeriodEnd.trim().length > 0 &&
    batchPeriodStart <= batchPeriodEnd;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar : filtre status + bouton createBatch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label
            htmlFor="payouts-filter-status"
            className="prop-label text-sm"
          >
            {t('common.status')}
          </label>
          <Select
            id="payouts-filter-status"
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as AffiliatePayoutStatus | 'all')
            }
            aria-label={t('action.filter')}
          >
            <option value="all">{t('affiliates.payouts.all_statuses')}</option>
            <option value="pending">{payoutStatusLabel('pending')}</option>
            <option value="paid">{payoutStatusLabel('paid')}</option>
            <option value="failed">{payoutStatusLabel('failed')}</option>
          </Select>
        </div>
        <Button
          variant="primary"
          leftIcon={<Icon as={Plus} size="sm" />}
          onClick={openCreateBatch}
          aria-label={t('affiliates.payouts.create_batch')}
        >
          {t('affiliates.payouts.create_batch')}
        </Button>
      </div>

      {/* Liste payouts */}
      {isLoading ? (
        <div
          className="flex flex-col gap-2"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t('affiliates.payouts.title')}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : loadError ? (
        <Card className="p-6">
          <div role="alert" className="space-y-2">
            <p className="text-sm font-medium text-danger">
              {t('common.loading_error')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{loadError}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadAll()}
              aria-label={t('action.retry')}
            >
              {t('action.retry')}
            </Button>
          </div>
        </Card>
      ) : payouts.length === 0 ? (
        <EmptyState
          icon={<Icon as={DollarSign} size={40} />}
          title={t('affiliates.payouts.title')}
          description={t('affiliates.payouts.empty')}
          action={
            <Button
              variant="primary"
              leftIcon={<Icon as={Plus} size="sm" />}
              onClick={openCreateBatch}
            >
              {t('affiliates.payouts.create_batch')}
            </Button>
          }
        />
      ) : (
        <div className="table-premium-container affiliate-table-wrap">
          <table className="table-premium">
            <thead>
              <tr>
                <th>{t('affiliates.title')}</th>
                <th>{t('affiliates.payouts.period')}</th>
                <th className="text-right">
                  {t('affiliates.total_commissions')}
                </th>
                <th className="text-right">
                  {t('affiliates.referrals.title')}
                </th>
                <th>{t('common.status')}</th>
                <th>{t('affiliates.payouts.stripe_transfer')}</th>
                <th>
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => {
                const status: AffiliatePayoutStatus =
                  (p.status as AffiliatePayoutStatus) || 'pending';
                const affName =
                  (p.affiliate_id && affiliateNameById.get(p.affiliate_id)) ||
                  p.affiliate_id ||
                  '—';
                return (
                  <tr key={p.id} className="affiliate-row">
                    <td className="font-medium">{affName}</td>
                    <td className="text-muted tabular-nums">
                      {fmtDate(p.period_start)} → {fmtDate(p.period_end)}
                    </td>
                    <td className="text-right tabular-nums">
                      {fmtCents(p.total_cents)}
                    </td>
                    <td className="text-right tabular-nums">
                      {p.referrals_count ?? 0}
                    </td>
                    <td>
                      <Tag
                        variant={PAYOUT_TAG[status]}
                        size="sm"
                        statusIcon
                      >
                        {payoutStatusLabel(status)}
                      </Tag>
                    </td>
                    <td className="text-xs font-mono text-muted">
                      {p.stripe_transfer_id || '—'}
                    </td>
                    <td>
                      <div className="row-quick-actions flex items-center justify-end gap-1">
                        {status === 'pending' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            isLoading={markingId === p.id}
                            leftIcon={<Icon as={CheckCircle2} size="sm" />}
                            onClick={() => void handleMarkPaid(p)}
                            aria-label={t('affiliates.payouts.mark_paid')}
                          >
                            {t('affiliates.payouts.mark_paid')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal createBatch — period_start → period_end */}
      <Modal
        open={batchModalOpen}
        onOpenChange={setBatchModalOpen}
        title={t('affiliates.payouts.create_batch')}
        size="sm"
      >
        <div className="flex flex-col gap-4 p-1">
          <div>
            <label htmlFor="batch-period-start" className="prop-label">
              {t('affiliates.payouts.period_start')}
            </label>
            <Input
              id="batch-period-start"
              type="date"
              value={batchPeriodStart}
              onChange={(e) => setBatchPeriodStart(e.target.value)}
              autoFocus
              aria-label={t('affiliates.payouts.period_start')}
            />
          </div>
          <div>
            <label htmlFor="batch-period-end" className="prop-label">
              {t('affiliates.payouts.period_end')}
            </label>
            <Input
              id="batch-period-end"
              type="date"
              value={batchPeriodEnd}
              onChange={(e) => setBatchPeriodEnd(e.target.value)}
              aria-label={t('affiliates.payouts.period_end')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setBatchModalOpen(false)}
            >
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              isLoading={batchBusy}
              disabled={!canSubmitBatch}
              onClick={() => void handleCreateBatch()}
              aria-label={t('affiliates.payouts.create_batch')}
            >
              {t('affiliates.payouts.create_batch')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
