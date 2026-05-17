// @vitest-environment jsdom
// ── Sprint S9 (Manager B) — OrderDetailPanel split iso-rendu + i18n parité ──
//
// Couvre :
//  1. Split iso-rendu : chaque sous-composant extrait
//     (OrderStatusTags / OrderItemsSection / OrderTotalsSection /
//     OrderCustomerSection / OrderTimelineSection / OrderInvoicePrint /
//     OrderDeliverySlipPrint) rend EXACTEMENT la structure DOM attendue
//     (classes/sélecteurs load-bearing identiques à l'original avant split).
//  2. Snapshot iso-rendu : mêmes props → même markup (déterministe).
//  3. Helpers statut re-exportés depuis OrderDetailPanel inchangés
//     (orderStatusLabel / orderStatusVariant / financialLabel /
//     fulfillmentLabel) — préserve les imports externes
//     (BoutiqueDashboard / Commandes).
//  4. i18n : clés `calendar.*` / `inbox.*` présentes dans les 4 catalogues,
//     parité STRICTE, ZÉRO clé sous namespace R
//     (leads./dashboard./tasks./pipeline./clients./leadDetail.).
//
// ⚠️ NON exécuté sur la VM. De plus, `vitest.config.ts` `include` ne couvre
// PAS `src/components/ecommerce/__tests__/**` (globs actuels : worker/,
// components/ui/, components/onboarding/). L'orchestrateur doit AJOUTER
// `'src/components/ecommerce/__tests__/**/*.test.tsx'` à `test.include`
// (Manager B ne modifie pas vitest.config — cf. rapport). Pattern repris de
// src/components/ui/__tests__/Toast.test.tsx (pragma jsdom + RTL).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { frCA } from '@/lib/i18n/fr-CA';
import { frFR } from '@/lib/i18n/fr-FR';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';

// ── Mocks i18n : t() renvoie la clé (assertions structurelles déterministes),
//    formatMoneyCents / formatDate renvoient un marqueur stable. On NE teste
//    PAS le formatage (logique figée hors scope) — on teste l'iso-rendu DOM.
vi.mock('@/lib/i18n', () => ({
  t: (k: string) => k,
  getLocale: () => 'fr-CA',
}));
vi.mock('@/lib/i18n/number', () => ({
  formatMoneyCents: (c: number) => `\$${(c / 100).toFixed(2)}`,
}));
vi.mock('@/lib/i18n/datetime', () => ({
  formatDate: (s: string) => `DATE(${s})`,
}));
// Mocks défensifs : neutralisent les imports lourds/à effet de bord d'
// OrderDetailPanel (on n'instancie JAMAIS le panneau ici — on importe juste
// les helpers re-exportés). Aucun de ces mocks n'altère les sous-composants
// orderDetail/* (qui n'importent PAS ces modules).
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/pdfExport', () => ({ triggerPdfExport: () => {} }));
vi.mock('../CheckoutMethodSelect', () => ({ CheckoutMethodSelect: () => null }));
vi.mock('../ShipmentPanel', () => ({ ShipmentPanel: () => null }));

import { OrderStatusTags } from '../orderDetail/OrderStatusTags';
import { OrderItemsSection } from '../orderDetail/OrderItemsSection';
import { OrderTotalsSection } from '../orderDetail/OrderTotalsSection';
import { OrderCustomerSection } from '../orderDetail/OrderCustomerSection';
import { OrderTimelineSection } from '../orderDetail/OrderTimelineSection';
import { OrderInvoicePrint } from '../orderDetail/OrderInvoicePrint';
import { OrderDeliverySlipPrint } from '../orderDetail/OrderDeliverySlipPrint';
import {
  orderStatusLabel, orderStatusVariant, financialLabel, fulfillmentLabel,
} from '../OrderDetailPanel';
import type { Order } from '@/lib/types';
import type { OrderInvoiceData } from '@/lib/api';

const LOCALE = 'fr-CA' as const;

function mkOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'ord_abcdef0123456789',
    client_id: 'c1',
    customer_id: null,
    order_number: 'CMD-1001',
    status: 'paid',
    financial_status: 'paid',
    fulfillment_status: 'unfulfilled',
    subtotal_cents: 10000,
    tps_cents: 500,
    tvq_cents: 998,
    shipping_cents: 0,
    discount_cents: 0,
    total_cents: 11498,
    currency: 'CAD',
    email: 'client@example.com',
    shipping_address_json: null,
    billing_address_json: null,
    note: '',
    source: 'web',
    external_id: null,
    placed_at: '2026-01-02T10:00:00Z',
    paid_at: '2026-01-02T11:00:00Z',
    shipped_at: null,
    cancelled_at: null,
    created_at: '2026-01-02T10:00:00Z',
    updated_at: '2026-01-02T11:00:00Z',
    items: [
      {
        id: 'it1',
        order_id: 'ord_abcdef0123456789',
        variant_id: 'v1',
        product_title_snapshot: 'Widget Pro',
        variant_title_snapshot: 'Bleu',
        sku_snapshot: 'WP-BLU',
        unit_price_cents: 5000,
        quantity: 2,
        total_cents: 10000,
        tax_cents: 1498,
        created_at: '2026-01-02T10:00:00Z',
      },
    ],
    ...over,
  };
}

