// ── Page Leads — Liste globale + Vue Carte (Sprint 6 D3) ─────

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, EmptyState, PageHero, LoadMore, SmartBanner, Select } from '@/components/ui';
import { t } from '@/lib/i18n';
import { LeadLink } from '@/components/panels/LeadLink';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { getLeads, getClients, updateLead, exportLeadsCsv, createLead, restoreLead, aiSummarizeLeads, getAiStatus, getLeadConversionScore, bulkLeads, importLeadsCsv, exportConfigurableCsv, type AiBatchLeadSummary } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, SOURCE_LABELS, LEAD_STATUSES, type Lead, type LeadStatus, type Client, type SmartList } from '@/lib/types';
import { Search, X, Download, Upload, Save, LayoutGrid, LayoutList, Map, MoreHorizontal, ArrowUpDown, ChevronUp, ChevronDown, StickyNote, Users, UserPlus, Zap, ExternalLink, Check, Plus, Trash2, Sparkles, Loader2, Flame, Phone, Mail, Archive } from 'lucide-react';
import { SwipeAction } from '@/components/ui/SwipeAction';
import { useLongPress } from '@/hooks/useLongPress';
import { useToast, useConfirm, usePrompt } from '@/components/ui';
// Sprint 21 — Onboarding durci : GuidedEmptyState pour l'empty first-time
// (enrichi avec meta + bouton "Passer" qui skip l'item checklist côté serveur).
import { GuidedEmptyState } from '@/components/onboarding/GuidedEmptyState';

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

// Hash déterministe d'un string → [0, 1) — pour offset stable des pins sans coord
function stableOffset(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

// Composant Map (Mapbox ou fallback SVG mock)
function LeadsMapView({ leads }: { leads: Lead[] }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState(false);
  const [selectedPin, setSelectedPin] = useState<Lead | null>(null);

  // Enrichir les leads avec des coordonnées déterministes si manquantes (offset hashé sur lead.id)
  // → les pins ne bougent plus à chaque render, contrairement à Math.random() qui rendait la carte mensongère.
  const enrichedLeads = leads.slice(0, 50).map((lead, i) => {
    const fixture = QC_FIXTURES[i % QC_FIXTURES.length]!;
    const offsetLat = (stableOffset(lead.id + ':lat') - 0.5) * 0.1;
    const offsetLng = (stableOffset(lead.id + ':lng') - 0.5) * 0.1;
    return {
      ...lead,
      lat: (lead as Lead & { lat?: number }).lat || fixture.lat + offsetLat,
      lng: (lead as Lead & { lng?: number }).lng || fixture.lng + offsetLng,
    };
  });

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
      <div className="relative surface-card overflow-hidden" style={{ height: 520 }}>
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
            const x = 5 + (i % 6) * 16 + stableOffset(lead.id + ':x') * 4;
            const y = 10 + Math.floor(i / 6) * 22 + stableOffset(lead.id + ':y') * 4;
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
        <div className="absolute bottom-4 left-4 flex items-center gap-3 bg-[var(--gray-900)]/80 backdrop-blur px-3 py-2 rounded-lg text-xs animate-fade-in-up stagger-2">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> Score ≥70</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-500" /> 40-69</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500" /> &lt;40</span>
          <span className="text-[var(--text-muted)] ml-2">| Configurez VITE_MAPBOX_TOKEN pour la vraie carte</span>
        </div>
        {/* Popup */}
        {selectedPin && (
          <div className="absolute top-4 right-4 surface-card p-3 max-w-48 z-10 animate-fade-in-up">
            <p className="font-semibold text-sm text-[var(--text-primary)]">{selectedPin.name}</p>
            <p className="text-xs text-[var(--text-muted)]">{selectedPin.email}</p>
            <p className="text-xs mt-1" style={{ color: scoreColor(selectedPin.score) }}>Score : {selectedPin.score}</p>
            <LeadLink leadId={selectedPin.id}
              className="flex items-center gap-1 text-xs text-[var(--primary)] mt-1.5 hover:underline">
              <ExternalLink size={10} /> Voir le profil
            </LeadLink>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative rounded-[var(--radius-lg)] overflow-hidden" style={{ height: 520 }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      {selectedPin && (
        <div className="absolute top-4 right-4 surface-card p-3 max-w-48 z-10 animate-fade-in-up">
          <p className="font-semibold text-sm text-[var(--text-primary)]">{selectedPin.name}</p>
          <p className="text-xs text-[var(--text-muted)]">{selectedPin.email}</p>
          <LeadLink leadId={selectedPin.id}
            className="flex items-center gap-1 text-xs text-[var(--primary)] mt-1.5 hover:underline">
            <ExternalLink size={10} /> Voir le profil
          </LeadLink>
        </div>
      )}
    </div>
  );
}

