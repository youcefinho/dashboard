// ── Page Tâches — Gestion des tâches ────────────────────────

import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Badge } from '@/components/ui';
import { getTasks, createTask, updateTask, deleteTask } from '@/lib/api';
import {
  type Task, type TaskPriority, type TaskStatus,
  TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, TASK_PRIORITY_ICONS,
  TASK_STATUS_LABELS, TASK_STATUS_ICONS,
} from '@/lib/types';

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<'all' | TaskStatus>('all');
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newDueDate, setNewDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [sortBy, setSortBy] = useState<'priority' | 'due_date' | 'status'>('due_date');

  // Charger les tâches depuis l'API
  useEffect(() => {
    getTasks().then(res => {
      if (res.data) setTasks(res.data);
    }).catch(() => { /* erreur silencieuse */ });
  }, []);

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
  };

  const handleCreateTask = () => {
    if (!newTitle.trim()) return;
    const task: Task = {
      id: `task-${Date.now()}`,
      title: newTitle,
      description: '',
      due_date: new Date(newDueDate).toISOString(),
      priority: newPriority,
      status: 'todo',
      lead_id: null,
      client_id: null,
      assigned_to: 'Rochdi',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setTasks(prev => [task, ...prev]);
    void createTask(task);
    setNewTitle('');
    setShowNewTask(false);
  };

  const handleDelete = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    void deleteTask(id);
  };

  const formatDueDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const diffMs = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffMs / 86400000);
    if (diffDays < -1) return `il y a ${Math.abs(diffDays)}j`;
    if (diffDays === -1) return 'hier';
    if (diffDays === 0) return "aujourd'hui";
    if (diffDays === 1) return 'demain';
    return `dans ${diffDays}j`;
  };

  const isOverdue = (task: Task) => task.status !== 'done' && new Date(task.due_date) < new Date();

  return (
    <AppLayout title="Tâches">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">{tasks.length}</p>
          <p className="text-xs text-[var(--color-text-muted)]">Total</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-danger)]">{overdueTasks.length}</p>
          <p className="text-xs text-[var(--color-text-muted)]">En retard</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-warning)]">{todayTasks.length}</p>
          <p className="text-xs text-[var(--color-text-muted)]">Aujourd'hui</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-success)]">{doneTasks.length}</p>
          <p className="text-xs text-[var(--color-text-muted)]">Terminées</p>
        </Card>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">📋 Tâches</h2>
          {/* Filtres */}
          <div className="flex gap-1 ml-4">
            {(['all', 'todo', 'in_progress', 'done'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs rounded-full cursor-pointer transition-colors ${
                  filter === f
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {f === 'all' ? 'Toutes' : TASK_STATUS_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
        <Button size="sm" onClick={() => setShowNewTask(!showNewTask)}>
          + Nouvelle tâche
        </Button>
      </div>

      {/* Tri + Vue mode */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--color-text-muted)] uppercase">Trier :</span>
          {(['due_date', 'priority', 'status'] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              className={`px-2 py-0.5 text-[10px] rounded-full cursor-pointer transition-colors ${sortBy === s ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]'}`}>
              {s === 'due_date' ? '📅 Date' : s === 'priority' ? '🚨 Priorité' : '📊 Statut'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setViewMode('list')}
            className={`p-1.5 rounded cursor-pointer transition-colors ${viewMode === 'list' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}>
            ☰
          </button>
          <button onClick={() => setViewMode('kanban')}
            className={`p-1.5 rounded cursor-pointer transition-colors ${viewMode === 'kanban' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}>
            ▦
          </button>
        </div>
      </div>

      {/* Formulaire nouvelle tâche */}
      {showNewTask && (
        <Card className="p-4 mb-4 animate-slide-down">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Titre de la tâche..."
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateTask(); }}
              className="flex-1"
            />
            <select
              value={newPriority}
              onChange={e => setNewPriority(e.target.value as TaskPriority)}
              className="px-3 py-2 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)]"
            >
              <option value="high">🔴 Haute</option>
              <option value="medium">🟡 Moyenne</option>
              <option value="low">🔵 Basse</option>
            </select>
            <input
              type="date"
              value={newDueDate}
              onChange={e => setNewDueDate(e.target.value)}
              className="px-3 py-2 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] text-[var(--color-text-primary)]"
            />
            <Button onClick={handleCreateTask} size="sm">Créer</Button>
          </div>
        </Card>
      )}

      {/* Vue Kanban */}
      {viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['todo', 'in_progress', 'done'] as const).map(status => (
            <div key={status} className="bg-[var(--color-bg-secondary)] rounded-[var(--radius-lg)] p-3">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="text-sm">{TASK_STATUS_ICONS[status]}</span>
                <h3 className="text-xs font-bold uppercase tracking-wider">{TASK_STATUS_LABELS[status]}</h3>
                <span className="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] px-1.5 py-0.5 rounded-full ml-auto">
                  {tasks.filter(t => t.status === status).length}
                </span>
              </div>
              <div className="space-y-2">
                {tasks.filter(t => t.status === status).map(task => (
                  <Card key={task.id} className={`p-3 ${task.status === 'done' ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <button onClick={() => toggleStatus(task)} className="text-sm cursor-pointer shrink-0">{TASK_STATUS_ICONS[task.status]}</button>
                      <p className={`text-xs font-medium truncate ${task.status === 'done' ? 'line-through' : ''}`}>{task.title}</p>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                      {task.lead_name ? (
                        <Link to={`/leads/${task.lead_id}`} className="hover:text-[var(--color-accent)] transition-colors">👤 {task.lead_name}</Link>
                      ) : <span />}
                      <span className={isOverdue(task) ? 'text-[var(--color-danger)] font-semibold' : ''}>
                        {formatDueDate(task.due_date)} {isOverdue(task) && '⚠️'}
                      </span>
                    </div>
                    <Badge color={TASK_PRIORITY_COLORS[task.priority]} className="text-[9px] mt-1">
                      {TASK_PRIORITY_ICONS[task.priority]} {TASK_PRIORITY_LABELS[task.priority]}
                    </Badge>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
      /* Vue Liste */
      <div className="space-y-2">
        {filteredTasks.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">Aucune tâche trouvée</p>
          </Card>
        ) : (
          filteredTasks.map(task => (
            <Card key={task.id} className={`p-4 flex items-start gap-3 transition-opacity ${task.status === 'done' ? 'opacity-50' : ''}`}>
              {/* Checkbox statut */}
              <button
                onClick={() => toggleStatus(task)}
                className="mt-0.5 text-lg cursor-pointer shrink-0"
                title={TASK_STATUS_LABELS[task.status]}
              >
                {TASK_STATUS_ICONS[task.status]}
              </button>

              {/* Contenu */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-[var(--color-text-muted)]' : ''}`}>
                    {task.title}
                  </p>
                  <Badge color={TASK_PRIORITY_COLORS[task.priority]} className="text-[10px]">
                    {TASK_PRIORITY_ICONS[task.priority]} {TASK_PRIORITY_LABELS[task.priority]}
                  </Badge>
                </div>
                {task.description && (
                  <p className="text-xs text-[var(--color-text-muted)] mb-1">{task.description}</p>
                )}
                <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
                  {task.lead_name && (
                    <Link to={`/leads/${task.lead_id}`} className="flex items-center gap-1 hover:text-[var(--color-accent)] transition-colors">👤 {task.lead_name}</Link>
                  )}
                  <span className={`flex items-center gap-1 ${isOverdue(task) ? 'text-[var(--color-danger)] font-semibold' : ''}`}>
                    📅 {formatDueDate(task.due_date)} {isOverdue(task) && '⚠️'}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <button
                onClick={() => handleDelete(task.id)}
                className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors cursor-pointer shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            </Card>
          ))
        )}
      </div>
      )}
    </AppLayout>
  );
}
