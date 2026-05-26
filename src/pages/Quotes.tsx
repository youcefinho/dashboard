// ── Quotes / Devis — pièces pré-comptables (LOT FACTURATION-RÉELLE) ────────
// docs/LOT-INVOICE.md §6.H (Manager-C) : nouvelle page Devis.
//   - liste listQuotes / création createQuote / détail getQuote
//   - changement de statut updateQuote (draft→sent→accepted/declined/expired)
//   - acceptation acceptQuote (serveur crée la facture liée + option lead won)
//   - i18n via t('quote.*') / t('invoice.*') — clés figées §6.G (aucune créée)
//   - taxes = champs STOCKÉS serveur (§6.C), payment honnête (§6.E)
// Page séparée (route /quotes) — calque EXACT du pattern invoicesRoute :
//   chaque entité de domaine = sa propre route protégée LazyGuard
//   (cf. App.tsx invoicesRoute/reviewsRoute/documentsRoute). Cycle de vie
//   distinct des factures ⇒ découplage propre plutôt qu'un onglet couplé.

import { useState, useEffect, useRef, Fragment } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Select, Skeleton, EmptyState, PageHero, Tag } from '@/components/ui';
import { useToast, useConfirm } from '@/components/ui';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { Modal } from '@/components/ui/Modal';
import { ChevronRight, FileText, User, Calendar, Plus, Trash2, CheckCircle2, PenTool, Link2, Search, Package } from 'lucide-react';
import { formatCurrency } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import { getLocale, t } from '@/lib/i18n';
import {
  listQuotes,
  createQuote,
  updateQuote,
  acceptQuote,
  sendQuoteForSignature,
  getClients,
  getLeads,
  searchCatalogItems,
  type Quote,
  type QuoteStatus,
  type CatalogItem,
} from '@/lib/api';

interface LineRow { label: string; qty: string; unit_price: string }
const blankRow = (): LineRow => ({ label: '', qty: '1', unit_price: '' });

const STATUS_VARIANT: Record<QuoteStatus, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  draft: 'neutral',
  sent: 'warning',
  accepted: 'success',
  declined: 'danger',
  expired: 'info',
};

