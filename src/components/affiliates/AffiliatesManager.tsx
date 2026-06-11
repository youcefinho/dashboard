// ── AffiliatesManager — Sprint 49 (Agent B1) ────────────────────────────────
// Liste + CRUD + metrics modal des affiliés du tenant courant (modèle order-based
// Sprint 49). Style Stripe-clean aligné sur SnapshotManager (Sprint 35).
//
// API back FIGÉE (Sprint 49 seq144) :
//   listAffiliates()                           → ApiResponse<AffiliateExtended[]>
//   createAffiliateAdmin(body)                 → ApiResponse<{ id, code }>
//   updateAffiliateS49(id, body)               → ApiResponse<{ success: true }>
//   deleteAffiliate(id)                        → ApiResponse<{ success: true }>  (S92 alias)
//   getAffiliateMetrics(affiliateId)           → ApiResponse<AffiliateMetrics>
//
// Capability : `clients.manage`. Loi 25 : ip_hash / user_agent_hash gérés worker.
// Toutes les chaînes via t(). Aucun console.log. aria-labels i18n sur actions.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Plus,
  Pencil,
  BarChart3,
  Trash2,
  Users,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t, getLocale } from '../../lib/i18n';
import { formatMoneyCents, formatNumber, formatPercent } from '../../lib/i18n/number';
import {
  deleteAffiliate,
  listAffiliates,
  createAffiliateAdmin,
  updateAffiliateS49,
  getAffiliateMetrics,
  type AffiliateExtended,
  type AffiliateTier,
  type AffiliateMetrics,
  type AffiliateCreateInput,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

type AffiliateStatus = 'active' | 'paused' | 'disabled';

/** Slug minimal pour code (uppercase alphanum + tirets). 12 chars max. */
function autoGenerateCode(name: string): string {
  const slug = (name || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 8);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return slug ? `${slug}-${suffix}` : suffix;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

const TIER_CLASS: Record<AffiliateTier, string> = {
  starter:
    'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]',
  silver:
    'bg-slate-50 text-slate-700 border-slate-200',
  gold:
    'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_CLASS: Record<AffiliateStatus, string> = {
  active:
    'bg-emerald-50 text-emerald-700 border-emerald-200',
  paused:
    'bg-amber-50 text-amber-700 border-amber-200',
  disabled:
    'bg-rose-50 text-rose-700 border-rose-200',
};

function tierLabel(tier: AffiliateTier): string {
  if (tier === 'silver') return t('affiliates.tier_silver');
  if (tier === 'gold') return t('affiliates.tier_gold');
  return t('affiliates.tier_starter');
}

function normalizeStatus(s: AffiliateExtended['status']): AffiliateStatus {
  if (s === 'active') return 'active';
  // S92 'inactive' → 'paused' (la signature étendue S49 accepte aussi 'disabled').
  if (s === 'inactive' || s === null || s === undefined) return 'paused';
  // S49 ajoute 'paused' / 'disabled' au runtime — TS S92 voit 'active' | 'inactive'.
  const asStr = String(s);
  if (asStr === 'paused') return 'paused';
  if (asStr === 'disabled') return 'disabled';
  return 'paused';
}

function statusLabel(s: AffiliateStatus): string {
  if (s === 'active') return t('common.active');
  if (s === 'paused') return t('common.paused');
  return t('common.disabled');
}

// ── Composant ──────────────────────────────────────────────────────────────

export function AffiliatesManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const locale = useMemo(() => getLocale(), []);

  const [affiliates, setAffiliates] = useState<AffiliateExtended[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // CRUD modal state
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formCode, setFormCode] = useState<string>('');
  const [formTier, setFormTier] = useState<AffiliateTier>('starter');
  const [formCommissionPct, setFormCommissionPct] = useState<string>('5');
  const [formActive, setFormActive] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Metrics modal state
  const [metricsOpen, setMetricsOpen] = useState<boolean>(false);
  const [metricsAffiliate, setMetricsAffiliate] = useState<AffiliateExtended | null>(null);
  const [metricsData, setMetricsData] = useState<AffiliateMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);

  // ── Chargement initial ──────────────────────────────────────────────────
  const loadAffiliates = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listAffiliates();
    if (res.error) {
      toastError(res.error);
      setLoadError(res.error || t('affiliates.errors.load_failed'));
      setAffiliates([]);
    } else if (res.data) {
      setAffiliates(res.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadAffiliates();
  }, [loadAffiliates]);

  // ── Modal CRUD : open create / open edit ────────────────────────────────
  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    setFormName('');
    setFormEmail('');
    setFormCode('');
    setFormTier('starter');
    setFormCommissionPct('5');
    setFormActive(true);
    setModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((aff: AffiliateExtended) => {
    setEditingId(aff.id);
    setFormName(aff.name ?? '');
    setFormEmail(aff.email ?? '');
    setFormCode(aff.code ?? '');
    setFormTier((aff.tier as AffiliateTier) ?? 'starter');
    setFormCommissionPct(
      typeof aff.commission_pct === 'number' ? String(aff.commission_pct) : '5',
    );
    setFormActive(normalizeStatus(aff.status) === 'active');
    setModalOpen(true);
  }, []);

  // ── Modal CRUD : submit ─────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = formName.trim();
      if (!name) return;

      const pct = clampPct(parseFloat(formCommissionPct.replace(',', '.')));
      const codeTrim = formCode.trim();
      const code = codeTrim || autoGenerateCode(name);
      const email = formEmail.trim() || undefined;

      setSubmitting(true);
      if (editingId) {
        const body: Partial<AffiliateCreateInput> & {
          status?: AffiliateStatus;
        } = {
          name,
          email,
          code,
          tier: formTier,
          commission_pct: pct,
          status: formActive ? 'active' : 'paused',
        };
        const res = await updateAffiliateS49(editingId, body);
        setSubmitting(false);
        if (res.error) {
          toastError(res.error);
          return;
        }
        success(t('toast.saved'));
      } else {
        const body: AffiliateCreateInput = {
          name,
          email,
          code,
          tier: formTier,
          commission_pct: pct,
        };
        const res = await createAffiliateAdmin(body);
        setSubmitting(false);
        if (res.error) {
          // Best-effort détection collision code (Loi 25 friendly — pas d'écho PII).
          if (/code|duplicate|unique/i.test(res.error)) {
            toastError(t('affiliates.errors.duplicate_code'));
          } else {
            toastError(res.error);
          }
          return;
        }
        success(t('toast.created'));
      }
      setModalOpen(false);
      setEditingId(null);
      void loadAffiliates();
    },
    [
      formName,
      formEmail,
      formCode,
      formTier,
      formCommissionPct,
      formActive,
      editingId,
      success,
      toastError,
      loadAffiliates,
    ],
  );

  // ── Suppression ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (aff: AffiliateExtended) => {
      const displayName = aff.name ?? aff.code ?? aff.id;
      const ok = await confirm({
        title: t('action.delete'),
        description: `${t('affiliates.delete.confirm')}\n\n${displayName}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(aff.id);
      const res = await deleteAffiliate(aff.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('toast.deleted'));
      void loadAffiliates();
    },
    [confirm, success, toastError, loadAffiliates],
  );

  // ── Metrics modal ───────────────────────────────────────────────────────
  const handleOpenMetrics = useCallback(
    async (aff: AffiliateExtended) => {
      setMetricsAffiliate(aff);
      setMetricsData(null);
      setMetricsOpen(true);
      setMetricsLoading(true);
      const res = await getAffiliateMetrics(aff.id);
      setMetricsLoading(false);
      if (res.error) {
        toastError(res.error);
        setMetricsOpen(false);
        return;
      }
      if (res.data) {
        setMetricsData(res.data);
      }
    },
    [toastError],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="affiliates-manager">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('affiliates.title')}</h2>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('affiliates.create')}
        >
          {t('affiliates.create')}
        </Button>
      </header>

      {/* Error state (inline + retry) */}
      {!loading && loadError ? (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="affiliates-error"
          className="p-4 rounded-xl border border-rose-200 bg-rose-50 flex items-start justify-between gap-3 flex-wrap"
        >
          <p className="text-sm text-rose-800 min-w-0">
            {t('affiliates.errors.load_failed')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadAffiliates()}
            aria-label={t('common.retry')}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {/* Liste / loading / empty */}
      {loading ? (
        <div
          className="space-y-3"
          data-testid="affiliates-loading"
          aria-busy="true"
          aria-live="polite"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : affiliates.length === 0 ? (
        <EmptyState
          icon={<Icon as={Users} size={40} />}
          title={t('affiliates.empty')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
              aria-label={t('affiliates.create')}
            >
              {t('affiliates.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="affiliates-list"
          aria-label={t('affiliates.title')}
        >
          {affiliates.map((aff) => {
            const isBusy = busyId === aff.id;
            const tier = (aff.tier as AffiliateTier) ?? 'starter';
            const status = normalizeStatus(aff.status);
            const pct = typeof aff.commission_pct === 'number' ? aff.commission_pct : 0;
            const totalCents = aff.total_commissions_cents ?? 0;
            const refCount = aff.total_referrals_count ?? 0;
            const labelEdit = t('action.edit');
            const labelMetrics = t('affiliates.metrics.title');
            const labelDelete = t('action.delete');
            const displayName = aff.name ?? aff.code ?? aff.id;
            return (
              <li
                key={aff.id}
                data-testid={`affiliate-row-${aff.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">
                      {displayName}
                    </h3>
                    {aff.code ? (
                      <span
                        className="font-mono text-xs px-2 py-0.5 rounded bg-[var(--gray-100)] text-[var(--gray-700)] border border-[var(--border-subtle)]"
                        aria-label={t('affiliates.code')}
                      >
                        {aff.code}
                      </span>
                    ) : null}
                    <span
                      data-testid={`affiliate-tier-${aff.id}`}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${TIER_CLASS[tier]}`}
                    >
                      {tierLabel(tier)}
                    </span>
                    <span
                      data-testid={`affiliate-status-${aff.id}`}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CLASS[status]}`}
                    >
                      {statusLabel(status)}
                    </span>
                  </div>
                  {aff.email ? (
                    <p className="text-sm text-[var(--text-secondary)] truncate">
                      {aff.email}
                    </p>
                  ) : null}
                  <div className="text-xs text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      {t('affiliates.commission_pct')}{' '}
                      <span className="font-mono">{formatPercent(pct / 100, locale, 1)}</span>
                    </span>
                    <span aria-hidden="true">•</span>
                    <span>
                      {t('affiliates.total_commissions')}{' '}
                      <span className="font-mono">{formatMoneyCents(totalCents, locale)}</span>
                    </span>
                    <span aria-hidden="true">•</span>
                    <span>
                      {t('affiliates.referrals.title')}{' '}
                      <span className="font-mono">{formatNumber(refCount, locale)}</span>
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => handleOpenEdit(aff)}
                    disabled={isBusy}
                    aria-label={`${labelEdit} — ${displayName}`}
                  >
                    {labelEdit}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={BarChart3} size="sm" />}
                    onClick={() => void handleOpenMetrics(aff)}
                    disabled={isBusy}
                    aria-label={`${labelMetrics} — ${displayName}`}
                  >
                    {labelMetrics}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(aff)}
                    disabled={isBusy}
                    aria-label={`${labelDelete} — ${displayName}`}
                  >
                    {labelDelete}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal CRUD (create + edit) */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingId ? t('action.edit') : t('affiliates.create')}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="aff-name"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('common.name')}
            </label>
            <Input
              id="aff-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              autoFocus
              required
              aria-label={t('common.name')}
            />
          </div>

          <div>
            <label
              htmlFor="aff-email"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('common.email')}
            </label>
            <Input
              id="aff-email"
              type="email"
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              aria-label={t('common.email')}
            />
          </div>

          <div>
            <label
              htmlFor="aff-code"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('affiliates.code')}
            </label>
            <Input
              id="aff-code"
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              placeholder={t('common.auto')}
              className="font-mono"
              aria-label={t('affiliates.code')}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="aff-tier"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('affiliates.tier')}
              </label>
              <Select
                id="aff-tier"
                value={formTier}
                onChange={(e) => {
                  const next = e.target.value as AffiliateTier;
                  setFormTier(next);
                  // Pré-remplit commission selon tier si user n'a pas customisé.
                  const map: Record<AffiliateTier, string> = {
                    starter: '5',
                    silver: '10',
                    gold: '15',
                  };
                  setFormCommissionPct(map[next]);
                }}
                aria-label={t('affiliates.tier')}
              >
                <option value="starter">{t('affiliates.tier_starter')}</option>
                <option value="silver">{t('affiliates.tier_silver')}</option>
                <option value="gold">{t('affiliates.tier_gold')}</option>
              </Select>
            </div>

            <div>
              <label
                htmlFor="aff-commission"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('affiliates.commission_pct')}
              </label>
              <Input
                id="aff-commission"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={formCommissionPct}
                onChange={(e) => setFormCommissionPct(e.target.value)}
                required
                aria-label={t('affiliates.commission_pct')}
              />
            </div>
          </div>

          <div className="pt-1">
            <Switch
              id="aff-active"
              checked={formActive}
              onCheckedChange={setFormActive}
              label={statusLabel('active')}
              variant="success"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setModalOpen(false)}
              disabled={submitting}
            >
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              isLoading={submitting}
              disabled={submitting || !formName.trim()}
              aria-label={editingId ? t('action.save') : t('affiliates.create')}
            >
              {editingId ? t('action.save') : t('affiliates.create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Metrics */}
      <Modal
        open={metricsOpen}
        onOpenChange={setMetricsOpen}
        title={
          metricsAffiliate
            ? `${t('affiliates.metrics.title')} — ${metricsAffiliate.name ?? metricsAffiliate.code ?? metricsAffiliate.id}`
            : t('affiliates.metrics.title')
        }
        size="md"
      >
        {metricsLoading ? (
          <div className="grid grid-cols-2 gap-3" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              >
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        ) : metricsData ? (
          <div className="grid grid-cols-2 gap-3">
            <KpiCard
              label={t('affiliates.clicks.title')}
              value={formatNumber(metricsData.clicks, locale)}
            />
            <KpiCard
              label={t('common.conversions')}
              value={formatNumber(metricsData.conversions, locale)}
            />
            <KpiCard
              label={t('affiliates.total_commissions')}
              value={formatMoneyCents(metricsData.total_commission_cents, locale)}
            />
            <KpiCard
              label={t('affiliates.metrics.conversion_rate')}
              value={formatPercent(metricsData.conversion_rate, locale, 1)}
            />
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            {t('common.no_data')}
          </p>
        )}
        <div className="flex justify-end pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setMetricsOpen(false)}
          >
            {t('action.close')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ── KPI card (mini) ────────────────────────────────────────────────────────

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">
        {label}
      </div>
      <div className="text-lg font-semibold text-[var(--text-primary)] font-mono">
        {value}
      </div>
    </div>
  );
}
