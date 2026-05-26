// ── PublicStore — vitrine publique par slug (LOT STOREFRONT CHECKOUT, Sprint 7) ─
//
// Corps réel Phase C Manager-C. L'export nommé `PublicStorePage` est FIGÉ
// (App.tsx GELÉ le lazy-importe — route publique `/store/$slug`, hors auth/
// LazyGuard). NEUF — owned EXCLUSIF Manager-C.
//
// Calque EXACT le pattern PublicBooking.tsx / PublicFunnel.tsx : page publique
// standalone (PAS d'AppLayout/sidebar admin), fetch brut via helpers FIGÉS
// Phase A (getStoreProducts / getStoreProduct / addStoreCartItem / getStoreCart),
// spinner pendant les appels, discrimination erreur = absence `data` / champ
// `error` (§6.A — JAMAIS de `code`). i18n 100% t('store.*') (clés FIGÉES
// Phase A — AUCUNE création Phase C). Le front n'invente JAMAIS prix/stock —
// tout vient du backend (cents, §6.B).
//
// Panier PERSISTANT : un cart_token est généré/stocké en localStorage
// (`intralys_store_cart_<slug>`) et passé EXPLICITEMENT à tous les appels cart
// (le worker le crée si null — §6.C). Mini-panier (nombre d'articles) + lien
// vers `/store/$slug/checkout`.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  getStoreProducts,
  getStoreProduct,
  getStoreCart,
  addStoreCartItem,
} from '@/lib/api';
import type { StorefrontProduct, StoreSettings, PublicCart } from '@/lib/types';
import { t } from '@/lib/i18n';
import { ProductCard, fmtMoney } from '@/components/storefront';

