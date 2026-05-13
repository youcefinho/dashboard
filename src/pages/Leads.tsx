// ── Page Leads — Liste globale + Vue Carte (Sprint 6 D3) ─────

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Skeleton, EmptyState } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { getLeads, getClients, updateLead, exportLeadsCsv, createLead, softDeleteLead, restoreLead } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, SOURCE_LABELS, LEAD_STATUSES, type Lead, type LeadStatus, type Client, type SmartList } from '@/lib/types';
import { Search, X, Download, Save, LayoutGrid, LayoutList, Map, MoreHorizontal, ArrowUpDown, ChevronUp, ChevronDown, StickyNote, Users, UserPlus, Zap, ExternalLink, Check, Plus, Trash2 } from 'lucide-react';
import { SwipeAction } from '@/components/ui/SwipeAction';
import { useLongPress } from '@/hooks/useLongPress';
import { useToast } from '@/components/ui';

// Fixtures mock pour leads sans coordonnées (mode mock QC)
const QC_FIXTURES: Array<{ lat: number; lng: number; city: string }> = [
  { lat: 45.5017, lng: -73.5673, city: 'Montréal' },
  { lat: 46.8139, lng: -71.2080, city: 'Québec' },
  { lat: 45.4765, lng: -75.7013, city: 'Gatineau' },
  { lat: 45.3504, lng: -72.5185, city: 'Sherbrooke' },
  { lat: 45.6894, lng: -73.7486, city: 'Laval' },
  { lat: 45.5590, lng: -73.7339, city: 'Montréal-Nord' },
  { lat: 45.3975, lng: -75.6919, city: 'Hull' },
  { lat: 46.3432, lng: -72.5480, city: 'Trois-Rivières' },
];

