// ── ReferralsTable — Sprint 49 (Agent B1) ───────────────────────────────────
// Tableau des referrals (modèle order-based Sprint 49) du tenant courant.
// Filtre status (all/pending/confirmed/paid/reversed). Actions admin :
//   - Confirm   (pending → confirmed)   via confirmReferral(id)
//   - Reverse   (confirmed → reversed)  via reverseReferral(id)
//
// API back FIGÉE :
//   listReferrals({ status? })     → ApiResponse<AffiliateReferral[]>
//   listAffiliates()               → ApiResponse<AffiliateExtended[]>   (lookup name)
//   confirmReferral(id)            → ApiResponse<AffiliateReferral>
//   reverseReferral(id, reason?)   → ApiResponse<AffiliateReferral>
//
// Capability : `clients.manage`. Style Stripe-clean. aria-labels i18n.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react';
import {
  CheckCircle2,
  Undo2,
  Receipt,
  ExternalLink,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t, getLocale } from '../../lib/i18n';
import { formatMoneyCents } from '../../lib/i18n/number';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import {
  listReferrals,
  listAffiliates,
  confirmReferral,
  reverseReferral,
  type AffiliateReferral,
  type AffiliateReferralStatus,
  type AffiliateExtended,
  type ReferralsListFilters,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

type FilterValue = 'all' | AffiliateReferralStatus;

const STATUS_CLASS: Record<AffiliateReferralStatus, string> = {
  pending:
    'bg-amber-50 text-amber-700 border-amber-200',
  confirmed:
    'bg-emerald-50 text-emerald-700 border-emerald-200',
  paid:
    'bg-sky-50 text-sky-700 border-sky-200',
  reversed:
    'bg-rose-50 text-rose-700 border-rose-200',
};

function statusLabel(s: AffiliateReferralStatus): string {
  // Sprint S52 reinforcement : les clés `common.status.*` sont désormais
  // présentes dans les 4 catalogues. Plus de fallback hardcoded FR.
  return t(`common.status.${s}`);
}

function filterLabel(v: FilterValue): string {
  if (v === 'all') return t('common.all');
  return statusLabel(v);
}

// ── Composant ──────────────────────────────────────────────────────────────

export function ReferralsTable() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const locale = useMemo(() => getLocale(), []);

  const [referrals, setReferrals] = useState<AffiliateReferral[]>([]);
  const [affiliates, setAffiliates] = useState<AffiliateExtended[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterValue>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Lookup id → name (déduit listAffiliates). Sinon fallback code/id.
  const affiliateById = useMemo(() => {
    const m = new Map<string, AffiliateExtended>();
    for (const a of affiliates) m.set(a.id, a);
    return m;
  }, [affiliates]);

  // ── Chargement ──────────────────────────────────────────────────────────
  const loadReferrals = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const filters: ReferralsListFilters | undefined =
      filterStatus === 'all' ? undefined : { status: filterStatus };
    const res = await listReferrals(filters);
    if (res.error) {
      setLoadError(res.error);
      toastError(res.error);
      setReferrals([]);
    } else if (res.data) {
      setReferrals(res.data);
    }
    setLoading(false);
  }, [filterStatus, toastError]);

  const loadAffiliatesLookup = useCallback(async () => {
    const res = await listAffiliates();
    if (res.error) {
      // Non-bloquant — la table reste fonctionnelle, juste fallback id.
      setAffiliates([]);
      return;
    }
    if (res.data) setAffiliates(res.data);
  }, []);

  useEffect(() => {
    void loadAffiliatesLookup();
  }, [loadAffiliatesLookup]);

  useEffect(() => {
    void loadReferrals();
  }, [loadReferrals]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(
    async (ref: AffiliateReferral) => {
      setBusyId(ref.id);
      const res = await confirmReferral(ref.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('affiliates.referrals.confirm'));
      void loadReferrals();
    },
    [success, toastError, loadReferrals],
  );

  const handleReverse = useCallback(
    async (ref: AffiliateReferral) => {
      const ok = await confirm({
        title: t('affiliates.referrals.reverse'),
        description: `${t('affiliates.referrals.reverse.confirm')} — ${ref.order_id ?? ref.id}`,
        confirmLabel: t('affiliates.referrals.reverse'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(ref.id);
      const res = await reverseReferral(ref.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('affiliates.referrals.reverse'));
      void loadReferrals();
    },
    [confirm, success, toastError, loadReferrals],
  );

  // ── Filter change ───────────────────────────────────────────────────────
  const handleFilterChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setFilterStatus(e.target.value as FilterValue);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="referrals-table">
      {/* Header + filtre */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('affiliates.referrals.title')}</h2>
        </div>
        <div className="w-full sm:w-56">
          <label
            htmlFor="referrals-filter-status"
            className="text-xs font-medium text-[var(--text-secondary)] block mb-1"
          >
            {t('common.status')}
          </label>
          <Select
            id="referrals-filter-status"
            value={filterStatus}
            onChange={handleFilterChange}
            aria-label={t('action.filter')}
            size="sm"
          >
            <option value="all">{filterLabel('all')}</option>
            <option value="pending">{filterLabel('pending')}</option>
            <option value="confirmed">{filterLabel('confirmed')}</option>
            <option value="paid">{filterLabel('paid')}</option>
            <option value="reversed">{filterLabel('reversed')}</option>
          </Select>
        </div>
      </header>

      {/* Table */}
      {loading ? (
        <div
          className="space-y-2"
          data-testid="referrals-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t('affiliates.referrals.title')}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="p-3 rounded-lg border border-[var(--border-subtle)] bg-white flex items-center gap-3"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-16 rounded-full ml-auto" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
          role="alert"
          data-testid="referrals-error"
        >
          <p className="font-medium mb-1">{t('common.loading_error')}</p>
          <p className="text-xs opacity-80">{loadError}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadReferrals()}
            className="mt-2"
            aria-label={t('action.retry')}
          >
            {t('action.retry')}
          </Button>
        </div>
      ) : referrals.length === 0 ? (
        <EmptyState
          icon={<Icon as={Receipt} size={40} />}
          title={t('affiliates.referrals.empty')}
          variant={filterStatus === 'all' ? 'first-time' : 'filtered'}
        />
      ) : (
        <div
          className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-white"
          data-testid="referrals-list"
        >
          <table
            className="w-full text-sm border-collapse"
            aria-label={t('affiliates.referrals.title')}
          >
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)] bg-[var(--gray-50,#fafafa)] border-b border-[var(--border-subtle)]">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t('affiliates.title')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t('common.order')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-right">
                  {t('common.commission')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t('common.status')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t('common.created_at')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-right">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((ref) => {
                const isBusy = busyId === ref.id;
                const status: AffiliateReferralStatus = ref.status ?? 'pending';
                const aff = affiliateById.get(ref.affiliate_id);
                const affName =
                  aff?.name ?? aff?.code ?? ref.code ?? ref.affiliate_id;
                const labelConfirm = t('affiliates.referrals.confirm');
                const labelReverse = t('affiliates.referrals.reverse');
                const commission = ref.commission_cents ?? 0;
                const created = ref.created_at
                  ? formatRelativeTime(ref.created_at, locale)
                  : '—';
                return (
                  <tr
                    key={ref.id}
                    data-testid={`referral-row-${ref.id}`}
                    className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--gray-50,#fafafa)]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--text-primary)] truncate max-w-[14rem]">
                        {affName}
                      </div>
                      {aff?.code && aff.code !== affName ? (
                        <div className="font-mono text-xs text-[var(--text-muted)]">
                          {aff.code}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {ref.order_id ? (
                        <a
                          href={`/orders/${ref.order_id}`}
                          className="inline-flex items-center gap-1 font-mono text-xs text-[var(--brand-primary,#635bff)] hover:underline"
                          aria-label={`${ref.order_id}`}
                        >
                          {ref.order_id.slice(0, 12)}
                          <Icon as={ExternalLink} size="xs" />
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatMoneyCents(commission, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        data-testid={`referral-status-${ref.id}`}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CLASS[status]}`}
                      >
                        {statusLabel(status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                      {created}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {status === 'pending' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            leftIcon={<Icon as={CheckCircle2} size="sm" />}
                            onClick={() => void handleConfirm(ref)}
                            disabled={isBusy}
                            aria-label={`${labelConfirm} — ${affName}`}
                          >
                            {labelConfirm}
                          </Button>
                        ) : null}
                        {status === 'confirmed' ? (
                          <Button
                            variant="danger"
                            size="sm"
                            leftIcon={<Icon as={Undo2} size="sm" />}
                            onClick={() => void handleReverse(ref)}
                            disabled={isBusy}
                            aria-label={`${labelReverse} — ${affName}`}
                          >
                            {labelReverse}
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
      )}
    </div>
  );
}
