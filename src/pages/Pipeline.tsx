// ── Page Pipeline — Kanban refondu Sprint Design 2 (D2.1) ──────

import { useState, useEffect, useCallback, type DragEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Skeleton, Card, Modal, Button } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { getPipeline, updateLead } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, SOURCE_LABELS, type Lead, type LeadStatus } from '@/lib/types';
import { MoreHorizontal, ChevronDown, LayoutList, BarChart3, Kanban, Filter, Clock, DollarSign, TrendingUp, AlertTriangle, X } from 'lucide-react';

const PIPELINE_COLUMNS: LeadStatus[] = ['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'];
const STAGE_PROBABILITY: Record<LeadStatus, number> = { new: 10, contacted: 25, meeting: 50, signed: 90, closed: 100, lost: 0 };

// Couleurs de fond subtiles par stage
const STAGE_BG: Record<LeadStatus, string> = {
  new: 'rgba(0,157,219,0.04)', contacted: 'rgba(24,139,246,0.04)', meeting: 'rgba(255,154,0,0.04)',
  signed: 'rgba(55,202,55,0.04)', closed: 'rgba(138,147,164,0.03)', lost: 'rgba(233,61,61,0.03)',
};

const LOST_REASONS = ['Prix trop élevé', 'Concurrent choisi', 'Mauvais timing', 'Pas de réponse', 'Financement refusé', 'Changement de plan', 'Autre'];

type ViewMode = 'kanban' | 'list' | 'forecast';

