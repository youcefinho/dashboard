// ── Page Lead Detail — Fiche individuelle d'un lead (Sprint Design) ──

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Skeleton, EmptyState } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { getLeadDetail, updateLead, addTag, removeTag, getAppointments, getTasks, updateTask, getLeadNotes, createLeadNote, deleteLeadNote, getLeadScores, getLeadCustomFields, apiFetch } from '@/lib/api';
import { ConversationPanel } from '@/components/conversations/ConversationPanel';
import {
  STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, SOURCE_LABELS,
  ACTIVITY_LABELS, ACTIVITY_ICONS, LEAD_STATUSES,
  LIFECYCLE_LABELS, LIFECYCLE_COLORS, NOTE_CATEGORY_LABELS, NOTE_CATEGORY_ICONS,
  APPOINTMENT_TYPE_ICONS, APPOINTMENT_TYPE_LABELS, APPOINTMENT_STATUS_LABELS,
  TASK_PRIORITY_ICONS, TASK_STATUS_ICONS, TASK_STATUS_LABELS,
  type LeadDetail, type LeadStatus, type ActivityType, type Appointment, type Task,
  type LeadNote, type LeadScore, type CustomFieldValue, type LifecycleStage,
} from '@/lib/types';
import { ArrowLeft, Star, Phone, Mail, CalendarPlus, CheckSquare } from 'lucide-react';

