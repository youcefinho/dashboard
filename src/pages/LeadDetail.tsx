// ── Page Lead Detail — Fiche individuelle d'un lead (Sprint Design) ──

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Card, Button, Skeleton, EmptyState, useToast, useConfirm, AiSparkles,
  usePanelStack, ScoreGauge, Input, Select, Textarea, Tag, KpiStrip, SmartBanner,
  Tabs, TabsList, TabsTrigger, TabsContent,
  type KpiItem as KpiItemType,
  Icon,
  // Sprint 35 vague 35-2D — Native share API + clipboard fallback
  ShareButton,
} from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { getLeadDetail, updateLead, addTag, removeTag, getAppointments, getTasks, updateTask, getLeadNotes, createLeadNote, deleteLeadNote, getLeadScores, getLeadCustomFields, softDeleteLead, restoreLead, apiFetch, getPipelines, getLeadMessages, getLinkedCustomerForLead } from '@/lib/api';
import { getCachedLead, setCachedLead } from '@/lib/prefetch';
import { confettiBurst } from '@/lib/confetti';
import { AiNextActionCard } from '@/components/panels/AiNextActionCard';
// Sprint 49 M2.1 — Prévision conversion 30 jours
import { LeadPredictionCard } from '@/components/panels/LeadPredictionCard';
// Sprint 49 M3.2 — Auto-tagging leads (suggestion only — Loi 25 friendly)
import { classifyLead } from '@/lib/autoTagLead';
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
import { ArrowLeft, Star, Mail, CalendarPlus, CheckSquare, Trash2, Compass, DollarSign, Activity as ActivityIcon, Clock, MessageSquare, ListTodo, Sparkles, Download, ShoppingBag, ExternalLink } from 'lucide-react';
import { PhoneLink } from '@/components/ui/PhoneLink';
// Sprint 32 vague 32-2B — Score explainable
import { explainScore, type ScoreSignal } from '@/lib/leadScoreExplain';
// Sprint 34 vague 34-1A — PDF export helper consolidé
import { triggerPdfExport } from '@/lib/pdfExport';
// Sprint 48 M3 — Intl currency + date
import { formatMoneyCAD } from '@/lib/i18n/number';
import { formatDate, formatTime } from '@/lib/i18n/datetime';
import { getLocale, t } from '@/lib/i18n';

