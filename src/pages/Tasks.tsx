import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { t } from '@/lib/i18n';
import { Card, Button, Badge, EmptyState, Skeleton, PageHero } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { 
  getTasks, createTask, updateTask, deleteTask,
  getSubtasks, createSubtask, updateSubtask, deleteSubtask,
  getTaskComments, createTaskComment, deleteTaskComment,
  getTaskTemplates, applyTaskTemplate
} from '@/lib/api';
import {
  type Task, type TaskPriority, type TaskStatus, type Subtask, type TaskComment, type TaskTemplate,
  TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, TASK_PRIORITY_ICONS,
  TASK_STATUS_LABELS, TASK_STATUS_ICONS,
} from '@/lib/types';
import { ListTodo, AlertTriangle, CalendarDays, CheckCircle2, Plus, Trash2, LayoutList, Kanban, MessageSquare, Repeat, Copy, X } from 'lucide-react';
import { SwipeAction } from '@/components/ui/SwipeAction';
import { useLongPress } from '@/hooks/useLongPress';

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [filter, setFilter] = useState<'all' | TaskStatus>(() => (localStorage.getItem('intralys_tasks_filter') as 'all' | TaskStatus) || 'all');
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState<Task | null>(null);

  // Detail Modal State
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  
  // Form State
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newDueDate, setNewDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [newRecurring, setNewRecurring] = useState('none');
  const [newReminder, setNewReminder] = useState(0);

  const [viewMode, setViewMode] = useState<'list' | 'kanban'>(() => (localStorage.getItem('intralys_tasks_viewmode') as 'list' | 'kanban') || 'list');
  const [sortBy, setSortBy] = useState<'priority' | 'due_date' | 'status'>(() => (localStorage.getItem('intralys_tasks_sortby') as 'priority' | 'due_date' | 'status') || 'due_date');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => { localStorage.setItem('intralys_tasks_filter', filter); }, [filter]);
  useEffect(() => { localStorage.setItem('intralys_tasks_viewmode', viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem('intralys_tasks_sortby', sortBy); }, [sortBy]);

  useEffect(() => { load(); loadTemplates(); }, []);

  const load = () => {
    setIsLoading(true);
    getTasks()
      .then(res => { if (res.data) setTasks(res.data); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  };
  const loadTemplates = () => { getTaskTemplates().then(res => { if (res.data) setTemplates(res.data); }).catch(() => {}); };

  const loadTaskDetails = async (task: Task) => {
    setSubtasks([]); setComments([]);
    const [stRes, cRes] = await Promise.all([getSubtasks(task.id), getTaskComments(task.id)]);
    if (stRes.data) setSubtasks(stRes.data);
    if (cRes.data) setComments(cRes.data);
  };

  const openDetail = (task: Task) => {
    setShowDetailModal(task);
    void loadTaskDetails(task);
  };

  const sortedTasks = [...(filter === 'all' ? tasks : tasks.filter(t => t.status === filter))].sort((a, b) => {
    if (sortBy === 'priority') { const p = { high: 0, medium: 1, low: 2 }; return p[a.priority] - p[b.priority]; }
    if (sortBy === 'due_date') return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    return 0;
  });
  const filteredTasks = sortedTasks;
  const overdueTasks = tasks.filter(t => t.status !== 'done' && new Date(t.due_date) < new Date());
  const todayTasks = tasks.filter(t => t.status !== 'done' && new Date(t.due_date).toDateString() === new Date().toDateString());
  const doneTasks = tasks.filter(t => t.status === 'done');

  const toggleStatus = (task: Task) => {
    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : task.status === 'todo' ? 'in_progress' : 'done';
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    void updateTask(task.id, { status: newStatus });
    if (showDetailModal?.id === task.id) setShowDetailModal(prev => prev ? { ...prev, status: newStatus } : null);
  };

  const handleCreateTask = async () => {
    if (!newTitle.trim()) return;
    const task: Partial<Task> = {
      title: newTitle, description: newDesc, due_date: new Date(newDueDate).toISOString(),
      priority: newPriority, status: 'todo', assigned_to: 'Rochdi',
      recurring_rule: newRecurring !== 'none' ? `FREQ=${newRecurring.toUpperCase()}` : null,
      reminder_minutes_before: newReminder > 0 ? newReminder : null
    };
    await createTask(task);
    setNewTitle(''); setNewDesc(''); setNewRecurring('none'); setNewReminder(0);
    setShowAddModal(false);
    load();
  };

  const handleApplyTemplate = async (templateId: string) => {
    await applyTaskTemplate(templateId);
    setShowAddModal(false);
    load();
  };

  const handleDelete = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    void deleteTask(id);
    if (showDetailModal?.id === id) setShowDetailModal(null);
  };

  // Subtasks & Comments Handlers
  const handleAddSubtask = async () => {
    if (!newSubtask.trim() || !showDetailModal) return;
    const res = await createSubtask(showDetailModal.id, newSubtask);
    if (res.data) {
      setSubtasks(prev => [...prev, { id: res.data!.id, task_id: showDetailModal.id, title: newSubtask, is_done: 0, sort_order: 0, created_at: new Date().toISOString() }]);
      setNewSubtask('');
    }
  };
  const handleToggleSubtask = async (st: Subtask) => {
    setSubtasks(prev => prev.map(s => s.id === st.id ? { ...s, is_done: s.is_done ? 0 : 1 } : s));
    await updateSubtask(st.id, !st.is_done);
  };
  const handleDeleteSubtask = async (id: string) => {
    setSubtasks(prev => prev.filter(s => s.id !== id));
    await deleteSubtask(id);
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !showDetailModal) return;
    const res = await createTaskComment(showDetailModal.id, newComment);
    if (res.data) {
      setComments(prev => [{ id: res.data!.id, task_id: showDetailModal.id, user_id: 'me', body: newComment, created_at: new Date().toISOString() }, ...prev]);
      setNewComment('');
    }
  };
  const handleDeleteComment = async (id: string) => {
    setComments(prev => prev.filter(c => c.id !== id));
    await deleteTaskComment(id);
  };

  const formatDueDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const diffDays = Math.ceil((date.getTime() - new Date().getTime()) / 86400000);
    if (diffDays < -1) return t('tasks.date.ago', { days: Math.abs(diffDays) });
    if (diffDays === -1) return t('tasks.date.yesterday');
    if (diffDays === 0) return t('tasks.date.today');
    if (diffDays === 1) return t('tasks.date.tomorrow');
    return t('tasks.date.in_days', { days: diffDays });
  };
  const isOverdue = (task: Task) => task.status !== 'done' && new Date(task.due_date) < new Date();

  return (
    <AppLayout title={t('tasks.page.title')}>
      <PageHero
        meta={t('tasks.page.meta')}
        title={t('tasks.page.title')}
        highlight={t('tasks.page.title')}
        description={t('tasks.page.description')}
        actions={<Button variant="premium" leftIcon={<Plus size={14} />} onClick={() => setShowAddModal(true)}>{t('tasks.action.new')}</Button>}
      />

      {/* KPIs Sprint 23 — mini hero cards */}
      <div className="flex flex-wrap items-stretch gap-2 mb-5">
        {[
          { icon: ListTodo, v: tasks.length, l: t('tasks.kpi.total'), c: '#009DDB', from: '#FFFFFF', to: '#F0FAFE', accent: '#009DDB', dark: '#0086C0' },
          { icon: AlertTriangle, v: overdueTasks.length, l: t('tasks.kpi.overdue'), c: '#E93D3D', from: '#FFFFFF', to: '#FEF7F7', accent: '#E93D3D', dark: '#c92424' },
          { icon: CalendarDays, v: todayTasks.length, l: t('tasks.kpi.today'), c: '#FF9A00', from: '#FFFFFF', to: '#FFFBF5', accent: '#FF9A00', dark: '#D96E27' },
          { icon: CheckCircle2, v: doneTasks.length, l: t('tasks.kpi.done'), c: '#37CA37', from: '#FFFFFF', to: '#F5FBF5', accent: '#37CA37', dark: '#2ba62b' },
        ].map(s => (
          <div key={s.l} className="relative overflow-hidden flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl transition-all hover:scale-[1.02] cursor-default"
            style={{
              background: `linear-gradient(135deg, ${s.from} 0%, ${s.to} 100%)`,
              border: `1px solid ${s.accent}40`,
              boxShadow: `0 1px 2px ${s.accent}10, 0 6px 16px -8px ${s.accent}40`,
            }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `linear-gradient(135deg, ${s.accent} 0%, ${s.dark} 100%)`, boxShadow: `0 2px 8px ${s.accent}60` }}>
              <s.icon size={16} className="text-white" />
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">{s.l}</p>
              <p className="text-lg font-bold tabular-nums leading-tight" style={{ color: s.c }}>{s.v}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {(['all', 'todo', 'in_progress', 'done'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-[11px] rounded-lg font-medium transition-all ${filter === f ? 'bg-[var(--brand-primary)] text-white shadow-sm' : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--brand-primary)]'}`}>
              {f === 'all' ? t('tasks.filter.all') : TASK_STATUS_LABELS[f]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5">
            {(['due_date', 'priority', 'status'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)} className={`px-2 py-1 text-[10px] rounded-md font-medium transition-all ${sortBy === s ? 'bg-[var(--brand-tint)] text-[var(--brand-primary)]' : 'text-[var(--text-muted)]'}`}>
                {s === 'due_date' ? t('tasks.sort.date') : s === 'priority' ? t('tasks.sort.priority') : t('tasks.sort.status')}
              </button>
            ))}
          </div>
          <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5">
            <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)]'}`}><LayoutList size={14} /></button>
            <button onClick={() => setViewMode('kanban')} className={`p-1.5 rounded-md transition-all ${viewMode === 'kanban' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)]'}`}><Kanban size={14} /></button>
          </div>
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowAddModal(true)}>{t('tasks.action.add_short')}</Button>
        </div>
      </div>

      {/* Kanban / Liste */}
      {isLoading ? (
        viewMode === 'kanban' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0, 1, 2].map(i => (
              <div key={i} className="bg-[var(--bg-surface)] rounded-[var(--radius-lg)] p-3 space-y-2">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        )
      ) : viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['todo', 'in_progress', 'done'] as const).map(status => (
            <div key={status} className="bg-[var(--bg-surface)] rounded-[var(--radius-lg)] p-3">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="text-sm">{TASK_STATUS_ICONS[status]}</span>
                <h3 className="text-xs font-bold uppercase tracking-wider">{TASK_STATUS_LABELS[status]}</h3>
                <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-subtle)] px-1.5 py-0.5 rounded-full ml-auto">{tasks.filter(t => t.status === status).length}</span>
              </div>
              <div className="space-y-2">
                {tasks.filter(t => t.status === status).map(task => {
                  const longPressProps = useLongPress(() => openDetail(task), undefined, { delay: 600 });
                  return (
                  <SwipeAction 
                    key={task.id}
                    rightActions={
                      <div className="flex gap-2 justify-end w-full pr-2">
                        <button className="w-10 h-10 bg-[var(--danger)] text-white rounded-[var(--radius-lg)] flex items-center justify-center shadow-sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(task.id); }}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    }
                    rightThreshold={60}
                  >
                    <div {...longPressProps}>
                      <Card className={`p-3 cursor-pointer hover:border-[var(--brand-primary)] transition-colors ${task.status === 'done' ? 'opacity-50' : ''} relative z-10`} onClick={() => openDetail(task)}>
                        <div className="flex items-start gap-2 mb-1">
                          <button onClick={(e) => { e.stopPropagation(); toggleStatus(task); }} className="mt-0.5 text-sm shrink-0">{TASK_STATUS_ICONS[task.status]}</button>
                          <p className={`text-xs font-medium ${task.status === 'done' ? 'line-through text-[var(--text-muted)]' : ''}`}>{task.title}</p>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] pl-6">
                          <span className={isOverdue(task) ? 'text-[var(--danger)] font-semibold' : ''}>{formatDueDate(task.due_date)} {isOverdue(task) && '⚠️'}</span>
                        </div>
                        <div className="pl-6 pt-1 flex gap-1">
                          <Badge color={TASK_PRIORITY_COLORS[task.priority]} className="text-[9px]">{TASK_PRIORITY_ICONS[task.priority]} {TASK_PRIORITY_LABELS[task.priority]}</Badge>
                          {task.recurring_rule && <Badge color="var(--info)" className="text-[9px]"><Repeat size={10} className="mr-0.5"/> {t('tasks.badge.recurring')}</Badge>}
                        </div>
                      </Card>
                    </div>
                  </SwipeAction>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.length === 0 ? (
            <EmptyState icon={<ListTodo size={40}/>} title={t('tasks.empty.title')} description={t('tasks.empty.description')} />
          ) : (
            filteredTasks.map(task => {
              const longPressProps = useLongPress(() => openDetail(task), undefined, { delay: 600 });
              return (
              <SwipeAction 
                key={task.id}
                rightActions={
                  <div className="flex gap-2 justify-end w-full pr-2">
                    <button className="w-12 h-12 bg-[var(--success)] text-white rounded-[var(--radius-lg)] flex items-center justify-center shadow-sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleStatus(task); }}>
                      <CheckCircle2 size={20} />
                    </button>
                    <button className="w-12 h-12 bg-[var(--danger)] text-white rounded-[var(--radius-lg)] flex items-center justify-center shadow-sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(task.id); }}>
                      <Trash2 size={20} />
                    </button>
                  </div>
                }
                rightThreshold={110}
              >
                <div {...longPressProps}>
                  <Card className={`p-4 flex items-start gap-3 cursor-pointer hover:border-[var(--brand-primary)] transition-all ${task.status === 'done' ? 'opacity-50' : ''} relative z-10`} onClick={() => openDetail(task)}>
                    <button onClick={(e) => { e.stopPropagation(); toggleStatus(task); }} className="mt-0.5 text-lg shrink-0" title={TASK_STATUS_LABELS[task.status]}>{TASK_STATUS_ICONS[task.status]}</button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-[var(--text-muted)]' : ''}`}>{task.title}</p>
                        <Badge color={TASK_PRIORITY_COLORS[task.priority]} className="text-[10px]">{TASK_PRIORITY_ICONS[task.priority]} {TASK_PRIORITY_LABELS[task.priority]}</Badge>
                        {task.recurring_rule && <Badge color="var(--info)" className="text-[10px]"><Repeat size={10} className="mr-1"/> {t('tasks.badge.recurring_full')}</Badge>}
                      </div>
                      {task.description && <p className="text-xs text-[var(--text-muted)] mb-1 truncate">{task.description}</p>}
                      <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                        {task.lead_name && <span className="flex items-center gap-1">👤 {task.lead_name}</span>}
                        <span className={`flex items-center gap-1 ${isOverdue(task) ? 'text-[var(--danger)] font-semibold' : ''}`}>📅 {formatDueDate(task.due_date)} {isOverdue(task) && '⚠️'}</span>
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all shrink-0"><Trash2 size={14} /></button>
                  </Card>
                </div>
              </SwipeAction>
              );
            })
          )}
        </div>
      )}

      {/* Modal Ajout Tâche */}
      <Modal open={showAddModal} onOpenChange={() => setShowAddModal(false)} title={t('tasks.modal.title')}>
        <div className="space-y-4">
          {templates.length > 0 && (
            <div className="bg-[var(--bg-subtle)] p-3 rounded-lg flex items-center justify-between">
              <div className="text-xs font-medium text-[var(--text-secondary)]"><Copy size={14} className="inline mr-1" /> {t('tasks.modal.templates')}</div>
              <select className="px-2 py-1 text-xs border rounded bg-white" onChange={e => { if(e.target.value) handleApplyTemplate(e.target.value); }}>
                <option value="">{t('tasks.modal.apply_template')}</option>
                {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
              </select>
            </div>
          )}
          
          <div>
            <label className="text-xs font-medium mb-1 block">{t('tasks.modal.title_label')}</label>
            <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder={t('tasks.modal.title_placeholder')} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t('tasks.modal.desc_label')}</label>
            <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm resize-none" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">{t('tasks.modal.priority_label')}</label>
              <select value={newPriority} onChange={e => setNewPriority(e.target.value as TaskPriority)} className="w-full px-3 py-2 rounded-lg border text-sm">
                <option value="high">{t('tasks.modal.priority_high')}</option><option value="medium">{t('tasks.modal.priority_medium')}</option><option value="low">{t('tasks.modal.priority_low')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">{t('tasks.modal.due_label')}</label>
              <Input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">{t('tasks.modal.recurrence_label')}</label>
              <select value={newRecurring} onChange={e => setNewRecurring(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm">
                <option value="none">{t('tasks.modal.recurrence_none')}</option><option value="daily">{t('tasks.modal.recurrence_daily')}</option><option value="weekly">{t('tasks.modal.recurrence_weekly')}</option><option value="monthly">{t('tasks.modal.recurrence_monthly')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">{t('tasks.modal.reminder_label')}</label>
              <Input type="number" value={newReminder} onChange={e => setNewReminder(Number(e.target.value))} />
            </div>
          </div>
          <div className="flex justify-end pt-2 gap-2">
            <Button variant="ghost" onClick={() => setShowAddModal(false)}>{t('tasks.modal.cancel')}</Button>
            <Button onClick={handleCreateTask} disabled={!newTitle}>{t('tasks.modal.create')}</Button>
          </div>
        </div>
      </Modal>

      {/* Modal Détails Tâche (Subtasks & Comments) */}
      {showDetailModal && (
        <Modal open={!!showDetailModal} onOpenChange={() => setShowDetailModal(null)} title={t('tasks.detail.title')}>
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className={`text-lg font-bold ${showDetailModal.status === 'done' ? 'line-through text-[var(--text-muted)]' : ''}`}>{showDetailModal.title}</h2>
              <button onClick={() => toggleStatus(showDetailModal)} className="text-2xl cursor-pointer hover:scale-110 transition-transform">{TASK_STATUS_ICONS[showDetailModal.status]}</button>
            </div>
            <div className="flex gap-2">
              <Badge color={TASK_PRIORITY_COLORS[showDetailModal.priority]}>{TASK_PRIORITY_ICONS[showDetailModal.priority]} {TASK_PRIORITY_LABELS[showDetailModal.priority]}</Badge>
              <Badge color="var(--bg-subtle)" className="text-[var(--text-secondary)]"><CalendarDays size={12} className="mr-1"/> {new Date(showDetailModal.due_date).toLocaleDateString('fr-CA')}</Badge>
            </div>
            {showDetailModal.description && <p className="text-sm bg-[var(--bg-subtle)] p-3 rounded-lg whitespace-pre-wrap">{showDetailModal.description}</p>}

            {/* Subtasks */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2 text-[var(--text-secondary)]">{t('tasks.detail.subtasks')} ({subtasks.filter(s=>s.is_done).length}/{subtasks.length})</h3>
              <div className="space-y-1 mb-2">
                {subtasks.map(st => (
                  <div key={st.id} className="flex items-center gap-2 group p-1 hover:bg-[var(--bg-subtle)] rounded">
                    <button onClick={() => handleToggleSubtask(st)} className="text-[var(--text-secondary)] hover:text-[var(--brand-primary)]">
                      {st.is_done ? <CheckCircle2 size={16} className="text-[var(--success)]" /> : <div className="w-4 h-4 rounded-full border-2 border-[var(--text-muted)]"></div>}
                    </button>
                    <span className={`text-sm flex-1 ${st.is_done ? 'line-through text-[var(--text-muted)]' : ''}`}>{st.title}</span>
                    <button onClick={() => handleDeleteSubtask(st.id)} className="text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-opacity p-1"><X size={14}/></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={newSubtask} onChange={e => setNewSubtask(e.target.value)} onKeyDown={e => { if(e.key==='Enter') handleAddSubtask(); }} placeholder={t('tasks.detail.subtask_placeholder')} className="h-8 text-xs" />
                <Button size="sm" variant="secondary" onClick={handleAddSubtask} disabled={!newSubtask}>{t('tasks.detail.add')}</Button>
              </div>
            </div>

            <hr className="border-[var(--border-subtle)]" />

            {/* Activity / Comments */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-3 text-[var(--text-secondary)] flex items-center gap-1"><MessageSquare size={14} /> {t('tasks.detail.activity')}</h3>
              <div className="space-y-3 mb-3 max-h-48 overflow-y-auto">
                {comments.length === 0 ? <p className="text-xs text-[var(--text-muted)]">{t('tasks.detail.no_comments')}</p> : comments.map(c => (
                  <div key={c.id} className="bg-[var(--bg-subtle)] p-2.5 rounded-lg text-sm relative group">
                    <p className="whitespace-pre-wrap">{c.body}</p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">{new Date(c.created_at).toLocaleString('fr-FR')}</p>
                    <button onClick={() => handleDeleteComment(c.id)} className="absolute top-2 right-2 text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100"><X size={14}/></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <textarea value={newComment} onChange={e => setNewComment(e.target.value)} placeholder={t('tasks.detail.comment_placeholder')} rows={2} className="flex-1 px-3 py-2 border rounded-lg text-xs resize-none" />
                <Button size="sm" variant="secondary" onClick={handleAddComment} disabled={!newComment} className="self-end">{t('tasks.detail.send')}</Button>
              </div>
            </div>
            
            <div className="flex justify-end pt-2">
              <Button variant="ghost" className="text-[var(--danger)] hover:bg-[var(--danger-soft)]" onClick={() => handleDelete(showDetailModal.id)} leftIcon={<Trash2 size={14}/>}>{t('tasks.detail.delete')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </AppLayout>
  );
}