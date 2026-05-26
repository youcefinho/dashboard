// ── Sprint 34 vague 34-1A — PDF export helper ─────────────
// Centralise la logique window.print() + body class toggling pour les templates
// PDF premium (Invoice / Report / Lead-sheet / Dashboard). Append-only, safe SSR.
//
// Pattern :
//   1. add body class `pdf-mode-<kind>` → masque chrome AppLayout, applique CSS print premium
//   2. setTimeout 80ms → laisse React/styles flush avant que le navigateur snapshot
//   3. window.print() → ouvre la dialog d'impression / "Save as PDF" du navigateur
//   4. remove body class après que afterprint fire (ou fallback 1500ms)
//
// Sprint 46 M1.4 — Ajout mode `dashboard` (multi-page, 1-4 widgets / page).
// Optionnel : passer un `dashboardId` pour ajouter un data-attribute lisible
// dans le CSS print (`body[data-pdf-dashboard-id="..."]`), utile pour tracking.

export type PdfMode = 'invoice' | 'report' | 'lead-sheet' | 'dashboard';

/**
 * Déclenche un export PDF premium en appliquant un body class temporaire qui
 * révèle le CSS print Sprint 34/46 (cover page, footer, etc.) puis appelle
 * window.print(). Le class est retiré au `afterprint` event ou en fallback.
 *
 * @param mode  Template print à activer
 * @param ctx   Contexte optionnel (dashboardId pour mode='dashboard')
 */
export function triggerPdfExport(mode: PdfMode, ctx?: { dashboardId?: string | number }): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const bodyClass = `pdf-mode-${mode}`;
  document.body.classList.add(bodyClass);
  document.body.classList.add('pdf-mode-active');

  // Sprint 46 M1.4 — Expose le dashboardId au CSS (data-attr) si présent
  if (mode === 'dashboard' && ctx?.dashboardId !== undefined && ctx.dashboardId !== null) {
    document.body.setAttribute('data-pdf-dashboard-id', String(ctx.dashboardId));
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove(bodyClass);
    document.body.classList.remove('pdf-mode-active');
    document.body.removeAttribute('data-pdf-dashboard-id');
    window.removeEventListener('afterprint', cleanup);
  };

  // `afterprint` fire après que la dialog est fermée (print OU annuler)
  window.addEventListener('afterprint', cleanup, { once: true });

  // Petite latence pour laisser CSS appliquer avant le snapshot du navigateur
  window.setTimeout(() => {
    try {
      window.print();
    } catch {
      // fail silent
    }
    // Fallback : certains navigateurs ne fire pas afterprint (Safari iOS notamment)
    window.setTimeout(cleanup, 1500);
  }, 80);
}

// ── LOT FACTURATION-RÉELLE — gabarit pièce unitaire (facture / devis) ────────
// docs/LOT-INVOICE.md §6.H : MODIFIER > AJOUTER — on RÉUTILISE l'infra
// triggerPdfExport (body class + window.print + cleanup) ; on injecte une
// pièce printable dans le DOM (même pattern que `.pdf-cover-page` rendue dans
// Invoices.tsx puis révélée par le CSS print). Les taxes (subtotal/tax_tps/
// tax_tvq/total) sont les CHAMPS STOCKÉS serveur (§6.C) — JAMAIS recalculées
// front. Rétro-compat legacy (§6.I) : `total ?? amount` en fallback.

export interface PdfPieceLine { label: string; qty: number; unit_price: number; line_total: number }

export interface PdfPieceData {
  kind: 'invoice' | 'quote';
  /** Libellé titre traduit (t('invoices.pdf.title') / t('quote.pdf.title')). */
  title: string;
  /** Numéro séquentiel de pièce (invoice_number / quote_number) — peut être null. */
  number?: string | null;
  /** Nom client/lead résolu pour l'en-tête. */
  party?: string | null;
  description?: string | null;
  /** Date d'échéance (facture) ou validité (devis). */
  dueLabel?: string;
  dueValue?: string | null;
  createdLabel: string;
  createdValue: string;
  items: PdfPieceLine[];
  /** Champs STOCKÉS serveur §6.C — null = pièce legacy (affichage dégradé). */
  subtotal?: number | null;
  tax_tps?: number | null;
  tax_tvq?: number | null;
  total?: number | null;
  /** Fallback rétro-compat §6.I quand total/subtotal NULL (facture legacy). */
  fallbackAmount?: number | null;
  tps_number?: string | null;
  tvq_number?: string | null;
  issuerName?: string | null;
  currency?: string;
  /** Étiquettes i18n (passées par l'appelant — pdfExport ne touche pas i18n). */
  labels: {
    items_title: string; col_label: string; col_qty: string; col_unit: string; col_total: string;
    subtotal: string; tax_tps: string; tax_tvq: string; grand_total: string;
    number: string; due: string; tps_number: string; tvq_number: string;
    payment_offline?: string; payment_instructions?: string;
  };
}

