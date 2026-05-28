// ── Invoices — Gestion de la facturation réelle ───────────────────────────
// LOT FACTURATION-RÉELLE (Manager-C, Phase B) — docs/LOT-INVOICE.md §6 :
//   - formulaire lignes d'articles (createInvoiceFull, helper figé Phase A)
//   - affichage taxes = champs STOCKÉS serveur (subtotal/tax_tps/tax_tvq/total),
//     rétro-calcul faux `amount/1.14975` SUPPRIMÉ (§6.C)
//   - lien Stripe mort SUPPRIMÉ → libellé paiement hors-ligne honnête (§6.E)
//   - `default_client_for_demo` SUPPRIMÉ → sélecteur client/lead réel
//   - PDF via getInvoicePdfData + gabarit pièce pdfExport (§6.H)
//   - i18n via t('invoice.*') / t('invoices.*') — clés figées §6.G (aucune créée)

import { useState, useEffect, useRef, Fragment } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Select, Skeleton, EmptyState, PageHero, KpiStrip, type KpiItem, Tag } from '@/components/ui';
import { useToast } from '@/components/ui';
// Sprint 44 M3.3 — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { Modal } from '@/components/ui/Modal';
import { InvoiceDetailModal } from '@/components/billing/InvoiceDetailModal';
import { ChevronRight, FileText, User, Calendar, Download, Plus, Trash2, Eye } from 'lucide-react';
import { exportPiecePdf } from '@/lib/pdfExport';
import { formatCurrency, formatNumber } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import { getLocale, t } from '@/lib/i18n';
import {
  getInvoices as fetchInvoicesApi,
  createInvoiceFull,
  updateInvoiceStatus,
  getInvoicePdfData,
  getClients,
  getLeads,
  type Invoice,
} from '@/lib/api';

interface LineRow { label: string; qty: string; unit_price: string }

const blankRow = (): LineRow => ({ label: '', qty: '1', unit_price: '' });

