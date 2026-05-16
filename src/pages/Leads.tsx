// ── Page Leads — Liste globale + Vue Carte (Sprint 6 D3) ─────

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Tag, Skeleton, EmptyState, DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, KpiStrip, type KpiItem, SmartBanner, BulkActionBar, AppliedFiltersBar, type FilterDescriptor, EmptyStateIllustration, Tooltip, ScoreGauge, Icon } from '@/components/ui';
import { LeadLink } from '@/components/panels/LeadLink';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { getLeads, getClients, updateLead, exportLeadsCsv, createLead, softDeleteLead, restoreLead, aiSummarizeLeads, type AiBatchLeadSummary } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, SOURCE_LABELS, LEAD_STATUSES, type Lead, type LeadStatus, type Client, type SmartList } from '@/lib/types';
// Sprint 40 40-1B — Status → Tag variant pour wiring statusIcon (Lucide pill)
const STATUS_TO_TAG_VARIANT: Record<LeadStatus, 'brand' | 'info' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  new: 'brand',
  contacted: 'info',
  qualified: 'warning',
  won: 'success',
  closed: 'neutral',
  lost: 'danger',
};
import { applyAiSort, AI_SORT_LABELS, AI_SORT_DESCRIPTIONS, AI_SORT_MODES, type AiSortMode } from '@/lib/aiSort';
// Sprint 32 vague 32-1A — smart search depth (fuzzy multi-field + ranking)
import { fuzzyScoreMulti } from '@/lib/fuzzy';
import { Search, X, Download, Save, LayoutGrid, LayoutList, Map, MoreVertical, ArrowUpDown, ChevronUp, ChevronDown, ChevronRight, StickyNote, Users, UserPlus, Zap, ExternalLink, Check, Plus, Trash2, Sparkles, Loader2, Eye, Mail, Phone as PhoneIcon } from 'lucide-react';
import { SwipeAction } from '@/components/ui/SwipeAction';
import { useLongPress } from '@/hooks/useLongPress';
import { useToast, useConfirm, usePrompt } from '@/components/ui';
// Sprint 48 M3 — Intl plural / currency / relative time
import { plural } from '@/lib/i18n/plural';
import { formatMoneyCAD, formatNumber } from '@/lib/i18n/number';
import { formatRelativeTime } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';
// Sprint 44 M2.2 — Offline-first fallback (IndexedDB cache via Dexie)
import { getCachedLeads } from '@/lib/offline/sync';
import { useLeadHoverPreview } from '@/components/panels/LeadHoverPreview';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';

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
      // Sprint 23 wave 9 — light theme brand (light-v11 au lieu de dark-v11)
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-73.5673, 45.5017],
      zoom: 7,
    });
    enrichedLeads.forEach((lead: Lead & { lat: number; lng: number }) => {
      // Stripe-clean : pins color-coded sober (success/warning/info)
      const markerColor = lead.score >= 70 ? '#10b981' : lead.score >= 40 ? '#f59e0b' : '#6366f1';
      const marker = new mapboxGl.Marker({ color: markerColor })
        .setLngLat([lead.lng, lead.lat])
        .setPopup(new mapboxGl.Popup({ className: 'mapbox-popup-stripe' }).setHTML(
          `<div style="padding:6px 8px;font-family:system-ui;min-width:140px">
            <strong style="font-size:13px;color:#111827;font-weight:600">${lead.name}</strong>
            <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
              <span style="font-size:10px;font-weight:600;color:${markerColor};text-transform:uppercase;letter-spacing:0.5px">${STATUS_LABELS[lead.status] || lead.status}</span>
              ${lead.score > 0 ? `<span style="font-size:10px;font-weight:700;color:${markerColor};margin-left:auto">${lead.score}</span>` : ''}
            </div>
          </div>`
        ))
        .addTo(map);
      marker.getElement().addEventListener('click', () => setSelectedPin(lead));
    });
  }

  if (mapError || !((import.meta.env as Record<string, string>)['VITE_MAPBOX_TOKEN'])) {
    // Fallback Stripe-clean : grille SVG light theme propre (pas de gradient brand)
    const scoreColor = (s: number) => s >= 70 ? 'var(--success)' : s >= 40 ? 'var(--warning)' : 'var(--info)';
    return (
      <div className="relative rounded-[var(--radius-lg)] overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-xs"
        style={{ height: 520 }}>
        {/* Fond carte stylisée mock light — Stripe-clean */}
        <svg width="100%" height="100%" viewBox="0 0 800 520" className="opacity-60">
          {/* Quadrillage subtil neutre */}
          {Array.from({ length: 10 }).map((_, i) => (
            <g key={i}>
              <line x1={i * 80} y1="0" x2={i * 80} y2="520" stroke="var(--border-subtle)" strokeWidth="1" />
              <line x1="0" y1={i * 52} x2="800" y2={i * 52} stroke="var(--border-subtle)" strokeWidth="1" />
            </g>
          ))}
          <text x="400" y="260" textAnchor="middle" fill="var(--text-muted)" fontSize="14" fontFamily="system-ui" fontWeight="600">
            Carte Québec — Mode démo (Mapbox token requis)
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
                <div className="w-5 h-5 rounded-full border-2 border-white shadow-sm transition-transform group-hover:scale-125"
                  style={{ background: scoreColor(lead.score) }} />
              </button>
            );
          })}
        </div>
        {/* Légende — Stripe-clean white card */}
        <div className="absolute bottom-4 left-4 flex items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-sm px-3 py-2 rounded-[var(--radius-md)] text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--success)' }} /> Score ≥70</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--warning)' }} /> 40-69</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--info)' }} /> &lt;40</span>
          <span className="text-[var(--text-muted)] ml-2">| Configurez VITE_MAPBOX_TOKEN pour la vraie carte</span>
        </div>
        {/* Popup */}
        {selectedPin && (
          <div className="absolute top-4 right-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 shadow-sm max-w-48 z-10">
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
        <div className="absolute top-4 right-4 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 shadow-lg max-w-48 z-10">
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

// ── Sprint 31 vague 31-1A — Read URL params (?status=&source=&client=&scoreMin=) ──
// Validates status against LEAD_STATUSES; scoreMin parsed as int (NaN → null).
function readLeadsUrlState(): {
  status: LeadStatus | null;
  source: string | null;
  client: string | null;
  scoreMin: number | null;
  // Sprint 49 M3.4 — params NL query (recherche naturelle CmdPalette)
  lastContactDays: number | null;
  tag: string | null;
} {
  if (typeof window === 'undefined') return { status: null, source: null, client: null, scoreMin: null, lastContactDays: null, tag: null };
  const params = new URLSearchParams(window.location.search);
  const rawStatus = params.get('status');
  const rawScore = params.get('scoreMin');
  const scoreNum = rawScore ? parseInt(rawScore, 10) : NaN;
  // Sprint 49 M3.4 — lastContactDays/dormantDays (alias) + tag, parsés au mount
  const rawLcd = params.get('lastContactDays') ?? params.get('dormantDays');
  const lcdNum = rawLcd ? parseInt(rawLcd, 10) : NaN;
  return {
    status: rawStatus && (LEAD_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as LeadStatus) : null,
    source: params.get('source'),
    client: params.get('client'),
    scoreMin: Number.isFinite(scoreNum) && scoreNum > 0 ? scoreNum : null,
    lastContactDays: Number.isFinite(lcdNum) && lcdNum > 0 ? lcdNum : null,
    tag: params.get('tag'),
  };
}

export function LeadsPage() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  // ── Sprint 31 vague 31-1A — URL params hydratent les filtres au mount ──
  // CmdPalette tape `status:hot` → /leads?scoreMin=70, `status:new` → /leads?status=new,
  // `source:meta` → /leads?source=meta, `client:acme` → /leads?client={id}.
  // Bi-directionnel : changement filter → URL replaceState (pas pushState).
  const initialUrlState = useMemo(() => readLeadsUrlState(), []);
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    initialUrlState.status ?? localStorage.getItem('intralys_leads_filter_status') ?? ''
  );
  const [sourceFilter, setSourceFilter] = useState<string>(() =>
    initialUrlState.source ?? localStorage.getItem('intralys_leads_filter_source') ?? ''
  );
  const [clientFilter, setClientFilter] = useState<string>(() =>
    initialUrlState.client ?? localStorage.getItem('intralys_leads_filter_client') ?? ''
  );
  const [scoreMinFilter, setScoreMinFilter] = useState<number | null>(() => initialUrlState.scoreMin);
  // Sprint 49 M3.4 — filtres issus de la recherche naturelle (NL query CmdPalette).
  // Read-only au mount (pas de persistance localStorage — éphémère par requête).
  const [lastContactDaysFilter] = useState<number | null>(() => initialUrlState.lastContactDays);
  const [tagFilter] = useState<string | null>(() => initialUrlState.tag);

  useEffect(() => {
    localStorage.setItem('intralys_leads_filter_status', statusFilter);
    localStorage.setItem('intralys_leads_filter_source', sourceFilter);
    localStorage.setItem('intralys_leads_filter_client', clientFilter);
  }, [statusFilter, sourceFilter, clientFilter]);

  // ── Sprint 31 vague 31-1A — Persist filters → URL replaceState (pas pushState) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (statusFilter) params.set('status', statusFilter); else params.delete('status');
    if (sourceFilter) params.set('source', sourceFilter); else params.delete('source');
    if (clientFilter) params.set('client', clientFilter); else params.delete('client');
    if (scoreMinFilter) params.set('scoreMin', String(scoreMinFilter)); else params.delete('scoreMin');
    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', newUrl);
  }, [statusFilter, sourceFilter, clientFilter, scoreMinFilter]);

  // ── Sprint 31 vague 31-1A — popstate sync (Back/Forward) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      const next = readLeadsUrlState();
      setStatusFilter(next.status ?? '');
      setSourceFilter(next.source ?? '');
      setClientFilter(next.client ?? '');
      setScoreMinFilter(next.scoreMin);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ── Sprint 31 vague 31-1A — Sync depuis TanStack Router (CmdPalette re-nav) ──
  // CmdPalette utilise go() qui passe par router → location.search update sans popstate.
  const routerLocation = useRouterState({ select: (s) => s.location });
  useEffect(() => {
    const next = readLeadsUrlState();
    setStatusFilter((prev) => ((next.status ?? '') !== prev ? next.status ?? '' : prev));
    setSourceFilter((prev) => ((next.source ?? '') !== prev ? next.source ?? '' : prev));
    setClientFilter((prev) => ((next.client ?? '') !== prev ? next.client ?? '' : prev));
    setScoreMinFilter((prev) => (next.scoreMin !== prev ? next.scoreMin : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerLocation.search]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Sprint 27 vague 27-1B — expand row inline detail
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
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
  // Sprint 31 vague 31-2B — AI smart sort
  const [aiSortMode, setAiSortMode] = useState<AiSortMode | null>(null);
  // Au mount, lire query param ?aisort=... (utilisé par CmdPalette pour deep-link)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('aisort');
      if (raw && (AI_SORT_MODES as readonly string[]).includes(raw)) {
        setAiSortMode(raw as AiSortMode);
      }
    } catch { /* ignore */ }
  }, []);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const emptyCreateForm = { client_id: '', name: '', email: '', phone: '', source: 'manual', message: '', type: 'inbound' as 'inbound' | 'customer' };
  const [createForm, setCreateForm] = useState(emptyCreateForm);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    // Sprint 44 M2.2 — Offline-first : si pas de réseau, charger direct depuis
    // le cache IndexedDB (sync au boot par AppLayout). Sinon fetch normal + le
    // sync.ts persiste dans la DB pour la prochaine vue offline.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      try {
        const cached = await getCachedLeads();
        if (cached.length > 0) {
          setLeads(cached as unknown as Lead[]);
        }
      } catch { /* ignore — fall through to fetch tentative */ }
    }
    const [leadsResult, clientsResult] = await Promise.all([
      getLeads({ status: statusFilter || undefined, search: search || undefined, source: sourceFilter || undefined, client_id: clientFilter || undefined }),
      getClients(),
    ]);
    if (leadsResult.data) {
      setLeads(leadsResult.data);
    } else if (leadsResult.error && typeof navigator !== 'undefined' && !navigator.onLine) {
      // Réseau coupé pendant le fetch → fallback cache (silencieux)
      try {
        const cached = await getCachedLeads();
        if (cached.length > 0) setLeads(cached as unknown as Lead[]);
      } catch { /* ignore */ }
    }
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
      success('Notes enregistrées');
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

  // Sprint 23 wave 12 — Action delete unitaire (depuis kebab menu)
  const handleSingleDelete = async (lead: Lead) => {
    const ok = await confirm({
      title: `Déplacer "${lead.name}" vers la corbeille ?`,
      description: 'Récupérable pendant 30 jours.',
      confirmLabel: 'Déplacer',
      danger: true,
    });
    if (!ok) return;
    const res = await softDeleteLead(lead.id);
    if (res.error) { toastError(res.error); return; }
    void loadData();
    success(`"${lead.name}" déplacé vers la corbeille`, {
      duration: 10000,
      action: {
        label: 'Annuler',
        onClick: async () => {
          await restoreLead(lead.id);
          success('Lead restauré');
          void loadData();
        },
      },
    });
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

  const saveSmartList = async () => {
    const name = await prompt({
      title: 'Enregistrer cette vue',
      description: 'Donne un nom à cette combinaison de filtres pour la retrouver rapidement.',
      placeholder: 'Ex: Leads chauds Facebook',
      confirmLabel: 'Enregistrer',
    });
    if (!name) return;
    const newList: SmartList = { id: `sl-${Date.now()}`, user_id: 'local', client_id: 'local', name, filters: { status: statusFilter || undefined, source: sourceFilter || undefined, client_id: clientFilter || undefined, search: search || undefined }, count: leads.length, created_at: new Date().toISOString() };
    const updated = [...smartLists, newList]; setSmartLists(updated);
    localStorage.setItem('intralys_smart_lists', JSON.stringify(updated));
    success(`Vue "${name}" enregistrée`);
  };
  const loadSmartList = (sl: SmartList) => { setStatusFilter((sl.filters.status as string) || ''); setSourceFilter((sl.filters.source as string) || ''); setClientFilter((sl.filters.client_id as string) || ''); setSearch((sl.filters.search as string) || ''); };
  const deleteSmartList = (id: string) => { const updated = smartLists.filter(s => s.id !== id); setSmartLists(updated); localStorage.setItem('intralys_smart_lists', JSON.stringify(updated)); };

  const getClientName = (lead: Lead) => lead.client_name || clients.find(c => c.id === lead.client_id)?.name || lead.client_id;

  // Sprint 48 M3.2 — Intl.RelativeTimeFormat locale-aware
  const timeAgo = (dateStr: string): string => formatRelativeTime(dateStr, getLocale());

  const toggleSort = (col: typeof sortBy) => {
    // Tri colonne explicite → annule l'AI sort actif (cohérence UX)
    if (aiSortMode) setAiSortMode(null);
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };
  // Sprint 31 vague 31-1A — Client-side scoreMin filter (backend getLeads ne le supporte pas)
  // Sprint 32 vague 32-1A — Smart search depth : la requête initiale tape backend
  // (name/email/phone via LIKE) mais on enrichit côté client en matchant aussi
  // tags[], notes, message, company, city, address + custom-ish fields. Fuzzy
  // ranking via fuzzyScoreMulti (max pondéré) → les leads avec match remontent.
  const searchTerm = search.trim();
  const filteredLeads = useMemo(() => {
    const min = scoreMinFilter;
    let base = min ? leads.filter(l => l.score >= min) : leads;
    // Sprint 49 M3.4 — filtres NL query (lastContactDays + tag), client-side.
    if (lastContactDaysFilter != null) {
      const cutoff = Date.now() - lastContactDaysFilter * 86400000;
      base = base.filter(l => {
        const ts = new Date(l.last_activity_at || l.updated_at).getTime();
        return !Number.isFinite(ts) || ts < cutoff; // "pas contacté depuis X jours"
      });
    }
    if (tagFilter) {
      const t = tagFilter.toLowerCase();
      base = base.filter(l => (l.tags || []).some(tag => tag.toLowerCase().includes(t)));
    }
    if (searchTerm) {
      // Si l'utilisateur cherche, on filtre côté client sur TOUS les champs
      // visibles + sémantiques (le backend a déjà fait un filtre LIKE strict
      // sur name/email/phone, on l'élargit ici sans appel réseau supp.).
      const scored = base
        .map(l => {
          const tagsStr = (l.tags || []).join(' ');
          const score = fuzzyScoreMulti(searchTerm, [
            { value: l.name || '', weight: 1.00 },
            { value: l.email || '', weight: 0.92 },
            { value: l.phone || '', weight: 0.88 },
            { value: tagsStr, weight: 0.86 },
            { value: l.company || '', weight: 0.82 },
            { value: l.city || '', weight: 0.74 },
            { value: l.notes || '', weight: 0.70 },
            { value: l.message || '', weight: 0.66 },
            { value: l.address || '', weight: 0.60 },
            { value: l.budget || '', weight: 0.58 },
            { value: l.timeline || '', weight: 0.56 },
            { value: l.property_type || '', weight: 0.54 },
          ]);
          return { l, score };
        })
        .filter(x => x.score >= 0.30);
      // Ranking par score décroissant si pas de tri colonne explicite ni AI sort
      base = scored
        .sort((a, b) => b.score - a.score)
        .map(x => x.l);
    }
    return base;
  }, [leads, scoreMinFilter, searchTerm, lastContactDaysFilter, tagFilter]);
  const sortedLeads = aiSortMode
    ? applyAiSort(filteredLeads, aiSortMode)
    : searchTerm
      ? filteredLeads // Sprint 32 vague 32-1A — conserve l'ordre fuzzy-rank quand search actif
      : [...filteredLeads].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        if (sortBy === 'name') return a.name.localeCompare(b.name) * dir;
        if (sortBy === 'score') return (a.score - b.score) * dir;
        if (sortBy === 'deal_value') return ((a.deal_value || 0) - (b.deal_value || 0)) * dir;
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      });

  // Sprint 32 vague 32-1A — Highlight helper : marque la portion qui matche le
  // query sur un texte (caseless, accent-insensitive via norm). Retourne un
  // ReactNode (string si pas de match, fragment sinon).
  const highlightSearch = useCallback((text: string | null | undefined): ReactNode => {
    if (!text) return text || '';
    const q = searchTerm;
    if (!q) return text;
    // Recherche substring case-insensitive sur le rendu original (on garde la
    // casse d'origine dans la cell). On essaie d'abord exact-substring → si
    // pas trouvé, on bail (pas de fuzzy highlight, juste les matches francs).
    const lc = text.toLowerCase();
    const lcQ = q.toLowerCase();
    const idx = lc.indexOf(lcQ);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="search-hit-mark">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  }, [searchTerm]);

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return <ArrowUpDown size={12} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-[var(--primary)]" /> : <ChevronDown size={12} className="text-[var(--primary)]" />;
  };

  const hasFilters = !!(search || statusFilter || sourceFilter || clientFilter || scoreMinFilter);
  const newCount = leads.filter(l => l.status === 'new').length;
  const wonCount = leads.filter(l => l.status === 'won').length;

  // Sprint 30 vague 30-3C — Pull-to-refresh mobile
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await loadData(); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title="Leads">
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <div className="print-page-header">
        <h1>Intralys CRM — Liste leads</h1>
        <div className="print-meta">
          {new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' })} · intralys.com
        </div>
      </div>
      {/* Header Stripe-clean — title + subtext + actions */}
      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="t-h1 text-[var(--text-primary)]">Leads</h1>
          <p className="t-caption text-[var(--text-muted)] mt-1">
            {leads.length} au total · {newCount} nouveaux à qualifier · {wonCount} signés
          </p>
        </div>
        <Button variant="primary" leftIcon={<Icon as={Plus} size={14} />} onClick={() => setCreateOpen(true)}>
          Nouveau lead
        </Button>
      </header>

      {/* Sprint 23 wave 17 — SmartBanner contextuel (signature GHL) */}
      {newCount >= 3 && (
        <SmartBanner
          dismissKey="leads-batch-summarize-tip"
          variant="ai"
          title={`💡 ${newCount} nouveaux leads non qualifiés`}
          description="Sélectionnez-les puis utilisez « Résumer (AI) » pour obtenir une fiche d'action en quelques secondes."
          secondaryLabel="Plus tard"
        />
      )}
      {newCount < 3 && leads.filter(l => l.score >= 70).length >= 3 && (
        <SmartBanner
          dismissKey="leads-hot-tip"
          variant="tip"
          title={`🔥 ${plural(getLocale(), leads.filter(l => l.score >= 70).length, { one: '# lead chaud prêt à être contacté', other: '# leads chauds prêts à être contactés' })}`}
          description="Triez par score décroissant et concentrez-vous sur les leads ≥70 cette semaine — ils convertissent 3× mieux."
          action={{ label: 'Trier par score', onClick: () => { setSortBy('score'); setSortDir('desc'); } }}
          secondaryLabel="Ignorer"
        />
      )}

      {/* KPI strip + view toggle — Sprint 23 wave 15 (signature GHL) */}
      <div className="flex flex-wrap items-stretch gap-3 mb-5">
        <KpiStrip
          className="flex-1 mb-0 sm:min-w-[300px]"
          items={(() => {
            const hotCount = leads.filter(l => l.score >= 70).length;
            const totalValue = leads.reduce((s, l) => s + (l.deal_value || 0), 0);
            const items: KpiItem[] = [
              // Sprint 25 3B — sizes normalisées 12 (xs) au lieu de 11
              { label: 'Total leads', value: leads.length, color: 'brand', icon: <Users size={12} /> },
              { label: 'Nouveaux', value: newCount, color: 'info', icon: <UserPlus size={12} /> },
              { label: 'Hot (≥70)', value: hotCount, color: 'accent', icon: <Zap size={12} /> },
              { label: 'Gagnés', value: wonCount, color: 'success', icon: <Check size={12} /> },
              { label: 'Pipeline $', value: `${formatNumber(totalValue / 1000, getLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}K`, color: 'brand' },
            ];
            return items;
          })()}
        />

        <div className="segmented-control segmented-control--icon self-center">
          <button
            onClick={() => setViewMode('table')}
            className={viewMode === 'table' ? 'is-active' : ''}
            aria-label="Vue table"
            title="Vue table"
          >
            <LayoutList size={14} />
          </button>
          <button
            onClick={() => setViewMode('cards')}
            className={viewMode === 'cards' ? 'is-active' : ''}
            aria-label="Vue cartes"
            title="Vue cartes"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setViewMode('map')}
            className={viewMode === 'map' ? 'is-active' : ''}
            aria-label="Vue carte"
            title="Vue carte (Mapbox)"
          >
            <Map size={14} />
          </button>
        </div>
      </div>

      {/* Toolbar filtres — Sprint 24 vague 2 : chips + dropdowns premium */}
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-48">
            <Input placeholder="Rechercher par nom, email, téléphone..." id="search-all-leads"
              value={search} onChange={(e) => setSearch(e.target.value)} leftIcon={<Search size={16} />} />
          </div>
          {/* Chip filters — ouvrent dropdown valeurs */}
          <DropdownMenu
            trigger={
              <button type="button"
                className={`filter-chip ${statusFilter ? 'filter-chip--active' : ''}`}
                aria-label="Filtrer par statut">
                <span>Statut</span>
                {statusFilter && (
                  <>
                    <span aria-hidden className="opacity-50 text-[10px]">:</span>
                    <span className="filter-chip__value">{STATUS_LABELS[statusFilter as LeadStatus]}</span>
                  </>
                )}
                <ChevronDown size={12} className="opacity-60" />
              </button>
            }
          >
            <DropdownMenuLabel>Statut</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setStatusFilter('')}>Tous les statuts</DropdownMenuItem>
            {LEAD_STATUSES.map(s => (
              <DropdownMenuItem key={s} onSelect={() => setStatusFilter(s)}>{STATUS_LABELS[s]}</DropdownMenuItem>
            ))}
          </DropdownMenu>
          <DropdownMenu
            trigger={
              <button type="button"
                className={`filter-chip ${sourceFilter ? 'filter-chip--active' : ''}`}
                aria-label="Filtrer par source">
                <span>Source</span>
                {sourceFilter && (
                  <>
                    <span aria-hidden className="opacity-50 text-[10px]">:</span>
                    <span className="filter-chip__value">{SOURCE_LABELS[sourceFilter] || sourceFilter}</span>
                  </>
                )}
                <ChevronDown size={12} className="opacity-60" />
              </button>
            }
          >
            <DropdownMenuLabel>Source</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setSourceFilter('')}>Toutes les sources</DropdownMenuItem>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => (
              <DropdownMenuItem key={k} onSelect={() => setSourceFilter(k)}>{v}</DropdownMenuItem>
            ))}
          </DropdownMenu>
          <DropdownMenu
            trigger={
              <button type="button"
                className={`filter-chip ${clientFilter ? 'filter-chip--active' : ''}`}
                aria-label="Filtrer par client">
                <span>Client</span>
                {clientFilter && (
                  <>
                    <span aria-hidden className="opacity-50 text-[10px]">:</span>
                    <span className="filter-chip__value">{clients.find(c => c.id === clientFilter)?.name || clientFilter}</span>
                  </>
                )}
                <ChevronDown size={12} className="opacity-60" />
              </button>
            }
          >
            <DropdownMenuLabel>Client</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setClientFilter('')}>Tous les clients</DropdownMenuItem>
            {clients.map(c => (
              <DropdownMenuItem key={c.id} onSelect={() => setClientFilter(c.id)}>{c.name}</DropdownMenuItem>
            ))}
          </DropdownMenu>
          {/* Sprint 31 vague 31-2B — AI Smart Sort dropdown */}
          <DropdownMenu
            trigger={
              <button
                type="button"
                className={`ai-sort-button ${aiSortMode ? 'ai-sort-button--active' : ''}`}
                aria-label="Trier intelligemment avec l'AI"
                title="Trier intelligemment (AI)"
              >
                <Sparkles size={12} className="ai-sort-sparkle" />
                <span>{aiSortMode ? AI_SORT_LABELS[aiSortMode] : 'Trier intelligemment'}</span>
                <ChevronDown size={12} className="opacity-70" />
              </button>
            }
          >
            <DropdownMenuLabel>AI Smart Sort</DropdownMenuLabel>
            {AI_SORT_MODES.map(mode => (
              <DropdownMenuItem
                key={mode}
                onSelect={() => setAiSortMode(mode)}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium flex items-center gap-1.5">
                    {aiSortMode === mode && <Check size={11} className="text-[var(--primary)]" />}
                    {AI_SORT_LABELS[mode]}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] leading-tight">
                    {AI_SORT_DESCRIPTIONS[mode]}
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setAiSortMode(null)}>
              <span className="text-[var(--text-secondary)]">Tri par défaut</span>
            </DropdownMenuItem>
          </DropdownMenu>
          {hasFilters && (
            <Button variant="secondary" size="sm" leftIcon={<Save size={14} />} onClick={saveSmartList}>
              Enregistrer
            </Button>
          )}
          <Button variant="secondary" size="sm" leftIcon={<Icon as={Download} size={14} />}
            onClick={() => void exportLeadsCsv({ status: statusFilter || undefined, client_id: clientFilter || undefined })}>
            Export
          </Button>
        </div>
        {/* Sprint 24 vague 2 — AppliedFiltersBar avec chips actifs dismissables */}
        {hasFilters && (
          <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
            <AppliedFiltersBar
              filters={[
                ...(statusFilter ? [{
                  id: 'status',
                  label: 'Statut',
                  value: STATUS_LABELS[statusFilter as LeadStatus],
                  onRemove: () => setStatusFilter(''),
                } as FilterDescriptor] : []),
                ...(sourceFilter ? [{
                  id: 'source',
                  label: 'Source',
                  value: SOURCE_LABELS[sourceFilter] || sourceFilter,
                  onRemove: () => setSourceFilter(''),
                } as FilterDescriptor] : []),
                ...(clientFilter ? [{
                  id: 'client',
                  label: 'Client',
                  value: clients.find(c => c.id === clientFilter)?.name || clientFilter,
                  onRemove: () => setClientFilter(''),
                } as FilterDescriptor] : []),
                ...(search ? [{
                  id: 'search',
                  label: 'Recherche',
                  value: `"${search}"`,
                  onRemove: () => setSearch(''),
                } as FilterDescriptor] : []),
                // Sprint 31 vague 31-1A — scoreMin chip (CmdPalette status:hot → ?scoreMin=70)
                ...(scoreMinFilter ? [{
                  id: 'scoreMin',
                  label: 'Score min',
                  value: `≥ ${scoreMinFilter}`,
                  onRemove: () => setScoreMinFilter(null),
                } as FilterDescriptor] : []),
              ]}
              onClearAll={() => { setSearch(''); setStatusFilter(''); setSourceFilter(''); setClientFilter(''); setScoreMinFilter(null); }}
            />
          </div>
        )}
        {/* Smart Lists chips */}
        {smartLists.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--border-subtle)]">
            <span className="t-meta self-center">Listes :</span>
            {smartLists.map(sl => (
              <span key={sl.id} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] cursor-pointer hover:bg-[var(--primary)] hover:text-white transition-colors">
                <button onClick={() => loadSmartList(sl)} className="cursor-pointer">{sl.name}</button>
                <button onClick={() => deleteSmartList(sl.id)} className="opacity-50 hover:opacity-100 cursor-pointer"><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Contenu */}
      {isLoading ? (
        <Card className="overflow-hidden p-0">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded shrink-0" />
            {[1,2,3,4,5,6,7].map(i => (
              <Skeleton key={i} className="h-3 w-20 rounded" />
            ))}
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {[1,2,3,4,5,6,7,8].map(i => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-4 w-4 rounded shrink-0" />
                <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3 rounded" />
                  <Skeleton className="h-2.5 w-2/3 rounded" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full shrink-0" />
                <div className="w-20 flex items-center gap-1.5">
                  <Skeleton className="h-1.5 flex-1 rounded-full" />
                  <Skeleton className="h-3 w-5 rounded" />
                </div>
                <Skeleton className="h-3 w-14 rounded shrink-0" />
                <Skeleton className="h-6 w-6 rounded shrink-0" />
              </div>
            ))}
          </div>
        </Card>
      ) : sortedLeads.length === 0 ? (
        hasFilters ? (
          <EmptyState
            variant="filtered"
            illustration={<EmptyStateIllustration kind="leads" size={160} />}
            title="Aucun résultat"
            description="Essaie d'élargir tes critères ou efface les filtres."
            action={<Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); setSourceFilter(''); setClientFilter(''); setScoreMinFilter(null); }}>Effacer les filtres</Button>} />
        ) : (
          <EmptyState
            variant="first-time"
            illustration={<EmptyStateIllustration kind="leads" size={160} />}
            title="Aucun lead encore"
            description="Crée ton premier lead pour commencer. Tes captures via formulaires et intégrations arriveront aussi ici."
            action={<Button variant="primary" leftIcon={<Icon as={Plus} size={14} />} onClick={() => setCreateOpen(true)}>Créer mon premier lead</Button>} />
        )
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
                  <LeadLink leadId={lead.id}
                    className={`block relative z-10 p-4 ${lead.score >= 70 ? 'card-premium-hot' : 'card-premium'}`}>
                {lead.score >= 70 && (
                  <span className="badge-hot">HOT {lead.score}</span>
                )}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={lead.name} size="sm" style={{ viewTransitionName: 'avatar-' + lead.id }} />
                    <div>
                      <p className="text-[13px] font-semibold text-[var(--text-primary)]">{highlightSearch(lead.name)}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{getClientName(lead)}</p>
                    </div>
                  </div>
                  <Tag dot size="xs" color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>{lead.type === 'inbound' ? 'Entrant' : 'Client'}</Tag>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Tag statusIcon size="xs" variant={STATUS_TO_TAG_VARIANT[lead.status]}>{STATUS_LABELS[lead.status]}</Tag>
                  {lead.deal_value > 0 && <span className="text-[10px] font-semibold text-[var(--primary)]">{formatMoneyCAD(lead.deal_value, getLocale())}</span>}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${lead.score}%`, background: scoreColor }} />
                  </div>
                  <span className="text-[10px] font-bold" style={{ color: scoreColor }}>{lead.score}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                  <span>{highlightSearch(lead.email)}</span>
                  <span>{timeAgo(lead.created_at)}</span>
                </div>
                {lead.tags && lead.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {lead.tags.slice(0, 3).map(t => <Tag key={t} variant="brand" size="xs">{highlightSearch(t)}</Tag>)}
                  </div>
                )}
              </LeadLink>
                </div>
              </SwipeAction>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          {/* Bulk bar — Sprint 24 vague 1 : factorisation via BulkActionBar primitive */}
          <BulkActionBar
            selectedCount={selectedIds.size}
            onClear={() => setSelectedIds(new Set())}
            actions={[
              {
                id: 'trash',
                label: 'Supprimer',
                icon: <Icon as={Trash2} size={14} />,
                variant: 'danger',
                onClick: () => void bulkTrash(),
              },
            ]}
            extraSlot={
              <>
                <DropdownMenu
                  trigger={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[var(--radius-md)] text-[12px] font-semibold transition-colors cursor-pointer bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]"
                      aria-label="Changer statut"
                    >
                      <ArrowUpDown size={14} />
                      Changer statut
                    </button>
                  }
                >
                  <DropdownMenuLabel>Nouveau statut</DropdownMenuLabel>
                  {LEAD_STATUSES.map(s => (
                    <DropdownMenuItem key={s} onSelect={() => void bulkChangeStatus(s)}>
                      {STATUS_LABELS[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void handleBatchSummarize()}
                  disabled={isBatchSummarizing}
                  leftIcon={isBatchSummarizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  title="Résumer les leads sélectionnés avec l'AI"
                  aria-label="Résumer avec l'AI"
                >
                  Résumer ({selectedIds.size})
                </Button>
              </>
            }
          />

          {/* Sprint 27 vague 27-1A — Table premium : frozen header + sticky col */}
          <div className="table-premium-container">
            <table className="table-premium print-data-table">
              <thead>
                <tr>
                  <th data-print-hide className="col-frozen" style={{ width: 42 }}>
                    <input type="checkbox" checked={selectedIds.size === leads.length && leads.length > 0} onChange={toggleSelectAll} className="rounded cursor-pointer accent-[var(--primary)]" />
                  </th>
                  <th onClick={() => toggleSort('name')} className="col-frozen sortable" style={{ left: 42 }}>
                    <span className="inline-flex items-center gap-1">Nom <SortIcon col="name" /></span>
                  </th>
                  <th className="text-left">Client</th>
                  <th className="text-left">Contact</th>
                  <th className="text-left">Type</th>
                  <th className="text-left">Statut</th>
                  <th onClick={() => toggleSort('score')} className="sortable text-left">
                    <span className="inline-flex items-center gap-1">Score <SortIcon col="score" /></span>
                  </th>
                  <th onClick={() => toggleSort('created_at')} className="sortable text-left">
                    <span className="inline-flex items-center gap-1">Date <SortIcon col="created_at" /></span>
                  </th>
                  <th data-print-hide style={{ width: 48 }}></th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead, index) => (
                  <LeadTableRow
                    key={lead.id}
                    lead={lead}
                    clientName={getClientName(lead)}
                    index={index}
                    isSelected={selectedIds.has(lead.id)}
                    isExpanded={expandedRows.has(lead.id)}
                    onToggleExpand={(id) => setExpandedRows(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                    onToggleSelect={toggleSelect}
                    onStatusChange={handleStatusChange}
                    onOpenNotes={openNotes}
                    onDelete={handleSingleDelete}
                    timeAgo={timeAgo}
                    highlightSearch={highlightSearch}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal — Nouveau lead (Sprint 26 vague 26-2B — label/helper/error/success premium) */}
      <Modal open={createOpen} onOpenChange={closeCreate} title="Nouveau lead">
        <div className="space-y-3">
          {createError && (
            <div className="text-xs text-[var(--danger)] px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--danger)]/10 border border-[var(--danger)]/20">
              {createError}
            </div>
          )}
          <Select
            id="new-lead-client"
            label={<>Client <span className="text-[var(--danger)] normal-case tracking-normal">*</span></>}
            value={createForm.client_id}
            onChange={(e) => setCreateForm(f => ({ ...f, client_id: e.target.value }))}
            helper="Sélectionnez le client final propriétaire de ce lead"
          >
            <option value="">Sélectionner un client...</option>
            {clients.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="new-lead-name"
              label={<>Nom <span className="text-[var(--danger)] normal-case tracking-normal">*</span></>}
              value={createForm.name}
              onChange={(e) => setCreateForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Jean Tremblay"
              leftSlot={<UserPlus size={14} />}
            />
            <Input
              id="new-lead-email"
              type="email"
              label={<>Email <span className="text-[var(--danger)] normal-case tracking-normal">*</span></>}
              value={createForm.email}
              onChange={(e) => setCreateForm(f => ({ ...f, email: e.target.value }))}
              placeholder="jean@exemple.com"
              leftSlot={<Mail size={14} />}
              error={
                createForm.email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(createForm.email)
                  ? 'Email invalide'
                  : undefined
              }
              success={
                createForm.email.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(createForm.email)
                  ? 'Format valide'
                  : undefined
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="new-lead-phone"
              label="Téléphone"
              value={createForm.phone}
              onChange={(e) => setCreateForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="514-555-1234"
              leftSlot={<PhoneIcon size={14} />}
            />
            <Select
              id="new-lead-source"
              label="Source"
              value={createForm.source}
              onChange={(e) => setCreateForm(f => ({ ...f, source: e.target.value }))}
            >
              <option value="manual">Manuel</option>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </Select>
          </div>

          <Select
            id="new-lead-type"
            label="Type"
            value={createForm.type}
            onChange={(e) => setCreateForm(f => ({ ...f, type: e.target.value as 'inbound' | 'customer' }))}
          >
            <option value="inbound">Entrant (prospect)</option>
            <option value="customer">Client existant</option>
          </Select>

          <Textarea
            id="new-lead-message"
            label="Note initiale"
            value={createForm.message}
            onChange={(e) => setCreateForm(f => ({ ...f, message: e.target.value }))}
            rows={3}
            resize="none"
            placeholder="Contexte du lead, source détaillée, prochaines étapes..."
            helper="Décrivez le contexte et la prochaine action prévue"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={closeCreate} disabled={createSubmitting}>Annuler</Button>
            <Button onClick={() => void handleCreateLead()} disabled={createSubmitting}>
              {createSubmitting ? 'Création...' : 'Créer le lead'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Sprint 21 — Modal AI batch summary */}
      <Modal open={!!batchSummary} onOpenChange={() => setBatchSummary(null)} title="Résumé AI des leads sélectionnés" size="lg">
        {batchSummary && (
          <div className="space-y-4">
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--brand-tint)] border border-[var(--border-subtle)]">
              <div className="flex items-start gap-2">
                <Sparkles size={14} className="text-[var(--primary)] mt-0.5 shrink-0" />
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">{batchSummary.overview}</p>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)]">
                    <th className="text-left px-3 py-2 t-meta">Lead</th>
                    <th className="text-left px-3 py-2 t-meta">Résumé AI + action</th>
                  </tr>
                </thead>
                <tbody>
                  {batchSummary.per_lead.map(item => (
                    <tr key={item.lead_id} className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-subtle)] transition-colors">
                      <td className="px-3 py-2 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap">{item.name}</td>
                      <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{item.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-[var(--text-muted)]">Généré par Claude Haiku 4.5</p>
              <Button variant="secondary" leftIcon={<Download size={14} />} onClick={() => {
                if (!batchSummary) return;
                const csv = ['Nom,Résumé AI', ...batchSummary.per_lead.map(l => `"${l.name.replace(/"/g, '""')}","${l.summary.replace(/"/g, '""')}"`)].join('\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `resume-leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
                URL.revokeObjectURL(url);
              }}>Exporter CSV</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Notes */}
      <Modal open={!!selectedLead} onOpenChange={() => setSelectedLead(null)} title={`Notes — ${selectedLead?.name || ''}`}>
        {selectedLead && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-[var(--text-muted)]">Email : </span><span className="text-[var(--text-primary)]">{selectedLead.email}</span></div>
              <div><span className="text-[var(--text-muted)]">Téléphone : </span><span className="text-[var(--text-primary)]">{selectedLead.phone || '—'}</span></div>
              <div><span className="text-[var(--text-muted)]">Type : </span><Tag dot size="sm" color={selectedLead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>{selectedLead.type === 'inbound' ? 'Entrant' : 'Client'}</Tag></div>
              <div><span className="text-[var(--text-muted)]">Statut : </span><Tag statusIcon size="sm" variant={STATUS_TO_TAG_VARIANT[selectedLead.status]}>{STATUS_LABELS[selectedLead.status]}</Tag></div>
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
                className="w-full px-3 py-2.5 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSelectedLead(null)}>Annuler</Button>
              <Button onClick={() => void handleSaveNotes()}>Enregistrer</Button>
            </div>
          </div>
        )}
      </Modal>
      </div>
    </AppLayout>
  );
}

