import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Tag, EmptyState, Skeleton, KpiStrip, type KpiItem, SmartBanner, AvatarGroup, BulkActionBar, DropdownMenu, DropdownMenuItem, DropdownMenuLabel, AppliedFiltersBar, type FilterDescriptor, Icon, ContextualActionsSheet, type ContextualAction } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
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
import { ListTodo, AlertTriangle, CalendarDays, CheckCircle2, Plus, Trash2, LayoutList, Kanban, MessageSquare, Repeat, Copy, X, Flag, UserPlus, Table2, Pencil, Clock as ClockIcon, RotateCcw, Eye } from 'lucide-react';
import { SwipeAction } from '@/components/ui/SwipeAction';
import { useLongPress } from '@/hooks/useLongPress';
// Sprint 45 M3.2 — Coachmark contextuel (visite 2 → bulk select hint)
import { ContextualCoachmark } from '@/components/onboarding/ContextualCoachmark';
// Sprint 48 M3 — Intl formatters (plural / date)
import { plural } from '@/lib/i18n/plural';
import { formatDate, formatDateTime } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';

// ── Sprint 31 vague 31-1A — Read URL params (?status=&priority=&assignee=&overdue=true) ──
const VALID_TASK_STATUSES: readonly string[] = ['all', 'todo', 'in_progress', 'done'];
const VALID_TASK_PRIORITIES: readonly string[] = ['high', 'medium', 'low'];
function readTasksUrlState(): {
  status: TaskStatus | 'all' | null;
  priority: TaskPriority | null;
  assignee: string | null;
  overdue: boolean;
} {
  if (typeof window === 'undefined') return { status: null, priority: null, assignee: null, overdue: false };
  const params = new URLSearchParams(window.location.search);
  const rawStatus = params.get('status');
  const rawPriority = params.get('priority');
  return {
    status: rawStatus && VALID_TASK_STATUSES.includes(rawStatus) ? (rawStatus as TaskStatus | 'all') : null,
    priority: rawPriority && VALID_TASK_PRIORITIES.includes(rawPriority) ? (rawPriority as TaskPriority) : null,
    assignee: params.get('assignee'),
    overdue: params.get('overdue') === 'true',
  };
}
// Sprint 25 vague 5A — Hover preview hook (desktop only, 320ms delay)
import { useTaskHoverPreview } from '@/components/panels/TaskHoverPreview';
// Sprint 25 vague 5B — Illustrated empty states
import { EmptyStateIllustration } from '@/components/ui/EmptyStateIllustration';
// Sprint 30 vague 30-3C — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);

  // ── Sprint 31 vague 31-1A — URL params hydratent au mount ──
  const initialTasksUrl = useMemo(() => readTasksUrlState(), []);
  const [filter, setFilter] = useState<'all' | TaskStatus>(() =>
    initialTasksUrl.status ?? (localStorage.getItem('intralys_tasks_filter') as 'all' | TaskStatus) ?? 'all'
  );
  // Sprint 31 vague 31-1A — overdue=true filter (extra synthétique, indépendant du status)
  const [overdueFilter, setOverdueFilter] = useState<boolean>(() => initialTasksUrl.overdue);
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState<Task | null>(null);
  // Sprint 44 M3.2 — Long-press contextual actions sheet (mobile)
  const [sheetTask, setSheetTask] = useState<Task | null>(null);

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

  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'table'>(() => (localStorage.getItem('intralys_tasks_viewmode') as 'list' | 'kanban' | 'table') || 'list');
  const [sortBy, setSortBy] = useState<'priority' | 'due_date' | 'status'>(() => (localStorage.getItem('intralys_tasks_sortby') as 'priority' | 'due_date' | 'status') || 'due_date');
  const [isLoading, setIsLoading] = useState(true);

  // ── Sprint 24 vague 2 — Filtres premium (priority, assignee, status est déjà via segmented)
  // ── Sprint 31 vague 31-1A — URL params override localStorage au mount ──
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>(() =>
    initialTasksUrl.priority ?? (localStorage.getItem('intralys_tasks_filter_priority') as TaskPriority) ?? ''
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>(() =>
    initialTasksUrl.assignee ?? localStorage.getItem('intralys_tasks_filter_assignee') ?? ''
  );

  // ── Sprint 24 vague 1B — Multi-select (Linear/Superhuman pattern)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lastSelectedTaskId, setLastSelectedTaskId] = useState<string | null>(null);
  const [bulkPriorityOpen, setBulkPriorityOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  useEffect(() => { localStorage.setItem('intralys_tasks_filter', filter); }, [filter]);
  useEffect(() => { localStorage.setItem('intralys_tasks_viewmode', viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem('intralys_tasks_sortby', sortBy); }, [sortBy]);
  useEffect(() => { localStorage.setItem('intralys_tasks_filter_priority', priorityFilter); }, [priorityFilter]);
  useEffect(() => { localStorage.setItem('intralys_tasks_filter_assignee', assigneeFilter); }, [assigneeFilter]);

  // ── Sprint 31 vague 31-1A — Persist filters → URL replaceState ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (filter && filter !== 'all') params.set('status', filter); else params.delete('status');
    if (priorityFilter) params.set('priority', priorityFilter); else params.delete('priority');
    if (assigneeFilter) params.set('assignee', assigneeFilter); else params.delete('assignee');
    if (overdueFilter) params.set('overdue', 'true'); else params.delete('overdue');
    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', newUrl);
  }, [filter, priorityFilter, assigneeFilter, overdueFilter]);

  // popstate sync
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      const next = readTasksUrlState();
      setFilter(next.status ?? 'all');
      setPriorityFilter(next.priority ?? '');
      setAssigneeFilter(next.assignee ?? '');
      setOverdueFilter(next.overdue);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // TanStack Router sync (CmdPalette re-nav)
  const routerLocation = useRouterState({ select: (s) => s.location });
  useEffect(() => {
    const next = readTasksUrlState();
    setFilter((prev) => ((next.status ?? 'all') !== prev ? (next.status ?? 'all') : prev));
    setPriorityFilter((prev) => ((next.priority ?? '') !== prev ? (next.priority ?? '') : prev));
    setAssigneeFilter((prev) => ((next.assignee ?? '') !== prev ? (next.assignee ?? '') : prev));
    setOverdueFilter((prev) => (next.overdue !== prev ? next.overdue : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerLocation.search]);

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

  const sortedTasks = [...(filter === 'all' ? tasks : tasks.filter(t => t.status === filter))]
    .filter(t => !priorityFilter || t.priority === priorityFilter)
    .filter(t => !assigneeFilter || (t.assigned_to || '').trim().toLowerCase() === assigneeFilter.toLowerCase())
    // Sprint 31 vague 31-1A — filtre overdue=true (status !== done ET due_date < now)
    .filter(t => !overdueFilter || (t.status !== 'done' && new Date(t.due_date) < new Date()))
    .sort((a, b) => {
      if (sortBy === 'priority') { const p = { high: 0, medium: 1, low: 2 }; return p[a.priority] - p[b.priority]; }
      if (sortBy === 'due_date') return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      return 0;
    });
  const filteredTasks = sortedTasks;

  // ── Sprint 24 vague 2 — Liste des assignees uniques (memo) ───────────────
  const allAssignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const a = (t.assigned_to || '').trim();
      if (a) set.add(a);
    }
    return Array.from(set).sort();
  }, [tasks]);

  // ── Sprint 24 vague 1B — Bulk-select handlers ─────────────────────────────
  const toggleTaskSelect = useCallback((taskId: string, e?: React.MouseEvent) => {
    if (e?.shiftKey && lastSelectedTaskId) {
      // Range select : entre lastSelectedTaskId et taskId dans filteredTasks
      const ids = filteredTasks.map(t => t.id);
      const i1 = ids.indexOf(lastSelectedTaskId);
      const i2 = ids.indexOf(taskId);
      if (i1 >= 0 && i2 >= 0) {
        const [from, to] = i1 < i2 ? [i1, i2] : [i2, i1];
        setSelectedTaskIds(prev => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(ids[i]!);
          return next;
        });
        return;
      }
    }
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
    setLastSelectedTaskId(taskId);
  }, [filteredTasks, lastSelectedTaskId]);

  const clearTaskSelection = useCallback(() => {
    setSelectedTaskIds(new Set());
    setLastSelectedTaskId(null);
  }, []);

  // cmd/ctrl+A : select all filtered tasks, Esc : clear
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedTaskIds(new Set(filteredTasks.map(t => t.id)));
      } else if (e.key === 'Escape' && selectedTaskIds.size > 0) {
        clearTaskSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredTasks, selectedTaskIds.size, clearTaskSelection]);

  const bulkMarkDone = async () => {
    const ids = Array.from(selectedTaskIds);
    setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, status: 'done' as TaskStatus } : t));
    for (const id of ids) await updateTask(id, { status: 'done' });
    clearTaskSelection();
  };

  const bulkSetPriority = async (priority: TaskPriority) => {
    const ids = Array.from(selectedTaskIds);
    setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, priority } : t));
    for (const id of ids) await updateTask(id, { priority });
    setBulkPriorityOpen(false);
    clearTaskSelection();
  };

  const bulkAssign = async (assignee: string) => {
    const ids = Array.from(selectedTaskIds);
    setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, assigned_to: assignee } : t));
    for (const id of ids) await updateTask(id, { assigned_to: assignee });
    setBulkAssignOpen(false);
    clearTaskSelection();
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedTaskIds);
    setTasks(prev => prev.filter(t => !ids.includes(t.id)));
    for (const id of ids) await deleteTask(id);
    clearTaskSelection();
  };
  const overdueTasks = tasks.filter(t => t.status !== 'done' && new Date(t.due_date) < new Date());
  const todayTasks = tasks.filter(t => t.status !== 'done' && new Date(t.due_date).toDateString() === new Date().toDateString());
  const doneTasks = tasks.filter(t => t.status === 'done');

  // ── Sprint 23 wave 44A2 — Assignees uniques par bucket (memo) ─────────────
  const assigneesByStatus = useMemo(() => {
    const map: Record<TaskStatus, { name: string }[]> = { todo: [], in_progress: [], done: [] };
    (['todo', 'in_progress', 'done'] as const).forEach(status => {
      const seen = new Set<string>();
      const list: { name: string }[] = [];
      for (const t of tasks) {
        if (t.status !== status) continue;
        const a = (t.assigned_to || '').trim();
        if (a && !seen.has(a)) {
          seen.add(a);
          list.push({ name: a });
        }
      }
      map[status] = list;
    });
    return map;
  }, [tasks]);

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

  // Sprint 44 M3.2 — Reporter une tâche (long-press → "Reporter +1j / +1sem")
  const rescheduleTask = (task: Task, days: number) => {
    const current = task.due_date ? new Date(task.due_date) : new Date();
    current.setDate(current.getDate() + days);
    const iso = current.toISOString();
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, due_date: iso } : t));
    void updateTask(task.id, { due_date: iso });
  };

  // Sprint 44 M3.2 — Construit la liste d'actions contextuelles pour une tâche.
  // Tap normal sur la card → openDetail (modal classique).
  // Long-press → ContextualActionsSheet (sheet iOS-style avec ces actions).
  const buildTaskActions = useCallback((task: Task): ContextualAction[] => {
    const done = task.status === 'done';
    return [
      {
        id: 'view',
        icon: Eye,
        label: 'Voir le détail',
        description: 'Sous-tâches + commentaires',
        onSelect: () => openDetail(task),
      },
      {
        id: 'complete',
        icon: done ? RotateCcw : CheckCircle2,
        label: done ? 'Rouvrir' : 'Terminer',
        description: done ? 'Repasser à "à faire"' : 'Marquer comme terminée',
        variant: done ? 'default' : 'primary',
        onSelect: () => toggleStatus(task),
      },
      {
        id: 'edit',
        icon: Pencil,
        label: 'Modifier',
        description: 'Titre, priorité, échéance',
        onSelect: () => openDetail(task),
      },
      {
        id: 'reschedule-tomorrow',
        icon: ClockIcon,
        label: 'Reporter à demain',
        description: '+1 jour',
        onSelect: () => rescheduleTask(task, 1),
      },
      {
        id: 'reschedule-week',
        icon: ClockIcon,
        label: 'Reporter d\'une semaine',
        description: '+7 jours',
        onSelect: () => rescheduleTask(task, 7),
      },
      {
        id: 'delete',
        icon: Trash2,
        label: 'Supprimer',
        description: 'Action définitive',
        variant: 'danger',
        onSelect: () => handleDelete(task.id),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDetailModal]);

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
    if (diffDays < -1) return `il y a ${Math.abs(diffDays)}j`;
    if (diffDays === -1) return 'hier';
    if (diffDays === 0) return "aujourd'hui";
    if (diffDays === 1) return 'demain';
    return `dans ${diffDays}j`;
  };
  const isOverdue = (task: Task) => task.status !== 'done' && new Date(task.due_date) < new Date();

  // Sprint 30 vague 30-3C — Pull-to-refresh mobile
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => {
    await new Promise<void>((resolve) => {
      const r = getTasks();
      void r.then(res => { if (res.data) setTasks(res.data); }).catch(() => {}).finally(() => resolve());
    });
  }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title="Tâches">
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <div className="print-page-header">
        <h1>Intralys CRM — Tâches</h1>
        <div className="print-meta">
          {formatDate(new Date(), getLocale(), { day: 'numeric', month: 'long', year: 'numeric' })} · intralys.com
        </div>
      </div>
      {/* ── Header Stripe-clean : titre + count + actions ── */}
      <header className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="t-h1">Tâches</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {plural(getLocale(), tasks.length, { one: '# tâche', other: '# tâches' })}
            {overdueTasks.length > 0 ? ` · ${overdueTasks.length} en retard` : ''}
          </p>
        </div>
        <Button leftIcon={<Icon as={Plus} size={14} />} onClick={() => setShowAddModal(true)}>Nouvelle tâche</Button>
      </header>

      {/* Sprint 23 wave 18 — SmartBanner contextuel */}
      {overdueTasks.length >= 3 && (
        <SmartBanner
          dismissKey="tasks-overdue-tip"
          variant="warning"
          title={`⏰ ${overdueTasks.length} tâches en retard`}
          description="Plus une tâche traîne, plus le risque qu'elle soit oubliée monte. Triez par échéance et liquidez les plus anciennes en premier."
          action={{ label: 'Trier par date', onClick: () => setSortBy('due_date') }}
          secondaryLabel="Ignorer"
        />
      )}
      {overdueTasks.length === 0 && todayTasks.length >= 5 && (
        <SmartBanner
          dismissKey="tasks-busy-day-tip"
          variant="tip"
          title={`📅 Journée chargée — ${todayTasks.length} tâches aujourd'hui`}
          description="Concentrez-vous sur les priorités hautes en premier. Glissez-déposez pour réorganiser si besoin."
          secondaryLabel="OK"
        />
      )}

      {/* KPI Strip — Sprint 23 wave 16 (unified GHL pattern) */}
      <KpiStrip
        items={[
          { label: 'Total', value: tasks.length, color: 'brand', icon: <Icon as={ListTodo} size={11} /> },
          { label: 'En retard', value: overdueTasks.length, color: 'danger', icon: <Icon as={AlertTriangle} size={11} /> },
          { label: "Aujourd'hui", value: todayTasks.length, color: 'warning', icon: <Icon as={CalendarDays} size={11} /> },
          { label: 'Terminées', value: doneTasks.length, color: 'success', icon: <Icon as={CheckCircle2} size={11} /> },
        ] satisfies KpiItem[]}
      />

      {/* Sprint 24 vague 1B — Bulk action bar (multi-select) */}
      {selectedTaskIds.size > 0 && (
        <div className="mb-3 rounded-xl overflow-hidden" style={{ position: 'sticky', top: 8, zIndex: 20 }}>
          <BulkActionBar
            selectedCount={selectedTaskIds.size}
            onClear={clearTaskSelection}
            actions={[
              {
                id: 'done',
                label: 'Marquer terminées',
                icon: <CheckCircle2 size={13} />,
                onClick: () => void bulkMarkDone(),
              },
              {
                id: 'delete',
                label: 'Supprimer',
                icon: <Icon as={Trash2} size={13} />,
                variant: 'danger',
                onClick: () => void bulkDelete(),
              },
            ]}
            extraSlot={
              <>
                <DropdownMenu
                  open={bulkPriorityOpen}
                  onOpenChange={setBulkPriorityOpen}
                  trigger={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors cursor-pointer bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                      aria-label="Changer la priorité"
                    >
                      <Icon as={Flag} size={13} />
                      Priorité
                    </button>
                  }
                >
                  <DropdownMenuLabel>Nouvelle priorité</DropdownMenuLabel>
                  {(['high', 'medium', 'low'] as const).map(p => (
                    <DropdownMenuItem key={p} onSelect={() => void bulkSetPriority(p)}>
                      {TASK_PRIORITY_ICONS[p]} {TASK_PRIORITY_LABELS[p]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
                {allAssignees.length > 0 && (
                  <DropdownMenu
                    open={bulkAssignOpen}
                    onOpenChange={setBulkAssignOpen}
                    trigger={
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors cursor-pointer bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                        aria-label="Assigner à"
                      >
                        <Icon as={UserPlus} size={13} />
                        Assigner à
                      </button>
                    }
                  >
                    <DropdownMenuLabel>Assigner à</DropdownMenuLabel>
                    {allAssignees.map(a => (
                      <DropdownMenuItem key={a} onSelect={() => void bulkAssign(a)}>
                        {a}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenu>
                )}
              </>
            }
          />
        </div>
      )}

      {/* Sprint 24 vague 2 — AppliedFiltersBar premium (chips dismissables) */}
      {/* Sprint 31 vague 31-1A — overdue chip ajouté (CmdPalette / URL ?overdue=true) */}
      <AppliedFiltersBar
        className="mb-3"
        filters={[
          ...(priorityFilter ? [{
            id: 'priority',
            label: 'Priorité',
            value: TASK_PRIORITY_LABELS[priorityFilter],
            onRemove: () => setPriorityFilter(''),
          } as FilterDescriptor] : []),
          ...(assigneeFilter ? [{
            id: 'assignee',
            label: 'Assigné',
            value: assigneeFilter,
            onRemove: () => setAssigneeFilter(''),
          } as FilterDescriptor] : []),
          ...(overdueFilter ? [{
            id: 'overdue',
            label: 'En retard',
            value: 'Oui',
            onRemove: () => setOverdueFilter(false),
          } as FilterDescriptor] : []),
        ]}
        onClearAll={() => { setPriorityFilter(''); setAssigneeFilter(''); setOverdueFilter(false); }}
        leadingSlot={
          <>
            <DropdownMenu
              trigger={
                <button
                  type="button"
                  className={`filter-chip ${priorityFilter ? 'filter-chip--active' : ''}`}
                  aria-label="Filtrer par priorité"
                >
                  <Icon as={Flag} size={11} />
                  <span>Priorité</span>
                  {priorityFilter && (
                    <>
                      <span aria-hidden className="opacity-50 text-[10px]">:</span>
                      <span className="filter-chip__value">{TASK_PRIORITY_LABELS[priorityFilter]}</span>
                    </>
                  )}
                </button>
              }
            >
              <DropdownMenuLabel>Priorité</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setPriorityFilter('')}>Toutes</DropdownMenuItem>
              {(['high', 'medium', 'low'] as const).map(p => (
                <DropdownMenuItem key={p} onSelect={() => setPriorityFilter(p)}>
                  {TASK_PRIORITY_ICONS[p]} {TASK_PRIORITY_LABELS[p]}
                </DropdownMenuItem>
              ))}
            </DropdownMenu>
            {allAssignees.length > 0 && (
              <DropdownMenu
                trigger={
                  <button
                    type="button"
                    className={`filter-chip ${assigneeFilter ? 'filter-chip--active' : ''}`}
                    aria-label="Filtrer par assigné"
                  >
                    <Icon as={UserPlus} size={11} />
                    <span>Assigné</span>
                    {assigneeFilter && (
                      <>
                        <span aria-hidden className="opacity-50 text-[10px]">:</span>
                        <span className="filter-chip__value">{assigneeFilter}</span>
                      </>
                    )}
                  </button>
                }
              >
                <DropdownMenuLabel>Assigné à</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setAssigneeFilter('')}>Tous</DropdownMenuItem>
                {allAssignees.map(a => (
                  <DropdownMenuItem key={a} onSelect={() => setAssigneeFilter(a)}>{a}</DropdownMenuItem>
                ))}
              </DropdownMenu>
            )}
          </>
        }
      />

      {/* Header — Sprint 23 wave 17 : filters/sort/view en segmented-control + action-chip */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        {/* Status filter — segmented */}
        <div className="segmented-control">
          {(['all', 'todo', 'in_progress', 'done'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={filter === f ? 'is-active' : ''}>
              {f === 'all' ? 'Toutes' : TASK_STATUS_LABELS[f]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Sort — segmented compact */}
          <div className="segmented-control">
            {(['due_date', 'priority', 'status'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)} className={sortBy === s ? 'is-active' : ''} style={{ padding: '4px 10px', fontSize: '11px' }}>
                {s === 'due_date' ? 'Date' : s === 'priority' ? 'Priorité' : 'Statut'}
              </button>
            ))}
          </div>
          {/* View toggle — segmented icon — Sprint 27 vague 27-3A : ajout mode table */}
          <div className="segmented-control segmented-control--icon">
            <button onClick={() => setViewMode('list')} className={viewMode === 'list' ? 'is-active' : ''} aria-label="Vue liste" title="Vue liste">
              <Icon as={LayoutList} size="sm" />
            </button>
            <button onClick={() => setViewMode('table')} className={viewMode === 'table' ? 'is-active' : ''} aria-label="Vue table" title="Vue table">
              <Icon as={Table2} size="sm" />
            </button>
            <button onClick={() => setViewMode('kanban')} className={viewMode === 'kanban' ? 'is-active' : ''} aria-label="Vue kanban" title="Vue kanban">
              <Icon as={Kanban} size="sm" />
            </button>
          </div>
          <Button size="sm" leftIcon={<Icon as={Plus} size={14} />} onClick={() => setShowAddModal(true)}>Tâche</Button>
        </div>
      </div>

      {/* Kanban / Liste — skeleton matche la shell réelle (3 buckets kanban OU 8 rows liste) */}
      {isLoading ? (
        viewMode === 'kanban' ? (
          /* Skeleton kanban : 3 buckets + 6-8 cards staggered avec checkbox+title+priority+due chip */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0, 1, 2].map(i => {
              const cardsPerCol = [7, 6, 8][i] ?? 6;
              return (
              <div
                key={i}
                className="bg-[var(--bg-surface)] rounded-[var(--radius-lg)] p-3 space-y-2"
                style={{ border: '1px solid var(--border-subtle)', animationDelay: `${i * 40}ms` }}
              >
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Skeleton className="h-4 w-4 rounded-full" style={{ animationDelay: `${i * 40}ms` }} />
                  <Skeleton className="h-3 w-20" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                  <Skeleton className="h-3 w-6 ml-auto rounded-full" style={{ animationDelay: `${i * 40 + 40}ms` }} />
                </div>
                {Array.from({ length: cardsPerCol }).map((_, k) => (
                  <div
                    key={k}
                    className="p-3 rounded-xl space-y-2"
                    style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', animationDelay: `${(i * cardsPerCol + k) * 40}ms` }}
                  >
                    <div className="flex items-start gap-2">
                      <Skeleton className="h-3.5 w-3.5 rounded shrink-0 mt-0.5" style={{ animationDelay: `${(i * cardsPerCol + k) * 40}ms` }} />
                      <Skeleton className="h-3 flex-1" style={{ animationDelay: `${(i * cardsPerCol + k) * 40 + 20}ms` }} />
                    </div>
                    <div className="flex items-center pl-5">
                      <Skeleton className="h-2.5 w-16" style={{ animationDelay: `${(i * cardsPerCol + k) * 40 + 40}ms` }} />
                    </div>
                    <div className="flex items-center gap-1 pl-5">
                      <Skeleton className="h-4 w-14 rounded-full" style={{ animationDelay: `${(i * cardsPerCol + k) * 40 + 60}ms` }} />
                      {k % 3 === 0 && <Skeleton className="h-4 w-10 rounded-full" style={{ animationDelay: `${(i * cardsPerCol + k) * 40 + 80}ms` }} />}
                    </div>
                  </div>
                ))}
              </div>
              );
            })}
          </div>
        ) : (
          /* Skeleton liste : 8 rows checkbox + avatar + titre/meta + priority + due chip */
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', animationDelay: `${i * 40}ms` }}
              >
                <Skeleton className="h-5 w-5 rounded shrink-0" style={{ animationDelay: `${i * 40}ms` }} />
                <Skeleton className="h-8 w-8 rounded-full shrink-0" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/5" style={{ animationDelay: `${i * 40 + 40}ms` }} />
                  <Skeleton className="h-2.5 w-2/5" style={{ animationDelay: `${i * 40 + 60}ms` }} />
                </div>
                <Skeleton className="h-5 w-16 rounded-full shrink-0" style={{ animationDelay: `${i * 40 + 80}ms` }} />
                <Skeleton className="h-5 w-20 rounded-full shrink-0" style={{ animationDelay: `${i * 40 + 100}ms` }} />
              </div>
            ))}
          </div>
        )
      ) : viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['todo', 'in_progress', 'done'] as const).map(status => (
            <div key={status} className="bg-[var(--bg-surface)] rounded-[var(--radius-lg)] p-3">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="text-sm">{TASK_STATUS_ICONS[status]}</span>
                <h3 className="text-xs font-bold uppercase tracking-wider">{TASK_STATUS_LABELS[status]}</h3>
                <Tag size="xs" variant="neutral" className="ml-auto">{tasks.filter(t => t.status === status).length}</Tag>
                {assigneesByStatus[status].length > 0 && (
                  <AvatarGroup
                    avatars={assigneesByStatus[status]}
                    max={4}
                    size="xs"
                    aria-label={`${assigneesByStatus[status].length} assigné${assigneesByStatus[status].length > 1 ? 's' : ''} dans ${TASK_STATUS_LABELS[status]}`}
                  />
                )}
              </div>
              <div className="space-y-2">
                {tasks.filter(t => t.status === status).map(task => {
                  // Sprint 44 M3.2 — long-press ouvre ContextualActionsSheet (mobile only)
                  const longPressProps = useLongPress(() => setSheetTask(task), undefined, { delay: 600, mobileOnly: true });
                  // Sprint 25 vague 5A — hover preview (desktop only via pointer:coarse check)
                  const hoverPreview = useTaskHoverPreview({ task });
                  return (
                  <SwipeAction
                    key={task.id}
                    rightActions={
                      <div className="flex gap-2 justify-end w-full pr-2">
                        <button aria-label="Supprimer la tâche" className="w-10 h-10 bg-[var(--danger)] text-white rounded-[var(--radius-lg)] flex items-center justify-center shadow-sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(task.id); }}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    }
                    rightThreshold={60}
                  >
                    <div {...longPressProps} onMouseEnter={hoverPreview.onMouseEnter} onMouseLeave={hoverPreview.onMouseLeave}>
                      {hoverPreview.preview}
                      {/* Sprint 24 vague 6B (M3) — démo Card `interactive` (hover lift -2px + focus ring brand) */}
                      <Card
                        interactive
                        className={`group p-3 ${task.status === 'done' ? 'opacity-50' : ''} relative z-10 ${selectedTaskIds.has(task.id) ? 'bulk-selected-row' : ''}`}
                        onClick={() => openDetail(task)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openDetail(task);
                          }
                        }}
                      >
                        <div className="flex items-start gap-2 mb-1">
                          {/* Sprint 24 vague 1B — Hover-checkbox */}
                          <label
                            className={`shrink-0 mt-0.5 transition-opacity cursor-pointer ${selectedTaskIds.has(task.id) || selectedTaskIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedTaskIds.has(task.id)}
                              onClick={(e) => { e.stopPropagation(); toggleTaskSelect(task.id, e); }}
                              onChange={() => { /* noop */ }}
                              className="rounded cursor-pointer accent-[var(--primary)] w-3.5 h-3.5"
                              aria-label={`Sélectionner la tâche ${task.title}`}
                            />
                          </label>
                          <button onClick={(e) => { e.stopPropagation(); toggleStatus(task); }} className="mt-0.5 text-sm shrink-0" aria-label={`Changer le statut : ${TASK_STATUS_LABELS[task.status]}`} title={TASK_STATUS_LABELS[task.status]}>{TASK_STATUS_ICONS[task.status]}</button>
                          <p className={`text-xs font-medium ${task.status === 'done' ? 'line-through text-[var(--text-muted)]' : ''}`}>{task.title}</p>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] pl-6">
                          <span className={isOverdue(task) ? 'text-[var(--danger)] font-semibold' : ''}>{formatDueDate(task.due_date)} {isOverdue(task) && '⚠️'}</span>
                        </div>
                        <div className="pl-6 pt-1 flex gap-1">
                          <Tag dot size="xs" color={TASK_PRIORITY_COLORS[task.priority]}>{TASK_PRIORITY_ICONS[task.priority]} {TASK_PRIORITY_LABELS[task.priority]}</Tag>
                          {task.recurring_rule && <Tag dot size="xs" variant="info" leftIcon={<Repeat size={9} />}>Réc.</Tag>}
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
      ) : viewMode === 'table' ? (
        /* ── Sprint 27 vague 27-3A — Vue table premium ── */
        <div className="table-premium-container" style={{ maxHeight: '70vh' }}>
          <table className="table-premium w-full text-left border-collapse">
            <thead>
              <tr>
                <th style={{ width: 40 }} className="table-frozen-col"></th>
                <th className="table-frozen-col" style={{ left: 40, minWidth: 220 }}>Titre</th>
                <th style={{ minWidth: 100 }}>Priorité</th>
                <th style={{ minWidth: 100 }}>Échéance</th>
                <th style={{ minWidth: 100 }}>Statut</th>
                <th style={{ minWidth: 110 }}>Assigné</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center">
                    {tasks.length > 0 ? (
                      <EmptyState
                        variant="filtered"
                        illustration={<EmptyStateIllustration kind="tasks" size={140} />}
                        title="Aucun résultat"
                        description="Aucune tâche ne correspond à tes filtres."
                        action={<Button variant="secondary" onClick={() => { setFilter('all'); setPriorityFilter(''); setAssigneeFilter(''); }}>Effacer les filtres</Button>}
                      />
                    ) : (
                      <EmptyState
                        variant="first-time"
                        illustration={<EmptyStateIllustration kind="tasks" size={160} />}
                        title="Aucune tâche à faire"
                        description="Profite du calme ou crée une tâche pour rester organisé."
                      />
                    )}
                  </td>
                </tr>
              ) : filteredTasks.map(task => {
                return (
                  <tr
                    key={task.id}
                    className={`group cursor-pointer transition-colors hover:bg-[var(--bg-subtle)] ${task.status === 'done' ? 'opacity-50' : ''}`}
                    onClick={() => openDetail(task)}
                  >
                    <td className="table-frozen-col" onClick={e => e.stopPropagation()}>
                      <button
                        className="p-1 rounded hover:bg-[var(--bg-muted)] transition-colors cursor-pointer"
                        onClick={() => toggleStatus(task)}
                        aria-label={task.status === 'done' ? 'Réouvrir' : 'Terminer'}
                      >
                        {task.status === 'done' ? <CheckCircle2 size={16} className="text-[var(--success)]" /> : <div className="w-4 h-4 rounded border-2 border-[var(--border-default)]" />}
                      </button>
                    </td>
                    <td className="table-frozen-col font-medium text-[var(--text-primary)]" style={{ left: 40 }}>
                      <div className="flex items-center gap-2">
                        <span className={`truncate max-w-[200px] ${task.status === 'done' ? 'line-through' : ''}`}>{task.title}</span>
                        {task.recurring_rule && <Repeat size={12} className="text-[var(--text-muted)] shrink-0" />}
                      </div>
                    </td>
                    <td>
                      <Tag dot size="xs" color={TASK_PRIORITY_COLORS[task.priority]}>
                        {TASK_PRIORITY_ICONS[task.priority]} {TASK_PRIORITY_LABELS[task.priority]}
                      </Tag>
                    </td>
                    <td>
                      <span className={`text-xs t-mono-num ${isOverdue(task) ? 'text-[var(--danger)] font-bold' : 'text-[var(--text-muted)]'}`}>
                        {formatDueDate(task.due_date)} {isOverdue(task) && '⚠️'}
                      </span>
                    </td>
                    <td>
                      <Tag
                        size="xs"
                        variant={task.status === 'done' ? 'success' : task.status === 'in_progress' ? 'info' : 'neutral'}
                        statusIcon
                      >
                        {TASK_STATUS_LABELS[task.status]}
                      </Tag>
                    </td>
                    <td className="text-xs text-[var(--text-muted)] truncate max-w-[110px]">
                      {task.assigned_to || '—'}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] rounded-md hover:bg-[var(--bg-subtle)] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleDelete(task.id)}
                        aria-label="Supprimer la tâche"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2" data-coachmark="tasks-list">
          {filteredTasks.length === 0 ? (
            tasks.length > 0 ? (
              <EmptyState
                variant="filtered"
                illustration={<EmptyStateIllustration kind="tasks" size={140} />}
                title="Aucun résultat"
                description="Aucune tâche ne correspond à tes filtres."
                action={<Button variant="secondary" onClick={() => { setFilter('all'); setPriorityFilter(''); setAssigneeFilter(''); }}>Effacer les filtres</Button>}
              />
            ) : (
              <EmptyState
                variant="first-time"
                illustration={<EmptyStateIllustration kind="tasks" size={160} />}
                title="Aucune tâche à faire"
                description="Profite du calme ou crée une tâche pour rester organisé."
              />
            )
          ) : (
            filteredTasks.map(task => {
              const longPressProps = useLongPress(() => openDetail(task), undefined, { delay: 600 });
              // Sprint 25 vague 5A — hover preview (desktop only)
              const hoverPreview = useTaskHoverPreview({ task });
              return (
              <SwipeAction
                key={task.id}
                rightActions={
                  <div className="flex gap-2 justify-end w-full pr-2">
                    <button aria-label="Marquer la tâche comme terminée" className="w-12 h-12 bg-[var(--success)] text-white rounded-[var(--radius-lg)] flex items-center justify-center shadow-sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleStatus(task); }}>
                      <CheckCircle2 size={20} />
                    </button>
                    <button aria-label="Supprimer la tâche" className="w-12 h-12 bg-[var(--danger)] text-white rounded-[var(--radius-lg)] flex items-center justify-center shadow-sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(task.id); }}>
                      <Trash2 size={20} />
                    </button>
                  </div>
                }
                rightThreshold={110}
              >
                <div {...longPressProps} onMouseEnter={hoverPreview.onMouseEnter} onMouseLeave={hoverPreview.onMouseLeave}>
                  {hoverPreview.preview}
                  <Card
                    className={`group p-4 flex items-start gap-3 cursor-pointer hover:border-[var(--primary)] transition-all list-item-enter ${task.status === 'done' ? 'opacity-50' : ''} relative z-10 ${selectedTaskIds.has(task.id) ? 'bulk-selected-row' : ''}`}
                    onClick={() => openDetail(task)}
                  >
                    {/* Sprint 24 vague 1B — Hover-checkbox Linear/Superhuman */}
                    <label
                      className={`shrink-0 mt-0.5 transition-opacity cursor-pointer ${selectedTaskIds.has(task.id) || selectedTaskIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTaskIds.has(task.id)}
                        onClick={(e) => { e.stopPropagation(); toggleTaskSelect(task.id, e); }}
                        onChange={() => { /* handled in onClick to capture shiftKey */ }}
                        className="rounded cursor-pointer accent-[var(--primary)] w-4 h-4"
                        aria-label={`Sélectionner la tâche ${task.title}`}
                      />
                    </label>
                    <button onClick={(e) => { e.stopPropagation(); toggleStatus(task); }} className="mt-0.5 text-lg shrink-0" title={TASK_STATUS_LABELS[task.status]} aria-label={`Changer le statut : ${TASK_STATUS_LABELS[task.status]}`}>{TASK_STATUS_ICONS[task.status]}</button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-[var(--text-muted)]' : ''}`}>{task.title}</p>
                        <Tag dot size="sm" color={TASK_PRIORITY_COLORS[task.priority]}>{TASK_PRIORITY_ICONS[task.priority]} {TASK_PRIORITY_LABELS[task.priority]}</Tag>
                        {task.recurring_rule && <Tag dot size="sm" variant="info" leftIcon={<Repeat size={10} />}>Récurrent</Tag>}
                      </div>
                      {task.description && <p className="text-xs text-[var(--text-muted)] mb-1 truncate">{task.description}</p>}
                      <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                        {task.lead_name && <span className="flex items-center gap-1">👤 {task.lead_name}</span>}
                        <span className={`flex items-center gap-1 ${isOverdue(task) ? 'text-[var(--danger)] font-semibold' : ''}`}>📅 {formatDueDate(task.due_date)} {isOverdue(task) && '⚠️'}</span>
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all shrink-0" aria-label="Supprimer la tâche"><Trash2 size={14} /></button>
                  </Card>
                </div>
              </SwipeAction>
              );
            })
          )}
        </div>
      )}

      {/* Modal Ajout Tâche */}
      <Modal open={showAddModal} onOpenChange={() => setShowAddModal(false)} title="Nouvelle Tâche">
        <div className="space-y-4">
          {templates.length > 0 && (
            <div className="bg-[var(--bg-subtle)] p-3 rounded-lg flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-[var(--text-secondary)] shrink-0"><Copy size={14} className="inline mr-1" /> Modèles de tâches</div>
              <div className="min-w-[180px]">
                <Select size="sm" onChange={e => { if(e.target.value) handleApplyTemplate(e.target.value); }}>
                  <option value="">Appliquer un modèle...</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium mb-1 block">Titre</label>
            <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Ex: Envoyer le contrat" />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Description</label>
            <Textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={3} resize="vertical" placeholder="Détails de la tâche..." maxLength={500} showCounter />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Priorité</label>
              <Select value={newPriority} onChange={e => setNewPriority(e.target.value as TaskPriority)}>
                <option value="high">🔴 Haute</option><option value="medium">🟡 Moyenne</option><option value="low">🔵 Basse</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Échéance</label>
              <Input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Récurrence</label>
              <Select value={newRecurring} onChange={e => setNewRecurring(e.target.value)}>
                <option value="none">Aucune</option><option value="daily">Quotidienne</option><option value="weekly">Hebdomadaire</option><option value="monthly">Mensuelle</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Rappel auto (minutes)</label>
              <Input type="number" value={newReminder} onChange={e => setNewReminder(Number(e.target.value))} />
            </div>
          </div>
          <div className="flex justify-end pt-2 gap-2">
            <Button variant="ghost" onClick={() => setShowAddModal(false)}>Annuler</Button>
            <Button onClick={handleCreateTask} disabled={!newTitle}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Modal Détails Tâche (Subtasks & Comments) */}
      {showDetailModal && (
        <Modal open={!!showDetailModal} onOpenChange={() => setShowDetailModal(null)} title="Détails de la tâche">
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className={`text-lg font-bold ${showDetailModal.status === 'done' ? 'line-through text-[var(--text-muted)]' : ''}`}>{showDetailModal.title}</h2>
              <button onClick={() => toggleStatus(showDetailModal)} className="text-2xl cursor-pointer hover:scale-110 transition-transform" aria-label={`Changer le statut : ${TASK_STATUS_LABELS[showDetailModal.status]}`} title={TASK_STATUS_LABELS[showDetailModal.status]}>{TASK_STATUS_ICONS[showDetailModal.status]}</button>
            </div>
            <div className="flex gap-2">
              <Tag dot size="sm" color={TASK_PRIORITY_COLORS[showDetailModal.priority]}>{TASK_PRIORITY_ICONS[showDetailModal.priority]} {TASK_PRIORITY_LABELS[showDetailModal.priority]}</Tag>
              <Tag size="sm" variant="neutral" leftIcon={<CalendarDays size={11} />}>{formatDate(showDetailModal.due_date, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}</Tag>
            </div>
            {showDetailModal.description && <p className="text-sm bg-[var(--bg-subtle)] p-3 rounded-lg whitespace-pre-wrap">{showDetailModal.description}</p>}

            {/* Subtasks */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2 text-[var(--text-secondary)]">Sous-tâches ({subtasks.filter(s=>s.is_done).length}/{subtasks.length})</h3>
              <div className="space-y-1 mb-2">
                {subtasks.map((st, idx) => (
                  <div
                    key={st.id}
                    className="row-premium list-item-enter flex items-center gap-2.5 group p-1.5 rounded-md"
                    style={{ animationDelay: `${Math.min(idx, 20) * 30}ms` }}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleSubtask(st)}
                      className="shrink-0 transition-transform hover:scale-110 active:scale-95"
                      aria-pressed={!!st.is_done}
                      aria-label={st.is_done ? 'Marquer comme non terminée' : 'Marquer comme terminée'}
                    >
                      <span
                        aria-hidden
                        className="w-5 h-5 rounded-md flex items-center justify-center transition-colors duration-150"
                        style={
                          st.is_done
                            ? {
                                background: 'var(--primary)',
                                border: '1px solid var(--primary)',
                              }
                            : {
                                background: 'transparent',
                                border: '2px solid var(--border-default)',
                              }
                        }
                      >
                        {st.is_done && <CheckCircle2 size={14} strokeWidth={3} className="text-white" />}
                      </span>
                    </button>
                    <span className={`text-sm flex-1 ${st.is_done ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>{st.title}</span>
                    <button onClick={() => handleDeleteSubtask(st.id)} className="text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-opacity p-1" aria-label="Supprimer la sous-tâche"><X size={14}/></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={newSubtask} onChange={e => setNewSubtask(e.target.value)} onKeyDown={e => { if(e.key==='Enter') handleAddSubtask(); }} placeholder="Nouvelle sous-tâche..." className="h-8 text-xs" />
                <Button size="sm" variant="secondary" onClick={handleAddSubtask} disabled={!newSubtask}>Ajouter</Button>
              </div>
            </div>

            <hr className="border-[var(--border-subtle)]" />

            {/* Activity / Comments */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-3 text-[var(--text-secondary)] flex items-center gap-1"><MessageSquare size={14} /> Activité</h3>
              <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                {comments.length === 0 ? <p className="text-xs text-[var(--text-muted)]">Aucun commentaire.</p> : comments.map((c, idx) => (
                  <div
                    key={c.id}
                    className="row-premium list-item-enter bg-[var(--bg-subtle)] p-2.5 rounded-lg text-sm relative group"
                    style={{ animationDelay: `${Math.min(idx, 20) * 30}ms` }}
                  >
                    <p className="whitespace-pre-wrap">{c.body}</p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">{formatDateTime(c.created_at, getLocale())}</p>
                    <button onClick={() => handleDeleteComment(c.id)} className="absolute top-2 right-2 text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100" aria-label="Supprimer le commentaire"><X size={14}/></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Textarea
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    placeholder="Ajouter un commentaire..."
                    rows={2}
                    maxLength={500}
                    showCounter
                    resize="none"
                  />
                </div>
                <Button size="sm" variant="secondary" onClick={handleAddComment} disabled={!newComment}>Envoyer</Button>
              </div>
            </div>
            
            <div className="flex justify-end pt-2">
              <Button variant="ghost" className="text-[var(--danger)] hover:bg-[var(--danger-soft)]" onClick={() => handleDelete(showDetailModal.id)} leftIcon={<Trash2 size={14}/>}>Supprimer la tâche</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Sprint 44 M3.2 — Contextual actions sheet (mobile long-press) */}
      <ContextualActionsSheet
        open={!!sheetTask}
        onOpenChange={(o) => { if (!o) setSheetTask(null); }}
        title={sheetTask?.title}
        description={sheetTask ? `${TASK_STATUS_LABELS[sheetTask.status]} · ${TASK_PRIORITY_LABELS[sheetTask.priority]}` : undefined}
        actions={sheetTask ? buildTaskActions(sheetTask) : []}
      />
      </div>
      {/* Sprint 45 M3.2 — Coachmark contextuel : « Ctrl+clic / Shift+clic pour sélection multiple » */}
      <ContextualCoachmark page="tasks" />
    </AppLayout>
  );
}