// ── storefront-engine.ts — helpers PURS pour LOT STOREFRONT CHECKOUT (Sprint 7) ──
//
// Engine helpers RENFORCEMENT pour storefront-public.ts. ZÉRO I/O (pas de DB,
// pas de fetch). Toutes les fonctions sont déterministes et testables.
//
// Périmètre :
//   - Validation slug boutique (calque store_slug)
//   - Formatage prix display ("$10.00 CAD")
//   - Validation input checkout (items + customer + shipping)
//   - Calcul coût livraison (zone + rates)
//   - Détection bot storefront (UA + honeypot + rate-limit hints)
//
// 100% additif : storefront-public.ts continue de fonctionner sans cet engine.
// Les handlers peuvent l'appeler EN AMONT pour valider AVANT createOrderCore.

// ── Codes d'erreur stables ──────────────────────────────────────────────────
export const STOREFRONT_ERROR_CODES = {
  INVALID_STORE_SLUG: 'storefront.slug.invalid',
  INVALID_CHECKOUT_INPUT: 'storefront.checkout.invalid',
  MISSING_EMAIL: 'storefront.checkout.email_missing',
  INVALID_EMAIL: 'storefront.checkout.email_invalid',
  MISSING_ITEMS: 'storefront.checkout.items_missing',
  INVALID_QUANTITY: 'storefront.checkout.quantity_invalid',
  MISSING_SHIPPING_ADDRESS: 'storefront.checkout.shipping_missing',
  INVALID_COUNTRY: 'storefront.checkout.country_invalid',
  SHIPPING_NO_ZONE: 'storefront.shipping.no_zone',
  SHIPPING_NO_RATE: 'storefront.shipping.no_rate',
  BOT_DETECTED: 'storefront.bot.detected',
} as const;

// ── Bornes ──────────────────────────────────────────────────────────────────
export const MAX_STORE_SLUG_LENGTH = 80;
export const MIN_STORE_SLUG_LENGTH = 3;
export const MAX_CART_ITEMS = 200; // anti-flood
export const MAX_ITEM_QUANTITY = 999;
export const SUPPORTED_CURRENCIES = [
  'CAD', 'USD', 'EUR', 'GBP', 'CHF', 'AUD', 'NZD', 'JPY', 'MXN', 'DZD',
] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// ── Validation slug boutique (calque store_slug grammaire de slugify) ───────
export function validateStoreSlug(slug: unknown): boolean {
  if (typeof slug !== 'string') return false;
  const trimmed = slug.trim();
  if (trimmed.length < MIN_STORE_SLUG_LENGTH || trimmed.length > MAX_STORE_SLUG_LENGTH) {
    return false;
  }
  // kebab-case strict (a-z 0-9 -), commence/finit par alphanum, pas de --
  return /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/.test(trimmed);
}

// ── Formatage prix display ──────────────────────────────────────────────────
// "$10.00 CAD" / "10,00 € EUR" — best-effort. Locale heuristique : EUR/GBP/
// CHF → fr/en, CAD/USD/MXN → en, JPY → en (sans décimales).
// Pas d'Intl.NumberFormat lourd : code stable cross-runtime + déterministe.
const CURRENCY_SYMBOL: Record<string, string> = {
  CAD: '$',
  USD: '$',
  EUR: '€',
  GBP: '£',
  CHF: 'CHF',
  AUD: '$',
  NZD: '$',
  JPY: '¥',
  MXN: '$',
  DZD: 'DA',
};

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY']);

export function formatPriceDisplay(
  cents: unknown,
  currency: unknown = 'CAD',
): string {
  const n = Math.max(0, Math.round(Number(cents) || 0));
  const curRaw =
    typeof currency === 'string' && currency.trim().length > 0
      ? currency.trim().toUpperCase()
      : 'CAD';
  const symbol = CURRENCY_SYMBOL[curRaw] || curRaw;
  const useDecimals = !ZERO_DECIMAL_CURRENCIES.has(curRaw);
  const amount = useDecimals ? (n / 100).toFixed(2) : String(Math.round(n / 100));
  // EUR display avec virgule (européen)
  const isEuStyle = curRaw === 'EUR' || curRaw === 'CHF';
  const useComma = isEuStyle || curRaw === 'DZD';
  const displayAmount = useComma && useDecimals ? amount.replace('.', ',') : amount;
  // Format : préfixe (USD/CAD/MXN/AUD/NZD/JPY/GBP) ou suffixe (EUR/CHF/DZD)
  if (isEuStyle || curRaw === 'DZD') {
    return `${displayAmount} ${symbol} ${curRaw}`;
  }
  return `${symbol}${displayAmount} ${curRaw}`;
}