// ── Token panier persistant (localStorage, par slug — §6.F) ──────────────────
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
function writeCartToken(slug: string, token: string): void {
  try {
    window.localStorage.setItem(cartStorageKey(slug), token);
  } catch {
    /* localStorage indisponible (mode privé) — le token reste en mémoire via state. */
  }
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div
        style={{
          width: 28,
          height: 28,
          border: '3px solid rgba(0,157,219,0.2)',
          borderTopColor: '#009DDB',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
    </div>
  );
}

export function PublicStorePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };

  // Fiche produit ouverte via ?p=<pslug> (deep-link partageable, sans router
  // supplémentaire — la route /store/$slug reste figée par A).
  const initialPslug = useMemo(() => {
    try {
      return typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('p') || ''
        : '';
    } catch {
      return '';
    }
  }, []);

  const [store, setStore] = useState<StoreSettings | null>(null);
  const [products, setProducts] = useState<StorefrontProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Fiche produit (détail)
  const [activePslug, setActivePslug] = useState<string>(initialPslug);
  const [detail, setDetail] = useState<StorefrontProduct | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<string>('');

  // Panier
  const [cartToken, setCartToken] = useState<string | null>(() => readCartToken(slug));
  const [cart, setCart] = useState<PublicCart | null>(null);
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState('');

  const currency = store?.currency || cart?.currency;
  const cartCount = (cart?.items || []).reduce((n, it) => n + it.qty, 0);

  // ── Chargement vitrine (calque PublicBooking : fetch helper public, erreur =
  //    res.error/!res.data §6.A). Absence de data ⇒ boutique introuvable. ──────
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    setLoadError('');
    getStoreProducts(slug)
      .then((res) => {
        if (!alive) return;
        if (res.error || !res.data) {
          setLoadError(res.error || t('store.not_found'));
          return;
        }
        setStore(res.data.store);
        setProducts(res.data.products || []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  // ── Hydratation du panier persistant (token localStorage → getStoreCart). ───
  useEffect(() => {
    if (!slug || !cartToken) return;
    let alive = true;
    getStoreCart(slug, cartToken).then((res) => {
      if (!alive) return;
      if (res.error || !res.data) return; // best-effort : panier inconnu ⇒ on ignore
      setCart(res.data);
      if (res.data.token && res.data.token !== cartToken) {
        setCartToken(res.data.token);
        writeCartToken(slug, res.data.token);
      }
    });
    return () => {
      alive = false;
    };
  }, [slug, cartToken]);

  // ── Chargement fiche produit (variantes pour l'ajout par variant_id §6.C). ──
  const openProduct = useCallback(
    (pslug: string) => {
      setActivePslug(pslug);
      setDetail(null);
      setSelectedVariant('');
      setActionError('');
      setDetailLoading(true);
      getStoreProduct(slug, pslug)
        .then((res) => {
          if (res.error || !res.data) {
            setActionError(res.error || t('store.not_found'));
            return;
          }
          setDetail(res.data);
          const firstInStock = (res.data.variants || []).find((v) => v.in_stock);
          if (firstInStock) setSelectedVariant(firstInStock.variant_id);
        })
        .finally(() => setDetailLoading(false));
    },
    [slug],
  );

  // Deep-link initial ?p=
  useEffect(() => {
    if (initialPslug) openProduct(initialPslug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPslug]);

  const closeProduct = useCallback(() => {
    setActivePslug('');
    setDetail(null);
  }, []);

  // ── Ajout au panier (helper FIGÉ addStoreCartItem). Le worker crée le token
  //    si null ⇒ on persiste celui renvoyé. variant_id si la fiche en propose. ─
  const handleAdd = useCallback(
    async (product: StorefrontProduct, variantId?: string) => {
      if (adding) return;
      setAdding(true);
      setActionError('');
      const res = await addStoreCartItem(slug, cartToken, {
        product_id: product.id,
        variant_id: variantId || undefined,
        qty: 1,
      });
      setAdding(false);
      if (res.error || !res.data) {
        setActionError(res.error || t('api.unavailable'));
        return;
      }
      setCart(res.data);
      if (res.data.token) {
        setCartToken(res.data.token);
        writeCartToken(slug, res.data.token);
      }
    },
    [adding, slug, cartToken],
  );

  // ── Boutique introuvable / indisponible (calque écran d'erreur public). ─────
  if (!loading && (loadError || !store)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center bg-white">
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            {t('store.not_found')}
          </h1>
          {loadError && <p style={{ color: '#6b7280' }}>{loadError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* En-tête sobre + mini-panier */}
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={closeProduct}
            className="text-left text-base font-semibold text-[var(--text-primary)]"
          >
            {store?.name || t('store.title')}
          </button>
          <Link
            to={`/store/${slug}/checkout`}
            className="relative inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
          >
            {t('store.cart')}
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold text-white tabular-nums"
              style={{ background: 'var(--primary)' }}
            >
              {cartCount}
            </span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6" data-store-slug={slug}>
        {loading ? (
          <Spinner />
        ) : detailLoading ? (
          <Spinner />
        ) : detail || activePslug ? (
          // ── Fiche produit ───────────────────────────────────────────────
          <ProductDetail
            product={detail}
            currency={currency}
            adding={adding}
            error={actionError}
            selectedVariant={selectedVariant}
            onSelectVariant={setSelectedVariant}
            onBack={closeProduct}
            onAdd={() => detail && handleAdd(detail, selectedVariant || undefined)}
          />
        ) : products.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: '#6b7280' }}>
            {t('store.empty')}
          </p>
        ) : (
          // ── Grille produits ─────────────────────────────────────────────
          <>
            {actionError && (
              <p className="mb-4 text-sm" style={{ color: '#dc2626' }}>
                {actionError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  currency={currency}
                  onView={() => openProduct(p.slug)}
                  onAdd={() => handleAdd(p)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="py-6 text-center" style={{ fontSize: 10, color: '#6b7280' }}>
        Propulsé par <strong>Intralys</strong>
      </footer>
    </div>
  );
}

// ── Fiche produit (détail + sélecteur de variante) ───────────────────────────
function ProductDetail({
  product,
  currency,
  adding,
  error,
  selectedVariant,
  onSelectVariant,
  onBack,
  onAdd,
}: {
  product: StorefrontProduct | null;
  currency?: string | null;
  adding: boolean;
  error: string;
  selectedVariant: string;
  onSelectVariant: (v: string) => void;
  onBack: () => void;
  onAdd: () => void;
}) {
  if (!product) {
    return (
      <div className="py-6">
        <button type="button" onClick={onBack} className="text-sm" style={{ color: 'var(--primary)' }}>
          ← {t('store.continue_shopping')}
        </button>
        {error && (
          <p className="mt-4 text-sm" style={{ color: '#dc2626' }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  const variants = product.variants || [];
  const cur = product.currency || currency;
  // Prix affiché : celui de la variante sélectionnée si dispo (jamais inventé).
  const selVar = variants.find((v) => v.variant_id === selectedVariant);
  const priceCents = selVar ? selVar.price_cents : product.price_cents;
  // Achetable si en stock (variante sélectionnée requise dès qu'il y a des variantes).
  const purchasable = product.in_stock && (variants.length === 0 || !!selVar?.in_stock);

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 text-sm"
        style={{ color: 'var(--primary)' }}
      >
        ← {t('store.continue_shopping')}
      </button>

      <div className="grid gap-6 md:grid-cols-2">
        <div
          className="overflow-hidden rounded-xl border border-[var(--border)]"
          style={{ aspectRatio: '4 / 3', background: '#f6f8fa' }}
        >
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : null}
        </div>

        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{product.name}</h1>
          <p className="mt-1 text-lg font-semibold">{fmtMoney(priceCents, cur)}</p>
          {product.description && (
            <p className="mt-3 text-sm" style={{ color: '#6b7280', whiteSpace: 'pre-wrap' }}>
              {product.description}
            </p>
          )}

          {variants.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {variants.map((v) => {
                const active = v.variant_id === selectedVariant;
                return (
                  <button
                    key={v.variant_id}
                    type="button"
                    disabled={!v.in_stock}
                    onClick={() => onSelectVariant(v.variant_id)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40 ${
                      active
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                        : 'border-[var(--border)] hover:border-[var(--primary)]'
                    }`}
                  >
                    {v.title || product.name}
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm" style={{ color: '#dc2626' }}>
              {error}
            </p>
          )}

          <div className="mt-5">
            {purchasable ? (
              <button
                type="button"
                onClick={onAdd}
                disabled={adding}
                className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {t('store.add_to_cart')}
              </button>
            ) : (
              <span className="text-sm" style={{ color: '#9ca3af' }}>
                {t('store.out_of_stock')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
