// ── Page ClientLeads — Leads d'un client spécifique ─────────

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Select, Tag, Skeleton, EmptyState, KpiStrip, type KpiItem, Icon } from '@/components/ui';
import { getClientLeads, updateLead } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, LEAD_STATUSES, type Lead, type LeadStatus } from '@/lib/types';
import { Users, Inbox, UserCheck, Trophy } from 'lucide-react';
import { t } from '@/lib/i18n';

export function ClientLeadsPage() {
  const { clientId } = useParams({ strict: false }) as { clientId: string };
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const loadLeads = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const result = await getClientLeads(clientId, {
      status: statusFilter || undefined,
      type: typeFilter || undefined,
      search: search || undefined,
    });
    if (result.data) {
      setLeads(result.data);
    } else if (result.error) {
      setLoadError(result.error || t('client_leads.error_load'));
    }
    setIsLoading(false);
  }, [clientId, statusFilter, typeFilter, search]);

  useEffect(() => { void loadLeads(); }, [loadLeads]);

  const kpis = useMemo<KpiItem[]>(() => {
    const total = leads.length;
    const inbound = leads.filter(l => l.type === 'inbound').length;
    const customer = leads.filter(l => l.type === 'customer').length;
    const won = leads.filter(l => l.status === 'won').length;
    return [
      { label: t('client_leads.kpi.total'), value: total, color: 'brand', icon: <Icon as={Users} size={11} /> },
      { label: t('client_leads.kpi.inbound'), value: inbound, color: 'info', icon: <Icon as={Inbox} size={11} /> },
      { label: t('client_leads.kpi.clients'), value: customer, color: 'accent', icon: <Icon as={UserCheck} size={11} /> },
      { label: t('client_leads.kpi.won'), value: won, color: 'success', icon: <Icon as={Trophy} size={11} /> },
    ];
  }, [leads]);

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    const result = await updateLead(leadId, { status: newStatus });
    if (!result.error) {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
    }
  };

  return (
    <AppLayout title={t('client_leads.page.title')}>
      {/* Breadcrumb */}
      <nav aria-label={t('client_leads.breadcrumb.aria')} className="flex items-center gap-2 text-sm text-[var(--text-muted)] mb-4">
        <Link to="/clients" className="hover:text-[var(--primary)] transition-colors">{t('client_leads.breadcrumb.clients')}</Link>
        <span aria-hidden>/</span>
        <span className="text-[var(--text-primary)]" aria-current="page">{t('client_leads.breadcrumb.leads')}</span>
      </nav>

      {/* KPI Strip — leads du client */}
      {!isLoading && leads.length > 0 && <KpiStrip items={kpis} />}

      {/* Filtres */}
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <Input
              placeholder={t('client_leads.filter.search')}
              id="search-leads"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              }
            />
          </div>
          <div className="min-w-[180px]">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('client_leads.filter.all_status')}</option>
              {LEAD_STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </div>
          <div className="min-w-[160px]">
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">{t('client_leads.filter.all_types')}</option>
              <option value="inbound">{t('client_leads.filter.inbound')}</option>
              <option value="customer">{t('client_leads.filter.customer')}</option>
            </Select>
          </div>
        </div>
      </Card>

      {/* Tableau */}
      {isLoading ? (
        <Card className="p-0 overflow-hidden" aria-busy="true" aria-live="polite">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
            {[1,2,3,4,5].map(i => (
              <Skeleton key={i} className="h-3 w-20 rounded" />
            ))}
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3 rounded" />
                  <Skeleton className="h-2.5 w-1/2 rounded" />
                </div>
                <div className="w-40 space-y-1">
                  <Skeleton className="h-3 w-full rounded" />
                  <Skeleton className="h-2.5 w-2/3 rounded" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full shrink-0" />
                <Skeleton className="h-7 w-24 rounded shrink-0" />
                <Skeleton className="h-3 w-16 rounded shrink-0" />
              </div>
            ))}
          </div>
        </Card>
      ) : loadError ? (
        <EmptyState
          icon={<Icon as={Users} size={40} />}
          title={t('client_leads.error_load')}
          description={t('client_leads.error_load_desc')}
          action={
            <Button variant="primary" onClick={() => void loadLeads()}>
              {t('client_leads.error_retry')}
            </Button>
          }
        />
      ) : leads.length === 0 ? (
        <EmptyState
          variant="filtered"
          title={t('client_leads.empty.title')}
          description={t('client_leads.empty.desc')}
          action={<Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); setTypeFilter(''); }}>{t('client_leads.empty.action')}</Button>}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('client_leads.table.name')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('client_leads.table.contact')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('client_leads.table.type')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('client_leads.table.status')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('client_leads.table.date')}</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, idx) => (
                  <tr
                    key={lead.id}
                    className="row-premium list-item-enter border-b border-[var(--border-subtle)]"
                    style={{ animationDelay: `${Math.min(idx, 20) * 30}ms` }}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{lead.name}</p>
                      {lead.message && <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate max-w-48">{lead.message}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[var(--text-secondary)]">{lead.email}</p>
                      {lead.phone && <p className="text-xs text-[var(--text-muted)]">{lead.phone}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <Tag color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'} size="sm">
                        {TYPE_LABELS[lead.type]}
                      </Tag>
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        size="sm"
                        value={lead.status}
                        onChange={(e) => void handleStatusChange(lead.id, e.target.value as LeadStatus)}
                        style={{ color: STATUS_COLORS[lead.status], fontWeight: 600 }}
                        aria-label={t('client_leads.status_select_aria', { name: lead.name })}
                      >
                        {LEAD_STATUSES.map(s => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                      {new Date(lead.created_at).toLocaleDateString('fr-CA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </AppLayout>
  );
}