// Composant Map (Mapbox ou fallback SVG mock)
function LeadsMapView({ leads }: { leads: Lead[] }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState(false);
  const [selectedPin, setSelectedPin] = useState<Lead | null>(null);

  // Enrichir les leads avec des coordonnées mock si manquantes
  const enrichedLeads = leads.slice(0, 50).map((lead, i) => ({
    ...lead,
    lat: (lead as Lead & { lat?: number }).lat || QC_FIXTURES[i % QC_FIXTURES.length]!.lat + (Math.random() - 0.5) * 0.1,
    lng: (lead as Lead & { lng?: number }).lng || QC_FIXTURES[i % QC_FIXTURES.length]!.lng + (Math.random() - 0.5) * 0.1,
  }));

  // Essayer de charger Mapbox si token dispo (runtime, pas bundlé)
  useEffect(() => {
    const token = (import.meta.env as Record<string, string>)['VITE_MAPBOX_TOKEN'];
    if (!token || !mapContainer.current) {
      setMapError(true);
      return;
    }
    // Charger mapbox-gl via CDN si pas déjà disponible
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (win.mapboxgl) {
      initMap(win.mapboxgl, token);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js';
    script.onload = () => initMap(win.mapboxgl, token);
    script.onerror = () => setMapError(true);
    document.head.appendChild(script);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css';
    document.head.appendChild(link);
    return () => { document.head.removeChild(script); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function initMap(mapboxGl: any, token: string) {
    if (!mapContainer.current) return;
    mapboxGl.accessToken = token;
    const map = new mapboxGl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-73.5673, 45.5017],
      zoom: 7,
    });
    enrichedLeads.forEach((lead: Lead & { lat: number; lng: number }) => {
      const marker = new mapboxGl.Marker({ color: lead.score >= 70 ? '#10b981' : lead.score >= 40 ? '#f59e0b' : '#ef4444' })
        .setLngLat([lead.lng, lead.lat])
        .setPopup(new mapboxGl.Popup().setHTML(
          `<strong>${lead.name}</strong><br/><span style="font-size:11px">${STATUS_LABELS[lead.status] || lead.status}</span>`
        ))
        .addTo(map);
      marker.getElement().addEventListener('click', () => setSelectedPin(lead));
    });
  }

  if (mapError || !((import.meta.env as Record<string, string>)['VITE_MAPBOX_TOKEN'])) {
    // Fallback : grille SVG mock avec punaises
    const scoreColor = (s: number) => s >= 70 ? '#10b981' : s >= 40 ? '#f59e0b' : '#ef4444';
    return (
      <div className="relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden" style={{ height: 520 }}>
        {/* Fond carte stylisée mock */}
        <svg width="100%" height="100%" viewBox="0 0 800 520" className="opacity-30">
          <rect width="800" height="520" fill="#1e293b" />
          {/* Quadrillage */}
          {Array.from({ length: 10 }).map((_, i) => (
            <g key={i}>
              <line x1={i * 80} y1="0" x2={i * 80} y2="520" stroke="#334155" strokeWidth="1" />
              <line x1="0" y1={i * 52} x2="800" y2={i * 52} stroke="#334155" strokeWidth="1" />
            </g>
          ))}
          <text x="400" y="260" textAnchor="middle" fill="#64748b" fontSize="14" fontFamily="system-ui">
            Carte Québec (mode mock)
          </text>
        </svg>
        {/* Pins mock */}
        <div className="absolute inset-0 p-4">
          {enrichedLeads.slice(0, 20).map((lead, i) => {
            const x = 5 + (i % 6) * 16 + Math.random() * 4;
            const y = 10 + Math.floor(i / 6) * 22 + Math.random() * 4;
            return (
              <button key={lead.id}
                onClick={() => setSelectedPin(prev => prev?.id === lead.id ? null : lead)}
                style={{ left: `${x}%`, top: `${y}%`, position: 'absolute' }}
                className="group relative">
                <div className="w-5 h-5 rounded-full border-2 border-white shadow-lg transition-transform group-hover:scale-125"
                  style={{ background: scoreColor(lead.score) }} />
              </button>
            );
          })}
        </div>
        {/* Légende */}
        <div className="absolute bottom-4 left-4 flex items-center gap-3 bg-gray-900/80 backdrop-blur px-3 py-2 rounded-lg text-xs">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> Score ≥70</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-500" /> 40-69</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500" /> &lt;40</span>
          <span className="text-[var(--text-muted)] ml-2">| Configurez VITE_MAPBOX_TOKEN pour la vraie carte</span>
        </div>
        {/* Popup */}
        {selectedPin && (
          <div className="absolute top-4 right-4 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 shadow-lg max-w-48 z-10">
            <p className="font-semibold text-sm text-[var(--text-primary)]">{selectedPin.name}</p>
            <p className="text-xs text-[var(--text-muted)]">{selectedPin.email}</p>
            <p className="text-xs mt-1" style={{ color: scoreColor(selectedPin.score) }}>Score : {selectedPin.score}</p>
            <Link to={`/leads/${selectedPin.id}`}
              className="flex items-center gap-1 text-xs text-[var(--brand-primary)] mt-1.5 hover:underline">
              <ExternalLink size={10} /> Voir le profil
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative rounded-[var(--radius-lg)] overflow-hidden" style={{ height: 520 }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      {selectedPin && (
        <div className="absolute top-4 right-4 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 shadow-lg max-w-48 z-10">
          <p className="font-semibold text-sm text-[var(--text-primary)]">{selectedPin.name}</p>
          <p className="text-xs text-[var(--text-muted)]">{selectedPin.email}</p>
          <Link to={`/leads/${selectedPin.id}`}
            className="flex items-center gap-1 text-xs text-[var(--brand-primary)] mt-1.5 hover:underline">
            <ExternalLink size={10} /> Voir le profil
          </Link>
        </div>
      )}
    </div>
  );
}

export function LeadsPage() {
  const { success, error: toastError } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => localStorage.getItem('intralys_leads_filter_status') || '');
  const [sourceFilter, setSourceFilter] = useState(() => localStorage.getItem('intralys_leads_filter_source') || '');
  const [clientFilter, setClientFilter] = useState(() => localStorage.getItem('intralys_leads_filter_client') || '');

  useEffect(() => {
    localStorage.setItem('intralys_leads_filter_status', statusFilter);
    localStorage.setItem('intralys_leads_filter_source', sourceFilter);
    localStorage.setItem('intralys_leads_filter_client', clientFilter);
  }, [statusFilter, sourceFilter, clientFilter]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [smartLists, setSmartLists] = useState<SmartList[]>(() => {
    try { return JSON.parse(localStorage.getItem('intralys_smart_lists') || '[]') as SmartList[]; } catch { return []; }
  });
  const [viewMode, setViewMode] = useState<'table' | 'cards' | 'map'>('table');
  const [sortBy, setSortBy] = useState<'name' | 'score' | 'created_at' | 'deal_value'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const emptyCreateForm = { client_id: '', name: '', email: '', phone: '', source: 'manual', message: '', type: 'inbound' as 'inbound' | 'customer' };
  const [createForm, setCreateForm] = useState(emptyCreateForm);

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
      success('Statut mis à jour avec succès');
    } else {
      toastError(result.error);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedLead) return;
    const result = await updateLead(selectedLead.id, { notes: editNotes });
    if (!result.error) {
      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, notes: editNotes } : l));
      setSelectedLead(null);
      success('Notes sauvegardées');
    } else {
      toastError(result.error);
    }
  };

  const openNotes = (lead: Lead) => { setSelectedLead(lead); setEditNotes(lead.notes || ''); };

  const handleCreateLead = async () => {
    setCreateError(null);
    if (!createForm.client_id || !createForm.name.trim() || !createForm.email.trim()) {
      setCreateError('Client, nom et email sont requis.');
      return;
    }
    setCreateSubmitting(true);
    const result = await createLead({
      client_id: createForm.client_id,
      name: createForm.name.trim(),
      email: createForm.email.trim(),
      phone: createForm.phone.trim() || undefined,
      type: createForm.type,
      source: createForm.source || undefined,
      message: createForm.message.trim() || undefined,
    });
    setCreateSubmitting(false);
    if (result.error) { setCreateError(result.error); return; }
    
    success('Nouveau lead créé avec succès', { title: 'Action réussie' });
    setCreateOpen(false);
    setCreateForm(emptyCreateForm);
    void loadData();
  };
  const closeCreate = () => { if (!createSubmitting) { setCreateOpen(false); setCreateError(null); } };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === leads.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(leads.map(l => l.id)));
  };
  const bulkChangeStatus = async (status: LeadStatus) => {
    for (const id of selectedIds) await updateLead(id, { status });
    setSelectedIds(new Set()); void loadData();
    success(`${selectedIds.size} prospects mis à jour`);
  };

  const bulkTrash = async () => {
    if (!confirm(`Déplacer ${selectedIds.size} prospects vers la corbeille ?`)) return;
    
    const ids = Array.from(selectedIds);
    let errorCount = 0;
    
    for (const id of ids) {
      const res = await softDeleteLead(id);
      if (res.error) errorCount++;
    }
    
    setSelectedIds(new Set());
    void loadData();

    if (errorCount === 0) {
      success(`${ids.length} prospects déplacés vers la corbeille`, {
        duration: 10000,
        action: {
          label: 'Annuler',
          onClick: async () => {
            for (const id of ids) await restoreLead(id);
            success('Prospects restaurés');
            void loadData();
          }
        }
      });
    } else {
      toastError(`${errorCount} prospects n'ont pas pu être supprimés`);
    }
  };

  const saveSmartList = () => {
    const name = prompt('Nom de la liste intelligente :');
    if (!name) return;
    const newList: SmartList = { id: `sl-${Date.now()}`, user_id: 'local', client_id: 'local', name, filters: { status: statusFilter || undefined, source: sourceFilter || undefined, client_id: clientFilter || undefined, search: search || undefined }, count: leads.length, created_at: new Date().toISOString() };
    const updated = [...smartLists, newList]; setSmartLists(updated);
    localStorage.setItem('intralys_smart_lists', JSON.stringify(updated));
  };
  const loadSmartList = (sl: SmartList) => { setStatusFilter((sl.filters.status as string) || ''); setSourceFilter((sl.filters.source as string) || ''); setClientFilter((sl.filters.client_id as string) || ''); setSearch((sl.filters.search as string) || ''); };
  const deleteSmartList = (id: string) => { const updated = smartLists.filter(s => s.id !== id); setSmartLists(updated); localStorage.setItem('intralys_smart_lists', JSON.stringify(updated)); };

  const getClientName = (lead: Lead) => lead.client_name || clients.find(c => c.id === lead.client_id)?.name || lead.client_id;

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000); const diffH = Math.floor(diffMin / 60); const diffD = Math.floor(diffH / 24);
    if (diffMin < 60) return `il y a ${diffMin} min`; if (diffH < 24) return `il y a ${diffH}h`;
    if (diffD === 1) return 'hier'; if (diffD < 7) return `il y a ${diffD}j`;
    return new Date(dateStr).toLocaleDateString('fr-CA');
  };

  const toggleSort = (col: typeof sortBy) => { if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(col); setSortDir('desc'); } };
  const sortedLeads = [...leads].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'name') return a.name.localeCompare(b.name) * dir;
    if (sortBy === 'score') return (a.score - b.score) * dir;
    if (sortBy === 'deal_value') return ((a.deal_value || 0) - (b.deal_value || 0)) * dir;
    return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
  });

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return <ArrowUpDown size={12} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-[var(--brand-primary)]" /> : <ChevronDown size={12} className="text-[var(--brand-primary)]" />;
  };

  const hasFilters = !!(search || statusFilter || sourceFilter || clientFilter);
  const newCount = leads.filter(l => l.status === 'new').length;
  const wonCount = leads.filter(l => l.status === 'won').length;

  return (
    <AppLayout title="Leads">
      {/* Quick stats pills */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)]">
          <Users size={14} className="text-[var(--brand-primary)]" />
          {leads.length} leads
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)]">
          <UserPlus size={14} className="text-[var(--info)]" />
          {newCount} nouveaux
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)]">
          <Zap size={14} className="text-[var(--success)]" />
          {wonCount} gagnés
        </div>

        <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)} className="ml-auto">
          Nouveau lead
        </Button>

        <div className="flex items-center gap-1">
          <button onClick={() => setViewMode('table')}
            className={`p-1.5 rounded-[var(--radius-xs)] cursor-pointer transition-all ${viewMode === 'table' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'}`}>
            <LayoutList size={16} />
          </button>
          <button onClick={() => setViewMode('cards')}
            className={`p-1.5 rounded-[var(--radius-xs)] cursor-pointer transition-all ${viewMode === 'cards' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'}`}>
            <LayoutGrid size={16} />
          </button>
          <button onClick={() => setViewMode('map')}
            className={`p-1.5 rounded-[var(--radius-xs)] cursor-pointer transition-all ${viewMode === 'map' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'}`}
            title="Vue carte (Mapbox)">
            <Map size={16} />
          </button>
        </div>
      </div>

      {/* Toolbar filtres */}
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <Input placeholder="Rechercher par nom, email, téléphone..." id="search-all-leads"
              value={search} onChange={(e) => setSearch(e.target.value)} leftIcon={<Search size={16} />} />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-[38px] px-3 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] hover:border-[var(--border-strong)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none">
            <option value="">Tous les statuts</option>
            {LEAD_STATUSES.map(s => (<option key={s} value={s}>{STATUS_LABELS[s]}</option>))}
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
            className="h-[38px] px-3 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] hover:border-[var(--border-strong)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none">
            <option value="">Toutes les sources</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
            className="h-[38px] px-3 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] hover:border-[var(--border-strong)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none">
            <option value="">Tous les clients</option>
            {clients.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          {hasFilters && (
            <>
              <Button variant="ghost" size="sm" leftIcon={<X size={14} />}
                onClick={() => { setSearch(''); setStatusFilter(''); setSourceFilter(''); setClientFilter(''); }}>
                Réinitialiser
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<Save size={14} />} onClick={saveSmartList}>
                Sauvegarder
              </Button>
            </>
          )}
          <Button variant="secondary" size="sm" leftIcon={<Download size={14} />}
            onClick={() => void exportLeadsCsv({ status: statusFilter || undefined, client_id: clientFilter || undefined })}>
            Export
          </Button>
        </div>
        {/* Smart Lists chips */}
        {smartLists.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--border-subtle)]">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider self-center">Listes :</span>
            {smartLists.map(sl => (
              <span key={sl.id} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] cursor-pointer hover:bg-[var(--brand-primary)] hover:text-white transition-colors">
                <button onClick={() => loadSmartList(sl)} className="cursor-pointer">{sl.name}</button>
                <button onClick={() => deleteSmartList(sl.id)} className="opacity-50 hover:opacity-100 cursor-pointer"><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Contenu */}
      {isLoading ? (
        <Card><Skeleton className="h-96 w-full" /></Card>
      ) : leads.length === 0 ? (
        <EmptyState icon={<Users size={48} />} title="Aucun lead trouvé" description="Aucun lead ne correspond à vos filtres."
          action={<Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); }}>Réinitialiser</Button>} />
      ) : viewMode === 'map' ? (
        /* ── Vue Carte ── */
        <LeadsMapView leads={sortedLeads} />
      ) : viewMode === 'cards' ? (
        /* ── Vue Cartes ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {sortedLeads.map(lead => {
            const scoreColor = lead.score >= 70 ? 'var(--success)' : lead.score >= 40 ? 'var(--warning)' : 'var(--danger)';
            const longPressProps = useLongPress(() => openNotes(lead), undefined, { delay: 600 });
            return (
              <SwipeAction 
                key={lead.id}
                rightActions={
                  <div className="flex gap-2 justify-end w-full pr-2">
                    <button className="w-12 h-12 bg-[var(--danger)] text-white rounded-[var(--radius-lg)] flex items-center justify-center shadow-sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleStatusChange(lead.id, 'lost'); }}>
                      <X size={20} />
                    </button>
                    <button className="w-12 h-12 bg-[var(--success)] text-white rounded-[var(--radius-lg)] flex items-center justify-center shadow-sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleStatusChange(lead.id, 'won'); }}>
                      <Check size={20} />
                    </button>
                  </div>
                }
                rightThreshold={110}
              >
                <div {...longPressProps}>
                  <Link to={`/leads/${lead.id}`}
                    className="block bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 hover:border-[var(--brand-primary)] transition-all hover:shadow-[var(--shadow-md)] card-lift relative z-10">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={lead.name} size="sm" />
                    <div>
                      <p className="text-[13px] font-medium text-[var(--text-primary)]">{lead.name}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{getClientName(lead)}</p>
                    </div>
                  </div>
                  <Badge color={lead.type === 'inbound' ? 'var(--brand-primary)' : 'var(--warning)'}>{lead.type === 'inbound' ? 'Entrant' : 'Client'}</Badge>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge color={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                  {lead.deal_value > 0 && <span className="text-[10px] font-semibold text-[var(--brand-primary)]">{lead.deal_value.toLocaleString('fr-CA')} $</span>}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${lead.score}%`, background: scoreColor }} />
                  </div>
                  <span className="text-[10px] font-bold" style={{ color: scoreColor }}>{lead.score}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                  <span>{lead.email}</span>
                  <span>{timeAgo(lead.created_at)}</span>
                </div>
                {lead.tags && lead.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {lead.tags.slice(0, 3).map(t => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-muted)] text-[var(--text-muted)]">{t}</span>)}
                  </div>
                )}
              </Link>
                </div>
              </SwipeAction>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          {/* Bulk bar */}
          {selectedIds.size > 0 && (
            <div className="px-4 py-2.5 bg-[var(--brand-tint)] border-b border-[var(--brand-primary)]/20 flex items-center gap-3 animate-slide-down">
              <span className="text-xs font-semibold text-[var(--brand-primary)]">{selectedIds.size} sélectionné(s)</span>
              <select onChange={(e) => { if (e.target.value) void bulkChangeStatus(e.target.value as LeadStatus); e.target.value = ''; }}
                className="text-xs px-2 py-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-xs)] cursor-pointer">
                <option value="">Changer statut...</option>
                {LEAD_STATUSES.map(s => (<option key={s} value={s}>{STATUS_LABELS[s]}</option>))}
              </select>
              <Button variant="ghost" size="sm" onClick={bulkTrash} className="text-[var(--danger)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]" leftIcon={<Trash2 size={14} />}>
                Supprimer
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Annuler</Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={selectedIds.size === leads.length && leads.length > 0} onChange={toggleSelectAll} className="rounded cursor-pointer accent-[var(--brand-primary)]" />
                  </th>
                  <th onClick={() => toggleSort('name')} className="group text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--brand-primary)] select-none">
                    <span className="inline-flex items-center gap-1">Nom <SortIcon col="name" /></span>
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Client</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Contact</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Statut</th>
                  <th onClick={() => toggleSort('score')} className="group text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--brand-primary)] select-none">
                    <span className="inline-flex items-center gap-1">Score <SortIcon col="score" /></span>
                  </th>
                  <th onClick={() => toggleSort('created_at')} className="group text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--brand-primary)] select-none">
                    <span className="inline-flex items-center gap-1">Date <SortIcon col="created_at" /></span>
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider w-16"></th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead, index) => {
                  const scoreColor = lead.score >= 70 ? 'var(--success)' : lead.score >= 40 ? 'var(--warning)' : 'var(--danger)';
                  return (
                    <tr key={lead.id}
                      className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)] transition-colors ${selectedIds.has(lead.id) ? 'bg-[var(--brand-tint)]' : ''}`}
                      style={{ animationDelay: `${index * 20}ms` }}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)} className="rounded cursor-pointer accent-[var(--brand-primary)]" />
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/leads/${lead.id}`} className="flex items-center gap-2.5 hover:text-[var(--brand-primary)] transition-colors">
                          <Avatar name={lead.name} size="xs" />
                          <div>
                            <p className="font-medium text-[var(--text-primary)] text-[13px]">{lead.name}</p>
                            {lead.message && <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate max-w-56">{lead.message}</p>}
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-1 rounded-[var(--radius-xs)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] font-medium">{getClientName(lead)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] text-[var(--text-secondary)]">{lead.email}</p>
                        {lead.phone && <p className="text-[11px] text-[var(--text-muted)]">{lead.phone}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={lead.type === 'inbound' ? 'var(--brand-primary)' : 'var(--warning)'}>{lead.type === 'inbound' ? 'Entrant' : 'Client'}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <select value={lead.status} onChange={(e) => void handleStatusChange(lead.id, e.target.value as LeadStatus)}
                          className="text-xs px-2 py-1 bg-transparent border border-[var(--border-subtle)] rounded-[var(--radius-xs)] focus:outline-none cursor-pointer hover:border-[var(--border-strong)]"
                          style={{ color: STATUS_COLORS[lead.status] }}>
                          {LEAD_STATUSES.map(s => (<option key={s} value={s}>{STATUS_LABELS[s]}</option>))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${lead.score}%`, background: scoreColor }} />
                          </div>
                          <span className="text-[10px] font-semibold w-5 text-right" style={{ color: scoreColor }}>{lead.score}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-[var(--text-muted)] whitespace-nowrap">{timeAgo(lead.created_at)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => openNotes(lead)} className="p-1.5 rounded-[var(--radius-xs)] text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer" title="Notes">
                          {lead.notes ? <StickyNote size={14} /> : <MoreHorizontal size={14} />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal — Nouveau lead */}
      <Modal open={createOpen} onOpenChange={closeCreate} title="Nouveau lead">
        <div className="space-y-3">
          {createError && (
            <div className="text-xs text-[var(--danger)] px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--danger)]/10 border border-[var(--danger)]/20">
              {createError}
            </div>
          )}
          <div>
            <label htmlFor="new-lead-client" className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">
              Client <span className="text-[var(--danger)]">*</span>
            </label>
            <select id="new-lead-client" value={createForm.client_id}
              onChange={(e) => setCreateForm(f => ({ ...f, client_id: e.target.value }))}
              className="w-full h-[38px] px-3 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] text-[var(--text-primary)] hover:border-[var(--border-strong)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none">
              <option value="">Sélectionner un client...</option>
              {clients.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-lead-name" className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">
                Nom <span className="text-[var(--danger)]">*</span>
              </label>
              <Input id="new-lead-name" value={createForm.name}
                onChange={(e) => setCreateForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Jean Tremblay" />
            </div>
            <div>
              <label htmlFor="new-lead-email" className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">
                Email <span className="text-[var(--danger)]">*</span>
              </label>
              <Input id="new-lead-email" type="email" value={createForm.email}
                onChange={(e) => setCreateForm(f => ({ ...f, email: e.target.value }))}
                placeholder="jean@exemple.com" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-lead-phone" className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Téléphone</label>
              <Input id="new-lead-phone" value={createForm.phone}
                onChange={(e) => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="514-555-1234" />
            </div>
            <div>
              <label htmlFor="new-lead-source" className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Source</label>
              <select id="new-lead-source" value={createForm.source}
                onChange={(e) => setCreateForm(f => ({ ...f, source: e.target.value }))}
                className="w-full h-[38px] px-3 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] text-[var(--text-primary)] hover:border-[var(--border-strong)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none">
                <option value="manual">Manuel</option>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="new-lead-type" className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Type</label>
            <select id="new-lead-type" value={createForm.type}
              onChange={(e) => setCreateForm(f => ({ ...f, type: e.target.value as 'inbound' | 'customer' }))}
              className="w-full h-[38px] px-3 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] text-[var(--text-primary)] hover:border-[var(--border-strong)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none">
              <option value="inbound">Entrant (prospect)</option>
              <option value="customer">Client existant</option>
            </select>
          </div>
          <div>
            <label htmlFor="new-lead-message" className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Note initiale</label>
            <textarea id="new-lead-message" value={createForm.message}
              onChange={(e) => setCreateForm(f => ({ ...f, message: e.target.value }))}
              rows={3} placeholder="Contexte du lead, source détaillée, prochaines étapes..."
              className="w-full px-3 py-2.5 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={closeCreate} disabled={createSubmitting}>Annuler</Button>
            <Button onClick={() => void handleCreateLead()} disabled={createSubmitting}>
              {createSubmitting ? 'Création...' : 'Créer le lead'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Notes */}
      <Modal open={!!selectedLead} onOpenChange={() => setSelectedLead(null)} title={`Notes — ${selectedLead?.name || ''}`}>
        {selectedLead && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-[var(--text-muted)]">Email : </span><span className="text-[var(--text-primary)]">{selectedLead.email}</span></div>
              <div><span className="text-[var(--text-muted)]">Téléphone : </span><span className="text-[var(--text-primary)]">{selectedLead.phone || '—'}</span></div>
              <div><span className="text-[var(--text-muted)]">Type : </span><Badge color={selectedLead.type === 'inbound' ? 'var(--brand-primary)' : 'var(--warning)'}>{selectedLead.type === 'inbound' ? 'Entrant' : 'Client'}</Badge></div>
              <div><span className="text-[var(--text-muted)]">Statut : </span><Badge color={STATUS_COLORS[selectedLead.status]}>{STATUS_LABELS[selectedLead.status]}</Badge></div>
            </div>
            {selectedLead.message && (
              <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-sm">
                <p className="text-xs text-[var(--text-muted)] mb-1">Message du lead :</p>
                <p className="text-[var(--text-primary)]">{selectedLead.message}</p>
              </div>
            )}
            <div>
              <label htmlFor="lead-notes" className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Notes internes</label>
              <textarea id="lead-notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={4} placeholder="Ajouter des notes sur ce lead..."
                className="w-full px-3 py-2.5 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none" />
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