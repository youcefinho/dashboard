// ── Tests src/worker/lib/storefront-engine.ts — LOT STOREFRONT CHECKOUT ────
// Helpers PURS : slug boutique, formatPriceDisplay, validateCheckoutInput,
// computeShippingCost, detectStorefrontBot. ZÉRO I/O.
import { describe, it, expect } from 'vitest';
import {
  STOREFRONT_ERROR_CODES,
  SUPPORTED_CURRENCIES,
  validateStoreSlug,
  formatPriceDisplay,
  validateCheckoutInput,
  computeShippingCost,
  detectStorefrontBot,
  extractUaHeader,
  MAX_CART_ITEMS,
  MAX_ITEM_QUANTITY,
} from '../lib/storefront-engine';

describe('validateStoreSlug — kebab-case 3-80', () => {
  it('accepte un slug propre', () => {
    expect(validateStoreSlug('ma-boutique')).toBe(true);
    expect(validateStoreSlug('shop-2024')).toBe(true);
  });

  it('refuse < 3 ou > 80', () => {
    expect(validateStoreSlug('ab')).toBe(false);
    expect(validateStoreSlug('a'.repeat(81))).toBe(false);
  });

  it('refuse leading/trailing dash, double dash', () => {
    expect(validateStoreSlug('-shop')).toBe(false);
    expect(validateStoreSlug('shop-')).toBe(false);
    expect(validateStoreSlug('shop--store')).toBe(false);
  });

  it('refuse majuscules, espaces, accents', () => {
    expect(validateStoreSlug('Ma-Boutique')).toBe(false);
    expect(validateStoreSlug('ma boutique')).toBe(false);
    expect(validateStoreSlug('café-shop')).toBe(false);
  });
});

describe('formatPriceDisplay — currencies multiples', () => {
  it('formate CAD avec préfixe $ + 2 décimales', () => {
    expect(formatPriceDisplay(1000, 'CAD')).toBe('$10.00 CAD');
  });

  it('formate USD avec préfixe $', () => {
    expect(formatPriceDisplay(2599, 'USD')).toBe('$25.99 USD');
  });

  it('formate EUR avec suffixe € et virgule décimale', () => {
    expect(formatPriceDisplay(1000, 'EUR')).toBe('10,00 € EUR');
  });

  it('formate GBP avec préfixe £', () => {
    expect(formatPriceDisplay(1000, 'GBP')).toBe('£10.00 GBP');
  });

  it('formate JPY sans décimales', () => {
    expect(formatPriceDisplay(1000, 'JPY')).toBe('¥10 JPY');
  });

  it('formate DZD avec suffixe DA', () => {
    expect(formatPriceDisplay(1000, 'DZD')).toBe('10,00 DA DZD');
  });

  it('default CAD si currency manquant', () => {
    expect(formatPriceDisplay(1000)).toBe('$10.00 CAD');
    expect(formatPriceDisplay(1000, '')).toBe('$10.00 CAD');
  });

  it('clamp négatifs à 0', () => {
    expect(formatPriceDisplay(-500, 'CAD')).toBe('$0.00 CAD');
  });

  it('arrondit les fractions de centimes', () => {
    expect(formatPriceDisplay(1234.7, 'CAD')).toBe('$12.35 CAD');
  });

  it('couvre toutes les devises supportées sans crash', () => {
    for (const c of SUPPORTED_CURRENCIES) {
      const s = formatPriceDisplay(1000, c);
      expect(s).toContain(c);
    }
  });
});

