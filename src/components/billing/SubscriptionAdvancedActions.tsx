// ── SubscriptionAdvancedActions — Sprint 46 (Agent B1) ─────────────────────
// Panel actions avancées sur UNE subscription : preview proration, upgrade,
// downgrade, pause/resume, cancel (policy), + audit history.
//
// API back FIGÉE (Phase A) — `src/lib/api.ts` LOT-SUBSCRIPTIONS-ADV-S46 :
//   previewProration(subId, { to_plan_id })       → ApiResponse<ProrationPreview>
//   upgradeSubscription(subId, { to_plan_id })    → ApiResponse<{ subscription, mock? }>
//   downgradeSubscription(subId, { to_plan_id })  → ApiResponse<{ subscription, mock? }>
//   pauseSubscription(subId, { until? })          → ApiResponse<{ subscription, mock? }>
//   resumeSubscriptionAdv(subId)                  → ApiResponse<{ subscription, mock? }>
//   cancelSubscriptionAdv(subId, { policy })      → ApiResponse<{ subscription, mock? }>
//   getSubscriptionHistory(subId)                 → ApiResponse<SubscriptionChange[]>
//
// Style : Stripe-clean, surfaces blanches, focus ring purple, badges sobres.
// Toutes les chaînes via t(). aria-labels i18n. Imports RELATIFS (calque
// SnapshotManager).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react';
import {
  ArrowUpCircle,
  ArrowDownCircle,
  Pause,
  Play,
  XCircle,
  History,
  RefreshCcw,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t, getLocale } from '../../lib/i18n';
import { formatMoneyCents } from '../../lib/i18n/number';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import {
  previewProration,
  upgradeSubscription,
  downgradeSubscription,
  pauseSubscription,
  resumeSubscriptionAdv,
  cancelSubscriptionAdv,
  getSubscriptionHistory,
  type ProrationPreview,
  type SubscriptionChange,
  type SubscriptionChangeType,
  type SubscriptionCancellationPolicy,
} from '../../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SubscriptionAdvancedActionsProps {
  /** ID de la subscription cible. */
  subscriptionId: string;
  /** Plan courant — utilisé pour comparer avec sélection (et masquer si égal). */
  currentPlan: { id: string; name: string; price_cents: number };
  /** Plans dispo pour upgrade/downgrade (peut inclure currentPlan, on le filtre). */
  availablePlans: Array<{ id: string; name: string; price_cents: number }>;
  /** Statut subscription — pilote l'affichage des sections pause/resume. */
  status?: 'active' | 'paused' | 'cancelled' | string;
  /** Callback succès après mutation (le parent refetch typiquement). */
  onMutated?: () => void;
}

type ActionKey = 'upgrade' | 'downgrade' | 'pause' | 'resume' | 'cancel' | 'preview';

// ── Helpers ────────────────────────────────────────────────────────────────