const INVOICE: OrderInvoiceData = {
  order: {},
  items: [
    { product_title: 'Widget Pro', variant_title: 'Bleu', sku: 'WP-BLU', unit_price_cents: 5000, quantity: 2, total_cents: 10000, tax_cents: 1498 },
  ],
  totals: { subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, shipping_cents: 0, discount_cents: 0, total_cents: 11498 },
  client: { name: 'Acme', email: 'a@acme.test', gst_number: null, qst_number: null, tax_note: 'TPS/TVQ' },
  customer: null,
};

afterEach(cleanup);

describe('S9 split — sous-composants iso-rendu', () => {
  it('OrderStatusTags rend 3 tags (statut + financier + fulfillment)', () => {
    const { container } = render(<OrderStatusTags order={mkOrder()} />);
    // Conteneur de tête identique à l'original (flex-wrap items-center gap-2).
    const wrap = container.querySelector('.flex.flex-wrap.items-center.gap-2');
    expect(wrap).not.toBeNull();
    // 3 libellés statut visibles (texte = clés mockées).
    expect(container.textContent).toContain('shop.order.financial');
    expect(container.textContent).toContain('shop.order.fulfillment');
  });

  it('OrderItemsSection rend une ligne par item avec snapshots + montants', () => {
    const { container } = render(
      <OrderItemsSection order={mkOrder()} locale={LOCALE} cur="CAD" />,
    );
    expect(container.querySelector('h3.t-h3')?.textContent).toBe('shop.order.items');
    expect(container.textContent).toContain('Widget Pro');
    expect(container.textContent).toContain('WP-BLU');
    // quantité × prix unitaire (formatMoneyCents mocké).
    expect(container.textContent).toContain('2 × $50.00');
    // total ligne.
    expect(container.textContent).toContain('$100.00');
  });

  it('OrderItemsSection — items vide rend le placeholder « — »', () => {
    const { container } = render(
      <OrderItemsSection order={mkOrder({ items: [] })} locale={LOCALE} cur="CAD" />,
    );
    expect(container.querySelector('.px-3.py-4')?.textContent).toBe('—');
  });

  it('OrderTotalsSection — breakdown TPS + TVQ + total préservé', () => {
    const { container } = render(
      <OrderTotalsSection order={mkOrder()} locale={LOCALE} cur="CAD" />,
    );
    expect(container.textContent).toContain('shop.order.tps');
    expect(container.textContent).toContain('shop.order.tvq');
    expect(container.textContent).toContain('shop.order.subtotal');
    // total = 11498 cents → $114.98.
    expect(container.textContent).toContain('$114.98');
    // discount masqué si 0.
    expect(container.textContent).not.toContain('shop.order.discount');
  });

  it('OrderTotalsSection — discount visible si discount_cents > 0', () => {
    const { container } = render(
      <OrderTotalsSection order={mkOrder({ discount_cents: 200 })} locale={LOCALE} cur="CAD" />,
    );
    expect(container.textContent).toContain('shop.order.discount');
    expect(container.textContent).toContain('-$2.00');
  });

  it('OrderCustomerSection — email + adresse de repli si absente', () => {
    const { container } = render(
      <OrderCustomerSection order={mkOrder()} shipAddr={null} billAddr={null} />,
    );
    expect(container.textContent).toContain('client@example.com');
    // Pas d'adresse → clé de repli.
    expect(container.textContent).toContain('shop.order.no_address');
  });

  it('OrderCustomerSection — billAddr distinct rendu', () => {
    const { container } = render(
      <OrderCustomerSection
        order={mkOrder()}
        shipAddr={'12 rue A\nMtl'}
        billAddr={'99 rue B\nQc'}
      />,
    );
    expect(container.textContent).toContain('shop.order.billing_address');
    expect(container.textContent).toContain('99 rue B');
  });

  it('OrderTimelineSection — n’affiche que les jalons datés', () => {
    const { container } = render(
      <OrderTimelineSection order={mkOrder()} locale={LOCALE} />,
    );
    const items = container.querySelectorAll('ul > li');
    // placed_at + paid_at renseignés, shipped/cancelled null → 2 lignes.
    expect(items.length).toBe(2);
    expect(container.textContent).toContain('shop.order.placed');
    expect(container.textContent).toContain('shop.order.paid_at');
    expect(container.textContent).not.toContain('shop.order.shipped_at');
  });

  it('OrderInvoicePrint — bloc imprimable .order-invoice-print + totaux', () => {
    const { container } = render(
      <OrderInvoicePrint invoice={INVOICE} order={mkOrder()} locale={LOCALE} cur="CAD" />,
    );
    expect(container.querySelector('.order-invoice-print')).not.toBeNull();
    expect(container.querySelector('.order-invoice-table')).not.toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.textContent).toContain('Widget Pro');
    expect(container.textContent).toContain('$114.98');
  });

  it('OrderDeliverySlipPrint — bloc .delivery-slip-print SANS prix', () => {
    const { container } = render(
      <OrderDeliverySlipPrint order={mkOrder()} shipAddr={null} locale={LOCALE} />,
    );
    expect(container.querySelector('.delivery-slip-print')).not.toBeNull();
    expect(container.querySelector('.delivery-slip-table')).not.toBeNull();
    // Bon de livraison = AUCUN montant en dollars.
    expect(container.textContent).not.toContain('$');
    expect(container.textContent).toContain('Widget Pro');
  });

  it('snapshot iso-rendu : mêmes props → markup identique (déterministe)', () => {
    const order = mkOrder();
    const a = render(<OrderTotalsSection order={order} locale={LOCALE} cur="CAD" />);
    const htmlA = a.container.innerHTML;
    cleanup();
    const b = render(<OrderTotalsSection order={order} locale={LOCALE} cur="CAD" />);
    expect(b.container.innerHTML).toBe(htmlA);
  });
});

