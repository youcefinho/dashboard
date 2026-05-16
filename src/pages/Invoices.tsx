// ── Invoices — Gestion de la facturation ──────────────────
// Sprint 31 vague 31-2A — Upgrade row-premium → table-premium (frozen 2 cols + expand inline)

import { useState, useEffect, useRef, Fragment } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Skeleton, EmptyState, PageHero, KpiStrip, type KpiItem, Tag } from '@/components/ui';
// Sprint 44 M3.3 — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { Modal } from '@/components/ui/Modal';
import { ChevronRight, FileText, CreditCard, User, Calendar, Download } from 'lucide-react';
import { triggerPdfExport } from '@/lib/pdfExport';
// Sprint 48 M3 — Intl formatters (display only — TPS/TVQ math préservé verbatim)
import { formatCurrency, formatNumber } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';

interface Invoice {
  id: string;
  client_id: string;
  lead_id: string | null;
  lead_name: string | null;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'cancelled';
  payment_url: string | null;
  description: string | null;
  created_at: string;
}

import { getInvoices as fetchInvoicesApi, createInvoice, updateInvoiceStatus } from '@/lib/api';

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  
  // New invoice state
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  // Sprint 42 M2 — Filtre statut (Tag chips)
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'sent' | 'draft' | 'cancelled'>('all');
  // Sprint 31 vague 31-2A — expand row inline detail
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpandedRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const fetchInvoices = async () => {
    try {
      const res = await fetchInvoicesApi();
      if (res.data) setInvoices(res.data as unknown as Invoice[]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchInvoices();
  }, []);

  const handleCreate = async () => {
    if (!amount || isNaN(Number(amount))) return;
    try {
      const res = await createInvoice({
        amount: Number(amount),
        description,
        client_id: 'default_client_for_demo'
      });
      if (!res.error) {
        setShowAdd(false);
        setAmount('');
        setDescription('');
        void fetchInvoices();
      }
    } catch (err) {
      console.error(err);
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

  // Sprint 42 M2 — Stripe-clean : <Tag> primitive (plus de classes Tailwind inline custom)
  const getStatusBadge = (status: Invoice['status']) => {
    const map: Record<Invoice['status'], { label: string; variant: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
      draft: { label: 'Brouillon', variant: 'neutral' },
      sent: { label: 'En attente', variant: 'warning' },
      paid: { label: 'Payée', variant: 'success' },
      cancelled: { label: 'Annulée', variant: 'danger' },
    };
    const cfg = map[status] || map.draft;
    return <Tag dot size="xs" variant={cfg.variant}>{cfg.label}</Tag>;
  };

  // ── Sprint 34 vague 34-1A — Export PDF premium (cover + footer brand) ──
  const handleExportPdf = () => triggerPdfExport('invoice');

  const totalAmount = invoices.reduce((s, i) => s + i.amount, 0);
  const todayLabel = new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });

  // Sprint 44 M3.3 — Pull-to-refresh
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await fetchInvoices(); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title="Factures & Paiements">
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      {/* Sprint 34 wave 34-1A — PDF cover page premium (cachée en screen, révélée en pdf-mode) */}
      <div className="pdf-cover-page" aria-hidden="true">
        <div className="pdf-cover-accent-bar" />
        <div className="pdf-cover-logo">Intralys</div>
        <div className="pdf-cover-tagline">CRM tout-en-un pour PMEs</div>
        <h1 className="pdf-cover-title">Rapport de facturation</h1>
        <p className="pdf-cover-subtitle">
          Synthèse complète des factures émises, paiements reçus et en attente sur la période courante.
        </p>
        <div className="pdf-cover-meta">
          <div className="pdf-cover-meta-item">
            <span className="label">Généré le</span>
            <span className="value">{todayLabel}</span>
          </div>
          <div className="pdf-cover-meta-item">
            <span className="label">Référence</span>
            <span className="value">INV-{new Date().getFullYear()}-{String(new Date().getMonth() + 1).padStart(2, '0')}</span>
          </div>
          <div className="pdf-cover-meta-item">
            <span className="label">Nombre de factures</span>
            <span className="value">{invoices.length}</span>
          </div>
          <div className="pdf-cover-meta-item">
            <span className="label">Total facturé</span>
            <span className="value">{totalAmount.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' })}</span>
          </div>
        </div>
      </div>

      <div className="print-page-header">
        <h1>Intralys CRM — Factures</h1>
        <div className="print-meta">
          {todayLabel} · intralys.com
        </div>
      </div>
      <PageHero
        meta="Workspace"
        title="Facturation"
        highlight="Facturation"
        description="Gérez vos paiements et encaissements via Stripe."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleExportPdf} className="gap-1.5" aria-label="Exporter les factures en PDF">
              <Download size={14} /> Exporter PDF
            </Button>
            <Button variant="premium" onClick={() => setShowAdd(true)}>+ Nouvelle facture</Button>
          </div>
        }
      />

      {/* KPI Strip — Sprint 23 wave 17 (unified GHL pattern) */}
      {invoices.length > 0 && (
        <KpiStrip
          items={(() => {
            const total = invoices.reduce((s, i) => s + i.amount, 0);
            const paid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
            const pending = invoices.filter(i => i.status === 'sent').reduce((s, i) => s + i.amount, 0);
            const drafts = invoices.filter(i => i.status === 'draft').length;
            return [
              { label: 'Total facturé', value: `${formatNumber(total / 1000, getLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}K`, color: 'brand' },
              { label: 'Payé', value: `${formatNumber(paid / 1000, getLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}K`, color: 'success' },
              { label: 'En attente', value: `${formatNumber(pending / 1000, getLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}K`, color: 'warning' },
              { label: 'Brouillons', value: drafts, color: 'neutral' },
            ] satisfies KpiItem[];
          })()}
        />
      )}

      {/* KPI strip skeleton pendant le load (avant que invoices.length > 0) */}
      {isLoading && (
        <div className="flex gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20 flex-1 rounded-2xl" />)}
        </div>
      )}

      {/* Sprint 42 M2 — Filtre statut Stripe-clean (action-chip + counts) */}
      {!isLoading && invoices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] mr-1">Filtrer</span>
          {([
            { key: 'all' as const, label: 'Toutes', count: invoices.length },
            { key: 'paid' as const, label: 'Payées', count: invoices.filter(i => i.status === 'paid').length },
            { key: 'sent' as const, label: 'En attente', count: invoices.filter(i => i.status === 'sent').length },
            { key: 'draft' as const, label: 'Brouillons', count: invoices.filter(i => i.status === 'draft').length },
            { key: 'cancelled' as const, label: 'Annulées', count: invoices.filter(i => i.status === 'cancelled').length },
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

      <Card className="overflow-hidden p-0">
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
            title="Aucune facture encore"
            description="Tu n'as pas encore émis de facture ou reçu de paiement. Crée ta première facture pour commencer."
            action={<Button variant="primary" onClick={() => setShowAdd(true)}>Créer ma première facture</Button>}
          />
        ) : (
          /* Sprint 31 vague 31-2A — Table premium (frozen 2 cols + expand inline line items) */
          <div className="table-premium-container overflow-x-auto">
            <table className="table-premium print-data-table">
              <thead>
                <tr>
                  <th className="col-frozen" style={{ minWidth: 200 }}>Numéro</th>
                  <th className="col-frozen" style={{ left: 200, minWidth: 180 }}>Client / Lead</th>
                  <th className="text-left">Description</th>
                  <th className="text-right">Montant</th>
                  <th className="text-left">Date</th>
                  <th className="text-left">Statut</th>
                  <th data-print-hide style={{ width: 160 }} className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.filter(inv => statusFilter === 'all' ? true : inv.status === statusFilter).map((inv, idx) => {
                  const isExpanded = expandedRows.has(inv.id);
                  return (
                    <Fragment key={inv.id}>
                      <tr className="list-item-enter" style={{ animationDelay: `${idx * 28}ms` }}>
                        <td className="col-frozen">
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              className={`table-expand-trigger ${isExpanded ? 'is-expanded' : ''}`}
                              onClick={() => toggleExpand(inv.id)}
                              aria-label={isExpanded ? 'Réduire les détails' : 'Afficher les détails'}
                            >
                              <ChevronRight size={14} />
                            </button>
                            <FileText size={14} className="text-[var(--text-muted)] shrink-0" />
                            <span className="font-mono text-[12px] font-semibold text-[var(--primary)] truncate" title={inv.id}>
                              {inv.id.substring(0, 10)}…
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
                            {inv.description || <span className="text-[var(--text-muted)] italic">Sans description</span>}
                          </span>
                        </td>
                        <td className="text-right font-bold t-mono-num text-[13px]">
                          {formatCurrency(inv.amount, getLocale(), inv.currency || 'CAD')}
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
                            {inv.status === 'draft' && (
                              <button
                                onClick={() => void updateStatus(inv.id, 'sent')}
                                className="text-[11px] font-semibold text-[var(--primary)] hover:underline cursor-pointer"
                              >
                                Envoyer
                              </button>
                            )}
                            {inv.status !== 'paid' && inv.payment_url && (
                              <a
                                href={inv.payment_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--info)] hover:underline cursor-pointer"
                              >
                                <CreditCard size={11} /> Lien
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={7} style={{ padding: 0, border: 'none' }}>
                          <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
                            <div className="table-expand-inner">
                              <div className="table-expand-detail">
                                <div className="table-expand-detail-section" style={{ flex: '1 1 260px' }}>
                                  <span className="table-expand-detail-label">Description complète</span>
                                  <span className="table-expand-detail-value text-[12px] leading-relaxed">
                                    {inv.description || 'Aucune description fournie.'}
                                  </span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">Montant détaillé</span>
                                  <div className="flex flex-col gap-1 text-[12px]">
                                    {/* ⚠️ TPS/TVQ MATH PRÉSERVÉE VERBATIM (14.975% = TPS 5% + TVQ 9.975%) — Sprint 48 M3.3 ne touche QUE le display */}
                                    <div className="flex justify-between gap-4">
                                      <span className="text-[var(--text-muted)]">Sous-total</span>
                                      <span className="t-mono-num">
                                        {formatCurrency(inv.amount / 1.14975, getLocale(), inv.currency || 'CAD')}
                                      </span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-[var(--text-muted)]">TPS + TVQ (14.975%)</span>
                                      <span className="t-mono-num">
                                        {formatCurrency(inv.amount - inv.amount / 1.14975, getLocale(), inv.currency || 'CAD')}
                                      </span>
                                    </div>
                                    <div className="flex justify-between gap-4 pt-1 border-t border-[var(--border-subtle)]">
                                      <span className="font-semibold">Total</span>
                                      <span className="t-mono-num font-bold" style={{ color: 'var(--primary)' }}>
                                        {formatCurrency(inv.amount, getLocale(), inv.currency || 'CAD')}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">Lead associé</span>
                                  <span className="table-expand-detail-value text-[12px]">
                                    {inv.lead_name || <span className="text-[var(--text-muted)]">Aucun lead</span>}
                                  </span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">Identifiant complet</span>
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

      <Modal open={showAdd} onOpenChange={() => setShowAdd(false)} title="Nouvelle facture (Lien de paiement)">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Montant (CAD)</label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Description (Optionnel)</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Frais de démarrage..." />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] mt-6">
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Annuler</Button>
            <Button onClick={() => void handleCreate()}>Générer le lien</Button>
          </div>
        </div>
      </Modal>
      </div>
    </AppLayout>
  );
}