const CHANGE_TYPE_CLASS: Record<SubscriptionChangeType, string> = {
  upgrade: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  downgrade: 'bg-amber-50 text-amber-700 border-amber-200',
  pause: 'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]',
  resume: 'bg-sky-50 text-sky-700 border-sky-200',
  trial_start: 'bg-violet-50 text-violet-700 border-violet-200',
  trial_end: 'bg-violet-50 text-violet-700 border-violet-200',
  dunning_attempt: 'bg-rose-50 text-rose-700 border-rose-200',
  cancel: 'bg-rose-50 text-rose-700 border-rose-200',
  reactivate: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function changeTypeLabel(ct: SubscriptionChangeType): string {
  // Réutilise la clé i18n existante si présente, sinon fallback brut.
  // (Clés `subscriptions_adv.proration.upgrade/downgrade` existent ; pour les
  // autres types on tombe sur le ct brut — l'audit l'accepte.)
  if (ct === 'upgrade') return t('subscriptions_adv.proration.upgrade');
  if (ct === 'downgrade') return t('subscriptions_adv.proration.downgrade');
  return ct;
}

// ── Composant ──────────────────────────────────────────────────────────────

export function SubscriptionAdvancedActions({
  subscriptionId,
  currentPlan,
  availablePlans,
  status = 'active',
  onMutated,
}: SubscriptionAdvancedActionsProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const locale = useMemo(() => getLocale(), []);

  // ── État ────────────────────────────────────────────────────────────────
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [prorationPreview, setProrationPreview] =
    useState<ProrationPreview | null>(null);
  const [pauseUntil, setPauseUntil] = useState<string>('');
  const [cancelPolicy, setCancelPolicy] =
    useState<SubscriptionCancellationPolicy>('end_of_period');
  const [actionLoading, setActionLoading] = useState<ActionKey | null>(null);

  const [history, setHistory] = useState<SubscriptionChange[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);

  // Plans sélectionnables = exclure plan courant (sinon previewProration tape
  // un to_plan_id == from_plan_id = no-op côté HANDLER mais autant éviter).
  const eligiblePlans = useMemo(
    () => availablePlans.filter((p) => p.id !== currentPlan.id),
    [availablePlans, currentPlan.id],
  );

  // ── Chargement history ──────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const res = await getSubscriptionHistory(subscriptionId);
    if (res.error) {
      toastError(res.error);
      setHistory([]);
    } else if (res.data) {
      setHistory(res.data);
    }
    setHistoryLoading(false);
  }, [subscriptionId, toastError]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // ── Helpers actions ─────────────────────────────────────────────────────
  const refreshAfterMutation = useCallback(() => {
    void loadHistory();
    if (onMutated) onMutated();
  }, [loadHistory, onMutated]);

  // ── Section 1 : Plan change (preview + confirm) ─────────────────────────
  const handlePreview = useCallback(async () => {
    if (!selectedPlanId) return;
    setActionLoading('preview');
    setProrationPreview(null);
    const res = await previewProration(subscriptionId, {
      to_plan_id: selectedPlanId,
    });
    setActionLoading(null);
    if (res.error) {
      toastError(res.error);
      return;
    }
    if (res.data) setProrationPreview(res.data);
  }, [selectedPlanId, subscriptionId, toastError]);

  const handleConfirmPlanChange = useCallback(async () => {
    if (!prorationPreview || !selectedPlanId) return;
    const isUpgrade = prorationPreview.is_upgrade;
    const actionKey: ActionKey = isUpgrade ? 'upgrade' : 'downgrade';
    setActionLoading(actionKey);
    const res = isUpgrade
      ? await upgradeSubscription(subscriptionId, { to_plan_id: selectedPlanId })
      : await downgradeSubscription(subscriptionId, {
          to_plan_id: selectedPlanId,
        });
    setActionLoading(null);
    if (res.error) {
      toastError(res.error);
      return;
    }
    success(
      isUpgrade
        ? t('subscriptions_adv.proration.upgrade')
        : t('subscriptions_adv.proration.downgrade'),
    );
    setProrationPreview(null);
    setSelectedPlanId('');
    refreshAfterMutation();
  }, [
    prorationPreview,
    selectedPlanId,
    subscriptionId,
    success,
    toastError,
    refreshAfterMutation,
  ]);

  // ── Section 2 : Pause ───────────────────────────────────────────────────
  const handlePause = useCallback(async () => {
    setActionLoading('pause');
    const body: { until?: string } = {};
    if (pauseUntil) {
      // <input type="date"> donne 'YYYY-MM-DD' ; on envoie ISO UTC fin de
      // journée pour cohérence HANDLER.
      body.until = new Date(`${pauseUntil}T23:59:59.000Z`).toISOString();
    }
    const res = await pauseSubscription(subscriptionId, body);
    setActionLoading(null);
    if (res.error) {
      toastError(res.error);
      return;
    }
    success(t('subscriptions_adv.pause.cta'));
    setPauseUntil('');
    refreshAfterMutation();
  }, [pauseUntil, subscriptionId, success, toastError, refreshAfterMutation]);

  // ── Section 3 : Resume ──────────────────────────────────────────────────
  const handleResume = useCallback(async () => {
    setActionLoading('resume');
    const res = await resumeSubscriptionAdv(subscriptionId);
    setActionLoading(null);
    if (res.error) {
      toastError(res.error);
      return;
    }
    success(t('subscriptions_adv.resume.cta'));
    refreshAfterMutation();
  }, [subscriptionId, success, toastError, refreshAfterMutation]);

  // ── Section 4 : Cancel (avec confirmation modale) ───────────────────────
  const handleCancel = useCallback(async () => {
    const ok = await confirm({
      title: t('billing.action.cancel_subscription'),
      description:
        cancelPolicy === 'immediate'
          ? t('billing.action.confirm_cancel')
          : t('billing.action.confirm_cancel'),
      confirmLabel: t('billing.action.confirm_cancel'),
      cancelLabel: t('action.cancel'),
      danger: true,
    });
    if (!ok) return;
    setActionLoading('cancel');
    const res = await cancelSubscriptionAdv(subscriptionId, {
      policy: cancelPolicy,
    });
    setActionLoading(null);
    if (res.error) {
      toastError(res.error);
      return;
    }
    success(t('billing.action.cancel_subscription'));
    refreshAfterMutation();
  }, [
    confirm,
    cancelPolicy,
    subscriptionId,
    success,
    toastError,
    refreshAfterMutation,
  ]);

  // ── Render ──────────────────────────────────────────────────────────────

  const isPaused = status === 'paused';
  const isCancelled = status === 'cancelled';
  const canPause = status === 'active';
  const busyAny = actionLoading !== null;

  return (
    <div
      className="space-y-6"
      data-testid="subscription-advanced-actions"
    >
      {/* Header */}
      <header className="min-w-0">
        <h2 className="t-h2">
          {t('subscriptions_adv.metrics.title')}
        </h2>
        <p className="t-caption text-[var(--gray-500)] mt-1">
          {currentPlan.name} ·{' '}
          {formatMoneyCents(currentPlan.price_cents, locale)}
        </p>
      </header>

      {/* ── Section 1 : Plan change ────────────────────────────────────── */}
      <section
        aria-labelledby="sub-adv-plan-heading"
        className="p-5 rounded-xl border border-[var(--border-subtle)] bg-white space-y-4"
      >
        <h3
          id="sub-adv-plan-heading"
          className="font-semibold text-[var(--text-primary)]"
        >
          {t('subscriptions_adv.proration.preview')}
        </h3>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 min-w-0">
            <Select
              label={t('subscriptions_adv.proration.preview')}
              value={selectedPlanId}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                setSelectedPlanId(e.target.value);
                setProrationPreview(null);
              }}
              disabled={busyAny || isCancelled || eligiblePlans.length === 0}
              aria-label={t('subscriptions_adv.proration.preview')}
            >
              <option value="">—</option>
              {eligiblePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({formatMoneyCents(p.price_cents, locale)})
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handlePreview()}
            disabled={!selectedPlanId || busyAny || isCancelled}
            isLoading={actionLoading === 'preview'}
            aria-label={t('subscriptions_adv.proration.preview')}
          >
            {t('subscriptions_adv.proration.preview')}
          </Button>
        </div>

        {prorationPreview ? (
          <div
            data-testid="proration-preview"
            className="p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--gray-50)] space-y-2"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                  prorationPreview.is_upgrade
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {prorationPreview.is_upgrade
                  ? t('subscriptions_adv.proration.upgrade')
                  : t('subscriptions_adv.proration.downgrade')}
              </span>
              {prorationPreview.mock ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]">
                  mock
                </span>
              ) : null}
            </div>
            <div className="text-sm text-[var(--text-secondary)]">
              <span className="font-medium">
                {t('subscriptions_adv.proration.amount')} :
              </span>{' '}
              <span className="font-mono">
                {formatMoneyCents(
                  prorationPreview.prorated_amount_cents,
                  locale,
                  prorationPreview.currency,
                )}
              </span>
            </div>
            <div className="text-xs text-[var(--text-muted)] font-mono">
              {prorationPreview.days_remaining} / {prorationPreview.period_days}{' '}
              j
            </div>
            <div className="pt-2">
              <Button
                size="sm"
                leftIcon={
                  <Icon
                    as={
                      prorationPreview.is_upgrade
                        ? ArrowUpCircle
                        : ArrowDownCircle
                    }
                    size="sm"
                  />
                }
                onClick={() => void handleConfirmPlanChange()}
                disabled={busyAny || isCancelled}
                isLoading={
                  actionLoading === 'upgrade' || actionLoading === 'downgrade'
                }
                aria-label={
                  prorationPreview.is_upgrade
                    ? t('subscriptions_adv.proration.upgrade')
                    : t('subscriptions_adv.proration.downgrade')
                }
              >
                {t('billing.action.confirm_change')}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Section 2 : Pause ──────────────────────────────────────────── */}
      {canPause ? (
        <section
          aria-labelledby="sub-adv-pause-heading"
          className="p-5 rounded-xl border border-[var(--border-subtle)] bg-white space-y-3"
        >
          <h3
            id="sub-adv-pause-heading"
            className="font-semibold text-[var(--text-primary)]"
          >
            {t('subscriptions_adv.pause.cta')}
          </h3>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 min-w-0">
              <label
                htmlFor="sub-pause-until"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('subscriptions_adv.pause.until')}
              </label>
              <Input
                id="sub-pause-until"
                type="date"
                value={pauseUntil}
                onChange={(e) => setPauseUntil(e.target.value)}
                disabled={busyAny}
                aria-label={t('subscriptions_adv.pause.until')}
              />
              {!pauseUntil ? (
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {t('subscriptions_adv.pause.indefinitely')}
                </p>
              ) : null}
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icon as={Pause} size="sm" />}
              onClick={() => void handlePause()}
              disabled={busyAny}
              isLoading={actionLoading === 'pause'}
              aria-label={t('subscriptions_adv.pause.cta')}
            >
              {t('subscriptions_adv.pause.cta')}
            </Button>
          </div>
        </section>
      ) : null}

      {/* ── Section 3 : Resume ─────────────────────────────────────────── */}
      {isPaused ? (
        <section
          aria-labelledby="sub-adv-resume-heading"
          className="p-5 rounded-xl border border-[var(--border-subtle)] bg-white space-y-3"
        >
          <h3
            id="sub-adv-resume-heading"
            className="font-semibold text-[var(--text-primary)]"
          >
            {t('subscriptions_adv.resume.cta')}
          </h3>
          <Button
            size="sm"
            leftIcon={<Icon as={Play} size="sm" />}
            onClick={() => void handleResume()}
            disabled={busyAny}
            isLoading={actionLoading === 'resume'}
            aria-label={t('subscriptions_adv.resume.cta')}
          >
            {t('subscriptions_adv.resume.cta')}
          </Button>
        </section>
      ) : null}

      {/* ── Section 4 : Cancel ─────────────────────────────────────────── */}
      {!isCancelled ? (
        <section
          aria-labelledby="sub-adv-cancel-heading"
          className="p-5 rounded-xl border border-[var(--border-subtle)] bg-white space-y-3"
        >
          <h3
            id="sub-adv-cancel-heading"
            className="font-semibold text-[var(--text-primary)]"
          >
            {t('billing.action.cancel_subscription')}
          </h3>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 min-w-0">
              <Select
                value={cancelPolicy}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setCancelPolicy(
                    e.target.value as SubscriptionCancellationPolicy,
                  )
                }
                disabled={busyAny}
                aria-label={t('billing.action.cancel_subscription')}
              >
                <option value="end_of_period">end_of_period</option>
                <option value="immediate">immediate</option>
              </Select>
            </div>
            <Button
              variant="danger"
              size="sm"
              leftIcon={<Icon as={XCircle} size="sm" />}
              onClick={() => void handleCancel()}
              disabled={busyAny}
              isLoading={actionLoading === 'cancel'}
              aria-label={t('billing.action.cancel_subscription')}
            >
              {t('billing.action.cancel_subscription')}
            </Button>
          </div>
        </section>
      ) : null}

      {/* ── Section 5 : History ────────────────────────────────────────── */}
      <section
        aria-labelledby="sub-adv-history-heading"
        className="p-5 rounded-xl border border-[var(--border-subtle)] bg-white space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h3
            id="sub-adv-history-heading"
            className="font-semibold text-[var(--text-primary)] flex items-center gap-2"
          >
            <Icon as={History} size="sm" />
            {t('subscriptions_adv.history.title')}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Icon as={RefreshCcw} size="sm" />}
            onClick={() => void loadHistory()}
            disabled={historyLoading}
            aria-label={t('subscriptions_adv.history.title')}
          >
            {t('action.refresh')}
          </Button>
        </div>

        {historyLoading ? (
          <div
            className="space-y-2"
            data-testid="subscription-history-loading"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={<Icon as={History} size={32} />}
            title={t('subscriptions_adv.history.empty')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              aria-label={t('subscriptions_adv.history.title')}
            >
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)] uppercase tracking-wide border-b border-[var(--border-subtle)]">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">From → To</th>
                  <th className="py-2 pr-3 font-medium text-right">
                    {t('subscriptions_adv.proration.amount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr
                    key={row.id}
                    data-testid={`subscription-history-row-${row.id}`}
                    className="border-b border-[var(--border-subtle)] last:border-b-0"
                  >
                    <td className="py-2 pr-3 text-[var(--text-muted)] whitespace-nowrap">
                      {formatRelativeTime(row.created_at, locale)}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                          CHANGE_TYPE_CLASS[row.change_type] ??
                          'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]'
                        }`}
                      >
                        {changeTypeLabel(row.change_type)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-[var(--text-secondary)]">
                      {(row.from_plan_id ?? '—') + ' → ' + (row.to_plan_id ?? '—')}
                    </td>
                    <td className="py-2 pr-3 font-mono text-right whitespace-nowrap">
                      {row.prorated_amount_cents
                        ? formatMoneyCents(row.prorated_amount_cents, locale)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