// ── Validation input checkout ───────────────────────────────────────────────
export interface CheckoutInput {
  email?: unknown;
  cart_token?: unknown;
  items?: Array<{ variant_id?: unknown; quantity?: unknown }> | unknown;
  customer?: { name?: unknown; phone?: unknown } | unknown;
  address?: {
    country?: unknown;
    line1?: unknown;
    city?: unknown;
    postal_code?: unknown;
  } | unknown;
}

export interface CheckoutValidationResult {
  ok: boolean;
  error?: string;
  field?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

export function validateCheckoutInput(input: unknown): CheckoutValidationResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: STOREFRONT_ERROR_CODES.INVALID_CHECKOUT_INPUT };
  }
  const body = input as Record<string, unknown>;

  // Email obligatoire (calque storefront-public.ts:643)
  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    return {
      ok: false,
      error: STOREFRONT_ERROR_CODES.MISSING_EMAIL,
      field: 'email',
    };
  }
  if (!EMAIL_RE.test(body.email.trim())) {
    return {
      ok: false,
      error: STOREFRONT_ERROR_CODES.INVALID_EMAIL,
      field: 'email',
    };
  }

  // cart_token requis (storefront-public.ts:648) — soit token soit items inline
  // (selon route). On accepte les deux : cart_token *OU* items[]
  const hasToken =
    typeof body.cart_token === 'string' && body.cart_token.trim().length > 0;
  const hasItems = Array.isArray(body.items) && body.items.length > 0;
  if (!hasToken && !hasItems) {
    return {
      ok: false,
      error: STOREFRONT_ERROR_CODES.MISSING_ITEMS,
      field: 'cart_token',
    };
  }

  // Si items inline : valider la grammaire + quantité bornée
  if (hasItems) {
    const items = body.items as Array<Record<string, unknown>>;
    if (items.length > MAX_CART_ITEMS) {
      return {
        ok: false,
        error: STOREFRONT_ERROR_CODES.MISSING_ITEMS,
        field: 'items',
      };
    }
    for (const item of items) {
      if (
        !item ||
        typeof item.variant_id !== 'string' ||
        item.variant_id.trim().length === 0
      ) {
        return {
          ok: false,
          error: STOREFRONT_ERROR_CODES.MISSING_ITEMS,
          field: 'variant_id',
        };
      }
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_ITEM_QUANTITY) {
        return {
          ok: false,
          error: STOREFRONT_ERROR_CODES.INVALID_QUANTITY,
          field: 'quantity',
        };
      }
    }
  }

  // Adresse de livraison : si fournie, country doit être ISO alpha-2.
  const address = body.address as Record<string, unknown> | undefined;
  if (address && typeof address === 'object') {
    if (address.country !== undefined) {
      const c =
        typeof address.country === 'string'
          ? address.country.trim().toUpperCase()
          : '';
      if (c && !COUNTRY_RE.test(c)) {
        return {
          ok: false,
          error: STOREFRONT_ERROR_CODES.INVALID_COUNTRY,
          field: 'country',
        };
      }
    }
  }

  return { ok: true };
}

// ── Calcul coût livraison (rates par zone) ──────────────────────────────────
// Pur : prend une liste de rates ({ zone, min_subtotal, max_subtotal,
// price_cents, country? }) et résout le tarif applicable. NE remplace PAS
// resolveShippingRate de ecommerce-shipping-zones (qui lit la DB) — c'est
// un helper local pour les checkouts qui veulent calculer côté front/preview.
export interface ShippingRate {
  zone_id?: string;
  country?: string | null;
  min_subtotal_cents?: number;
  max_subtotal_cents?: number | null;
  price_cents: number;
  name?: string;
}

export interface ShippingItem {
  weight_grams?: number;
  quantity?: number;
  price_cents?: number;
}