export function QuotesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Fetch error inline (role="alert" + retry) — additif §audit.
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Liens publics de signature retournés par sendQuoteForSignature (sign_url),
  // mémorisés localement par devis pour affichage immédiat (best-effort).
  const [signUrls, setSignUrls] = useState<Record<string, string>>({});

  const [description, setDescription] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [rows, setRows] = useState<LineRow[]>([blankRow()]);
  // ── Sprint 18 CATALOGUE DE SERVICES — sélecteur catalogue (Manager-C) ──
  // Recherche searchCatalogItems(q) ; à la sélection, pré-remplit une ligne
  // { label, qty:'1', unit_price }. Additif : la saisie libre reste intacte,
  // le contrat createQuote ({label,qty,unit_price}) est INCHANGÉ.
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogResults, setCatalogResults] = useState<CatalogItem[]>([]);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [targetKind, setTargetKind] = useState<'client' | 'lead'>('client');
  const [targetId, setTargetId] = useState('');
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [leads, setLeads] = useState<Array<{ id: string; name: string }>>([]);

  const toggleExpand = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const fetchQuotes = async () => {
    setFetchError(null);
    try {
      const res = await listQuotes();
      if (res.data) setQuotes(res.data);
      else if (res.error) setFetchError(res.error);
    } catch (err) {
      console.error(err);
      setFetchError(t('common.error.load_failed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void fetchQuotes(); }, []);

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
    setValidUntil('');
    setRows([blankRow()]);
    setTargetKind('client');
    setTargetId('');
    setCatalogQuery('');
    setCatalogResults([]);
    setCatalogOpen(false);
  };

  // ── Sprint 18 — recherche catalogue débouncée (best-effort, ne casse rien) ──
  useEffect(() => {
    if (!showAdd) return;
    const q = catalogQuery.trim();
    if (q.length < 2) { setCatalogResults([]); return; }
    let cancelled = false;
    setCatalogSearching(true);
    const id = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await searchCatalogItems(q);
          if (!cancelled && res.data) setCatalogResults(res.data);
        } catch (err) {
          console.error(err);
        } finally {
          if (!cancelled) setCatalogSearching(false);
        }
      })();
    }, 280);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [catalogQuery, showAdd]);

  // À la sélection : pré-remplit une ligne { label, qty:'1', unit_price }. Si la
  // dernière ligne est encore vierge (blankRow), on la remplit ; sinon on en
  // ajoute une nouvelle. Le contrat createQuote reste { label, qty, unit_price }.
  const handlePickCatalogItem = (item: CatalogItem) => {
    const filled: LineRow = {
      label: item.name,
      qty: '1',
      unit_price: String(item.unit_price ?? ''),
    };
    setRows(r => {
      const last = r[r.length - 1];
      const lastBlank = last && !last.label.trim() && !last.unit_price.trim();
      if (lastBlank) return r.map((x, j) => (j === r.length - 1 ? filled : x));
      return [...r, filled];
    });
    setCatalogQuery('');
    setCatalogResults([]);
    setCatalogOpen(false);
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
      const res = await createQuote({
        description: description || undefined,
        valid_until: validUntil || undefined,
        ...(targetId ? (targetKind === 'client' ? { client_id: targetId } : { lead_id: targetId }) : {}),
        items,
      });
      // §6.A : pas de champ `code` — discrimine sur data / texte error
      if (res.data) {
        setShowAdd(false);
        resetForm();
        void fetchQuotes();
      } else {
        toast.error(res.error || t('quote.error.create'));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('quote.error.create'));
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (id: string, status: QuoteStatus) => {
    setBusyId(id);
    try {
      const res = await updateQuote(id, { status });
      if (res.data) void fetchQuotes();
      else toast.error(res.error || t('quote.error.create'));
    } catch (err) {
      console.error(err);
    } finally {
      setBusyId(null);
    }
  };

  const handleAccept = async (q: Quote) => {
    const ok = await confirm({
      title: t('quote.accept'),
      description: t('quote.accept_confirm'),
      confirmLabel: t('quote.accept'),
    });
    if (!ok) return;
    const markWon = q.lead_id
      ? await confirm({ title: t('quote.mark_lead_won'), description: t('quote.mark_lead_won'), confirmLabel: t('quote.mark_lead_won') })
      : false;
    setBusyId(q.id);
    try {
      const res = await acceptQuote(q.id, { mark_lead_won: markWon });
      if (res.data) {
        toast.success(t('quote.converted_to_invoice'));
        void fetchQuotes();
      } else {
        toast.error(res.error || t('quote.error.accept'));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('quote.error.accept'));
    } finally {
      setBusyId(null);
    }
  };

  // ── Sprint 17 PROPOSALS E-SIGN — envoyer un devis pour signature ──
  // POST /quotes/:id/send-for-signature (helper FIGÉ Phase A). Au succès :
  // affiche le lien public (sign_url) + toast, met à jour le statut localement
  // ('sent') + document_id. Best-effort — pas de crash, fonctions existantes
  // (accept→facture, set sent) conservées.
  const handleSendForSignature = async (q: Quote) => {
    setBusyId(q.id);
    try {
      const res = await sendQuoteForSignature(q.id);
      // §6.A : pas de champ `code` — discrimine sur data / texte error.
      if (res.data && res.data.document_id) {
        setSignUrls(prev => ({ ...prev, [q.id]: res.data!.sign_url }));
        // Maj locale : le devis passe en 'sent' (CHECK seq 82) + lien document.
        setQuotes(prev => prev.map(x =>
          x.id === q.id
            ? { ...x, status: 'sent', document_id: res.data!.document_id }
            : x,
        ));
        toast.success(t('proposal.sent_for_sign'));
      } else {
        toast.error(res.error || t('quote.error.create'));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('quote.error.create'));
    } finally {
      setBusyId(null);
    }
  };

  const statusLabel = (s: QuoteStatus) => t(`quote.status.${s}`);
  const qTotal = (q: Quote) => q.total ?? 0;
  // Statut de signature dérivé (best-effort) : le helper listQuotes ne renvoie
  // PAS le statut du document, seulement quote.document_id + quote.status.
  // On déduit donc : accepted = signé, declined = refusé, sinon (avec
  // document_id) = envoyé pour signature.
  const signLabel = (q: Quote): string | null => {
    if (!q.document_id) return null;
    if (q.status === 'accepted') return t('proposal.signed');
    if (q.status === 'declined') return t('proposal.declined');
    return t('proposal.sent_for_sign');
  };

  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await fetchQuotes(); }, { scrollParent: scrollParentRef });

  const previewSubtotal = rows.reduce((s, r) => {
    const q = Number(r.qty), p = Number(r.unit_price);
    return s + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
  }, 0);

  return (
    <AppLayout title="Devis & Soumissions">
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />

      <PageHero
        meta="Workspace"
        title={t('quote.title')}
        highlight={t('quote.title')}
        description={t('quote.title')}
        actions={
          <Button variant="premium" onClick={() => setShowAdd(true)}>{t('quote.new')}</Button>
        }
      />

      {/* Navigation Factures / Devis */}
      <div className="flex items-center gap-2 mb-4">
        <Link to="/invoices" className="action-chip">{t('invoices.hero.title')}</Link>
        <span className="action-chip action-chip--accent" aria-current="page">{t('quote.title')}</span>
      </div>

      {/* Erreur de chargement inline — role="alert" + retry (additif). */}
      {fetchError && !isLoading && (
        <div
          role="alert"
          className="mb-4 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[var(--danger-soft)] px-4 py-3 flex items-center justify-between gap-3"
        >
          <span className="text-[13px] text-[var(--danger)]">{fetchError}</span>
          <Button size="sm" variant="secondary" onClick={() => { setIsLoading(true); void fetchQuotes(); }}>
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
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-3 w-24 rounded" />
                  <Skeleton className="h-3 w-32 rounded" />
                  <Skeleton className="h-3 w-40 rounded flex-1" />
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ) : quotes.length === 0 ? (
          <EmptyState
            variant="first-time"
            icon={<span className="text-5xl">📄</span>}
            title={t('quote.empty')}
            description={t('quote.empty')}
            action={<Button variant="primary" onClick={() => setShowAdd(true)}>{t('quote.new')}</Button>}
          />
        ) : (
          <div className="table-premium-container overflow-x-auto">
            <table className="table-premium">
              <thead>
                <tr>
                  <th className="col-frozen" style={{ minWidth: 200 }}>{t('quote.number')}</th>
                  <th className="col-frozen" style={{ left: 200, minWidth: 180 }}>{t('invoices.table.client')}</th>
                  <th className="text-right">{t('invoice.total')}</th>
                  <th className="text-left">{t('quote.valid_until')}</th>
                  <th className="text-left">{t('invoices.table.status')}</th>
                  <th style={{ width: 220 }} className="text-right">{t('invoices.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q, idx) => {
                  const isExpanded = expanded.has(q.id);
                  const hasBreakdown = q.subtotal != null && q.tax_tps != null && q.tax_tvq != null;
                  const canAccept = q.status === 'draft' || q.status === 'sent';
                  // Envoyable pour signature : devis draft/sent (§6.H Manager-C).
                  const canSendForSign = q.status === 'draft' || q.status === 'sent';
                  const signStatusLabel = signLabel(q);
                  const signUrl = signUrls[q.id];
                  return (
                    <Fragment key={q.id}>
                      <tr className="list-item-enter" style={{ animationDelay: `${idx * 28}ms` }}>
                        <td className="col-frozen">
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              className={`table-expand-trigger ${isExpanded ? 'is-expanded' : ''}`}
                              onClick={() => toggleExpand(q.id)}
                              aria-label={isExpanded ? t('table.expand.collapse') : t('table.expand.expand')}
                            >
                              <ChevronRight size={14} />
                            </button>
                            <FileText size={14} className="text-[var(--text-muted)] shrink-0" />
                            <span className="font-mono text-[12px] font-semibold text-[var(--primary)] truncate" title={q.quote_number || q.id}>
                              {q.quote_number || `${q.id.substring(0, 10)}…`}
                            </span>
                          </div>
                        </td>
                        <td className="col-frozen" style={{ left: 200 }}>
                          <div className="flex items-center gap-2 min-w-0">
                            <User size={12} className="text-[var(--text-muted)] shrink-0" />
                            <span className="text-[12px] font-medium truncate">
                              {q.client_id || q.lead_id || '—'}
                            </span>
                          </div>
                        </td>
                        <td className="text-right font-bold t-mono-num text-[13px]">
                          {formatCurrency(qTotal(q), getLocale(), 'CAD')}
                        </td>
                        <td className="text-[12px] text-[var(--text-secondary)]">
                          {q.valid_until ? (
                            <span className="inline-flex items-center gap-1">
                              <Calendar size={11} className="text-[var(--text-muted)]" />
                              {formatDate(q.valid_until, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          ) : <span className="text-[var(--text-muted)]">—</span>}
                        </td>
                        <td>
                          <div className="flex flex-col items-start gap-1">
                            <Tag dot size="xs" variant={STATUS_VARIANT[q.status]}>{statusLabel(q.status)}</Tag>
                            {signStatusLabel && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-muted)]">
                                <PenTool size={9} /> {signStatusLabel}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-right">
                          <div className="inline-flex items-center gap-3 justify-end">
                            {q.status === 'draft' && (
                              <button
                                disabled={busyId === q.id}
                                onClick={() => void setStatus(q.id, 'sent')}
                                className="text-[11px] font-semibold text-[var(--primary)] hover:underline cursor-pointer disabled:opacity-50"
                              >
                                {t('quote.status.sent')}
                              </button>
                            )}
                            {canAccept && (
                              <button
                                disabled={busyId === q.id}
                                onClick={() => void handleAccept(q)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--success)] hover:underline cursor-pointer disabled:opacity-50"
                              >
                                <CheckCircle2 size={11} /> {t('quote.accept')}
                              </button>
                            )}
                            {canAccept && (
                              <button
                                disabled={busyId === q.id}
                                onClick={() => void setStatus(q.id, 'declined')}
                                className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--danger)] hover:underline cursor-pointer disabled:opacity-50"
                              >
                                {t('quote.decline')}
                              </button>
                            )}
                            {canSendForSign && (
                              <button
                                disabled={busyId === q.id}
                                onClick={() => void handleSendForSignature(q)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--primary)] hover:underline cursor-pointer disabled:opacity-50"
                              >
                                <PenTool size={11} /> {t('proposal.send_for_sign')}
                              </button>
                            )}
                            {q.status === 'accepted' && q.invoice_id && (
                              <Link
                                to="/invoices"
                                className="text-[11px] font-semibold text-[var(--info)] hover:underline"
                              >
                                {t('quote.converted_to_invoice')}
                              </Link>
                            )}
                          </div>
                          {signUrl && (
                            <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-[var(--text-muted)]">
                              <Link2 size={10} className="shrink-0" />
                              <a
                                href={signUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono truncate max-w-[200px] text-[var(--primary)] hover:underline"
                                title={signUrl}
                              >
                                {signUrl}
                              </a>
                            </div>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={6} style={{ padding: 0, border: 'none' }}>
                          <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
                            <div className="table-expand-inner">
                              <div className="table-expand-detail">
                                <div className="table-expand-detail-section" style={{ flex: '1 1 260px' }}>
                                  <span className="table-expand-detail-label">{t('quotes.detail.description')}</span>
                                  <span className="table-expand-detail-value text-[12px] leading-relaxed">
                                    {q.description || t('quotes.detail.description_empty')}
                                  </span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('invoice.total')}</span>
                                  <div className="flex flex-col gap-1 text-[12px]">
                                    {hasBreakdown ? (
                                      <>
                                        <div className="flex justify-between gap-4">
                                          <span className="text-[var(--text-muted)]">{t('invoice.subtotal')}</span>
                                          <span className="t-mono-num">{formatCurrency(q.subtotal as number, getLocale(), 'CAD')}</span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                          <span className="text-[var(--text-muted)]">{t('invoice.tax_tps')}</span>
                                          <span className="t-mono-num">{formatCurrency(q.tax_tps as number, getLocale(), 'CAD')}</span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                          <span className="text-[var(--text-muted)]">{t('invoice.tax_tvq')}</span>
                                          <span className="t-mono-num">{formatCurrency(q.tax_tvq as number, getLocale(), 'CAD')}</span>
                                        </div>
                                      </>
                                    ) : (
                                      <div className="text-[var(--text-muted)] italic">{t('quotes.detail.no_tax_breakdown')}</div>
                                    )}
                                    <div className="flex justify-between gap-4 pt-1 border-t border-[var(--border-subtle)]">
                                      <span className="font-semibold">{t('invoice.total')}</span>
                                      <span className="t-mono-num font-bold" style={{ color: 'var(--primary)' }}>
                                        {formatCurrency(qTotal(q), getLocale(), 'CAD')}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('quotes.detail.articles')}</span>
                                  <div className="flex flex-col gap-1 text-[12px]">
                                    {(q.items && q.items.length > 0) ? q.items.map(it => (
                                      <div key={it.id} className="flex justify-between gap-4">
                                        <span className="text-[var(--text-secondary)] truncate">{it.label} × {it.qty}</span>
                                        <span className="t-mono-num">{formatCurrency(it.line_total, getLocale(), 'CAD')}</span>
                                      </div>
                                    )) : <span className="text-[var(--text-muted)] italic">—</span>}
                                  </div>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('quotes.detail.full_id')}</span>
                                  <span className="table-expand-detail-value text-[11px] font-mono break-all">{q.id}</span>
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

      <Modal open={showAdd} onOpenChange={(v) => { if (!v) { setShowAdd(false); } }} title={t('quote.new')}>
        <div className="space-y-4">
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
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={t('quote.modal.desc_placeholder')} />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('quote.valid_until')}</label>
            <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">{t('quote.items.title')}</label>
              <div className="inline-flex items-center gap-3">
                {/* ── Sprint 18 CATALOGUE — sélecteur : pré-remplit une ligne ── */}
                <button
                  type="button"
                  onClick={() => setCatalogOpen(o => !o)}
                  aria-expanded={catalogOpen}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--primary)] hover:underline"
                >
                  <Package size={13} /> {t('catalog.select')}
                </button>
                <button
                  type="button"
                  onClick={() => setRows(r => [...r, blankRow()])}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--primary)] hover:underline"
                >
                  <Plus size={13} /> {t('quote.items.add')}
                </button>
              </div>
            </div>

            {/* Panneau de recherche catalogue (additif, saisie libre préservée) */}
            {catalogOpen && (
              <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5">
                <Input
                  leftIcon={<Search size={14} />}
                  placeholder={t('catalog.search')}
                  value={catalogQuery}
                  onChange={e => setCatalogQuery(e.target.value)}
                  autoFocus
                />
                <div className="mt-2 max-h-48 overflow-y-auto">
                  {catalogSearching ? (
                    <div className="px-2 py-2 text-[12px] text-[var(--text-muted)]">…</div>
                  ) : catalogQuery.trim().length < 2 ? (
                    <div className="px-2 py-2 text-[11px] text-[var(--text-muted)]">{t('catalog.search')}</div>
                  ) : catalogResults.length === 0 ? (
                    <div className="px-2 py-2 text-[12px] text-[var(--text-muted)] italic">{t('catalog.empty')}</div>
                  ) : (
                    <div className="flex flex-col">
                      {catalogResults.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handlePickCatalogItem(item)}
                          className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-md text-left hover:bg-[var(--bg-hover)] cursor-pointer"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Package size={12} className="text-[var(--text-muted)] shrink-0" />
                            <span className="text-[12px] font-medium truncate">{item.name}</span>
                          </span>
                          <span className="t-mono-num text-[12px] text-[var(--text-secondary)] shrink-0">
                            {formatCurrency(item.unit_price || 0, getLocale(), item.currency || 'CAD')}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
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
            <Button onClick={() => void handleCreate()} disabled={submitting}>{t('quote.new')}</Button>
          </div>
        </div>
      </Modal>
      </div>
    </AppLayout>
  );
}
