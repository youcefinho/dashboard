// ── CurrencySettings — Sprint 39 (Agent B1) ────────────────────────────────
// Gestion devises supportées + taux FX (lecture + refresh ECB + override
// manuel) via les 4 helpers FIGÉS §6 :
//   getCurrencies()                       → ApiResponse<SupportedCurrencyExt[]>
//   listCurrencyRates(filters?)           → ApiResponse<CurrencyRate[]>
//   refreshCurrencyRates()                → ApiResponse<{ refreshed: number }>
//   setManualCurrencyRate({ base, quote, rate }) → ApiResponse<CurrencyRate>
//
// Style Stripe-clean (calque SnapshotManager) : flat surfaces, border subtle,
// status badges. Toutes les chaînes via t(). aria-labels i18n sur actions.
// Aucun console.log (CLAUDE.md). Imports relatifs.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { RefreshCw, Pencil, Coins } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { t, getLocale } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/i18n/datetime';
import {
  getCurrencies,
  listCurrencyRates,
  refreshCurrencyRates,
  setManualCurrencyRate,
} from '../../lib/api';
import type { CurrencyRate, SupportedCurrencyExt } from '../../lib/types';

// ── Constantes ─────────────────────────────────────────────────────────────

/** Stale = taux fetched_at > 24h. */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Symbole canonique par code devise (affichage). */
const CURRENCY_SYMBOL: Record<SupportedCurrencyExt, string> = {
  CAD: '$',
  USD: '$',
  EUR: '€',
  DZD: 'د.ج',
  MAD: 'د.م.',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function isStale(fetchedAt: string): boolean {
  const ts = new Date(fetchedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > STALE_THRESHOLD_MS;
}

/** Classes badge par source. ecb=vert, manual=jaune, cached_stale=rouge. */
function sourceBadgeClass(source: CurrencyRate['source'], stale: boolean): string {
  if (stale) {
    return 'bg-rose-50 text-rose-700 border-rose-200';
  }
  if (source === 'manual') {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  // ecb / frankfurter → vert.
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

function sourceBadgeLabel(source: CurrencyRate['source'], stale: boolean): string {
  if (stale) return t('shop.currency.stale');
  if (source === 'manual') return t('shop.currency.source_manual');
  return t('shop.currency.source_ecb');
}

/** Format taux : 4 décimales, locale-sensitive. */
function formatRate(rate: number, locale: string): string {
  if (!Number.isFinite(rate)) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(rate);
}

// ── Composant ──────────────────────────────────────────────────────────────

export function CurrencySettings() {
  const { success, error: toastError } = useToast();

  const [currencies, setCurrencies] = useState<SupportedCurrencyExt[]>([]);
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Form manual override.
  const [formBase, setFormBase] = useState<SupportedCurrencyExt>('EUR');
  const [formQuote, setFormQuote] = useState<SupportedCurrencyExt>('CAD');
  const [formRate, setFormRate] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const locale = useMemo(() => getLocale(), []);

  // ── Chargement ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    const [currenciesRes, ratesRes] = await Promise.all([
      getCurrencies(),
      listCurrencyRates(),
    ]);
    if (currenciesRes.error) {
      toastError(currenciesRes.error);
      setCurrencies([]);
    } else if (currenciesRes.data) {
      setCurrencies(currenciesRes.data);
    }
    if (ratesRes.error) {
      toastError(ratesRes.error);
      setRates([]);
    } else if (ratesRes.data) {
      setRates(ratesRes.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Quand les devises arrivent, ajuster les defaults du form si besoin.
  useEffect(() => {
    if (currencies.length === 0) return;
    if (!currencies.includes(formBase)) {
      setFormBase(currencies[0] as SupportedCurrencyExt);
    }
    if (!currencies.includes(formQuote)) {
      const alt = currencies.find((c) => c !== formBase);
      if (alt) setFormQuote(alt);
    }
  }, [currencies, formBase, formQuote]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const res = await refreshCurrencyRates();
    setRefreshing(false);
    if (res.error) {
      toastError(res.error);
      return;
    }
    success(t('shop.currency.refresh'));
    // Re-load rates uniquement (currencies inchangées).
    const ratesRes = await listCurrencyRates();
    if (ratesRes.data) setRates(ratesRes.data);
  }, [success, toastError]);

  const handleSubmitOverride = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const rateNum = Number.parseFloat(formRate.replace(',', '.'));
      if (!Number.isFinite(rateNum) || rateNum <= 0) {
        toastError(t('shop.currency.manual_rate'));
        return;
      }
      if (formBase === formQuote) {
        toastError(t('shop.currency.manual_rate'));
        return;
      }
      setSubmitting(true);
      const res = await setManualCurrencyRate({
        base_currency: formBase,
        quote_currency: formQuote,
        rate: rateNum,
      });
      setSubmitting(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('shop.currency.manual_rate'));
      setFormRate('');
      const ratesRes = await listCurrencyRates();
      if (ratesRes.data) setRates(ratesRes.data);
    },
    [formBase, formQuote, formRate, success, toastError],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8" data-testid="currency-settings">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('shop.currency.title')}</h2>
          <p className="t-caption text-[var(--gray-500)] mt-1">
            {t('shop.currency.list')}
          </p>
        </div>
        <Button
          onClick={() => void handleRefresh()}
          size="sm"
          leftIcon={<Icon as={RefreshCw} size="sm" />}
          disabled={refreshing || loading}
          isLoading={refreshing}
          aria-label={t('shop.currency.refresh')}
          data-testid="currency-btn-refresh"
        >
          {t('shop.currency.refresh')}
        </Button>
      </header>

      {/* Section 1 — Devises supportées */}
      <section
        aria-labelledby="currency-supported-heading"
        data-testid="currency-section-supported"
      >
        <h3
          id="currency-supported-heading"
          className="t-h3 mb-3"
        >
          {t('shop.currency.list')}
        </h3>
        {loading ? (
          <div className="space-y-2" data-testid="currency-supported-loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
        ) : currencies.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">—</p>
        ) : (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-white overflow-hidden">
            <table
              className="w-full text-sm"
              aria-label={t('shop.currency.list')}
              data-testid="currency-supported-table"
            >
              <thead className="bg-[var(--gray-50)] text-[var(--text-muted)] text-xs uppercase tracking-wide">
                <tr>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    {t('shop.currency.title')}
                  </th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    {/* Symbole : pas de clé dédiée, on garde une cellule simple. */}
                    <span aria-hidden="true">$ / €</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {currencies.map((code) => (
                  <tr
                    key={code}
                    data-testid={`currency-row-${code}`}
                    className="border-t border-[var(--border-subtle)]"
                  >
                    <td className="px-4 py-2 font-mono text-[var(--text-primary)]">
                      {code}
                    </td>
                    <td className="px-4 py-2 text-[var(--text-secondary)]">
                      {CURRENCY_SYMBOL[code] ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 2 — Taux FX courants */}
      <section
        aria-labelledby="currency-rates-heading"
        data-testid="currency-section-rates"
      >
        <h3 id="currency-rates-heading" className="t-h3 mb-3">
          {t('shop.currency.title')} — {t('shop.currency.source_ecb')}
        </h3>
        {loading ? (
          <div className="space-y-2" data-testid="currency-rates-loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : rates.length === 0 ? (
          <div
            className="rounded-xl border border-dashed border-[var(--border-subtle)] p-6 text-center text-sm text-[var(--text-muted)]"
            data-testid="currency-rates-empty"
          >
            <Icon as={Coins} size={28} className="mx-auto mb-2 opacity-50" />
            {t('shop.currency.stale')}
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-white overflow-hidden">
            <table
              className="w-full text-sm"
              aria-label={t('shop.currency.title')}
              data-testid="currency-rates-table"
            >
              <thead className="bg-[var(--gray-50)] text-[var(--text-muted)] text-xs uppercase tracking-wide">
                <tr>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    Base
                  </th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    Quote
                  </th>
                  <th scope="col" className="text-right px-4 py-2 font-medium">
                    Rate
                  </th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    Source
                  </th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    {t('shop.currency.refresh')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => {
                  const stale = isStale(rate.fetched_at);
                  const badgeCls = sourceBadgeClass(rate.source, stale);
                  const badgeLbl = sourceBadgeLabel(rate.source, stale);
                  const fetchedRel = formatRelativeTime(rate.fetched_at, locale);
                  return (
                    <tr
                      key={rate.id}
                      data-testid={`currency-rate-row-${rate.id}`}
                      className="border-t border-[var(--border-subtle)]"
                    >
                      <td className="px-4 py-2 font-mono text-[var(--text-primary)]">
                        {rate.base_currency}
                      </td>
                      <td className="px-4 py-2 font-mono text-[var(--text-primary)]">
                        {rate.quote_currency}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-[var(--text-primary)]">
                        {formatRate(rate.rate, locale)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          data-testid={`currency-rate-badge-${rate.id}`}
                          data-source={rate.source}
                          data-stale={stale ? 'true' : 'false'}
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${badgeCls}`}
                        >
                          {badgeLbl}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[var(--text-muted)] text-xs">
                        {fetchedRel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 4 — Form manual override */}
      <section
        aria-labelledby="currency-manual-heading"
        data-testid="currency-section-manual"
      >
        <h3 id="currency-manual-heading" className="t-h3 mb-3">
          {t('shop.currency.manual_rate')}
        </h3>
        <form
          onSubmit={(e) => void handleSubmitOverride(e)}
          className="rounded-xl border border-[var(--border-subtle)] bg-white p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
          data-testid="currency-manual-form"
        >
          <Select
            label="Base"
            id="currency-manual-base"
            value={formBase}
            onChange={(e) =>
              setFormBase(e.target.value as SupportedCurrencyExt)
            }
            aria-label={`${t('shop.currency.manual_rate')} — Base`}
            data-testid="currency-manual-base"
            disabled={loading || submitting}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select
            label="Quote"
            id="currency-manual-quote"
            value={formQuote}
            onChange={(e) =>
              setFormQuote(e.target.value as SupportedCurrencyExt)
            }
            aria-label={`${t('shop.currency.manual_rate')} — Quote`}
            data-testid="currency-manual-quote"
            disabled={loading || submitting}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Input
            id="currency-manual-rate"
            label={t('shop.currency.manual_rate')}
            type="number"
            step="0.0001"
            min="0"
            inputMode="decimal"
            value={formRate}
            onChange={(e) => setFormRate(e.target.value)}
            placeholder="1.0000"
            aria-label={t('shop.currency.manual_rate')}
            data-testid="currency-manual-rate"
            disabled={loading || submitting}
            required
          />
          <Button
            type="submit"
            size="md"
            leftIcon={<Icon as={Pencil} size="sm" />}
            isLoading={submitting}
            disabled={
              loading ||
              submitting ||
              formRate.trim() === '' ||
              formBase === formQuote
            }
            aria-label={t('shop.currency.manual_rate')}
            data-testid="currency-manual-submit"
          >
            {t('shop.currency.manual_rate')}
          </Button>
        </form>
      </section>
    </div>
  );
}

export default CurrencySettings;
