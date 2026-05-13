// ── Page Lead Detail — Fiche individuelle d'un lead (Sprint Design) ──

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Skeleton, EmptyState, useToast, useConfirm, AiSparkles, usePanelStack } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { getLeadDetail, updateLead, addTag, removeTag, getAppointments, getTasks, updateTask, getLeadNotes, createLeadNote, deleteLeadNote, getLeadScores, getLeadCustomFields, softDeleteLead, restoreLead, apiFetch, getPipelines, getLeadMessages } from '@/lib/api';
import { getCachedLead, setCachedLead } from '@/lib/prefetch';
import { confettiBurst } from '@/lib/confetti';
import { AiNextActionCard } from '@/components/panels/AiNextActionCard';
import { LeadTimeline } from '@/components/panels/LeadTimeline';
import { ConversationPanel } from '@/components/conversations/ConversationPanel';
import {
  STATUS_LABELS, STATUS_COLORS, SOURCE_LABELS, LEAD_STATUSES,
  LIFECYCLE_LABELS, LIFECYCLE_COLORS, NOTE_CATEGORY_LABELS, NOTE_CATEGORY_ICONS,
  APPOINTMENT_TYPE_ICONS, APPOINTMENT_TYPE_LABELS, APPOINTMENT_STATUS_LABELS,
  TASK_PRIORITY_ICONS, TASK_STATUS_ICONS, TASK_STATUS_LABELS,
  type LeadDetail, type LeadStatus, type Appointment, type Task,
  type LeadNote, type LeadScore, type CustomFieldValue, type LifecycleStage,
  type PipelineStage,
} from '@/lib/types';
import { ArrowLeft, Star, Phone, Mail, CalendarPlus, CheckSquare, Trash2, Compass } from 'lucide-react';
import { PhoneLink } from '@/components/ui/PhoneLink';

/**
 * Corps de la fiche lead — utilisable en page complète (via LeadDetailPage)
 * ou dans un SlidePanel (via LeadPanel). Pas d'AppLayout interne.
 */
