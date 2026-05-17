// ── Boutique — Tableau de bord (widgets réels) — Sprint E2 M3.3 / E3 M3 A4 ───
// Remplace les placeholders "—". KPI réels : produits actifs / brouillons /
// stock faible (endpoint M2) / valeur stock estimée (Σ qty × prix).
// Sections : Stock faible · Catalogue récent · Répartition par statut.
// Sprint E3 M3 : encart revenu réel (CA payé/livré, nb commandes, panier
// moyen) + commandes récentes (clic → OrderDetailPanel). Aucun faux chiffre :
// EmptyState honnête si zéro commande payée.
// <ModuleGuard module="ecommerce"> appliqué au niveau route par E1.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  PageHero, KpiStrip, Card, EmptyState, Tag, Skeleton, Icon, Button, type KpiItem,
} from '@/components/ui';
import {
  getEcommerceProducts, getLowStock, getEcommerceOrders, getEcommerceRegion,
  getEcommerceCustomers, recomputeRfm, getAbandonedCarts, recoverCart,
  getEcommerceRevenue, getEcommerceCohorts, getEcommerceLtv,
  getEcommerceTopProducts,
  type LowStockRow,
} from '@/lib/api';
import { useToast } from '@/components/ui';
import { t, getLocale } from '@/lib/i18n';
import { formatMoneyCents, formatNumber } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import { rfmSegmentLabelKey, rfmSegmentColor } from '@/lib/rfm';
import { RFM_SEGMENTS } from '@/lib/types';
import type {
  Product, Order, Customer, AbandonedCart, RfmSegment,
  EcommerceRevenue, EcommerceCohorts, EcommerceLtv, EcommerceTopProducts,
} from '@/lib/types';
import {
  OrderDetailPanel, orderStatusLabel, orderStatusVariant,
} from '@/components/ecommerce/OrderDetailPanel';
import {
  Store, Package, AlertTriangle, DollarSign, CheckCircle2, FileText, Clock,
  ShoppingCart, TrendingUp, BarChart3, RefreshCw, Send, Check,
  Layers, Trophy, Repeat,
} from 'lucide-react';

type ProductRow = Product & { variants_count?: number; primary_image?: string | null };

