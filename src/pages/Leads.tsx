// ── Page Leads — Liste globale de tous les leads ────────────

import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Badge, Skeleton, EmptyState, Modal } from '@/components/ui';
import { getLeads, getClients, updateLead, exportLeadsCsv } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, SOURCE_LABELS, LEAD_STATUSES, type Lead, type LeadStatus, type Client, type SmartList } from '@/lib/types';

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [smartLists, setSmartLists] = useState<SmartList[]>(() => {
    try { return JSON.parse(localStorage.getItem('intralys_smart_lists') || '[]') as SmartList[]; } catch { return []; }
  });
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [sortBy, setSortBy] = useState<'name' | 'score' | 'created_at' | 'deal_value'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [leadsResult, clientsResult] = await Promise.all([
      getLeads({ status: statusFilter || undefined, search: search || undefined, source: sourceFilter || undefined, client_id: clientFilter || undefined }),
      getClients(),
    ]);
    if (leadsResult.data) setLeads(leadsResult.data);
    if (clientsResult.data) setClients(clientsResult.data);
    setIsLoading(false);
  }, [statusFilter, search, sourceFilter, clientFilter]);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    const result = await updateLead(leadId, { status: newStatus });
    if (!result.error) {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedLead) return;
    const result = await updateLead(selectedLead.id, { notes: editNotes });
    if (!result.error) {
      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, notes: editNotes } : l));
      setSelectedLead(null);
    }
  };

  const openNotes = (lead: Lead) => {
    setSelectedLead(lead);
    setEditNotes(lead.notes || '');
  };

  // Bulk actions
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === leads.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(leads.map(l => l.id)));
  };
  const bulkChangeStatus = async (status: LeadStatus) => {
    for (const id of selectedIds) {
      await updateLead(id, { status });
    }
    setSelectedIds(new Set());
    void loadData();
  };

  // Smart Lists
  const saveSmartList = () => {
    const name = prompt('Nom de la liste intelligente :');
    if (!name) return;
    const newList: SmartList = {
      id: `sl-${Date.now()}`, name,
      filters: { status: statusFilter || undefined, source: sourceFilter || undefined, client_id: clientFilter || undefined, search: search || undefined },
      count: leads.length, created_at: new Date().toISOString(),
    };
    const updated = [...smartLists, newList];
    setSmartLists(updated);
    localStorage.setItem('intralys_smart_lists', JSON.stringify(updated));
  };
  const loadSmartList = (sl: SmartList) => {
    setStatusFilter(sl.filters.status || '');
    setSourceFilter(sl.filters.source || '');
    setClientFilter(sl.filters.client_id || '');
    setSearch(sl.filters.search || '');
  };
  const deleteSmartList = (id: string) => {
    const updated = smartLists.filter(s => s.id !== id);
    setSmartLists(updated);
    localStorage.setItem('intralys_smart_lists', JSON.stringify(updated));
  };

  // Nom du client
  const getClientName = (lead: Lead) => {
    if (lead.client_name) return lead.client_name;
    const client = clients.find(c => c.id === lead.client_id);
    return client?.name || lead.client_id;
  };

  // Fonction pour le temps relatif
  const timeAgo = (dateStr: string): string => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);

    if (diffMin < 60) return `il y a ${diffMin} min`;
    if (diffH < 24) return `il y a ${diffH}h`;
    if (diffD === 1) return 'hier';
    if (diffD < 7) return `il y a ${diffD}j`;
    return new Date(dateStr).toLocaleDateString('fr-CA');
  };

  // Tri des leads
  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };
  const sortedLeads = [...leads].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'name') return a.name.localeCompare(b.name) * dir;
    if (sortBy === 'score') return (a.score - b.score) * dir;
    if (sortBy === 'deal_value') return ((a.deal_value || 0) - (b.deal_value || 0)) * dir;
    return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
  });
  const sortIcon = (col: typeof sortBy) => sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <AppLayout title="Leads">
      {/* Stats rapides */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
          {leads.length} leads au total
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-[var(--color-warning)]" />
          {leads.filter(l => l.status === 'new').length} nouveaux
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
          {leads.filter(l => l.status === 'signed').length} signés
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setViewMode('table')}
            className={`p-1.5 rounded text-xs cursor-pointer transition-colors ${viewMode === 'table' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)]'}`}>
            ☰
          </button>
          <button onClick={() => setViewMode('cards')}
            className={`p-1.5 rounded text-xs cursor-pointer transition-colors ${viewMode === 'cards' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)]'}`}>
            ▦
          </button>
        </div>
      </div>

      {/* Filtres */}
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <Input
              placeholder="Rechercher par nom, email, téléphone..."
              id="search-all-leads"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              }
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none">
            <option value="">Tous les statuts</option>
            {LEAD_STATUSES.map(s => (<option key={s} value={s}>{STATUS_LABELS[s]}</option>))}
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
            className="px-3 py-2.5 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none">
            <option value="">Toutes les sources</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
            className="px-3 py-2.5 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none">
            <option value="">Tous les clients</option>
            {clients.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          {(search || statusFilter || sourceFilter || clientFilter) && (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatusFilter(''); setSourceFilter(''); setClientFilter(''); }}>
                Réinitialiser
              </Button>
              <Button variant="secondary" size="sm" onClick={saveSmartList} title="Sauvegarder ce filtre">
                💾 Sauvegarder
              </Button>
            </>
          )}
          <Button variant="secondary" size="sm" onClick={() => void exportLeadsCsv({ status: statusFilter || undefined, client_id: clientFilter || undefined })}>
            📥 Export CSV
          </Button>
        </div>
        {/* Smart Lists */}
        {smartLists.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
            <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider self-center">📚 Listes :</span>
            {smartLists.map(sl => (
              <span key={sl.id} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] cursor-pointer hover:bg-[var(--color-accent)] hover:text-white transition-colors">
                <button onClick={() => loadSmartList(sl)} className="cursor-pointer">{sl.name}</button>
                <button onClick={() => deleteSmartList(sl.id)} className="opacity-50 hover:opacity-100 cursor-pointer">×</button>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Tableau ou Cartes */}
      {isLoading ? (
        <Card><Skeleton className="h-96 w-full" /></Card>
      ) : leads.length === 0 ? (
        <EmptyState
          title="Aucun lead trouvé"
          description="Aucun lead ne correspond à vos filtres."
          action={<Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); }}>Réinitialiser</Button>}
        />
      ) : viewMode === 'cards' ? (
        /* ── Vue Cartes ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {sortedLeads.map(lead => {
            const scoreColor = lead.score >= 70 ? 'var(--color-success)' : lead.score >= 40 ? 'var(--color-warning)' : 'var(--color-danger)';
            return (
              <Link key={lead.id} to={`/leads/${lead.id}`}
                className="block card p-4 hover:border-[var(--color-accent)] transition-all hover:shadow-md">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white text-xs font-bold">
                      {lead.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{lead.name}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">{getClientName(lead)}</p>
                    </div>
                  </div>
                  <Badge color={lead.type === 'buy' ? 'var(--color-accent)' : 'var(--color-warning)'}>
                    {TYPE_LABELS[lead.type]}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge color={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                  {lead.deal_value > 0 && <span className="text-[10px] font-semibold text-[var(--color-accent)]">{lead.deal_value.toLocaleString('fr-CA')} $</span>}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--color-bg-hover)] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${lead.score}%`, background: scoreColor }} />
                  </div>
                  <span className="text-[10px] font-bold" style={{ color: scoreColor }}>{lead.score}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                  <span>{lead.email}</span>
                  <span>{timeAgo(lead.created_at)}</span>
                </div>
                {lead.tags && lead.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {lead.tags.slice(0, 3).map(t => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--color-bg-hover)]">{t}</span>)}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          {/* Barre d'actions Bulk */}
          {selectedIds.size > 0 && (
            <div className="px-4 py-2.5 bg-[color-mix(in_oklch,var(--color-accent)_10%,var(--color-bg-card))] border-b border-[var(--color-accent)] flex items-center gap-3 animate-slide-down">
              <span className="text-xs font-semibold text-[var(--color-accent)]">{selectedIds.size} sélectionné(s)</span>
              <select onChange={(e) => { if (e.target.value) void bulkChangeStatus(e.target.value as LeadStatus); e.target.value = ''; }}
                className="text-xs px-2 py-1 bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] cursor-pointer">
                <option value="">Changer statut...</option>
                {LEAD_STATUSES.map(s => (<option key={s} value={s}>{STATUS_LABELS[s]}</option>))}
              </select>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Annuler</Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={selectedIds.size === leads.length && leads.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded cursor-pointer" />
                  </th>
                  <th onClick={() => toggleSort('name')} className="text-left px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--color-accent)] select-none">Nom{sortIcon('name')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Statut</th>
                  <th onClick={() => toggleSort('score')} className="text-left px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--color-accent)] select-none">Score{sortIcon('score')}</th>
                  <th onClick={() => toggleSort('created_at')} className="text-left px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--color-accent)] select-none">Date{sortIcon('created_at')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead, index) => (
                  <tr
                    key={lead.id}
                    className={`border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] transition-colors ${selectedIds.has(lead.id) ? 'bg-[color-mix(in_oklch,var(--color-accent)_5%,transparent)]' : ''}`}
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)} className="rounded cursor-pointer" />
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/leads/${lead.id}`} className="text-left cursor-pointer hover:text-[var(--color-accent)] transition-colors block">
                        <p className="font-medium">{lead.name}</p>
                        {lead.message && <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate max-w-56">{lead.message}</p>}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded-full bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] font-medium">
                        {getClientName(lead)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[var(--color-text-secondary)]">{lead.email}</p>
                      {lead.phone && <p className="text-xs text-[var(--color-text-muted)]">{lead.phone}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={lead.type === 'buy' ? 'var(--color-accent)' : 'var(--color-warning)'}>
                        {TYPE_LABELS[lead.type]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={lead.status}
                        onChange={(e) => void handleStatusChange(lead.id, e.target.value as LeadStatus)}
                        className="text-xs px-2 py-1 bg-transparent border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] focus:outline-none cursor-pointer"
                        style={{ color: STATUS_COLORS[lead.status] }}
                      >
                        {LEAD_STATUSES.map(s => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-8 h-1.5 rounded-full bg-[var(--color-bg-hover)] overflow-hidden">
                          <div className="h-full rounded-full" style={{
                            width: `${lead.score}%`,
                            background: lead.score >= 70 ? 'var(--color-success)' : lead.score >= 40 ? 'var(--color-warning)' : 'var(--color-danger)',
                          }} />
                        </div>
                        <span className="text-[10px] text-[var(--color-text-muted)]">{lead.score}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {timeAgo(lead.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openNotes(lead)}
                        className="text-xs text-[var(--color-accent)] hover:underline cursor-pointer"
                        title="Voir / modifier les notes"
                      >
                        {lead.notes ? '📝 Notes' : '+ Note'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal Notes */}
      <Modal isOpen={!!selectedLead} onClose={() => setSelectedLead(null)} title={`Notes — ${selectedLead?.name || ''}`}>
        {selectedLead && (
          <div className="space-y-4">
            {/* Infos lead */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-[var(--color-text-muted)]">Email : </span>
                <span>{selectedLead.email}</span>
              </div>
              <div>
                <span className="text-[var(--color-text-muted)]">Téléphone : </span>
                <span>{selectedLead.phone || '—'}</span>
              </div>
              <div>
                <span className="text-[var(--color-text-muted)]">Type : </span>
                <Badge color={selectedLead.type === 'buy' ? 'var(--color-accent)' : 'var(--color-warning)'}>
                  {TYPE_LABELS[selectedLead.type]}
                </Badge>
              </div>
              <div>
                <span className="text-[var(--color-text-muted)]">Statut : </span>
                <Badge color={STATUS_COLORS[selectedLead.status]}>
                  {STATUS_LABELS[selectedLead.status]}
                </Badge>
              </div>
            </div>

            {selectedLead.message && (
              <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-bg-hover)] text-sm">
                <p className="text-xs text-[var(--color-text-muted)] mb-1">Message du lead :</p>
                <p>{selectedLead.message}</p>
              </div>
            )}

            {/* Zone de notes */}
            <div>
              <label htmlFor="lead-notes" className="text-sm font-medium text-[var(--color-text-secondary)] block mb-1.5">
                Notes internes
              </label>
              <textarea
                id="lead-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={4}
                placeholder="Ajouter des notes sur ce lead..."
                className="w-full px-3 py-2.5 text-sm bg-[var(--color-bg-input)] text-[var(--color-text-primary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] focus:outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSelectedLead(null)}>Annuler</Button>
              <Button onClick={() => void handleSaveNotes()}>Sauvegarder</Button>
            </div>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}
