// ── LeadTimeline — Vue chronologique unifiée d'un lead (Sprint 22) ─────────
// Merge activity_log + notes + tâches + RDV + count messages dans un seul flux
// chronologique style "timeline" avec dots de couleur par type.
// Différenciateur : voir TOUT l'historique d'un lead dans un seul scroll.

import { useMemo } from 'react';
import { Mail, MessageSquare, StickyNote, CalendarCheck, ListTodo, Activity as ActivityIcon, Edit3, UserPlus, Tag as TagIcon, DollarSign } from 'lucide-react';
import type { LeadDetail, ActivityType, LeadNote, Appointment, Task } from '@/lib/types';
import { ACTIVITY_LABELS, NOTE_CATEGORY_LABELS, NOTE_CATEGORY_ICONS, APPOINTMENT_TYPE_LABELS } from '@/lib/types';
import { Tag, Avatar, Icon as UIcon } from '@/components/ui';
// Sprint 48 M3.2 — relative time + locale-aware date
import { formatRelativeTime, formatDate, formatDateTime } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';

interface TimelineEvent {
  id: string;
  type: 'activity' | 'note' | 'appointment' | 'task';
  date: string;
  iconType: 'mail' | 'message' | 'note' | 'appointment' | 'task' | 'activity' | 'edit' | 'create' | 'tag' | 'deal';
  color: string;
  title: string;
  description?: string;
  meta?: string;
  /** Acteur identifié — affiche un Avatar xs */
  actorName?: string;
}

interface LeadTimelineProps {
  lead: LeadDetail;
  notes: LeadNote[];
  appointments: Appointment[];
  tasks: Task[];
}

function iconForActivity(action: string): TimelineEvent['iconType'] {
  if (action.includes('email')) return 'mail';
  if (action.includes('sms') || action.includes('message')) return 'message';
  if (action === 'note_added') return 'note';
  if (action === 'created') return 'create';
  if (action.includes('tag')) return 'tag';
  if (action.includes('deal_value')) return 'deal';
  if (action.includes('status') || action.includes('pipeline_stage')) return 'edit';
  return 'activity';
}

function colorForType(type: TimelineEvent['type'], iconType?: TimelineEvent['iconType']): string {
  if (type === 'note') return 'var(--warning)';
  if (type === 'appointment') return 'var(--accent-orange)';
  if (type === 'task') return 'var(--success)';
  // activity
  if (iconType === 'mail' || iconType === 'message') return 'var(--info)';
  if (iconType === 'create') return 'var(--success)';
  if (iconType === 'deal') return 'var(--primary)';
  if (iconType === 'edit') return 'var(--warning)';
  if (iconType === 'tag') return 'var(--text-secondary)';
  return 'var(--text-muted)';
}

const ICON_COMPONENTS = {
  mail: Mail, message: MessageSquare, note: StickyNote,
  appointment: CalendarCheck, task: ListTodo, activity: ActivityIcon,
  edit: Edit3, create: UserPlus, tag: TagIcon, deal: DollarSign,
} as const;

function formatRelative(dateStr: string): string {
  // Sprint 48 M3.2 — délégué à Intl.RelativeTimeFormat (locale-aware)
  return formatRelativeTime(dateStr, getLocale());
}

