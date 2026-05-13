// ── TaskPanel — Slide-over pour éditer une tâche ────────────────────────────
// Différenciateur : depuis LeadPanel, cliquer une tâche → TaskPanel s'ouvre en stack
// au-dessus. Stack jusqu'à 3 panels (Lead → Task → Conv si on a un onClick).

import { useState, useEffect, useCallback } from 'react';
import { SlidePanel, usePanelStack, Skeleton, Button, useToast, AiSparkles } from '@/components/ui';
import { getTask, updateTask, deleteTask, getSubtasks, createSubtask, updateSubtask, deleteSubtask, getTaskComments, createTaskComment, deleteTaskComment } from '@/lib/api';
import { type Task, type Subtask, type TaskComment, type TaskPriority, type TaskStatus,
  TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, TASK_PRIORITY_ICONS,
  TASK_STATUS_LABELS, TASK_STATUS_ICONS,
} from '@/lib/types';
import { Check, Trash2, Plus, MessageSquare, Calendar, AlertTriangle } from 'lucide-react';
import { LeadLink } from './LeadLink';

interface TaskPanelProps {
  id: string;
  stackLevel: number;
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

  // Optimistic mutations
  const changeStatus = async (status: TaskStatus) => {
    if (!task) return;
    const prev = task;
    setTask({ ...task, status });
    const res = await updateTask(id, { status });
    if (res.error) { setTask(prev); toastError(`Erreur : ${res.error}`); }
  };

  const changePriority = async (priority: TaskPriority) => {
    if (!task) return;
    const prev = task;
    setTask({ ...task, priority });
    const res = await updateTask(id, { priority });
    if (res.error) { setTask(prev); toastError(`Erreur : ${res.error}`); }
  };

  const saveDescription = async () => {
    if (!task || editDesc === (task.description || '')) { setIsEditingDesc(false); return; }
    const prev = task;
    setTask({ ...task, description: editDesc });
    setIsEditingDesc(false);
    const res = await updateTask(id, { description: editDesc });
    if (res.error) { setTask(prev); toastError(`Erreur : ${res.error}`); }
  };

  const toggleSubtask = async (s: Subtask) => {
    const nextDone = s.is_done === 1 ? 0 : 1;
    setSubtasks(prev => prev.map(p => p.id === s.id ? { ...p, is_done: nextDone } : p));
    const res = await updateSubtask(s.id, nextDone === 1);
    if (res.error) {
      setSubtasks(prev => prev.map(p => p.id === s.id ? s : p));
      toastError(`Erreur : ${res.error}`);
    }
  };

  const addSubtask = async () => {
    if (!newSubtask.trim()) return;
    const body = newSubtask.trim();
    setNewSubtask('');
    const res = await createSubtask(id, body);
    if (res.data?.id) {
      const r = await getSubtasks(id);
      if (r.data) setSubtasks(r.data);
    } else {
      toastError(`Erreur création sous-tâche : ${res.error || 'inconnue'}`);
    }
  };

  const removeSubtask = async (subtaskId: string) => {
    const prev = subtasks;
    setSubtasks(prev.filter(s => s.id !== subtaskId));
    const res = await deleteSubtask(subtaskId);
    if (res.error) { setSubtasks(prev); toastError(`Erreur : ${res.error}`); }
  };

  const addComment = async () => {
    if (!newComment.trim()) return;
    const body = newComment.trim();
    setNewComment('');
    const res = await createTaskComment(id, body);
    if (res.data?.id) {
      const r = await getTaskComments(id);
      if (r.data) setComments(r.data);
    } else {
      toastError(`Erreur ajout commentaire : ${res.error || 'inconnue'}`);
    }
  };

  const removeComment = async (commentId: string) => {
    const prev = comments;
    setComments(prev.filter(c => c.id !== commentId));
    const res = await deleteTaskComment(commentId);
    if (res.error) { setComments(prev); toastError(`Erreur : ${res.error}`); }
  };

  const handleDeleteTask = async () => {
    if (!task) return;
    const res = await deleteTask(id);
    if (res.error) { toastError(`Erreur : ${res.error}`); return; }
    success('Tâche supprimée');
    closeTopPanel();
  };