export function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<LeadStatus | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [lostModal, setLostModal] = useState<{ leadId: string; show: boolean }>({ leadId: '', show: false });
  const [lostReason, setLostReason] = useState('');
  const [lostDetails, setLostDetails] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const loadPipeline = useCallback(async () => {
    setIsLoading(true);
    const result = await getPipeline();
    if (result.data) setLeads(result.data);
    setIsLoading(false);
  }, []);

  useEffect(() => { void loadPipeline(); }, [loadPipeline]);

  // ── Drag & Drop ────────────────────────────────────
  const handleDragStart = (e: DragEvent, leadId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', leadId);
    setDraggedId(leadId);
  };
  const handleDragOver = (e: DragEvent, status: LeadStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(status);
  };
  const handleDragLeave = () => setDropTarget(null);
  const handleDrop = async (e: DragEvent, newStatus: LeadStatus) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    setDraggedId(null);
    setDropTarget(null);
    if (!leadId) return;
    // Si on drop sur "lost" → ouvrir modal raison
    if (newStatus === 'lost') {
      setLostModal({ leadId, show: true });
      return;
    }
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
    const result = await updateLead(leadId, { status: newStatus });
    if (result.error) void loadPipeline();
  };

  const confirmLost = async () => {
    if (!lostModal.leadId) return;
    setLeads(prev => prev.map(l => l.id === lostModal.leadId ? { ...l, status: 'lost' as LeadStatus } : l));
    await updateLead(lostModal.leadId, { status: 'lost' as LeadStatus, notes: `[PERDU] ${lostReason}${lostDetails ? ` — ${lostDetails}` : ''}` });
    setLostModal({ leadId: '', show: false });
    setLostReason('');
    setLostDetails('');
  };

  const getColumnLeads = (status: LeadStatus) => leads.filter(l => l.status === status);
  const getDaysInStage = (lead: Lead) => Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / 86400000);
  const scoreColor = (s: number) => s >= 70 ? 'var(--success)' : s >= 40 ? 'var(--warning)' : 'var(--danger)';
  const daysColor = (d: number) => d > 14 ? 'var(--danger)' : d > 7 ? 'var(--warning)' : 'var(--success)';

  const totalValue = leads.reduce((s, l) => s + (l.deal_value || 0), 0);
  const weightedForecast = leads.reduce((s, l) => s + (l.deal_value || 0) * (STAGE_PROBABILITY[l.status] || 0) / 100, 0);
  const dormantCount = leads.filter(l => getDaysInStage(l) > 7 && l.status !== 'closed' && l.status !== 'lost').length;

  const removeFilter = (f: string) => setActiveFilters(prev => prev.filter(x => x !== f));

  return (
    <AppLayout title="Pipeline">
      {/* ── Header : Pipeline selector + KPIs sticky ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Pipeline selector */}
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--brand-primary)] transition-colors cursor-pointer">
          Pipeline principal <ChevronDown size={14} className="text-[var(--text-muted)]" />
        </button>

        {/* KPIs inline */}
        <div className="flex items-center gap-4 ml-2">
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-7 h-7 rounded-lg bg-[var(--brand-tint)] flex items-center justify-center">
              <DollarSign size={14} className="text-[var(--brand-primary)]" />
            </div>
            <div>
              <p className="font-bold text-[var(--text-primary)]">{totalValue.toLocaleString('fr-CA')} $</p>
              <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Valeur</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-7 h-7 rounded-lg bg-[var(--success-soft)] flex items-center justify-center">
              <TrendingUp size={14} className="text-[var(--success)]" />
            </div>
            <div>
              <p className="font-bold text-[var(--text-primary)]">{weightedForecast.toLocaleString('fr-CA')} $</p>
              <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Prévision</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-7 h-7 rounded-lg bg-[var(--warning-soft)] flex items-center justify-center">
              <AlertTriangle size={14} className="text-[var(--warning)]" />
            </div>
            <div>
              <p className="font-bold text-[var(--text-primary)]">{dormantCount}</p>
              <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Dormants</p>
            </div>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Filtres */}
        <button onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${showFilters ? 'bg-[var(--brand-primary)] text-white' : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--brand-primary)]'}`}>
          <Filter size={13} /> Filtres
          {activeFilters.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">{activeFilters.length}</span>}
        </button>

        {/* Vue switcher */}
        <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5">
          {([['kanban', Kanban], ['list', LayoutList], ['forecast', BarChart3]] as const).map(([mode, Icon]) => (
            <button key={mode} onClick={() => setViewMode(mode as ViewMode)}
              className={`p-1.5 rounded-md cursor-pointer transition-all ${viewMode === mode ? 'bg-[var(--brand-primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>

      {/* Filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilters.map(f => (
            <span key={f} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--brand-tint)] text-[var(--brand-primary)] text-xs font-medium">
              {f} <button onClick={() => removeFilter(f)} className="cursor-pointer hover:text-[var(--danger)]"><X size={12} /></button>
            </span>
          ))}
          <button onClick={() => setActiveFilters([])} className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer">Tout effacer</button>
        </div>
      )}

      {/* ── Kanban ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {PIPELINE_COLUMNS.map(s => (
            <div key={s} className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>
          ))}
        </div>
      ) : viewMode === 'kanban' ? (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 min-h-[calc(100vh-14rem)]">
          {PIPELINE_COLUMNS.map(status => {
            const colLeads = getColumnLeads(status);
            const isOver = dropTarget === status;
            const colValue = colLeads.reduce((s, l) => s + (l.deal_value || 0), 0);

            return (
              <div key={status}
                className={`flex flex-col rounded-xl transition-all duration-200 ${isOver ? 'ring-2 ring-[var(--brand-primary)] shadow-lg' : ''}`}
                style={{ background: isOver ? 'var(--brand-tint)' : STAGE_BG[status] }}
                onDragOver={e => handleDragOver(e, status)}
                onDragLeave={handleDragLeave}
                onDrop={e => void handleDrop(e, status)}>

                {/* Column header */}
                <div className="px-3 pt-3 pb-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
                      <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">{STATUS_LABELS[status]}</h3>
                    </div>
                    <span className="text-[10px] font-semibold bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-0.5 rounded-full text-[var(--text-secondary)]">{colLeads.length}</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">{colValue > 0 ? `${colValue.toLocaleString('fr-CA')} $` : '—'} · {STAGE_PROBABILITY[status]}%</p>
                  <div className="h-1 mt-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${STAGE_PROBABILITY[status]}%`, background: STATUS_COLORS[status] }} />
                  </div>
                </div>

                {/* Drop indicator */}
                {isOver && (
                  <div className="mx-3 mb-2 h-1 rounded-full animate-pulse" style={{ background: 'var(--brand-primary)', boxShadow: '0 0 8px var(--brand-primary)' }} />
                )}

                {/* Cards */}
                <div className="flex-1 space-y-2 px-2 pb-2 overflow-y-auto max-h-[calc(100vh-20rem)]">
                  {colLeads.length === 0 && (
                    <div className="text-center py-8 text-[10px] text-[var(--text-muted)] border-2 border-dashed border-[var(--border-subtle)] rounded-xl">
                      Déposez ici
                    </div>
                  )}
                  {colLeads.map(lead => {
                    const days = getDaysInStage(lead);
                    const isDormant = days > 7 && status !== 'closed' && status !== 'lost';
                    return (
                      <div key={lead.id} draggable
                        onDragStart={e => handleDragStart(e, lead.id)}
                        className={`group relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3 cursor-grab active:cursor-grabbing transition-all hover:border-[var(--brand-primary)] hover:shadow-md
                          ${draggedId === lead.id ? 'opacity-30 scale-95' : ''}
                          ${isDormant ? 'border-l-[3px]' : ''}
                        `}
                        style={isDormant ? { borderLeftColor: 'var(--warning)' } : {}}>
                        
                        {/* Row 1 : Avatar + Name + 3-dots */}
                        <div className="flex items-start gap-2 mb-2">
                          <Avatar name={lead.name} size="xs" />
                          <div className="flex-1 min-w-0">
                            <Link to={`/leads/${lead.id}`} className="text-[13px] font-semibold text-[var(--text-primary)] hover:text-[var(--brand-primary)] transition-colors truncate block">
                              {lead.name}
                            </Link>
                            {lead.client_name && <p className="text-[10px] text-[var(--text-muted)] truncate">{lead.client_name}</p>}
                          </div>
                          <button className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-[var(--bg-subtle)] transition-all cursor-pointer text-[var(--text-muted)]">
                            <MoreHorizontal size={14} />
                          </button>
                        </div>

                        {/* Row 2 : Type + Value */}
                        <div className="flex items-center justify-between mb-2">
                          <Badge color={lead.type === 'buy' ? 'var(--brand-primary)' : 'var(--accent-orange)'}>{TYPE_LABELS[lead.type]}</Badge>
                          {lead.deal_value > 0 && (
                            <span className="text-[11px] font-bold text-[var(--brand-primary)]">{lead.deal_value.toLocaleString('fr-CA')} $</span>
                          )}
                        </div>

                        {/* Row 3 : Score bar */}
                        <div className="flex items-center gap-1.5 mb-2">
                          <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${lead.score}%`, background: scoreColor(lead.score) }} />
                          </div>
                          <span className="text-[10px] font-semibold" style={{ color: scoreColor(lead.score) }}>{lead.score}</span>
                        </div>

                        {/* Row 4 : Days in stage + Source */}
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="flex items-center gap-1 font-medium" style={{ color: daysColor(days) }}>
                            <Clock size={10} /> {days}j
                          </span>
                          <span className="text-[var(--text-muted)]">{SOURCE_LABELS[lead.source] || lead.source}</span>
                        </div>

                        {/* Tags */}
                        {lead.tags && lead.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {lead.tags.slice(0, 2).map(t => (
                              <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[var(--text-muted)]">{t}</span>
                            ))}
                            {lead.tags.length > 2 && <span className="text-[9px] text-[var(--text-muted)]">+{lead.tags.length - 2}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'list' ? (
        /* ── Vue Liste ── */
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Contact</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Client</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Statut</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Type</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Valeur</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Score</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Jours</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Source</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => {
                  const days = getDaysInStage(lead);
                  return (
                    <tr key={lead.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)] transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/leads/${lead.id}`} className="flex items-center gap-2 hover:text-[var(--brand-primary)]">
                          <Avatar name={lead.name} size="xs" />
                          <span className="font-medium text-[13px]">{lead.name}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{lead.client_name || '—'}</td>
                      <td className="px-4 py-3"><Badge color={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge></td>
                      <td className="px-4 py-3"><Badge color={lead.type === 'buy' ? 'var(--brand-primary)' : 'var(--accent-orange)'}>{TYPE_LABELS[lead.type]}</Badge></td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-[var(--brand-primary)]">{lead.deal_value > 0 ? `${lead.deal_value.toLocaleString('fr-CA')} $` : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${lead.score}%`, background: scoreColor(lead.score) }} />
                          </div>
                          <span className="text-[10px] font-semibold" style={{ color: scoreColor(lead.score) }}>{lead.score}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium" style={{ color: daysColor(days) }}>{days}j</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{SOURCE_LABELS[lead.source] || lead.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* ── Vue Forecast ── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PIPELINE_COLUMNS.filter(s => s !== 'lost').map(status => {
            const colLeads = getColumnLeads(status);
            const colValue = colLeads.reduce((s, l) => s + (l.deal_value || 0), 0);
            const weighted = colValue * (STAGE_PROBABILITY[status] / 100);
            return (
              <Card key={status} className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">{STATUS_LABELS[status]}</h3>
                  <span className="ml-auto text-xs text-[var(--text-muted)]">{STAGE_PROBABILITY[status]}%</span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Opportunités</span>
                    <span className="font-semibold">{colLeads.length}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Valeur brute</span>
                    <span className="font-semibold">{colValue.toLocaleString('fr-CA')} $</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Prévision pondérée</span>
                    <span className="font-bold text-[var(--success)]">{weighted.toLocaleString('fr-CA')} $</span>
                  </div>
                </div>
                <div className="h-2 mt-3 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min((colValue / (totalValue || 1)) * 100, 100)}%`, background: STATUS_COLORS[status] }} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Modal Lost Reason ── */}
      <Modal isOpen={lostModal.show} onClose={() => setLostModal({ leadId: '', show: false })} title="Marquer comme perdu">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Raison de la perte</label>
            <select value={lostReason} onChange={e => setLostReason(e.target.value)}
              className="w-full h-[38px] px-3 text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none">
              <option value="">Sélectionner une raison...</option>
              {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Détails (optionnel)</label>
            <textarea value={lostDetails} onChange={e => setLostDetails(e.target.value)} rows={3} placeholder="Notes supplémentaires..."
              className="w-full px-3 py-2.5 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-lg placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLostModal({ leadId: '', show: false })}>Annuler</Button>
            <Button onClick={() => void confirmLost()} className="!bg-[var(--danger)] hover:!bg-[var(--danger)]/90">Confirmer la perte</Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
