// ── PublicCheckout — tunnel acheteur public (LOT STOREFRONT CHECKOUT, Sprint 7) ─
//
// Corps réel Phase C Manager-C. L'export nommé `PublicCheckoutPage` est FIGÉ
// (App.tsx GELÉ le lazy-importe — route publique `/store/$slug/checkout`, hors
// auth/LazyGuard). NEUF — owned EXCLUSIF Manager-C.
//
// Tunnel multi-étapes (barre de progression CheckoutStepper) :
//   (1) Panier        getStoreCart → items, qty modifiables (update/remove), sous-total
//   (2) Coordonnées   email, nom, téléphone, adresse complète, pays
//   (3) Livraison     getStoreShippingQuote(slug, token, address) → frais + aperçu taxes
//   (4) Récap         sous-total + taxes + frais + code promo optionnel → total
//   (5) Paiement MOCK mention claire « paiement de démonstration » (E4/E6 inactif —
//                     ZÉRO champ carte) → storeCheckout(slug, CheckoutInput)
//   (6) Confirmation  getStoreOrder → numéro de commande + récap ; vide le token.
//
// Calque PublicBooking.tsx : spinner pendant les appels, écran de succès final,
// discrimination erreur = absence `data` / champ `error` (§6.A — JAMAIS de
// `code`). i18n 100% t('checkout.*') / t('store.*') (clés FIGÉES Phase A —
// AUCUNE création Phase C). Le front N'INVENTE jamais prix/taxes/frais — tout
// vient du backend (cents, §6.B). Token panier persisté en localStorage
// (`intralys_store_cart_<slug>`), vidé après confirmation réussie.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  getStoreCart,
  updateStoreCartItem,
  removeStoreCartItem,
  getStoreShippingQuote,
  storeCheckout,
  getStoreOrder,
} from '@/lib/api';
import type { PublicCart, CheckoutInput, CheckoutResult } from '@/lib/types';
import { t } from '@/lib/i18n';
import { CartLineItem, CheckoutStepper, OrderSummary, fmtMoney } from '@/components/storefront';

// ── Token panier persistant (même convention que PublicStore.tsx, §6.F) ──────
function cartStorageKey(slug: string): string {
  return `intralys_store_cart_${slug}`;
}
function readCartToken(slug: string): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(cartStorageKey(slug)) : null;
  } catch {
    return null;
  }
}
function clearCartToken(slug: string): void {
  try {
    window.localStorage.removeItem(cartStorageKey(slug));
  } catch {
    /* localStorage indisponible — sans effet. */
  }
}

type ShippingQuote = {
  shipping_cents: number;
  shipping_name: string | null;
  tax_cents: number;
  subtotal_cents: number;
  total_cents: number;
  currency?: string;
};

const STEP_CART = 0;
const STEP_CONTACT = 1;
const STEP_SHIPPING = 2;
const STEP_REVIEW = 3;
const STEP_PAYMENT = 4;

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div
        style={{
          width: 28,
          height: 28,
          border: '3px solid rgba(99,91,255,0.2)',
          borderTopColor: '#635BFF',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
    </div>
  );
}