// ── LeadTableRow — Sprint 27 : frozen col + expand row + score tooltip ──────
// Sprint 23 wave 10 — hover preview. Sprint 23 wave 12 — kebab DropdownMenu.
// Sprint 27 vague 27-1A — frozen columns + premium table classes.
// Sprint 27 vague 27-1B — expand row inline detail.
// Sprint 27 vague 27-2B — score tooltip breakdown.
interface LeadTableRowProps {
  lead: Lead;
  clientName: string;
  index: number;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onStatusChange: (id: string, status: LeadStatus) => void | Promise<void>;
  onOpenNotes: (lead: Lead) => void;
  onDelete: (lead: Lead) => void | Promise<void>;
  timeAgo: (d: string) => string;
  // Sprint 32 vague 32-1A — highlight helper passé depuis le parent (close sur searchTerm)
  highlightSearch?: (text: string | null | undefined) => ReactNode;
}

function LeadTableRow({
  lead,
  clientName,
  index,
  isSelected,
  isExpanded,
  onToggleExpand,
  onToggleSelect,
  onStatusChange,
  onOpenNotes,
  onDelete,
  timeAgo,
  highlightSearch,
}: LeadTableRowProps) {
  const hl = highlightSearch ?? ((t: string | null | undefined) => t || '');
  const isHot = lead.score >= 70;
  const scoreColor = lead.score >= 70 ? 'var(--success)' : lead.score >= 40 ? 'var(--warning)' : 'var(--danger)';
  const isCoarsePointer =
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const { onMouseEnter, onMouseLeave, preview } = useLeadHoverPreview({
    lead,
    clientName,
    disabled: isCoarsePointer,
  });

  // Score breakdown mock (déterministe basé sur lead.score)
  const scoreBreakdown = {
    source: Math.min(Math.round(lead.score * 0.25), 25),
    engagement: Math.min(Math.round(lead.score * 0.35), 35),
    profil: Math.min(Math.round(lead.score * 0.2), 20),
    timing: lead.score - Math.min(Math.round(lead.score * 0.25), 25) - Math.min(Math.round(lead.score * 0.35), 35) - Math.min(Math.round(lead.score * 0.2), 20),
  };

  return (
    <>
      <tr
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`list-item-enter ${
          isSelected ? 'row-selected' : isHot ? 'row-hot' : ''
        }`}
        style={{
          animationDelay: `${Math.min(index, 20) * 30}ms`,
        }}
      >
        <td data-print-hide className="col-frozen">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`table-expand-trigger ${isExpanded ? 'is-expanded' : ''}`}
              onClick={() => onToggleExpand(lead.id)}
              aria-label={isExpanded ? 'Réduire les détails' : 'Afficher les détails'}
            >
              <ChevronRight size={12} />
            </button>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(lead.id)}
              className="rounded cursor-pointer accent-[var(--primary)]"
            />
          </div>
        </td>
        <td className="col-frozen" style={{ left: 42 }}>
          <LeadLink leadId={lead.id} className="flex items-center gap-2.5 hover:text-[var(--primary)] transition-colors">
            <Avatar name={lead.name} size="xs" style={{ viewTransitionName: 'avatar-' + lead.id }} />
            <div>
              <div className="flex items-center gap-1.5">
                <p className="font-semibold text-[var(--text-primary)] text-[13px]">{hl(lead.name)}</p>
                {isHot && (
                  <span
                    className="inline-flex items-center px-1.5 h-[16px] rounded-full text-[9px] font-bold text-white tracking-wider"
                    style={{ background: 'var(--primary)' }}
                  >
                    HOT
                  </span>
                )}
              </div>
              {lead.message && (
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate max-w-56">{hl(lead.message)}</p>
              )}
            </div>
          </LeadLink>
        </td>
        <td>
          <span className="text-xs px-2 py-1 rounded-[var(--radius-xs)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] font-medium">
            {clientName}
          </span>
        </td>
        <td>
          <p className="text-[13px] text-[var(--text-secondary)]">{hl(lead.email)}</p>
          {lead.phone && <p className="text-[11px] text-[var(--text-muted)]">{hl(lead.phone)}</p>}
        </td>
        <td>
          <Tag dot size="sm" color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>
            {lead.type === 'inbound' ? 'Entrant' : 'Client'}
          </Tag>
        </td>
        <td>
          <Tooltip content={`Depuis : ${timeAgo(lead.created_at)}`}>
            <select
              value={lead.status}
              onChange={(e) => void onStatusChange(lead.id, e.target.value as LeadStatus)}
              className="text-xs px-2 py-1 bg-transparent border border-[var(--border-subtle)] rounded-[var(--radius-xs)] focus:outline-none cursor-pointer hover:border-[var(--border-strong)]"
              style={{ color: STATUS_COLORS[lead.status] }}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </Tooltip>
        </td>
        <td>
          <Tooltip content={
            <div className="score-breakdown">
              <div className="score-breakdown-row">
                <span className="score-breakdown-label">Source</span>
                <span className="score-breakdown-value" style={{ color: 'var(--primary)' }}>+{scoreBreakdown.source}</span>
              </div>
              <div className="score-breakdown-row">
                <span className="score-breakdown-label">Engagement</span>
                <span className="score-breakdown-value" style={{ color: 'var(--accent-orange)' }}>+{scoreBreakdown.engagement}</span>
              </div>
              <div className="score-breakdown-row">
                <span className="score-breakdown-label">Profil</span>
                <span className="score-breakdown-value" style={{ color: 'var(--success)' }}>+{scoreBreakdown.profil}</span>
              </div>
              <div className="score-breakdown-row">
                <span className="score-breakdown-label">Timing</span>
                <span className="score-breakdown-value" style={{ color: 'var(--info)' }}>+{scoreBreakdown.timing}</span>
              </div>
              <div className="score-breakdown-row" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 4, marginTop: 2 }}>
                <span className="score-breakdown-label" style={{ fontWeight: 700 }}>Total</span>
                <span className="score-breakdown-value" style={{ color: scoreColor }}>{lead.score}</span>
              </div>
            </div>
          }>
            <div className="flex items-center gap-1.5 cursor-help">
              <div className="w-16 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${lead.score}%`, background: scoreColor }}
                />
              </div>
              <span className="text-[10px] font-semibold w-5 text-right t-mono-num" style={{ color: scoreColor }}>
                {lead.score}
              </span>
            </div>
          </Tooltip>
        </td>
        <td className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
          {timeAgo(lead.created_at)}
        </td>
        <td data-print-hide>
          <DropdownMenu
            align="end"
            contentClassName="min-w-[200px]"
            trigger={
              <button
                type="button"
                className="relative p-1.5 rounded-[var(--radius-xs)] text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--primary)] transition-colors cursor-pointer data-[state=open]:bg-[var(--brand-tint)] data-[state=open]:text-[var(--primary)]"
                title={lead.notes ? 'Notes + actions' : 'Actions'}
                aria-label="Menu actions"
              >
                <MoreVertical size={14} />
                {lead.notes && (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                    style={{ background: 'var(--primary)' }}
                  />
                )}
              </button>
            }
          >
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <LeadLink
              leadId={lead.id}
              className="block relative flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--radius-sm)] text-[13px] font-medium text-[var(--text-primary)] hover:bg-[oklch(0.96_0.04_220/0.6)] hover:text-[var(--primary)] cursor-pointer select-none transition-all"
            >
              <Eye size={14} className="shrink-0" />
              <span className="flex-1">Voir détails</span>
            </LeadLink>
            <DropdownMenuItem leftIcon={<StickyNote size={14} />} onSelect={() => onOpenNotes(lead)}>
              {lead.notes ? 'Modifier les notes' : 'Ajouter une note'}
            </DropdownMenuItem>
            {lead.email && (
              <DropdownMenuItem
                leftIcon={<Mail size={14} />}
                onSelect={() => {
                  window.location.href = `mailto:${lead.email}`;
                }}
              >
                Envoyer un email
              </DropdownMenuItem>
            )}
            {lead.phone && (
              <DropdownMenuItem
                leftIcon={<PhoneIcon size={14} />}
                onSelect={() => {
                  window.location.href = `tel:${lead.phone.replace(/[^\d+]/g, '')}`;
                }}
              >
                Appeler
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="danger"
              leftIcon={<Trash2 size={14} />}
              onSelect={() => void onDelete(lead)}
            >
              Déplacer corbeille
            </DropdownMenuItem>
          </DropdownMenu>
        </td>
      </tr>
      {/* Sprint 27 vague 27-1B — Expand row inline detail */}
      <tr>
        <td colSpan={9} style={{ padding: 0, border: 'none' }}>
          <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
            <div className="table-expand-inner">
              <div className="table-expand-detail">
                <div className="table-expand-detail-section">
                  <span className="table-expand-detail-label">Notes</span>
                  <span className="table-expand-detail-value">
                    {lead.notes ? (
                      <span className="line-clamp-3 text-[12px] leading-relaxed">{hl(lead.notes)}</span>
                    ) : (
                      <span className="text-[var(--text-muted)] italic text-[12px]">Aucune note</span>
                    )}
                  </span>
                </div>
                {(lead.deal_value ?? 0) > 0 && (
                  <div className="table-expand-detail-section">
                    <span className="table-expand-detail-label">Valeur deal</span>
                    <span className="table-expand-detail-value t-mono-num" style={{ color: 'var(--primary)' }}>
                      {formatMoneyCAD(lead.deal_value || 0, getLocale())}
                    </span>
                  </div>
                )}
                <div className="table-expand-detail-section">
                  <span className="table-expand-detail-label">Score</span>
                  <ScoreGauge score={lead.score} size={48} />
                </div>
                {lead.tags && lead.tags.length > 0 && (
                  <div className="table-expand-detail-section">
                    <span className="table-expand-detail-label">Tags</span>
                    <div className="flex flex-wrap gap-1">
                      {lead.tags.map(t => <Tag key={t} variant="brand" size="xs">{hl(t)}</Tag>)}
                    </div>
                  </div>
                )}
                <div className="table-expand-detail-section">
                  <span className="table-expand-detail-label">Provenance</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Tag variant="neutral" size="xs" dot>
                      {SOURCE_LABELS[lead.source] || lead.source || '—'}
                    </Tag>
                    {lead.utm_campaign && (
                      <Tag variant="brand" size="xs">{lead.utm_campaign}</Tag>
                    )}
                    {lead.consent_status === 'granted' && (
                      <Tag variant="success" size="xs">Consentement OK</Tag>
                    )}
                  </div>
                </div>
                <div className="ml-auto self-center">
                  <LeadLink leadId={lead.id}>
                    <Button size="sm" variant="secondary" leftIcon={<ExternalLink size={12} />}>
                      Voir profil complet
                    </Button>
                  </LeadLink>
                </div>
              </div>
            </div>
          </div>
        </td>
      </tr>
      {preview}
    </>
  );
}