// ── GiftLoyaltyOps — Sprint (Agent) ──────────────────────────────────────────
// Surface des opérations gift-card + loyalty restées non câblées :
//   - Gift card : lookup balance par code (public), redeem par id (admin).
//   - Loyalty   : lookup balance client par programme, earn / redeem points.
// Pattern calqué sur le reste du dashboard : imports RELATIFS, i18n via t(),
// états loading(aria-busy)/empty/error(role=alert), confirm sur actions
// destructives/financières, a11y (labels, aria-live), zéro console.log.

import { useCallback, useState } from 'react';
import { Gift, Award, Search, ArrowDownCircle, PlusCircle } from 'lucide-react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import {
  getGiftCardBalance,
  redeemGiftCard,
  getCustomerLoyaltyBalance,
  earnLoyaltyPoints,
  redeemLoyaltyPoints,
  type GiftCardBalance,
  type LoyaltyCustomerBalance,
  type LoyaltyProgram,
} from '../../lib/api';
import { t } from '../../lib/i18n';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(cents: number, currency: string): string {
  // Clamp défensif : valeurs négatives ou NaN ⇒ 0 ; protège l'affichage.
  const safe = Number.isFinite(cents) && cents > 0 ? cents : 0;
  const amount = (safe / 100).toFixed(2);
  return `${amount} ${currency || ''}`.trim();
}

function parseDollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

// ── Props ──────────────────────────────────────────────────────────────────

interface GiftLoyaltyOpsProps {
  /** Programmes loyalty chargés par la page parente (pour le sélecteur). */
  programs: LoyaltyProgram[];
}

// ── Composant ──────────────────────────────────────────────────────────────

export function GiftLoyaltyOps({ programs }: GiftLoyaltyOpsProps) {
  return (
    <div className="space-y-8" data-testid="gift-loyalty-ops">
      <GiftCardBalanceSection />
      <GiftCardRedeemSection />
      <LoyaltyCustomerSection programs={programs} />
    </div>
  );
}

// ── Section 1 : lookup balance gift-card par code ────────────────────────────

function GiftCardBalanceSection() {
  const { error: toastError } = useToast();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GiftCardBalance | null>(null);
  const [searched, setSearched] = useState(false);

  const onLookup = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await getGiftCardBalance(trimmed);
      if (res.error) {
        setError(res.error);
        toastError(res.error);
      } else if (res.data) {
        setResult(res.data);
      } else {
        // Réponse vide défensive : pas de data, pas d'error → considère "introuvable".
        setError(null);
      }
    } catch {
      const msg = t('common.error.load_failed');
      setError(msg);
      toastError(msg);
    }
    setLoading(false);
    setSearched(true);
  }, [code, loading, toastError]);

  return (
    <OpsCard
      icon={Gift}
      title={t('giftloyalty.balance.title')}
      description={t('giftloyalty.balance.description')}
      testId="ops-giftcard-balance"
    >
      <form
        className="flex items-end gap-3 flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          void onLookup();
        }}
      >
        <Input
          label={t('giftloyalty.balance.codeLabel')}
          placeholder={t('giftloyalty.balance.codePlaceholder')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          containerClassName="flex-1 min-w-[14rem]"
          data-testid="ops-giftcard-balance-code"
          autoComplete="off"
        />
        <Button
          type="submit"
          leftIcon={<Icon as={Search} size="sm" />}
          isLoading={loading}
          disabled={loading || code.trim().length === 0}
          aria-label={t('giftloyalty.balance.lookup')}
          data-testid="ops-giftcard-balance-submit"
        >
          {t('giftloyalty.balance.lookup')}
        </Button>
      </form>

      <div aria-live="polite" aria-busy={loading} className="mt-4">
        {error ? (
          <p
            role="alert"
            className="text-sm text-[var(--danger)]"
            data-testid="ops-giftcard-balance-error"
          >
            {error}
          </p>
        ) : result ? (
          <dl
            className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm"
            data-testid="ops-giftcard-balance-result"
          >
            <dt className="text-[var(--text-muted)]">
              {t('giftloyalty.balance.amount')}
            </dt>
            <dd className="font-semibold text-[var(--text-primary)]">
              {formatMoney(result.balance_cents, result.currency)}
            </dd>
            <dt className="text-[var(--text-muted)]">
              {t('giftloyalty.balance.status')}
            </dt>
            <dd className="text-[var(--text-secondary)]">
              {t(`giftloyalty.status.${result.status}`)}
            </dd>
            <dt className="text-[var(--text-muted)]">
              {t('giftloyalty.balance.expires')}
            </dt>
            <dd className="text-[var(--text-secondary)]">
              {result.expires_at
                ? new Date(result.expires_at).toLocaleDateString()
                : t('giftloyalty.balance.noExpiry')}
            </dd>
          </dl>
        ) : searched && !loading ? (
          <p
            className="text-sm text-[var(--text-muted)]"
            data-testid="ops-giftcard-balance-empty"
          >
            {t('giftloyalty.balance.empty')}
          </p>
        ) : null}
      </div>
    </OpsCard>
  );
}