export function PublicCheckoutPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const cartToken = useMemo(() => readCartToken(slug), [slug]);

  const [step, setStep] = useState<number>(STEP_CART);
  const [cart, setCart] = useState<PublicCart | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); // appel cart/quote/checkout en cours
  const [error, setError] = useState('');

  // Coordonnées + adresse (CheckoutInput, §6.B)
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [region] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('CA');

  // Livraison + promo
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [coupon, setCoupon] = useState('');

  // Confirmation finale
  const [order, setOrder] = useState<
    (CheckoutResult & { items?: Array<{ name: string; qty: number; price_cents: number }> }) | null
  >(null);

  const currency = quote?.currency || cart?.currency;
  const subtotalCents = cart?.subtotal_cents ?? 0;

  const stepLabels = [
    t('store.cart'),
    t('checkout.contact'),
    t('checkout.shipping'),
    t('checkout.summary'),
    t('checkout.pay'),
  ];

  const buildAddress = useCallback(
    (): CheckoutInput['address'] => ({
      line1: line1.trim(),
      line2: line2.trim() || undefined,
      city: city.trim(),
      region: region.trim() || undefined,
      postal_code: postalCode.trim() || undefined,
      country: country.trim(),
    }),
    [line1, line2, city, region, postalCode, country],
  );

  // ── Chargement du panier (calque PublicBooking : erreur = res.error/!res.data
  //    §6.A). Sans token ⇒ panier vide (rien à charger). ───────────────────────
  useEffect(() => {
    if (!slug) return;
    if (!cartToken) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    getStoreCart(slug, cartToken)
      .then((res) => {
        if (!alive) return;
        if (res.error || !res.data) {
          setError(res.error || t('api.unavailable'));
          return;
        }
        setCart(res.data);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug, cartToken]);

  // ── Modification de quantité (update/remove — helpers FIGÉS). qty<=0 ⇒ remove. ─
  const changeQty = useCallback(
    async (itemId: string | undefined, qty: number) => {
      if (!itemId || !cartToken || busy) return;
      setBusy(true);
      setError('');
      const res =
        qty <= 0
          ? await removeStoreCartItem(slug, cartToken, itemId)
          : await updateStoreCartItem(slug, cartToken, itemId, qty);
      setBusy(false);
      if (res.error || !res.data) {
        setError(res.error || t('api.unavailable'));
        return;
      }
      setCart(res.data);
      // Le panier a changé ⇒ tout devis de livraison antérieur est périmé.
      setQuote(null);
    },
    [slug, cartToken, busy],
  );

  const removeLine = useCallback(
    async (itemId: string | undefined) => {
      if (!itemId || !cartToken || busy) return;
      setBusy(true);
      setError('');
      const res = await removeStoreCartItem(slug, cartToken, itemId);
      setBusy(false);
      if (res.error || !res.data) {
        setError(res.error || t('api.unavailable'));
        return;
      }
      setCart(res.data);
      setQuote(null);
    },
    [slug, cartToken, busy],
  );

  // ── Étape 3 : devis de livraison (réutilise resolveShippingRate + computeTax
  //    côté worker — §6.C). Le front n'invente NI frais NI taxes. ─────────────
  const fetchQuote = useCallback(async () => {
    if (!cartToken || busy) return false;
    setBusy(true);
    setError('');
    const res = await getStoreShippingQuote(slug, cartToken, buildAddress());
    setBusy(false);
    if (res.error || !res.data) {
      setError(res.error || t('api.unavailable'));
      return false;
    }
    setQuote(res.data);
    return true;
  }, [slug, cartToken, busy, buildAddress]);

  const goToShipping = useCallback(async () => {
    const ok = await fetchQuote();
    if (ok) setStep(STEP_SHIPPING);
  }, [fetchQuote]);

  // ── Étape 5 : paiement MOCK → storeCheckout → confirmation (getStoreOrder). ──
  //    E4/E6 INACTIF : AUCUN champ carte, aucune init paiement réel. Le statut
  //    renvoyé est EXACTEMENT celui de createOrderCore (pending/unpaid) — §6.I.
  const handlePay = useCallback(async () => {
    if (!cartToken || busy) return;
    setBusy(true);
    setError('');
    const payload: CheckoutInput = {
      email: email.trim(),
      name: name.trim(),
      phone: phone.trim() || undefined,
      address: buildAddress(),
      shipping_method: quote?.shipping_name || undefined,
      coupon_code: coupon.trim() || undefined,
      cart_token: cartToken,
    };
    const res = await storeCheckout(slug, payload);
    if (res.error || !res.data) {
      setBusy(false);
      setError(res.error || t('checkout.error'));
      return;
    }
    // Confirmation : on tente getStoreOrder pour le récap détaillé ; à défaut on
    // retombe sur le CheckoutResult renvoyé par storeCheckout (best-effort).
    const orderRes = await getStoreOrder(slug, res.data.order_id);
    setBusy(false);
    setOrder(orderRes.data && !orderRes.error ? orderRes.data : res.data);
    // Commande passée ⇒ on vide le token panier (§6.F).
    clearCartToken(slug);
  }, [slug, cartToken, busy, email, name, phone, buildAddress, quote, coupon]);

  // ── Validation par étape ─────────────────────────────────────────────────
  const cartHasItems = (cart?.items?.length || 0) > 0;
  const contactValid =
    !!email.trim() && !!name.trim() && !!line1.trim() && !!city.trim() && !!country.trim();

  const labelClasses = 'mb-1 block text-sm font-medium text-[var(--text-secondary)]';
  const inputClasses =
    'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]';

  // ── Écran de confirmation (calque écran de succès PublicBooking). ──────────
  if (order) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--bg-surface)]">
        <div style={{ maxWidth: 480, width: '100%' }} className="text-center">
          <div
            style={{
              width: 64,
              height: 64,
              background: 'var(--success-bg, #ecfdf5)',
              color: 'var(--success, #10b981)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: 28,
            }}
          >
            ✓
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            {t('checkout.confirmation')}
          </h1>
          <p style={{ color: 'var(--text-muted, #6b7280)' }}>
            {t('checkout.order_number')} : <strong>{order.order_number}</strong>
          </p>

          {order.items && order.items.length > 0 && (
            <div className="mt-5 rounded-xl border border-[var(--border)] p-4 text-left text-sm">
              {order.items.map((it, i) => (
                <div key={i} className="flex justify-between py-1">
                  <span style={{ color: 'var(--text-primary, #374151)' }}>
                    {it.name} × {it.qty}
                  </span>
                  <span className="tabular-nums">{fmtMoney(it.price_cents * it.qty, currency)}</span>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t border-[var(--border)] pt-2 font-semibold">
                <span>{t('checkout.total')}</span>
                <span className="tabular-nums">{fmtMoney(order.total_cents, currency)}</span>
              </div>
            </div>
          )}

          <Link
            to={`/store/${slug}`}
            className="mt-6 inline-block rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
          >
            {t('store.continue_shopping')}
          </Link>
          <p className="pt-6" style={{ fontSize: 10, color: 'var(--text-muted, #6b7280)' }}>
            Propulsé par <strong>Intralys</strong>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-surface)]">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <Link to={`/store/${slug}`} className="text-sm" style={{ color: 'var(--primary)' }}>
            ← {t('store.continue_shopping')}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6" data-store-slug={slug}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>{t('checkout.title')}</h1>
        <div className="mb-6">
          <CheckoutStepper steps={stepLabels} current={step} />
        </div>

        {loading ? (
          <Spinner />
        ) : !cartHasItems ? (
          // Panier vide (calque store.cart_empty).
          <div className="py-10 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted, #6b7280)' }}>
              {t('store.cart_empty')}
            </p>
            <Link
              to={`/store/${slug}`}
              className="mt-4 inline-block rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              {t('store.continue_shopping')}
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[1fr_320px]">
            {/* Colonne principale : contenu de l'étape */}
            <div>
              {error && (
                <p className="mb-4 text-sm" style={{ color: 'var(--danger, #dc2626)' }}>
                  {error}
                </p>
              )}

              {/* ── Étape 1 : Panier ───────────────────────────────────── */}
              {step === STEP_CART && (
                <div>
                  <h2 className="mb-2 text-sm font-semibold">{t('store.cart')}</h2>
                  <div>
                    {(cart?.items || []).map((it) => (
                      <CartLineItem
                        key={it.id || `${it.product_id}-${it.variant_id}`}
                        item={it}
                        currency={currency}
                        disabled={busy}
                        onQtyChange={(q) => changeQty(it.id, q)}
                        onRemove={() => removeLine(it.id)}
                      />
                    ))}
                  </div>
                  <div className="mt-4 flex justify-between gap-3">
                    <Link
                      to={`/store/${slug}`}
                      className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
                    >
                      {t('store.continue_shopping')}
                    </Link>
                    <button
                      type="button"
                      onClick={() => setStep(STEP_CONTACT)}
                      disabled={busy}
                      className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {t('store.checkout')}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Étape 2 : Coordonnées + adresse ────────────────────── */}
              {step === STEP_CONTACT && (
                <div className="space-y-4">
                  <h2 className="text-sm font-semibold">{t('checkout.contact')}</h2>
                  <Field id="co-email" label={t('checkout.email')} type="email" value={email} onChange={setEmail} className={{ labelClasses, inputClasses }} />
                  <Field id="co-name" label={t('checkout.name')} value={name} onChange={setName} className={{ labelClasses, inputClasses }} />
                  <Field id="co-phone" label={t('checkout.phone')} type="tel" value={phone} onChange={setPhone} className={{ labelClasses, inputClasses }} />

                  <h2 className="pt-2 text-sm font-semibold">{t('checkout.address')}</h2>
                  {/* checkout.line1 / checkout.line2 / checkout.region ABSENTES des
                      clés FIGÉES Phase A — repli sur checkout.address / city / country
                      (signalé dans le rapport, AUCUNE clé inventée). */}
                  <Field id="co-line1" label={t('checkout.address')} value={line1} onChange={setLine1} className={{ labelClasses, inputClasses }} />
                  <Field id="co-line2" label={t('checkout.address')} value={line2} onChange={setLine2} className={{ labelClasses, inputClasses }} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="co-city" label={t('checkout.city')} value={city} onChange={setCity} className={{ labelClasses, inputClasses }} />
                    <Field id="co-postal" label={t('checkout.postal_code')} value={postalCode} onChange={setPostalCode} className={{ labelClasses, inputClasses }} />
                  </div>
                  <Field id="co-country" label={t('checkout.country')} value={country} onChange={setCountry} className={{ labelClasses, inputClasses }} />

                  <div className="flex justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep(STEP_CART)}
                      className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
                    >
                      {t('store.cart')}
                    </button>
                    <button
                      type="button"
                      onClick={goToShipping}
                      disabled={busy || !contactValid}
                      className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {busy ? t('checkout.processing') : t('checkout.shipping')}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Étape 3 : Livraison ────────────────────────────────── */}
              {step === STEP_SHIPPING && (
                <div className="space-y-4">
                  <h2 className="text-sm font-semibold">{t('checkout.shipping')}</h2>
                  {busy && !quote ? (
                    <Spinner />
                  ) : quote ? (
                    <div className="rounded-xl border border-[var(--border)] p-4 text-sm">
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-primary, #374151)' }}>
                          {quote.shipping_name || t('checkout.shipping')}
                        </span>
                        <span className="tabular-nums font-semibold">
                          {fmtMoney(quote.shipping_cents, currency)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--text-muted, #6b7280)' }}>
                      {t('checkout.shipping_fees')}
                    </p>
                  )}

                  <div className="flex justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep(STEP_CONTACT)}
                      className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
                    >
                      {t('checkout.contact')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(STEP_REVIEW)}
                      disabled={busy}
                      className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {t('checkout.summary')}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Étape 4 : Récap + code promo ───────────────────────── */}
              {step === STEP_REVIEW && (
                <div className="space-y-4">
                  <h2 className="text-sm font-semibold">{t('checkout.summary')}</h2>

                  <div>
                    <label className={labelClasses} htmlFor="co-coupon">
                      {t('checkout.coupon')}
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="co-coupon"
                        className={inputClasses}
                        value={coupon}
                        onChange={(e) => setCoupon(e.target.value)}
                      />
                      {/* Le code promo est appliqué côté backend au checkout
                          (resolveCouponDiscount — §6.C). On rafraîchit le devis
                          pour refléter sous-total/taxes ; le rabais réel apparaît
                          sur la commande finale (le front n'invente aucun montant). */}
                      <button
                        type="button"
                        onClick={fetchQuote}
                        disabled={busy}
                        className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
                      >
                        {t('checkout.coupon')}
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep(STEP_SHIPPING)}
                      className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
                    >
                      {t('checkout.shipping')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(STEP_PAYMENT)}
                      disabled={busy}
                      className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {t('checkout.pay')}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Étape 5 : Paiement MOCK (E4/E6 inactif — ZÉRO champ carte) ── */}
              {step === STEP_PAYMENT && (
                <div className="space-y-4">
                  <h2 className="text-sm font-semibold">{t('checkout.pay')}</h2>
                  {/* Mention claire « paiement de démonstration » — AUCUN vrai
                      formulaire carte (PCI/RGPD — §6.I-4/5). */}
                  <div
                    className="rounded-xl border p-4 text-sm"
                    style={{ background: 'var(--warning-bg, #fffbeb)', borderColor: 'var(--warning, #fde68a)', color: 'var(--warning-text, #92400e)' }}
                  >
                    {t('checkout.payment_mock')}
                  </div>

                  <div className="flex justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep(STEP_REVIEW)}
                      disabled={busy}
                      className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-60"
                    >
                      {t('checkout.summary')}
                    </button>
                    <button
                      type="button"
                      onClick={handlePay}
                      disabled={busy}
                      className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {busy ? t('checkout.processing') : t('checkout.pay')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Colonne latérale : récap monétaire persistant (sous-total + taxes
                + frais + total ; tax/shipping affichés dès que le devis existe). */}
            <aside>
              <OrderSummary
                subtotalCents={quote?.subtotal_cents ?? subtotalCents}
                taxCents={quote ? quote.tax_cents : null}
                shippingCents={quote ? quote.shipping_cents : null}
                shippingName={quote?.shipping_name}
                totalCents={quote ? quote.total_cents : null}
                currency={currency}
              />
            </aside>
          </div>
        )}

        <footer className="py-8 text-center" style={{ fontSize: 10, color: 'var(--text-muted, #6b7280)' }}>
          Propulsé par <strong>Intralys</strong>
        </footer>
      </main>
    </div>
  );
}

// ── Champ de formulaire sobre (réduction de boilerplate, styles locaux) ──────
function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  className: { labelClasses: string; inputClasses: string };
}) {
  return (
    <div>
      <label className={className.labelClasses} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className={className.inputClasses}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