export function LeadDetailBody({ leadId, compact = false }: { leadId: string; compact?: boolean }) {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const { openPanel } = usePanelStack();
  // Initial state hydraté depuis le cache prefetch (hover) → 0 flash si frais
  const cachedLead = getCachedLead(leadId);
  const [lead, setLead] = useState<LeadDetail | null>(cachedLead);
  const [isLoading, setIsLoading] = useState(!cachedLead);
  const [newTag, setNewTag] = useState('');
  const [editDealValue, setEditDealValue] = useState('');
  const [isEditingDeal, setIsEditingDeal] = useState(false);
  const [leadAppointments, setLeadAppointments] = useState<Appointment[]>([]);
  const [leadTasks, setLeadTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<'details' | 'conversations' | 'activity' | 'notes' | 'scores'>('details');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldValue, setFieldValue] = useState('');
  // Sprint 2
  const [leadNotes, setLeadNotes] = useState<LeadNote[]>([]);
  const [leadScores, setLeadScores] = useState<LeadScore[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldValue[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [messagesCount, setMessagesCount] = useState(0);
  const [newNoteBody, setNewNoteBody] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState('general');

  const loadLead = useCallback(async () => {
    // Si on a déjà un cache frais, on continue à afficher pendant le refresh background
    if (!getCachedLead(leadId)) setIsLoading(true);
    const result = await getLeadDetail(leadId);
    if (result.data) {
      setLead(result.data);
      setCachedLead(leadId, result.data); // alimente le cache pour les prochains navigations
      setEditDealValue(String(result.data.deal_value || 0));
    }
    setIsLoading(false);
  }, [leadId]);

  useEffect(() => {
    void loadLead();
    getAppointments().then(res => {
      if (res.data) setLeadAppointments(res.data.filter(a => a.lead_id === leadId));
    }).catch(() => { /* ignoré */ });
    getTasks({ lead_id: leadId }).then(res => {
      if (res.data) setLeadTasks(res.data);
    }).catch(() => { /* ignoré */ });
    // Sprint 2
    getLeadNotes(leadId).then(r => { if (r.data) setLeadNotes(r.data); }).catch(() => {});
    getLeadScores(leadId).then(r => { if (r.data) setLeadScores(r.data); }).catch(() => {});
    getLeadCustomFields(leadId).then(r => { if (r.data) setCustomFields(r.data); }).catch(() => {});
    getPipelines().then(r => {
      if (r.data) {
        const defaultPipeline = r.data.find(p => p.is_default) || r.data[0];
        if (defaultPipeline?.stages) setPipelineStages(defaultPipeline.stages);
      }
    }).catch(() => {});
    getLeadMessages(leadId).then(r => { if (r.data) setMessagesCount(r.data.length); }).catch(() => {});
  }, [loadLead, leadId]);

  // ── Optimistic mutations : UI update immédiate, rollback en cas d'erreur ──
  const handleStatusChange = async (status: LeadStatus) => {
    if (!lead) return;
    const prev = lead;
    const wasNotWon = lead.status !== 'won';
    setLead({ ...lead, status });
    // Sprint 23 wave 8 — célébration confetti si passage à 'won'
    if (status === 'won' && wasNotWon) {
      confettiBurst();
      success(`🎉 ${lead.name} gagné !`);
    }
    const res = await updateLead(leadId, { status });
    if (res.error) {
      setLead(prev);
      toastError(`Erreur de mise à jour du statut : ${res.error}`);
    }
  };

  const handleSaveDeal = async () => {
    if (!lead) return;
    const newValue = Number(editDealValue) || 0;
    const prev = lead;
    setLead({ ...lead, deal_value: newValue });
    setIsEditingDeal(false);
    const res = await updateLead(leadId, { deal_value: newValue });
    if (res.error) {
      setLead(prev);
      toastError(`Erreur de mise à jour de la valeur : ${res.error}`);
    }
  };

  const handleAddTag = async () => {
    if (!newTag.trim() || !lead) return;
    const tag = newTag.trim();
    setNewTag('');
    if (lead.tags?.includes(tag)) return; // évite doublon
    const prev = lead;
    setLead({ ...lead, tags: [...(lead.tags || []), tag] });
    const res = await addTag(leadId, tag);
    if (res.error) {
      setLead(prev);
      toastError(`Erreur d'ajout du tag : ${res.error}`);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!lead) return;
    const prev = lead;
    setLead({ ...lead, tags: (lead.tags || []).filter(t => t !== tag) });
    const res = await removeTag(leadId, tag);
    if (res.error) {
      setLead(prev);
      toastError(`Erreur de suppression du tag : ${res.error}`);
    }
  };

  const handleForgetLead = async () => {
    const ok = await confirm({
      title: 'Droit à l\'oubli (Loi 25)',
      description: `Cette action est IRRÉVERSIBLE. Toutes les données personnelles de ${lead?.name || 'ce lead'} (nom, email, téléphone, adresse, messages, notes) seront effacées de manière définitive.\n\nL'enregistrement anonymisé sera conservé pour conformité comptable et statistiques agrégées.`,
      requireText: 'SUPPRIMER',
      confirmLabel: 'Effacer les données',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/leads/${leadId}/forget`, { method: 'POST' });
      success('Données personnelles effacées (Loi 25)');
      navigate({ to: '/leads' });
    } catch (e) {
      toastError('Erreur lors de la suppression');
    }
  };

  const handleExportPii = () => {
    window.open(`/api/leads/${leadId}/export-pii`, '_blank');
  };

  if (isLoading) {
    return (
      <div className={compact ? 'space-y-4' : 'max-w-4xl space-y-4'}>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (!lead) {
    return (
      <EmptyState title="Lead introuvable" description="Ce lead n'existe pas ou a été supprimé."
        action={<Button onClick={() => void navigate({ to: '/leads' })}>Retour aux leads</Button>} />
    );
  }

  // Édition inline d'un champ
  const startEdit = (field: string, value: string) => { setEditingField(field); setFieldValue(value); };
  const saveField = async (field: string) => {
    await updateLead(leadId, { [field]: fieldValue } as Record<string, string>);
    setEditingField(null);
    void loadLead();
  };

  // Avatar géré par le composant Avatar

  // Probabilité par stage : source backend (pipeline_stages.probability) via lead.stage_id.
  // Fallback legacy si pas encore migré vers stage_id (anciens leads pré-Multi-Pipelines).
  // Fallback aligné sur LEAD_STATUSES réels du codebase (new, contacted, qualified, won, closed, lost)
  const LEGACY_STAGE_PROBABILITY: Record<string, number> = { new: 10, contacted: 25, qualified: 60, won: 100, closed: 100, lost: 0 };
  const stageFromBackend = pipelineStages.find(s => s.id === (lead as { stage_id?: string }).stage_id);
  const probability = stageFromBackend?.probability ?? LEGACY_STAGE_PROBABILITY[lead.status] ?? 0;
  const forecast = (lead.deal_value || 0) * probability / 100;

  return (
    <>
      {/* Bouton retour — masqué en mode compact (panel) */}
      {!compact && (
        <button onClick={() => void navigate({ to: '/leads' })}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-primary)] mb-4 flex items-center gap-1.5 cursor-pointer transition-colors">
          <ArrowLeft size={16} /> Retour aux leads
        </button>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-6xl">
        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-4">
          {/* En-tête HERO (Sprint 23) — orb décoratif + gradient title */}
          <div className="relative overflow-hidden rounded-2xl p-6"
            style={{
              background: lead.score >= 70
                ? 'linear-gradient(135deg, #FFFFFF 0%, #F0FAFE 60%, #E0F4FB 100%)'
                : 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
              border: lead.score >= 70 ? '1.5px solid rgba(0,157,219,0.45)' : '1px solid var(--border-subtle)',
              boxShadow: lead.score >= 70
                ? '0 1px 2px rgba(0,157,219,0.08), 0 12px 32px -8px rgba(0,157,219,0.25)'
                : '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.08)',
              marginBottom: '1rem',
            }}>
            {/* Orb décoratif animé */}
            <div className="hero-stat-orb absolute rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(217,110,39,0.28) 0%, rgba(0,157,219,0.16) 50%, transparent 80%)', width: 260, height: 260, top: -100, right: -80, filter: 'blur(48px)' }} />

            {lead.score >= 70 && <span className="badge-hot">HOT {lead.score}</span>}

            <div className="relative z-10 flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                <Avatar name={lead.name} size="lg" ring={lead.score >= 70 ? 'hot' : 'none'} />
                <div>
                  <h2 className="text-2xl font-bold tracking-tight leading-tight">
                    {lead.score >= 70 ? <span className="text-gradient-brand">{lead.name}</span> : lead.name}
                  </h2>
                  <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mt-1">
                    <button onClick={() => void navigate({ to: `/clients/${lead.client_id}` })} className="hover:text-[var(--brand-primary)] cursor-pointer transition-colors font-medium">{lead.client_name}</button>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span>{SOURCE_LABELS[lead.source] || lead.source}</span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span>{new Date(lead.created_at).toLocaleDateString('fr-CA')}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={async () => {
                    if (!lead) return;
                    const prev = lead;
                    const nextFav = lead.favorite ? 0 : 1;
                    setLead({ ...lead, favorite: nextFav } as typeof lead);
                    const res = await updateLead(leadId, { favorite: nextFav } as Record<string, unknown>);
                    if (res.error) { setLead(prev); toastError(`Erreur favori : ${res.error}`); }
                  }}
                  className="p-1 cursor-pointer hover:scale-110 transition-transform" title={lead.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
                  <Star size={18} className={lead.favorite ? 'fill-[var(--warning)] text-[var(--warning)]' : 'text-[var(--text-muted)]'} />
                </button>
                <Badge color={lead.type === 'inbound' ? 'var(--brand-primary)' : 'var(--warning)'}>
                  {lead.type === 'inbound' ? 'Entrant' : lead.type === 'customer' ? 'Client' : lead.type}
                </Badge>
                <Badge color={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                {lead.lifecycle_stage && (
                  <Badge color={LIFECYCLE_COLORS[lead.lifecycle_stage as LifecycleStage] || 'var(--text-muted)'}>
                    {LIFECYCLE_LABELS[lead.lifecycle_stage as LifecycleStage] || lead.lifecycle_stage}
                  </Badge>
                )}
                {lead.dnd ? <span title="Ne pas déranger" className="text-sm">🔕</span> : null}
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Déplacer vers la corbeille ?',
                      description: `${lead.name} sera déplacé vers la corbeille. Vous pourrez le restaurer pendant 30 jours.`,
                      confirmLabel: 'Déplacer',
                      danger: true,
                    });
                    if (ok) {
                      const res = await softDeleteLead(leadId);
                      if (res.error) {
                        toastError(res.error);
                      } else {
                        success('Lead déplacé vers la corbeille', {
                          duration: 10000,
                          action: {
                            label: 'Annuler',
                            onClick: async () => {
                              const restoreRes = await restoreLead(leadId);
                              if (!restoreRes.error) {
                                success('Lead restauré');
                                // Revenir sur la fiche restaurée plutôt que de full-reload
                                void navigate({ to: `/leads/${leadId}` });
                              } else {
                                toastError('Erreur lors de la restauration');
                              }
                            }
                          }
                        });
                        void navigate({ to: '/leads' });
                      }
                    }
                  }}
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 cursor-pointer transition-all"
                  title="Supprimer le lead"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Actions rapides */}
            <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-[var(--border-subtle)]">
              {lead.phone && (
                <PhoneLink phone={lead.phone} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--brand-primary)] hover:text-white transition-colors cursor-pointer">
                  <Phone size={13} /> Appeler
                </PhoneLink>
              )}
              <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--brand-primary)] hover:text-white transition-colors cursor-pointer">
                <Mail size={13} /> Email
              </a>
              <button onClick={() => void navigate({ to: '/calendar' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--brand-primary)] hover:text-white transition-colors cursor-pointer">
                <CalendarPlus size={13} /> Planifier RDV
              </button>
              <button onClick={() => void navigate({ to: '/tasks' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--brand-primary)] hover:text-white transition-colors cursor-pointer">
                <CheckSquare size={13} /> Créer tâche
              </button>
              <button onClick={() => void navigate({ to: `/visit/${leadId}` })} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-gradient-to-r from-indigo-500/10 to-purple-500/10 text-indigo-600 border border-indigo-500/20 hover:bg-indigo-500 hover:text-white transition-colors cursor-pointer">
                <Compass size={13} /> Mode Visite
              </button>
            </div>

            {/* Champs avec édition inline */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[{ key: 'email', label: 'Email', val: lead.email, link: `mailto:${lead.email}` },
                { key: 'phone', label: 'Téléphone', val: lead.phone || '—', isPhone: true },
                { key: 'address', label: 'Adresse', val: lead.address || '—' },
                { key: 'budget', label: 'Budget', val: lead.budget || '—' },
                { key: 'property_type', label: 'Type propriété', val: lead.property_type || '—' },
                { key: 'timeline', label: 'Délai', val: lead.timeline || '—' },
              ].map(f => (
                <div key={f.key}>
                  <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider mb-0.5">{f.label}</p>
                  {editingField === f.key ? (
                    <input autoFocus value={fieldValue} onChange={e => setFieldValue(e.target.value)}
                      onBlur={() => void saveField(f.key)} onKeyDown={e => { if (e.key === 'Enter') void saveField(f.key); if (e.key === 'Escape') setEditingField(null); }}
                      className="w-full px-1.5 py-0.5 text-sm bg-[var(--bg-surface)] border border-[var(--brand-primary)] rounded-[var(--radius-sm)] focus:outline-none" />
                  ) : (
                    <button onClick={() => startEdit(f.key, f.val === '—' ? '' : f.val)} className="text-left cursor-pointer hover:text-[var(--brand-primary)] transition-colors w-full group">
                      {'isPhone' in f && f.isPhone && f.val !== '—' ? <PhoneLink phone={f.val} showIcon={false}>{f.val}</PhoneLink> : f.link && f.val !== '—' ? <a href={f.link} className="text-[var(--brand-primary)] hover:underline" onClick={e => e.stopPropagation()}>{f.val}</a> : <span>{f.val}</span>}
                      <span className="text-[10px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 ml-1">✏️</span>
                    </button>
                  )}
                </div>
              ))}
              {lead.message && <div className="col-span-2"><p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider mb-0.5">Message</p><p className="text-[var(--text-secondary)] text-sm">{lead.message}</p></div>}
            </div>

            {/* UTM */}
            {(lead.utm_source || lead.utm_medium || lead.utm_campaign) && (
              <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap gap-2">
                {lead.utm_source && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[var(--text-muted)]">source: {lead.utm_source}</span>}
                {lead.utm_medium && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[var(--text-muted)]">medium: {lead.utm_medium}</span>}
                {lead.utm_campaign && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[var(--text-muted)]">campaign: {lead.utm_campaign}</span>}
              </div>
            )}

            {/* Champs Personnalisés — source unique : customFields state (chargé via getLeadCustomFields) */}
            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Champs Personnalisés</h3>
                <button onClick={() => void navigate({ to: '/settings' })} className="text-[10px] text-[var(--brand-primary)] hover:underline cursor-pointer">Gérer les champs</button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {customFields.length > 0 ? (
                  customFields.map(cf => (
                    <div key={cf.field_id}>
                      <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider mb-0.5">{cf.field_name}</p>
                      <p>{cf.value || '—'}</p>
                    </div>
                  ))
                ) : (
                  <div className="col-span-2 text-xs text-[var(--text-muted)] italic">Aucun champ personnalisé défini pour ce lead.</div>
                )}
              </div>
            </div>
          </div>

          {/* Onglets Sprint 23 — underline gradient + glow sur active */}
          <div className="flex gap-1 border-b border-[var(--border-subtle)] overflow-x-auto relative">
            {([['details', 'Détails'], ['notes', `Notes (${leadNotes.length})`], ['conversations', `Conversations (${messagesCount})`], ['scores', 'Scores'], ['activity', 'Activité']] as const).map(([key, label]) => {
              const isActive = activeTab === key;
              return (
                <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
                  className={`relative px-4 py-2.5 text-[13px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    isActive ? 'text-[var(--brand-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}>
                  {label}
                  {isActive && (
                    <div className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t-full"
                      style={{
                        background: 'linear-gradient(90deg, #009DDB 0%, #D96E27 100%)',
                        boxShadow: '0 -2px 12px rgba(0,157,219,0.5), 0 0 8px rgba(217,110,39,0.4)',
                      }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Contenu par onglet */}
          {/* Note legacy lead.notes : déplacée dans l'onglet Notes (voir activeTab === 'notes'). */}

          {activeTab === 'conversations' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-3">💬 Conversations</h3>
            <ConversationPanel
              leadId={lead.id}
              leadName={lead.name}
              leadEmail={lead.email}
              leadPhone={lead.phone}
            />
          </Card>
          )}

          {activeTab === 'activity' && (
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">📋 Timeline complète</h3>
              <span className="text-[10px] text-[var(--text-muted)]">Activité · Notes · RDV · Tâches</span>
            </div>
            <LeadTimeline lead={lead} notes={leadNotes} appointments={leadAppointments} tasks={leadTasks} />
          </Card>
          )}

          {activeTab === 'notes' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-3">📝 Notes ({leadNotes.length})</h3>
            {/* Note héritée (lead.notes legacy) — proposée à la conversion en note structurée */}
            {lead.notes && lead.notes.trim() && (
              <div className="mb-4 p-3 rounded-[var(--radius-md)] border border-[var(--warning)] bg-[oklch(0.95_0.02_90)]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-[var(--text-muted)]">📌 Note héritée (ancien format)</span>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await createLeadNote(leadId, { body: lead.notes!, category: 'general' });
                        await updateLead(leadId, { notes: '' });
                        const r = await getLeadNotes(leadId); if (r.data) setLeadNotes(r.data);
                        void loadLead();
                      }}
                      className="text-xs text-[var(--brand-primary)] hover:underline cursor-pointer">
                      Convertir en note
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await confirm({ title: 'Supprimer la note héritée ?', confirmLabel: 'Supprimer', danger: true });
                        if (!ok) return;
                        await updateLead(leadId, { notes: '' });
                        void loadLead();
                      }}
                      className="text-xs text-[var(--danger)] hover:underline cursor-pointer">
                      Supprimer
                    </button>
                  </div>
                </div>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{lead.notes}</p>
              </div>
            )}
            {/* Formulaire ajout note */}
            <div className="mb-4 space-y-2 p-3 rounded-[var(--radius-md)] bg-[var(--bg-subtle)]">
              <div className="relative">
                <textarea value={newNoteBody} onChange={e => setNewNoteBody(e.target.value)} rows={3}
                  placeholder="Ajouter une note..."
                  className="w-full px-3 py-2 pr-10 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] resize-none focus:border-[var(--brand-primary)] focus:outline-none" />
                <AiSparkles value={newNoteBody} onChange={setNewNoteBody} leadId={leadId} className="absolute bottom-2 right-2" />
              </div>
              <div className="flex items-center gap-2">
                <select value={newNoteCategory} onChange={e => setNewNoteCategory(e.target.value)}
                  className="text-xs px-2 py-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[var(--text-secondary)]">
                  {Object.entries(NOTE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{NOTE_CATEGORY_ICONS[k]} {v}</option>)}
                </select>
                <Button size="sm" disabled={!newNoteBody.trim()} onClick={async () => {
                  await createLeadNote(leadId, { body: newNoteBody, category: newNoteCategory });
                  setNewNoteBody(''); setNewNoteCategory('general');
                  const r = await getLeadNotes(leadId); if (r.data) setLeadNotes(r.data);
                }}>Ajouter</Button>
              </div>
            </div>
            {/* Liste des notes */}
            {leadNotes.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Aucune note pour le moment.</p>
            ) : (
              <div className="space-y-3">
                {leadNotes.map(note => (
                  <div key={note.id} className={`p-3 rounded-[var(--radius-md)] border ${note.is_pinned ? 'border-[var(--warning)] bg-[oklch(0.95_0.02_90)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        {note.is_pinned ? <span>📌</span> : null}
                        <span>{NOTE_CATEGORY_ICONS[note.category] || '📝'} {NOTE_CATEGORY_LABELS[note.category] || note.category}</span>
                        <span>·</span>
                        <span>{note.author_name || 'Système'}</span>
                        <span>·</span>
                        <span>{new Date(note.created_at).toLocaleDateString('fr-CA')}</span>
                      </div>
                      <button onClick={async () => {
                          const prev = leadNotes;
                          setLeadNotes(leadNotes.filter(n => n.id !== note.id));
                          const res = await deleteLeadNote(leadId, note.id);
                          if (res.error) { setLeadNotes(prev); toastError(`Erreur suppression note : ${res.error}`); }
                        }}
                        className="text-xs text-[var(--danger)] hover:underline cursor-pointer">✕</button>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{note.body}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
          )}

          {activeTab === 'scores' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-3">📊 Scores multi-profils</h3>
            {leadScores.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Aucun score calculé. Les scores seront calculés automatiquement.</p>
            ) : (
              <div className="space-y-3">
                {leadScores.map(s => (
                  <div key={s.profile_id} className="p-3 rounded-[var(--radius-md)] bg-[var(--bg-subtle)]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className={`text-lg font-bold ${s.score >= 70 ? 'text-[var(--success)]' : s.score >= 40 ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}`}>{s.score}/100</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${s.score >= 70 ? 'bg-[var(--success)]' : s.score >= 40 ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'}`}
                        style={{ width: `${s.score}%` }} />
                    </div>
                    {s.description && <p className="text-xs text-[var(--text-muted)] mt-1">{s.description}</p>}
                  </div>
                ))}
              </div>
            )}
            {/* Custom Fields rendus dans le tab Détails (source unique) */}
          </Card>
          )}

        </div>

        {/* Colonne latérale */}
        <div className="space-y-4">
          {/* Statut */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Statut</h3>
            <div className="space-y-1.5">
              {LEAD_STATUSES.map((s) => (
                <button key={s} onClick={() => void handleStatusChange(s)}
                  className={`w-full text-left px-3 py-2 rounded-[var(--radius-md)] text-sm font-medium transition-all cursor-pointer ${lead.status === s
                    ? 'text-white shadow-[var(--shadow-glow)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'}`}
                  style={lead.status === s ? { backgroundColor: STATUS_COLORS[s].replace('var(', '').replace(')', '') ? undefined : undefined, background: 'var(--brand-primary)' } : {}}>
                  <Badge color={STATUS_COLORS[s]}>{STATUS_LABELS[s]}</Badge>
                </button>
              ))}
            </div>
          </Card>

          {/* Opportunité / Deal */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">💰 Opportunité</h3>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-[var(--text-muted)] mb-0.5">Valeur du deal</p>
                {isEditingDeal ? (
                  <div className="flex gap-2">
                    <input type="number" value={editDealValue} onChange={(e) => setEditDealValue(e.target.value)}
                      className="flex-1 px-2 py-1.5 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] focus:outline-none" />
                    <Button size="sm" onClick={() => void handleSaveDeal()}>OK</Button>
                  </div>
                ) : (
                  <button onClick={() => setIsEditingDeal(true)} className="text-xl font-bold text-[var(--brand-primary)] cursor-pointer hover:underline">
                    {lead.deal_value ? `${lead.deal_value.toLocaleString('fr-CA')} $` : 'Ajouter'}
                  </button>
                )}
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-muted)] mb-0.5">Probabilité ({stageFromBackend?.name || STATUS_LABELS[lead.status]})</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--brand-primary)] transition-all" style={{ width: `${probability}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-[var(--brand-primary)]">{probability}%</span>
                </div>
              </div>
              {forecast > 0 && (
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-0.5">Prévision pondérée</p>
                  <p className="text-sm font-semibold text-[var(--success)]">{forecast.toLocaleString('fr-CA')} $</p>
                </div>
              )}
            </div>
          </Card>

          {/* Tags */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">🏷️ Tags</h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {lead.tags && lead.tags.length > 0 ? lead.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
                  {tag}
                  <button onClick={() => void handleRemoveTag(tag)} className="text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer">×</button>
                </span>
              )) : <p className="text-xs text-[var(--text-muted)]">Aucun tag</p>}
            </div>
            <div className="flex gap-1.5">
              <input type="text" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nouveau tag..."
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddTag(); }}
                className="flex-1 px-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] focus:outline-none" />
              <Button size="sm" variant="secondary" onClick={() => void handleAddTag()}>+</Button>
            </div>
          </Card>

          {/* DND — Do Not Disturb */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">🔕 Ne pas déranger</h3>
            <div className="space-y-2">
              {(['email', 'sms', 'call'] as const).map(channel => {
                const dndSettings = (() => {
                  try { return JSON.parse((lead as unknown as Record<string, unknown>).dnd_settings as string || '{}'); }
                  catch { return {}; }
                })() as Record<string, boolean>;
                const isActive = dndSettings[channel] ?? false;
                const icons = { email: '📧', sms: '📱', call: '📞' };
                const labels = { email: 'Email', sms: 'SMS', call: 'Appels' };
                return (
                  <button
                    key={channel}
                    onClick={() => {
                      const newSettings = { ...dndSettings, [channel]: !isActive };
                      const hasDnd = Object.values(newSettings).some(Boolean);
                      void updateLead(leadId, {
                        dnd: hasDnd ? 1 : 0,
                        dnd_settings: JSON.stringify(newSettings),
                      } as Record<string, unknown>).then(() => void loadLead());
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-[var(--radius-md)] text-xs font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] text-[var(--danger)] border border-[color-mix(in_oklch,var(--danger)_25%,transparent)]'
                        : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                    }`}
                  >
                    <span>{icons[channel]} {labels[channel]}</span>
                    <span className={`w-8 h-[18px] rounded-full relative transition-all ${isActive ? 'bg-[var(--danger)]' : 'bg-[var(--border-default)]'}`}>
                      <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all shadow-sm ${isActive ? 'left-[14px]' : 'left-[2px]'}`} />
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Champs étendus */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">📋 Infos complémentaires</h3>
            <div className="space-y-2 text-xs">
              {[
                { key: 'date_of_birth', label: 'Date de naissance', val: (lead as unknown as Record<string, unknown>).date_of_birth as string || '—', type: 'date' },
                { key: 'country', label: 'Pays', val: (lead as unknown as Record<string, unknown>).country as string || 'CA', type: 'text' },
                { key: 'timezone', label: 'Fuseau horaire', val: (lead as unknown as Record<string, unknown>).timezone as string || 'America/Toronto', type: 'text' },
              ].map(f => (
                <div key={f.key} className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">{f.label}</span>
                  {editingField === f.key ? (
                    <input
                      autoFocus type={f.type} value={fieldValue}
                      onChange={e => setFieldValue(e.target.value)}
                      onBlur={() => void saveField(f.key)}
                      onKeyDown={e => { if (e.key === 'Enter') void saveField(f.key); if (e.key === 'Escape') setEditingField(null); }}
                      className="w-32 px-1.5 py-0.5 text-xs bg-[var(--bg-surface)] border border-[var(--brand-primary)] rounded-[var(--radius-sm)] focus:outline-none text-right"
                    />
                  ) : (
                    <button onClick={() => startEdit(f.key, f.val === '—' ? '' : f.val)} className="text-right cursor-pointer hover:text-[var(--brand-primary)] transition-colors">
                      {f.val}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* RDV liés */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">📅 Rendez-vous</h3>
            {leadAppointments.length > 0 ? (
              <div className="space-y-2">
                {leadAppointments.map((appt) => {
                  const apptDate = new Date(appt.start_time + (appt.start_time.endsWith('Z') ? '' : 'Z'));
                  return (
                    <div key={appt.id} className="p-2 bg-[var(--bg-subtle)] rounded-[var(--radius-sm)]">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs">{APPOINTMENT_TYPE_ICONS[appt.type]}</span>
                        <span className="text-xs font-medium truncate">{appt.title}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {APPOINTMENT_TYPE_LABELS[appt.type]} · {apptDate.toLocaleDateString('fr-CA')} à {apptDate.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <Badge color={
                          appt.status === 'confirmed' ? 'var(--success)' :
                          appt.status === 'cancelled' ? 'var(--danger)' : 'var(--text-muted)'
                        }>
                          {APPOINTMENT_STATUS_LABELS[appt.status]}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">Aucun RDV planifié</p>
            )}
          </Card>

          {/* Score visuel */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">🔥 Lead Score</h3>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="h-2.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{
                    width: `${lead.score}%`,
                    background: lead.score >= 70 ? 'var(--success)' : lead.score >= 40 ? 'var(--warning)' : 'var(--danger)',
                  }} />
                </div>
              </div>
              <span className={`text-lg font-bold ${
                lead.score >= 70 ? 'text-[var(--success)]' : lead.score >= 40 ? 'text-[var(--warning)]' : 'text-[var(--danger)]'
              }`}>{lead.score}</span>
            </div>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              {lead.score >= 70 ? '🔥 Lead chaud — prêt à convertir' : lead.score >= 40 ? '🟡 Lead tiède — à relancer' : '🔵 Lead froid — à nourrir'}
            </p>
          </Card>

          {/* Sprint 20 : suggestion AI prochaine étape — affichée seulement si lead inactif >7j */}
          {(() => {
            const daysSinceUpdate = Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / 86400000);
            const isActive = !['closed', 'lost'].includes(lead.status);
            return daysSinceUpdate >= 7 && isActive ? <AiNextActionCard leadId={leadId} /> : null;
          })()}

          {/* Tâches liées */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">📋 Tâches</h3>
            {leadTasks.length > 0 ? (
              <div className="space-y-1.5">
                {leadTasks.map(task => (
                  <div key={task.id}
                    onClick={() => openPanel({ type: 'task', id: task.id })}
                    className={`w-full text-left p-2 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] cursor-pointer hover:bg-[var(--bg-muted)] transition-colors ${task.status === 'done' ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const next = task.status === 'done' ? 'todo' as const : 'done' as const;
                          const prevStatus = task.status;
                          setLeadTasks(prev => prev.map(t => t.id === task.id ? {...t, status: next} : t));
                          const res = await updateTask(task.id, { status: next });
                          if (res.error) {
                            setLeadTasks(prev => prev.map(t => t.id === task.id ? {...t, status: prevStatus} : t));
                            toastError(`Erreur mise à jour tâche : ${res.error}`);
                          }
                        }}
                        className="text-xs cursor-pointer hover:scale-110 transition-transform"
                        aria-label={task.status === 'done' ? 'Marquer comme à faire' : 'Marquer comme terminée'}>
                        {TASK_STATUS_ICONS[task.status]}
                      </button>
                      <span className={`text-xs font-medium truncate ${task.status === 'done' ? 'line-through' : ''}`}>{task.title}</span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)]">{TASK_PRIORITY_ICONS[task.priority]} {TASK_STATUS_LABELS[task.status]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">Aucune tâche liée</p>
            )}
          </Card>

          {/* Infos */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Infos</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Créé le</span><span>{new Date(lead.created_at).toLocaleDateString('fr-CA')}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Mis à jour</span><span>{new Date(lead.updated_at).toLocaleDateString('fr-CA')}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Source</span><span>{SOURCE_LABELS[lead.source] || lead.source}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">ID</span><span className="font-mono truncate ml-2">{lead.id.slice(0, 8)}</span></div>
            </div>
          </Card>

          {/* Conformité (Loi 25) */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">⚖️ Loi 25 (Québec)</h3>
            <div className="space-y-2">
              <Button size="sm" variant="secondary" className="w-full justify-center" onClick={handleExportPii}>
                Exporter données (JSON)
              </Button>
              <Button size="sm" className="w-full justify-center bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] text-[var(--danger)] hover:bg-[color-mix(in_oklch,var(--danger)_20%,transparent)] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)]" onClick={handleForgetLead}>
                Droit à l'oubli
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Wrapper page-complète (URL route /leads/:leadId) */
export function LeadDetailPage() {
  const { leadId } = useParams({ strict: false }) as { leadId: string };
  return (
    <AppLayout title="Fiche lead">
      <LeadDetailBody leadId={leadId} />
    </AppLayout>
  );
}