// ── Section 2 : redeem gift-card par id ──────────────────────────────────────

function GiftCardRedeemSection() {
  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();

  const [cardId, setCardId] = useState('');
  const [amount, setAmount] = useState('');
  const [orderId, setOrderId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = parseDollarsToCents(amount);
  const canSubmit =
    cardId.trim().length > 0 && amountCents !== null && !loading;

  const onRedeem = useCallback(async () => {
    const id = cardId.trim();
    const cents = parseDollarsToCents(amount);
    if (!id || cents === null) {
      setError(t('giftloyalty.redeem.invalid'));
      return;
    }
    const ok = await confirm({
      title: t('giftloyalty.redeem.confirmTitle'),
      description: t('giftloyalty.redeem.confirmBody', {
        amount: (cents / 100).toFixed(2),
      }),
      confirmLabel: t('giftloyalty.redeem.submit'),
      cancelLabel: t('giftloyalty.cancel'),
      danger: true,
    });
    if (!ok) return;

    setLoading(true);
    setError(null);
    try {
      const res = await redeemGiftCard(id, {
        amount_cents: cents,
        order_id: orderId.trim() || undefined,
      });
      if (res.error) {
        setError(res.error);
        toastError(res.error);
      } else if (res.data) {
        // Clamp défensif sur la balance retournée (jamais < 0 à l'affichage).
        const bal = Number.isFinite(res.data.balance_after_cents)
          ? Math.max(0, res.data.balance_after_cents)
          : 0;
        toastSuccess(
          t('giftloyalty.redeem.success', {
            balance: (bal / 100).toFixed(2),
          }),
        );
        setAmount('');
        setOrderId('');
      }
    } catch {
      const msg = t('common.error.load_failed');
      setError(msg);
      toastError(msg);
    }
    setLoading(false);
  }, [cardId, amount, orderId, confirm, toastSuccess, toastError]);

  return (
    <OpsCard
      icon={ArrowDownCircle}
      title={t('giftloyalty.redeem.title')}
      description={t('giftloyalty.redeem.description')}
      testId="ops-giftcard-redeem"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onRedeem();
        }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            label={t('giftloyalty.redeem.cardIdLabel')}
            placeholder={t('giftloyalty.redeem.cardIdPlaceholder')}
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            data-testid="ops-giftcard-redeem-id"
            autoComplete="off"
          />
          <Input
            label={t('giftloyalty.redeem.amountLabel')}
            placeholder="0.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="ops-giftcard-redeem-amount"
            autoComplete="off"
          />
          <Input
            label={t('giftloyalty.redeem.orderIdLabel')}
            placeholder={t('giftloyalty.redeem.orderIdPlaceholder')}
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            data-testid="ops-giftcard-redeem-order"
            autoComplete="off"
          />
        </div>

        <div aria-live="assertive">
          {error ? (
            <p
              role="alert"
              className="text-sm text-[var(--danger)]"
              data-testid="ops-giftcard-redeem-error"
            >
              {error}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          variant="danger"
          leftIcon={<Icon as={ArrowDownCircle} size="sm" />}
          isLoading={loading}
          disabled={!canSubmit}
          aria-label={t('giftloyalty.redeem.submit')}
          data-testid="ops-giftcard-redeem-submit"
        >
          {t('giftloyalty.redeem.submit')}
        </Button>
      </form>
    </OpsCard>
  );
}

// ── Section 3 : loyalty client (balance + earn + redeem) ─────────────────────

function LoyaltyCustomerSection({ programs }: { programs: LoyaltyProgram[] }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();

  const [programId, setProgramId] = useState(programs[0]?.id ?? '');
  const [customerId, setCustomerId] = useState('');

  // Balance lookup.
  const [balLoading, setBalLoading] = useState(false);
  const [balError, setBalError] = useState<string | null>(null);
  const [balance, setBalance] = useState<LoyaltyCustomerBalance | null>(null);
  const [balSearched, setBalSearched] = useState(false);

  // Earn / redeem inputs.
  const [earnSubtotal, setEarnSubtotal] = useState('');
  const [redeemPoints, setRedeemPoints] = useState('');
  const [earnLoading, setEarnLoading] = useState(false);
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasProgram = programId.trim().length > 0;
  const hasCustomer = customerId.trim().length > 0;

  const onLookupBalance = useCallback(async () => {
    const cid = customerId.trim();
    if (!cid || balLoading) return;
    setBalLoading(true);
    setBalError(null);
    setBalance(null);
    try {
      const res = await getCustomerLoyaltyBalance(cid);
      if (res.error) {
        setBalError(res.error);
        toastError(res.error);
      } else if (res.data) {
        setBalance(res.data);
      }
    } catch {
      const msg = t('common.error.load_failed');
      setBalError(msg);
      toastError(msg);
    }
    setBalLoading(false);
    setBalSearched(true);
  }, [customerId, balLoading, toastError]);

  const onEarn = useCallback(async () => {
    const cents = parseDollarsToCents(earnSubtotal);
    if (!hasProgram || !hasCustomer || cents === null) {
      setActionError(t('giftloyalty.loyalty.invalidEarn'));
      return;
    }
    if (earnLoading) return;
    setEarnLoading(true);
    setActionError(null);
    try {
      const res = await earnLoyaltyPoints({
        program_id: programId.trim(),
        customer_id: customerId.trim(),
        subtotal_cents: cents,
      });
      if (res.error) {
        setActionError(res.error);
        toastError(res.error);
      } else if (res.data) {
        const pts = Number.isFinite(res.data.points) ? Math.max(0, res.data.points) : 0;
        const bal = Number.isFinite(res.data.balance_after) ? Math.max(0, res.data.balance_after) : 0;
        toastSuccess(
          t('giftloyalty.loyalty.earnSuccess', {
            points: pts,
            balance: bal,
          }),
        );
        setEarnSubtotal('');
        void onLookupBalance();
      }
    } catch {
      const msg = t('common.error.load_failed');
      setActionError(msg);
      toastError(msg);
    }
    setEarnLoading(false);
  }, [
    earnSubtotal,
    earnLoading,
    hasProgram,
    hasCustomer,
    programId,
    customerId,
    toastSuccess,
    toastError,
    onLookupBalance,
  ]);

  const onRedeem = useCallback(async () => {
    const points = parsePositiveInt(redeemPoints);
    if (!hasProgram || !hasCustomer || points === null) {
      setActionError(t('giftloyalty.loyalty.invalidRedeem'));
      return;
    }
    const ok = await confirm({
      title: t('giftloyalty.loyalty.redeemConfirmTitle'),
      description: t('giftloyalty.loyalty.redeemConfirmBody', { points }),
      confirmLabel: t('giftloyalty.loyalty.redeem'),
      cancelLabel: t('giftloyalty.cancel'),
      danger: true,
    });
    if (!ok) return;

    if (redeemLoading) return;
    setRedeemLoading(true);
    setActionError(null);
    try {
      const res = await redeemLoyaltyPoints({
        program_id: programId.trim(),
        customer_id: customerId.trim(),
        points,
      });
      if (res.error) {
        setActionError(res.error);
        toastError(res.error);
      } else if (res.data) {
        const pts = Number.isFinite(res.data.points) ? Math.abs(res.data.points) : 0;
        const bal = Number.isFinite(res.data.balance_after) ? Math.max(0, res.data.balance_after) : 0;
        toastSuccess(
          t('giftloyalty.loyalty.redeemSuccess', {
            points: pts,
            balance: bal,
          }),
        );
        setRedeemPoints('');
        void onLookupBalance();
      }
    } catch {
      const msg = t('common.error.load_failed');
      setActionError(msg);
      toastError(msg);
    }
    setRedeemLoading(false);
  }, [
    redeemPoints,
    redeemLoading,
    hasProgram,
    hasCustomer,
    programId,
    customerId,
    confirm,
    toastSuccess,
    toastError,
    onLookupBalance,
  ]);

  return (
    <OpsCard
      icon={Award}
      title={t('giftloyalty.loyalty.title')}
      description={t('giftloyalty.loyalty.description')}
      testId="ops-loyalty"
    >
      {programs.length === 0 ? (
        <p
          className="text-sm text-[var(--text-muted)]"
          data-testid="ops-loyalty-noprograms"
        >
          {t('giftloyalty.loyalty.noPrograms')}
        </p>
      ) : (
        <div className="space-y-5">
          {/* Sélecteur programme + customer id + lookup */}
          <form
            className="flex items-end gap-3 flex-wrap"
            onSubmit={(e) => {
              e.preventDefault();
              void onLookupBalance();
            }}
          >
            <Select
              label={t('giftloyalty.loyalty.programLabel')}
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              containerClassName="min-w-[12rem]"
              data-testid="ops-loyalty-program"
            >
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Input
              label={t('giftloyalty.loyalty.customerIdLabel')}
              placeholder={t('giftloyalty.loyalty.customerIdPlaceholder')}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              containerClassName="flex-1 min-w-[12rem]"
              data-testid="ops-loyalty-customer"
              autoComplete="off"
            />
            <Button
              type="submit"
              variant="secondary"
              leftIcon={<Icon as={Search} size="sm" />}
              isLoading={balLoading}
              disabled={balLoading || !hasCustomer}
              aria-label={t('giftloyalty.loyalty.lookup')}
              data-testid="ops-loyalty-lookup"
            >
              {t('giftloyalty.loyalty.lookup')}
            </Button>
          </form>

          {/* Balance result */}
          <div aria-live="polite" aria-busy={balLoading}>
            {balError ? (
              <p
                role="alert"
                className="text-sm text-[var(--danger)]"
                data-testid="ops-loyalty-balance-error"
              >
                {balError}
              </p>
            ) : balance ? (
              <dl
                className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--gray-50)]"
                data-testid="ops-loyalty-balance-result"
              >
                <div>
                  <dt className="text-[var(--text-muted)]">
                    {t('giftloyalty.loyalty.currentBalance')}
                  </dt>
                  <dd className="font-semibold text-[var(--text-primary)]">
                    {balance.current_balance}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">
                    {t('giftloyalty.loyalty.lifetimeEarned')}
                  </dt>
                  <dd className="font-semibold text-[var(--text-primary)]">
                    {balance.lifetime_earned}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">
                    {t('giftloyalty.loyalty.tier')}
                  </dt>
                  <dd className="text-[var(--text-secondary)]">
                    {balance.current_tier}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">
                    {t('giftloyalty.loyalty.lastEarn')}
                  </dt>
                  <dd className="text-[var(--text-secondary)]">
                    {balance.last_earn_at
                      ? new Date(balance.last_earn_at).toLocaleDateString()
                      : '—'}
                  </dd>
                </div>
              </dl>
            ) : balSearched && !balLoading ? (
              <p
                className="text-sm text-[var(--text-muted)]"
                data-testid="ops-loyalty-balance-empty"
              >
                {t('giftloyalty.loyalty.balanceEmpty')}
              </p>
            ) : null}
          </div>

          {/* Earn / Redeem actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <form
              className="space-y-3 p-4 rounded-xl border border-[var(--border-subtle)]"
              onSubmit={(e) => {
                e.preventDefault();
                void onEarn();
              }}
            >
              <Input
                label={t('giftloyalty.loyalty.earnSubtotalLabel')}
                placeholder="0.00"
                inputMode="decimal"
                value={earnSubtotal}
                onChange={(e) => setEarnSubtotal(e.target.value)}
                helper={t('giftloyalty.loyalty.earnHelper')}
                data-testid="ops-loyalty-earn-subtotal"
                autoComplete="off"
              />
              <Button
                type="submit"
                leftIcon={<Icon as={PlusCircle} size="sm" />}
                isLoading={earnLoading}
                disabled={
                  earnLoading ||
                  !hasProgram ||
                  !hasCustomer ||
                  earnSubtotal.trim().length === 0
                }
                aria-label={t('giftloyalty.loyalty.earn')}
                data-testid="ops-loyalty-earn-submit"
              >
                {t('giftloyalty.loyalty.earn')}
              </Button>
            </form>

            <form
              className="space-y-3 p-4 rounded-xl border border-[var(--border-subtle)]"
              onSubmit={(e) => {
                e.preventDefault();
                void onRedeem();
              }}
            >
              <Input
                label={t('giftloyalty.loyalty.redeemPointsLabel')}
                placeholder="0"
                inputMode="numeric"
                value={redeemPoints}
                onChange={(e) => setRedeemPoints(e.target.value)}
                helper={t('giftloyalty.loyalty.redeemHelper')}
                data-testid="ops-loyalty-redeem-points"
                autoComplete="off"
              />
              <Button
                type="submit"
                variant="danger"
                leftIcon={<Icon as={ArrowDownCircle} size="sm" />}
                isLoading={redeemLoading}
                disabled={
                  redeemLoading ||
                  !hasProgram ||
                  !hasCustomer ||
                  redeemPoints.trim().length === 0
                }
                aria-label={t('giftloyalty.loyalty.redeem')}
                data-testid="ops-loyalty-redeem-submit"
              >
                {t('giftloyalty.loyalty.redeem')}
              </Button>
            </form>
          </div>

          <div aria-live="assertive">
            {actionError ? (
              <p
                role="alert"
                className="text-sm text-[var(--danger)]"
                data-testid="ops-loyalty-action-error"
              >
                {actionError}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </OpsCard>
  );
}

// ── OpsCard — wrapper visuel commun ──────────────────────────────────────────

interface OpsCardProps {
  icon: typeof Gift;
  title: string;
  description: string;
  testId: string;
  children: React.ReactNode;
}

function OpsCard({
  icon: IconCmp,
  title,
  description,
  testId,
  children,
}: OpsCardProps) {
  return (
    <section
      className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      data-testid={testId}
    >
      <header className="flex items-start gap-3 mb-4">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--gray-100)] text-[var(--primary)] shrink-0">
          <Icon as={IconCmp} size="md" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {title}
          </h3>
          <p className="t-caption text-[var(--gray-500)] mt-0.5">
            {description}
          </p>
        </div>
      </header>
      {children}
    </section>
  );
}
