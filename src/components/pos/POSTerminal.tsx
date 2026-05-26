// ── POSTerminal — Sprint 37 (Agent B1) ───────────────────────────────────────
// Caisse retail principale (terminal de point de vente).
//
// Layout 3 colonnes desktop :
//  ─ Gauche : recherche + scan barcode (USB keyboard wedge capture) + grille
//             produits cliquables (catalogue Boutique).
//  ─ Centre : panier courant (lignes éditables qty / remove, total live).
//  ─ Droite : panel paiement (cash / card_terminal / split) + tendered +
//             change calculé clientside + bouton "Finaliser".
//
// API back FIGÉE (Phase A — Sprint 37) :
//   listPosRegisters()                                  → PosRegister[]
//   getPosSession(id)                                   → PosSession
//   openPosSession({ register_id, opening_cash_cents }) → PosSession (via B2)
//   scanBarcode(barcode)                                → ScanResult
//   createPosTransaction(input)                         → PosTransaction
//
// Le session manager (B2) est lazy-imported pour éviter le cycle d'imports
// (B2 peut lui-même importer POSTerminal). Si pas encore livré, on rend un
// fallback CTA neutre qui appelle directement openPosSession (mock minimal).
//
// Style : Stripe-clean, flat surfaces, focus ring purple. Aucun console.log
// (CLAUDE.md). aria-labels i18n sur chaque action. Tous les libellés via t().

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  Plus,
  Minus,
  Trash2,
  Search,
  ScanLine,
  CreditCard,
  Banknote,
  Split,
  Check,
  X,
  ShoppingCart,
  PlayCircle,
  StopCircle,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { t, getLocale } from '../../lib/i18n';
import { formatMoneyCents } from '../../lib/i18n/number';
import { formatDateTime } from '../../lib/i18n/datetime';
import {
  listPosRegisters,
  getPosSession,
  openPosSession,
  scanBarcode,
  createPosTransaction,
  getEcommerceProducts,
  type PosRegister,
  type PosSession,
  type PosPaymentMethod,
  type ScanResult,
  type ReceiptPayload,
  type ReceiptItem,
  type CreatePosTransactionInput,
} from '../../lib/api';
import type { Product } from '../../lib/types';

// Lazy : POSReceiptPreview (B3) — modal reçu post-vente.
const POSReceiptPreview = lazy(() =>
  import('./POSReceiptPreview').then((m) => ({ default: m.POSReceiptPreview })),
);

// ── Types locaux ────────────────────────────────────────────────────────────

interface CartLine {
  /** id local pour clé React (uuid pseudo timestamp + index) */
  key: string;
  variant_id: string;
  product_id: string;
  title: string;
  variant_title?: string;
  sku?: string;
  unit_price_cents: number;
  quantity: number;
}

interface CatalogEntry {
  variant_id: string;
  product_id: string;
  title: string;
  variant_title?: string;
  sku?: string;
  unit_price_cents: number;
}

// ── Persistence légère session ──────────────────────────────────────────────
// L'id de session active est conservé dans localStorage pour survivre à un
// reload de la caisse (cashier qui rafraîchit la page sans vouloir perdre son
// shift en cours). Aucune donnée sensible — juste l'id (le back tranche).
const SESSION_KEY = 'pos.active_session_id';

function readActiveSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(SESSION_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeActiveSessionId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(SESSION_KEY, id);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function newKey(): string {
  return `line_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function cartTotalCents(cart: CartLine[]): number {
  let total = 0;
  for (const line of cart) {
    total += line.unit_price_cents * line.quantity;
  }
  return total;
}

/**
 * Convertit le catalogue Product[] en CatalogEntry[] (1 entry par variant).
 * Les produits sans variantes sont skipés (POS retail attend SKU/barcode).
 */
function flattenCatalog(products: Product[]): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const p of products) {
    const variants = p.variants ?? [];
    if (variants.length === 0) continue;
    for (const v of variants) {
      const unit =
        typeof v.price_override === 'number' && v.price_override > 0
          ? v.price_override
          : p.base_price;
      entries.push({
        variant_id: v.id,
        product_id: p.id,
        title: p.title,
        variant_title: v.title || undefined,
        sku: v.sku || undefined,
        unit_price_cents: unit,
      });
    }
  }
  return entries;
}

function scanResultToEntry(scan: ScanResult): CatalogEntry {
  return {
    variant_id: scan.variant.id,
    product_id: scan.product.id,
    title: scan.product.title,
    variant_title: scan.variant.title || undefined,
    sku: scan.variant.sku || undefined,
    unit_price_cents: scan.unit_price_cents,
  };
}

function makeReceiptPayload(input: {
  registerName: string;
  cashierName: string;
  cart: CartLine[];
  method: PosPaymentMethod;
  totalCents: number;
  tenderedCents?: number;
  changeCents?: number;
  txId: string;
  orderNumber: string;
  tenantName: string;
}): ReceiptPayload {
  const items: ReceiptItem[] = input.cart.map((l) => ({
    title: l.title,
    variant_title: l.variant_title,
    sku: l.sku,
    quantity: l.quantity,
    unit_price_cents: l.unit_price_cents,
    line_total_cents: l.unit_price_cents * l.quantity,
  }));
  return {
    tenantName: input.tenantName,
    transactionId: input.txId,
    orderNumber: input.orderNumber,
    placedAt: new Date().toISOString(),
    items,
    subtotalCents: input.totalCents,
    taxLines: [],
    totalCents: input.totalCents,
    paymentMethod: input.method,
    tenderedCents: input.tenderedCents,
    changeCents: input.changeCents,
    cashierName: input.cashierName,
    registerName: input.registerName,
  };
}

// ── Composant ───────────────────────────────────────────────────────────────

export function POSTerminal() {
  const { success, error: toastError, info } = useToast();
  const locale = useMemo(() => getLocale(), []);

  // ── Registers + Session ───────────────────────────────────────────────────
  const [registers, setRegisters] = useState<PosRegister[]>([]);
  const [session, setSession] = useState<PosSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const [openingRegisterId, setOpeningRegisterId] = useState<string>('');
  const [openingCash, setOpeningCash] = useState<string>('0');
  const [openingSubmitting, setOpeningSubmitting] = useState<boolean>(false);

  // ── Catalogue ─────────────────────────────────────────────────────────────
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // ── Scan barcode (USB keyboard wedge) ─────────────────────────────────────
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [scanInput, setScanInput] = useState<string>('');
  const [scanBusy, setScanBusy] = useState<boolean>(false);

  // ── Cart ──────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([]);

  // ── Payment ───────────────────────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('cash');
  const [tenderedInput, setTenderedInput] = useState<string>('');
  const [finalizing, setFinalizing] = useState<boolean>(false);

  // ── Receipt modal (B3) ────────────────────────────────────────────────────
  const [receiptPayload, setReceiptPayload] = useState<ReceiptPayload | null>(
    null,
  );
  const [receiptOpen, setReceiptOpen] = useState<boolean>(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalCents = useMemo(() => cartTotalCents(cart), [cart]);

  const tenderedCents = useMemo(() => {
    if (paymentMethod !== 'cash') return 0;
    const v = Number(tenderedInput.replace(',', '.'));
    if (!Number.isFinite(v) || v < 0) return 0;
    return Math.round(v * 100);
  }, [paymentMethod, tenderedInput]);

  const changeCents = useMemo(() => {
    if (paymentMethod !== 'cash') return 0;
    if (tenderedCents < totalCents) return 0;
    return tenderedCents - totalCents;
  }, [paymentMethod, tenderedCents, totalCents]);

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((e) => {
      const hay =
        `${e.title} ${e.variant_title ?? ''} ${e.sku ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [catalog, searchQuery]);

  const activeRegister = useMemo<PosRegister | null>(() => {
    if (!session) return null;
    return registers.find((r) => r.id === session.register_id) ?? null;
  }, [registers, session]);

  // ── Boot : registers + active session (si id en localStorage) ─────────────
  const bootstrap = useCallback(async () => {
    setSessionLoading(true);
    const [regsRes, activeId] = [await listPosRegisters(), readActiveSessionId()];
    if (regsRes.error) {
      toastError(regsRes.error);
      setRegisters([]);
    } else if (regsRes.data) {
      setRegisters(regsRes.data);
      // Pré-sélection du 1er register actif pour l'ouverture de session.
      const firstActive = regsRes.data.find((r) => r.is_active === 1);
      if (firstActive) setOpeningRegisterId(firstActive.id);
    }
    if (activeId) {
      const sRes = await getPosSession(activeId);
      if (sRes.data && sRes.data.status === 'open') {
        setSession(sRes.data);
      } else {
        // Session fermée ou introuvable côté back → purge la clé locale.
        writeActiveSessionId(null);
        setSession(null);
      }
    }
    setSessionLoading(false);
  }, [toastError]);

  // ── Catalogue : chargement quand session active ───────────────────────────
  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    const res = await getEcommerceProducts({ status: 'active', limit: 200 });
    if (res.error) {
      toastError(res.error);
      setCatalog([]);
    } else {
      setCatalog(flattenCatalog((res.data as Product[]) ?? []));
    }
    setCatalogLoading(false);
  }, [toastError]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (session) void loadCatalog();
  }, [session, loadCatalog]);

  // Focus le scan input dès que la session est ouverte (UX cashier).
  useEffect(() => {
    if (session && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [session]);

  // ── Cart ops ──────────────────────────────────────────────────────────────

  const addToCart = useCallback((entry: CatalogEntry) => {
    setCart((prev) => {
      // Si même variant déjà présent → incrémente qty.
      const idx = prev.findIndex((l) => l.variant_id === entry.variant_id);
      if (idx >= 0) {
        const next = [...prev];
        const existing = next[idx];
        if (existing) {
          next[idx] = { ...existing, quantity: existing.quantity + 1 };
        }
        return next;
      }
      return [
        ...prev,
        {
          key: newKey(),
          variant_id: entry.variant_id,
          product_id: entry.product_id,
          title: entry.title,
          variant_title: entry.variant_title,
          sku: entry.sku,
          unit_price_cents: entry.unit_price_cents,
          quantity: 1,
        },
      ];
    });
  }, []);

  const incLine = useCallback((key: string) => {
    setCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l)),
    );
  }, []);

  const decLine = useCallback((key: string) => {
    setCart((prev) =>
      prev
        .map((l) =>
          l.key === key ? { ...l, quantity: Math.max(0, l.quantity - 1) } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const removeLine = useCallback((key: string) => {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setTenderedInput('');
    setPaymentMethod('cash');
  }, []);

  // ── Scan barcode ──────────────────────────────────────────────────────────

  const runScan = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      setScanBusy(true);
      const res = await scanBarcode(code);
      setScanBusy(false);
      if (res.error || !res.data) {
        toastError(res.error || t('pos.error.barcode_not_found'));
        return;
      }
      if (!res.data.in_stock) {
        toastError(t('pos.error.insufficient_stock'));
        return;
      }
      addToCart(scanResultToEntry(res.data));
      // Vide le champ pour la prochaine lecture.
      setScanInput('');
      // Re-focus pour le scan suivant.
      if (scanInputRef.current) scanInputRef.current.focus();
    },
    [toastError, addToCart],
  );

  const handleScanKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void runScan(scanInput);
      }
    },
    [runScan, scanInput],
  );

  const handleScanChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setScanInput(e.target.value);
  }, []);

  // ── Session : open / close ────────────────────────────────────────────────

  const handleOpenSession = useCallback(async () => {
    if (!openingRegisterId) {
      toastError(t('pos.register_select'));
      return;
    }
    const cashFloat = Number(openingCash.replace(',', '.'));
    const cashCents = Number.isFinite(cashFloat) && cashFloat > 0
      ? Math.round(cashFloat * 100)
      : 0;
    setOpeningSubmitting(true);
    const res = await openPosSession({
      register_id: openingRegisterId,
      opening_cash_cents: cashCents,
    });
    setOpeningSubmitting(false);
    if (res.error || !res.data) {
      toastError(res.error || t('pos.error.session_not_open'));
      return;
    }
    writeActiveSessionId(res.data.id);
    setSession(res.data);
    success(t('pos.session_open'));
  }, [openingRegisterId, openingCash, toastError, success]);

  const handleCloseSession = useCallback(() => {
    // La fermeture détaillée (closing cash + variance) est gérée par B2.
    // Ici on émet juste un signal et on purge l'état local — le shift sera
    // formellement clôturé depuis le SessionManager si déjà ouvert.
    writeActiveSessionId(null);
    setSession(null);
    setCart([]);
    info(t('pos.session_closed'));
  }, [info]);

  // ── Finalize ──────────────────────────────────────────────────────────────

  const canFinalize = useMemo(() => {
    if (!session) return false;
    if (cart.length === 0) return false;
    if (paymentMethod === 'cash' && tenderedCents < totalCents) return false;
    return true;
  }, [session, cart.length, paymentMethod, tenderedCents, totalCents]);

  const handleFinalize = useCallback(async () => {
    if (!session) {
      toastError(t('pos.error.session_not_open'));
      return;
    }
    if (cart.length === 0) {
      toastError(t('pos.cart_empty'));
      return;
    }
    setFinalizing(true);
    const input: CreatePosTransactionInput = {
      session_id: session.id,
      cart: cart.map((l) => ({
        variant_id: l.variant_id,
        quantity: l.quantity,
      })),
      payment: {
        method: paymentMethod,
        amount_cents: totalCents,
        ...(paymentMethod === 'cash' ? { tendered_cents: tenderedCents } : {}),
      },
    };
    const res = await createPosTransaction(input);
    setFinalizing(false);
    if (res.error || !res.data) {
      toastError(res.error || t('pos.error.payment_failed'));
      return;
    }
    // Construit le payload reçu pour POSReceiptPreview.
    const payload = makeReceiptPayload({
      registerName: activeRegister?.name ?? '—',
      cashierName: '—',
      cart,
      method: paymentMethod,
      totalCents,
      tenderedCents: paymentMethod === 'cash' ? tenderedCents : undefined,
      changeCents: paymentMethod === 'cash' ? changeCents : undefined,
      txId: res.data.id,
      orderNumber: res.data.order_id ?? res.data.id,
      tenantName: activeRegister?.name ?? '',
    });
    setReceiptPayload(payload);
    setReceiptOpen(true);
    clearCart();
  }, [
    session,
    cart,
    paymentMethod,
    tenderedCents,
    totalCents,
    changeCents,
    activeRegister,
    toastError,
    clearCart,
  ]);

  const handleChargeTerminal = useCallback(() => {
    // Stripe Terminal réel pas branché en B1 — mock toast informatif.
    info(t('pos.payment_card'));
  }, [info]);

  // ── Renders : pré-session ─────────────────────────────────────────────────

  if (sessionLoading) {
    return (
      <div
        className="space-y-4"
        data-testid="pos-loading"
        aria-busy="true"
        aria-label={t('pos.title')}
      >
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Skeleton className="h-96 lg:col-span-5" />
          <Skeleton className="h-96 lg:col-span-4" />
          <Skeleton className="h-96 lg:col-span-3" />
        </div>
      </div>
    );
  }

  if (!session) {
    const activeRegisters = registers.filter((r) => r.is_active === 1);
    return (
      <div data-testid="pos-no-session" className="max-w-xl mx-auto">
        <EmptyState
          icon={<Icon as={PlayCircle} size={40} />}
          title={t('pos.open_session')}
          description={t('pos.error.session_not_open')}
          action={
            <div className="flex flex-col gap-3 w-full max-w-sm mx-auto">
              <Select
                aria-label={t('pos.register_select')}
                label={t('pos.register_select')}
                value={openingRegisterId}
                onChange={(e) => setOpeningRegisterId(e.target.value)}
                disabled={activeRegisters.length === 0}
                data-testid="pos-register-select"
              >
                {activeRegisters.length === 0 ? (
                  <option value="">—</option>
                ) : (
                  activeRegisters.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.location ? ` — ${r.location}` : ''}
                    </option>
                  ))
                )}
              </Select>
              <Input
                type="number"
                step="0.01"
                min="0"
                aria-label={t('pos.opening_cash')}
                label={t('pos.opening_cash')}
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                data-testid="pos-opening-cash"
              />
              <Button
                onClick={() => void handleOpenSession()}
                isLoading={openingSubmitting}
                disabled={openingSubmitting || activeRegisters.length === 0}
                leftIcon={<Icon as={PlayCircle} size="sm" />}
                aria-label={t('pos.open_session')}
                data-testid="pos-open-session-btn"
              >
                {t('pos.open_session')}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  // ── Renders : session active (3 colonnes) ─────────────────────────────────

  return (
    <div
      className="space-y-4"
      data-testid="pos-terminal"
      aria-label={t('pos.title')}
    >
      {/* Header session active */}
      <header
        className="flex items-start justify-between gap-4 flex-wrap p-4 rounded-xl border border-[var(--border-subtle)] bg-white"
        data-testid="pos-session-header"
      >
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
              data-testid="pos-session-status"
            >
              <Icon as={Check} size={12} />
              {t('pos.session_open')}
            </span>
            <h3 className="font-semibold text-[var(--text-primary)]">
              {activeRegister?.name ?? '—'}
            </h3>
          </div>
          <div className="text-xs text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1">
            {session.opened_at ? (
              <span>{formatDateTime(session.opened_at, locale)}</span>
            ) : null}
            <span aria-hidden="true">•</span>
            <span data-testid="pos-session-sales">
              {t('pos.total_sales')}{' '}
              {formatMoneyCents(
                session.total_sales_cents,
                locale,
                activeRegister?.currency ?? 'CAD',
              )}
            </span>
            <span aria-hidden="true">•</span>
            <span>
              {t('pos.tx_count')} {session.transaction_count}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Icon as={StopCircle} size="sm" />}
          onClick={handleCloseSession}
          aria-label={t('pos.close_session')}
          data-testid="pos-close-session-btn"
        >
          {t('pos.close_session')}
        </Button>
      </header>

      {/* Grille 3 colonnes desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ── Colonne Gauche : recherche + scan + grille produits ──────────── */}
        <section
          className="lg:col-span-5 p-4 rounded-xl border border-[var(--border-subtle)] bg-white space-y-3"
          aria-label={t('pos.scan_barcode')}
          data-testid="pos-catalog-panel"
        >
          <div className="flex flex-col gap-2">
            <Input
              ref={scanInputRef}
              aria-label={t('pos.scan_barcode')}
              placeholder={t('pos.scan_barcode')}
              leftIcon={<Icon as={ScanLine} size="sm" />}
              value={scanInput}
              onChange={handleScanChange}
              onKeyDown={handleScanKeyDown}
              disabled={scanBusy}
              data-testid="pos-scan-input"
            />
            <Input
              aria-label={t('pos.scan_manual')}
              placeholder={t('pos.scan_manual')}
              leftIcon={<Icon as={Search} size="sm" />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="pos-search-input"
            />
          </div>

          {catalogLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="pos-catalog-loading">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : filteredCatalog.length === 0 ? (
            <EmptyState
              icon={<Icon as={ShoppingCart} size={32} />}
              title={t('pos.cart_empty')}
              description={t('pos.scan_barcode')}
            />
          ) : (
            <ul
              className="grid grid-cols-2 sm:grid-cols-3 gap-2 list-none p-0 m-0"
              data-testid="pos-catalog-grid"
              aria-label={t('pos.title')}
            >
              {filteredCatalog.slice(0, 60).map((entry) => (
                <li key={entry.variant_id}>
                  <button
                    type="button"
                    onClick={() => addToCart(entry)}
                    className="w-full h-20 p-2 rounded-lg border border-[var(--border-subtle)] bg-white hover:border-[var(--primary)] hover:shadow-sm transition text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    aria-label={`${entry.title}${entry.variant_title ? ` — ${entry.variant_title}` : ''}`}
                    data-testid={`pos-product-${entry.variant_id}`}
                  >
                    <div className="text-xs font-medium text-[var(--text-primary)] line-clamp-2">
                      {entry.title}
                    </div>
                    {entry.variant_title ? (
                      <div className="text-[10px] text-[var(--text-muted)] truncate">
                        {entry.variant_title}
                      </div>
                    ) : null}
                    <div className="text-xs font-semibold text-[var(--primary)] mt-1">
                      {formatMoneyCents(
                        entry.unit_price_cents,
                        locale,
                        activeRegister?.currency ?? 'CAD',
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Colonne Centre : panier ─────────────────────────────────────── */}
        <section
          className="lg:col-span-4 p-4 rounded-xl border border-[var(--border-subtle)] bg-white space-y-3"
          aria-label={t('pos.cart_empty')}
          data-testid="pos-cart-panel"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-[var(--text-primary)]">
              <Icon as={ShoppingCart} size="sm" className="inline mr-1.5" />
              {t('pos.title')}
            </h3>
            <span
              className="text-sm font-semibold text-[var(--primary)]"
              data-testid="pos-cart-total"
            >
              {formatMoneyCents(
                totalCents,
                locale,
                activeRegister?.currency ?? 'CAD',
              )}
            </span>
          </div>

          {cart.length === 0 ? (
            <EmptyState
              icon={<Icon as={ShoppingCart} size={32} />}
              title={t('pos.cart_empty')}
              description={t('pos.scan_barcode')}
            />
          ) : (
            <ul
              className="space-y-2 list-none p-0 m-0 max-h-[480px] overflow-y-auto"
              data-testid="pos-cart-list"
            >
              {cart.map((line) => (
                <li
                  key={line.key}
                  className="p-2 rounded-lg border border-[var(--border-subtle)] flex items-start gap-2"
                  data-testid={`pos-cart-line-${line.variant_id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {line.title}
                    </div>
                    {line.variant_title ? (
                      <div className="text-xs text-[var(--text-muted)] truncate">
                        {line.variant_title}
                      </div>
                    ) : null}
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      {formatMoneyCents(
                        line.unit_price_cents,
                        locale,
                        activeRegister?.currency ?? 'CAD',
                      )}{' '}
                      ×{' '}
                      <span
                        className="font-mono"
                        data-testid={`pos-cart-qty-${line.variant_id}`}
                      >
                        {line.quantity}
                      </span>{' '}
                      ={' '}
                      <span
                        className="font-semibold text-[var(--text-primary)]"
                        data-testid={`pos-cart-line-total-${line.variant_id}`}
                      >
                        {formatMoneyCents(
                          line.unit_price_cents * line.quantity,
                          locale,
                          activeRegister?.currency ?? 'CAD',
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => decLine(line.key)}
                      className="w-7 h-7 rounded border border-[var(--border-subtle)] flex items-center justify-center hover:bg-[var(--gray-50)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      aria-label={`${t('pos.cart_empty')} − ${line.title}`}
                      data-testid={`pos-cart-dec-${line.variant_id}`}
                    >
                      <Icon as={Minus} size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => incLine(line.key)}
                      className="w-7 h-7 rounded border border-[var(--border-subtle)] flex items-center justify-center hover:bg-[var(--gray-50)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      aria-label={`${t('pos.cart_empty')} + ${line.title}`}
                      data-testid={`pos-cart-inc-${line.variant_id}`}
                    >
                      <Icon as={Plus} size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      className="w-7 h-7 rounded border border-[var(--border-subtle)] text-[var(--danger)] flex items-center justify-center hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]"
                      aria-label={`${t('pos.void')} — ${line.title}`}
                      data-testid={`pos-cart-remove-${line.variant_id}`}
                    >
                      <Icon as={Trash2} size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Colonne Droite : paiement ───────────────────────────────────── */}
        <section
          className="lg:col-span-3 p-4 rounded-xl border border-[var(--border-subtle)] bg-white space-y-3"
          aria-label={t('pos.finalize')}
          data-testid="pos-payment-panel"
        >
          <h3 className="font-semibold text-[var(--text-primary)]">
            {t('pos.finalize')}
          </h3>

          <Select
            aria-label={t('pos.payment_cash')}
            label={t('pos.payment_cash')}
            value={paymentMethod}
            onChange={(e) =>
              setPaymentMethod(e.target.value as PosPaymentMethod)
            }
            data-testid="pos-payment-method"
          >
            <option value="cash">{t('pos.payment_cash')}</option>
            <option value="card_terminal">{t('pos.payment_card')}</option>
            <option value="split">{t('pos.payment_split')}</option>
          </Select>

          {paymentMethod === 'cash' ? (
            <>
              <Input
                type="number"
                step="0.01"
                min="0"
                aria-label={t('pos.tendered')}
                label={t('pos.tendered')}
                leftIcon={<Icon as={Banknote} size="sm" />}
                value={tenderedInput}
                onChange={(e) => setTenderedInput(e.target.value)}
                data-testid="pos-tendered-input"
              />
              <div
                className="p-3 rounded-lg bg-[var(--gray-50)] border border-[var(--border-subtle)] flex items-center justify-between"
                data-testid="pos-change-row"
              >
                <span className="text-sm text-[var(--text-secondary)]">
                  {t('pos.change_due')}
                </span>
                <span
                  className="text-base font-semibold text-[var(--text-primary)]"
                  data-testid="pos-change-due"
                >
                  {formatMoneyCents(
                    changeCents,
                    locale,
                    activeRegister?.currency ?? 'CAD',
                  )}
                </span>
              </div>
            </>
          ) : null}

          {paymentMethod === 'card_terminal' ? (
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              leftIcon={<Icon as={CreditCard} size="sm" />}
              onClick={handleChargeTerminal}
              aria-label={t('pos.payment_card')}
              data-testid="pos-charge-terminal-btn"
            >
              {t('pos.payment_card')}
            </Button>
          ) : null}

          {paymentMethod === 'split' ? (
            <div
              className="p-3 rounded-lg bg-[var(--gray-50)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] flex items-center gap-1.5"
              data-testid="pos-split-hint"
            >
              <Icon as={Split} size={12} />
              {t('pos.payment_split')}
            </div>
          ) : null}

          {/* Récap total */}
          <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
            <span className="text-sm text-[var(--text-secondary)]">
              {t('pos.total_sales')}
            </span>
            <span
              className="text-lg font-semibold text-[var(--text-primary)]"
              data-testid="pos-total-final"
            >
              {formatMoneyCents(
                totalCents,
                locale,
                activeRegister?.currency ?? 'CAD',
              )}
            </span>
          </div>

          <Button
            fullWidth
            onClick={() => void handleFinalize()}
            isLoading={finalizing}
            disabled={!canFinalize || finalizing}
            leftIcon={<Icon as={Check} size="sm" />}
            aria-label={t('pos.finalize')}
            data-testid="pos-finalize-btn"
          >
            {t('pos.finalize')}
          </Button>

          {cart.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              fullWidth
              leftIcon={<Icon as={X} size="sm" />}
              onClick={clearCart}
              disabled={finalizing}
              aria-label={t('pos.void')}
              data-testid="pos-clear-cart-btn"
            >
              {t('pos.void')}
            </Button>
          ) : null}
        </section>
      </div>

      {/* Receipt modal (B3) */}
      {receiptPayload ? (
        <Suspense fallback={null}>
          <POSReceiptPreview
            payload={receiptPayload}
            open={receiptOpen}
            onOpenChange={(o) => {
              setReceiptOpen(o);
              if (!o) setReceiptPayload(null);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

