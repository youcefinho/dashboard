// ── POSReportDaily — Sprint 37 (Agent B4) ───────────────────────────────────
// Composant display-only (pas de mutations) qui rend le rapport X / Z d'une
// session POS (shift) à partir de `getPosSessionReport(sessionId)`.
//
// Sections rendues :
//   1. Header        — titre `pos.report_z` + session id + date range (opened/closed)
//   2. Totaux        — 3 cards (total_sales_cents, total_tax_cents, transaction_count)
//   3. By payment    — tableau (méthode | total | count) via `totals_by_method`
//   4. Variance cash — badge variance_cents + warning_level (ok / low / high)
//                      dérivé clientside depuis `session.variance_cents`
//   5. Top produits  — tableau top 10 (title | qty | total) via `top_products`
//   6. Hourly        — liste (hour | count | total) via `hourly_breakdown`
//                      (champ optionnel non-standard — rendu si présent)
//   7. Export        — boutons CSV (blob clientside) + PDF (window.print)
//
// API back FIGÉE (Phase A) :
//   getPosSessionReport(id) → ApiResponse<PosSessionReport>
//   listPosRegisters()     → ApiResponse<PosRegister[]>
//
// Style Stripe-clean. Imports RELATIFS. i18n via t(). Pas de console.log.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { t } from '../../lib/i18n';
import {
  getPosSessionReport,
  type PosSessionReport,
  type PosPaymentMethod,
} from '../../lib/api';

// ── Types ───────────────────────────────────────────────────────────────────

export interface POSReportDailyProps {
  sessionId: string;
  /** v2 — filtrage avancé (non utilisé par getPosSessionReport actuel). */
  registerId?: string;
  /** v2 — filtrage avancé (non utilisé par getPosSessionReport actuel). */
  dateRange?: { from: string; to: string };
}

type VarianceLevel = 'ok' | 'low' | 'high';

/** Bucket horaire — champ optionnel non standard côté back actuel. */
interface HourlyBucket {
  hour: number | string;
  count: number;
  total_cents: number;
}

// Seuil cents pour basculer low → high (~5$ CAD, aligné POSSessionManager).
const VARIANCE_HIGH_THRESHOLD_CENTS = 500;

// ── Helpers (purs) ──────────────────────────────────────────────────────────

function computeVarianceLevel(varianceCents: number | null): VarianceLevel {
  if (varianceCents === null || varianceCents === 0) return 'ok';
  return Math.abs(varianceCents) > VARIANCE_HIGH_THRESHOLD_CENTS ? 'high' : 'low';
}

