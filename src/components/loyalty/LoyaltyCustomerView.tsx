// ── LoyaltyCustomerView — Sprint 38 (Agent B3) ──────────────────────────────
// Vue client fidélité : balance + ledger + actions admin (ajustement points).
//
// Layout :
//   - Header : nom customer (prop optionnelle) + tier badge (bronze/silver/gold)
//   - Section Balance : grosse card "Solde actuel: X points" + lifetime_earned
//     + last_earn_at + last_redeem_at + warning expiry si pending.
//   - Section History : tableau ledger (date, type, points signé, source_order_id,
//     tier_snapshot), scroll vertical, trié created_at desc.
//   - Section Actions admin : "Ajuster points" (ouvre modal) +
//     "Voir transactions order" (lien externe contextuel par entry).
//
// Modal adjust : input points (signed, peut être négatif) + textarea reason →
// adjustLoyaltyPoints({ program_id, customer_id, points, reason }) → toast +
// refresh balance/ledger.
//
// API FIGÉES (Phase A — src/lib/api.ts) :
//   getCustomerLoyaltyBalance(customerId) → ApiResponse<LoyaltyCustomerBalance>
//   getLoyaltyLedger(customerId, programId?) → ApiResponse<LoyaltyLedgerEntry[]>
//   adjustLoyaltyPoints({ program_id, customer_id, points, reason })
//                       → ApiResponse<LoyaltyLedgerEntry>
//
// Expiry warning : si une entrée 'earn' du ledger expire dans ≤ 30 jours et
// n'a pas été déjà consommée (balance positive), on affiche un badge warning
// avec loyalty.expiry.warning.
//
// Style : Stripe-clean. Imports RELATIFS. Toutes les chaînes via t(). Aucun
// console.log. aria-labels i18n.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import {
  getCustomerLoyaltyBalance,
  getLoyaltyLedger,
  adjustLoyaltyPoints,
  type LoyaltyCustomerBalance,
  type LoyaltyLedgerEntry,
  type LoyaltyLedgerType,
} from '../../lib/api';

// ── Types ───────────────────────────────────────────────────────────────────

export interface LoyaltyCustomerViewProps {
  customerId: string;
  /** Si fourni, filtre balance/ledger sur ce programme spécifique. */
  programId?: string;
  /** Nom client affiché en header (fallback : customerId tronqué). */
  customerName?: string;
}

type TierKey = 'bronze' | 'silver' | 'gold';

// Seuil expiry warning (jours).
const EXPIRY_WARNING_DAYS = 30;

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeTier(tier: string): TierKey {
  const t = tier.toLowerCase();
  if (t === 'gold' || t === 'or') return 'gold';
  if (t === 'silver' || t === 'argent') return 'silver';
  return 'bronze';
}

function tierBadgeColor(tier: TierKey): string {
  // Couleurs explicites pour les 3 tiers (palette neutre Stripe).
  if (tier === 'gold') return '#d4a017';
  if (tier === 'silver') return '#9ca3af';
  return '#a16207'; // bronze
}

function tierLabel(tier: TierKey): string {
  return t(`loyalty.tier.${tier}` as const);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleString('fr-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatPoints(points: number): string {
  const sign = points > 0 ? '+' : '';
  return `${sign}${points.toLocaleString('fr-CA')}`;
}

function ledgerTypeIntent(type: LoyaltyLedgerType): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (type === 'earn' || type === 'tier_bonus') return 'success';
  if (type === 'redeem') return 'info';
  if (type === 'adjust') return 'warning';
  if (type === 'expire') return 'danger';
  return 'neutral';
}

function sortLedgerDesc(entries: LoyaltyLedgerEntry[]): LoyaltyLedgerEntry[] {
  return [...entries].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
}

/**
 * Détecte si au moins 1 entrée 'earn' du ledger expire dans
 * ≤ EXPIRY_WARNING_DAYS, et balance courante > 0.
 */
function hasUpcomingExpiry(
  ledger: LoyaltyLedgerEntry[],
  currentBalance: number,
): boolean {
  if (currentBalance <= 0) return false;
  const now = Date.now();
  const threshold = now + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
  return ledger.some((e) => {
    if (e.type !== 'earn' && e.type !== 'tier_bonus') return false;
    if (!e.expires_at) return false;
    const exp = Date.parse(e.expires_at);
    if (!Number.isFinite(exp)) return false;
    return exp >= now && exp <= threshold;
  });
}

// ── Composant ───────────────────────────────────────────────────────────────

