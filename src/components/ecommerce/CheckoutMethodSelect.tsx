// ── Boutique — Sélecteur de méthode de paiement — Sprint E4 M3.3 ────────────
//
// ⚠️ ZONE RÉGULÉE — paiement marchand B2.
//
// Liste les méthodes de paiement disponibles selon la DEVISE/région de la
// commande (filtrage aligné sur les capabilities provider M1) :
//   - 'card'     (Stripe, page hébergée)  → CAD / EUR uniquement
//   - 'cod'      (paiement à la livraison) → universel (toute devise)
//   - 'dz_local' (CIB / Edahabia via SATIM) → DZD uniquement
//
// PCI : ce composant ne sélectionne QUE la méthode logique. AUCUNE saisie de
// carte ici — la capture est 100 % côté page hébergée du provider (M2/M3).
//
// Stripe SUBTLE, FR québécois, a11y (radiogroup + clavier), reduced-motion.

import type { PaymentMethod, SupportedCurrency } from '@/lib/types';
import { Icon, Skeleton } from '@/components/ui';
import { t } from '@/lib/i18n';
import { CreditCard, Truck, Landmark } from 'lucide-react';

// Devise → méthodes proposables (filtre identique à la logique capabilities
// M1 : Stripe absent hors CAD/EUR, dz_local seulement en DZD, COD universel).
function methodsForCurrency(cur: SupportedCurrency | string): PaymentMethod[] {
  const list: PaymentMethod[] = [];
  if (cur === 'CAD' || cur === 'EUR') list.push('card');
  if (cur === 'DZD') list.push('dz_local');
  list.push('cod'); // universel — repli toujours disponible
  return list;
}

const METHOD_ICON: Record<PaymentMethod, typeof CreditCard> = {
  card: CreditCard,
  cod: Truck,
  bank_transfer: Landmark,
  dz_local: CreditCard,
};

interface CheckoutMethodSelectProps {
  /** Devise réelle portée par la commande (M1). */
  currency: SupportedCurrency | string;
  value: PaymentMethod | null;
  onChange: (m: PaymentMethod) => void;
  disabled?: boolean;
  /**
   * S6 M1.2 — état chargement visuel pur (commande pas encore résolue).
   * Défaut `false` ⇒ iso-comportement pour les appelants existants.
   * N'affecte EN RIEN le filtrage devise/PCI `methodsForCurrency`.
   */
  loading?: boolean;
}

export function CheckoutMethodSelect({
  currency,
  value,
  onChange,
  disabled,
  loading = false,
}: CheckoutMethodSelectProps) {
  // S6 M1.2 — fallback chargement : devise pas encore connue ⇒ skeleton
  // (jamais d'écran vide ni d'état partiel). Logique PCI intouchée.
  if (loading || !currency) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[58px] w-full rounded-[var(--radius-md)]" />
        ))}
      </div>
    );
  }

  const methods = methodsForCurrency(currency);

  if (methods.length === 0) {
    return (
      <p className="text-[12px] text-[var(--text-muted)]">
        {t('shop.payment.no_method')}
      </p>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('shop.payment.choose_method')}
      className="flex flex-col gap-2"
    >
      {methods.map((m) => {
        const selected = value === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(m)}
            className="w-full text-left rounded-[var(--radius-md)] border p-3 flex items-start gap-3 transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-1"
            style={{
              borderColor: selected
                ? 'var(--primary)'
                : 'var(--border-subtle)',
              background: selected
                ? 'rgba(0,157,219,0.05)'
                : 'var(--bg-surface)',
            }}
          >
            <span
              aria-hidden
              className="inline-flex h-6 w-6 items-center justify-center rounded-md shrink-0"
              style={{
                background: selected
                  ? 'rgba(0,157,219,0.12)'
                  : 'var(--bg-subtle)',
                color: selected
                  ? 'var(--primary)'
                  : 'var(--text-muted)',
              }}
            >
              <Icon as={METHOD_ICON[m]} size={13} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                {t(`shop.payment.method.${m}`)}
              </span>
              <span className="block text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                {t(`shop.payment.method_hint.${m}`)}
              </span>
            </span>
            <span
              aria-hidden
              className="ml-auto mt-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border shrink-0"
              style={{
                borderColor: selected
                  ? 'var(--primary)'
                  : 'var(--border-strong)',
                background: selected ? 'var(--primary)' : 'transparent',
              }}
            >
              {selected && (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--bg-surface)' }}
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