function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${remainder.toString().padStart(2, '0')} $`;
}

function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  try {
    return new Intl.NumberFormat('fr-CA').format(n);
  } catch {
    return String(n);
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('fr-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function paymentMethodLabel(method: PosPaymentMethod): string {
  switch (method) {
    case 'cash':
      return t('pos.payment_cash');
    case 'card_terminal':
      return t('pos.payment_card');
    case 'split':
      return t('pos.payment_split');
    case 'gift_card':
      return 'Carte cadeau';
    case 'other':
      return 'Autre';
    default:
      return String(method);
  }
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(report: PosSessionReport, hourly: HourlyBucket[]): string {
  const lines: string[] = [];
  // En-tête meta
  lines.push('Section,Champ,Valeur');
  lines.push(`Header,${csvEscape('Session ID')},${csvEscape(report.session.id)}`);
  lines.push(
    `Header,${csvEscape('Opened at')},${csvEscape(report.session.opened_at ?? '')}`,
  );
  lines.push(
    `Header,${csvEscape('Closed at')},${csvEscape(report.session.closed_at ?? '')}`,
  );
  lines.push(
    `Totals,${csvEscape('total_sales_cents')},${csvEscape(report.total_sales_cents)}`,
  );
  lines.push(
    `Totals,${csvEscape('total_tax_cents')},${csvEscape(report.total_tax_cents)}`,
  );
  lines.push(
    `Totals,${csvEscape('transaction_count')},${csvEscape(report.transaction_count)}`,
  );
  lines.push(
    `Variance,${csvEscape('variance_cents')},${csvEscape(report.session.variance_cents ?? 0)}`,
  );

  lines.push('');
  lines.push('Payment Method,Total (cents),Count');
  for (const row of report.totals_by_method ?? []) {
    lines.push(
      `${csvEscape(row.method)},${csvEscape(row.amount_cents)},${csvEscape(row.count)}`,
    );
  }

  lines.push('');
  lines.push('Top Product,Quantity,Total (cents)');
  for (const p of report.top_products ?? []) {
    lines.push(
      `${csvEscape(p.title)},${csvEscape(p.quantity)},${csvEscape(p.total_cents)}`,
    );
  }

  if (hourly.length > 0) {
    lines.push('');
    lines.push('Hour,Count,Total (cents)');
    for (const h of hourly) {
      lines.push(
        `${csvEscape(h.hour)},${csvEscape(h.count)},${csvEscape(h.total_cents)}`,
      );
    }
  }

  return lines.join('\n');
}

function downloadCsv(filename: string, csv: string): void {
  // BOM UTF-8 pour Excel fr-CA
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Best-effort cleanup (peut être no-op si l'env de test mocke URL)
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* noop */
  }
}

// ── Composant ───────────────────────────────────────────────────────────────

export function POSReportDaily({ sessionId }: POSReportDailyProps) {
  const [reportData, setReportData] = useState<PosSessionReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const printableRef = useRef<HTMLDivElement>(null);

  // Charge le rapport au mount / changement de sessionId.
  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const res = await getPosSessionReport(sessionId);
      if (cancelled) return;
      setLoading(false);
      if (res.error) {
        setError(res.error);
        setReportData(null);
        return;
      }
      // Pas d'erreur explicite mais pas de data → empty state (pas erreur).
      setReportData(res.data ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Extraction hourly_breakdown (champ optionnel, non typé côté back).
  const hourly: HourlyBucket[] = useMemo(() => {
    if (!reportData) return [];
    const raw = (reportData as unknown as { hourly_breakdown?: unknown })
      .hourly_breakdown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (b): b is HourlyBucket =>
        b !== null &&
        typeof b === 'object' &&
        'hour' in b &&
        'count' in b &&
        'total_cents' in b,
    );
  }, [reportData]);

  const varianceLevel: VarianceLevel = useMemo(
    () => computeVarianceLevel(reportData?.session.variance_cents ?? null),
    [reportData],
  );

  const handleExportCsv = useCallback(() => {
    if (!reportData) return;
    const csv = buildCsv(reportData, hourly);
    const filename = `pos-report-${reportData.session.id}.csv`;
    downloadCsv(filename, csv);
  }, [reportData, hourly]);

  const handleExportPdf = useCallback(() => {
    // Stratégie simple : window.print() — scope via @media print éventuel.
    // (Pas d'ancre PDF présente dans la réponse API actuelle.)
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="space-y-4"
        role="status"
        aria-label={t('state.loading')}
        data-testid="pos-report-daily-loading"
      >
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  // ── Erreur ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Card>
        <p
          className="text-sm text-[var(--danger-text)]"
          role="alert"
          aria-label={t('state.error')}
          data-testid="pos-report-daily-error"
        >
          {error}
        </p>
      </Card>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (!reportData) {
    return (
      <Card>
        <p
          className="text-sm text-[var(--text-secondary)]"
          role="status"
          aria-label={t('state.empty')}
          data-testid="pos-report-daily-empty"
        >
          {t('state.empty')}
        </p>
      </Card>
    );
  }

  // ── Render plein ───────────────────────────────────────────────────────────

  const session = reportData.session;
  const headerCellCls =
    'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]';
  const bodyCellCls = 'px-3 py-2 text-sm text-[var(--text-primary)]';

  const varianceIntent =
    varianceLevel === 'ok'
      ? 'success'
      : varianceLevel === 'low'
        ? 'warning'
        : 'danger';

  return (
    <div
      ref={printableRef}
      className="space-y-6"
      data-testid="pos-report-daily"
      aria-label={t('pos.report_z')}
    >
      {/* ── Section 1 — Header ─────────────────────────────────────────────── */}
      <section
        data-testid="pos-report-section-header"
        aria-label={t('pos.report_z')}
      >
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">
          {t('pos.report_z')}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          <span className="font-mono">{session.id}</span>
          <span className="px-2 text-[var(--text-muted)]">·</span>
          <span>
            {formatDateTime(session.opened_at)}
            <span className="px-1 text-[var(--text-muted)]">→</span>
            {formatDateTime(session.closed_at)}
          </span>
        </p>
      </section>

      {/* ── Section 2 — Totaux ─────────────────────────────────────────────── */}
      <section
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
        data-testid="pos-report-section-totals"
        aria-label={t('pos.total_sales')}
      >
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
            {t('pos.total_sales')}
          </p>
          <p
            className="mt-2 text-2xl font-semibold tabular-nums text-[var(--text-primary)]"
            data-testid="pos-report-total-sales"
          >
            {formatCents(reportData.total_sales_cents)}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
            {t('pos.total_tax')}
          </p>
          <p
            className="mt-2 text-2xl font-semibold tabular-nums text-[var(--text-primary)]"
            data-testid="pos-report-total-tax"
          >
            {formatCents(reportData.total_tax_cents)}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
            {t('pos.tx_count')}
          </p>
          <p
            className="mt-2 text-2xl font-semibold tabular-nums text-[var(--text-primary)]"
            data-testid="pos-report-tx-count"
          >
            {formatInt(reportData.transaction_count)}
          </p>
        </Card>
      </section>

      {/* ── Section 3 — By payment method ──────────────────────────────────── */}
      <section
        data-testid="pos-report-section-by-method"
        aria-label="Par mode de paiement"
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
          Par mode de paiement
        </h3>
        <Card className="p-0 overflow-hidden">
          <table
            className="w-full border-collapse"
            aria-label="Totaux par mode de paiement"
          >
            <thead className="bg-[var(--bg-muted)] border-b border-[var(--border)]">
              <tr>
                <th scope="col" className={headerCellCls}>
                  Méthode
                </th>
                <th scope="col" className={`${headerCellCls} text-right`}>
                  Total
                </th>
                <th scope="col" className={`${headerCellCls} text-right`}>
                  {t('pos.tx_count')}
                </th>
              </tr>
            </thead>
            <tbody>
              {(reportData.totals_by_method ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className={`${bodyCellCls} text-center text-[var(--text-secondary)]`}
                  >
                    {t('state.empty')}
                  </td>
                </tr>
              ) : (
                reportData.totals_by_method.map((row) => (
                  <tr
                    key={row.method}
                    className="border-b border-[var(--border)] last:border-b-0"
                    data-testid={`pos-report-method-row-${row.method}`}
                  >
                    <td className={`${bodyCellCls} font-medium`}>
                      {paymentMethodLabel(row.method)}
                    </td>
                    <td className={`${bodyCellCls} text-right tabular-nums`}>
                      {formatCents(row.amount_cents)}
                    </td>
                    <td className={`${bodyCellCls} text-right tabular-nums`}>
                      {formatInt(row.count)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ── Section 4 — Variance cash drawer ───────────────────────────────── */}
      <section
        data-testid="pos-report-section-variance"
        aria-label={t('pos.variance')}
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
          {t('pos.variance')}
        </h3>
        <Card>
          <div className="flex items-center gap-3">
            <span
              className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]"
              data-testid="pos-report-variance-amount"
            >
              {formatCents(session.variance_cents)}
            </span>
            <Badge
              intent={varianceIntent}
              fill="soft"
              data-testid="pos-report-variance-badge"
              data-level={varianceLevel}
            >
              {varianceLevel.toUpperCase()}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            {t('pos.expected_cash')} : {formatCents(session.expected_cash_cents)}
            <span className="px-2 text-[var(--text-muted)]">·</span>
            {t('pos.closing_cash')} : {formatCents(session.closing_cash_cents)}
          </p>
        </Card>
      </section>

      {/* ── Section 5 — Top produits ──────────────────────────────────────── */}
      <section
        data-testid="pos-report-section-top-products"
        aria-label={t('pos.top_products')}
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
          {t('pos.top_products')}
        </h3>
        <Card className="p-0 overflow-hidden">
          <table
            className="w-full border-collapse"
            aria-label={t('pos.top_products')}
          >
            <thead className="bg-[var(--bg-muted)] border-b border-[var(--border)]">
              <tr>
                <th scope="col" className={headerCellCls}>
                  Produit
                </th>
                <th scope="col" className={`${headerCellCls} text-right`}>
                  Quantité
                </th>
                <th scope="col" className={`${headerCellCls} text-right`}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {(reportData.top_products ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className={`${bodyCellCls} text-center text-[var(--text-secondary)]`}
                  >
                    {t('state.empty')}
                  </td>
                </tr>
              ) : (
                reportData.top_products.slice(0, 10).map((p) => (
                  <tr
                    key={p.variant_id}
                    className="border-b border-[var(--border)] last:border-b-0"
                    data-testid={`pos-report-product-row-${p.variant_id}`}
                  >
                    <td className={`${bodyCellCls} font-medium`}>{p.title}</td>
                    <td className={`${bodyCellCls} text-right tabular-nums`}>
                      {formatInt(p.quantity)}
                    </td>
                    <td className={`${bodyCellCls} text-right tabular-nums`}>
                      {formatCents(p.total_cents)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ── Section 6 — Hourly breakdown ──────────────────────────────────── */}
      <section
        data-testid="pos-report-section-hourly"
        aria-label="Ventes par heure"
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
          Ventes par heure
        </h3>
        <Card className="p-0 overflow-hidden">
          {hourly.length === 0 ? (
            <p
              className="px-3 py-3 text-sm text-[var(--text-secondary)] text-center"
              role="status"
            >
              {t('state.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {hourly.map((h) => {
                const maxCount = hourly.reduce(
                  (m, x) => (x.count > m ? x.count : m),
                  0,
                );
                const pct = maxCount > 0 ? (h.count / maxCount) * 100 : 0;
                return (
                  <li
                    key={String(h.hour)}
                    className="px-3 py-2 flex items-center gap-3 text-sm"
                    data-testid={`pos-report-hourly-row-${h.hour}`}
                  >
                    <span className="w-12 font-mono text-[var(--text-secondary)] tabular-nums">
                      {typeof h.hour === 'number'
                        ? `${String(h.hour).padStart(2, '0')}h`
                        : h.hour}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex-1 h-2 rounded-full bg-[var(--bg-muted)] overflow-hidden"
                    >
                      <span
                        className="block h-full bg-[var(--primary)]"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="w-16 text-right tabular-nums text-[var(--text-primary)]">
                      {formatInt(h.count)}
                    </span>
                    <span className="w-24 text-right tabular-nums text-[var(--text-primary)]">
                      {formatCents(h.total_cents)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      {/* ── Section 7 — Export ────────────────────────────────────────────── */}
      <section
        className="flex flex-wrap gap-2"
        data-testid="pos-report-section-export"
        aria-label="Exporter le rapport"
      >
        <Button
          onClick={handleExportCsv}
          aria-label={t('pos.export_csv')}
          data-testid="pos-report-export-csv"
        >
          {t('pos.export_csv')}
        </Button>
        <Button
          variant="secondary"
          onClick={handleExportPdf}
          aria-label={t('pos.export_pdf')}
          data-testid="pos-report-export-pdf"
        >
          {t('pos.export_pdf')}
        </Button>
      </section>
    </div>
  );
}

export default POSReportDaily;