export function LeadTimeline({ lead, notes, appointments, tasks }: LeadTimelineProps) {
  const events = useMemo<TimelineEvent[]>(() => {
    const out: TimelineEvent[] = [];

    // Activity log entries
    for (const a of lead.activity || []) {
      const iconType = iconForActivity(a.action);
      out.push({
        id: `act-${a.id}`,
        type: 'activity',
        date: a.created_at,
        iconType,
        color: colorForType('activity', iconType),
        title: ACTIVITY_LABELS[a.action as ActivityType] || a.action,
        description: a.details || undefined,
      });
    }

    // Notes structurées
    for (const n of notes || []) {
      out.push({
        id: `note-${n.id}`,
        type: 'note',
        date: n.created_at,
        iconType: 'note',
        color: colorForType('note'),
        title: `Note ajoutée${n.author_name ? ` par ${n.author_name}` : ''}`,
        description: n.body.slice(0, 200) + (n.body.length > 200 ? '…' : ''),
        meta: `${NOTE_CATEGORY_ICONS[n.category] || '📝'} ${NOTE_CATEGORY_LABELS[n.category] || n.category}`,
        actorName: n.author_name || undefined,
      });
    }

    // Appointments
    for (const ap of appointments || []) {
      out.push({
        id: `appt-${ap.id}`,
        type: 'appointment',
        date: ap.created_at || ap.start_time,
        iconType: 'appointment',
        color: colorForType('appointment'),
        title: ap.title || 'Rendez-vous',
        description: formatDateTime(ap.start_time, getLocale(), { dateStyle: 'short', timeStyle: 'short' }),
        meta: APPOINTMENT_TYPE_LABELS[ap.type] || ap.type,
      });
    }

    // Tasks
    for (const t of tasks || []) {
      out.push({
        id: `task-${t.id}`,
        type: 'task',
        date: t.created_at,
        iconType: 'task',
        color: colorForType('task'),
        title: t.title,
        description: t.description || undefined,
        meta: t.status === 'done' ? '✓ Terminée' : t.due_date ? `Échéance ${formatDate(t.due_date, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}` : 'À faire',
      });
    }

    // Sort desc (most recent first)
    return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [lead.activity, notes, appointments, tasks]);

  // Group by day for visual section headers
  const groups = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const key = formatDate(e.date, getLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries());
  }, [events]);

  if (events.length === 0) {
    return <p className="text-sm text-[var(--text-muted)] py-4">Aucune activité enregistrée pour ce lead.</p>;
  }

  return (
    <div className="relative">
      {/* Ligne verticale */}
      <div className="absolute left-[14px] top-2 bottom-2 w-px bg-[var(--border-subtle)]" />

      <div className="space-y-6">
        {groups.map(([day, items]) => (
          <div key={day}>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3 pl-9 sticky top-0 bg-[var(--bg-surface)] py-1 z-[1]">
              {day} <span className="ml-1 text-[var(--text-muted)]/70">· {items.length}</span>
            </h4>
            <div className="space-y-3">
              {items.map((event, i) => {
                const EventIconCmp = ICON_COMPONENTS[event.iconType];
                return (
                  <div
                    key={event.id}
                    className="list-item-enter row-premium flex items-start gap-3 p-1.5 -mx-1.5 rounded-lg"
                    style={{ animationDelay: `${Math.min(i, 20) * 40}ms` }}
                  >
                    {/* Pastille avec icône — glow brand subtil, animation scale-in */}
                    <div
                      className="relative w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 z-[2] border-2 border-[var(--bg-surface)] shadow-sm animate-in zoom-in-50 fade-in-0 duration-300"
                      style={{
                        background: `color-mix(in srgb, ${event.color} 18%, transparent)`,
                        color: event.color,
                        boxShadow: `0 0 12px -2px color-mix(in srgb, ${event.color} 35%, transparent)`,
                      }}
                    >
                      <UIcon as={EventIconCmp} size="sm" strokeWidth={2.25} />
                      {/* Avatar acteur en overlay bottom-right si disponible */}
                      {event.actorName && (
                        <span
                          aria-hidden
                          className="absolute -bottom-1 -right-1 z-[3] rounded-full ring-2 ring-[var(--bg-surface)]"
                          title={event.actorName}
                        >
                          <Avatar name={event.actorName} size="xs" />
                        </span>
                      )}
                    </div>
                    {/* Contenu */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-[var(--text-primary)] leading-tight">{event.title}</p>
                        <Tag variant="neutral" size="xs">{formatRelative(event.date)}</Tag>
                      </div>
                      {event.meta && (
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{event.meta}</p>
                      )}
                      {event.description && (
                        <p className="text-xs text-[var(--text-secondary)] mt-1 whitespace-pre-wrap line-clamp-3 leading-relaxed">{event.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
