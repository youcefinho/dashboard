// ── Page Pipeline — Vue Kanban enrichie ──────────────────

import { useState, useEffect, useCallback, type DragEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Skeleton, Card } from '@/components/ui';
import { getPipeline, updateLead } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, SOURCE_LABELS, type Lead, type LeadStatus } from '@/lib/types';

// Toutes les colonnes du pipeline
const PIPELINE_COLUMNS: LeadStatus[] = ['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'];

// Probabilité de conversion par stage
const STAGE_PROBABILITY: Record<LeadStatus, number> = {
  new: 10, contacted: 25, meeting: 50, signed: 90, closed: 100, lost: 0,
};

export function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<LeadStatus | null>(null);

  const loadPipeline = useCallback(async () => {
    setIsLoading(true);
    const result = await getPipeline();
    if (result.data) setLeads(result.data);
    setIsLoading(false);
  }, []);

  useEffect(() => { void loadPipeline(); }, [loadPipeline]);

  // ── Drag & Drop ─────────────────────────────────────────

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

  const handleDragLeave = () => { setDropTarget(null); };

  const handleDrop = async (e: DragEvent, newStatus: LeadStatus) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    setDraggedId(null);
    setDropTarget(null);
    if (!leadId) return;
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
    const result = await updateLead(leadId, { status: newStatus });
    if (result.error) void loadPipeline();
  };

  const getColumnLeads = (status: LeadStatus) => leads.filter(l => l.status === status);

  // Calculs globaux
  const totalPipelineValue = leads.reduce((sum, l) => sum + (l.deal_value || 0), 0);
  const weightedForecast = leads.reduce((sum, l) => sum + (l.deal_value || 0) * (STAGE_PROBABILITY[l.status] || 0) / 100, 0);

  // Détection leads dormants (> 7 jours dans le même stage)
  const getDaysInStage = (lead: Lead) => {
    const days = Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / 86400000);
    return days;
  };

  // Score couleur
  const scoreColor = (score: number) => score >= 70 ? 'var(--color-success)' : score >= 40 ? 'var(--color-warning)' : 'var(--color-danger)';

  return (
    <AppLayout title="Pipeline">
      {/* KPIs Pipeline */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-text-primary)]">{leads.length}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Opportunités</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-accent)]">{totalPipelineValue.toLocaleString('fr-CA')} $</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Valeur totale</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-success)]">{weightedForecast.toLocaleString('fr-CA')} $</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Prévision pondérée</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--color-warning)]">{leads.filter(l => getDaysInStage(l) > 7 && l.status !== 'closed' && l.status !== 'lost').length}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Dormants (&gt;7j)</p>
        </Card>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {PIPELINE_COLUMNS.map(s => (
            <div key={s} className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 min-h-[calc(100vh-16rem)]">
          {PIPELINE_COLUMNS.map((status) => {
            const columnLeads = getColumnLeads(status);
            const isOver = dropTarget === status;
            const columnValue = columnLeads.reduce((s, l) => s + (l.deal_value || 0), 0);

            return (
              <div
                key={status}
                className={`flex flex-col rounded-[var(--radius-lg)] p-2.5 transition-all duration-200
                  ${isOver ? 'bg-[var(--color-bg-hover)] ring-2 ring-[var(--color-accent)]' : 'bg-[var(--color-bg-secondary)]'}
                  ${status === 'lost' ? 'opacity-60' : ''}
                `}
                onDragOver={(e) => handleDragOver(e, status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => void handleDrop(e, status)}
              >
                {/* En-tête colonne */}
                <div className="mb-3 px-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
                      <h3 className="text-xs font-bold uppercase tracking-wider">{STATUS_LABELS[status]}</h3>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] px-1.5 py-0.5 rounded-full">
                      {columnLeads.length}
                    </span>
                  </div>
                  {/* Valeur colonne + probabilité */}
                  <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                    <span>{columnValue > 0 ? `${columnValue.toLocaleString('fr-CA')} $` : '—'}</span>
                    <span>{STAGE_PROBABILITY[status]}%</span>
                  </div>
                  <div className="h-1 mt-1 rounded-full bg-[var(--color-bg-hover)] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${STAGE_PROBABILITY[status]}%`, background: STATUS_COLORS[status] }} />
                  </div>
                </div>

                {/* Cartes leads */}
                <div className="flex-1 space-y-2 overflow-y-auto max-h-[calc(100vh-22rem)]">
                  {columnLeads.length === 0 && (
                    <div className="text-center py-6 text-[10px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border-subtle)] rounded-[var(--radius-md)]">
                      Déposez ici
                    </div>
                  )}
                  {columnLeads.map((lead) => {
                    const daysInStage = getDaysInStage(lead);
                    const isDormant = daysInStage > 7 && status !== 'closed' && status !== 'lost';

                    return (
                      <Link
                        key={lead.id}
                        to={`/leads/${lead.id}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, lead.id)}
                        className={`block card p-3 cursor-grab active:cursor-grabbing transition-all hover:border-[var(--color-accent)] hover:shadow-md
                          ${draggedId === lead.id ? 'opacity-40 scale-95' : ''}
                          ${isDormant ? 'border-l-2 border-l-[var(--color-warning)]' : ''}
                        `}
                      >
                        {/* Ligne 1 : Nom + Type */}
                        <div className="flex items-start justify-between mb-1.5">
                          <p className="text-sm font-medium truncate flex-1">{lead.name}</p>
                          <Badge color={lead.type === 'buy' ? 'var(--color-accent)' : 'var(--color-warning)'}>
                            {TYPE_LABELS[lead.type]}
                          </Badge>
                        </div>

                        {/* Ligne 2 : Client */}
                        {lead.client_name && (
                          <p className="text-[10px] text-[var(--color-text-muted)] mb-1.5">{lead.client_name}</p>
                        )}

                        {/* Ligne 3 : Score + Valeur */}
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1">
                            <div className="w-6 h-1.5 rounded-full bg-[var(--color-bg-hover)] overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${lead.score}%`, background: scoreColor(lead.score) }} />
                            </div>
                            <span className="text-[10px] text-[var(--color-text-muted)]">{lead.score}</span>
                          </div>
                          {lead.deal_value > 0 && (
                            <span className="text-[10px] font-semibold text-[var(--color-accent)]">{lead.deal_value.toLocaleString('fr-CA')} $</span>
                          )}
                        </div>

                        {/* Ligne 4 : Source + Date */}
                        <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                          <span>{SOURCE_LABELS[lead.source] || lead.source}</span>
                          <span className={isDormant ? 'text-[var(--color-warning)] font-semibold' : ''}>
                            {isDormant ? `⚠️ ${daysInStage}j` : new Date(lead.created_at).toLocaleDateString('fr-CA')}
                          </span>
                        </div>

                        {/* Tags */}
                        {lead.tags && lead.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {lead.tags.slice(0, 2).map(tag => (
                              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]">{tag}</span>
                            ))}
                            {lead.tags.length > 2 && <span className="text-[9px] text-[var(--color-text-muted)]">+{lead.tags.length - 2}</span>}
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
