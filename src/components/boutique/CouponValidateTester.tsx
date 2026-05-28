// ── CouponValidateTester — Sprint (Agent) ────────────────────────────────────
// Surface de la capacité `validateCoupon` restée non câblée dans la page
// Coupons : tester un code promo contre un sous-total et afficher la remise
// calculée (discount_cents) ou le motif de rejet.
// Pattern calqué sur le dashboard : imports RELATIFS, i18n via t(), états
// loading(aria-busy)/empty/error(role=alert), a11y (labels, aria-live),
// money formatting via formatMoneyCents. 100% additif, aucune clé existante
// modifiée — nouvelles clés sous le namespace `couponsx.*`.

import { useState } from 'react';
import { TicketCheck } from 'lucide-react';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Tag } from '../ui/Tag';
import { validateCoupon, type CouponValidation } from '../../lib/api';
import { t, getLocale } from '../../lib/i18n';
import { formatMoneyCents } from '../../lib/i18n/number';

interface CouponValidateTesterProps {
  /** Devise par défaut pré-remplie (héritée de la page / d'un coupon). */
  defaultCurrency?: string;
}

export function CouponValidateTester({ defaultCurrency }: CouponValidateTesterProps) {
  const currency = defaultCurrency || 'CAD';
  const [code, setCode] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<CouponValidation | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setErr(t('couponsx.validate_need_code'));
      setResult(null);
      return;
    }
    setTesting(true);
    setErr(null);
    setResult(null);
    try {
      // subtotal saisi en dollars → cents pour le worker.
      const dollars = subtotal.trim() ? Number(subtotal) : NaN;
      const subtotalCents = Number.isFinite(dollars) && dollars > 0
        ? Math.round(dollars * 100)
        : undefined;
      const res = await validateCoupon({
        code: trimmed,
        subtotal_cents: subtotalCents,
        currency,
      });
      // Discrimination d'erreur = absence de `data` (apiFetch GELÉ).
      if (!res.data) {
        setErr(t('couponsx.validate_error'));
      } else {
        setResult(res.data);
      }
    } catch {
      setErr(t('couponsx.validate_error'));
    }
    setTesting(false);
  };

  return (
    <Card className="p-4 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <TicketCheck size={16} className="text-[var(--text-muted)]" />
        <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
          {t('couponsx.validate_title')}
        </h2>
      </div>
      <p className="text-[12px] text-[var(--text-muted)] mb-3">
        {t('couponsx.validate_desc')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <div className="sm:col-span-1">
          <label
            htmlFor="couponsx-code"
            className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5"
          >
            {t('ecommerce.coupons.code')}
          </label>
          <Input
            id="couponsx-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="PROMO10"
          />
        </div>
        <div className="sm:col-span-1">
          <label
            htmlFor="couponsx-subtotal"
            className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5"
          >
            {t('couponsx.validate_subtotal')}
          </label>
          <Input
            id="couponsx-subtotal"
            type="number"
            inputMode="decimal"
            value={subtotal}
            onChange={(e) => setSubtotal(e.target.value)}
            placeholder="100"
          />
        </div>
        <div className="sm:col-span-1">
          <Button
            variant="secondary"
            onClick={() => void run()}
            disabled={testing}
            aria-busy={testing || undefined}
            className="w-full"
          >
            {testing ? t('common.loading') : t('couponsx.validate_action')}
          </Button>
        </div>
      </div>

      {err && (
        <p role="alert" className="text-[13px] text-[var(--danger)] mt-3">
          {err}
        </p>
      )}

      {result && (
        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]" aria-live="polite">
          {result.valid ? (
            <div className="flex flex-wrap items-center gap-3">
              <Tag size="sm" dot variant="success">
                {t('couponsx.validate_valid')}
              </Tag>
              <span className="text-[13px] text-[var(--text-secondary)]">
                {t('couponsx.validate_discount')}{': '}
                <span className="font-medium font-mono text-[var(--text-primary)]">
                  {formatMoneyCents(result.discount_cents ?? 0, getLocale(), currency)}
                </span>
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Tag size="sm" dot variant="neutral">
                {t('couponsx.validate_invalid')}
              </Tag>
              {result.reason && (
                <span className="text-[13px] text-[var(--text-muted)]">{result.reason}</span>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
