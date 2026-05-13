// ── Page ClientLeads — Leads d'un client spécifique ─────────

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Badge, Skeleton, EmptyState } from '@/components/ui';
import { getClientLeads, updateLead } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, LEAD_STATUSES, type Lead, type LeadStatus } from '@/lib/types';

export function ClientLeadsPage() {
  const { clientId } = useParams({ strict: false }) as { clientId: string };
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const loadLeads = useCallback(async () => {
    setIsLoading(true);
    const result = await getClientLeads(clientId, {
      status: statusFilter || undefined,
      type: typeFilter || undefined,
      search: search || undefined,
    });
    if (result.data) {
      setLeads(result.data);
    }
    setIsLoading(false);
  }, [clientId, statusFilter, typeFilter, search]);

  useEffect(() => { void loadLeads(); }, [loadLeads]);

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    const result = await updateLead(leadId, { status: newStatus });
    if (!result.error) {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
    }
  };

  return (
    <AppLayout title="Leads du client">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] mb-4">
        <Link to="/clients" className="hover:text-[var(--brand-primary)] transition-colors">Clients</Link>
        <span>/</span>
        <span className="text-[var(--text-primary)]">Leads</span>
      </div>

      {/* Filtres */}
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <Input
              placeholder="Rechercher par nom, email, téléphone..."
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
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
          >
            <option value="">Tous les statuts</option>
            {LEAD_STATUSES.map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2.5 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
          >
            <option value="">Tous les types</option>
            <option value="inbound">Entrant</option>
            <option value="customer">Client</option>
          </select>
        </div>
      </Card>

      {/* Tableau */}
      {isLoading ? (
        <Card><Skeleton className="h-64 w-full" /></Card>
      ) : leads.length === 0 ? (
        <EmptyState
          title="Aucun lead trouvé"
          description="Aucun lead ne correspond à vos filtres."
          action={<Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); setTypeFilter(''); }}>Réinitialiser les filtres</Button>}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Nom</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Statut</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)] transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium">{lead.name}</p>
                      {lead.message && <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate max-w-48">{lead.message}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[var(--text-secondary)]">{lead.email}</p>
                      {lead.phone && <p className="text-xs text-[var(--text-muted)]">{lead.phone}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={lead.type === 'inbound' ? 'var(--brand-primary)' : 'var(--warning)'}>
                        {TYPE_LABELS[lead.type]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={lead.status}
                        onChange={(e) => void handleStatusChange(lead.id, e.target.value as LeadStatus)}
                        className="text-xs px-2 py-1 bg-transparent border border-[var(--border-subtle)] rounded-[var(--radius-sm)] focus:outline-none"
                        style={{ color: STATUS_COLORS[lead.status] }}
                      >
                        {LEAD_STATUSES.map(s => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
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
