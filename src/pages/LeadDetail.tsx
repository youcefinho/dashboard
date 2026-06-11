// ── Page Lead Detail — Fiche individuelle d'un lead (Sprint Design) ──

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Skeleton, EmptyState, Select, useToast, useConfirm, AiSparkles, usePanelStack } from '@/components/ui';
import { t } from '@/lib/i18n';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import { Avatar } from '@/components/ui/Avatar';
import { getLeadDetail, updateLead, addTag, removeTag, getAppointments, getTasks, updateTask, getLeadNotes, createLeadNote, deleteLeadNote, getLeadScores, getLeadCustomFields, softDeleteLead, restoreLead, getPipelines, getLeadMessages, getCallLogs, placeCall, setCallDisposition, getLeadConversionScore, routeLeadPredictively, getCustomFields, setLeadCustomFields, getWorkflows, enrollLead, getLeadAutomationHistory, type CallLog, getLeadBehavioralEvents, type BehavioralEvent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LeadPrivacyActions } from '@/components/leads/LeadPrivacyActions';
import { getCachedLead, setCachedLead } from '@/lib/prefetch';
import { confettiBurst } from '@/lib/confetti';
import { AiNextActionCard } from '@/components/panels/AiNextActionCard';
import { LeadPredictionCard } from '@/components/panels/LeadPredictionCard';
import { LeadTimeline } from '@/components/panels/LeadTimeline';
import { ConversationPanel } from '@/components/conversations/ConversationPanel';
import {
  STATUS_LABELS, STATUS_COLORS, SOURCE_LABELS, LEAD_STATUSES,
  LIFECYCLE_LABELS, LIFECYCLE_COLORS, NOTE_CATEGORY_LABELS, NOTE_CATEGORY_ICONS,
  APPOINTMENT_TYPE_ICONS, APPOINTMENT_TYPE_LABELS, APPOINTMENT_STATUS_LABELS,
  TASK_PRIORITY_ICONS, TASK_STATUS_ICONS, TASK_STATUS_LABELS,
  type LeadDetail, type LeadStatus, type Appointment, type Task,
  type LeadNote, type LeadScore, type CustomFieldValue, type LifecycleStage,
  type PipelineStage, type ConversionPrediction, type Workflow, type CustomFieldDef, type ExecLogEntry,
} from '@/lib/types';
import { ArrowLeft, Star, Phone, Mail, CalendarPlus, CheckSquare, Trash2, Compass, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { PhoneLink } from '@/components/ui/PhoneLink';

// ── Sprint 16 (seq 116) — dispositions post-appel (whitelist alignée HANDLER) ──
//   Libellés via clés i18n FIGÉES Phase A (telephony.disposition.*).
const DISPOSITION_OPTIONS = ['interested', 'callback', 'voicemail', 'wrong_number', 'not_interested'] as const;

/**
 * Sprint 16 — éditeur de disposition + notes post-appel sur une entrée du journal.
 *   Best-effort : sélecteur disposition (telephony.disposition.*) + champ notes
 *   (telephony.notes.label/.save) → setCallDisposition(id, { disposition, notes }).
 *   Affiche la disposition/notes persistées. Aucun crash : KO ⇒ toast discret.
 */
function CallDispositionEditor({ call, onSaved }: { call: CallLog; onSaved: (id: string, disposition: string, notes: string) => void }) {
  const { success, error: toastError } = useToast();
  const [disposition, setDisposition] = useState(call.disposition || '');
  const [notes, setNotes] = useState(call.notes || '');
  const [saving, setSaving] = useState(false);
  const dirty = disposition !== (call.disposition || '') || notes !== (call.notes || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await setCallDisposition(call.id, { disposition: disposition || undefined, notes: notes || undefined });
      if (res.error) {
        toastError(res.error);
      } else {
        success(t('telephony.notes.save'));
        onSaved(call.id, disposition, notes);
      }
    } catch {
      /* best-effort : pas de crash */
    }
    setSaving(false);
  };

  return (
    <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
      <Select
        size="sm"
        value={disposition}
        aria-label={t('telephony.disposition.label')}
        onChange={(e) => setDisposition(e.target.value)}
      >
        <option value="">{t('telephony.disposition.label')}</option>
        {DISPOSITION_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>{t(`telephony.disposition.${opt}`)}</option>
        ))}
      </Select>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t('telephony.notes.label')}
        rows={2}
        aria-label={t('telephony.notes.label')}
        className="w-full text-xs rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-[var(--text-primary)] resize-y focus:border-[var(--primary)] focus:outline-none focus:shadow-[0_0_0_3px_var(--primary-ring)]"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" disabled={saving || !dirty} onClick={() => void handleSave()}>
          {t('telephony.notes.save')}
        </Button>
      </div>
    </div>
  );
}

interface MultiSelectEditorProps {
  options: string[];
  value: string;
  onSave: (val: string) => void;
  onCancel: () => void;
}