describe('S9 split — helpers statut re-exportés inchangés', () => {
  it('orderStatusLabel mappe les statuts via clés i18n (mockées)', () => {
    expect(orderStatusLabel('paid')).toBe('shop.order.st_paid');
    expect(orderStatusLabel('cancelled')).toBe('shop.order.st_cancelled');
    expect(orderStatusLabel(undefined)).toBe('—');
    expect(orderStatusLabel('xxx')).toBe('xxx');
  });
  it('orderStatusVariant — mapping variant exact', () => {
    expect(orderStatusVariant('delivered')).toBe('success');
    expect(orderStatusVariant('paid')).toBe('success');
    expect(orderStatusVariant('shipped')).toBe('info');
    expect(orderStatusVariant('pending')).toBe('warning');
    expect(orderStatusVariant('cancelled')).toBe('danger');
    expect(orderStatusVariant('zzz')).toBe('neutral');
  });
  it('financialLabel / fulfillmentLabel — repli « — » / valeur brute', () => {
    expect(financialLabel('paid')).toBe('shop.order.fin_paid');
    expect(financialLabel(undefined)).toBe('—');
    expect(fulfillmentLabel('fulfilled')).toBe('shop.order.ful_fulfilled');
    expect(fulfillmentLabel('weird')).toBe('weird');
  });
});

describe('S9 i18n — clés calendar.* / inbox.* parité stricte 4 catalogues', () => {
  const dicts = { frCA, frFR, en, es } as const;
  const names = Object.keys(dicts) as Array<keyof typeof dicts>;

  const s9Keys = (d: Record<string, string>) =>
    Object.keys(d).filter(k => k.startsWith('calendar.') || k.startsWith('inbox.')).sort();

  it('les clés S9 existent (calendar.* + inbox.*) dans chaque catalogue', () => {
    for (const n of names) {
      const ks = s9Keys(dicts[n]);
      expect(ks.length).toBeGreaterThan(100);
      expect(ks).toContain('calendar.page.title');
      expect(ks).toContain('inbox.page.title');
    }
  });

  it('parité STRICTE : ensemble de clés S9 identique entre les 4 catalogues', () => {
    const ref = JSON.stringify(s9Keys(frCA));
    for (const n of names) {
      expect(JSON.stringify(s9Keys(dicts[n]))).toBe(ref);
    }
  });

  it('aucune valeur S9 vide dans aucun catalogue', () => {
    for (const n of names) {
      for (const k of s9Keys(dicts[n])) {
        expect(dicts[n][k], `${n}.${k}`).toBeTruthy();
      }
    }
  });

  it('ZÉRO clé S9 sous un namespace R interdit', () => {
    const R = ['leads.', 'dashboard.', 'tasks.', 'pipeline.', 'clients.', 'leaddetail.'];
    for (const n of names) {
      const offending = Object.keys(dicts[n]).filter(
        k => (k.startsWith('calendar.') || k.startsWith('inbox.')) &&
             R.some(r => k.startsWith(r)),
      );
      expect(offending).toEqual([]);
    }
  });

  it('placeholders {{var}} (double accolade) — aucun {var} simple résiduel', () => {
    for (const n of names) {
      for (const k of s9Keys(dicts[n])) {
        const v = dicts[n][k]!;
        // Pas de {mot} simple (hors {{...}} et hors '#' du mécanisme plural()).
        const single = v.match(/(^|[^{])\{[a-z_]+\}([^}]|$)/g);
        expect(single, `${n}.${k} = "${v}"`).toBeNull();
      }
    }
  });
});