export function InvoicesPage() {
  const toast = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Fetch error inline (role="alert" + retry) — additif §audit.
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // New invoice form state (lignes d'articles + client/lead + échéance)
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [rows, setRows] = useState<LineRow[]>([blankRow()]);
  const [targetKind, setTargetKind] = useState<'client' | 'lead'>('client');
  const [targetId, setTargetId] = useState('');
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [leads, setLeads] = useState<Array<{ id: string; name: string }>>([]);

  // Détail facture (getInvoice) — surface les lignes d'articles non renvoyées par la liste
  const [detailId, setDetailId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'sent' | 'draft' | 'cancelled'>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpandedRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const fetchInvoices = async () => {
    setFetchError(null);
    try {
      const res = await fetchInvoicesApi();
      if (res.data) setInvoices(res.data as unknown as Invoice[]);
      else if (res.error) setFetchError(res.error);
    } catch (err) {
      console.error(err);
      setFetchError(t('common.error.load_failed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void fetchInvoices(); }, []);

  // Source client/lead réelle (tenant-scoped côté serveur) — chargée à l'ouverture du modal
  useEffect(() => {
    if (!showAdd) return;
    void (async () => {
      try {
        const [c, l] = await Promise.all([getClients(), getLeads({ limit: 100 })]);
        if (c.data) setClients(c.data.map(x => ({ id: x.id, name: x.name })));
        if (l.data) setLeads(l.data.map(x => ({ id: x.id, name: x.name || x.email || x.id })));
      } catch (err) {
        console.error(err);
      }
    })();
  }, [showAdd]);

  const resetForm = () => {
    setDescription('');
    setDueDate('');
    setRows([blankRow()]);
    setTargetKind('client');
    setTargetId('');
  };

  const handleCreate = async () => {
    const items = rows
      .map(r => ({ label: r.label.trim(), qty: Number(r.qty), unit_price: Number(r.unit_price) }))
      .filter(r => r.label && Number.isFinite(r.qty) && r.qty > 0 && Number.isFinite(r.unit_price) && r.unit_price >= 0);
    if (items.length === 0) {
      toast.error(t('invoice.error.items_required'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await createInvoiceFull({
        description: description || undefined,
        due_date: dueDate || undefined,
        ...(targetId ? (targetKind === 'client' ? { client_id: targetId } : { lead_id: targetId }) : {}),
        items,
      });
      // §6.A : apiFetch GELÉ drop `code` → discrimine sur absence de data / texte error
      if (res.data) {
        setShowAdd(false);
        resetForm();
        toast.success(t('invoices.modal.generate'));
        void fetchInvoices();
      } else {
        toast.error(res.error || t('invoices.modal.generate'));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('invoices.modal.generate'));
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await updateInvoiceStatus(id, status);
      void fetchInvoices();
    } catch (err) {
      console.error(err);
    }
  };

  const getStatusBadge = (status: Invoice['status']) => {
    const map: Record<Invoice['status'], { label: string; variant: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
      draft: { label: t('invoices.status.draft'), variant: 'neutral' },
      sent: { label: t('invoices.status.sent'), variant: 'warning' },
      paid: { label: t('invoices.status.paid'), variant: 'success' },
      cancelled: { label: t('invoices.status.cancelled'), variant: 'danger' },
    };
    const cfg = map[status] || map.draft;
    return <Tag dot size="xs" variant={cfg.variant}>{cfg.label}</Tag>;
  };

  // PDF facture conforme QC — gabarit pièce via getInvoicePdfData (§6.H)
  const handleExportInvoicePdf = async (id: string) => {
    try {
      const res = await getInvoicePdfData(id);
      if (!res.data) {
        toast.error(res.error || 'PDF');
        return;
      }
      const { invoice, items, issuer } = res.data;
      exportPiecePdf({
        kind: 'invoice',
        title: t('invoices.pdf.title'),
        number: invoice.invoice_number,
        party: invoice.lead_name || invoice.client_id,
        description: invoice.description,
        dueLabel: t('invoice.due_date'),
        dueValue: invoice.due_date
          ? formatDate(invoice.due_date, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
          : null,
        createdLabel: t('invoices.table.date'),
        createdValue: formatDate(invoice.created_at, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }),
        items: (items || []).map(it => ({
          label: it.label, qty: it.qty, unit_price: it.unit_price, line_total: it.line_total,
        })),
        // Champs STOCKÉS serveur §6.C — jamais recalculés front
        subtotal: invoice.subtotal,
        tax_tps: invoice.tax_tps,
        tax_tvq: invoice.tax_tvq,
        total: invoice.total,
        fallbackAmount: invoice.amount, // rétro-compat §6.I (total ?? amount)
        tps_number: invoice.tps_number,
        tvq_number: invoice.tvq_number,
        issuerName: issuer?.name,
        currency: invoice.currency || 'CAD',
        labels: {
          items_title: t('invoice.items.title'),
          col_label: t('invoice.items.label'),
          col_qty: t('invoice.items.qty'),
          col_unit: t('invoice.items.unit_price'),
          col_total: t('invoice.items.line_total'),
          subtotal: t('invoice.subtotal'),
          tax_tps: t('invoice.tax_tps'),
          tax_tvq: t('invoice.tax_tvq'),
          grand_total: t('invoice.total'),
          number: t('invoice.number'),
          due: t('invoice.due_date'),
          tps_number: t('invoice.tps_number'),
          tvq_number: t('invoice.tvq_number'),
          payment_offline: t('invoice.payment_offline'),
          payment_instructions: t('invoice.payment_instructions'),
        },
      });
    } catch (err) {
      console.error(err);
      toast.error('PDF');
    }
  };

  // Total affiché = champ stocké `total`, fallback legacy `amount` (§6.I)
  const invTotal = (i: Invoice) => i.total ?? i.amount ?? 0;
  // Total visible via KPI inline (invTotal utilisé directement dans le rendu)
  const todayLabel = new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });

  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await fetchInvoices(); }, { scrollParent: scrollParentRef });

  // Aperçu calculé LOCALEMENT (information seule — le serveur recalcule §6.C)
  const previewSubtotal = rows.reduce((s, r) => {
    const q = Number(r.qty), p = Number(r.unit_price);
    return s + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
  }, 0);

  return (
    <AppLayout title="Factures & Paiements">
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />

      <div className="print-page-header">
        <h1>Intralys CRM — Factures</h1>
        <div className="print-meta">{todayLabel} · intralys.com</div>
      </div>

      <PageHero
        meta="Workspace"
        title={t('invoices.hero.title')}
        highlight={t('invoices.hero.title')}
        description={t('invoices.hero.description')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="premium" onClick={() => setShowAdd(true)}>{t('invoices.action.new')}</Button>
          </div>
        }
      />

      {/* Navigation Factures / Devis (pièces du même domaine) */}
      <div className="flex items-center gap-2 mb-4">
        <span className="action-chip action-chip--accent" aria-current="page">{t('invoices.hero.title')}</span>
        <Link to="/quotes" className="action-chip">{t('quote.title')}</Link>
      </div>

      {invoices.length > 0 && (
        <KpiStrip
          items={(() => {
            const total = invoices.reduce((s, i) => s + invTotal(i), 0);
            const paid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + invTotal(i), 0);
            const pending = invoices.filter(i => i.status === 'sent').reduce((s, i) => s + invTotal(i), 0);
            const drafts = invoices.filter(i => i.status === 'draft').length;
            return [
              { label: t('invoices.kpi.total'), value: `${formatNumber(total / 1000, getLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}K`, color: 'brand' },
              { label: t('invoices.kpi.paid'), value: `${formatNumber(paid / 1000, getLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}K`, color: 'success' },
              { label: t('invoices.kpi.pending'), value: `${formatNumber(pending / 1000, getLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}K`, color: 'warning' },
              { label: t('invoices.kpi.drafts'), value: drafts, color: 'neutral' },
            ] satisfies KpiItem[];
          })()}
        />
      )}

      {isLoading && (
        <div className="flex gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20 flex-1 rounded-2xl" />)}
        </div>
      )}

      {!isLoading && invoices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] mr-1">{t('invoices.filter.label')}</span>
          {([
            { key: 'all' as const, label: t('invoices.filter.all'), count: invoices.length },
            { key: 'paid' as const, label: t('invoices.filter.paid'), count: invoices.filter(i => i.status === 'paid').length },
            { key: 'sent' as const, label: t('invoices.filter.pending'), count: invoices.filter(i => i.status === 'sent').length },
            { key: 'draft' as const, label: t('invoices.filter.drafts'), count: invoices.filter(i => i.status === 'draft').length },
            { key: 'cancelled' as const, label: t('invoices.filter.cancelled'), count: invoices.filter(i => i.status === 'cancelled').length },
          ]).map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setStatusFilter(p.key)}
              className={`action-chip ${statusFilter === p.key ? 'action-chip--accent' : ''}`}
            >
              <span>{p.label}</span>
              <span className="text-[10px] font-bold opacity-70">{p.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Erreur de chargement inline — role="alert" + retry (additif §audit). */}
      {fetchError && !isLoading && (
        <div
          role="alert"
          className="mb-4 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[var(--danger-soft)] px-4 py-3 flex items-center justify-between gap-3"
        >
          <span className="text-[13px] text-[var(--danger)]">{fetchError}</span>
          <Button size="sm" variant="secondary" onClick={() => { setIsLoading(true); void fetchInvoices(); }}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      <Card className="overflow-hidden p-0" aria-busy={isLoading}>
        {isLoading ? (
          <div className="overflow-x-auto">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
              {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-3 w-20 rounded" />)}
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-3 w-24 rounded" />
                  <Skeleton className="h-3 w-32 rounded" />
                  <Skeleton className="h-3 w-40 rounded flex-1" />
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-7 w-16 rounded ml-auto" />
                </div>
              ))}
            </div>
          </div>
        ) : invoices.length === 0 ? (
          <EmptyState
            variant="first-time"
            icon={<span className="text-5xl">💳</span>}
            title={t('invoices.empty.title')}
            description={t('invoices.empty.desc')}
            action={<Button variant="primary" onClick={() => setShowAdd(true)}>{t('invoices.empty.action')}</Button>}
          />
        ) : (
          <div className="table-premium-container overflow-x-auto">
            <table className="table-premium print-data-table">
              <thead>
                <tr>
                  <th className="col-frozen" style={{ minWidth: 200 }}>{t('invoices.table.number')}</th>
                  <th className="col-frozen" style={{ left: 200, minWidth: 180 }}>{t('invoices.table.client')}</th>
                  <th className="text-left">{t('invoices.table.desc')}</th>
                  <th className="text-right">{t('invoices.table.amount')}</th>
                  <th className="text-left">{t('invoices.table.date')}</th>
                  <th className="text-left">{t('invoices.table.status')}</th>
                  <th data-print-hide style={{ width: 200 }} className="text-right">{t('invoices.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.filter(inv => statusFilter === 'all' ? true : inv.status === statusFilter).map((inv, idx) => {
                  const isExpanded = expandedRows.has(inv.id);
                  const hasBreakdown = inv.subtotal != null && inv.tax_tps != null && inv.tax_tvq != null;
                  return (
                    <Fragment key={inv.id}>
                      <tr className="list-item-enter" style={{ animationDelay: `${idx * 28}ms` }}>
                        <td className="col-frozen">
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              className={`table-expand-trigger ${isExpanded ? 'is-expanded' : ''}`}
                              onClick={() => toggleExpand(inv.id)}
                              aria-label={isExpanded ? t('table.expand.collapse') : t('table.expand.expand')}
                            >
                              <ChevronRight size={14} />
                            </button>
                            <FileText size={14} className="text-[var(--text-muted)] shrink-0" />
                            <span className="font-mono text-[12px] font-semibold text-[var(--primary)] truncate" title={inv.invoice_number || inv.id}>
                              {inv.invoice_number || `${inv.id.substring(0, 10)}…`}
                            </span>
                          </div>
                        </td>
                        <td className="col-frozen" style={{ left: 200 }}>
                          <div className="flex items-center gap-2 min-w-0">
                            <User size={12} className="text-[var(--text-muted)] shrink-0" />
                            <span className="text-[12px] font-medium truncate">
                              {inv.lead_name || inv.client_id || '—'}
                            </span>
                          </div>
                        </td>
                        <td className="text-[12px] text-[var(--text-primary)] max-w-[280px]">
                          <span className="line-clamp-1 block" title={inv.description || ''}>
                            {inv.description || <span className="text-[var(--text-muted)] italic">{t('invoices.row.no_description')}</span>}
                          </span>
                        </td>
                        <td className="text-right font-bold t-mono-num text-[13px]">
                          {formatCurrency(invTotal(inv), getLocale(), inv.currency || 'CAD')}
                        </td>
                        <td className="text-[12px] text-[var(--text-secondary)]">
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={11} className="text-[var(--text-muted)]" />
                            {formatDate(inv.created_at, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        </td>
                        <td>{getStatusBadge(inv.status)}</td>
                        <td data-print-hide className="text-right">
                          <div className="inline-flex items-center gap-3 justify-end">
                            <button
                              onClick={() => setDetailId(inv.id)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--primary)] hover:underline cursor-pointer"
                              aria-label={t('invoices.action.view_aria')}
                            >
                              <Eye size={11} /> {t('invoices.action.view')}
                            </button>
                            {inv.status === 'draft' && (
                              <button
                                onClick={() => void updateStatus(inv.id, 'sent')}
                                className="text-[11px] font-semibold text-[var(--primary)] hover:underline cursor-pointer"
                              >
                                {t('invoices.action.send')}
                              </button>
                            )}
                            <button
                              onClick={() => void handleExportInvoicePdf(inv.id)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--primary)] hover:underline cursor-pointer"
                              aria-label={t('invoices.action.export_aria')}
                            >
                              <Download size={11} /> {t('invoices.action.export')}
                            </button>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={7} style={{ padding: 0, border: 'none' }}>
                          <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
                            <div className="table-expand-inner">
                              <div className="table-expand-detail">
                                <div className="table-expand-detail-section" style={{ flex: '1 1 260px' }}>
                                  <span className="table-expand-detail-label">{t('invoices.expand.description_label')}</span>
                                  <span className="table-expand-detail-value text-[12px] leading-relaxed">
                                    {inv.description || t('invoices.expand.description_empty')}
                                  </span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('invoice.total')}</span>
                                  <div className="flex flex-col gap-1 text-[12px]">
                                    {hasBreakdown ? (
                                      <>
                                        {/* Champs STOCKÉS serveur (§6.C) — AUCUN recalcul front */}
                                        <div className="flex justify-between gap-4">
                                          <span className="text-[var(--text-muted)]">{t('invoice.subtotal')}</span>
                                          <span className="t-mono-num">
                                            {formatCurrency(inv.subtotal as number, getLocale(), inv.currency || 'CAD')}
                                          </span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                          <span className="text-[var(--text-muted)]">{t('invoice.tax_tps')}</span>
                                          <span className="t-mono-num">
                                            {formatCurrency(inv.tax_tps as number, getLocale(), inv.currency || 'CAD')}
                                          </span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                          <span className="text-[var(--text-muted)]">{t('invoice.tax_tvq')}</span>
                                          <span className="t-mono-num">
                                            {formatCurrency(inv.tax_tvq as number, getLocale(), inv.currency || 'CAD')}
                                          </span>
                                        </div>
                                      </>
                                    ) : (
                                      <div className="text-[var(--text-muted)] italic">
                                        {t('invoices.expand.no_tax_breakdown')}
                                      </div>
                                    )}
                                    <div className="flex justify-between gap-4 pt-1 border-t border-[var(--border-subtle)]">
                                      <span className="font-semibold">{t('invoice.total')}</span>
                                      <span className="t-mono-num font-bold" style={{ color: 'var(--primary)' }}>
                                        {formatCurrency(invTotal(inv), getLocale(), inv.currency || 'CAD')}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('invoices.expand.payment_label')}</span>
                                  <span className="table-expand-detail-value text-[12px]">
                                    {inv.status === 'paid'
                                      ? t('invoices.status.paid')
                                      : t('invoice.payment_offline')}
                                  </span>
                                  {inv.status !== 'paid' && (
                                    <span className="text-[11px] text-[var(--text-muted)] mt-1 block">
                                      {t('invoice.payment_instructions')}
                                    </span>
                                  )}
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('invoices.expand.lead_label')}</span>
                                  <span className="table-expand-detail-value text-[12px]">
                                    {inv.lead_name || <span className="text-[var(--text-muted)]">{t('invoices.expand.lead_empty')}</span>}
                                  </span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('invoices.expand.full_id')}</span>
                                  <span className="table-expand-detail-value text-[11px] font-mono break-all">
                                    {inv.id}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showAdd} onOpenChange={(v) => { if (!v) { setShowAdd(false); } }} title={t('invoices.modal.title')}>
        <div className="space-y-4">
          {/* Sélecteur client/lead réel — REMPLACE default_client_for_demo */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={t('invoices.table.client')}
              value={targetKind}
              onChange={e => { setTargetKind(e.target.value as 'client' | 'lead'); setTargetId(''); }}
            >
              <option value="client">{t('invoices.table.client')}</option>
              <option value="lead">{t('quote.target.lead')}</option>
            </Select>
            <Select
              label={t('quote.target.recipient')}
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
            >
              <option value="">—</option>
              {(targetKind === 'client' ? clients : leads).map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('invoices.modal.desc')}</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={t('invoices.modal.desc_placeholder')} />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('invoice.due_date')}</label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>

          {/* Lignes d'articles — total ligne calculé pour AFFICHAGE seul (§6.C : serveur recalcule) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">{t('invoice.items.title')}</label>
              <button
                type="button"
                onClick={() => setRows(r => [...r, blankRow()])}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--primary)] hover:underline"
              >
                <Plus size={13} /> {t('invoice.items.add')}
              </button>
            </div>
            <div className="space-y-2">
              {rows.map((row, i) => {
                const lineTotal = (Number(row.qty) || 0) * (Number(row.unit_price) || 0);
                return (
                  <div key={i} className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        placeholder={t('invoice.items.label')}
                        value={row.label}
                        onChange={e => setRows(r => r.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                      />
                    </div>
                    <div className="w-20">
                      <Input
                        type="number" min="0" step="0.01"
                        placeholder={t('invoice.items.qty')}
                        value={row.qty}
                        onChange={e => setRows(r => r.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                      />
                    </div>
                    <div className="w-28">
                      <Input
                        type="number" min="0" step="0.01"
                        placeholder={t('invoice.items.unit_price')}
                        value={row.unit_price}
                        onChange={e => setRows(r => r.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))}
                      />
                    </div>
                    <div className="w-24 text-right text-[12px] t-mono-num pb-2.5 text-[var(--text-secondary)]">
                      {formatCurrency(lineTotal, getLocale(), 'CAD')}
                    </div>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRows(r => r.filter((_, j) => j !== i))}
                        className="pb-2 text-[var(--text-muted)] hover:text-[var(--danger)]"
                        aria-label={t('invoice.items.remove')}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end mt-3 text-[12px] text-[var(--text-muted)]">
              {t('invoice.subtotal')} :&nbsp;
              <span className="t-mono-num font-semibold text-[var(--text-secondary)]">
                {formatCurrency(previewSubtotal, getLocale(), 'CAD')}
              </span>
              &nbsp;· {t('invoice.tax_tps')} + {t('invoice.tax_tvq')} calculées au serveur
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] mt-6">
            <Button variant="secondary" onClick={() => setShowAdd(false)} disabled={submitting}>{t('invoices.modal.cancel')}</Button>
            <Button onClick={() => void handleCreate()} disabled={submitting}>{t('invoices.modal.generate')}</Button>
          </div>
        </div>
      </Modal>

      {/* Vue détail — fetch getInvoice(id) à la demande (lignes d'articles + taxes) */}
      <InvoiceDetailModal invoiceId={detailId} onClose={() => setDetailId(null)} />
      </div>
    </AppLayout>
  );
}