export function LeadsPage() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importClientId, setImportClientId] = useState('');
  const [importing, setImporting] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // ── LOT RÉEL (Manager B) — pagination curseur + bannière IA mock (ADDITIF) ──
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [aiMock, setAiMock] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => localStorage.getItem('intralys_leads_filter_status') || '');
  const [sourceFilter, setSourceFilter] = useState(() => localStorage.getItem('intralys_leads_filter_source') || '');
  const [clientFilter, setClientFilter] = useState(() => localStorage.getItem('intralys_leads_filter_client') || '');
  // Sprint MULTILANG-B — filtre langue préférée (additif optionnel).
  const [langFilter, setLangFilter] = useState(() => localStorage.getItem('intralys_leads_filter_lang') || '');

  useEffect(() => {
    localStorage.setItem('intralys_leads_filter_status', statusFilter);
    localStorage.setItem('intralys_leads_filter_source', sourceFilter);
    localStorage.setItem('intralys_leads_filter_client', clientFilter);
    localStorage.setItem('intralys_leads_filter_lang', langFilter);
  }, [statusFilter, sourceFilter, clientFilter, langFilter]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Sprint 21 : AI batch summarize
  const [batchSummary, setBatchSummary] = useState<AiBatchLeadSummary | null>(null);
  const [isBatchSummarizing, setIsBatchSummarizing] = useState(false);

  const handleBatchSummarize = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setIsBatchSummarizing(true);
    const res = await aiSummarizeLeads(ids);
    setIsBatchSummarizing(false);
    if (res.data) setBatchSummary(res.data);
  };
  const [smartLists, setSmartLists] = useState<SmartList[]>(() => {
    try { return JSON.parse(localStorage.getItem('intralys_smart_lists') || '[]') as SmartList[]; } catch { return []; }
  });
  const [viewMode, setViewMode] = useState<'table' | 'cards' | 'map'>('table');
  const [sortBy, setSortBy] = useState<'name' | 'score' | 'created_at' | 'deal_value'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // ── Sprint 13 — proba de conversion calibrée + filtre « leads chauds ». ──
  // Best-effort : map leadId → probabilité (0..100). Score absent ⇒ pas d'entrée
  // (badge masqué). Le filtre « leads chauds » ne masque rien tant que les probas
  // ne sont pas chargées (évite une liste qui « clignote » vide).
  const [convProba, setConvProba] = useState<Record<string, number>>({});
  const [hotOnly, setHotOnly] = useState(false);
  const HOT_THRESHOLD = 60; // proba calibrée ≥ 60 % = lead chaud
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const emptyCreateForm = { client_id: '', name: '', email: '', phone: '', source: 'manual', message: '', type: 'inbound' as 'inbound' | 'customer' };
  const [createForm, setCreateForm] = useState(emptyCreateForm);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [leadsResult, clientsResult] = await Promise.all([
      getLeads({ status: statusFilter || undefined, search: search || undefined, source: sourceFilter || undefined, client_id: clientFilter || undefined, language: langFilter || undefined }),
      getClients(),
    ]);
    if (leadsResult.data) setLeads(leadsResult.data);
    if (clientsResult.data) setClients(clientsResult.data);
    // ── LOT RÉEL (Manager B) — curseur additif : reset à chaque (re)chargement
    setNextCursor(leadsResult.next_cursor ?? null);
    setIsLoading(false);
  }, [statusFilter, search, sourceFilter, clientFilter, langFilter]);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── LOT RÉEL (Manager B) — statut mode IA (mock) au mount ──
  useEffect(() => {
    let alive = true;
    void getAiStatus().then(s => { if (alive) setAiMock(s.ai_mock); });
    return () => { alive = false; };
  }, []);

  // ── Sprint 13 — proba de conversion calibrée par lead (best-effort) ──
  // Borné à 30 leads pour éviter un fan-out massif d'appels. Chaque appel est
  // isolé (catch) : un échec n'altère ni la liste ni les autres probas. Score
  // absent / KO ⇒ pas d'entrée dans la map ⇒ badge masqué (jamais de crash).
  useEffect(() => {
    let alive = true;
    const targets = leads.slice(0, 30);
    if (targets.length === 0) return;
    void Promise.all(
      targets.map(async (l) => {
        try {
          const r = await getLeadConversionScore(l.id);
          const p = r.data?.probability;
          if (typeof p === 'number' && p > 0) return [l.id, p] as const;
        } catch { /* best-effort */ }
        return null;
      }),
    ).then((pairs) => {
      if (!alive) return;
      const next: Record<string, number> = {};
      for (const pair of pairs) if (pair) next[pair[0]] = pair[1];
      setConvProba(next);
    });
    return () => { alive = false; };
  }, [leads]);

  // ── LOT RÉEL (Manager B) — "charger plus" via curseur (append) ──
  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const res = await getLeads({
      status: statusFilter || undefined,
      search: search || undefined,
      source: sourceFilter || undefined,
      client_id: clientFilter || undefined,
      language: langFilter || undefined,
      cursor: nextCursor,
    });
    if (res.data) {
      setLeads(prev => {
        const seen = new Set(prev.map(l => l.id));
        return [...prev, ...res.data!.filter(l => !seen.has(l.id))];
      });
    }
    setNextCursor(res.next_cursor ?? null);
    setLoadingMore(false);
  }, [nextCursor, loadingMore, statusFilter, search, sourceFilter, clientFilter, langFilter]);

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    const result = await updateLead(leadId, { status: newStatus });
    if (!result.error) {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
      success(t('leads.page.toast_status_updated'));
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
      success(t('leads.page.toast_notes_saved'));
    } else {
      toastError(result.error);
    }
  };

  const openNotes = (lead: Lead) => { setSelectedLead(lead); setEditNotes(lead.notes || ''); };

  const handleCreateLead = async () => {
    setCreateError(null);
    if (!createForm.client_id || !createForm.name.trim() || !createForm.email.trim()) {
      setCreateError(t('leads.page.create_required_error'));
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
    
    success(t('leads.page.toast_lead_created'), { title: t('leads.page.toast_action_success') });
    setCreateOpen(false);
    setCreateForm(emptyCreateForm);
    void loadData();
  };
  const closeCreate = () => { if (!createSubmitting) { setCreateOpen(false); setCreateError(null); } };

  const handleImportClick = () => {
    if (clientFilter) {
      setImportClientId(clientFilter);
      setTimeout(() => fileInputRef.current?.click(), 100);
    } else {
      setImportModalOpen(true);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !importClientId) return;
    
    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target?.result as string;
      try {
        const res = await importLeadsCsv(importClientId, csvText);
        if (res.error) {
          toastError(res.error);
        } else if (res.data) {
          const { imported, skipped, errors } = res.data;
          success(`Import réussi : ${imported} importés, ${skipped} sautés.`);
          if (errors && errors.length > 0) {
            toastError(`${errors.length} erreurs lors de l'import : ${errors.slice(0, 3).join(', ')}`);
          }
          void loadData();
        }
      } catch (err: any) {
        toastError(err?.message || "Erreur d'importation");
      } finally {
        setImporting(false);
        setImportModalOpen(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === leads.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(leads.map(l => l.id)));
  };
  const bulkChangeStatus = async (status: LeadStatus) => {
    const ids = Array.from(selectedIds);
    const res = await bulkLeads(ids, 'change_status', status);
    if (res.error) {
      toastError(res.error);
    } else {
      setSelectedIds(new Set());
      void loadData();
      success(`${ids.length} prospects mis à jour`);
    }
  };

  const bulkTrash = async () => {
    const ok = await confirm({
      title: 'Déplacer vers la corbeille ?',
      description: `${selectedIds.size} prospect${selectedIds.size > 1 ? 's' : ''} ${selectedIds.size > 1 ? 'seront déplacés' : 'sera déplacé'} vers la corbeille. Vous pourrez les restaurer pendant 30 jours.`,
      confirmLabel: 'Déplacer',
      danger: true,
    });
    if (!ok) return;

    const ids = Array.from(selectedIds);
    const res = await bulkLeads(ids, 'delete');
    
    setSelectedIds(new Set());
    void loadData();

    if (!res.error) {
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
      toastError(res.error || "Une erreur s'est produite lors de la suppression groupée");
    }
  };

  const saveSmartList = async () => {
    const name = await prompt({
      title: 'Sauvegarder cette vue',
      description: 'Donne un nom à cette combinaison de filtres pour la retrouver rapidement.',
      placeholder: 'Ex: Leads chauds Facebook',
      confirmLabel: 'Sauvegarder',
    });
    if (!name) return;
    const newList: SmartList = { id: `sl-${Date.now()}`, user_id: 'local', client_id: 'local', name, filters: { status: statusFilter || undefined, source: sourceFilter || undefined, client_id: clientFilter || undefined, search: search || undefined, language: langFilter || undefined }, count: leads.length, created_at: new Date().toISOString() };
    const updated = [...smartLists, newList]; setSmartLists(updated);
    localStorage.setItem('intralys_smart_lists', JSON.stringify(updated));
    success(`Vue "${name}" sauvegardée`);
  };
  const loadSmartList = (sl: SmartList) => { setStatusFilter((sl.filters.status as string) || ''); setSourceFilter((sl.filters.source as string) || ''); setClientFilter((sl.filters.client_id as string) || ''); setSearch((sl.filters.search as string) || ''); setLangFilter((sl.filters.language as string) || ''); };
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
  // Sprint 13 — filtre « leads chauds » : proba calibrée ≥ seuil. Best-effort —
  // si aucune proba n'est encore chargée, on n'écrème pas (évite une liste vide).
  const hasAnyConvProba = Object.keys(convProba).length > 0;
  const filteredLeads = (hotOnly && hasAnyConvProba)
    ? leads.filter(l => (convProba[l.id] ?? 0) >= HOT_THRESHOLD)
    : leads;
  const sortedLeads = [...filteredLeads].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'name') return a.name.localeCompare(b.name) * dir;
    if (sortBy === 'score') return (a.score - b.score) * dir;
    if (sortBy === 'deal_value') return ((a.deal_value || 0) - (b.deal_value || 0)) * dir;
    return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
  });

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return <ArrowUpDown size={12} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-[var(--primary)]" /> : <ChevronDown size={12} className="text-[var(--primary)]" />;
  };

  const hasFilters = !!(search || statusFilter || sourceFilter || clientFilter || langFilter);
  const newCount = leads.filter(l => l.status === 'new').length;
  const wonCount = leads.filter(l => l.status === 'won').length;

  return (
    <AppLayout title={t('leads.page.title')}>
      <PageHero
        meta={t('leads.page.meta')}
        title={`${leads.length} ${t('leads.page.title')}`}
        highlight={t('leads.page.title')}
        description={t('leads.page.description')}
        actions={
          <Button variant="premium" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            {t('leads.action.new')}
          </Button>
        }
      />
      {/* LOT RÉEL (Manager B) — bannière IA mock (visible si /api/health ai_mock=true) */}
      {aiMock && (
        <SmartBanner
          variant="ai"
          dismissKey="leads_ai_mock"
          title={t('ai.mock.banner_title')}
          description={t('ai.mock.banner_desc')}
          secondaryLabel={t('ai.mock.badge')}
        />
      )}
      {/* Quick stats pills */}
      {/* Pilules KPI rapides */}
      <div className="flex flex-wrap items-center gap-3 mb-5 animate-stagger stagger-1">
        <div className="stat-card-s1 flex items-center gap-2 !px-3 !py-1.5">
          <span className="kpi-icon-chip-s1" style={{ background: 'var(--primary-soft)', width: 28, height: 28 }}><Users size={14} className="text-[var(--primary)]" /></span>
          <span className="text-xs font-medium text-[var(--text-secondary)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{leads.length} leads</span>
        </div>
        <div className="stat-card-s1 flex items-center gap-2 !px-3 !py-1.5">
          <span className="kpi-icon-chip-s1" style={{ background: 'var(--primary-soft)', width: 28, height: 28 }}><UserPlus size={14} className="text-[var(--info)]" /></span>
          <span className="text-xs font-medium text-[var(--text-secondary)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{newCount} {t('leads.page.kpi_new').toLowerCase()}</span>
        </div>
        <div className="stat-card-s1 flex items-center gap-2 !px-3 !py-1.5">
          <span className="kpi-icon-chip-s1" style={{ background: 'var(--success-soft)', width: 28, height: 28 }}><Zap size={14} className="text-[var(--success)]" /></span>
          <span className="text-xs font-medium text-[var(--text-secondary)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{wonCount} {t('leads.page.kpi_won').toLowerCase()}</span>
        </div>

        {/* Sprint 13 — filtre « leads chauds » (proba calibrée ≥ seuil). Affiché
            seulement quand au moins une proba a été chargée (best-effort). */}
        {hasAnyConvProba && (
          <button
            onClick={() => setHotOnly(v => !v)}
            aria-pressed={hotOnly}
            title={t('conversion.hot_leads')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all press-scale ${
              hotOnly
                ? 'bg-[var(--primary)] text-white border border-[var(--primary)]'
                : 'surface-card !shadow-none text-[var(--text-secondary)] hover:border-[var(--primary)]'
            }`}>
            <Flame size={14} className={hotOnly ? 'text-white' : 'text-[var(--accent-orange)]'} />
            {t('conversion.hot_leads')}
          </button>
        )}

        {/* Segmented control vue */}
        <div className="segmented-s1 ml-auto">
          <button onClick={() => setViewMode('table')}
            aria-label={t('leads.page.view_table')} aria-selected={viewMode === 'table'}
            className={`press-scale ${viewMode === 'table' ? 'active' : ''}`}>
            <LayoutList size={16} />
          </button>
          <button onClick={() => setViewMode('cards')}
            aria-label={t('leads.page.view_cards')} aria-selected={viewMode === 'cards'}
            className={`press-scale ${viewMode === 'cards' ? 'active' : ''}`}>
            <LayoutGrid size={16} />
          </button>
          <button onClick={() => setViewMode('map')}
            aria-selected={viewMode === 'map'}
            className={`press-scale ${viewMode === 'map' ? 'active' : ''}`}
            title={t('leads.page.view_map_title')} aria-label={t('leads.page.view_map_title')}>
            <Map size={16} />
          </button>
        </div>
      </div>

      {/* Toolbar filtres */}
      <Card className="p-4 mb-4 animate-stagger stagger-2">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <Input placeholder={t('leads.search.placeholder')} id="search-all-leads"
              value={search} onChange={(e) => setSearch(e.target.value)} leftIcon={<Search size={16} />} />
          </div>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} size="md">
            <option value="">{t('leads.filter.all_statuses')}</option>
            {LEAD_STATUSES.map(s => (<option key={s} value={s}>{STATUS_LABELS[s]}</option>))}
          </Select>
          <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} size="md">
            <option value="">{t('leads.filter.all_sources')}</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </Select>
          <Select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} size="md">
            <option value="">{t('leads.filter.all_clients')}</option>
            {clients.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </Select>
          {/* Sprint MULTILANG-B — filtre langue préférée (additif) */}
          <Select value={langFilter} onChange={(e) => setLangFilter(e.target.value)} size="md">
            <option value="">{t('leads.language.default')}</option>
            <option value="fr-CA">Français (QC)</option>
            <option value="fr-FR">Français (FR)</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </Select>
          {hasFilters && (
            <>
              <Button variant="ghost" size="sm" leftIcon={<X size={14} />}
                onClick={() => { setSearch(''); setStatusFilter(''); setSourceFilter(''); setClientFilter(''); setLangFilter(''); }}>
                {t('action.reset')}
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<Save size={14} />} onClick={saveSmartList}>
                {t('leads.page.save_view')}
              </Button>
            </>
          )}
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => void handleFileChange(e)}
            accept=".csv"
            className="hidden"
            aria-label="Fichier CSV à importer"
          />
          <Button variant="secondary" size="sm" leftIcon={<Upload size={14} />} onClick={handleImportClick} disabled={importing}>
            {importing ? "Importation..." : "Importer CSV"}
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<Download size={14} />}
            onClick={() => void exportLeadsCsv({ status: statusFilter || undefined, client_id: clientFilter || undefined })}>
            Export Standard
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<Download size={14} />}
            onClick={() => void exportConfigurableCsv('leads')}>
            Export Configurable
          </Button>
        </div>
        {/* Smart Lists chips */}
        {smartLists.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--border-subtle)]">
            <span className="text-meta-label self-center">{t('leads.page.smart_lists_label')}</span>
            {smartLists.map(sl => (
              <span key={sl.id} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] cursor-pointer hover:bg-[var(--primary)] hover:text-white transition-colors">
                <button onClick={() => loadSmartList(sl)} className="cursor-pointer">{sl.name}</button>
                <button onClick={() => deleteSmartList(sl.id)} className="opacity-50 hover:opacity-100 cursor-pointer" aria-label={t('action.delete')}><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Contenu */}
      {isLoading ? (
        <Card aria-busy="true" aria-live="polite"><div className="skeleton-shimmer h-96 w-full" /></Card>
      ) : leads.length === 0 ? (
        hasFilters ? (
          <EmptyState icon={<Users size={48} />} title={t('leads.empty.search_title')}
            description={t('leads.empty.search_desc', { query: search || statusFilter })}
            action={<Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); setSourceFilter(''); setClientFilter(''); setLangFilter(''); }}>{t('leads.filter.all')}</Button>} />
        ) : (
          // Sprint 21 (Onboarding durci) — empty first-time guidé : ajoute
          // meta "Étape de configuration" + bouton secondaire "Passer" qui
          // appelle skipOnboardingItem('leads_imported'). CTA principal +
          // titre/desc/icon préservés à l'identique.
          <GuidedEmptyState
            itemKey="leads_imported"
            icon={<Users size={48} />}
            title={t('leads.empty.title')}
            description={t('leads.empty.description')}
            action={<Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>{t('leads.action.new')}</Button>}
          />
        )
      ) : viewMode === 'map' ? (
        /* ── Vue Carte ── */
        <LeadsMapView leads={sortedLeads} />
      ) : viewMode === 'cards' ? (
        /* ── Vue Cartes ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 animate-stagger stagger-3">
          {sortedLeads.map(lead => {
            const scoreColor = lead.score >= 70 ? 'var(--success)' : lead.score >= 40 ? 'var(--warning)' : 'var(--danger)';
            const longPressProps = useLongPress(() => openNotes(lead), undefined, { delay: 600 });
            const proba = convProba[lead.id];
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
                  <LeadLink leadId={lead.id}
                    className={`block relative z-10 p-4 stripe-card hover-lift-stripe press-scale ${lead.score >= 70 ? 'card-premium-hot' : ''}`}>
                {lead.score >= 70 && (
                  <span className="badge-hot">HOT {lead.score}</span>
                )}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={lead.name} size="sm" />
                    <div>
                      <p className="text-card-title">{lead.name}</p>
                      <p className="text-meta-label">{getClientName(lead)}</p>
                    </div>
                  </div>
                  <Badge color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>{lead.type === 'inbound' ? t('lead.type.inbound') : t('lead.type.customer')}</Badge>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge color={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                  {lead.deal_value > 0 && <span className="text-meta-label text-[var(--primary)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{lead.deal_value.toLocaleString('fr-CA')} $</span>}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="score-bar-s1 flex-1">
                    <div className="score-fill" style={{ width: `${lead.score}%`, background: scoreColor }} />
                  </div>
                  <span className="text-[10px] font-bold" style={{ color: scoreColor, fontVariantNumeric: 'tabular-nums' }}>{lead.score}</span>
                  {/* Sprint 13 — badge proba conversion calibrée (best-effort) */}
                  {proba !== undefined && (
                    <span
                      title={t('conversion.probability')}
                      className="inline-flex items-center gap-0.5 px-1.5 h-[16px] rounded-full text-[9px] font-semibold tabular-nums"
                      style={{
                        background: proba >= HOT_THRESHOLD ? 'color-mix(in oklch, var(--accent-orange) 14%, transparent)' : 'var(--bg-muted)',
                        color: proba >= HOT_THRESHOLD ? 'var(--accent-orange)' : 'var(--text-muted)',
                      }}>
                      {proba >= HOT_THRESHOLD && <Flame size={9} />}
                      {Math.round(proba)}%
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-meta-label">
                  <span>{lead.email}</span>
                  <span>{timeAgo(lead.created_at)}</span>
                </div>
                {lead.tags && lead.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {lead.tags.slice(0, 3).map(tag => <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-muted)] text-[var(--text-muted)]">{tag}</span>)}
                  </div>
                )}
              </LeadLink>
                </div>
              </SwipeAction>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden p-0 animate-stagger stagger-3">
          {/* Bulk bar */}
          {selectedIds.size > 0 && (
            <div className="px-4 py-2.5 bg-[var(--primary-soft)] border-b border-[var(--primary)]/20 flex items-center gap-3 animate-slide-down">
              <span className="text-xs font-semibold text-[var(--primary)]">{selectedIds.size} sélectionné(s)</span>
              <Select size="sm" onChange={(e) => { if (e.target.value) void bulkChangeStatus(e.target.value as LeadStatus); e.target.value = ''; }}>
                <option value="">{t('leads.page.bulk_change_status')}</option>
                {LEAD_STATUSES.map(s => (<option key={s} value={s}>{STATUS_LABELS[s]}</option>))}
              </Select>
              <Button variant="ghost" size="sm" onClick={bulkTrash} className="text-[var(--danger)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]" leftIcon={<Trash2 size={14} />}>
                {t('action.delete')}
              </Button>
              <button onClick={() => void handleBatchSummarize()} disabled={isBatchSummarizing}
                className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold text-white rounded-[var(--radius-xs)] transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--primary)' }}
                title={t('leads.page.bulk_summarize_title')} aria-label={t('leads.page.bulk_summarize_aria')}>
                {isBatchSummarizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Résumer ({selectedIds.size})
              </button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>{t('action.cancel')}</Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm density-table" role="grid">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="table-header-cell w-10">
                    <input type="checkbox" checked={selectedIds.size === leads.length && leads.length > 0} onChange={toggleSelectAll} className="rounded cursor-pointer accent-[var(--primary)]" />
                  </th>
                  <th onClick={() => toggleSort('name')} className="group table-header-cell cursor-pointer hover:text-[var(--primary)] select-none">
                    <span className="inline-flex items-center gap-1">{t('leads.table.name')} <SortIcon col="name" /></span>
                  </th>
                  <th className="table-header-cell">{t('leads.table.client')}</th>
                  <th className="table-header-cell">{t('leads.table.contact')}</th>
                  <th className="table-header-cell">{t('leads.table.type')}</th>
                  <th className="table-header-cell">{t('leads.table.status')}</th>
                  <th onClick={() => toggleSort('score')} className="group table-header-cell cursor-pointer hover:text-[var(--primary)] select-none">
                    <span className="inline-flex items-center gap-1">{t('leads.table.score')} <SortIcon col="score" /></span>
                  </th>
                  <th onClick={() => toggleSort('created_at')} className="group table-header-cell cursor-pointer hover:text-[var(--primary)] select-none">
                    <span className="inline-flex items-center gap-1">{t('leads.table.date')} <SortIcon col="created_at" /></span>
                  </th>
                  <th className="table-header-cell w-16"></th>
                  <th className="table-header-cell w-28"></th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead, index) => {
                  const isHot = lead.score >= 70;
                  const proba = convProba[lead.id];
                  return (
                    <tr key={lead.id}
                      className={`border-b border-[var(--border-subtle)] row-hover-reveal relative transition-colors duration-150 ${
                        selectedIds.has(lead.id) ? 'bg-[var(--primary-soft)]' : 'hover:bg-[var(--bg-subtle)]'
                      }`}
                      style={{
                        animationDelay: `${Math.min(index, 20) * 20}ms`,
                        background: isHot && !selectedIds.has(lead.id)
                          ? 'linear-gradient(90deg, rgba(99,91,255,0.04) 0%, rgba(99,91,255,0.01) 100%)'
                          : undefined,
                        boxShadow: isHot ? 'inset 3px 0 0 0 rgba(99,91,255,0.5)' : undefined,
                      }}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)} className="rounded cursor-pointer accent-[var(--primary)]" />
                      </td>
                      <td className="px-4 py-3">
                        <LeadLink leadId={lead.id} className="flex items-center gap-2.5 hover:text-[var(--primary)] transition-colors">
                          <Avatar name={lead.name} size="xs" />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-card-title">{lead.name}</p>
                              {isHot && (
                                <span className="inline-flex items-center px-1.5 h-[16px] rounded-full text-[9px] font-bold text-white tracking-wider"
                                  style={{ background: 'linear-gradient(135deg, var(--primary) 0%, #8B5CF6 100%)', boxShadow: '0 0 8px rgba(99,91,255,0.3)' }}>
                                  HOT
                                </span>
                              )}
                            </div>
                            {lead.message && <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate max-w-56">{lead.message}</p>}
                          </div>
                        </LeadLink>
                      </td>
                      <td className="px-4 py-3">
                        <span className="status-badge" style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>{getClientName(lead)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-subtitle">{lead.email}</p>
                        {lead.phone && <p className="text-[11px] text-[var(--text-muted)]">{lead.phone}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>{lead.type === 'inbound' ? t('lead.type.inbound') : t('lead.type.customer')}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Select size="sm" value={lead.status} onChange={(e) => void handleStatusChange(lead.id, e.target.value as LeadStatus)}
                          className="!bg-transparent" style={{ color: STATUS_COLORS[lead.status] }}>
                          {LEAD_STATUSES.map(s => (<option key={s} value={s}>{STATUS_LABELS[s]}</option>))}
                        </Select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="score-circle-wrap">
                            <svg viewBox="0 0 36 36" className="w-9 h-9">
                              <circle className="score-circle-bg" cx="18" cy="18" r="15.5" />
                              <circle
                                className="score-circle-fill"
                                cx="18" cy="18" r="15.5"
                                stroke={lead.score >= 70 ? 'var(--success)' : lead.score >= 40 ? 'var(--warning)' : 'var(--danger)'}
                                strokeDasharray={`${((lead.score ?? 0) / 100) * 97.4} 97.4`}
                              />
                              <text className="score-circle-text" x="18" y="18">{lead.score ?? 0}</text>
                            </svg>
                          </div>
                          {/* Sprint 13 — badge proba de conversion calibrée (best-effort) */}
                          {proba !== undefined && (
                            <span
                              title={t('conversion.probability')}
                              className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded-full text-[9px] font-semibold tabular-nums"
                              style={{
                                background: proba >= HOT_THRESHOLD ? 'color-mix(in oklch, var(--accent-orange) 14%, transparent)' : 'var(--bg-muted)',
                                color: proba >= HOT_THRESHOLD ? 'var(--accent-orange)' : 'var(--text-muted)',
                              }}>
                              {proba >= HOT_THRESHOLD && <Flame size={9} />}
                              {Math.round(proba)}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className="text-meta-label">{timeAgo(lead.created_at)}</span></td>
                      <td className="px-4 py-3">
                        <button onClick={() => openNotes(lead)} className="p-1.5 rounded-[var(--radius-xs)] text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--primary)] transition-colors cursor-pointer reveal-on-hover" title={t('leads.page.expand_notes')} aria-label={t('leads.page.expand_notes')}>
                          {lead.notes ? <StickyNote size={14} /> : <MoreHorizontal size={14} />}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="lead-row-actions">
                          <button className="lead-row-action-btn" title="Appeler" aria-label="Appeler" onClick={e => e.stopPropagation()}>
                            <Phone size={14} />
                          </button>
                          <button className="lead-row-action-btn" title="Email" aria-label="Envoyer un email" onClick={e => e.stopPropagation()}>
                            <Mail size={14} />
                          </button>
                          <button className="lead-row-action-btn" title="Archiver" aria-label="Archiver" onClick={e => e.stopPropagation()}>
                            <Archive size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* LOT RÉEL (Manager B) — pagination curseur (append). Affiché quand la
          liste est rendue : pas en loading initial, pas vide, hors vue carte. */}
      {!isLoading && leads.length > 0 && viewMode !== 'map' && (
        <LoadMore
          onLoadMore={() => void handleLoadMore()}
          loading={loadingMore}
          hasMore={!!nextCursor}
          loadedCount={leads.length}
        />
      )}

      {/* Modal — Nouveau lead */}
      <Modal open={createOpen} onOpenChange={closeCreate} title={t('leads.modal.title')}>
        <div className="space-y-3">
          {createError && (
            <div className="text-xs text-[var(--danger)] px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--danger)]/10 border border-[var(--danger)]/20 animate-fade-in-up">
              {createError}
            </div>
          )}
          <div>
            <label htmlFor="new-lead-client" className="text-section-title block mb-1.5">
              {t('leads.modal.client')} <span className="text-[var(--danger)]">*</span>
            </label>
            <Select id="new-lead-client" value={createForm.client_id}
              onChange={(e) => setCreateForm(f => ({ ...f, client_id: e.target.value }))}>
              <option value="">{t('leads.page.create_client_placeholder')}</option>
              {clients.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-lead-name" className="text-section-title block mb-1.5">
                {t('leads.modal.name')} <span className="text-[var(--danger)]">*</span>
              </label>
              <Input id="new-lead-name" value={createForm.name}
                onChange={(e) => setCreateForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Jean Tremblay" />
            </div>
            <div>
              <label htmlFor="new-lead-email" className="text-section-title block mb-1.5">
                {t('leads.modal.email')} <span className="text-[var(--danger)]">*</span>
              </label>
              <Input id="new-lead-email" type="email" value={createForm.email}
                onChange={(e) => setCreateForm(f => ({ ...f, email: e.target.value }))}
                placeholder="jean@exemple.com" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-lead-phone" className="text-section-title block mb-1.5">{t('leads.modal.phone')}</label>
              <Input id="new-lead-phone" value={createForm.phone}
                onChange={(e) => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="514-555-1234" />
            </div>
            <div>
              <label htmlFor="new-lead-source" className="text-section-title block mb-1.5">{t('leads.new.source_label')}</label>
              <Select id="new-lead-source" value={createForm.source}
                onChange={(e) => setCreateForm(f => ({ ...f, source: e.target.value }))}>
                <option value="manual">{t('leads.new.source_manual')}</option>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
              </Select>
            </div>
          </div>
          <div>
            <label htmlFor="new-lead-type" className="text-section-title block mb-1.5">{t('leads.new.type_label')}</label>
            <Select id="new-lead-type" value={createForm.type}
              onChange={(e) => setCreateForm(f => ({ ...f, type: e.target.value as 'inbound' | 'customer' }))}>
              <option value="inbound">Entrant (prospect)</option>
              <option value="customer">{t('leads.new.type_customer')}</option>
            </Select>
          </div>
          <div>
            <label htmlFor="new-lead-message" className="text-section-title block mb-1.5">{t('leads.new.note_label')}</label>
            <textarea id="new-lead-message" value={createForm.message}
              onChange={(e) => setCreateForm(f => ({ ...f, message: e.target.value }))}
              rows={3} placeholder="Contexte du lead, source détaillée, prochaines étapes..."
              className="w-full px-3 py-2.5 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={closeCreate} disabled={createSubmitting}>{t('leads.modal.cancel')}</Button>
            <Button onClick={() => void handleCreateLead()} disabled={createSubmitting}>
              {createSubmitting ? '...' : t('leads.modal.submit')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Sprint 21 — Modal AI batch summary */}
      <Modal open={!!batchSummary} onOpenChange={() => setBatchSummary(null)} title="Résumé AI des leads sélectionnés" size="lg">
        {batchSummary && (
          <div className="space-y-4">
            <div className="p-3 surface-inset animate-fade-in-up">
              <div className="flex items-start gap-2">
                <Sparkles size={14} className="text-[var(--primary)] mt-0.5 shrink-0" />
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">{batchSummary.overview}</p>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="table-header-cell">{t('leads.detail.batch_col_lead')}</th>
                    <th className="table-header-cell">{t('leads.page.batch_col_summary')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batchSummary.per_lead.map(item => (
                    <tr key={item.lead_id} className="border-b border-[var(--border-subtle)] last:border-b-0 row-hover-reveal">
                      <td className="px-3 py-2 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap">{item.name}</td>
                      <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{item.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-meta-label">{t('leads.page.batch_generated_by')}</p>
              <Button variant="secondary" leftIcon={<Download size={14} />} onClick={() => {
                if (!batchSummary) return;
                const csv = ['Nom,Résumé AI', ...batchSummary.per_lead.map(l => `"${l.name.replace(/"/g, '""')}","${l.summary.replace(/"/g, '""')}"`)].join('\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `resume-leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
                URL.revokeObjectURL(url);
              }}>{t('leads.export.csv_button')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Notes */}
      <Modal open={!!selectedLead} onOpenChange={() => setSelectedLead(null)} title={`Notes — ${selectedLead?.name || ''}`}>
        {selectedLead && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-[var(--text-muted)]">{t('leads.page.notes_email')}</span><span className="text-[var(--text-primary)]">{selectedLead.email}</span></div>
              <div><span className="text-[var(--text-muted)]">{t('leads.page.notes_phone')}</span><span className="text-[var(--text-primary)]">{selectedLead.phone || '—'}</span></div>
              <div><span className="text-[var(--text-muted)]">{t('leads.page.notes_type')}</span><Badge color={selectedLead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>{selectedLead.type === 'inbound' ? t('leads.page.type_inbound') : t('leads.page.type_customer')}</Badge></div>
              <div><span className="text-[var(--text-muted)]">{t('leads.page.notes_status')}</span><Badge color={STATUS_COLORS[selectedLead.status]}>{STATUS_LABELS[selectedLead.status]}</Badge></div>
            </div>
            {selectedLead.message && (
              <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-sm">
                <p className="text-xs text-[var(--text-muted)] mb-1">{t('leads.page.notes_lead_message')}</p>
                <p className="text-[var(--text-primary)]">{selectedLead.message}</p>
              </div>
            )}
            <div>
              <label htmlFor="lead-notes" className="text-section-title block mb-1.5">{t('leads.detail.notes_label')}</label>
              <textarea id="lead-notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={4} placeholder="Ajouter des notes sur ce lead..."
                className="w-full px-3 py-2.5 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSelectedLead(null)}>{t('action.cancel')}</Button>
              <Button onClick={() => void handleSaveNotes()}>{t('leads.detail.notes_save')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Import CSV */}
      <Modal open={importModalOpen} onOpenChange={setImportModalOpen} title="Importer des leads depuis un fichier CSV">
        <div className="space-y-4">
          <p className="text-subtitle">
            Sélectionnez le sous-compte (client) de destination pour importer vos prospects. 
            Les colonnes du CSV seront mappées automatiquement par le système.
          </p>
          <div>
            <label htmlFor="import-csv-client" className="text-section-title block mb-1.5">
              Sous-compte destinataire <span className="text-[var(--danger)]">*</span>
            </label>
            <Select
              id="import-csv-client"
              value={importClientId}
              onChange={(e) => setImportClientId(e.target.value)}
            >
              <option value="">Sélectionner un sous-compte...</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setImportModalOpen(false)}>Annuler</Button>
            <Button
              onClick={() => {
                if (!importClientId) {
                  toastError("Veuillez sélectionner un sous-compte");
                  return;
                }
                fileInputRef.current?.click();
              }}
              disabled={!importClientId}
            >
              Choisir le fichier CSV...
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}