// ── Helper : "il y a 5min" / "hier" / "12 mai" — utilisé dans les listes notes/activité
function formatRelativeShort(dateStr: string): string {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `${days}j`;
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

// ── Section title sidebar — Stripe-clean : uppercase gray-500 + thin border underline ──
function SidebarSectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 pb-1.5 border-b border-[var(--border-subtle)]">
      <h3 className="t-meta uppercase text-[var(--text-muted)] tracking-wider">
        {children}
      </h3>
    </div>
  );
}

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
  // Sprint 49 M3.2 — Tags suggérés par IA (suggestion only : accepter/rejeter
  // individuellement ; jamais d'auto-apply — transparence IA Loi 25).
  const [suggestedLeadTags, setSuggestedLeadTags] = useState<string[]>([]);
  const [isClassifyingLead, setIsClassifyingLead] = useState(false);
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
  // Sprint E1 M3.4 — Customer boutique réconcilié (encart conditionnel).
  // L'endpoint renvoie null si aucun lien OU si le module e-commerce est off
  // → l'encart n'apparaît que si lien existe ET module actif.
  const [linkedCustomer, setLinkedCustomer] = useState<{ id: string; email: string; first_name: string; last_name: string } | null>(null);

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
    // Sprint E1 M3.4 — lien faible vers compte boutique (null si module off / non lié)
    getLinkedCustomerForLead(leadId).then(r => { setLinkedCustomer(r.data ?? null); }).catch(() => {});
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

  // ── Sprint 49 M3.2 — Classification IA (tags suggérés, suggestion only) ──
  const handleClassifyLead = useCallback(async () => {
    if (!lead || isClassifyingLead) return;
    setIsClassifyingLead(true);
    const res = await classifyLead(leadId, lead);
    setIsClassifyingLead(false);
    // Exclut ce qui est déjà présent (sécurité supplémentaire à classifyLead)
    const existing = new Set((lead.tags || []).map(t => t.toLowerCase()));
    setSuggestedLeadTags(res.suggestedTags.filter(t => !existing.has(t.toLowerCase())));
  }, [lead, leadId, isClassifyingLead]);

  // Accepter un tag suggéré (action user explicite = confirmation)
  const acceptSuggestedTag = useCallback(async (tag: string) => {
    if (!lead) return;
    setSuggestedLeadTags(prev => prev.filter(t => t !== tag));
    if (lead.tags?.includes(tag)) return;
    const prev = lead;
    setLead({ ...lead, tags: [...(lead.tags || []), tag] });
    const res = await addTag(leadId, tag);
    if (res.error) {
      setLead(prev);
      toastError(`Erreur d'application du tag : ${res.error}`);
    } else {
      success(`Tag « ${tag} » ajouté`);
    }
  }, [lead, leadId, success, toastError]);

  const rejectSuggestedTag = useCallback((tag: string) => {
    setSuggestedLeadTags(prev => prev.filter(t => t !== tag));
  }, []);

  // Auto-suggestion à la 1ère ouverture de la fiche lead (création + edits
  // majeurs : on relance dès que le lead est chargé et qu'aucune suggestion
  // n'est en cours / déjà affichée). Suggestion only — aucun auto-apply.
  useEffect(() => {
    if (lead && suggestedLeadTags.length === 0 && !isClassifyingLead) {
      void handleClassifyLead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

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
    /* Skeleton matche layout réel : Hero 200px + sidebar 280px (avatar+gauge+rows) + main 3 cards */
    return (
      <div className={compact ? 'space-y-4' : 'max-w-4xl space-y-4'}>
        {/* Hero skeleton — Stripe-clean : white card sober */}
        <div
          className="relative overflow-hidden p-6 rounded-[var(--radius-lg)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-xs"
          style={{ height: 200 }}
        >
          <div className="relative flex items-start gap-4">
            <Skeleton className="h-20 w-20 rounded-full shrink-0" />
            <div className="flex-1 space-y-2.5 mt-1">
              <Skeleton className="h-5 w-56" style={{ animationDelay: '40ms' }} />
              <Skeleton className="h-3 w-72" style={{ animationDelay: '80ms' }} />
              <div className="flex items-center gap-2 pt-1">
                <Skeleton className="h-5 w-16 rounded-md" style={{ animationDelay: '120ms' }} />
                <Skeleton className="h-5 w-20 rounded-md" style={{ animationDelay: '160ms' }} />
                <Skeleton className="h-5 w-14 rounded-md" style={{ animationDelay: '200ms' }} />
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Skeleton className="h-8 w-8 rounded-lg" style={{ animationDelay: '240ms' }} />
              <Skeleton className="h-8 w-24 rounded-lg" style={{ animationDelay: '280ms' }} />
            </div>
          </div>
        </div>

        <div className={compact ? 'space-y-4' : 'grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4'}>
          {/* Sidebar — avatar 96px + score gauge circle 62px + 4 info rows */}
          <div className="space-y-4">
            <div
              className="p-5 rounded-2xl"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex flex-col items-center gap-3 mb-4">
                <Skeleton className="h-24 w-24 rounded-full" />
                <Skeleton className="h-3.5 w-32" style={{ animationDelay: '40ms' }} />
                <Skeleton className="h-2.5 w-40" style={{ animationDelay: '80ms' }} />
              </div>
              <div className="flex justify-center mb-4">
                <Skeleton className="h-[62px] w-[62px] rounded-full" style={{ animationDelay: '120ms' }} />
              </div>
              <div className="space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between" style={{ animationDelay: `${(i + 4) * 40}ms` }}>
                    <Skeleton className="h-2.5 w-16" style={{ animationDelay: `${(i + 4) * 40}ms` }} />
                    <Skeleton className="h-3 w-24" style={{ animationDelay: `${(i + 4) * 40 + 20}ms` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main — 3 cards (timeline 400 + activity 200 + notes 150) */}
          <div className="space-y-4">
            <div
              className="p-5 rounded-2xl"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', height: 400 }}
            >
              <Skeleton className="h-4 w-28 mb-4" />
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex gap-3" style={{ animationDelay: `${i * 50}ms` }}>
                    <Skeleton className="h-7 w-7 rounded-full shrink-0" style={{ animationDelay: `${i * 50}ms` }} />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-3/4" style={{ animationDelay: `${i * 50 + 20}ms` }} />
                      <Skeleton className="h-2.5 w-1/2" style={{ animationDelay: `${i * 50 + 40}ms` }} />
                    </div>
                    <Skeleton className="h-2.5 w-12 shrink-0" style={{ animationDelay: `${i * 50 + 60}ms` }} />
                  </div>
                ))}
              </div>
            </div>
            <div
              className="p-5 rounded-2xl"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', height: 200 }}
            >
              <Skeleton className="h-4 w-24 mb-4" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-lg" style={{ animationDelay: `${i * 40}ms` }} />
                ))}
              </div>
            </div>
            <div
              className="p-5 rounded-2xl"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', height: 150 }}
            >
              <Skeleton className="h-4 w-20 mb-3" />
              <Skeleton className="h-16 w-full rounded-lg" style={{ animationDelay: '40ms' }} />
            </div>
          </div>
        </div>
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

  // ── KPI mini-strip Sprint 23 wave 24 — densification contextuelle GHL ──
  const daysSinceUpdate = Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / 86_400_000);
  const tasksOpenCount = leadTasks.filter(t => t.status !== 'done').length;
  const activityCount = (lead.activity || []).length + leadNotes.length + leadAppointments.length + leadTasks.length;

  const kpiItems: KpiItemType[] = [
    {
      label: 'Valeur deal',
      value: lead.deal_value ? `${(lead.deal_value / 1000).toFixed(lead.deal_value >= 100_000 ? 0 : 1)}k$` : '—',
      color: 'brand',
      icon: <DollarSign size={11} strokeWidth={2.5} />,
      onClick: () => setIsEditingDeal(true),
    },
    {
      label: 'Score',
      value: lead.score ?? 0,
      color: lead.score >= 70 ? 'success' : lead.score >= 40 ? 'warning' : 'danger',
      icon: <Star size={11} strokeWidth={2.5} />,
    },
    {
      label: 'Activité',
      value: activityCount,
      color: 'info',
      icon: <ActivityIcon size={11} strokeWidth={2.5} />,
      onClick: () => setActiveTab('activity'),
    },
    {
      label: 'Inactivité',
      value: `${daysSinceUpdate}j`,
      color: daysSinceUpdate > 7 ? 'warning' : 'neutral',
      icon: <Clock size={11} strokeWidth={2.5} />,
    },
    {
      label: 'Tâches ouvertes',
      value: tasksOpenCount,
      color: tasksOpenCount > 0 ? 'accent' : 'neutral',
      icon: <ListTodo size={11} strokeWidth={2.5} />,
    },
    {
      label: 'Messages',
      value: messagesCount,
      color: 'brand',
      icon: <MessageSquare size={11} strokeWidth={2.5} />,
      onClick: () => setActiveTab('conversations'),
    },
  ];

  // ── AI Summary contextuel (heuristique simple côté client) ──
  const aiSummary = (() => {
    if (lead.score >= 70 && daysSinceUpdate <= 2) {
      return {
        title: 'Lead chaud, momentum optimal',
        description: `${lead.name} a un score de ${lead.score} et a été touché il y a ${daysSinceUpdate}j. Action prioritaire : verrouiller le RDV cette semaine.`,
        action: { label: 'Planifier RDV', onClick: () => void navigate({ to: '/calendar' }) },
      };
    }
    if (daysSinceUpdate >= 7 && !['closed', 'lost', 'won'].includes(lead.status)) {
      return {
        title: 'Lead à relancer rapidement',
        description: `Aucune activité depuis ${daysSinceUpdate} jours. Probabilité ${probability}% — relance ciblée recommandée pour éviter le refroidissement.`,
        action: { label: 'Relancer maintenant', onClick: () => setActiveTab('conversations') },
      };
    }
    if (tasksOpenCount > 0) {
      return {
        title: `${tasksOpenCount} tâche${tasksOpenCount > 1 ? 's' : ''} ouverte${tasksOpenCount > 1 ? 's' : ''} sur ce lead`,
        description: `Focus sur les actions ouvertes pour faire avancer ${lead.name} dans le pipeline.`,
        action: { label: 'Voir tâches', onClick: () => void navigate({ to: '/tasks' }) },
      };
    }
    return {
      title: `Vue d'ensemble de ${lead.name}`,
      description: `${SOURCE_LABELS[lead.source] || lead.source} · ${STATUS_LABELS[lead.status]} · ${activityCount} événement${activityCount > 1 ? 's' : ''} enregistré${activityCount > 1 ? 's' : ''}.`,
      action: { label: 'Voir timeline', onClick: () => setActiveTab('activity') },
    };
  })();

  // ── Sprint 34 vague 34-1A — Export PDF premium (cover page + footer brand) ──
  const handleExportPdf = () => triggerPdfExport('lead-sheet');
  const todayLabel = new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="print-lead-detail">
      {/* Sprint 34 wave 34-1A — PDF cover page premium (cachée en screen, révélée en pdf-mode-lead-sheet) */}
      <div className="pdf-cover-page" aria-hidden="true">
        <div className="pdf-cover-accent-bar" />
        <div className="pdf-cover-logo">Intralys</div>
        <div className="pdf-cover-tagline">CRM tout-en-un pour PMEs</div>
        <h1 className="pdf-cover-title">Fiche lead · {lead.name}</h1>
        <p className="pdf-cover-subtitle">
          Synthèse complète : informations de contact, score, statut pipeline, timeline d'activité et historique.
        </p>
        <div className="pdf-cover-meta">
          <div className="pdf-cover-meta-item">
            <span className="label">Généré le</span>
            <span className="value">{todayLabel}</span>
          </div>
          <div className="pdf-cover-meta-item">
            <span className="label">Client</span>
            <span className="value">{lead.client_name || '—'}</span>
          </div>
          <div className="pdf-cover-meta-item">
            <span className="label">Statut</span>
            <span className="value">{STATUS_LABELS[lead.status] || lead.status}</span>
          </div>
          <div className="pdf-cover-meta-item">
            <span className="label">Score</span>
            <span className="value">{lead.score} / 100</span>
          </div>
        </div>
      </div>

      {/* Bouton retour — masqué en mode compact (panel) */}
      {!compact && (
        <button onClick={() => void navigate({ to: '/leads' })}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--primary)] mb-4 flex items-center gap-1.5 cursor-pointer transition-colors">
          <Icon as={ArrowLeft} size="md" /> Retour aux leads
        </button>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-6xl">
        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-4">
          {/* En-tête — Stripe-clean : white card sober + thin border (highlight if hot) */}
          <div
            className="relative rounded-[var(--radius-lg)] p-6 bg-[var(--bg-surface)] border shadow-xs"
            style={{
              borderColor: lead.score >= 70 ? 'var(--primary)' : 'var(--border-subtle)',
              marginBottom: '1rem',
            }}
          >
            {lead.score >= 70 && <span className="badge-hot">HOT {lead.score}</span>}

            <div className="relative z-10 flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                <Avatar name={lead.name} size="lg" ring={lead.score >= 70 ? 'hot' : 'none'} style={{ viewTransitionName: 'avatar-' + lead.id }} />
                <div>
                  <h1 className="t-h1 text-[var(--text-primary)]">{lead.name}</h1>
                  <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mt-1">
                    <button onClick={() => void navigate({ to: `/clients/${lead.client_id}` })} className="hover:text-[var(--primary)] cursor-pointer transition-colors font-medium">{lead.client_name}</button>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span>{SOURCE_LABELS[lead.source] || lead.source}</span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span>{formatDate(lead.created_at, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
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
                  className="p-1 cursor-pointer hover:scale-110 transition-transform"
                  title={lead.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                  aria-label={lead.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                  aria-pressed={lead.favorite ? 'true' : 'false'}>
                  <Icon as={Star} size={18} className={lead.favorite ? 'fill-[var(--warning)] text-[var(--warning)]' : 'text-[var(--text-muted)]'} />
                </button>
                <Tag dot size="sm" color={lead.type === 'inbound' ? 'var(--primary)' : 'var(--warning)'}>
                  {lead.type === 'inbound' ? 'Entrant' : lead.type === 'customer' ? 'Client' : lead.type}
                </Tag>
                <Tag dot size="sm" color={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Tag>
                {lead.lifecycle_stage && (
                  <Tag dot size="sm" color={LIFECYCLE_COLORS[lead.lifecycle_stage as LifecycleStage] || 'var(--text-muted)'}>
                    {LIFECYCLE_LABELS[lead.lifecycle_stage as LifecycleStage] || lead.lifecycle_stage}
                  </Tag>
                )}
                {lead.dnd ? <span title="Ne pas déranger" className="text-sm">🔕</span> : null}
                {/* Sprint 34 vague 34-1A — Export PDF premium fiche lead */}
                <button
                  onClick={handleExportPdf}
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--brand-tint)] cursor-pointer transition-colors"
                  title="Exporter la fiche en PDF"
                  aria-label="Exporter la fiche lead en PDF"
                >
                  <Icon as={Download} size={16} />
                </button>
                {/* Sprint 35 vague 35-2D — Partage natif (Web Share API → fallback clipboard) */}
                <ShareButton
                  title={lead.name}
                  url={typeof window !== 'undefined' ? window.location.href : ''}
                  ariaLabel={`Partager la fiche de ${lead.name}`}
                  tooltip="Partager la fiche"
                />

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
                  aria-label="Supprimer ce lead"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Actions rapides — chips premium cohérents Sprint 23 wave 14 */}
            <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-[var(--border-subtle)]">
              {lead.phone && (
                <PhoneLink phone={lead.phone}>Appeler</PhoneLink>
              )}
              <a href={`mailto:${lead.email}`} className="action-chip">
                <span className="action-chip-icon"><Icon as={Mail} size={12} /></span>
                Email
              </a>
              <button onClick={() => void navigate({ to: '/calendar' })} className="action-chip">
                <span className="action-chip-icon"><Icon as={CalendarPlus} size="xs" /></span>
                Planifier RDV
              </button>
              <button onClick={() => void navigate({ to: '/tasks' })} className="action-chip">
                <span className="action-chip-icon"><Icon as={CheckSquare} size="xs" /></span>
                Créer tâche
              </button>
              <button onClick={() => void navigate({ to: `/visit/${leadId}` })} className="action-chip action-chip--accent">
                <span className="action-chip-icon"><Icon as={Compass} size="xs" /></span>
                Mode Visite
              </button>
            </div>

            {/* Champs avec édition inline — Sprint 23 wave 24 : Input premium au focus, pencil + slide brand au hover */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[{ key: 'email', label: 'Email', val: lead.email, link: `mailto:${lead.email}` },
                { key: 'phone', label: 'Téléphone', val: lead.phone || '—', isPhone: true },
                { key: 'address', label: 'Adresse', val: lead.address || '—' },
                { key: 'budget', label: 'Budget', val: lead.budget || '—' },
                { key: 'property_type', label: 'Type propriété', val: lead.property_type || '—' },
                { key: 'timeline', label: 'Délai', val: lead.timeline || '—' },
              ].map(f => (
                <div key={f.key}>
                  <p className="heading-premium mb-1">{f.label}</p>
                  {editingField === f.key ? (
                    <Input
                      autoFocus
                      value={fieldValue}
                      onChange={e => setFieldValue(e.target.value)}
                      onBlur={() => void saveField(f.key)}
                      onKeyDown={e => { if (e.key === 'Enter') void saveField(f.key); if (e.key === 'Escape') setEditingField(null); }}
                    />
                  ) : (
                    <button
                      onClick={() => startEdit(f.key, f.val === '—' ? '' : f.val)}
                      className="lead-field-edit group relative w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-transparent transition-colors cursor-pointer hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--primary)]"
                    >
                      <span className="flex-1 min-w-0 truncate">
                        {'isPhone' in f && f.isPhone && f.val !== '—'
                          ? <PhoneLink phone={f.val} variant="inline" showIcon={false}>{f.val}</PhoneLink>
                          : f.link && f.val !== '—'
                            ? <a href={f.link} className="text-[var(--primary)] hover:underline" onClick={e => e.stopPropagation()}>{f.val}</a>
                            : <span>{f.val}</span>}
                      </span>
                      <span aria-hidden className="text-[11px] text-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                    </button>
                  )}
                </div>
              ))}
              {lead.message && <div className="col-span-2"><p className="heading-premium mb-1">Message</p><p className="text-[var(--text-secondary)] text-sm">{lead.message}</p></div>}
            </div>

            {/* Sprint 51 M3.3 — Provenance (attribution marketing, lecture seule) */}
            {(() => {
              const consent = lead.consent_status;
              const prov: { label: string; value: string }[] = [
                { label: 'Source', value: SOURCE_LABELS[lead.source] || lead.source || '' },
                { label: 'Campagne', value: lead.utm_campaign || '' },
                { label: 'Médium', value: lead.utm_medium || '' },
                { label: 'Source UTM', value: lead.utm_source || '' },
                { label: 'Terme', value: lead.utm_term || '' },
                { label: 'Contenu', value: lead.utm_content || '' },
                { label: 'Google Click ID', value: lead.gclid || '' },
                { label: 'Facebook Click ID', value: lead.fbclid || '' },
                { label: 'Première interaction', value: lead.referrer || '' },
              ].filter(p => p.value);
              if (prov.length === 0 && !consent) return null;
              return (
                <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Provenance</h3>
                    {consent && (
                      <Tag
                        dot
                        size="xs"
                        variant={consent === 'granted' ? 'success' : consent === 'denied' ? 'danger' : 'neutral'}
                      >
                        Consentement : {consent === 'granted' ? 'accordé' : consent === 'denied' ? 'refusé' : 'inconnu'}
                      </Tag>
                    )}
                  </div>
                  {prov.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {prov.map(p => (
                        <div key={p.label} className="min-w-0">
                          <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider mb-0.5">{p.label}</p>
                          <p className="truncate" title={p.value}>{p.value}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)] italic">Aucune donnée d'attribution pour ce lead.</p>
                  )}
                </div>
              );
            })()}

            {/* Champs Personnalisés — source unique : customFields state (chargé via getLeadCustomFields) */}
            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Champs Personnalisés</h3>
                <button onClick={() => void navigate({ to: '/settings' })} className="text-[10px] text-[var(--primary)] hover:underline cursor-pointer">Gérer les champs</button>
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

          {/* KPI mini-strip Sprint 23 wave 24 — densification GHL : signal lead en 5s */}
          <KpiStrip items={kpiItems} className="!mb-2" />

          {/* AI summary banner — résumé contextuel auto-généré (mock heuristique simple) */}
          <SmartBanner
            dismissKey={`lead_ai_summary_${leadId}`}
            variant="ai"
            icon={<Sparkles size={16} strokeWidth={2.5} />}
            title={aiSummary.title}
            description={aiSummary.description}
            action={aiSummary.action}
            secondaryLabel="Plus tard"
          />

          {/* Onglets Sprint 23 wave 24 — migration au primitif Tabs (underline gradient + glow) */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="overflow-x-auto">
              <TabsTrigger value="details">Détails</TabsTrigger>
              <TabsTrigger value="notes">Notes <Tag variant="neutral" size="xs" className="ml-1.5">{leadNotes.length}</Tag></TabsTrigger>
              <TabsTrigger value="conversations">Conversations <Tag variant="neutral" size="xs" className="ml-1.5">{messagesCount}</Tag></TabsTrigger>
              <TabsTrigger value="scores">Scores</TabsTrigger>
              <TabsTrigger value="activity">Activité</TabsTrigger>
            </TabsList>

            <TabsContent value="conversations">
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Icon as={MessageSquare} size="sm" className="text-[var(--primary)]" /> Conversations</h3>
                <ConversationPanel
                  leadId={lead.id}
                  leadName={lead.name}
                  leadEmail={lead.email}
                  leadPhone={lead.phone}
                />
              </Card>
            </TabsContent>

            <TabsContent value="activity">
              <Card className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><Icon as={ActivityIcon} size="sm" className="text-[var(--primary)]" /> Timeline complète</h3>
                  <span className="heading-premium">Activité · Notes · RDV · Tâches</span>
                </div>
                <LeadTimeline lead={lead} notes={leadNotes} appointments={leadAppointments} tasks={leadTasks} />
              </Card>
            </TabsContent>

            <TabsContent value="notes">
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  Notes
                  <Tag variant="brand" size="xs" dot>{leadNotes.length}</Tag>
                </h3>
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
                          className="text-xs text-[var(--primary)] hover:underline cursor-pointer">
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
                {/* Formulaire ajout note — Textarea + Select premium (wave 24) */}
                <div className="mb-4 space-y-2 p-3 rounded-[var(--radius-md)] bg-[var(--bg-subtle)]">
                  <div className="relative">
                    <Textarea
                      value={newNoteBody}
                      onChange={e => setNewNoteBody(e.target.value)}
                      rows={3}
                      placeholder="Ajouter une note…"
                      className="pr-10"
                    />
                    <AiSparkles value={newNoteBody} onChange={setNewNoteBody} leadId={leadId} className="absolute bottom-2 right-2" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-44">
                      <Select size="sm" value={newNoteCategory} onChange={e => setNewNoteCategory(e.target.value)}>
                        {Object.entries(NOTE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{NOTE_CATEGORY_ICONS[k]} {v}</option>)}
                      </Select>
                    </div>
                    <Button size="sm" disabled={!newNoteBody.trim()} onClick={async () => {
                      await createLeadNote(leadId, { body: newNoteBody, category: newNoteCategory });
                      setNewNoteBody(''); setNewNoteCategory('general');
                      const r = await getLeadNotes(leadId); if (r.data) setLeadNotes(r.data);
                    }}>Ajouter</Button>
                  </div>
                </div>
                {/* Liste des notes — list-item-enter staggered + row-premium hover */}
                {leadNotes.length === 0 ? (
                  <EmptyState
                    title="Aucune note"
                    description="Documentez les conversations, intentions et préférences du lead pour ne rien oublier."
                  />
                ) : (
                  <div className="space-y-3">
                    {leadNotes.map((note, i) => (
                      <div
                        key={note.id}
                        className={`list-item-enter row-premium p-3 rounded-[var(--radius-md)] border ${note.is_pinned ? 'border-[var(--warning)] bg-[oklch(0.95_0.02_90)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'}`}
                        style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
                      >
                        <div className="flex items-center justify-between mb-1.5 gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                            {note.is_pinned && <Tag variant="warning" size="xs" leftIcon={<span>📌</span>}>Épinglée</Tag>}
                            <Tag variant="brand" size="xs" leftIcon={<span>{NOTE_CATEGORY_ICONS[note.category] || '📝'}</span>}>
                              {NOTE_CATEGORY_LABELS[note.category] || note.category}
                            </Tag>
                            <span className="text-[10px] text-[var(--text-muted)]">{note.author_name || 'Système'}</span>
                            <Tag variant="neutral" size="xs">{formatRelativeShort(note.created_at)}</Tag>
                          </div>
                          <button onClick={async () => {
                              const prev = leadNotes;
                              setLeadNotes(leadNotes.filter(n => n.id !== note.id));
                              const res = await deleteLeadNote(leadId, note.id);
                              if (res.error) { setLeadNotes(prev); toastError(`Erreur suppression note : ${res.error}`); }
                            }}
                            className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer transition-colors shrink-0" aria-label="Supprimer la note">✕</button>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{note.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="scores">
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">📊 Scores multi-profils</h3>
                {leadScores.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">Aucun score calculé. Les scores seront calculés automatiquement.</p>
                ) : (
                  <div className="space-y-3">
                    {leadScores.map((s, i) => (
                      <div
                        key={s.profile_id}
                        className="list-item-enter row-premium p-3 rounded-[var(--radius-md)] bg-[var(--bg-subtle)]"
                        style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
                      >
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
              </Card>
            </TabsContent>
          </Tabs>

        </div>

        {/* Colonne latérale — Sprint 23 wave 24 : sections premium avec accent line + Tag primitive */}
        <div className="space-y-4">
          {/* Sprint E1 M3.4 — Encart « Compte boutique lié » : additif, conditionnel
              (n'apparaît que si un customer e-commerce est réconcilié à ce lead
              ET que le module ecommerce est actif — l'API renvoie null sinon). */}
          {linkedCustomer && (
            <Card className="p-4">
              <SidebarSectionTitle>{t('shop.linked_account')}</SidebarSectionTitle>
              <div className="flex items-center gap-3 mb-3">
                <span className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] shrink-0">
                  <ShoppingBag size={16} strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {`${linkedCustomer.first_name || ''} ${linkedCustomer.last_name || ''}`.trim() || linkedCustomer.email}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate">{linkedCustomer.email}</p>
                </div>
              </div>
              <button
                onClick={() => void navigate({ to: '/boutique/clients' })}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:underline cursor-pointer"
              >
                <ExternalLink size={13} strokeWidth={2} /> {t('shop.linked_account_view')}
              </button>
            </Card>
          )}

          {/* Statut */}
          <Card className="p-4">
            <SidebarSectionTitle>Statut</SidebarSectionTitle>
            <div className="space-y-1">
              {LEAD_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => void handleStatusChange(s)}
                  className={`w-full text-left px-3 py-2 rounded-[var(--radius-md)] text-sm font-medium transition-colors cursor-pointer ${
                    lead.status === s
                      ? 'bg-[var(--brand-tint)] text-[var(--primary)] border border-[var(--primary)]/30'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-transparent'
                  }`}
                >
                  <Tag dot size="sm" color={STATUS_COLORS[s]}>{STATUS_LABELS[s]}</Tag>
                </button>
              ))}
            </div>
          </Card>

          {/* Opportunité / Deal */}
          <Card className="p-4">
            <SidebarSectionTitle>Opportunité</SidebarSectionTitle>
            <div className="space-y-3">
              <div>
                <p className="heading-premium mb-1">Valeur du deal</p>
                {isEditingDeal ? (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={editDealValue}
                      onChange={(e) => setEditDealValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveDeal(); if (e.key === 'Escape') setIsEditingDeal(false); }}
                      autoFocus
                    />
                    <Button size="sm" onClick={() => void handleSaveDeal()}>OK</Button>
                  </div>
                ) : (
                  <button onClick={() => setIsEditingDeal(true)} className="text-2xl font-bold text-[var(--text-primary)] cursor-pointer hover:text-[var(--primary)] transition-colors inline-block">
                    {lead.deal_value ? formatMoneyCAD(lead.deal_value, getLocale()) : 'Ajouter'}
                  </button>
                )}
              </div>
              <div>
                <p className="heading-premium mb-1">Probabilité ({stageFromBackend?.name || STATUS_LABELS[lead.status]})</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${probability}%`, background: 'var(--primary)' }}
                    />
                  </div>
                  <span className="text-xs font-bold text-[var(--primary)] t-mono-num">{probability}%</span>
                </div>
              </div>
              {forecast > 0 && (
                <div>
                  <p className="heading-premium mb-1">Prévision pondérée</p>
                  <p className="text-sm font-semibold text-[var(--success)]">{formatMoneyCAD(forecast, getLocale())}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Tags — Tag primitive premium */}
          <Card className="p-4">
            <SidebarSectionTitle>Tags</SidebarSectionTitle>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {lead.tags && lead.tags.length > 0 ? lead.tags.map((tag) => (
                <Tag key={tag} variant="brand" size="sm" dot onRemove={() => void handleRemoveTag(tag)}>
                  {tag}
                </Tag>
              )) : <p className="text-xs text-[var(--text-muted)] italic">Aucun tag</p>}
            </div>

            {/* Sprint 49 M3.2 — Tags suggérés par IA (suggestion only — l'utilisateur
                accepte/rejette chaque tag individuellement ; aucun auto-apply Loi 25) */}
            {(suggestedLeadTags.length > 0 || isClassifyingLead) && (
              <div className="lead-ai-tags">
                <div className="lead-ai-tags-head">
                  <span className="lead-ai-tags-label">Tags suggérés par IA</span>
                  {isClassifyingLead && <span className="lead-ai-tags-loading">analyse…</span>}
                </div>
                {suggestedLeadTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedLeadTags.map(tag => (
                      <span key={tag} className="lead-ai-tag-chip">
                        <button
                          type="button"
                          className="lead-ai-tag-accept"
                          onClick={() => void acceptSuggestedTag(tag)}
                          title="Accepter ce tag"
                          aria-label={`Accepter le tag ${tag}`}
                        >
                          + {tag}
                        </button>
                        <button
                          type="button"
                          className="lead-ai-tag-reject"
                          onClick={() => rejectSuggestedTag(tag)}
                          title="Rejeter cette suggestion"
                          aria-label={`Rejeter la suggestion ${tag}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-1.5">
              <Input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Nouveau tag…"
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddTag(); }}
                className="h-[32px] text-xs"
              />
              <Button size="sm" variant="secondary" onClick={() => void handleAddTag()}>+</Button>
            </div>
          </Card>

          {/* DND — Do Not Disturb */}
          <Card className="p-4">
            <SidebarSectionTitle>Ne pas déranger</SidebarSectionTitle>
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
            <SidebarSectionTitle>Infos complémentaires</SidebarSectionTitle>
            <div className="space-y-2 text-xs">
              {[
                { key: 'date_of_birth', label: 'Date de naissance', val: (lead as unknown as Record<string, unknown>).date_of_birth as string || '—', type: 'date' },
                { key: 'country', label: 'Pays', val: (lead as unknown as Record<string, unknown>).country as string || 'CA', type: 'text' },
                { key: 'timezone', label: 'Fuseau horaire', val: (lead as unknown as Record<string, unknown>).timezone as string || 'America/Toronto', type: 'text' },
              ].map(f => (
                <div key={f.key} className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-muted)]">{f.label}</span>
                  {editingField === f.key ? (
                    <div className="w-36">
                      <Input
                        autoFocus
                        type={f.type}
                        value={fieldValue}
                        onChange={e => setFieldValue(e.target.value)}
                        onBlur={() => void saveField(f.key)}
                        onKeyDown={e => { if (e.key === 'Enter') void saveField(f.key); if (e.key === 'Escape') setEditingField(null); }}
                        className="h-[28px] text-xs text-right"
                      />
                    </div>
                  ) : (
                    <button onClick={() => startEdit(f.key, f.val === '—' ? '' : f.val)} className="group flex items-center gap-1 text-right cursor-pointer text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors">
                      <span>{f.val}</span>
                      <span aria-hidden className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* RDV liés */}
          <Card className="p-4">
            <SidebarSectionTitle>Rendez-vous</SidebarSectionTitle>
            {leadAppointments.length > 0 ? (
              <div className="space-y-2">
                {leadAppointments.map((appt, i) => {
                  const apptDate = new Date(appt.start_time + (appt.start_time.endsWith('Z') ? '' : 'Z'));
                  return (
                    <div
                      key={appt.id}
                      className="list-item-enter row-premium p-2 bg-[var(--bg-subtle)] rounded-[var(--radius-sm)]"
                      style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs">{APPOINTMENT_TYPE_ICONS[appt.type]}</span>
                        <span className="text-xs font-medium truncate">{appt.title}</span>
                      </div>
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {APPOINTMENT_TYPE_LABELS[appt.type]} · {formatDate(apptDate, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })} à {formatTime(apptDate, getLocale())}
                        </span>
                        <Tag
                          variant={appt.status === 'confirmed' ? 'success' : appt.status === 'cancelled' ? 'danger' : 'neutral'}
                          size="xs"
                          dot
                        >
                          {APPOINTMENT_STATUS_LABELS[appt.status]}
                        </Tag>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] italic">Aucun RDV planifié</p>
            )}
          </Card>

          {/* Score visuel Sprint 23 wave 9 — gauge SVG demi-cercle */}
          <Card className="p-4">
            <SidebarSectionTitle>Lead Score</SidebarSectionTitle>
            <div className="flex flex-col items-center gap-2">
              <ScoreGauge score={lead.score} size={120} showLabel />
              <p className="text-[10px] text-[var(--text-muted)] mt-1 text-center">
                {lead.score >= 70 ? 'Prêt à convertir — agissez maintenant' :
                 lead.score >= 40 ? 'À relancer cette semaine' :
                 'À nourrir — workflow drip recommandé'}
              </p>
            </div>
          </Card>

          {/* ── Sprint 32 vague 32-2B — Pourquoi ce score ? (signals breakdown) ── */}
          <Card className="p-4 score-explain-panel">
            <div className="flex items-center justify-between mb-3">
              <SidebarSectionTitle>Pourquoi ce score ?</SidebarSectionTitle>
              <span className="score-explain-ai-chip" title="Décomposition heuristique (mock pour Claude Haiku futur)">
                <Sparkles size={9} strokeWidth={2.5} />
                Signal AI
              </span>
            </div>
            {(() => {
              const signals: ScoreSignal[] = explainScore({
                score: lead.score,
                status: lead.status,
                source: lead.source,
                deal_value: lead.deal_value,
                updated_at: lead.updated_at,
                last_activity_at: lead.last_activity_at,
                tags: lead.tags,
                messagesCount: messagesCount,
                tasksDoneCount: leadTasks.filter(t => t.status === 'done').length,
                stageProbability: probability,
              });
              const maxWeight = Math.max(...signals.map(s => s.weight), 0.001);
              return (
                <div className="space-y-2">
                  {signals.map((s, i) => {
                    const isPositive = s.contribution >= 0;
                    const barWidth = Math.max(8, (s.weight / maxWeight) * 100);
                    return (
                      <div
                        key={s.id}
                        className="score-signal-row list-item-enter"
                        style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                        title={s.detail}
                      >
                        <div className="score-signal-head">
                          <span className="score-signal-label">{s.label}</span>
                          <span className={`score-signal-chip ${isPositive ? 'score-signal-chip--pos' : 'score-signal-chip--neg'}`}>
                            {isPositive ? '+' : ''}{s.contribution}
                          </span>
                        </div>
                        <div className="score-signal-bar-track">
                          <div
                            className={`score-signal-bar-fill ${isPositive ? 'score-signal-bar-fill--pos' : 'score-signal-bar-fill--neg'}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <div className="score-signal-meta">
                          <span className="score-signal-value t-mono-num">{s.value}</span>
                          {s.detail && <span className="score-signal-detail">{s.detail}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </Card>

          {/* ── Sprint 49 M2.1 — Prévision conversion 30 jours ── */}
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
              messagesCount: messagesCount,
              tasksDoneCount: leadTasks.filter(t => t.status === 'done').length,
              stageProbability: probability,
            }}
          />

          {/* Sprint 20 : suggestion AI prochaine étape — affichée seulement si lead inactif >7j */}
          {daysSinceUpdate >= 7 && !['closed', 'lost'].includes(lead.status) && <AiNextActionCard leadId={leadId} />}

          {/* Tâches liées — list-item-enter staggered */}
          <Card className="p-4">
            <SidebarSectionTitle>Tâches</SidebarSectionTitle>
            {leadTasks.length > 0 ? (
              <div className="space-y-1.5">
                {leadTasks.map((task, i) => (
                  <div
                    key={task.id}
                    onClick={() => openPanel({ type: 'task', id: task.id })}
                    className={`list-item-enter row-premium w-full text-left p-2 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] ${task.status === 'done' ? 'opacity-50' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
                  >
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
              <p className="text-xs text-[var(--text-muted)] italic">Aucune tâche liée</p>
            )}
          </Card>

          {/* Infos */}
          <Card className="p-4">
            <SidebarSectionTitle>Infos</SidebarSectionTitle>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Créé le</span><span>{formatDate(lead.created_at, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Mis à jour</span><span>{formatDate(lead.updated_at, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Source</span><span>{SOURCE_LABELS[lead.source] || lead.source}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">ID</span><span className="font-mono truncate ml-2">{lead.id.slice(0, 8)}</span></div>
            </div>
          </Card>

          {/* Conformité (Loi 25) — masqué en PDF (data-lead-sheet-internal Sprint 34 wave 34-1A) */}
          <Card className="p-4" data-lead-sheet-internal>
            <SidebarSectionTitle>Loi 25 (Québec)</SidebarSectionTitle>
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
    </div>
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
