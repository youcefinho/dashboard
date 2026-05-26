// ── Boutique — Gestion des paniers abandonnés (séquence multi-touch) ─────────
// Sprint 40 — Agent B3 (seq135). Liste les paniers actifs dans la séquence
// de récupération (1 h / 24 h / 72 h), avec actions inline opérateur :
//   • Skip step / Mark recovered (Pause) → updateRecoveryConfig({ skip: true })
//     côté serveur, cela marque `recovery_completed_at = now()` (= STOP).
//   • Re-send now → updateRecoveryConfig({ force_resend: true })
//     (force le re-trigger de la prochaine étape même si delay non atteint).
//
// ⚠️ Le helper `updateRecoveryConfig` est FIGÉ (cf. src/lib/api.ts) — l'input
// accepté est `{ skip?, force_resend?, override_coupon_code? }` UNIQUEMENT.
// Les champs métier (recovery_email_sent_count, recovery_completed_at) sont
// recalculés serveur, jamais poussés depuis le client.
//
// Tri : `next_recovery_due_at` ASC (les paniers dus bientôt en premier).
// Stripe-clean, FR-QC, a11y aria-labels i18n, reduced-motion safe.
//
// Imports RELATIFS (consigne sprint).

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Tag,
  Skeleton,
  EmptyState,
  Icon,
  useToast,
} from '../ui';
import {
  getRecoverySequenceStates,
  updateRecoveryConfig,
} from '../../lib/api';
import { t, getLocale } from '../../lib/i18n';
import { formatDate } from '../../lib/i18n/datetime';
import type { RecoverySequenceState } from '../../lib/types';
import {
  Mail,
  MailOpen,
  MailMinus,
  ShoppingCart,
  SkipForward,
  Send,
  PauseCircle,
  CheckCircle2,
  Clock,
  Tag as TagIcon,
} from 'lucide-react';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Numéro de step "logique" affiché à l'opérateur : la prochaine touche due.
 * recovery_email_sent_count = touches DÉJÀ envoyées (0..3).
 * On affiche donc count+1 (la prochaine), clampé à 3.
 */
function nextStepNumber(count: number): 1 | 2 | 3 {
  if (count <= 0) return 1;
  if (count === 1) return 2;
  return 3;
}

function stepVariant(
  step: 1 | 2 | 3,
): 'info' | 'warning' | 'danger' {
  if (step === 1) return 'info';
  if (step === 2) return 'warning';
  return 'danger';
}

function stepIcon(step: 1 | 2 | 3): typeof Mail {
  if (step === 1) return Mail;
  if (step === 2) return MailOpen;
  return MailMinus;
}

function stepLabelKey(step: 1 | 2 | 3): string {
  if (step === 1) return 'ecommerce.abandonedCarts.step1';
  if (step === 2) return 'ecommerce.abandonedCarts.step2';
  return 'ecommerce.abandonedCarts.step3';
}

/**
 * Aperçu tronqué du cart_token (jeton public, peut être long signé HMAC).
 * On garde 12 chars + ellipsis — suffit pour qu'un opérateur s'y retrouve,
 * pas assez pour fuiter le jeton dans un screenshot.
 */
function cartTokenPreview(token: string): string {
  if (!token) return '—';
  if (token.length <= 12) return token;
  return `${token.slice(0, 12)}…`;
}

/**
 * "il y a 2 h" — sans dépendre d'une lib (locale-agnostic, FR-QC par défaut).
 * Pour les sprints précédents, formatDate gère les dates absolues ; ici on
 * veut un relatif compact pour la colonne "last_recovery_at".
 */
function formatRelative(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const now = Date.now();
  const diffMs = now - then;
  const absMin = Math.round(Math.abs(diffMs) / 60000);
  const sign = diffMs >= 0 ? 1 : -1;

  // Intl.RelativeTimeFormat — natif, pas de dep.
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absMin < 1) return rtf.format(0, 'minute');
  if (absMin < 60) return rtf.format(-sign * absMin, 'minute');
  const absHour = Math.round(absMin / 60);
  if (absHour < 48) return rtf.format(-sign * absHour, 'hour');
  const absDay = Math.round(absHour / 24);
  return rtf.format(-sign * absDay, 'day');
}

// ── Compteurs attempts (opened / clicked) ──────────────────────────────────
// Le type RecoverySequenceState n'expose PAS `opened` / `clicked` par tentative
// (cf. src/lib/types.ts L2801-2806). On affiche donc le total des tentatives
// envoyées (= attempts.length) + un breakdown par canal (email / sms) sous
// forme de Tag, ce qui couvre la consigne "attempts opened/clicked count"
// dans la mesure du contrat actuel. Si le shape API s'enrichit plus tard,
// l'évolution se fera ici sans casser la table.

interface AttemptsBreakdown {
  total: number;
  emails: number;
  sms: number;
}

