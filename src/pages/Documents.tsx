// Sprint 31 vague 31-2A — Table premium (frozen first col + expand row inline)
import { useState, useEffect, useRef, Fragment } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Skeleton, EmptyState, useToast, PageHero, KpiStrip, Icon, type KpiItem, Tag } from '@/components/ui';
// Sprint 44 M3.3 — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { Input } from '@/components/ui/Input';
import { getDocuments, createDocument, sendDocument, getDocumentTemplates, sendSigningSms, apiFetch, type Document, type DocumentTemplate, getLeads } from '@/lib/api';
import { FileSignature, Plus, Mail, Eye, CheckCircle, Clock, MessageSquare, FileText, FileCheck, Files, Filter, ChevronRight, User } from 'lucide-react';
import { t } from '@/lib/i18n';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return t('documents.time.today');
  if (days === 1) return t('documents.time.yesterday');
  const prefix = t('documents.time.days_ago_prefix').trim();
  const suffix = t('documents.time.days_ago_suffix').trim();
  return prefix ? `${prefix} ${days} ${suffix}` : `${days} ${suffix}`;
}

type StatusFilter = 'all' | 'signed' | 'sent' | 'draft';

export function DocumentsPage() {
  const { success, error: toastError, warning } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedLead, setSelectedLead] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loadError, setLoadError] = useState<string | null>(null);
  // Sprint 31 vague 31-2A — expand row inline detail
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpandedRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [docsRes, tplsRes, leadsRes] = await Promise.all([
        getDocuments(),
        getDocumentTemplates(),
        getLeads()
      ]);
      setDocuments(docsRes.data || []);
      setTemplates(tplsRes.data || []);
      setLeads(leadsRes.data || []);
      const firstError = docsRes.error || tplsRes.error || leadsRes.error;
      if (!docsRes.data && firstError) setLoadError(firstError);
    } catch (e) {
      console.error(e);
      setLoadError(t('documents.error.load'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleCreateAndSend = async () => {
    if (!selectedTemplate || !selectedLead || !docTitle) return;
    try {
      // 1. Créer le document
      const docRes = await createDocument({
        template_id: selectedTemplate,
        lead_id: selectedLead,
        title: docTitle
      });
      
      if (docRes.data?.id) {
        // 2. L'envoyer
        await sendDocument(docRes.data.id);
        setIsCreating(false);
        setDocTitle('');
        setSelectedLead('');
        setSelectedTemplate('');
        void loadData();
      }
    } catch (e) {
      console.error(e);
      toastError(t('documents.error.create_send'));
    }
    setIsCreating(false);
  };

  const [isGeneratingOaciq, setIsGeneratingOaciq] = useState(false);
  const handleGenerateOaciq = async () => {
    if (!selectedLead) {
      warning(t('documents.warning.lead_required'));
      return;
    }
    setIsGeneratingOaciq(true);
    try {
      const res = await apiFetch<any>('/documents/generate-oaciq', {
        method: 'POST',
        body: JSON.stringify({ lead_id: selectedLead })
      });
      if (res.data?.id) {
        success(t('documents.oaciq.generated'));
        setIsCreating(false);
        setSelectedLead('');
        void loadData();
      }
    } catch (e) {
      console.error(e);
      toastError(t('documents.error.oaciq'));
    }
    setIsGeneratingOaciq(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'signed': return <Tag dot variant="success" size="xs" leftIcon={<CheckCircle size={10} />}>{t('documents.status.signed')}</Tag>;
      case 'viewed': return <Tag dot variant="warning" size="xs" leftIcon={<Eye size={10} />}>{t('documents.status.viewed')}</Tag>;
      case 'sent':   return <Tag dot variant="brand" size="xs" leftIcon={<Mail size={10} />}>{t('documents.status.sent')}</Tag>;
      case 'expired': return <Tag dot variant="danger" size="xs">{t('documents.status.expired')}</Tag>;
      default: return <Tag dot variant="neutral" size="xs" leftIcon={<Clock size={10} />}>{t('documents.status.draft')}</Tag>;
    }
  };

  // KPI stats — Sprint 23 wave 27
  const signedCount = documents.filter(d => d.status === 'signed').length;
  const pendingCount = documents.filter(d => d.status === 'sent' || d.status === 'viewed').length;
  const kpiItems: KpiItem[] = [
    { label: t('documents.kpi.total'), value: documents.length, icon: <FileText size={11} />, color: 'brand' },
    { label: t('documents.kpi.signed'), value: signedCount, icon: <FileCheck size={11} />, color: 'success' },
    { label: t('documents.kpi.pending'), value: pendingCount, icon: <Clock size={11} />, color: 'warning' },
    { label: t('documents.kpi.templates'), value: templates.length, icon: <Files size={11} />, color: 'info' },
  ];

  const filteredDocs = documents.filter(d => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'sent') return d.status === 'sent' || d.status === 'viewed';
    return d.status === statusFilter;
  });

  const filterPills: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: t('documents.filter.all'), count: documents.length },
    { key: 'signed', label: t('documents.filter.signed'), count: signedCount },
    { key: 'sent', label: t('documents.filter.pending'), count: pendingCount },
    { key: 'draft', label: t('documents.filter.drafts'), count: documents.filter(d => d.status === 'draft').length },
  ];

  // Sprint 44 M3.3 — Pull-to-refresh
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await loadData(); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title={t('documents.page.title')}>
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <PageHero
        meta="Insights"
        title={t('documents.hero.title')}
        highlight={t('documents.hero.title')}
        description={t('documents.hero.description')}
        actions={!isCreating && (
          <Button variant="premium" onClick={() => setIsCreating(true)} leftIcon={<Icon as={Plus} size="sm" />}>
            {t('documents.action.send')}
          </Button>
        )}
      />

      <KpiStrip items={kpiItems} />

      {documents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] mr-1 flex items-center gap-1">
            <Filter size={11} /> {t('documents.filter.label')}
          </span>
          {/* Sprint 42 M2 — Stripe-clean : action-chip primitive (plus de gradient brand inline) */}
          {filterPills.map(p => (
            <button
              key={p.key}
              onClick={() => setStatusFilter(p.key)}
              className={`action-chip ${statusFilter === p.key ? 'action-chip--accent' : ''}`}
            >
              <span>{p.label}</span>
              <span className="text-[10px] font-bold opacity-70">{p.count}</span>
            </button>
          ))}
        </div>
      )}

      {loadError && !isLoading && (
        <Card
          role="alert"
          aria-live="polite"
          className="p-4 mb-4 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3 max-w-3xl"
        >
          <span className="text-sm">{loadError}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadData()}
          >
            {t('action.retry')}
          </Button>
        </Card>
      )}

      {isCreating && (
        <Card className="p-6 mb-6 animate-fade-in border border-[var(--primary)] max-w-2xl">
          <h3 className="text-lg font-bold mb-4">{t('documents.form.send_title')}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('documents.form.template')}</label>
              <select 
                value={selectedTemplate} 
                onChange={e => setSelectedTemplate(e.target.value)}
                className="w-full p-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] text-sm"
              >
                <option value="">{t('documents.form.template_placeholder')}</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">{t('documents.form.lead')}</label>
              <select 
                value={selectedLead} 
                onChange={e => setSelectedLead(e.target.value)}
                className="w-full p-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] text-sm"
              >
                <option value="">{t('documents.form.lead_placeholder')}</option>
                {leads.map(l => <option key={l.id} value={l.id}>{l.name} ({l.email})</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">{t('documents.form.title_label')}</label>
              <Input
                placeholder={t('documents.form.title_placeholder')}
                value={docTitle}
                onChange={e => setDocTitle(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-3 pt-2 border-t border-[var(--border-subtle)] mt-2">
              <div className="flex gap-2 justify-between items-center">
                <Button variant="secondary" onClick={() => handleGenerateOaciq()} disabled={!selectedLead || isGeneratingOaciq} className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200" aria-busy={isGeneratingOaciq}>
                  <Icon as={FileSignature} size="md" className="mr-2" />
                  {isGeneratingOaciq ? t('documents.oaciq.generating') : t('documents.oaciq.generate')}
                </Button>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setIsCreating(false)}>{t('action.cancel')}</Button>
                  <Button onClick={() => void handleCreateAndSend()} disabled={!selectedTemplate || !selectedLead || !docTitle}>
                    <Icon as={Mail} size="md" className="mr-2" /> {t('documents.form.create_send')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {isLoading ? (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] flex items-center gap-6">
            {[1,2,3,4,5].map(i => (
              <Skeleton key={i} className="h-3 w-20 rounded" />
            ))}
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 w-4 rounded shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/2 rounded" />
                </div>
                <div className="w-36 space-y-1">
                  <Skeleton className="h-3 w-full rounded" />
                  <Skeleton className="h-2.5 w-2/3 rounded" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full shrink-0" />
                <Skeleton className="h-3 w-20 rounded shrink-0" />
                <Skeleton className="h-7 w-16 rounded shrink-0" />
              </div>
            ))}
          </div>
        </Card>
      ) : documents.length === 0 && !isCreating ? (
        <EmptyState
          variant="first-time"
          icon={<FileSignature size={48} />}
          title={t('documents.empty.title')}
          description={t('documents.empty.desc')}
          action={<Button variant="primary" onClick={() => setIsCreating(true)}>{t('documents.empty.action')}</Button>}
        />
      ) : (
        /* Sprint 31 vague 31-2A — Table premium (frozen first col + expand inline) */
        <Card className="p-0 overflow-hidden">
          <div className="table-premium-container overflow-x-auto" aria-busy={isLoading}>
            <table className="table-premium print-data-table">
              <thead>
                <tr>
                  <th className="col-frozen" style={{ minWidth: 280 }}>{t('documents.table.title')}</th>
                  <th className="text-left">{t('documents.table.recipient')}</th>
                  <th className="text-left">{t('documents.table.status')}</th>
                  <th className="text-left">{t('documents.table.date')}</th>
                  <th data-print-hide className="text-right" style={{ width: 160 }}>{t('documents.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map((doc, idx) => {
                  const isExpanded = expandedRows.has(doc.id);
                  return (
                    <Fragment key={doc.id}>
                      <tr className="list-item-enter" style={{ animationDelay: `${idx * 28}ms` }}>
                        <td className="col-frozen">
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              className={`table-expand-trigger ${isExpanded ? 'is-expanded' : ''}`}
                              onClick={() => toggleExpand(doc.id)}
                              aria-label={isExpanded ? t('documents.expand.collapse') : t('documents.expand.expand')}
                              aria-expanded={isExpanded}
                            >
                              <ChevronRight size={14} />
                            </button>
                            <Icon as={FileSignature} size="sm" className="text-[var(--text-muted)] shrink-0" />
                            <span className="font-medium text-[13px] truncate" title={doc.title}>
                              {doc.title}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-col min-w-0">
                            <span className="text-[12px] font-medium truncate">{doc.lead_name || '—'}</span>
                            <span className="text-[11px] text-[var(--text-muted)] truncate">{doc.lead_email || ''}</span>
                          </div>
                        </td>
                        <td>{getStatusBadge(doc.status)}</td>
                        <td className="text-[12px] text-[var(--text-secondary)]">
                          {doc.status === 'signed' && doc.signed_at
                            ? timeAgo(doc.signed_at)
                            : doc.status === 'sent' && doc.sent_at
                              ? timeAgo(doc.sent_at)
                              : timeAgo(doc.created_at)}
                        </td>
                        <td data-print-hide className="text-right">
                          <div className="flex gap-1.5 justify-end">
                            <Button variant="secondary" size="sm" onClick={() => window.open(`/sign/${doc.token}`, '_blank')}>
                              {t('documents.action.view')}
                            </Button>
                            {(doc.status === 'draft' || doc.status === 'sent') && (
                              <Button variant="ghost" size="sm" onClick={async () => {
                                const res = await sendSigningSms(doc.id);
                                if (res.data) success(`${t('documents.sms.sent_to')} ${res.data.sms_sent_to}`);
                                else toastError(res.error || t('documents.sms.error'));
                              }} title={t('documents.sms.send')} aria-label={t('documents.sms.send')}>
                                <Icon as={MessageSquare} size="sm" /> SMS
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={5} style={{ padding: 0, border: 'none' }}>
                          <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
                            <div className="table-expand-inner">
                              <div className="table-expand-detail">
                                <div className="table-expand-detail-section" style={{ flex: '1 1 240px' }}>
                                  <span className="table-expand-detail-label">{t('documents.expand.signer')}</span>
                                  <div className="flex items-center gap-2 text-[12px]">
                                    <User size={12} className="text-[var(--text-muted)]" />
                                    <div className="flex flex-col">
                                      <span className="font-medium">{doc.lead_name || '—'}</span>
                                      <span className="text-[11px] text-[var(--text-muted)]">{doc.lead_email || t('documents.expand.no_email')}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('documents.expand.workflow')}</span>
                                  <div className="flex flex-col gap-1 text-[11px]">
                                    <span className={`inline-flex items-center gap-1.5 ${doc.sent_at ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}`}>
                                      <Mail size={11} />
                                      {t('documents.expand.sent')} {doc.sent_at ? timeAgo(doc.sent_at) : t('documents.expand.pending')}
                                    </span>
                                    <span className={`inline-flex items-center gap-1.5 ${doc.status === 'viewed' || doc.status === 'signed' ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'}`}>
                                      <Eye size={11} />
                                      {t('documents.expand.viewed')} {doc.status === 'viewed' || doc.status === 'signed' ? '✓' : t('documents.expand.not_yet')}
                                    </span>
                                    <span className={`inline-flex items-center gap-1.5 ${doc.status === 'signed' ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}`}>
                                      <CheckCircle size={11} />
                                      {t('documents.expand.signed')} {doc.signed_at ? timeAgo(doc.signed_at) : t('documents.expand.pending')}
                                    </span>
                                  </div>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('documents.expand.signing_token')}</span>
                                  <span className="table-expand-detail-value text-[11px] font-mono break-all">
                                    {doc.token || '—'}
                                  </span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">{t('documents.expand.created_label')}</span>
                                  <span className="table-expand-detail-value text-[12px]">
                                    {new Date(doc.created_at).toLocaleString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
        </Card>
      )}
      </div>
    </AppLayout>
  );
}