export function BoutiqueDashboardPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  // S6 M1.1 — erreur réseau : évite l'écran "catalogue vide" trompeur
  // quand le chargement KPI/produits échoue (state visuel pur).
  const [loadError, setLoadError] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Devise par défaut de la boutique (config région M2) — KPI agrégés.
  const [cur, setCur] = useState('CAD');
  // E7 M3.3/M3.4 — segments RFM + paniers abandonnés (additif, non bloquant)
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [carts, setCarts] = useState<AbandonedCart[]>([]);
  const [recomputing, setRecomputing] = useState(false);
  const [recovering, setRecovering] = useState<Record<string, boolean>>({});
  const [recoveredIds, setRecoveredIds] = useState<Set<string>>(new Set());
  // E9 — analytics e-comm (additif, dégrade en silence si M2 absent runtime)
  const [revenue, setRevenue] = useState<EcommerceRevenue | null>(null);
  const [cohorts, setCohorts] = useState<EcommerceCohorts | null>(null);
  const [ltv, setLtv] = useState<EcommerceLtv | null>(null);
  const [topProducts, setTopProducts] = useState<EcommerceTopProducts | null>(null);
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  // S6 M1.1 — chargement principal extrait pour permettre "Réessayer"
  // (iso-comportement : même séquence d'appels qu'au mount).
  const loadCore = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [prods, low, ords] = await Promise.all([
        getEcommerceProducts({ sort: 'created_desc', limit: 100 }).then((r) => r.data || []),
        getLowStock().then((r) => r.data || []).catch(() => []),
        getEcommerceOrders({ limit: 100 }).then((r) => r.data || []).catch(() => []),
      ]);
      setProducts(prods as ProductRow[]);
      setLowStock(low as LowStockRow[]);
      setOrders(ords as Order[]);
    } catch {
      /* silencieux : pas de donnée fictive — état d'erreur visuel honnête */
      setLoadError(true);
    }
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    void loadCore();
    // Devise contextuelle de la boutique (config région M2).
    getEcommerceRegion()
      .then((r) => { if (!cancelled && r.data?.currency) setCur(r.data.currency); })
      .catch(() => { /* fallback CAD */ });
    // E7 — segments RFM (clients) + paniers abandonnés. Indépendants,
    // dégradent en silence si M2 (carts abandoned) pas encore branché.
    getEcommerceCustomers()
      .then((r) => { if (!cancelled) setCustomers(r.data || []); })
      .catch(() => { /* silencieux */ });
    getAbandonedCarts()
      .then((r) => { if (!cancelled) setCarts(r.data || []); })
      .catch(() => { /* silencieux : section absente si indispo */ });
    // E9 — analytics e-comm. Indépendants, additifs, dégradent en
    // silence si M2 (ecommerce-analytics) pas encore branché runtime :
    // le widget reste simplement absent (aucun faux chiffre).
    getEcommerceRevenue()
      .then((r) => { if (!cancelled && r.data) setRevenue(r.data); })
      .catch(() => { /* silencieux */ });
    getEcommerceCohorts()
      .then((r) => { if (!cancelled && r.data) setCohorts(r.data); })
      .catch(() => { /* silencieux */ });
    getEcommerceLtv()
      .then((r) => { if (!cancelled && r.data) setLtv(r.data); })
      .catch(() => { /* silencieux */ });
    getEcommerceTopProducts()
      .then((r) => { if (!cancelled && r.data) setTopProducts(r.data); })
      .catch(() => { /* silencieux */ });
    return () => { cancelled = true; };
  }, []);

  // Répartition par segment RFM (clients segmentés uniquement, honnête).
  const rfmCounts = customers.reduce<Record<string, number>>((acc, c) => {
    if (c.rfm_segment) acc[c.rfm_segment] = (acc[c.rfm_segment] || 0) + 1;
    return acc;
  }, {});
  const rfmRows = (RFM_SEGMENTS as readonly RfmSegment[])
    .map((s) => ({ seg: s, n: rfmCounts[s] || 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const rfmMax = rfmRows.reduce((m, r) => Math.max(m, r.n), 0) || 1;
  const rfmTotal = rfmRows.reduce((s, r) => s + r.n, 0);

  async function handleRecompute() {
    if (recomputing) return;
    setRecomputing(true);
    try {
      const res = await recomputeRfm();
      if (res.data) {
        success(t('shop.rfm.recompute_ok').replace('{n}', String(res.data.updated)));
        const r = await getEcommerceCustomers();
        setCustomers(r.data || []);
      } else {
        toastError(t('shop.rfm.recompute_err'));
      }
    } catch {
      toastError(t('shop.rfm.recompute_err'));
    } finally {
      setRecomputing(false);
    }
  }

  async function handleRecover(cart: AbandonedCart) {
    if (recovering[cart.id] || recoveredIds.has(cart.id)) return;
    setRecovering((m) => ({ ...m, [cart.id]: true }));
    try {
      const res = await recoverCart(cart.id);
      if (res.data?.recovered) {
        setRecoveredIds((s) => new Set(s).add(cart.id));
        success(t('shop.cart.recover_ok'));
      } else {
        toastError(t('shop.cart.recover_err'));
      }
    } catch {
      toastError(t('shop.cart.recover_err'));
    } finally {
      setRecovering((m) => ({ ...m, [cart.id]: false }));
    }
  }

  // Panier déjà relancé : flag serveur (recovery_sent_at) OU action locale.
  const isRecovered = (c: AbandonedCart) =>
    recoveredIds.has(c.id) || !!c.recovery_sent_at;

  // Revenu réel : Σ total des commandes encaissées (payées/préparées/
  // expédiées/livrées) — aucun faux chiffre. AOV = CA / nb commandes.
  const paidOrders = orders.filter((o) =>
    ['paid', 'preparing', 'shipped', 'delivered'].includes(o.status));
  const revenueCents = paidOrders.reduce((s, o) => s + (o.total_cents || 0), 0);
  const ordersCount = paidOrders.length;
  const aovCents = ordersCount > 0 ? Math.round(revenueCents / ordersCount) : 0;
  const recentOrders = [...orders]
    .sort((a, b) => {
      const da = a.placed_at || a.created_at;
      const db = b.placed_at || b.created_at;
      return da < db ? 1 : -1;
    })
    .slice(0, 6);

  const active = products.filter((p) => p.status === 'active').length;
  const drafts = products.filter((p) => p.status === 'draft').length;
  const archived = products.filter((p) => p.status === 'archived').length;
  const total = products.length || 1;

  // Valeur stock estimée : Σ (quantité variante × prix effectif).
  const stockValueCents = products.reduce((sum, p) => {
    const vs = p.variants || [];
    if (vs.length === 0) return sum;
    return sum + vs.reduce((s, v) => {
      const qty = v.inventory?.quantity ?? 0;
      const price = v.price_override != null ? v.price_override : (p.base_price || 0);
      return s + qty * price;
    }, 0);
  }, 0);

  const kpis: KpiItem[] = [
    { label: t('shop.kpi.active_products'), value: loading ? '—' : formatNumber(active, getLocale()), color: 'success', icon: <CheckCircle2 size={11} /> },
    { label: t('shop.kpi.draft_products'), value: loading ? '—' : formatNumber(drafts, getLocale()), color: 'info', icon: <FileText size={11} /> },
    { label: t('shop.kpi.low_stock'), value: loading ? '—' : formatNumber(lowStock.length, getLocale()), color: lowStock.length > 0 ? 'accent' : 'brand', icon: <AlertTriangle size={11} /> },
    { label: t('shop.kpi.stock_value'), value: loading ? '—' : formatMoneyCents(stockValueCents, getLocale(), cur), color: 'brand', icon: <DollarSign size={11} /> },
  ];

  // Revenu : KPI honnêtes — "—" tant que chargement OU si aucune vente.
  const hasRevenue = !loading && ordersCount > 0;
  const revenueKpis: KpiItem[] = [
    { label: t('shop.revenue.kpi_revenue'), value: hasRevenue ? formatMoneyCents(revenueCents, getLocale(), cur) : '—', color: 'success', icon: <DollarSign size={11} /> },
    { label: t('shop.revenue.kpi_orders'), value: hasRevenue ? formatNumber(ordersCount, getLocale()) : '—', color: 'brand', icon: <ShoppingCart size={11} /> },
    { label: t('shop.revenue.kpi_aov'), value: hasRevenue ? formatMoneyCents(aovCents, getLocale(), cur) : '—', color: 'info', icon: <TrendingUp size={11} /> },
  ];

  const recent = products.slice(0, 6);

  // E9 — dérivés analytics. Revenu TOUJOURS ventilé par devise (jamais
  // sommé : aucun taux FX en base — règle d'or héritée E7). Cohortes en
  // barres CSS sobres (Stripe SUBTLE, pas de dépendance graphique).
  const revRows = revenue?.by_currency ?? [];
  const cohortRows = cohorts?.cohorts ?? [];
  const ltvRows = ltv?.by_currency ?? [];
  const topRows = topProducts?.products ?? [];
  const repurchase = ltv?.repurchase_rate;
  const topMaxRevenue = topRows.reduce((m, p) => Math.max(m, p.revenue_cents), 0) || 1;

  return (
    <AppLayout title={t('shop.dashboard')}>
      <PageHero
        meta={t('shop.nav')}
        title={t('shop.dashboard')}
        highlight={t('shop.nav')}
        description="Le centre de pilotage de ta boutique : catalogue, stock et alertes."
      />

      <KpiStrip items={kpis} className="!mb-6" />

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Skeleton className="h-56 w-full rounded-lg" />
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
      ) : loadError ? (
        <Card className="p-0 overflow-hidden">
          <EmptyState
            variant="compact"
            icon={<AlertTriangle size={32} strokeWidth={1.8} />}
            meta={t('shop.nav')}
            title="Impossible de charger le tableau de bord"
            description="Une erreur réseau est survenue. Vérifie ta connexion puis réessaie."
            action={
              <Button onClick={() => void loadCore()} leftIcon={<RefreshCw size={14} />}>
                Réessayer
              </Button>
            }
          />
        </Card>
      ) : products.length === 0 ? (
        <Card className="p-0 overflow-hidden">
          <EmptyState
            variant="first-time"
            icon={<Store size={32} strokeWidth={1.8} />}
            meta={t('shop.nav')}
            title={t('shop.empty.catalog_title')}
            description={t('shop.empty.catalog_desc')}
            action={
              <Button onClick={() => void navigate({ to: '/boutique/produits' })}>
                {t('shop.add_product_full')}
              </Button>
            }
            tips={[
              'Crée tes premiers produits dans l’onglet Produits.',
              'Le stock faible et la valeur d’inventaire se calculent automatiquement.',
              'Le revenu et le panier moyen apparaîtront ici dès tes premières ventes.',
            ]}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Stock faible */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon as={AlertTriangle} size="md"
                  className={lowStock.length > 0 ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'} />
                <h3 className="t-h3">{t('shop.section.low_stock')}</h3>
                {lowStock.length > 0 && (
                  <Tag size="sm" variant="warning" className="ml-auto">{lowStock.length}</Tag>
                )}
              </div>
              {lowStock.length === 0 ? (
                <p className="text-[13px] text-[var(--text-muted)] inline-flex items-center gap-1.5 py-6">
                  <Icon as={CheckCircle2} size="sm" className="text-[var(--success)]" />
                  {t('shop.no_low_stock')}
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                  {lowStock.slice(0, 8).map((r) => (
                    <Link key={r.variant_id}
                      to="/boutique/produits"
                      className="flex items-center gap-3 py-2.5 text-[13px] hover:bg-[var(--bg-subtle)] -mx-2 px-2 rounded transition-colors">
                      <span className="font-medium flex-1 min-w-0 truncate">
                        {r.product_title}
                        {r.variant_title && r.variant_title !== 'Default' && (
                          <span className="text-[var(--text-muted)]"> · {r.variant_title}</span>
                        )}
                      </span>
                      {r.sku && <span className="text-[11px] font-mono text-[var(--text-muted)]">{r.sku}</span>}
                      <Tag size="sm" variant="warning">
                        {r.available} / {r.low_stock_threshold}
                      </Tag>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            {/* Répartition par statut */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon as={Package} size="md" className="text-[var(--text-muted)]" />
                <h3 className="t-h3">{t('shop.section.by_status')}</h3>
              </div>
              <div className="flex flex-col gap-3">
                {([
                  ['active', t('shop.status_active'), active, 'var(--success)'],
                  ['draft', t('shop.status_draft'), drafts, 'var(--warning)'],
                  ['archived', t('shop.status_archived'), archived, 'var(--text-muted)'],
                ] as const).map(([k, label, n, color]) => (
                  <div key={k}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="text-[var(--text-secondary)]">{label}</span>
                      <span className="t-mono-num font-semibold">{formatNumber(n, getLocale())}</span>
                    </div>
                    <div className="shop-bar-track">
                      <div className="shop-bar-fill"
                        style={{ width: `${Math.round((n / total) * 100)}%`, background: color }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Revenu (Sprint E3 M3 A4) — chiffres honnêtes, jamais fictifs */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Icon as={DollarSign} size="md" className="text-[var(--text-muted)]" />
              <h3 className="t-h3">{t('shop.revenue.section')}</h3>
            </div>
            {ordersCount === 0 ? (
              <p className="text-[13px] text-[var(--text-muted)] inline-flex items-center gap-1.5 py-4">
                <Icon as={Clock} size="sm" /> {t('shop.revenue.empty')}
              </p>
            ) : (
              <KpiStrip items={revenueKpis} />
            )}
          </Card>

          {/* E9 — Revenu net ventilé par devise (JAMAIS sommé) */}
          {revRows.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon as={DollarSign} size="md" className="text-[var(--text-muted)]" />
                <h3 className="t-h3">{t('shop.analytics.revenue_title')}</h3>
              </div>
              <p className="text-[12px] text-[var(--text-muted)] mb-4">
                {t('shop.analytics.no_fx_note')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {revRows.map((r) => (
                  <div
                    key={r.currency}
                    className="rounded-lg border border-[var(--border-subtle)] p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
                        {r.currency}
                      </span>
                      <Tag size="sm" variant="neutral">
                        {formatNumber(r.orders, getLocale())} {t('shop.analytics.orders_unit')}
                      </Tag>
                    </div>
                    <p className="t-mono-num text-[20px] font-semibold">
                      {formatMoneyCents(r.net, getLocale(), r.currency)}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mt-2">
                      <span>
                        {t('shop.analytics.gross')} {formatMoneyCents(r.gross, getLocale(), r.currency)}
                      </span>
                      <span>
                        {t('shop.analytics.refunds')} −{formatMoneyCents(r.refunds, getLocale(), r.currency)}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">
                      {t('shop.analytics.aov')} {formatMoneyCents(r.aov, getLocale(), r.currency)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* E9 — LTV ventilée + taux de rachat */}
          {(ltvRows.length > 0 || repurchase != null) && (
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon as={Repeat} size="md" className="text-[var(--text-muted)]" />
                <h3 className="t-h3">{t('shop.analytics.ltv_title')}</h3>
                {repurchase != null && (
                  <Tag size="sm" variant="info" className="ml-auto">
                    {t('shop.analytics.repurchase')} {Math.round(repurchase * 100)}%
                  </Tag>
                )}
              </div>
              {ltvRows.length === 0 ? (
                <p className="text-[13px] text-[var(--text-muted)] inline-flex items-center gap-1.5 py-4">
                  <Icon as={Clock} size="sm" /> {t('shop.analytics.empty')}
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                  {ltvRows.map((l) => (
                    <div
                      key={l.currency}
                      className="flex items-center gap-3 py-2.5 text-[13px]"
                    >
                      <span className="font-medium">{l.currency}</span>
                      <span className="text-[var(--text-muted)] flex-1">
                        {formatNumber(l.customers, getLocale())} {t('shop.analytics.customers_unit')}
                      </span>
                      <span className="t-mono-num font-semibold">
                        {formatMoneyCents(l.ltv_cents, getLocale(), l.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* E9 — Cohortes d'acquisition (rétention en barres CSS sobres) */}
          {cohortRows.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon as={Layers} size="md" className="text-[var(--text-muted)]" />
                <h3 className="t-h3">{t('shop.analytics.cohorts_title')}</h3>
              </div>
              <div className="flex flex-col gap-3">
                {cohortRows.map((c) => (
                  <div key={c.month}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="text-[var(--text-secondary)]">
                        {c.month}
                        <span className="text-[var(--text-muted)] font-normal">
                          {' '}· {formatNumber(c.size, getLocale())} {t('shop.analytics.customers_unit')}
                        </span>
                      </span>
                    </div>
                    <div className="flex gap-1" role="img"
                      aria-label={`${t('shop.analytics.cohorts_title')} ${c.month}`}>
                      {c.retention.slice(0, 12).map((pct, i) => (
                        <div
                          key={i}
                          className="flex-1 rounded-sm"
                          title={`M+${i} · ${Math.round(pct)}%`}
                          style={{
                            height: 28,
                            background: `color-mix(in srgb, var(--primary) ${Math.max(8, Math.min(100, pct))}%, var(--bg-subtle))`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* E9 — Top produits (par devise, jamais sommé) */}
          {topRows.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon as={Trophy} size="md" className="text-[var(--text-muted)]" />
                <h3 className="t-h3">{t('shop.analytics.top_products_title')}</h3>
              </div>
              <div className="flex flex-col gap-3">
                {topRows.slice(0, 8).map((p) => (
                  <div key={p.variant_id}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="text-[var(--text-secondary)] min-w-0 truncate flex-1">
                        {p.title}
                        <span className="text-[var(--text-muted)] font-normal">
                          {' '}· {formatNumber(p.qty, getLocale())} {t('shop.analytics.units_sold')}
                        </span>
                      </span>
                      <span className="t-mono-num font-semibold whitespace-nowrap">
                        {formatMoneyCents(p.revenue_cents, getLocale(), p.currency)}
                      </span>
                    </div>
                    <div className="shop-bar-track">
                      <div
                        className="shop-bar-fill"
                        style={{
                          width: `${Math.round((p.revenue_cents / topMaxRevenue) * 100)}%`,
                          background: 'var(--primary)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Répartition segments RFM (E7 M3.3) — additif, honnête */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Icon as={BarChart3} size="md" className="text-[var(--text-muted)]" />
              <h3 className="t-h3">{t('shop.rfm.widget_title')}</h3>
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                disabled={recomputing}
                leftIcon={
                  <RefreshCw
                    size={14}
                    className={recomputing ? 'animate-spin motion-reduce:animate-none' : ''}
                  />
                }
                onClick={() => void handleRecompute()}
              >
                {recomputing ? t('shop.rfm.recomputing') : t('shop.rfm.recompute')}
              </Button>
            </div>
            {rfmRows.length === 0 ? (
              <p className="text-[13px] text-[var(--text-muted)] inline-flex items-center gap-1.5 py-4">
                <Icon as={Clock} size="sm" /> {t('shop.rfm.empty')}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {rfmRows.map(({ seg, n }) => (
                  <div key={seg}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="text-[var(--text-secondary)]">
                        {t(rfmSegmentLabelKey(seg))}
                      </span>
                      <span className="t-mono-num font-semibold">
                        {formatNumber(n, getLocale())}
                        <span className="text-[var(--text-muted)] font-normal">
                          {' '}· {Math.round((n / rfmTotal) * 100)}%
                        </span>
                      </span>
                    </div>
                    <div className="shop-bar-track">
                      <div
                        className="shop-bar-fill"
                        style={{
                          width: `${Math.round((n / rfmMax) * 100)}%`,
                          background: rfmSegmentColor(seg),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Paniers abandonnés (E7 M3.4) — relance anti-spam */}
          {carts.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon as={ShoppingCart} size="md" className="text-[var(--text-muted)]" />
                <h3 className="t-h3">{t('shop.cart.abandoned_title')}</h3>
                <Tag size="sm" variant="warning" className="ml-auto">{carts.length}</Tag>
              </div>
              <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                {carts.map((c) => {
                  const done = isRecovered(c);
                  const busy = !!recovering[c.id];
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 py-2.5 text-[13px]"
                    >
                      <span className="font-medium min-w-0 truncate flex-1">
                        {c.email || t('shop.cart.guest')}
                        <span className="text-[var(--text-muted)] font-normal">
                          {' '}· {t('shop.customer.active_cart_items').replace('{n}', String(c.items_count))}
                        </span>
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                        {t('shop.cart.abandoned_at')} {formatDate(c.updated_at, getLocale())}
                      </span>
                      <span className="t-mono-num font-semibold w-24 text-right">
                        {formatMoneyCents(c.subtotal_cents, getLocale(), c.currency || cur)}
                      </span>
                      {done ? (
                        <Tag size="sm" dot variant="success">
                          <Check size={11} className="inline mr-0.5" />
                          {t('shop.cart.recovered')}
                        </Tag>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          leftIcon={
                            <Send
                              size={13}
                              className={busy ? 'animate-pulse motion-reduce:animate-none' : ''}
                            />
                          }
                          onClick={() => void handleRecover(c)}
                        >
                          {busy ? t('shop.cart.recovering') : t('shop.cart.recover')}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Commandes récentes (clic → OrderDetailPanel) */}
          {orders.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon as={ShoppingCart} size="md" className="text-[var(--text-muted)]" />
                <h3 className="t-h3">{t('shop.order.recent')}</h3>
                <Link to="/boutique/commandes"
                  className="ml-auto text-[12px] font-semibold text-[var(--primary)] hover:underline">
                  {t('shop.order.view_all')} →
                </Link>
              </div>
              <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                {recentOrders.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setDetailId(o.id)}
                    className="flex items-center gap-3 py-2.5 text-[13px] text-left hover:bg-[var(--bg-subtle)] -mx-2 px-2 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                  >
                    <span className="font-medium min-w-0 truncate">
                      {o.order_number || `#${o.id.slice(0, 8)}`}
                    </span>
                    <span className="text-[var(--text-muted)] min-w-0 truncate flex-1">
                      {o.customer_email || o.email || '—'}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                      {o.placed_at || o.created_at ? formatDate(o.placed_at || o.created_at, getLocale()) : ''}
                    </span>
                    <Tag dot size="sm" variant={orderStatusVariant(o.status)}>
                      {orderStatusLabel(o.status)}
                    </Tag>
                    <span className="t-mono-num font-semibold w-24 text-right">
                      {formatMoneyCents(o.total_cents || 0, getLocale(), o.currency || cur)}
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Catalogue récent */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Icon as={Store} size="md" className="text-[var(--text-muted)]" />
              <h3 className="t-h3">{t('shop.section.recent_catalog')}</h3>
              <Link to="/boutique/produits"
                className="ml-auto text-[12px] font-semibold text-[var(--primary)] hover:underline">
                Voir tout →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recent.map((p) => (
                <Link key={p.id} to="/boutique/produits"
                  className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--primary)] transition-colors">
                  <div className="h-10 w-10 rounded-md overflow-hidden bg-[var(--bg-subtle)] border border-[var(--border-subtle)] shrink-0 flex items-center justify-center">
                    {p.primary_image
                      ? <img src={p.primary_image} alt="" className="w-full h-full object-cover" loading="lazy" />
                      : <Icon as={Package} size="sm" className="text-[var(--text-muted)]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate">{p.title}</p>
                    <p className="text-[11px] text-[var(--text-muted)] t-mono-num">
                      {p.base_price != null ? formatMoneyCents(p.base_price, getLocale(), p.currency || cur) : '—'}
                    </p>
                  </div>
                  <Tag size="sm" variant={
                    p.status === 'active' ? 'success' : p.status === 'archived' ? 'neutral' : 'warning'
                  }>
                    {p.status === 'active' ? t('shop.status_active')
                      : p.status === 'archived' ? t('shop.status_archived')
                      : t('shop.status_draft')}
                  </Tag>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}

      <OrderDetailPanel
        orderId={detailId}
        open={Boolean(detailId)}
        onOpenChange={(o) => { if (!o) setDetailId(null); }}
      />
    </AppLayout>
  );
}