export function LoyaltyCustomerView({
  customerId,
  programId,
  customerName,
}: LoyaltyCustomerViewProps) {
  const toast = useToast();

  const [balance, setBalance] = useState<LoyaltyCustomerBalance | null>(null);
  const [ledger, setLedger] = useState<LoyaltyLedgerEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Modal adjust
  const [adjustOpen, setAdjustOpen] = useState<boolean>(false);
  const [adjustPoints, setAdjustPoints] = useState<string>('');
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [adjustSubmitting, setAdjustSubmitting] = useState<boolean>(false);

  // ── Load balance + ledger ────────────────────────────────────────────────

  const load = useCallback(
    async (silent = false) => {
      if (!customerId) return;
      if (silent) setRefreshing(true);
      else setLoading(true);

      const [balanceRes, ledgerRes] = await Promise.all([
        getCustomerLoyaltyBalance(customerId),
        getLoyaltyLedger(customerId, programId),
      ]);

      if (balanceRes.data) {
        setBalance(balanceRes.data);
      } else if (balanceRes.error) {
        toast.error(balanceRes.error);
      }

      if (ledgerRes.data) {
        setLedger(sortLedgerDesc(ledgerRes.data));
      } else if (ledgerRes.error) {
        toast.error(ledgerRes.error);
      }

      if (silent) setRefreshing(false);
      else setLoading(false);
    },
    [customerId, programId, toast],
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, programId]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const tierKey: TierKey = useMemo(
    () => normalizeTier(balance?.current_tier ?? 'bronze'),
    [balance?.current_tier],
  );

  const showExpiryWarning = useMemo(
    () => hasUpcomingExpiry(ledger, balance?.current_balance ?? 0),
    [ledger, balance?.current_balance],
  );

  const headerName = customerName ?? customerId;

  // ── Modal adjust handlers ────────────────────────────────────────────────

  const openAdjustModal = useCallback(() => {
    setAdjustPoints('');
    setAdjustReason('');
    setAdjustOpen(true);
  }, []);

  const closeAdjustModal = useCallback(() => {
    if (adjustSubmitting) return;
    setAdjustOpen(false);
  }, [adjustSubmitting]);

  const onChangeAdjustPoints = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setAdjustPoints(e.target.value),
    [],
  );

  const onChangeAdjustReason = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => setAdjustReason(e.target.value),
    [],
  );

  const submitAdjust = useCallback(
    async (e?: FormEvent) => {
      if (e) e.preventDefault();
      if (!balance) {
        toast.error(t('loyalty.errors.customerNotFound'));
        return;
      }
      const parsed = Number.parseInt(adjustPoints, 10);
      if (!Number.isFinite(parsed) || parsed === 0) {
        toast.error(t('loyalty.adjust.reason'));
        return;
      }
      const reason = adjustReason.trim();
      if (reason.length === 0) {
        toast.error(t('loyalty.adjust.reason'));
        return;
      }

      setAdjustSubmitting(true);
      const res = await adjustLoyaltyPoints({
        program_id: balance.program_id,
        customer_id: balance.customer_id,
        points: parsed,
        reason,
      });
      setAdjustSubmitting(false);

      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(t('loyalty.balance.label'));
      setAdjustOpen(false);
      await load(true);
    },
    [adjustPoints, adjustReason, balance, load, toast],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-16"
        data-testid="loyalty-loading"
        role="status"
        aria-label={t('loyalty.balance.label')}
      >
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (!balance) {
    return (
      <div
        className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-surface)] p-6 text-sm text-[var(--text-secondary)]"
        data-testid="loyalty-empty"
      >
        {t('loyalty.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="loyalty-customer-view">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header
        className="flex flex-wrap items-center justify-between gap-3"
        data-testid="loyalty-header"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {headerName}
          </h2>
          <Badge
            intent="brand"
            fill="soft"
            color={tierBadgeColor(tierKey)}
            data-testid="loyalty-tier-badge"
            data-tier={tierKey}
            aria-label={`${t('loyalty.balance.label')} — ${tierLabel(tierKey)}`}
            style={{
              color: tierBadgeColor(tierKey),
              borderColor: tierBadgeColor(tierKey),
            }}
          >
            {tierLabel(tierKey)}
          </Badge>
          {showExpiryWarning && (
            <Badge
              intent="warning"
              fill="soft"
              data-testid="loyalty-expiry-warning"
              aria-label={t('loyalty.expiry.warning')}
            >
              {t('loyalty.expiry.warning')}
            </Badge>
          )}
        </div>
        <Button
          variant="secondary"
          onClick={openAdjustModal}
          data-testid="loyalty-adjust-open"
          aria-label={t('loyalty.adjust.reason')}
        >
          {t('loyalty.adjust.reason')}
        </Button>
      </header>

      {/* ── Balance card ─────────────────────────────────────────────────── */}
      <Card data-testid="loyalty-balance-card">
        <div className="flex flex-col gap-3">
          <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
            {t('loyalty.balance.label')}
          </span>
          <div className="flex items-baseline gap-2">
            <span
              className="text-4xl font-semibold text-[var(--text-primary)]"
              data-testid="loyalty-balance-value"
            >
              {balance.current_balance.toLocaleString('fr-CA')}
            </span>
            <span className="text-sm text-[var(--text-secondary)]">pts</span>
          </div>
          <dl className="grid grid-cols-1 gap-3 pt-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--text-muted)]">lifetime earned</dt>
              <dd
                className="font-medium text-[var(--text-primary)]"
                data-testid="loyalty-lifetime"
              >
                {balance.lifetime_earned.toLocaleString('fr-CA')}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">last earn</dt>
              <dd
                className="font-medium text-[var(--text-primary)]"
                data-testid="loyalty-last-earn"
              >
                {formatDateTime(balance.last_earn_at)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">last redeem</dt>
              <dd
                className="font-medium text-[var(--text-primary)]"
                data-testid="loyalty-last-redeem"
              >
                {formatDateTime(balance.last_redeem_at)}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      {/* ── History ──────────────────────────────────────────────────────── */}
      <section data-testid="loyalty-history-section">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            {t('loyalty.history.title')}
          </h3>
          {refreshing && (
            <Loader2
              className="h-4 w-4 animate-spin text-[var(--text-muted)]"
              aria-hidden="true"
            />
          )}
        </div>
        <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="max-h-[360px] overflow-y-auto">
            <table
              className="w-full text-left text-sm"
              aria-label={t('loyalty.history.title')}
              data-testid="loyalty-history-table"
            >
              <thead className="sticky top-0 bg-[var(--bg-muted)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-2 font-medium">date</th>
                  <th className="px-4 py-2 font-medium">type</th>
                  <th className="px-4 py-2 text-right font-medium">points</th>
                  <th className="px-4 py-2 font-medium">order</th>
                  <th className="px-4 py-2 font-medium">tier</th>
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-[var(--text-muted)]"
                      data-testid="loyalty-history-empty"
                    >
                      {t('loyalty.empty')}
                    </td>
                  </tr>
                ) : (
                  ledger.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-t border-[var(--border)]"
                      data-testid={`loyalty-history-row-${entry.id}`}
                    >
                      <td className="px-4 py-2 text-[var(--text-secondary)]">
                        {formatDateTime(entry.created_at)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          intent={ledgerTypeIntent(entry.type)}
                          fill="soft"
                          data-testid={`loyalty-history-type-${entry.id}`}
                        >
                          {entry.type}
                        </Badge>
                      </td>
                      <td
                        className="px-4 py-2 text-right font-medium tabular-nums text-[var(--text-primary)]"
                        data-testid={`loyalty-history-points-${entry.id}`}
                      >
                        {formatPoints(entry.points)}
                      </td>
                      <td className="px-4 py-2 text-[var(--text-secondary)]">
                        {entry.source_order_id ? (
                          <a
                            href={`/orders/${entry.source_order_id}`}
                            className="text-[var(--primary)] underline-offset-2 hover:underline"
                            aria-label={`${t('loyalty.history.title')} — order ${entry.source_order_id}`}
                          >
                            {entry.source_order_id}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2 text-[var(--text-secondary)]">
                        {tierLabel(normalizeTier(entry.tier_snapshot))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Modal adjust ─────────────────────────────────────────────────── */}
      <Modal
        open={adjustOpen}
        onOpenChange={(o) => (o ? setAdjustOpen(true) : closeAdjustModal())}
        title={t('loyalty.adjust.reason')}
      >
        <form
          onSubmit={submitAdjust}
          className="flex flex-col gap-4"
          data-testid="loyalty-adjust-form"
        >
          <Input
            type="number"
            label={t('loyalty.balance.label')}
            value={adjustPoints}
            onChange={onChangeAdjustPoints}
            aria-label={t('loyalty.balance.label')}
            data-testid="loyalty-adjust-points"
            disabled={adjustSubmitting}
          />
          <Textarea
            label={t('loyalty.adjust.reason')}
            value={adjustReason}
            onChange={onChangeAdjustReason}
            aria-label={t('loyalty.adjust.reason')}
            data-testid="loyalty-adjust-reason"
            disabled={adjustSubmitting}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={closeAdjustModal}
              disabled={adjustSubmitting}
              data-testid="loyalty-adjust-cancel"
            >
              {t('loyalty.empty')}
            </Button>
            <Button
              type="submit"
              isLoading={adjustSubmitting}
              data-testid="loyalty-adjust-submit"
            >
              {t('loyalty.adjust.reason')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
