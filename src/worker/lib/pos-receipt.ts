// ── POS receipts — Sprint 37 Phase A SOCLE (2026-05-24) ────────────────────
//
// Génération de reçus (HTML email + ESC/POS thermique 80mm + PDF R2).
// Implémentation Agent A2 — Phase A SOCLE complète, contrat FIGÉ.
//
// ⚠️ FIGÉ contrat Phase A (docs/LOT-POS-S37.md §6 + docs/ESC-POS-PRINTER-S37.md).
// Toute modification de signature = nouvelle migration + nouveau §6.

import type { Env } from '../types';

// ── Types contrat figés ──────────────────────────────────────────────────────

export interface ReceiptItem {
  title: string;
  variant_title?: string;
  sku?: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export interface ReceiptTaxLine {
  label: string;
  rate: number;
  amount_cents: number;
}

export interface ReceiptPayload {
  tenantName: string;
  transactionId: string;
  orderNumber: string;
  placedAt: string;                  // ISO 8601
  items: ReceiptItem[];
  subtotalCents: number;
  taxLines: ReceiptTaxLine[];
  totalCents: number;
  paymentMethod: 'cash' | 'card_terminal' | 'gift_card' | 'other' | 'split';
  tenderedCents?: number;
  changeCents?: number;
  cashierName: string;
  registerName: string;
}

export type ReceiptLocale = 'fr-CA' | 'fr-FR' | 'en' | 'es';

// ── i18n labels (4 locales, hardcoded local — cas simple) ────────────────────

interface ReceiptLabels {
  transaction: string;
  order: string;
  date: string;
  cashier: string;
  register: string;
  item: string;
  qty: string;
  unit: string;
  total: string;
  subtotal: string;
  totalDue: string;
  payment: string;
  tendered: string;
  change: string;
  paymentMethods: Record<ReceiptPayload['paymentMethod'], string>;
}

const LABELS: Record<ReceiptLocale, ReceiptLabels> = {
  'fr-CA': {
    transaction: 'N° transaction',
    order: 'N° commande',
    date: 'Date',
    cashier: 'Caissier',
    register: 'Caisse',
    item: 'Article',
    qty: 'Qté',
    unit: 'Unitaire',
    total: 'Total',
    subtotal: 'Sous-total',
    totalDue: 'TOTAL',
    payment: 'Paiement',
    tendered: 'Reçu',
    change: 'Monnaie',
    paymentMethods: {
      cash: 'Comptant',
      card_terminal: 'Terminal carte',
      gift_card: 'Carte-cadeau',
      other: 'Autre',
      split: 'Mixte',
    },
  },
  'fr-FR': {
    transaction: 'N° transaction',
    order: 'N° commande',
    date: 'Date',
    cashier: 'Caissier',
    register: 'Caisse',
    item: 'Article',
    qty: 'Qté',
    unit: 'Unitaire',
    total: 'Total',
    subtotal: 'Sous-total',
    totalDue: 'TOTAL',
    payment: 'Paiement',
    tendered: 'Reçu',
    change: 'Rendu',
    paymentMethods: {
      cash: 'Espèces',
      card_terminal: 'Terminal carte',
      gift_card: 'Carte cadeau',
      other: 'Autre',
      split: 'Mixte',
    },
  },
  en: {
    transaction: 'Transaction #',
    order: 'Order #',
    date: 'Date',
    cashier: 'Cashier',
    register: 'Register',
    item: 'Item',
    qty: 'Qty',
    unit: 'Unit',
    total: 'Total',
    subtotal: 'Subtotal',
    totalDue: 'TOTAL',
    payment: 'Payment',
    tendered: 'Tendered',
    change: 'Change',
    paymentMethods: {
      cash: 'Cash',
      card_terminal: 'Card Terminal',
      gift_card: 'Gift Card',
      other: 'Other',
      split: 'Split',
    },
  },
  es: {
    transaction: 'N° transacción',
    order: 'N° pedido',
    date: 'Fecha',
    cashier: 'Cajero',
    register: 'Caja',
    item: 'Artículo',
    qty: 'Cant.',
    unit: 'Unidad',
    total: 'Total',
    subtotal: 'Subtotal',
    totalDue: 'TOTAL',
    payment: 'Pago',
    tendered: 'Entregado',
    change: 'Cambio',
    paymentMethods: {
      cash: 'Efectivo',
      card_terminal: 'Terminal tarjeta',
      gift_card: 'Tarjeta regalo',
      other: 'Otro',
      split: 'Mixto',
    },
  },
};

// ── Helpers privés ───────────────────────────────────────────────────────────

/**
 * HTML escape strict (anti-XSS) sur tout champ provenant de l'utilisateur.
 * Calque sanitizeHtml() de helpers.ts mais isolé ici (lib autonome).
 */
function escapeHtml(input: unknown): string {
  const s = input == null ? '' : String(input);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formatte des cents en montant lisible "X,XX$" (fr) ou "X.XX$" (en/es).
 * Symbole $ à droite (convention QC/CA). Toujours 2 décimales.
 */
function formatCents(cents: number, locale: ReceiptLocale): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  const sep = locale === 'en' ? '.' : ',';
  return `${sign}${whole}${sep}${frac}$`;
}

/**
 * Formatte une date ISO en format lisible local (sans dépendance Intl, Worker-safe).
 */
function formatDate(iso: string, locale: ReceiptLocale): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  const Y = d.getUTCFullYear();
  const M = pad(d.getUTCMonth() + 1);
  const D = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const m = pad(d.getUTCMinutes());
  if (locale === 'en') return `${Y}-${M}-${D} ${h}:${m}`;
  // fr-CA / fr-FR / es → DD/MM/YYYY HH:mm
  return `${D}/${M}/${Y} ${h}:${m}`;
}

