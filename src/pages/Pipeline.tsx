// ── Page Pipeline — Vue Kanban drag & drop ──────────────────

import { useState, useEffect, useCallback, type DragEvent } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Skeleton } from '@/components/ui';
import { getPipeline, updateLead } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, LEAD_STATUSES, type Lead, type LeadStatus } from '@/lib/types';

// Colonnes du Kanban (sans 'closed' et 'lost' qui sont dans le pipeline fetch)
const PIPELINE_COLUMNS: LeadStatus[] = ['new', 'contacted', 'meeting', 'signed'];

export function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<LeadStatus | null>(null);

  const loadPipeline = useCallback(async () => {
    setIsLoading(true);
    const result = await getPipeline();
    if (result.data) {
      setLeads(result.data);
    }
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

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = async (e: DragEvent, newStatus: LeadStatus) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    setDraggedId(null);
    setDropTarget(null);

    if (!leadId) return;

    // Update optimiste
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));

    // Appel API
    const result = await updateLead(leadId, { status: newStatus });
    if (result.error) {
      // Rollback en cas d'erreur
      void loadPipeline();
    }
  };

  const getColumnLeads = (status: LeadStatus) => leads.filter(l => l.status === status);

  return (
    <AppLayout title="Pipeline">
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PIPELINE_COLUMNS.map(s => (
            <div key={s} className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 min-h-[calc(100vh-12rem)]">
          {PIPELINE_COLUMNS.map((status) => {
            const columnLeads = getColumnLeads(status);
            const isOver = dropTarget === status;

            return (
              <div
                key={status}
                className={`
                  flex flex-col rounded-[var(--radius-lg)] p-3
                  transition-all duration-[var(--transition-fast)]
                  ${isOver ? 'bg-[var(--color-bg-hover)] ring-2 ring-[var(--color-accent)] ring-opacity-50' : 'bg-[var(--color-bg-secondary)]'}
                `}
                onDragOver={(e) => handleDragOver(e, status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => void handleDrop(e, status)}
              >
                {/* En-tête colonne */}
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
                    <h3 className="text-sm font-semibold">{STATUS_LABELS[status]}</h3>
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] px-2 py-0.5 rounded-full">
                    {columnLeads.length}
                  </span>
                </div>

                {/* Cartes */}
                <div className="flex-1 space-y-2 overflow-y-auto">
                  {columnLeads.length === 0 && (
                    <div className="text-center py-8 text-xs text-[var(--color-text-muted)]">
                      Déposez un lead ici
                    </div>
                  )}
                  {columnLeads.map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, lead.id)}
                      className={`
                        card p-3 cursor-grab active:cursor-grabbing
                        transition-all duration-[var(--transition-fast)]
                        hover:border-[var(--color-accent)]
                        ${draggedId === lead.id ? 'opacity-40 scale-95' : 'opacity-100'}
                      `}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium truncate flex-1">{lead.name}</p>
                        <Badge color={lead.type === 'buy' ? 'var(--color-accent)' : 'var(--color-warning)'}>
                          {TYPE_LABELS[lead.type]}
                        </Badge>
                      </div>

                      {lead.client_name && (
                        <p className="text-xs text-[var(--color-text-muted)] mb-1">{lead.client_name}</p>
                      )}

                      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                        {lead.phone && (
                          <span className="flex items-center gap-1">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                            </svg>
                            {lead.phone}
                          </span>
                        )}
                      </div>

                      <p className="text-[10px] text-[var(--color-text-muted)] mt-2">
                        {new Date(lead.created_at).toLocaleDateString('fr-CA')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Légende statuts exclus */}
      <div className="mt-4 flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
        <span>Statuts hors pipeline :</span>
        {(LEAD_STATUSES.filter(s => !PIPELINE_COLUMNS.includes(s))).map(s => (
          <span key={s} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
            {STATUS_LABELS[s]}
          </span>
        ))}
      </div>
    </AppLayout>
  );
}
