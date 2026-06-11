// ── TaskPanel — Slide-over pour éditer une tâche ────────────────────────────
// Sprint 23 wave 28 — refonte visuelle dramatique :
//   • Mini KpiStrip header (status / priority / échéance / sous-tâches)
//   • Subtasks : checkbox premium gradient + list-item-enter stagger
//     + list-item-highlight 1.4s flash brand sur création optimiste
//   • Comments : card-style avec Avatar + status + body + ago, Textarea
//     premium focus ring brand, list-item-enter stagger 50ms, highlight flash
//   • Status + priority changers via DropdownMenu premium color-coded (Tag)
//   • Toutes les anciennes API/handlers conservés (backward compat strict).
// Différenciateur : depuis LeadPanel, cliquer une tâche → TaskPanel s'ouvre en
// stack au-dessus. Stack jusqu'à 3 panels (Lead → Task → Conv).

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  SlidePanel,
  usePanelStack,
  Skeleton,
  Button,
  useToast,
  AiSparkles,
  KpiStrip,
  type KpiItem,
  Tag,
  Avatar,
  Textarea,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Tooltip,
  Icon,
} from '@/components/ui';
import {
  getTask,
  updateTask,
  deleteTask,
  getSubtasks,
  createSubtask,
  updateSubtask,
  deleteSubtask,
  getTaskComments,
  createTaskComment,
  deleteTaskComment,
} from '@/lib/api';
import {
  type Task,
  type Subtask,
  type TaskComment,
  type TaskPriority,
  type TaskStatus,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/lib/types';
import {
  Check,
  Trash2,
  Plus,
  MessageSquare,
  Calendar,
  AlertTriangle,
  CheckSquare,
  Flag,
  ChevronDown,
  Circle,
  Loader2,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { LeadLink } from './LeadLink';
import { t } from '@/lib/i18n';

interface TaskPanelProps {
  id: string;
  stackLevel: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type SemanticColor = 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral' | 'accent';

const STATUS_VARIANT: Record<TaskStatus, SemanticColor> = {
  todo: 'neutral',
  in_progress: 'info',
  done: 'success',
};

const PRIORITY_VARIANT: Record<TaskPriority, SemanticColor> = {
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

function StatusIcon({ status, size = 12 }: { status: TaskStatus; size?: number }) {
  if (status === 'done') return <CheckCircle2 size={size} />;
  if (status === 'in_progress') return <Loader2 size={size} className="animate-spin" />;
  return <Circle size={size} />;
}

/** Retourne un libellé compact pour échéance (J-0, J+2, ⚠ -3j) + variant. */
function getDueInfo(due_date?: string | null): { label: string; variant: SemanticColor; overdue: boolean } {
  if (!due_date) return { label: '—', variant: 'neutral', overdue: false };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(due_date);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: `⚠ ${Math.abs(diffDays)}j`, variant: 'danger', overdue: true };
  if (diffDays === 0) return { label: t('panels.task_due_today'), variant: 'warning', overdue: false };
  if (diffDays === 1) return { label: t('panels.task_due_tomorrow'), variant: 'warning', overdue: false };
  if (diffDays <= 7) return { label: `J+${diffDays}`, variant: 'info', overdue: false };
  return { label: `J+${diffDays}`, variant: 'neutral', overdue: false };
}

/** Time-ago compact (min, h, j, sem). */
function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diffSec = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}j`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} sem`;
  return d.toLocaleDateString('fr-CA');
}

export function TaskPanel({ id, stackLevel }: TaskPanelProps) {
  const { closeTopPanel } = usePanelStack();
  const { success, error: toastError } = useToast();
  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  // IDs récemment ajoutés (subtask/comment) — déclenche .list-item-highlight 1.4s
  const [highlightedSubtaskId, setHighlightedSubtaskId] = useState<string | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await getTask(id);
    if (res.data) {
      setTask(res.data);
      setEditDesc(res.data.description || '');
    }
    setIsLoading(false);
    getSubtasks(id).then(r => { if (r.data) setSubtasks(r.data); }).catch(() => {});
    getTaskComments(id).then(r => { if (r.data) setComments(r.data); }).catch(() => {});
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Auto-clear highlight après l'animation (1500ms safe)
  useEffect(() => {
    if (!highlightedSubtaskId) return;
    const timer = setTimeout(() => setHighlightedSubtaskId(null), 1500);
    return () => clearTimeout(timer);
  }, [highlightedSubtaskId]);
  useEffect(() => {
    if (!highlightedCommentId) return;
    const timer = setTimeout(() => setHighlightedCommentId(null), 1500);
    return () => clearTimeout(timer);
  }, [highlightedCommentId]);

  // ── Mutations optimistes ──────────────────────────────────────────────────
  const changeStatus = async (status: TaskStatus) => {
    if (!task) return;
    const prev = task;
    setTask({ ...task, status });
    const res = await updateTask(id, { status });
    if (res.error) { setTask(prev); toastError(t('panels.task_err').replace('{msg}', res.error)); }
  };

  const changePriority = async (priority: TaskPriority) => {
    if (!task) return;
    const prev = task;
    setTask({ ...task, priority });
    const res = await updateTask(id, { priority });
    if (res.error) { setTask(prev); toastError(t('panels.task_err').replace('{msg}', res.error)); }
  };

  const saveDescription = async () => {
    if (!task || editDesc === (task.description || '')) { setIsEditingDesc(false); return; }
    const prev = task;
    setTask({ ...task, description: editDesc });
    setIsEditingDesc(false);
    const res = await updateTask(id, { description: editDesc });
    if (res.error) { setTask(prev); toastError(t('panels.task_err').replace('{msg}', res.error)); }
  };

  const toggleSubtask = async (s: Subtask) => {
    const nextDone = s.is_done === 1 ? 0 : 1;
    setSubtasks(prev => prev.map(p => p.id === s.id ? { ...p, is_done: nextDone } : p));
    const res = await updateSubtask(s.id, nextDone === 1);
    if (res.error) {
      setSubtasks(prev => prev.map(p => p.id === s.id ? s : p));
      toastError(t('panels.task_err').replace('{msg}', res.error));
    }
  };

  const addSubtask = async () => {
    if (!newSubtask.trim()) return;
    const body = newSubtask.trim();
    setNewSubtask('');
    const res = await createSubtask(id, body);
    if (res.data?.id) {
      const newId = res.data.id;
      const r = await getSubtasks(id);
      if (r.data) setSubtasks(r.data);
      setHighlightedSubtaskId(newId);
    } else {
      toastError(t('panels.task_subtask_err').replace('{msg}', res.error || t('panels.task_err_unknown')));
    }
  };

  const removeSubtask = async (subtaskId: string) => {
    const prev = subtasks;
    setSubtasks(prev.filter(s => s.id !== subtaskId));
    const res = await deleteSubtask(subtaskId);
    if (res.error) { setSubtasks(prev); toastError(t('panels.task_err').replace('{msg}', res.error)); }
  };

  const addComment = async () => {
    if (!newComment.trim()) return;
    const body = newComment.trim();
    setNewComment('');
    const res = await createTaskComment(id, body);
    if (res.data?.id) {
      const newId = res.data.id;
      const r = await getTaskComments(id);
      if (r.data) setComments(r.data);
      setHighlightedCommentId(newId);
    } else {
      toastError(t('panels.task_comment_err').replace('{msg}', res.error || t('panels.task_err_unknown')));
    }
  };

  const removeComment = async (commentId: string) => {
    const prev = comments;
    setComments(prev.filter(c => c.id !== commentId));
    const res = await deleteTaskComment(commentId);
    if (res.error) { setComments(prev); toastError(t('panels.task_err').replace('{msg}', res.error)); }
  };

  const handleDeleteTask = async () => {
    if (!task) return;
    const res = await deleteTask(id);
    if (res.error) { toastError(t('panels.task_err').replace('{msg}', res.error)); return; }
    success(t('panels.task_deleted'));
    closeTopPanel();
  };

  // ── KpiStrip items (memoized) ─────────────────────────────────────────────
  const subtaskDone = subtasks.filter(s => s.is_done === 1).length;
  const subtaskTotal = subtasks.length;
  const dueInfo = useMemo(() => getDueInfo(task?.due_date), [task?.due_date]);

  const kpiItems: KpiItem[] = useMemo(() => {
    if (!task) return [];
    const statusColor = STATUS_VARIANT[task.status] as KpiItem['color'];
    const priorityColor = PRIORITY_VARIANT[task.priority] as KpiItem['color'];
    return [
      {
        label: t('panels.task_kpi_status'),
        value: TASK_STATUS_LABELS[task.status],
        color: statusColor,
        icon: <StatusIcon status={task.status} size={11} />,
      },
      {
        label: t('panels.task_kpi_priority'),
        value: TASK_PRIORITY_LABELS[task.priority],
        color: priorityColor,
        icon: <Flag size={11} />,
      },
      {
        label: t('panels.task_kpi_due'),
        value: dueInfo.label,
        color: dueInfo.variant as KpiItem['color'],
        icon: <Calendar size={11} />,
      },
      {
        label: t('panels.task_kpi_subtasks'),
        value: subtaskTotal > 0 ? `${subtaskDone}/${subtaskTotal}` : '—',
        color: subtaskTotal > 0 && subtaskDone === subtaskTotal ? 'success' : 'brand',
        icon: <CheckSquare size={11} />,
      },
    ];
  }, [task, dueInfo, subtaskDone, subtaskTotal]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SlidePanel
      open={true}
      onOpenChange={(o) => { if (!o) closeTopPanel(); }}
      title={task?.title || t('panels.task_fallback_title')}
      size="md"
      stackLevel={stackLevel}
      headerActions={
        task ? (
          <Tooltip content={t('panels.task_delete_tip')} variant="danger" delay={400}>
            <button
              onClick={() => void handleDeleteTask()}
              className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors cursor-pointer"
              aria-label={t('panels.task_delete_aria')}
            >
              <Icon as={Trash2} size="sm" />
            </button>
          </Tooltip>
        ) : null
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !task ? (
        <div className="text-center py-8 text-[var(--text-muted)]">
          <Icon as={AlertTriangle} size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">{t('panels.task_not_found')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Mini KpiStrip header — 4 vitales en un coup d'œil ──────── */}
          <KpiStrip items={kpiItems} className="mb-0" />

          {/* ── Action row : Status + Priority via DropdownMenu premium ── */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status changer */}
            <DropdownMenu
              align="start"
              trigger={
                <button
                  type="button"
                  className="action-chip"
                  aria-label={t('panels.task_change_status')}
                >
                  <span className="action-chip-icon">
                    <StatusIcon status={task.status} size={12} />
                  </span>
                  <span>{TASK_STATUS_LABELS[task.status]}</span>
                  <ChevronDown size={12} className="opacity-60" />
                </button>
              }
            >
              <DropdownMenuLabel>{t('panels.task_status_label')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(['todo', 'in_progress', 'done'] as TaskStatus[]).map((s) => (
                <DropdownMenuItem
                  key={s}
                  onSelect={() => void changeStatus(s)}
                  leftIcon={<StatusIcon status={s} size={12} />}
                  rightSlot={task.status === s ? <Check size={12} /> : undefined}
                >
                  <Tag variant={STATUS_VARIANT[s]} size="xs" dot>
                    {TASK_STATUS_LABELS[s]}
                  </Tag>
                </DropdownMenuItem>
              ))}
            </DropdownMenu>

            {/* Priority changer */}
            <DropdownMenu
              align="start"
              trigger={
                <button
                  type="button"
                  className="action-chip action-chip--accent"
                  aria-label={t('panels.task_change_priority')}
                >
                  <span className="action-chip-icon">
                    <Flag size={12} />
                  </span>
                  <span>{TASK_PRIORITY_LABELS[task.priority]}</span>
                  <ChevronDown size={12} className="opacity-60" />
                </button>
              }
            >
              <DropdownMenuLabel>{t('panels.task_priority_label')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(['high', 'medium', 'low'] as TaskPriority[]).map((p) => (
                <DropdownMenuItem
                  key={p}
                  onSelect={() => void changePriority(p)}
                  leftIcon={<Flag size={12} />}
                  rightSlot={task.priority === p ? <Check size={12} /> : undefined}
                >
                  <Tag variant={PRIORITY_VARIANT[p]} size="xs" dot>
                    {TASK_PRIORITY_LABELS[p]}
                  </Tag>
                </DropdownMenuItem>
              ))}
            </DropdownMenu>

            {/* Échéance affichée comme chip non-cliquable (édition future) */}
            {task.due_date && (
              <Tooltip
                title={t('panels.task_due_tip')}
                description={new Date(task.due_date).toLocaleDateString('fr-CA', {
                  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                })}
                variant={dueInfo.overdue ? 'danger' : 'brand'}
              >
                <span className="inline-flex">
                  <Tag
                    variant={dueInfo.variant}
                    size="sm"
                    leftIcon={<Calendar size={11} />}
                  >
                    {dueInfo.label}
                  </Tag>
                </span>
              </Tooltip>
            )}
          </div>

          {/* Lead lié — click ouvre LeadPanel par-dessus */}
          {task.lead_id && (
            <div className="text-xs flex items-center gap-1.5">
              <span className="text-[var(--text-muted)]">{t('panels.task_linked_lead')}</span>
              <LeadLink
                leadId={task.lead_id}
                className="text-[var(--primary)] hover:underline font-medium"
              >
                {(task as Task & { lead_name?: string }).lead_name || t('panels.task_see_lead')}
              </LeadLink>
            </div>
          )}

          {/* ── Description ────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                {t('panels.task_description')}
              </span>
              {!isEditingDesc && (
                <button
                  onClick={() => setIsEditingDesc(true)}
                  className="text-[10px] text-[var(--primary)] hover:underline cursor-pointer font-semibold"
                >
                  {t('panels.task_edit')}
                </button>
              )}
            </div>
            {isEditingDesc ? (
              <div className="space-y-2">
                <div className="relative">
                  <Textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    rows={4}
                    resize="vertical"
                    className="pr-10"
                    placeholder={t('panels.task_desc_ph')}
                  />
                  <AiSparkles
                    value={editDesc}
                    onChange={setEditDesc}
                    className="absolute bottom-2 right-2 z-10"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="premium" onClick={() => void saveDescription()}>
                    {t('panels.task_save')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsEditingDesc(false);
                      setEditDesc(task.description || '');
                    }}
                  >
                    {t('panels.task_cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <p
                className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap min-h-[60px] p-3 rounded-[var(--radius-md)] cursor-text"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(0,157,219,0.04) 0%, rgba(217,110,39,0.025) 100%)',
                  border: '1px solid rgba(0,157,219,0.10)',
                }}
                onClick={() => setIsEditingDesc(true)}
              >
                {task.description || (
                  <span className="italic text-[var(--text-muted)]">
                    {t('panels.task_no_desc')}
                  </span>
                )}
              </p>
            )}
          </div>

          {/* ── Subtasks ──────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                <CheckSquare size={11} />
                {t('panels.task_subtasks')}
                <span className="text-[var(--text-muted)] font-normal">
                  ({subtaskDone}/{subtaskTotal})
                </span>
              </h4>
              {subtaskTotal > 0 && (
                <div
                  className="h-1 w-20 rounded-full overflow-hidden"
                  style={{ background: 'rgba(0,157,219,0.10)' }}
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(subtaskDone / subtaskTotal) * 100}%`,
                      background: 'linear-gradient(90deg, #635BFF 0%, #8B5CF6 100%)',
                      boxShadow: '0 0 8px rgba(0,157,219,0.5)',
                    }}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5 mb-2">
              {subtasks.map((s, idx) => {
                const isHighlighted = highlightedSubtaskId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`row-premium list-item-enter flex items-center gap-2.5 p-2 rounded-[var(--radius-sm)] group ${isHighlighted ? 'list-item-highlight' : ''}`}
                    style={{
                      animationDelay: `${Math.min(idx, 12) * 40}ms`,
                      background:
                        'linear-gradient(135deg, rgba(0,157,219,0.04) 0%, rgba(217,110,39,0.02) 100%)',
                      border: '1px solid rgba(0,157,219,0.10)',
                    }}
                  >
                    {/* Custom premium checkbox */}
                    <button
                      onClick={() => void toggleSubtask(s)}
                      aria-label={s.is_done === 1 ? t('panels.task_subtask_undone_aria') : t('panels.task_subtask_done_aria')}
                      className="w-[18px] h-[18px] rounded-[6px] shrink-0 cursor-pointer relative inline-flex items-center justify-center transition-all duration-200"
                      style={
                        s.is_done === 1
                          ? {
                              background:
                                'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
                              border: '1px solid rgba(0,157,219,0.55)',
                              color: '#FFFFFF',
                              boxShadow:
                                '0 2px 8px -2px rgba(0,157,219,0.40), 0 0 12px -4px rgba(217,110,39,0.30), inset 0 1px 0 rgba(255,255,255,0.30)',
                            }
                          : {
                              background:
                                'linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-subtle) 100%)',
                              border: '1px solid var(--border-default)',
                              boxShadow:
                                '0 1px 2px rgba(15,23,42,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
                            }
                      }
                    >
                      {s.is_done === 1 && (
                        <Check
                          size={11}
                          strokeWidth={3.5}
                          style={{
                            animation:
                              'avatar-entrance 200ms cubic-bezier(0.4,0,0.2,1) both',
                          }}
                        />
                      )}
                    </button>

                    <span
                      className={`text-xs flex-1 transition-all duration-200 ${
                        s.is_done === 1
                          ? 'line-through text-[var(--text-muted)]'
                          : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {s.title}
                    </span>

                    <button
                      onClick={() => void removeSubtask(s.id)}
                      className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer transition-all p-1 -mr-1"
                      aria-label={t('panels.task_subtask_del_aria')}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Ajouter sous-tâche */}
            <div className="flex gap-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addSubtask(); }}
                placeholder={t('panels.task_subtask_ph')}
                className="flex-1 px-3 py-1.5 text-xs rounded-[10px] bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all hover:border-[oklch(0.85_0.02_220)] focus:border-[var(--primary)] focus:outline-none focus:shadow-[0_0_0_4px_rgba(0,157,219,0.15),0_0_20px_-4px_rgba(0,157,219,0.35)]"
              />
              <button
                type="button"
                onClick={() => void addSubtask()}
                disabled={!newSubtask.trim()}
                className="action-chip disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                aria-label={t('panels.task_subtask_add_aria')}
              >
                <span className="action-chip-icon">
                  <Plus size={12} />
                </span>
                <span>{t('panels.task_add')}</span>
              </button>
            </div>
          </div>

          {/* ── Comments ─────────────────────────────────────────────── */}
          <div>
            <h4 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <MessageSquare size={11} />
              {t('panels.task_comments')}
              <span className="text-[var(--text-muted)] font-normal">
                ({comments.length})
              </span>
            </h4>

            <div className="space-y-2 mb-3 max-h-64 overflow-y-auto modal-scroll pr-1">
              {comments.length === 0 ? (
                <div className="text-center py-4">
                  <MessageSquare
                    size={20}
                    className="mx-auto mb-1.5 opacity-30 text-[var(--text-muted)]"
                  />
                  <p className="text-[11px] text-[var(--text-muted)] italic">
                    {t('panels.task_no_comments')}
                  </p>
                </div>
              ) : (
                comments.map((c, idx) => {
                  const isHighlighted = highlightedCommentId === c.id;
                  const author = c.user_id || t('panels.task_author_system');
                  return (
                    <div
                      key={c.id}
                      className={`row-premium list-item-enter relative flex items-start gap-2.5 p-2.5 rounded-[var(--radius-md)] group ${isHighlighted ? 'list-item-highlight' : ''}`}
                      style={{
                        animationDelay: `${Math.min(idx, 10) * 50}ms`,
                        background:
                          'linear-gradient(135deg, rgba(0,157,219,0.04) 0%, rgba(217,110,39,0.02) 100%)',
                        border: '1px solid rgba(0,157,219,0.10)',
                      }}
                    >
                      <Avatar
                        name={author}
                        size="xs"
                        status={isHighlighted ? 'online' : 'offline'}
                        animate={isHighlighted}
                        tooltip={author}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-[11px] font-semibold text-[var(--text-primary)] truncate">
                            {author}
                          </span>
                          <Tooltip
                            content={new Date(c.created_at).toLocaleString('fr-CA')}
                            delay={300}
                          >
                            <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-0.5 shrink-0">
                              <Clock size={9} />
                              {timeAgo(c.created_at)}
                            </span>
                          </Tooltip>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                          {c.body}
                        </p>
                      </div>
                      <button
                        onClick={() => void removeComment(c.id)}
                        className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer transition-all p-1 -mt-0.5 -mr-0.5 shrink-0"
                        aria-label={t('panels.task_comment_del_aria')}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Nouveau commentaire — Textarea premium */}
            <div className="relative">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={t('panels.task_comment_ph')}
                rows={2}
                resize="vertical"
                maxLength={1000}
                showCounter
                className="pr-10 text-xs min-h-[64px]"
              />
              <AiSparkles
                value={newComment}
                onChange={setNewComment}
                className="absolute bottom-2 right-2 z-10"
              />
            </div>
            <div className="flex justify-end mt-2">
              <Button
                size="sm"
                variant="premium"
                onClick={() => void addComment()}
                disabled={!newComment.trim()}
                leftIcon={<Plus size={11} />}
              >
                {t('panels.task_comment_btn')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SlidePanel>
  );
}