// ── buildReceiptHtml — HTML 80mm (CSS inline) email/print ────────────────────
/**
 * Construit le HTML du reçu format 80mm (280px) avec CSS inline minimal.
 * Anti-XSS strict sur tous les champs visiteur (escapeHtml).
 */
export function buildReceiptHtml(
  payload: ReceiptPayload,
  locale: ReceiptLocale,
): string {
  const L = LABELS[locale] ?? LABELS['fr-CA'];
  const tenantName = escapeHtml(payload.tenantName);
  const transactionId = escapeHtml(payload.transactionId);
  const orderNumber = escapeHtml(payload.orderNumber);
  const placedAt = escapeHtml(formatDate(payload.placedAt, locale));
  const cashierName = escapeHtml(payload.cashierName);
  const registerName = escapeHtml(payload.registerName);
  const paymentLabel = escapeHtml(L.paymentMethods[payload.paymentMethod] ?? payload.paymentMethod);

  const itemsRows = payload.items.map(it => {
    const title = escapeHtml(it.title) + (it.variant_title ? ` <span style="color:#666">(${escapeHtml(it.variant_title)})</span>` : '');
    const sku = it.sku ? `<div style="font-size:9px;color:#888">SKU: ${escapeHtml(it.sku)}</div>` : '';
    const qty = escapeHtml(String(it.quantity));
    const unit = escapeHtml(formatCents(it.unit_price_cents, locale));
    const total = escapeHtml(formatCents(it.line_total_cents, locale));
    return `<tr>
      <td style="padding:2px 0;vertical-align:top">${title}${sku}</td>
      <td style="padding:2px 4px;text-align:right;vertical-align:top">${qty}</td>
      <td style="padding:2px 4px;text-align:right;vertical-align:top">${unit}</td>
      <td style="padding:2px 0;text-align:right;vertical-align:top">${total}</td>
    </tr>`;
  }).join('');

  const taxRows = payload.taxLines.map(t => {
    const label = escapeHtml(t.label);
    const amount = escapeHtml(formatCents(t.amount_cents, locale));
    return `<div style="display:flex;justify-content:space-between;font-size:11px">
      <span>${label}</span><span>${amount}</span>
    </div>`;
  }).join('');

  const subtotal = escapeHtml(formatCents(payload.subtotalCents, locale));
  const total = escapeHtml(formatCents(payload.totalCents, locale));

  let cashBlock = '';
  if (payload.paymentMethod === 'cash' && typeof payload.tenderedCents === 'number') {
    const tendered = escapeHtml(formatCents(payload.tenderedCents, locale));
    const change = escapeHtml(formatCents(payload.changeCents ?? 0, locale));
    cashBlock = `
      <div style="display:flex;justify-content:space-between;font-size:11px">
        <span>${escapeHtml(L.tendered)}</span><span>${tendered}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px">
        <span>${escapeHtml(L.change)}</span><span>${change}</span>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<title>${transactionId}</title>
</head>
<body style="margin:0;padding:8px;background:#fff;font-family:'Courier New',Courier,monospace;color:#000">
<div style="width:280px;margin:0 auto;padding:8px;font-size:11px;line-height:1.3">
  <div style="text-align:center;margin-bottom:8px">
    <div style="font-weight:bold;font-size:14px">${tenantName}</div>
  </div>
  <div style="border-top:1px dashed #000;margin:8px 0"></div>
  <div style="font-size:10px;margin-bottom:6px">
    <div>${escapeHtml(L.transaction)}: ${transactionId}</div>
    <div>${escapeHtml(L.order)}: ${orderNumber}</div>
    <div>${escapeHtml(L.date)}: ${placedAt}</div>
  </div>
  <div style="border-top:1px dashed #000;margin:8px 0"></div>
  <table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead>
      <tr style="border-bottom:1px solid #000">
        <th style="text-align:left;padding:2px 0;font-size:10px">${escapeHtml(L.item)}</th>
        <th style="text-align:right;padding:2px 4px;font-size:10px">${escapeHtml(L.qty)}</th>
        <th style="text-align:right;padding:2px 4px;font-size:10px">${escapeHtml(L.unit)}</th>
        <th style="text-align:right;padding:2px 0;font-size:10px">${escapeHtml(L.total)}</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>
  <div style="border-top:1px dashed #000;margin:8px 0"></div>
  <div style="display:flex;justify-content:space-between;font-size:11px">
    <span>${escapeHtml(L.subtotal)}</span><span>${subtotal}</span>
  </div>
  ${taxRows}
  <div style="border-top:1px solid #000;margin:6px 0"></div>
  <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:13px">
    <span>${escapeHtml(L.totalDue)}</span><span>${total}</span>
  </div>
  <div style="border-top:1px dashed #000;margin:8px 0"></div>
  <div style="display:flex;justify-content:space-between;font-size:11px">
    <span>${escapeHtml(L.payment)}</span><span>${paymentLabel}</span>
  </div>
  ${cashBlock}
  <div style="border-top:1px dashed #000;margin:8px 0"></div>
  <div style="font-size:10px;text-align:center;color:#444">
    <div>${escapeHtml(L.cashier)}: ${cashierName}</div>
    <div>${escapeHtml(L.register)}: ${registerName}</div>
    <div style="margin-top:4px">${placedAt}</div>
  </div>
</div>
</body>
</html>`;
}

// ── buildEscPosBytes — bytes ESC/POS imprimante thermique 80mm ──────────────
/**
 * Construit le flux binaire ESC/POS pour Epson TM-T20III / Star / etc.
 * Charset Latin-1 fallback UTF-8 (français accentué). Largeur 80mm = ~42 col.
 */
export function buildEscPosBytes(payload: ReceiptPayload): Uint8Array {
  const L = LABELS['fr-CA']; // ESC/POS impression locale par défaut fr-CA
  const COLS = 42;
  const chunks: Uint8Array[] = [];

  // Encoder fallback : TextEncoder ne supporte que utf-8 spec WHATWG.
  // On encode utf-8 par défaut ; les caractères accentués passent en multi-byte.
  // Pour vrai support CP858, on ferait un mapping char-by-char (out of scope Phase A).
  const enc = new TextEncoder();
  const push = (b: number[] | Uint8Array) => chunks.push(b instanceof Uint8Array ? b : new Uint8Array(b));
  const pushText = (s: string) => chunks.push(enc.encode(s));

  // ESC @ — reset imprimante
  push([0x1B, 0x40]);

  // ESC t 19 — codepage CP858 (multilingual Latin-1 + €). L'imprimante doit le supporter.
  push([0x1B, 0x74, 19]);

  // ESC a 1 — center align
  push([0x1B, 0x61, 0x01]);

  // ESC E 1 — bold ON
  push([0x1B, 0x45, 0x01]);
  pushText(payload.tenantName + '\n');
  // ESC E 0 — bold OFF
  push([0x1B, 0x45, 0x00]);

  pushText('\n');

  // ESC a 0 — left align
  push([0x1B, 0x61, 0x00]);

  // En-tête infos
  pushText(`${L.transaction}: ${payload.transactionId}\n`);
  pushText(`${L.order}: ${payload.orderNumber}\n`);
  pushText(`${L.date}: ${formatDate(payload.placedAt, 'fr-CA')}\n`);
  pushText('-'.repeat(COLS) + '\n');

  // Items : title sur 1 ligne, qty x unit = total sur ligne suivante
  for (const it of payload.items) {
    const title = (it.title + (it.variant_title ? ` (${it.variant_title})` : '')).slice(0, COLS);
    pushText(title + '\n');
    const left = `  ${it.quantity} x ${formatCents(it.unit_price_cents, 'fr-CA')}`;
    const right = formatCents(it.line_total_cents, 'fr-CA');
    const pad = Math.max(1, COLS - left.length - right.length);
    pushText(left + ' '.repeat(pad) + right + '\n');
  }
  pushText('-'.repeat(COLS) + '\n');

  // Sous-total + taxes + total
  const formatLine = (label: string, value: string): string => {
    const pad = Math.max(1, COLS - label.length - value.length);
    return label + ' '.repeat(pad) + value + '\n';
  };
  pushText(formatLine(L.subtotal, formatCents(payload.subtotalCents, 'fr-CA')));
  for (const t of payload.taxLines) {
    pushText(formatLine(t.label, formatCents(t.amount_cents, 'fr-CA')));
  }
  pushText('-'.repeat(COLS) + '\n');

  // TOTAL en gras
  push([0x1B, 0x45, 0x01]);
  pushText(formatLine(L.totalDue, formatCents(payload.totalCents, 'fr-CA')));
  push([0x1B, 0x45, 0x00]);

  pushText('-'.repeat(COLS) + '\n');

  // Paiement
  const paymentLabel = L.paymentMethods[payload.paymentMethod] ?? payload.paymentMethod;
  pushText(formatLine(L.payment, paymentLabel));
  if (payload.paymentMethod === 'cash' && typeof payload.tenderedCents === 'number') {
    pushText(formatLine(L.tendered, formatCents(payload.tenderedCents, 'fr-CA')));
    pushText(formatLine(L.change, formatCents(payload.changeCents ?? 0, 'fr-CA')));
  }

  pushText('-'.repeat(COLS) + '\n');

  // Footer cashier/register
  push([0x1B, 0x61, 0x01]); // center
  pushText(`${L.cashier}: ${payload.cashierName}\n`);
  pushText(`${L.register}: ${payload.registerName}\n`);
  pushText(`${formatDate(payload.placedAt, 'fr-CA')}\n`);

  // Line feeds avant cut
  pushText('\n\n\n');

  // GS V 0 — full cut paper
  push([0x1D, 0x56, 0x00]);

  // Concat tous les chunks en un Uint8Array
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// ── buildReceiptPdfStub — PDF reçu pour téléchargement client ───────────────
/**
 * Génère un "PDF" du reçu. Phase A : retourne le HTML encodé en UTF-8 bytes
 * (pas un vrai PDF — permet quand même téléchargement pour validation flux).
 * TODO Sprint 40+ : utiliser lib pdf-lib légère pour vraie génération PDF
 * Worker-compatible (WebAssembly).
 */
export async function buildReceiptPdfStub(
  payload: ReceiptPayload,
  locale: ReceiptLocale,
): Promise<Uint8Array> {
  const html = buildReceiptHtml(payload, locale);
  return new TextEncoder().encode(html);
}

// ── uploadReceiptToR2 — archive PDF reçu dans R2 ────────────────────────────
/**
 * Upload du PDF reçu dans le bucket R2. Path-traversal check strict sur
 * clientId + transactionId (regex [a-zA-Z0-9_-]+). Si binding FILES absent,
 * skip silencieusement (best-effort — calque idiome helpers).
 */
export async function uploadReceiptToR2(
  env: Env,
  clientId: string,
  transactionId: string,
  pdfBytes: Uint8Array,
): Promise<{ r2Key: string }> {
  // Path-traversal check strict
  const safePattern = /^[a-zA-Z0-9_-]+$/;
  if (!safePattern.test(clientId) || !safePattern.test(transactionId)) {
    throw new Error('Invalid clientId or transactionId (path-traversal check failed)');
  }
  const r2Key = `receipts/${clientId}/${transactionId}.pdf`;

  // Best-effort : si FILES binding absent, on retourne la clé sans upload
  // (calque idiome sendSms l.158 helpers.ts — squelette flag-inactif).
  if (!env.FILES) {
    return { r2Key };
  }

  await env.FILES.put(r2Key, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' },
  });
  return { r2Key };
}