const PDF_PIECE_HOST_ID = 'pdf-piece-host';

function fmtMoney(n: number | null | undefined, currency: string): string {
  if (n == null || !Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(n);
  } catch {
    return `${n} $`;
  }
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
}

/**
 * Rend une facture/un devis unitaire en DOM printable puis déclenche le PDF.
 * Réutilise `triggerPdfExport('invoice')` (CSS print Sprint 34 — cover/footer
 * partagés) ; le bloc `#pdf-piece-host` est révélé en pdf-mode et nettoyé
 * après impression. Aucun recalcul de taxe (§6.C).
 */
export function exportPiecePdf(data: PdfPieceData): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const currency = data.currency || 'CAD';
  const L = data.labels;
  const subtotal = data.subtotal;
  const total = data.total ?? data.fallbackAmount ?? null;
  const hasBreakdown = subtotal != null && data.tax_tps != null && data.tax_tvq != null;

  const rows = data.items.length
    ? data.items.map((it) => `
        <tr>
          <td>${esc(it.label)}</td>
          <td class="num">${esc(it.qty)}</td>
          <td class="num">${fmtMoney(it.unit_price, currency)}</td>
          <td class="num">${fmtMoney(it.line_total, currency)}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" class="muted">—</td></tr>`;

  const totalsBlock = hasBreakdown
    ? `
      <div class="pdf-piece-totals">
        <div><span>${esc(L.subtotal)}</span><span class="num">${fmtMoney(subtotal, currency)}</span></div>
        <div><span>${esc(L.tax_tps)}</span><span class="num">${fmtMoney(data.tax_tps, currency)}</span></div>
        <div><span>${esc(L.tax_tvq)}</span><span class="num">${fmtMoney(data.tax_tvq, currency)}</span></div>
        <div class="grand"><span>${esc(L.grand_total)}</span><span class="num">${fmtMoney(total, currency)}</span></div>
      </div>`
    : `
      <div class="pdf-piece-totals">
        <div class="grand"><span>${esc(L.grand_total)}</span><span class="num">${fmtMoney(total, currency)}</span></div>
      </div>`;

  const regNums = (data.tps_number || data.tvq_number)
    ? `<div class="pdf-piece-reg">
         ${data.tps_number ? `<span>${esc(L.tps_number)} : ${esc(data.tps_number)}</span>` : ''}
         ${data.tvq_number ? `<span>${esc(L.tvq_number)} : ${esc(data.tvq_number)}</span>` : ''}
       </div>`
    : '';

  const paymentBlock = data.kind === 'invoice' && L.payment_offline
    ? `<div class="pdf-piece-payment">${esc(L.payment_offline)}${L.payment_instructions ? ` — ${esc(L.payment_instructions)}` : ''}</div>`
    : '';

  const host = document.createElement('div');
  host.id = PDF_PIECE_HOST_ID;
  host.className = 'pdf-piece-doc';
  host.setAttribute('aria-hidden', 'true');
  host.innerHTML = `
    <div class="pdf-piece-head">
      <div class="pdf-piece-issuer">${esc(data.issuerName || 'Intralys')}</div>
      <div class="pdf-piece-title">${esc(data.title)}</div>
    </div>
    <div class="pdf-piece-meta">
      ${data.number ? `<div><span>${esc(L.number)}</span><b>${esc(data.number)}</b></div>` : ''}
      ${data.party ? `<div><span>Client</span><b>${esc(data.party)}</b></div>` : ''}
      <div><span>${esc(data.createdLabel)}</span><b>${esc(data.createdValue)}</b></div>
      ${data.dueValue ? `<div><span>${esc(data.dueLabel || L.due)}</span><b>${esc(data.dueValue)}</b></div>` : ''}
    </div>
    ${data.description ? `<div class="pdf-piece-desc">${esc(data.description)}</div>` : ''}
    <table class="pdf-piece-items">
      <thead><tr>
        <th>${esc(L.col_label)}</th><th class="num">${esc(L.col_qty)}</th>
        <th class="num">${esc(L.col_unit)}</th><th class="num">${esc(L.col_total)}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${totalsBlock}
    ${regNums}
    ${paymentBlock}
  `;

  // Évite les doublons si déclenché 2× rapidement
  document.getElementById(PDF_PIECE_HOST_ID)?.remove();
  document.body.appendChild(host);

  const bodyClass = 'pdf-mode-invoice';
  document.body.classList.add(bodyClass);
  document.body.classList.add('pdf-mode-active');
  document.body.classList.add('pdf-mode-piece');

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove(bodyClass);
    document.body.classList.remove('pdf-mode-active');
    document.body.classList.remove('pdf-mode-piece');
    document.getElementById(PDF_PIECE_HOST_ID)?.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  window.setTimeout(() => {
    try { window.print(); } catch { /* fail silent */ }
    window.setTimeout(cleanup, 1500);
  }, 80);
}