  return (
    <SlidePanel
      open={true}
      onOpenChange={(o) => { if (!o) closeTopPanel(); }}
      title={task?.title || 'Tâche'}
      size="md"
      stackLevel={stackLevel}
      headerActions={
        task ? (
          <button onClick={() => void handleDeleteTask()} className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors cursor-pointer" title="Supprimer">
            <Trash2 size={14} />
          </button>
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
          <AlertTriangle size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Tâche introuvable.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Status + Priority pills */}
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Statut</span>
              {(['todo', 'in_progress', 'done'] as TaskStatus[]).map(s => (
                <button key={s} onClick={() => void changeStatus(s)}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded-full transition-all cursor-pointer ${
                    task.status === s ? 'bg-[var(--brand-primary)] text-white' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]'
                  }`}>
                  {TASK_STATUS_ICONS[s]} {TASK_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Priorité</span>
            {(['low', 'medium', 'high'] as TaskPriority[]).map(p => (
              <button key={p} onClick={() => void changePriority(p)}
                className={`px-2 py-0.5 text-[10px] font-medium rounded-full transition-all cursor-pointer ${
                  task.priority === p ? 'text-white' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]'
                }`}
                style={task.priority === p ? { background: TASK_PRIORITY_COLORS[p] } : undefined}>
                {TASK_PRIORITY_ICONS[p]} {TASK_PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Due date */}
          {task.due_date && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <Calendar size={12} />
              <span>Échéance : {new Date(task.due_date).toLocaleDateString('fr-CA')}</span>
            </div>
          )}

          {/* Lead lié — click ouvre LeadPanel par-dessus ! */}
          {task.lead_id && (
            <div className="text-xs">
              <span className="text-[var(--text-muted)]">Lead lié : </span>
              <LeadLink leadId={task.lead_id} className="text-[var(--brand-primary)] hover:underline font-medium">
                {(task as Task & { lead_name?: string }).lead_name || 'Voir lead'}
              </LeadLink>
            </div>
          )}

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Description</span>
              {!isEditingDesc && (
                <button onClick={() => setIsEditingDesc(true)} className="text-[10px] text-[var(--brand-primary)] hover:underline cursor-pointer">Modifier</button>
              )}
            </div>
            {isEditingDesc ? (
              <div className="space-y-2">
                <div className="relative">
                  <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={4}
                    className="w-full px-3 py-2 pr-10 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] resize-none focus:border-[var(--brand-primary)] focus:outline-none" />
                  <AiSparkles value={editDesc} onChange={setEditDesc} className="absolute bottom-2 right-2" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void saveDescription()}>Sauvegarder</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setIsEditingDesc(false); setEditDesc(task.description || ''); }}>Annuler</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap min-h-[60px] p-3 rounded-[var(--radius-md)] bg-[var(--bg-subtle)]">
                {task.description || <span className="italic text-[var(--text-muted)]">Aucune description</span>}
              </p>
            )}
          </div>

          {/* Subtasks */}
          <div>
            <h4 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Sous-tâches ({subtasks.filter(s => s.is_done === 1).length}/{subtasks.length})
            </h4>
            <div className="space-y-1.5 mb-2">
              {subtasks.map(s => (
                <div key={s.id} className="flex items-center gap-2 p-2 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] group">
                  <button onClick={() => void toggleSubtask(s)} className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                    s.is_done === 1 ? 'bg-[var(--success)] border-[var(--success)] text-white' : 'border-[var(--border-default)] hover:border-[var(--brand-primary)]'
                  }`}>
                    {s.is_done === 1 && <Check size={10} />}
                  </button>
                  <span className={`text-xs flex-1 ${s.is_done === 1 ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>{s.title}</span>
                  <button onClick={() => void removeSubtask(s.id)} className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer transition-opacity">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newSubtask}
                onChange={e => setNewSubtask(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void addSubtask(); }}
                placeholder="Nouvelle sous-tâche..."
                className="flex-1 px-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] focus:border-[var(--brand-primary)] focus:outline-none"
              />
              <Button size="sm" variant="secondary" onClick={() => void addSubtask()} disabled={!newSubtask.trim()} leftIcon={<Plus size={11} />}>
                Ajouter
              </Button>
            </div>
          </div>

          {/* Comments */}
          <div>
            <h4 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1">
              <MessageSquare size={11} /> Commentaires ({comments.length})
            </h4>
            <div className="space-y-2 mb-2 max-h-48 overflow-y-auto">
              {comments.length === 0 ? (
                <p className="text-[11px] text-[var(--text-muted)] italic">Aucun commentaire.</p>
              ) : comments.map(c => (
                <div key={c.id} className="p-2 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] group">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {c.user_id || 'Système'} · {new Date(c.created_at).toLocaleDateString('fr-CA')}
                    </span>
                    <button onClick={() => void removeComment(c.id)} className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer transition-opacity">
                      <Trash2 size={10} />
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
            </div>
            <div className="relative">
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Ajouter un commentaire..."
                rows={2}
                className="w-full px-3 py-2 pr-10 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] resize-none focus:border-[var(--brand-primary)] focus:outline-none"
              />
              <AiSparkles value={newComment} onChange={setNewComment} className="absolute bottom-2 right-2" />
            </div>
            <div className="flex justify-end mt-1.5">
              <Button size="sm" onClick={() => void addComment()} disabled={!newComment.trim()} leftIcon={<Plus size={11} />}>
                Commenter
              </Button>
            </div>
          </div>
        </div>
      )}
    </SlidePanel>
  );
}