function MultiSelectEditor({ options, value, onSave, onCancel }: MultiSelectEditorProps) {
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const arr = JSON.parse(value);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return value ? value.split(',').map(v => v.trim()) : [];
    }
  });

  const toggle = (opt: string) => {
    setSelected(prev => prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]);
  };

  return (
    <div className="p-2 border border-[var(--border-subtle)] bg-[var(--bg-surface)] rounded-[var(--radius-md)] space-y-2 mt-1 z-10 relative">
      <div className="max-h-32 overflow-y-auto space-y-1">
        {options.map(opt => (
          <label key={opt} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={() => toggle(opt)}
              className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
            />
            {opt}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="secondary" onClick={onCancel}>Annuler</Button>
        <Button size="sm" onClick={() => onSave(JSON.stringify(selected))}>Valider</Button>
      </div>
    </div>
  );
}

const renderCustomFieldValue = (cf: CustomFieldValue) => {
  if (!cf.value) return '—';
  if (cf.field_type === 'boolean') {
    return cf.value === 'true' ? 'Oui ✅' : 'Non ❌';
  }
  if (cf.field_type === 'multiselect') {
    try {
      const arr = JSON.parse(cf.value);
      if (Array.isArray(arr)) {
        return (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {arr.map(v => (
              <span key={v} className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
                {v}
              </span>
            ))}
          </div>
        );
      }
    } catch {
      return cf.value.split(',').map(v => v.trim()).join(', ');
    }
  }
  return cf.value;
};

/**
 * Corps de la fiche lead — utilisable en page complète (via LeadDetailPage)
 * ou dans un SlidePanel (via LeadPanel). Pas d'AppLayout interne.
 */
export function LeadDetailBody({ leadId, compact = false }: { leadId: string; compact?: boolean }) {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const { openPanel } = usePanelStack();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Initial state hydraté depuis le cache prefetch (hover) → 0 flash si frais
  const cachedLead = getCachedLead(leadId);
  const [lead, setLead] = useState<LeadDetail | null>(cachedLead);
  const [isLoading, setIsLoading] = useState(!cachedLead);
  const [newTag, setNewTag] = useState('');
  const [editDealValue, setEditDealValue] = useState('');
  const [isEditingDeal, setIsEditingDeal] = useState(false);
  const [leadAppointments, setLeadAppointments] = useState<Appointment[]>([]);
  const [leadTasks, setLeadTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<'details' | 'conversations' | 'activity' | 'notes' | 'scores' | 'automations'>('details');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldValue, setFieldValue] = useState('');
  // Sprint 2
  const [leadNotes, setLeadNotes] = useState<LeadNote[]>([]);
  const [leadScores, setLeadScores] = useState<LeadScore[]>([]);
  const [behavioralEvents, setBehavioralEvents] = useState<BehavioralEvent[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldValue[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [automationHistory, setAutomationHistory] = useState<ExecLogEntry[]>([]);
  const [availableWorkflows, setAvailableWorkflows] = useState<Workflow[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [messagesCount, setMessagesCount] = useState(0);
  const [newNoteBody, setNewNoteBody] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState('general');
  // Sprint F Téléphonie — journal d'appels + click-to-call (additif, ultra-ciblé)
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [isCalling, setIsCalling] = useState(false);
  // Sprint 13 — score de conversion CALIBRÉ tenant (best-effort, optionnel).
  const [conversion, setConversion] = useState<ConversionPrediction | null>(null);
  const [routingResult, setRoutingResult] = useState<any | null>(null);
  const [isRouting, setIsRouting] = useState(false);

  const handleRouteLead = async () => {
    setIsRouting(true);
    try {
      const res = await routeLeadPredictively(leadId);
      if (res.error) {
        toastError(res.error || t('leads.routing.error'));
      } else if (res.data) {
        success(t('leads.routing.success', { name: res.data.agent_name }));
        setRoutingResult(res.data);
        void loadLead();
      }
    } catch {
      toastError(t('leads.routing.error'));
    }
    setIsRouting(false);
  };

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
    getLeadBehavioralEvents(leadId).then(r => { if (r.data) setBehavioralEvents(r.data); }).catch(() => {});
    getLeadCustomFields(leadId).then(r => { if (r.data) setCustomFields(r.data); }).catch(() => {});
    getCustomFields().then(r => { if (r.data) setCustomFieldDefs(r.data); }).catch(() => {});
    getLeadAutomationHistory(leadId).then(r => { if (r.data) setAutomationHistory(r.data); }).catch(() => {});
    getWorkflows().then(r => { if (r.data) setAvailableWorkflows(r.data); }).catch(() => {});
    getPipelines().then(r => {
      if (r.data) {
        const defaultPipeline = r.data.find(p => p.is_default) || r.data[0];
        if (defaultPipeline?.stages) setPipelineStages(defaultPipeline.stages);
      }
    }).catch(() => {});
    getLeadMessages(leadId).then(r => { if (r.data) setMessagesCount(r.data.length); }).catch(() => {});
    // Sprint F Téléphonie — journal d'appels du lead
    getCallLogs(leadId).then(r => { if (r.data) setCallLogs(r.data); }).catch(() => {});
    // Sprint 13 — score de conversion calibré (best-effort : KO/absent ⇒ pas d'affichage)
    setConversion(null);
    getLeadConversionScore(leadId).then(r => { if (r.data) setConversion(r.data); }).catch(() => {});
  }, [loadLead, leadId]);

  // Sprint F Téléphonie — click-to-call (gère le cas mock/non-configuré)
  const handlePlaceCall = async () => {
    setIsCalling(true);
    const res = await placeCall(leadId);
    setIsCalling(false);
    if (res.error) {
      // Téléphonie non configurée / credentials absents → message discret
      if (res.error.toLowerCase().includes('not configured') || res.error.toLowerCase().includes('non config')) {
        toastError(t('telephony.notconfigured'));
      } else {
        toastError(res.error);
      }
      return;
    }
    if (res.data?.mock) {
      // Worker en mode simulé (sans credentials Twilio) → on l'indique discrètement
      success(`${t('telephony.clicktocall.action')} · ${t('telephony.status.mock')}`);
    } else {
      success(t('telephony.clicktocall.action'));
    }
    // Rafraîchir le journal pour faire apparaître le nouvel appel
    getCallLogs(leadId).then(r => { if (r.data) setCallLogs(r.data); }).catch(() => {});
  };

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
      <EmptyState title={t('lead.not_found.title')} description={t('lead.not_found.desc')}
        action={<Button onClick={() => void navigate({ to: '/leads' })}>{t('lead.not_found.action')}</Button>} />
    );
  }

  // Édition inline d'un champ
  const startEdit = (field: string, value: string) => { setEditingField(field); setFieldValue(value); };
  const saveField = async (field: string) => {
    await updateLead(leadId, { [field]: fieldValue } as Record<string, string>);
    setEditingField(null);
    void loadLead();
  };

  const saveCustomField = async (fieldId: string, value: string) => {
    const res = await setLeadCustomFields(leadId, [{ field_id: fieldId, value }]);
    if (res.error) {
      toastError(`Erreur de mise à jour du champ : ${res.error}`);
    } else {
      success('Champ personnalisé mis à jour');
      getLeadCustomFields(leadId).then(r => { if (r.data) setCustomFields(r.data); });
    }
    setEditingField(null);
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
          className="text-sm text-[var(--text-muted)] hover:text-[var(--primary)] mb-4 flex items-center gap-1.5 cursor-pointer transition-colors">
          <ArrowLeft size={16} /> {t('lead.back')}
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
                    <button onClick={() => void navigate({ to: `/clients/${lead.client_id}` })} className="hover:text-[var(--primary)] cursor-pointer transition-colors font-medium">{lead.client_name}</button>
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
                  className="p-1 cursor-pointer hover:scale-110 transition-transform" title={lead.favorite ? t('lead.fav.remove') : t('lead.fav.add')}>
                  <Star size={18} className={lead.favorite ? 'fill-[var(--warning)] text-[var(--warning)]' : 'text-[var(--text-muted)]'} />
                </button>
                <Badge color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>
                  {lead.type === 'inbound' ? t('lead.type.inbound') : lead.type === 'customer' ? t('lead.type.customer') : lead.type}
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
                <PhoneLink phone={lead.phone} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--primary)] hover:text-white transition-colors cursor-pointer">
                  <Phone size={13} /> {t('lead.action.call')}
                </PhoneLink>
              )}
              <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--primary)] hover:text-white transition-colors cursor-pointer">
                <Mail size={13} /> Email
              </a>
              <button onClick={() => void navigate({ to: '/calendar' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--primary)] hover:text-white transition-colors cursor-pointer">
                <CalendarPlus size={13} /> {t('lead.action.schedule')}
              </button>
              <button onClick={() => void navigate({ to: '/tasks' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--primary)] hover:text-white transition-colors cursor-pointer">
                <CheckSquare size={13} /> {t('lead.action.create_task')}
              </button>
              <button onClick={() => void navigate({ to: `/visit/${leadId}` })} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-gradient-to-r from-indigo-500/10 to-purple-500/10 text-indigo-600 border border-indigo-500/20 hover:bg-indigo-500 hover:text-white transition-colors cursor-pointer">
                <Compass size={13} /> {t('lead.action.visit_mode')}
              </button>
            </div>

            {/* Champs avec édition inline */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[{ key: 'email', label: t('lead.field.email'), val: lead.email, link: `mailto:${lead.email}` },
                { key: 'phone', label: t('lead.field.phone'), val: lead.phone || '—', isPhone: true },
                { key: 'address', label: t('lead.field.address'), val: lead.address || '—' },
                { key: 'budget', label: t('lead.field.budget'), val: lead.budget || '—' },
                { key: 'property_type', label: t('lead.field.property_type'), val: lead.property_type || '—' },
                { key: 'timeline', label: t('lead.field.timeline'), val: lead.timeline || '—' },
              ].map(f => (
                <div key={f.key}>
                  <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider mb-0.5">{f.label}</p>
                  {editingField === f.key ? (
                    <input autoFocus value={fieldValue} onChange={e => setFieldValue(e.target.value)}
                      onBlur={() => void saveField(f.key)} onKeyDown={e => { if (e.key === 'Enter') void saveField(f.key); if (e.key === 'Escape') setEditingField(null); }}
                      className="w-full px-1.5 py-0.5 text-sm bg-[var(--bg-surface)] border border-[var(--primary)] rounded-[var(--radius-sm)] focus:outline-none" />
                  ) : (
                    <button onClick={() => startEdit(f.key, f.val === '—' ? '' : f.val)} className="text-left cursor-pointer hover:text-[var(--primary)] transition-colors w-full group">
                      {'isPhone' in f && f.isPhone && f.val !== '—' ? <PhoneLink phone={f.val} showIcon={false}>{f.val}</PhoneLink> : f.link && f.val !== '—' ? <a href={f.link} className="text-[var(--primary)] hover:underline" onClick={e => e.stopPropagation()}>{f.val}</a> : <span>{f.val}</span>}
                      <span className="text-[10px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 ml-1">✏️</span>
                    </button>
                  )}
                </div>
              ))}
              {lead.message && <div className="col-span-2"><p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider mb-0.5">{t('lead.field.message')}</p><p className="text-[var(--text-secondary)] text-sm">{lead.message}</p></div>}
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
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{t('lead.custom_fields.title')}</h3>
                <button onClick={() => void navigate({ to: '/settings' })} className="text-[10px] text-[var(--primary)] hover:underline cursor-pointer">{t('lead.custom_fields.manage')}</button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {customFields.length > 0 ? (
                  customFields.map(cf => {
                    const isEditing = editingField === cf.field_id;
                    const def = customFieldDefs.find(d => d.id === cf.field_id);
                    return (
                      <div key={cf.field_id} className="relative group">
                        <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider mb-0.5">{cf.field_name}</p>
                        {isEditing ? (
                          cf.field_type === 'boolean' ? (
                            <Select
                              size="sm"
                              autoFocus
                              value={fieldValue}
                              onChange={e => setFieldValue(e.target.value)}
                              onBlur={() => void saveCustomField(cf.field_id, fieldValue)}
                            >
                              <option value="true">Oui</option>
                              <option value="false">Non</option>
                            </Select>
                          ) : cf.field_type === 'select' ? (
                            <Select
                              size="sm"
                              autoFocus
                              value={fieldValue}
                              onChange={e => setFieldValue(e.target.value)}
                              onBlur={() => void saveCustomField(cf.field_id, fieldValue)}
                            >
                              <option value="">—</option>
                              {def?.options?.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </Select>
                          ) : cf.field_type === 'multiselect' ? (
                            <MultiSelectEditor
                              options={def?.options || []}
                              value={cf.value}
                              onSave={(val) => void saveCustomField(cf.field_id, val)}
                              onCancel={() => setEditingField(null)}
                            />
                          ) : cf.field_type === 'date' ? (
                            <input
                              autoFocus
                              type="date"
                              value={fieldValue}
                              onChange={e => setFieldValue(e.target.value)}
                              onBlur={() => void saveCustomField(cf.field_id, fieldValue)}
                              className="w-full px-1.5 py-0.5 text-sm bg-[var(--bg-surface)] border border-[var(--primary)] rounded-[var(--radius-sm)] focus:outline-none"
                            />
                          ) : cf.field_type === 'textarea' ? (
                            <textarea
                              autoFocus
                              value={fieldValue}
                              onChange={e => setFieldValue(e.target.value)}
                              onBlur={() => void saveCustomField(cf.field_id, fieldValue)}
                              className="w-full px-1.5 py-0.5 text-sm bg-[var(--bg-surface)] border border-[var(--primary)] rounded-[var(--radius-sm)] focus:outline-none resize-y"
                            />
                          ) : cf.field_type === 'number' ? (
                            <input
                              autoFocus
                              type="number"
                              value={fieldValue}
                              onChange={e => setFieldValue(e.target.value)}
                              onBlur={() => void saveCustomField(cf.field_id, fieldValue)}
                              className="w-full px-1.5 py-0.5 text-sm bg-[var(--bg-surface)] border border-[var(--primary)] rounded-[var(--radius-sm)] focus:outline-none"
                            />
                          ) : (
                            <input
                              autoFocus
                              type="text"
                              value={fieldValue}
                              onChange={e => setFieldValue(e.target.value)}
                              onBlur={() => void saveCustomField(cf.field_id, fieldValue)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') void saveCustomField(cf.field_id, fieldValue);
                                if (e.key === 'Escape') setEditingField(null);
                              }}
                              className="w-full px-1.5 py-0.5 text-sm bg-[var(--bg-surface)] border border-[var(--primary)] rounded-[var(--radius-sm)] focus:outline-none"
                            />
                          )
                        ) : (
                          <button
                            onClick={() => startEdit(cf.field_id, cf.value || '')}
                            className="text-left cursor-pointer hover:text-[var(--primary)] transition-colors w-full group/btn"
                          >
                            <div className="text-sm text-[var(--text-secondary)]">{renderCustomFieldValue(cf)}</div>
                            <span className="text-[10px] text-[var(--text-muted)] opacity-0 group-hover/btn:opacity-100 ml-1">✏️</span>
                          </button>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="col-span-2 text-xs text-[var(--text-muted)] italic">{t('lead.custom_fields.empty')}</div>
                )}
              </div>
            </div>
          </div>

          {/* Onglets Sprint 23 — underline gradient + glow sur active */}
          <div className="flex gap-1 border-b border-[var(--border-subtle)] overflow-x-auto relative">
            {([['details', t('lead.tab.details')], ['notes', `${t('lead.tab.notes')} (${leadNotes.length})`], ['conversations', `${t('lead.tab.conversations')} (${messagesCount})`], ['scores', t('lead.tab.scores')], ['automations', 'Automatisations'], ['activity', t('lead.tab.activity')]] as const).map(([key, label]) => {
              const isActive = activeTab === key;
              return (
                <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
                  className={`relative px-4 py-2.5 text-[13px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    isActive ? 'text-[var(--primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}>
                  {label}
                  {isActive && (
                    <div className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t-full"
                      style={{
                        background: 'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
                        boxShadow: '0 -2px 12px rgba(99,91,255,0.5), 0 0 8px rgba(139,92,246,0.4)',
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
            <h3 className="text-sm font-semibold mb-3">{t('lead.conversations.title')}</h3>
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
              <h3 className="text-sm font-semibold">{t('lead.activity.title')}</h3>
              <span className="text-[10px] text-[var(--text-muted)]">{t('lead.activity.subtitle')}</span>
            </div>
            <LeadTimeline lead={lead} notes={leadNotes} appointments={leadAppointments} tasks={leadTasks} />
          </Card>
          )}

          {activeTab === 'notes' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-3">{t('lead.notes.title')} ({leadNotes.length})</h3>
            {/* Note héritée (lead.notes legacy) — proposée à la conversion en note structurée */}
            {lead.notes && lead.notes.trim() && (
              <div className="mb-4 p-3 rounded-[var(--radius-md)] border border-[var(--warning)] bg-[oklch(0.95_0.02_90)]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-[var(--text-muted)]">{t('lead.notes.legacy')}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await createLeadNote(leadId, { body: lead.notes!, category: 'general' });
                        await updateLead(leadId, { notes: '' });
                        const r = await getLeadNotes(leadId); if (r.data) setLeadNotes(r.data);
                        void loadLead();
                      }}
                      className="text-xs text-[var(--primary)] hover:underline cursor-pointer">
                      {t('lead.notes.convert')}
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await confirm({ title: 'Supprimer la note héritée ?', confirmLabel: 'Supprimer', danger: true });
                        if (!ok) return;
                        await updateLead(leadId, { notes: '' });
                        void loadLead();
                      }}
                      className="text-xs text-[var(--danger)] hover:underline cursor-pointer">
                      {t('lead.notes.delete')}
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
                  placeholder={t('lead.notes.placeholder')}
                  className="w-full px-3 py-2 pr-10 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] resize-none focus:border-[var(--primary)] focus:outline-none" />
                <AiSparkles value={newNoteBody} onChange={setNewNoteBody} leadId={leadId} className="absolute bottom-2 right-2" />
              </div>
              <div className="flex items-center gap-2">
                <Select size="sm" value={newNoteCategory} onChange={e => setNewNoteCategory(e.target.value)}>
                  {Object.entries(NOTE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{NOTE_CATEGORY_ICONS[k]} {v}</option>)}
                </Select>
                <Button size="sm" disabled={!newNoteBody.trim()} onClick={async () => {
                  await createLeadNote(leadId, { body: newNoteBody, category: newNoteCategory });
                  setNewNoteBody(''); setNewNoteCategory('general');
                  const r = await getLeadNotes(leadId); if (r.data) setLeadNotes(r.data);
                }}>{t('lead.notes.add')}</Button>
              </div>
            </div>
            {/* Liste des notes */}
            {leadNotes.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">{t('lead.notes.empty')}</p>
            ) : (
              <div className="space-y-3">
                {leadNotes.map(note => (
                  <div key={note.id} className={`p-3 rounded-[var(--radius-md)] border ${note.is_pinned ? 'border-[var(--warning)] bg-[oklch(0.95_0.02_90)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        {note.is_pinned ? <span>📌</span> : null}
                        <span>{NOTE_CATEGORY_ICONS[note.category] || '📝'} {NOTE_CATEGORY_LABELS[note.category] || note.category}</span>
                        <span>·</span>
                        <span>{note.author_name || t('lead.notes.system')}</span>
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

          {activeTab === 'scores' && (() => {
            const chartData = [...behavioralEvents]
              .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
              .map(event => ({
                date: new Date(event.created_at).toLocaleDateString('fr-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                score: event.score_after,
                delta: event.score_delta,
                type: event.event_type,
              }));

            return (
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-3">{t('lead.scores.title')}</h3>
                {leadScores.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">{t('lead.scores.empty')}</p>
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

                {/* Graphique de score comportemental v2 */}
                <div className="mt-6 pt-6 border-t border-[var(--border-subtle)] space-y-4">
                  <h4 className="text-sm font-semibold">{t('lead.behavioral.title')}</h4>
                  {chartData.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)] italic">{t('lead.behavioral.empty')}</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              domain={[0, 100]}
                              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                              axisLine={false}
                              tickLine={false}
                              allowDecimals={false}
                            />
                            <RechartsTooltip
                              contentStyle={{
                                background: 'var(--bg-surface)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-md)',
                                fontSize: 12,
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
                              }}
                              labelClassName="font-semibold text-[var(--text-primary)]"
                              formatter={(value: any, _name: any, props: any) => {
                                const payload = props.payload;
                                const deltaText = payload.delta > 0 ? `+${payload.delta}` : `${payload.delta}`;
                                return [
                                  `${value}/100 (${deltaText})`,
                                  `Événement: ${payload.type}`
                                ];
                              }}
                            />
                            <Area
                              type="monotone"
                              dataKey="score"
                              stroke="var(--primary)"
                              strokeWidth={2}
                              fillOpacity={1}
                              fill="url(#colorScore)"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Historique détaillé */}
                      <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                        {[...behavioralEvents]
                          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                          .map(event => {
                            const isPositive = event.score_delta > 0;
                            const dateStr = new Date(event.created_at).toLocaleString('fr-CA', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            });
                            return (
                              <div key={event.id} className="flex justify-between items-center text-xs p-2.5 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                                <div className="space-y-0.5">
                                  <span className="font-semibold text-[var(--text-primary)] capitalize">
                                    {event.event_type.replace(/_/g, ' ')}
                                  </span>
                                  <div className="text-[var(--text-muted)]">{dateStr}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`font-mono font-bold ${isPositive ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                                    {isPositive ? `+${event.score_delta}` : event.score_delta}
                                  </span>
                                  <span className="text-[var(--text-secondary)] font-medium">
                                    → {event.score_after}/100
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })()}

          {activeTab === 'automations' && (
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Automatisations & Workflows</h3>
              <div className="flex items-center gap-2">
                <Select
                  size="sm"
                  aria-label="Sélectionner un workflow"
                  onChange={async (e) => {
                    const workflowId = e.target.value;
                    if (!workflowId) return;
                    const res = await enrollLead(workflowId, leadId);
                    if (res.error) {
                      toastError(`Erreur d'inscription : ${res.error}`);
                    } else {
                      success('Lead enrôlé avec succès');
                      getLeadAutomationHistory(leadId).then(r => { if (r.data) setAutomationHistory(r.data); });
                    }
                    e.target.value = '';
                  }}
                >
                  <option value="">Enrôler dans un workflow...</option>
                  {availableWorkflows.filter(w => w.is_active).map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </Select>
              </div>
            </div>

            {automationHistory.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] italic">Aucune automatisation enregistrée pour ce lead.</p>
            ) : (
              <div className="space-y-3">
                {automationHistory.map(log => {
                  const date = new Date(log.executed_at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
                  const statusColors = {
                    executed: 'var(--success)',
                    skipped: 'var(--text-muted)',
                    failed: 'var(--danger)',
                  };
                  return (
                    <div key={log.id} className="p-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs flex justify-between items-start gap-4">
                      <div className="space-y-1">
                        <div className="font-semibold text-[var(--text-primary)]">
                          Workflow ID: <span className="font-mono">{log.workflow_id?.slice(0, 8) || '—'}</span>
                        </div>
                        <div className="text-[var(--text-secondary)]">
                          Étape: <span className="font-semibold">{log.step_type || '—'}</span> {log.detail ? `· ${log.detail}` : ''}
                        </div>
                        <div className="text-[var(--text-muted)]">{date}</div>
                      </div>
                      <Badge color={statusColors[log.status] || 'var(--text-muted)'}>
                        {log.status === 'executed' ? 'Exécuté' : log.status === 'skipped' ? 'Ignoré' : 'Échoué'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          )}

        </div>

        {/* Colonne latérale */}
        <div className="space-y-4">
          {/* Statut */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('lead.sidebar.status')}</h3>
            <div className="space-y-1.5">
              {LEAD_STATUSES.map((s) => (
                <button key={s} onClick={() => void handleStatusChange(s)}
                  className={`w-full text-left px-3 py-2 rounded-[var(--radius-md)] text-sm font-medium transition-all cursor-pointer ${lead.status === s
                    ? 'text-white shadow-[var(--shadow-glow)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'}`}
                  style={lead.status === s ? { backgroundColor: STATUS_COLORS[s].replace('var(', '').replace(')', '') ? undefined : undefined, background: 'var(--primary)' } : {}}>
                  <Badge color={STATUS_COLORS[s]}>{STATUS_LABELS[s]}</Badge>
                </button>
              ))}
            </div>
          </Card>

          {/* Routage Prédictif IA (Laplace Assignation) */}
          <Card className="p-4 relative overflow-hidden" style={{ border: routingResult ? '1px solid rgba(0, 157, 219, 0.3)' : undefined }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                {t('leads.routing.ai_btn')}
              </h3>
              <Badge color="var(--primary)">IA</Badge>
            </div>
            
            {lead.assigned_to && (
              <div className="mb-3 p-2 bg-[var(--bg-subtle)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Responsable assigné</p>
                <div className="flex items-center gap-2">
                  <Avatar name={routingResult?.agent_name || "Agent"} size="sm" />
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {routingResult?.agent_name || "Agent assigné"}
                  </span>
                </div>
              </div>
            )}

            <Button
              size="sm"
              variant="primary"
              className="w-full justify-center text-xs font-medium"
              disabled={isRouting}
              onClick={() => void handleRouteLead()}
            >
              {isRouting ? (
                <>
                  <span className="animate-spin mr-1.5">⏳</span>
                  {t('leads.routing.loading')}
                </>
              ) : (
                <>
                  <span className="mr-1.5">🤖</span>
                  {t('leads.routing.ai_btn')}
                </>
              )}
            </Button>

            {routingResult && (
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] space-y-2">
                <div className="flex justify-between items-center text-[10px] text-[var(--text-muted)] font-medium">
                  <span>{t('leads.routing.category', { category: routingResult.category })}</span>
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                    {t('leads.routing.score_details')} :
                  </p>
                  {routingResult.scores.map((s: any) => {
                    const isWinner = s.agent_id === routingResult.assigned_to;
                    return (
                      <div 
                        key={s.agent_id} 
                        className={`flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] text-xs transition-all ${
                          isWinner ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 font-medium' : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          {isWinner && <span className="text-emerald-500">🏆</span>}
                          <span className="truncate">{s.agent_name}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-semibold">{(s.score * 100).toFixed(1)}%</span>
                          <span className="text-[9px] text-[var(--text-muted)] ml-1">
                            ({s.won_count}W/{s.lost_count}L)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* Opportunité / Deal */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('lead.sidebar.opportunity')}</h3>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-[var(--text-muted)] mb-0.5">{t('lead.sidebar.deal_value')}</p>
                {isEditingDeal ? (
                  <div className="flex gap-2">
                    <input type="number" value={editDealValue} onChange={(e) => setEditDealValue(e.target.value)}
                      className="flex-1 px-2 py-1.5 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] focus:outline-none" />
                    <Button size="sm" onClick={() => void handleSaveDeal()}>OK</Button>
                  </div>
                ) : (
                  <button onClick={() => setIsEditingDeal(true)} className="text-xl font-bold text-[var(--primary)] cursor-pointer hover:underline">
                    {lead.deal_value ? `${lead.deal_value.toLocaleString('fr-CA')} $` : t('lead.sidebar.deal_add')}
                  </button>
                )}
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-muted)] mb-0.5">{t('lead.sidebar.probability')} ({stageFromBackend?.name || STATUS_LABELS[lead.status]})</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--primary)] transition-all" style={{ width: `${probability}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-[var(--primary)]">{probability}%</span>
                </div>
              </div>
              {forecast > 0 && (
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-0.5">{t('lead.sidebar.forecast')}</p>
                  <p className="text-sm font-semibold text-[var(--success)]">{forecast.toLocaleString('fr-CA')} $</p>
                </div>
              )}
            </div>
          </Card>

          {/* Tags */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('lead.sidebar.tags')}</h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {lead.tags && lead.tags.length > 0 ? lead.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
                  {tag}
                  <button onClick={() => void handleRemoveTag(tag)} className="text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer">×</button>
                </span>
              )) : <p className="text-xs text-[var(--text-muted)]">{t('lead.sidebar.no_tags')}</p>}
            </div>
            <div className="flex gap-1.5">
              <input type="text" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder={t('lead.sidebar.tag_placeholder')}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddTag(); }}
                className="flex-1 px-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] focus:outline-none" />
              <Button size="sm" variant="secondary" onClick={() => void handleAddTag()}>+</Button>
            </div>
          </Card>

          {/* DND — Do Not Disturb */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('lead.sidebar.dnd')}</h3>
            <div className="space-y-2">
              {(['email', 'sms', 'call'] as const).map(channel => {
                const dndSettings = (() => {
                  try { return JSON.parse((lead as unknown as Record<string, unknown>).dnd_settings as string || '{}'); }
                  catch { return {}; }
                })() as Record<string, boolean>;
                const isActive = dndSettings[channel] ?? false;
                const icons = { email: '📧', sms: '📱', call: '📞' };
                const labels = { email: 'Email', sms: t('lead.sidebar.dnd_sms'), call: t('lead.sidebar.dnd_calls') };
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
                      <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-[var(--bg-surface)] transition-all shadow-sm ${isActive ? 'left-[14px]' : 'left-[2px]'}`} />
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Champs étendus */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('lead.sidebar.extra')}</h3>
            <div className="space-y-2 text-xs">
              {[
                { key: 'date_of_birth', label: t('lead.sidebar.dob'), val: (lead as unknown as Record<string, unknown>).date_of_birth as string || '—', type: 'date' },
                { key: 'country', label: t('lead.sidebar.country'), val: (lead as unknown as Record<string, unknown>).country as string || 'CA', type: 'text' },
                { key: 'timezone', label: t('lead.sidebar.timezone'), val: (lead as unknown as Record<string, unknown>).timezone as string || 'America/Toronto', type: 'text' },
              ].map(f => (
                <div key={f.key} className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">{f.label}</span>
                  {editingField === f.key ? (
                    <input
                      autoFocus type={f.type} value={fieldValue}
                      onChange={e => setFieldValue(e.target.value)}
                      onBlur={() => void saveField(f.key)}
                      onKeyDown={e => { if (e.key === 'Enter') void saveField(f.key); if (e.key === 'Escape') setEditingField(null); }}
                      className="w-32 px-1.5 py-0.5 text-xs bg-[var(--bg-surface)] border border-[var(--primary)] rounded-[var(--radius-sm)] focus:outline-none text-right"
                    />
                  ) : (
                    <button onClick={() => startEdit(f.key, f.val === '—' ? '' : f.val)} className="text-right cursor-pointer hover:text-[var(--primary)] transition-colors">
                      {f.val}
                    </button>
                  )}
                </div>
              ))}
              {/* Sprint MULTILANG-B — sélecteur langue préférée (additif, à côté de country/timezone) */}
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">{t('leads.language.label')}</span>
                <Select
                  size="sm"
                  value={lead.preferred_language || ''}
                  onChange={async (e) => {
                    if (!lead) return;
                    const value = e.target.value;
                    const prev = lead;
                    setLead({ ...lead, preferred_language: value || null });
                    const res = await updateLead(leadId, { preferred_language: value } as Record<string, unknown>);
                    if (res.error) { setLead(prev); toastError(`Erreur de mise à jour de la langue : ${res.error}`); }
                    else { void loadLead(); }
                  }}
                  className="w-40"
                >
                  <option value="">{t('leads.language.default')}</option>
                  <option value="fr-CA">Français (QC)</option>
                  <option value="fr-FR">Français (FR)</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                </Select>
              </div>
              <p className="col-span-full text-[10px] text-[var(--text-muted)] leading-snug">{t('leads.language.help')}</p>
            </div>
          </Card>

          {/* RDV liés */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('lead.sidebar.appointments')}</h3>
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
              <p className="text-xs text-[var(--text-muted)]">{t('lead.sidebar.no_appointments')}</p>
            )}
          </Card>

          {/* Sprint F Téléphonie — Journal d'appels + click-to-call (additif) */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('telephony.calllog.title')}</h3>
              <Button size="sm" variant="secondary" disabled={isCalling} onClick={() => void handlePlaceCall()}>
                <Phone size={13} className="mr-1" /> {t('telephony.clicktocall.action')}
              </Button>
            </div>
            {callLogs.length > 0 ? (
              <div className="space-y-2">
                {callLogs.map((call) => {
                  const isInbound = call.direction === 'inbound';
                  const number = isInbound ? call.from_number : call.to_number;
                  // Statut color-coded (réutilise tokens), fallback neutre
                  const statusColor =
                    call.status === 'completed' ? 'var(--success)' :
                    call.status === 'failed' || call.status === 'no-answer' || call.status === 'noanswer' ? 'var(--danger)' :
                    call.status === 'ringing' || call.status === 'queued' ? 'var(--warning)' : 'var(--text-muted)';
                  // i18n status (clés Phase A) — normalise no-answer → noanswer
                  const statusKey = `telephony.status.${(call.status || '').replace('-', '')}`;
                  const statusTr = t(statusKey);
                  // t() renvoie la clé brute si absente → fallback sur le statut réel
                  const statusLabel = statusTr === statusKey ? (call.status || '—') : statusTr;
                  const mins = Math.floor((call.duration_sec || 0) / 60);
                  const secs = (call.duration_sec || 0) % 60;
                  const durationFmt = call.duration_sec ? `${mins}:${String(secs).padStart(2, '0')}` : null;
                  return (
                    <div key={call.id} className="p-2 bg-[var(--bg-subtle)] rounded-[var(--radius-sm)]">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {isInbound
                          ? <PhoneIncoming size={12} className="text-[var(--success)] shrink-0" aria-label={t('telephony.direction.inbound')} />
                          : <PhoneOutgoing size={12} className="text-[var(--primary)] shrink-0" aria-label={t('telephony.direction.outbound')} />}
                        <span className="text-xs font-medium truncate">{number || (isInbound ? t('telephony.direction.inbound') : t('telephony.direction.outbound'))}</span>
                        {durationFmt && <span className="text-[10px] text-[var(--text-muted)] ml-auto tabular-nums">{durationFmt}</span>}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {call.created_at ? new Date(call.created_at + (call.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                        </span>
                        <Badge color={statusColor}>{statusLabel}</Badge>
                      </div>
                      {call.recording_url && (
                        <audio controls preload="none" src={call.recording_url} className="w-full mt-1.5 h-7" />
                      )}
                      {call.transcription && (
                        <details className="mt-1 group">
                          <summary className="text-[10px] text-[var(--primary)] cursor-pointer hover:underline list-none">
                            {t('telephony.transcription')}
                          </summary>
                          <p className="text-[11px] text-[var(--text-secondary)] mt-1 whitespace-pre-wrap leading-snug">{call.transcription}</p>
                        </details>
                      )}
                      {/* Sprint 16 — disposition + notes post-appel (additif, best-effort) */}
                      <CallDispositionEditor
                        call={call}
                        onSaved={(id, disposition, notes) => setCallLogs((prev) => prev.map((c) => c.id === id ? { ...c, disposition: disposition || null, notes: notes || null } : c))}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">{t('telephony.calllog.empty')}</p>
            )}
          </Card>

          {/* Score visuel */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('lead.sidebar.lead_score')}</h3>
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
              {lead.score >= 70 ? t('lead.score.hot') : lead.score >= 40 ? t('lead.score.warm') : t('lead.score.cold')}
            </p>
          </Card>

          {/* Sprint 13 — Prévision de conversion CALIBRÉE tenant. Réutilise
              LeadPredictionCard (gauge + facteurs + actions) et lui passe le
              score calibré (badge « calibré » + facteur « taux historique »).
              Best-effort : si getLeadConversionScore est KO, conversion=null →
              la carte retombe sur sa prévision Sprint 49 sans rien casser. */}
          <LeadPredictionCard
            leadId={leadId}
            localInput={{
              score: lead.score,
              status: lead.status,
              source: lead.source,
              deal_value: lead.deal_value,
              updated_at: lead.updated_at,
              created_at: lead.created_at,
              last_activity_at: lead.last_activity_at,
              tags: lead.tags,
              activity: lead.activity,
              messagesCount,
              stageProbability: probability,
            }}
            conversion={conversion}
          />

          {/* Sprint 20 : suggestion AI prochaine étape — affichée seulement si lead inactif >7j */}
          {(() => {
            const daysSinceUpdate = Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / 86400000);
            const isActive = !['closed', 'lost'].includes(lead.status);
            return daysSinceUpdate >= 7 && isActive ? <AiNextActionCard leadId={leadId} /> : null;
          })()}

          {/* Tâches liées */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('lead.sidebar.tasks')}</h3>
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
              <p className="text-xs text-[var(--text-muted)]">{t('lead.sidebar.no_tasks')}</p>
            )}
          </Card>

          {/* Infos */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('lead.sidebar.info')}</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">{t('lead.sidebar.created')}</span><span>{new Date(lead.created_at).toLocaleDateString('fr-CA')}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">{t('lead.sidebar.updated')}</span><span>{new Date(lead.updated_at).toLocaleDateString('fr-CA')}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">{t('lead_detail.source_label')}</span><span>{SOURCE_LABELS[lead.source] || lead.source}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">ID</span><span className="font-mono truncate ml-2">{lead.id.slice(0, 8)}</span></div>
            </div>
          </Card>

          {/* Confidentialité (Loi 25 / GDPR) — composant dédié, gating admin */}
          <LeadPrivacyActions
            leadId={leadId}
            leadName={lead.name}
            leadEmail={lead.email}
            isAdmin={isAdmin}
            onForgotten={() => void navigate({ to: '/leads' })}
          />
        </div>
      </div>
    </>
  );
}

/** Wrapper page-complète (URL route /leads/:leadId) */
export function LeadDetailPage() {
  const { leadId } = useParams({ strict: false }) as { leadId: string };
  return (
    <AppLayout title={t('lead.page.title')}>
      <LeadDetailBody leadId={leadId} />
    </AppLayout>
  );
}