function attemptsBreakdown(c: RecoverySequenceState): AttemptsBreakdown {
  const list = c.attempts || [];
  return {
    total: list.length,
    emails: list.filter((a) => a.channel === 'email').length,
    sms: list.filter((a) => a.channel === 'sms').length,
  };
}

// ── Composant ──────────────────────────────────────────────────────────────

export function AbandonedCartsManager() {
  const { success, error: toastError } = useToast();
  const locale = getLocale();

  const [carts, setCarts] = useState<RecoverySequenceState[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getRecoverySequenceStates();
      setCarts(res.data || []);
    } catch {
      setCarts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Filtre + tri : on n'affiche que les paniers ACTIFS (non complétés),
  // triés par next_recovery_due_at ASC (les paniers dus bientôt d'abord).
  // Les nulls (pas de prochaine touche prévue) sont relégués en fin.
  const sortedActive = useMemo(() => {
    const list = (carts || []).filter((c) => !c.recovery_completed_at);
    return list.slice().sort((a, b) => {
      const ad = a.next_recovery_due_at
        ? new Date(a.next_recovery_due_at).getTime()
        : Number.POSITIVE_INFINITY;
      const bd = b.next_recovery_due_at
        ? new Date(b.next_recovery_due_at).getTime()
        : Number.POSITIVE_INFINITY;
      return ad - bd;
    });
  }, [carts]);

  // ── Actions inline ─────────────────────────────────────────────────────

  const handleSkip = async (cart: RecoverySequenceState) => {
    setActing(cart.cart_id);
    try {
      const res = await updateRecoveryConfig(cart.cart_id, { skip: true });
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('ecommerce.abandonedCarts.skip'));
      await load();
    } catch {
      toastError(t('ecommerce.abandonedCarts.skip'));
    } finally {
      setActing(null);
    }
  };

  const handleResend = async (cart: RecoverySequenceState) => {
    setActing(cart.cart_id);
    try {
      const res = await updateRecoveryConfig(cart.cart_id, {
        force_resend: true,
      });
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('ecommerce.abandonedCarts.resend'));
      await load();
    } catch {
      toastError(t('ecommerce.abandonedCarts.resend'));
    } finally {
      setActing(null);
    }
  };

  const handlePause = async (cart: RecoverySequenceState) => {
    setActing(cart.cart_id);
    try {
      // `skip: true` marque la séquence comme complétée côté serveur
      // (recovery_completed_at = now()), ce qui stoppe les futurs envois.
      const res = await updateRecoveryConfig(cart.cart_id, { skip: true });
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('ecommerce.abandonedCarts.pause'));
      await load();
    } catch {
      toastError(t('ecommerce.abandonedCarts.pause'));
    } finally {
      setActing(null);
    }
  };

  // "Mark recovered manually" — sémantiquement identique à pause côté API
  // (le contrat figé ne distingue pas "récupéré" de "stop manuel"). On garde
  // toutefois une action séparée pour clarté opérateur + toast distinct.
  const handleMarkRecovered = async (cart: RecoverySequenceState) => {
    setActing(cart.cart_id);
    try {
      const res = await updateRecoveryConfig(cart.cart_id, { skip: true });
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('ecommerce.abandonedCarts.title'));
      await load();
    } catch {
      toastError(t('ecommerce.abandonedCarts.title'));
    } finally {
      setActing(null);
    }
  };

  // ── Rendu ──────────────────────────────────────────────────────────────

  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="abandoned-carts-title"
    >
      <header className="flex items-center justify-between gap-3">
        <h2
          id="abandoned-carts-title"
          className="text-[15px] font-semibold text-[var(--text-primary)] inline-flex items-center gap-2"
        >
          <Icon as={ShoppingCart} size="sm" aria-hidden />
          {t('ecommerce.abandonedCarts.title')}
        </h2>
        {!loading && sortedActive.length > 0 && (
          <span className="text-[11px] text-[var(--text-muted)] t-mono-num">
            {sortedActive.length}
          </span>
        )}
      </header>

      {loading ? (
        <div
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-live="polite"
          data-testid="abandoned-carts-loading"
        >
          <Skeleton className="h-14 w-full rounded" />
          <Skeleton className="h-14 w-full rounded" />
          <Skeleton className="h-14 w-full rounded" />
        </div>
      ) : sortedActive.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={<ShoppingCart size={32} strokeWidth={1.8} />}
          title={t('ecommerce.abandonedCarts.empty')}
        />
      ) : (
        <div
          className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]"
          role="region"
          aria-label={t('ecommerce.abandonedCarts.title')}
        >
          <table
            className="w-full text-[12px] border-collapse"
            data-testid="abandoned-carts-table"
          >
            <thead className="bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
              <tr className="text-left">
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('ecommerce.abandonedCarts.title')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Client
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Étape
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Dernier envoi
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Prochain envoi
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Coupon
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Tentatives
                </th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedActive.map((cart) => {
                const step = nextStepNumber(cart.recovery_email_sent_count);
                const StepIcon = stepIcon(step);
                const att = attemptsBreakdown(cart);
                const isActing = acting === cart.cart_id;

                return (
                  <tr
                    key={cart.cart_id}
                    className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]/40"
                    data-testid={`cart-row-${cart.cart_id}`}
                  >
                    {/* cart_token preview */}
                    <td className="px-3 py-2.5 align-middle">
                      <span
                        className="t-mono-num text-[var(--text-secondary)]"
                        title={cart.cart_token}
                      >
                        {cartTokenPreview(cart.cart_token)}
                      </span>
                    </td>

                    {/* customer_id (le shape figé n'expose pas l'email — on
                        affiche l'id, l'opérateur peut cliquer le cart pour le
                        détail complet via le panneau parent). */}
                    <td className="px-3 py-2.5 align-middle">
                      <span className="t-mono-num text-[11px] text-[var(--text-muted)]">
                        {cart.cart_id.slice(0, 10)}
                      </span>
                    </td>

                    {/* Step badge */}
                    <td className="px-3 py-2.5 align-middle">
                      <Tag
                        dot
                        size="sm"
                        variant={stepVariant(step)}
                        aria-label={t(stepLabelKey(step))}
                      >
                        <span className="inline-flex items-center gap-1">
                          <Icon as={StepIcon} size="xs" aria-hidden />
                          {step}/3
                        </span>
                      </Tag>
                    </td>

                    {/* last_recovery_at (relatif) */}
                    <td className="px-3 py-2.5 align-middle">
                      <span
                        className="text-[var(--text-muted)] inline-flex items-center gap-1"
                        title={
                          cart.last_recovery_at
                            ? formatDate(cart.last_recovery_at, locale, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : undefined
                        }
                      >
                        <Icon as={Clock} size="xs" aria-hidden />
                        {formatRelative(cart.last_recovery_at, locale)}
                      </span>
                    </td>

                    {/* next_recovery_due_at (absolu court) */}
                    <td className="px-3 py-2.5 align-middle">
                      <span className="t-mono-num text-[var(--text-secondary)]">
                        {cart.next_recovery_due_at
                          ? formatDate(cart.next_recovery_due_at, locale, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </span>
                    </td>

                    {/* discount code */}
                    <td className="px-3 py-2.5 align-middle">
                      {cart.recovery_discount_code ? (
                        <Tag size="sm" variant="neutral">
                          <span className="inline-flex items-center gap-1">
                            <Icon as={TagIcon} size="xs" aria-hidden />
                            {cart.recovery_discount_code}
                          </span>
                        </Tag>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>

                    {/* attempts breakdown */}
                    <td className="px-3 py-2.5 align-middle">
                      <span
                        className="inline-flex items-center gap-1.5 text-[var(--text-muted)]"
                        aria-label={`${att.total} tentatives (${att.emails} courriels, ${att.sms} SMS)`}
                      >
                        <span className="t-mono-num text-[var(--text-secondary)] font-medium">
                          {att.total}
                        </span>
                        {att.emails > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[11px]">
                            <Icon as={Mail} size="xs" aria-hidden />
                            {att.emails}
                          </span>
                        )}
                        {att.sms > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[11px]">
                            SMS {att.sms}
                          </span>
                        )}
                      </span>
                    </td>

                    {/* Actions inline */}
                    <td className="px-3 py-2.5 align-middle">
                      <div className="flex justify-end flex-wrap gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          disabled={isActing}
                          onClick={() => handleSkip(cart)}
                          aria-label={t('ecommerce.abandonedCarts.skip')}
                          data-testid={`skip-${cart.cart_id}`}
                        >
                          <Icon as={SkipForward} size="xs" aria-hidden />
                          {t('ecommerce.abandonedCarts.skip')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          disabled={isActing}
                          onClick={() => handleResend(cart)}
                          aria-label={t('ecommerce.abandonedCarts.resend')}
                          data-testid={`resend-${cart.cart_id}`}
                        >
                          <Icon as={Send} size="xs" aria-hidden />
                          {t('ecommerce.abandonedCarts.resend')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          disabled={isActing}
                          onClick={() => handlePause(cart)}
                          aria-label={t('ecommerce.abandonedCarts.pause')}
                          data-testid={`pause-${cart.cart_id}`}
                        >
                          <Icon as={PauseCircle} size="xs" aria-hidden />
                          {t('ecommerce.abandonedCarts.pause')}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="gap-1"
                          disabled={isActing}
                          onClick={() => handleMarkRecovered(cart)}
                          aria-label="Marquer récupéré"
                          data-testid={`recovered-${cart.cart_id}`}
                        >
                          <Icon as={CheckCircle2} size="xs" aria-hidden />
                          Récupéré
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