describe('validateCheckoutInput — email + items/token + country', () => {
  it('accepte un input minimal valide (email + cart_token)', () => {
    const r = validateCheckoutInput({
      email: 'a@b.co',
      cart_token: 'cart_abc',
    });
    expect(r.ok).toBe(true);
  });

  it('refuse sans email', () => {
    const r = validateCheckoutInput({ cart_token: 'cart_abc' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(STOREFRONT_ERROR_CODES.MISSING_EMAIL);
  });

  it('refuse email invalide', () => {
    const r = validateCheckoutInput({ email: 'not-email', cart_token: 'c' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(STOREFRONT_ERROR_CODES.INVALID_EMAIL);
  });

  it('refuse sans cart_token ni items', () => {
    const r = validateCheckoutInput({ email: 'a@b.co' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(STOREFRONT_ERROR_CODES.MISSING_ITEMS);
  });

  it('accepte items inline valides', () => {
    const r = validateCheckoutInput({
      email: 'a@b.co',
      items: [{ variant_id: 'v1', quantity: 2 }],
    });
    expect(r.ok).toBe(true);
  });

  it('refuse items avec quantity hors bornes', () => {
    expect(
      validateCheckoutInput({
        email: 'a@b.co',
        items: [{ variant_id: 'v1', quantity: 0 }],
      }).ok,
    ).toBe(false);
    expect(
      validateCheckoutInput({
        email: 'a@b.co',
        items: [{ variant_id: 'v1', quantity: MAX_ITEM_QUANTITY + 1 }],
      }).ok,
    ).toBe(false);
  });

  it('refuse items avec variant_id manquant', () => {
    const r = validateCheckoutInput({
      email: 'a@b.co',
      items: [{ quantity: 1 }],
    });
    expect(r.ok).toBe(false);
  });

  it(`refuse > ${MAX_CART_ITEMS} items (anti-flood)`, () => {
    const items = Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => ({
      variant_id: `v${i}`,
      quantity: 1,
    }));
    const r = validateCheckoutInput({ email: 'a@b.co', items });
    expect(r.ok).toBe(false);
  });

  it('refuse country non-ISO alpha-2', () => {
    const r = validateCheckoutInput({
      email: 'a@b.co',
      cart_token: 'c',
      address: { country: 'CANADA' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(STOREFRONT_ERROR_CODES.INVALID_COUNTRY);
  });

  it('accepte country ISO valide', () => {
    expect(
      validateCheckoutInput({
        email: 'a@b.co',
        cart_token: 'c',
        address: { country: 'CA' },
      }).ok,
    ).toBe(true);
  });

  it('refuse input non-objet', () => {
    expect(validateCheckoutInput(null).ok).toBe(false);
    expect(validateCheckoutInput('string').ok).toBe(false);
  });
});

describe('computeShippingCost — sélection rate applicable', () => {
  const rates = [
    { country: 'CA', min_subtotal_cents: 0, max_subtotal_cents: 5000, price_cents: 1000, name: 'Standard CA' },
    { country: 'CA', min_subtotal_cents: 5000, max_subtotal_cents: null, price_cents: 0, name: 'Gratuit CA' },
    { country: 'US', min_subtotal_cents: 0, max_subtotal_cents: null, price_cents: 2500, name: 'Standard US' },
  ];

  it('retourne le rate applicable pour subtotal < 5000 CA', () => {
    const r = computeShippingCost([{ price_cents: 2000, quantity: 1 }], 'CA', rates);
    expect(r.matched).toBe(true);
    expect(r.amount).toBe(1000);
    expect(r.rate_name).toBe('Standard CA');
  });

  it('retourne le rate gratuit pour subtotal ≥ 5000 CA', () => {
    const r = computeShippingCost(
      [{ price_cents: 3000, quantity: 2 }],
      'CA',
      rates,
    );
    expect(r.matched).toBe(true);
    expect(r.amount).toBe(0);
  });

  it('aucun rate applicable pour pays inconnu → matched false', () => {
    const r = computeShippingCost([{ price_cents: 1000, quantity: 1 }], 'FR', rates);
    expect(r.matched).toBe(false);
    expect(r.error).toBe(STOREFRONT_ERROR_CODES.SHIPPING_NO_ZONE);
  });

  it('panier vide → 0, matched=false', () => {
    const r = computeShippingCost([], 'CA', rates);
    expect(r.amount).toBe(0);
    expect(r.matched).toBe(false);
  });

  it('rates vide → SHIPPING_NO_RATE', () => {
    const r = computeShippingCost([{ price_cents: 100, quantity: 1 }], 'CA', []);
    expect(r.matched).toBe(false);
    expect(r.error).toBe(STOREFRONT_ERROR_CODES.SHIPPING_NO_RATE);
  });

  it('choisit le rate le moins cher si plusieurs applicables', () => {
    const multi = [
      { country: 'CA', min_subtotal_cents: 0, price_cents: 1500, name: 'Premium' },
      { country: 'CA', min_subtotal_cents: 0, price_cents: 800, name: 'Eco' },
    ];
    const r = computeShippingCost([{ price_cents: 100, quantity: 1 }], 'CA', multi);
    expect(r.amount).toBe(800);
    expect(r.rate_name).toBe('Eco');
  });

  it('null zone → match tous pays', () => {
    const r = computeShippingCost([{ price_cents: 100, quantity: 1 }], null, rates);
    expect(r.matched).toBe(true);
  });
});

describe('detectStorefrontBot — multi-signal', () => {
  it('détecte UA vide', () => {
    expect(detectStorefrontBot({ userAgent: '' }, {})).toBe(true);
  });

  it('détecte curl/wget/python-requests', () => {
    expect(detectStorefrontBot({ userAgent: 'curl/7.0' }, {})).toBe(true);
    expect(detectStorefrontBot({ userAgent: 'wget/1.0' }, {})).toBe(true);
    expect(detectStorefrontBot({ userAgent: 'python-requests/2.0' }, {})).toBe(true);
  });

  it('détecte headless/bot/spider/crawler', () => {
    expect(detectStorefrontBot({ userAgent: 'HeadlessChrome/1.0' }, {})).toBe(true);
    expect(detectStorefrontBot({ userAgent: 'GoogleBot/2.1' }, {})).toBe(true);
  });

  it('détecte honeypot rempli', () => {
    expect(
      detectStorefrontBot(
        { userAgent: 'Mozilla/5.0' },
        { honeypotValue: 'spam' },
      ),
    ).toBe(true);
  });

  it('détecte submit ultra-rapide (<1s)', () => {
    const t = 1700000000000;
    expect(
      detectStorefrontBot(
        { userAgent: 'Mozilla/5.0' },
        { loadedAt: t, submittedAt: t + 500 },
      ),
    ).toBe(true);
  });

  it('UA navigateur normal + délai réaliste → pas bot', () => {
    const t = 1700000000000;
    expect(
      detectStorefrontBot(
        { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36' },
        { loadedAt: t, submittedAt: t + 5000 },
      ),
    ).toBe(false);
  });

  it('honeypot vide ou null → pas bot', () => {
    expect(
      detectStorefrontBot(
        { userAgent: 'Mozilla/5.0 Chrome' },
        { honeypotValue: '' },
      ),
    ).toBe(false);
    expect(
      detectStorefrontBot(
        { userAgent: 'Mozilla/5.0 Chrome' },
        { honeypotValue: null },
      ),
    ).toBe(false);
  });
});

describe('extractUaHeader — support Headers et POJO', () => {
  it('extrait User-Agent depuis Headers', () => {
    const h = new Headers({ 'User-Agent': 'Mozilla/5.0' });
    expect(extractUaHeader(h)).toBe('Mozilla/5.0');
  });

  it("extrait depuis un POJO 'user-agent' (lowercase)", () => {
    expect(extractUaHeader({ 'user-agent': 'curl/7.0' })).toBe('curl/7.0');
  });

  it("renvoie '' si pas de header", () => {
    expect(extractUaHeader(new Headers())).toBe('');
    expect(extractUaHeader({})).toBe('');
  });
});