export function LeadDetailPage() {
  const { leadId } = useParams({ strict: false }) as { leadId: string };
  const navigate = useNavigate();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editNotes, setEditNotes] = useState('');
  const [isEditingNotes, setIsEditingNotes] = useState(false);
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
  const [newNoteBody, setNewNoteBody] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState('general');

  const loadLead = useCallback(async () => {
    setIsLoading(true);
    const result = await getLeadDetail(leadId);
    if (result.data) {
      setLead(result.data);
      setEditNotes(result.data.notes || '');
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
  }, [loadLead, leadId]);

  const handleStatusChange = async (status: LeadStatus) => {
    await updateLead(leadId, { status });
    void loadLead();
  };

  const handleSaveNotes = async () => {
    await updateLead(leadId, { notes: editNotes });
    setIsEditingNotes(false);
    void loadLead();
  };

  const handleSaveDeal = async () => {
    await updateLead(leadId, { deal_value: Number(editDealValue) || 0 });
    setIsEditingDeal(false);
    void loadLead();
  };

  const handleAddTag = async () => {
    if (!newTag.trim()) return;
    await addTag(leadId, newTag.trim());
    setNewTag('');
    void loadLead();
  };

  const handleRemoveTag = async (tag: string) => {
    await removeTag(leadId, tag);
    void loadLead();
  };

  const handleForgetLead = async () => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer les données personnelles de ce lead (Droit à l\'oubli / Loi 25) ? Cette action est irréversible.')) return;
    try {
      await apiFetch(`/leads/${leadId}/forget`, { method: 'POST' });
      navigate({ to: '/leads' });
    } catch (e) {
      alert('Erreur lors de la suppression');
    }
  };

  const handleExportPii = () => {
    window.open(`/api/leads/${leadId}/export-pii`, '_blank');
  };

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);
    if (diffMin < 1) return 'à l\'instant';
    if (diffMin < 60) return `il y a ${diffMin} min`;
    if (diffH < 24) return `il y a ${diffH}h`;
    if (diffD === 1) return 'hier';
    return `il y a ${diffD}j`;
  };

  if (isLoading) {
    return (
      <AppLayout title="Fiche lead">
        <div className="max-w-4xl space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      </AppLayout>
    );
  }

  if (!lead) {
    return (
      <AppLayout title="Lead introuvable">
        <EmptyState title="Lead introuvable" description="Ce lead n'existe pas ou a été supprimé."
          action={<Button onClick={() => void navigate({ to: '/leads' })}>Retour aux leads</Button>} />
      </AppLayout>
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

  // Probabilité par stage
  const stageProbability: Record<string, number> = { new: 10, contacted: 25, meeting: 50, signed: 90, closed: 100, lost: 0 };
  const forecast = (lead.deal_value || 0) * (stageProbability[lead.status] || 0) / 100;

  return (
    <AppLayout title={lead.name}>
      {/* Bouton retour */}
      <button onClick={() => void navigate({ to: '/leads' })}
        className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-primary)] mb-4 flex items-center gap-1.5 cursor-pointer transition-colors">
        <ArrowLeft size={16} /> Retour aux leads
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-6xl">
        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-4">
          {/* En-tête enrichi */}
          <Card className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <Avatar name={lead.name} size="lg" />
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-primary)]">{lead.name}</h2>
                  <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <button onClick={() => void navigate({ to: `/clients/${lead.client_id}` })} className="hover:text-[var(--brand-primary)] cursor-pointer transition-colors">{lead.client_name}</button>
                    <span>·</span>
                    <span>{SOURCE_LABELS[lead.source] || lead.source}</span>
                    <span>·</span>
                    <span>{new Date(lead.created_at).toLocaleDateString('fr-CA')}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={async () => { await updateLead(leadId, { favorite: lead.favorite ? 0 : 1 } as Record<string, unknown>); void loadLead(); }}
                  className="p-1 cursor-pointer hover:scale-110 transition-transform" title={lead.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
                  <Star size={18} className={lead.favorite ? 'fill-[var(--warning)] text-[var(--warning)]' : 'text-[var(--text-muted)]'} />
                </button>
                <Badge color={lead.type === 'buy' ? 'var(--brand-primary)' : 'var(--accent-orange)'}>
                  {TYPE_LABELS[lead.type]}
                </Badge>
                <Badge color={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                {lead.lifecycle_stage && (
                  <Badge color={LIFECYCLE_COLORS[lead.lifecycle_stage as LifecycleStage] || 'var(--text-muted)'}>
                    {LIFECYCLE_LABELS[lead.lifecycle_stage as LifecycleStage] || lead.lifecycle_stage}
                  </Badge>
                )}
                {lead.dnd ? <span title="Ne pas déranger" className="text-sm">🔕</span> : null}
              </div>
            </div>

            {/* Actions rapides */}
            <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-[var(--border-subtle)]">
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--brand-primary)] hover:text-white transition-colors cursor-pointer">
                  <Phone size={13} /> Appeler
                </a>
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
            </div>

            {/* Champs avec édition inline */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[{ key: 'email', label: 'Email', val: lead.email, link: `mailto:${lead.email}` },
                { key: 'phone', label: 'Téléphone', val: lead.phone || '—', link: lead.phone ? `tel:${lead.phone}` : undefined },
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
                      {f.link && f.val !== '—' ? <a href={f.link} className="text-[var(--brand-primary)] hover:underline" onClick={e => e.stopPropagation()}>{f.val}</a> : <span>{f.val}</span>}
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

            {/* Champs Personnalisés (P3.4) */}
            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Champs Personnalisés</h3>
                <button className="text-[10px] text-[var(--brand-primary)] hover:underline cursor-pointer">Gérer les champs</button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {(lead as any).custom_fields && (lead as any).custom_fields.length > 0 ? (
                  ((lead as any).custom_fields as {id: string, name: string, value: string}[]).map(cf => (
                    <div key={cf.id}>
                      <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider mb-0.5">{cf.name}</p>
                      <p>{cf.value}</p>
                    </div>
                  ))
                ) : (
                  <div className="col-span-2 text-xs text-[var(--text-muted)] italic">Aucun champ personnalisé défini pour ce lead.</div>
                )}
              </div>
            </div>
          </Card>

          {/* Onglets (Activité, Emails, Tâches, etc.) */}
          <div className="flex gap-1 border-b border-[var(--border-subtle)] overflow-x-auto">
            {([['details', 'Détails'], ['notes', `Notes (${leadNotes.length})`], ['conversations', 'Conversations'], ['scores', 'Scores'], ['activity', 'Activité']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
                className={`px-4 py-2.5 text-[13px] font-medium transition-colors cursor-pointer border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === key ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}>{label}</button>
            ))}
          </div>

          {/* Contenu par onglet */}
          {activeTab === 'details' && (
          <>
          {/* Notes */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">📝 Notes</h3>
              {!isEditingNotes && <button onClick={() => setIsEditingNotes(true)} className="text-xs text-[var(--brand-primary)] hover:underline cursor-pointer">Modifier</button>}
            </div>
            {isEditingNotes ? (
              <div className="space-y-2">
                <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={4}
                  className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] resize-none focus:border-[var(--brand-primary)] focus:outline-none" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void handleSaveNotes()}>Sauvegarder</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setIsEditingNotes(false); setEditNotes(lead.notes || ''); }}>Annuler</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{lead.notes || 'Aucune note pour le moment.'}</p>
            )}
          </Card>

          </>
          )}

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
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">📋 Timeline d'activité</h3>
              <span className="text-[10px] text-[var(--text-muted)]">{lead.activity?.length || 0} événements</span>
            </div>
            {lead.activity && lead.activity.length > 0 ? (
              <div className="relative pl-6">
                {/* Ligne verticale */}
                <div className="absolute left-[9px] top-2 bottom-2 w-px bg-[var(--border-subtle)]" />
                <div className="space-y-4">
                  {lead.activity.map((act, i) => {
                    const actionType = act.action as ActivityType;
                    const dotColor = actionType === 'email_sent' || actionType === 'sms_sent' ? 'var(--info)'
                      : actionType === 'status_change' ? 'var(--warning)'
                      : actionType === 'created' ? 'var(--success)'
                      : actionType === 'deal_value_changed' ? 'var(--brand-primary)'
                      : 'var(--text-muted)';
                    return (
                      <div key={i} className="relative flex items-start gap-3 text-sm">
                        {/* Pastille */}
                        <div className="absolute -left-6 top-1 w-[10px] h-[10px] rounded-full border-2 border-[var(--bg-surface)]" style={{ background: dotColor }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{ACTIVITY_ICONS[actionType] || '•'}</span>
                            <span className="font-medium text-sm">{ACTIVITY_LABELS[actionType] || act.action}</span>
                            <span className="text-[10px] text-[var(--text-muted)] ml-auto shrink-0">{timeAgo(act.created_at)}</span>
                          </div>
                          {act.details && <p className="text-xs text-[var(--text-muted)] mt-0.5 pl-6">{act.details}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">Aucune activité enregistrée.</p>
            )}
          </Card>
          )}

          {activeTab === 'notes' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-3">📝 Notes ({leadNotes.length})</h3>
            {/* Formulaire ajout note */}
            <div className="mb-4 space-y-2 p-3 rounded-[var(--radius-md)] bg-[var(--bg-subtle)]">
              <textarea value={newNoteBody} onChange={e => setNewNoteBody(e.target.value)} rows={3}
                placeholder="Ajouter une note..."
                className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] resize-none focus:border-[var(--brand-primary)] focus:outline-none" />
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
                      <button onClick={async () => { await deleteLeadNote(leadId, note.id); const r = await getLeadNotes(leadId); if (r.data) setLeadNotes(r.data); }}
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
            {/* Custom Fields */}
            {customFields.length > 0 && (
              <>
                <h3 className="text-sm font-semibold mt-6 mb-3">🏷️ Champs personnalisés</h3>
                <div className="grid grid-cols-2 gap-3">
                  {customFields.map(cf => (
                    <div key={cf.field_id} className="p-2 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)]">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{cf.field_name}</p>
                      <p className="text-sm font-medium">{cf.value || '—'}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
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
                <p className="text-[10px] text-[var(--text-muted)] mb-0.5">Probabilité ({STATUS_LABELS[lead.status]})</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--brand-primary)] transition-all" style={{ width: `${stageProbability[lead.status] || 0}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-[var(--brand-primary)]">{stageProbability[lead.status] || 0}%</span>
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

          {/* Tâches liées */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">📋 Tâches</h3>
            {leadTasks.length > 0 ? (
              <div className="space-y-1.5">
                {leadTasks.map(task => (
                  <button key={task.id}
                    onClick={() => { const next = task.status === 'done' ? 'todo' as const : 'done' as const; setLeadTasks(prev => prev.map(t => t.id === task.id ? {...t, status: next} : t)); void updateTask(task.id, { status: next }); }}
                    className={`w-full text-left p-2 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] cursor-pointer hover:bg-[var(--bg-subtle)] transition-colors ${task.status === 'done' ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">{TASK_STATUS_ICONS[task.status]}</span>
                      <span className={`text-xs font-medium truncate ${task.status === 'done' ? 'line-through' : ''}`}>{task.title}</span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)]">{TASK_PRIORITY_ICONS[task.priority]} {TASK_STATUS_LABELS[task.status]}</span>
                  </button>
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
    </AppLayout>
  );
}
