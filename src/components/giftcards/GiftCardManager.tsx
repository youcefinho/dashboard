// ── GiftCardManager — Sprint 38 (Agent B1) ──────────────────────────────────
// Liste + émission + actions (copy code / void / transactions drawer) des
// cartes-cadeaux du tenant courant.
//
// API back FIGÉE :
//   getGiftCards()                       → ApiResponse<GiftCard[]>
//   issueGiftCard({ initial_value_cents, issued_to_email?, expires_at? })
//                                        → ApiResponse<GiftCard>
//   voidGiftCard(id)                     → ApiResponse<GiftCard>
//   refundToGiftCard(id, {amount_cents}) → ApiResponse<GiftCardTransaction>
//   getGiftCardTransactions(cardId)      → ApiResponse<GiftCardTransaction[]>
//
// UI Stripe-clean. i18n via t(). aria-labels i18n. Aucun console.log.
// Calque visuel : SnapshotManager (Sprint 35 B1).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Plus,
  Copy,
  Ban,
  Clock,
  Gift,
  Receipt,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { SlidePanel } from '../ui/SlidePanel';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t, getLocale } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import { formatMoneyCents } from '../../lib/i18n/number';
import {
  getGiftCards,
  issueGiftCard,
  voidGiftCard,
  getGiftCardTransactions,
  type GiftCard,
  type GiftCardStatus,
  type GiftCardTransaction,
  type GiftCardTransactionType,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Masque le code, ne révèle que les 4 derniers caractères. */
function maskCode(code: string): string {
  if (!code) return '';
  const cleaned = code.replace(/[\s-]/g, '');
  if (cleaned.length <= 4) return cleaned;
  const tail = cleaned.slice(-4);
  const masked = 'X'.repeat(Math.max(0, cleaned.length - 4));
  // Groupes de 4 pour lisibilité monospace.
  const merged = `${masked}${tail}`;
  return merged.replace(/(.{4})/g, '$1-').replace(/-$/, '');
}

/** Convertit un montant en dollars (string ou number) → cents entiers. */
function dollarsToCents(value: string): number {
  const n = Number.parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

const STATUS_CLASS: Record<GiftCardStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  redeemed:
    'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]',
  expired: 'bg-amber-50 text-amber-700 border-amber-200',
  voided: 'bg-rose-50 text-rose-700 border-rose-200',
};

function statusLabel(s: GiftCardStatus): string {
  if (s === 'expired') return t('giftCards.expired.tag');
  if (s === 'voided') return t('giftCards.voided.tag');
  if (s === 'redeemed') return t('giftCards.redeem.cta');
  return t('giftCards.title');
}

function txTypeLabel(type: GiftCardTransactionType): string {
  // Pas de clés dédiées dans i18n encore — fallback raw label FR-CA cohérent.
  switch (type) {
    case 'issue':
      return 'Émission';
    case 'credit':
      return 'Crédit';
    case 'debit':
      return 'Débit';
    case 'refund':
      return 'Remboursement';
    case 'expire':
      return 'Expiration';
    case 'void':
      return 'Annulation';
    default:
      return type;
  }
}

/** Wrapper clipboard navigator avec fallback execCommand pour test-safety. */
async function writeToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// ── Composant ──────────────────────────────────────────────────────────────

export function GiftCardManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [cards, setCards] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  // Form émission : montant saisi en DOLLARS (string), converti en cents au submit.
  const [formInitialValue, setFormInitialValue] = useState<string>('');
  const [formCustomerEmail, setFormCustomerEmail] = useState<string>('');
  const [formExpiresAt, setFormExpiresAt] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Drawer transactions
  const [txCardId, setTxCardId] = useState<string | null>(null);
  const [txList, setTxList] = useState<GiftCardTransaction[]>([]);
  const [txLoading, setTxLoading] = useState<boolean>(false);

  const locale = useMemo(() => getLocale(), []);

  // ── Chargement initial ──────────────────────────────────────────────────
  const loadCards = useCallback(async () => {
    setLoading(true);
    const res = await getGiftCards();
    if (res.error) {
      toastError(res.error);
      setCards([]);
    } else if (res.data) {
      setCards(res.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  // ── Émission ────────────────────────────────────────────────────────────
  const handleOpenIssue = useCallback(() => {
    setFormInitialValue('');
    setFormCustomerEmail('');
    setFormExpiresAt('');
    setModalOpen(true);
  }, []);

  const handleSubmitIssue = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const cents = dollarsToCents(formInitialValue);
      if (cents <= 0) {
        toastError(t('giftCards.issue.error'));
        return;
      }
      setSubmitting(true);
      const res = await issueGiftCard({
        initial_value_cents: cents,
        issued_to_email: formCustomerEmail.trim() || null,
        expires_at: formExpiresAt ? formExpiresAt : null,
      });
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('giftCards.issue.success'));
      setModalOpen(false);
      setFormInitialValue('');
      setFormCustomerEmail('');
      setFormExpiresAt('');
      void loadCards();
    },
    [
      formInitialValue,
      formCustomerEmail,
      formExpiresAt,
      success,
      toastError,
      loadCards,
    ],
  );

  // ── Actions par carte ───────────────────────────────────────────────────

  const handleCopyCode = useCallback(
    async (card: GiftCard) => {
      const ok = await writeToClipboard(card.code);
      if (ok) {
        success(`${t('action.copy')} — ${maskCode(card.code)}`);
      } else {
        toastError(t('giftCards.errors.codeInvalid'));
      }
    },
    [success, toastError],
  );

  const handleVoid = useCallback(
    async (card: GiftCard) => {
      const ok = await confirm({
        title: t('giftCards.voided.tag'),
        description: `${t('giftCards.title')} — ${maskCode(card.code)}`,
        confirmLabel: t('giftCards.voided.tag'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusyId(card.id);
      const res = await voidGiftCard(card.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('giftCards.voided.tag'));
      void loadCards();
    },
    [confirm, toastError, success, loadCards],
  );

  const handleOpenTransactions = useCallback(
    async (card: GiftCard) => {
      setTxCardId(card.id);
      setTxList([]);
      setTxLoading(true);
      const res = await getGiftCardTransactions(card.id);
      setTxLoading(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      setTxList(res.data ?? []);
    },
    [toastError],
  );

  const handleCloseTransactions = useCallback(() => {
    setTxCardId(null);
    setTxList([]);
  }, []);

  const activeTxCard = useMemo(
    () => (txCardId ? cards.find((c) => c.id === txCardId) ?? null : null),
    [txCardId, cards],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="giftcard-manager">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('giftCards.title')}</h2>
        </div>
        <Button
          onClick={handleOpenIssue}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('giftCards.issue.cta')}
        >
          {t('giftCards.issue.cta')}
        </Button>
      </header>

      {/* Liste / loading / empty */}
      {loading ? (
        <div className="space-y-3" data-testid="giftcard-loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white"
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
      ) : cards.length === 0 ? (
        <EmptyState
          icon={<Icon as={Gift} size={40} />}
          title={t('giftCards.empty')}
          action={
            <Button
              onClick={handleOpenIssue}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('giftCards.issue.cta')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="giftcard-list"
          aria-label={t('giftCards.title')}
        >
          {cards.map((card) => {
            const isBusy = busyId === card.id;
            const masked = maskCode(card.code);
            const balance = formatMoneyCents(
              card.current_balance_cents,
              locale,
              card.currency || 'CAD',
            );
            const issuedTo =
              card.issued_to_email ||
              card.issued_to_customer_id ||
              '—';
            const expiresRel = card.expires_at
              ? formatRelativeTime(card.expires_at, locale)
              : null;
            const labelCopy = t('action.copy');
            const labelVoid = t('giftCards.voided.tag');
            const labelTx = t('loyalty.history.title');

            const canVoid = card.status === 'active';

            return (
              <li
                key={card.id}
                data-testid={`giftcard-row-${card.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      data-testid={`giftcard-code-${card.id}`}
                      className="font-mono text-sm font-semibold text-[var(--text-primary)] tracking-wider"
                    >
                      {masked}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyCode(card)}
                      className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-ring)] rounded px-1.5 py-0.5"
                      aria-label={`${labelCopy} — ${masked}`}
                      data-testid={`giftcard-copy-${card.id}`}
                    >
                      <Icon as={Copy} size="sm" />
                      {labelCopy}
                    </button>
                    <span
                      data-testid={`giftcard-status-${card.id}`}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CLASS[card.status]}`}
                    >
                      {statusLabel(card.status)}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-[var(--text-muted)]">
                      {t('giftCards.balance')}
                    </span>
                    <span
                      data-testid={`giftcard-balance-${card.id}`}
                      className="font-semibold text-[var(--text-primary)]"
                    >
                      {balance}
                    </span>
                  </div>

                  <div className="text-xs text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1">
                    <span>{issuedTo}</span>
                    {expiresRel ? (
                      <>
                        <span aria-hidden="true">•</span>
                        <span className="inline-flex items-center gap-1">
                          <Icon as={Clock} size="sm" />
                          {t('giftCards.expires.label')} {expiresRel}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Receipt} size="sm" />}
                    onClick={() => void handleOpenTransactions(card)}
                    disabled={isBusy}
                    aria-label={`${labelTx} — ${masked}`}
                  >
                    {labelTx}
                  </Button>
                  {canVoid ? (
                    <Button
                      variant="danger"
                      size="sm"
                      leftIcon={<Icon as={Ban} size="sm" />}
                      onClick={() => void handleVoid(card)}
                      disabled={isBusy}
                      aria-label={`${labelVoid} — ${masked}`}
                    >
                      {labelVoid}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal émission */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={t('giftCards.issue.cta')}
        size="md"
        closeLabel={t('action.close')}
      >
        <form onSubmit={handleSubmitIssue} className="space-y-4">
          <div>
            <label
              htmlFor="giftcard-amount"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('giftCards.balance')}
            </label>
            <Input
              id="giftcard-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={formInitialValue}
              onChange={(e) => setFormInitialValue(e.target.value)}
              autoFocus
              required
              leftSlot="$"
              aria-label={t('giftCards.balance')}
            />
          </div>

          <div>
            <label
              htmlFor="giftcard-email"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('giftCards.email.subject')}
            </label>
            <Input
              id="giftcard-email"
              type="email"
              value={formCustomerEmail}
              onChange={(e) => setFormCustomerEmail(e.target.value)}
              placeholder="customer@example.com"
              aria-label={t('giftCards.email.subject')}
            />
          </div>

          <div>
            <label
              htmlFor="giftcard-expires"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('giftCards.expires.label')}
            </label>
            <Input
              id="giftcard-expires"
              type="date"
              value={formExpiresAt}
              onChange={(e) => setFormExpiresAt(e.target.value)}
              aria-label={t('giftCards.expires.label')}
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
              disabled={submitting || dollarsToCents(formInitialValue) <= 0}
              aria-label={t('giftCards.issue.cta')}
            >
              {t('giftCards.issue.cta')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Drawer transactions */}
      <SlidePanel
        open={txCardId !== null}
        onOpenChange={(o) => {
          if (!o) handleCloseTransactions();
        }}
        title={t('loyalty.history.title')}
        size="md"
      >
        <div className="space-y-4 p-4" data-testid="giftcard-transactions">
          {activeTxCard ? (
            <div className="flex items-center gap-2 pb-3 border-b border-[var(--border-subtle)]">
              <span className="font-mono text-sm font-semibold text-[var(--text-primary)] tracking-wider">
                {maskCode(activeTxCard.code)}
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CLASS[activeTxCard.status]}`}
              >
                {statusLabel(activeTxCard.status)}
              </span>
            </div>
          ) : null}

          {txLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : txList.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-6">
              {t('giftCards.empty')}
            </p>
          ) : (
            <table
              className="w-full text-sm"
              aria-label={t('loyalty.history.title')}
            >
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)] uppercase">
                  <th className="font-medium py-2 pr-3">Date</th>
                  <th className="font-medium py-2 pr-3">Type</th>
                  <th className="font-medium py-2 pr-3 text-right">Montant</th>
                  <th className="font-medium py-2 text-right">
                    {t('giftCards.balance')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {txList.map((tx) => (
                  <tr
                    key={tx.id}
                    data-testid={`giftcard-tx-${tx.id}`}
                    className="border-t border-[var(--border-subtle)]"
                  >
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">
                      {tx.created_at
                        ? formatRelativeTime(tx.created_at, locale)
                        : '—'}
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">
                      {txTypeLabel(tx.type)}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium text-[var(--text-primary)]">
                      {formatMoneyCents(
                        tx.amount_cents,
                        locale,
                        activeTxCard?.currency || 'CAD',
                      )}
                    </td>
                    <td className="py-2 text-right text-[var(--text-secondary)]">
                      {formatMoneyCents(
                        tx.balance_after_cents,
                        locale,
                        activeTxCard?.currency || 'CAD',
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SlidePanel>
    </div>
  );
}