export interface ShippingResult {
  amount: number;
  matched: boolean;
  rate_name?: string;
  error?: string;
}

export function computeShippingCost(
  items: ShippingItem[],
  zone: string | null,
  rates: ShippingRate[],
): ShippingResult {
  if (!Array.isArray(rates) || rates.length === 0) {
    return { amount: 0, matched: false, error: STOREFRONT_ERROR_CODES.SHIPPING_NO_RATE };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { amount: 0, matched: false };
  }

  // Sous-total = somme des price_cents × quantity
  let subtotalCents = 0;
  for (const item of items) {
    const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
    const price = Math.max(0, Math.round(Number(item.price_cents) || 0));
    subtotalCents += qty * price;
  }

  // Filtre par zone (country) : null → match tous, sinon match exact
  const z = zone ? zone.trim().toUpperCase() : null;
  const applicable = rates.filter((r) => {
    if (z) {
      const rc = r.country ? r.country.trim().toUpperCase() : null;
      if (rc !== null && rc !== z) return false;
    }
    const min = Math.max(0, Number(r.min_subtotal_cents) || 0);
    if (subtotalCents < min) return false;
    if (r.max_subtotal_cents != null) {
      const max = Number(r.max_subtotal_cents);
      if (Number.isFinite(max) && subtotalCents > max) return false;
    }
    return true;
  });

  if (applicable.length === 0) {
    return {
      amount: 0,
      matched: false,
      error: STOREFRONT_ERROR_CODES.SHIPPING_NO_ZONE,
    };
  }
  // Choisit le tarif le moins cher applicable (déterministe).
  applicable.sort((a, b) => (a.price_cents || 0) - (b.price_cents || 0));
  const chosen = applicable[0]!;
  return {
    amount: Math.max(0, Math.round(chosen.price_cents) || 0),
    matched: true,
    rate_name: chosen.name,
  };
}

// ── Détection bot storefront ────────────────────────────────────────────────
// Multi-signal :
//   - UA suspect (curl/wget/python/scrapy/headless sans navigateur)
//   - honeypot rempli (_hp)
//   - délai post-load trop court (<1s entre form load et submit)
//   - User-Agent vide
// Mots-clés bot. Pas de \b car les mots sont concaténés en CamelCase dans des
// UA comme "GoogleBot/2.1" ou "HeadlessChrome/1.0" (pas de boundary entre e/B).
const BOT_UA_RE =
  /(curl|wget|python-requests|scrapy|httpclient|axios\/0|bot|spider|crawler|headless)/i;

export interface BotDetectionInput {
  userAgent?: string | null;
  honeypotValue?: unknown;
  loadedAt?: number | null; // timestamp en ms quand le form a été chargé
  submittedAt?: number | null; // timestamp en ms du submit
}

export function detectStorefrontBot(
  headers: { userAgent?: string | null } | undefined,
  body: BotDetectionInput | undefined,
): boolean {
  const ua = (headers?.userAgent || body?.userAgent || '').toString();
  if (ua.trim().length === 0) return true; // UA vide = bot probable
  if (BOT_UA_RE.test(ua)) return true;
  // honeypot rempli
  if (body?.honeypotValue !== undefined && body?.honeypotValue !== null) {
    const hp = String(body.honeypotValue).trim();
    if (hp.length > 0) return true;
  }
  // submit < 1s après load = bot
  if (
    body?.loadedAt != null &&
    body?.submittedAt != null &&
    Number.isFinite(body.loadedAt) &&
    Number.isFinite(body.submittedAt)
  ) {
    const delta = body.submittedAt - body.loadedAt;
    if (delta >= 0 && delta < 1000) return true;
  }
  return false;
}

// ── Helper : extrait le User-Agent depuis Headers (Request.headers) ─────────
export function extractUaHeader(
  headers: Headers | Record<string, string | undefined>,
): string {
  if (headers instanceof Headers) {
    return headers.get('User-Agent') || headers.get('user-agent') || '';
  }
  const ua =
    (headers as Record<string, string | undefined>)['User-Agent'] ??
    (headers as Record<string, string | undefined>)['user-agent'];
  return typeof ua === 'string' ? ua : '';
}
