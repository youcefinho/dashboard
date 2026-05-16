// ── TaskHoverPreview — Carte preview hover sur Tasks (Sprint 25 vague 5A) ───
// Clone du pattern LeadHoverPreview (sprint 23 wave 10). Apparaît au survol
// prolongé (~320ms) d'une row Task. Affiche : assignee avatar + title +
// priority chip + due date (avec ⚠ overdue) + subtasks count + tags + snippet
// description. Variant hot si overdue (red glow danger).
//
// Hook `useTaskHoverPreview({ task, ... })` → { onMouseEnter, onMouseLeave, preview }.
// Désactivé sur pointer:coarse (touch). Respect prefers-reduced-motion.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, Tag, Icon } from '@/components/ui';
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_COLORS,
  TASK_PRIORITY_ICONS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ICONS,
  type Task,
} from '@/lib/types';
import { Flag, CalendarDays, ListChecks, AlertTriangle, User as UserIcon } from 'lucide-react';

const PREVIEW_WIDTH = 340;
const PREVIEW_HEIGHT = 280;

interface UseTaskHoverPreviewOptions {
  task: Task;
  subtasksCount?: { done: number; total: number };
  tags?: string[];
  disabled?: boolean;
  delay?: number;
}

interface UseTaskHoverPreviewResult {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  preview: ReactNode;
}

function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export function useTaskHoverPreview({
  task,
  subtasksCount,
  tags,
  disabled = false,
  delay = 320,
}: UseTaskHoverPreviewOptions): UseTaskHoverPreviewResult {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!position) return;
    const handleScroll = () => setPosition(null);
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', handleScroll, { capture: true });
  }, [position]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const onMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled || isCoarsePointer()) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const padding = 16;
      let x = rect.right + 12;
      if (x + PREVIEW_WIDTH > window.innerWidth - padding) {
        x = Math.max(padding, rect.left - PREVIEW_WIDTH - 12);
      }
      let y = rect.top;
      if (y + PREVIEW_HEIGHT > window.innerHeight - padding) {
        y = Math.max(padding, window.innerHeight - PREVIEW_HEIGHT - padding);
      }
      setPosition({ x, y });
    }, delay);
  };

  const onMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPosition(null);
  };

  const preview =
    position && typeof document !== 'undefined'
      ? createPortal(
          <TaskPreviewCard task={task} subtasksCount={subtasksCount} tags={tags} position={position} />,
          document.body
        )
      : null;

  return { onMouseEnter, onMouseLeave, preview };
}

function formatDue(iso: string): { label: string; overdue: boolean } {
  if (!iso) return { label: '', overdue: false };
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / 86400000);
  if (diffDays < -1) return { label: `il y a ${Math.abs(diffDays)}j`, overdue: true };
  if (diffDays === -1) return { label: 'hier', overdue: true };
  if (diffDays === 0) return { label: "aujourd'hui", overdue: false };
  if (diffDays === 1) return { label: 'demain', overdue: false };
  return { label: `dans ${diffDays}j`, overdue: false };
}

function TaskPreviewCard({
  task,
  subtasksCount,
  tags,
  position,
}: {
  task: Task;
  subtasksCount?: { done: number; total: number };
  tags?: string[];
  position: { x: number; y: number };
}) {
  const due = formatDue(task.due_date);
  const isOverdue = due.overdue && task.status !== 'done';
  const snippet = (task.description || '').slice(0, 80);

  return (
    <div
      className="fixed z-[100] w-[340px] rounded-2xl overflow-hidden pointer-events-none motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200"
      style={{
        left: position.x,
        top: position.y,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(249,252,254,0.96) 100%)',
        backdropFilter: 'blur(18px) saturate(170%)',
        WebkitBackdropFilter: 'blur(18px) saturate(170%)',
        border: isOverdue
          ? '1px solid rgba(220,38,38,0.32)'
          : '1px solid rgba(0,157,219,0.18)',
        boxShadow: isOverdue
          ? '0 1px 2px rgba(15,23,42,0.06), 0 16px 40px -10px rgba(220,38,38,0.35), 0 32px 64px -16px rgba(220,38,38,0.22), inset 0 1px 0 rgba(255,255,255,0.8)'
          : '0 1px 2px rgba(15,23,42,0.06), 0 16px 40px -10px rgba(0,157,219,0.22), 0 32px 64px -16px rgba(15,23,42,0.20), inset 0 1px 0 rgba(255,255,255,0.8)',
      }}
    >
      {/* Orb décoratif */}
      <div
        aria-hidden
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
        style={{
          background: isOverdue
            ? 'radial-gradient(circle, rgba(220,38,38,0.22) 0%, rgba(217,110,39,0.10) 50%, transparent 80%)'
            : 'radial-gradient(circle, rgba(0,157,219,0.18) 0%, rgba(217,110,39,0.06) 50%, transparent 80%)',
          filter: 'blur(32px)',
        }}
      />

      {/* Bandeau overdue */}
      {isOverdue && (
        <div
          className="relative h-1"
          style={{
            background: 'linear-gradient(90deg, var(--danger) 0%, #D96E27 100%)',
            boxShadow: '0 0 12px rgba(220,38,38,0.5)',
          }}
        />
      )}

      <div className="relative p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <Avatar name={task.assigned_to || 'NA'} size="sm" />
          <div className="flex-1 min-w-0">
            <h3
              className="text-[14px] font-bold leading-tight"
              style={{
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
              }}
            >
              {task.title}
            </h3>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <Tag dot size="xs" color={TASK_PRIORITY_COLORS[task.priority]} leftIcon={<Icon as={Flag} size={9} />}>
                {TASK_PRIORITY_ICONS[task.priority]} {TASK_PRIORITY_LABELS[task.priority]}
              </Tag>
              <Tag size="xs" variant="neutral">
                {TASK_STATUS_ICONS[task.status]} {TASK_STATUS_LABELS[task.status]}
              </Tag>
            </div>
          </div>
        </div>

        {/* Due + subtasks */}
        <div className="space-y-1.5 mb-3">
          {task.due_date && (
            <div
              className="flex items-center gap-2 text-[11px]"
              style={{ color: isOverdue ? 'var(--danger)' : 'var(--text-secondary)' }}
            >
              <Icon as={CalendarDays} size="xs" style={{ color: isOverdue ? 'var(--danger)' : 'var(--primary)', opacity: 0.85 }} />
              <span className={isOverdue ? 'font-semibold' : ''}>
                {due.label}
                {isOverdue && (
                  <Icon as={AlertTriangle} size={10} className="inline ml-1 mb-0.5" />
                )}
              </span>
            </div>
          )}
          {subtasksCount && subtasksCount.total > 0 && (
            <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <Icon as={ListChecks} size="xs" style={{ color: 'var(--primary)', opacity: 0.85 }} />
              <span>
                {subtasksCount.done} / {subtasksCount.total} sous-tâches
              </span>
            </div>
          )}
          {task.lead_name && (
            <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <Icon as={UserIcon} size="xs" style={{ color: 'var(--primary)', opacity: 0.85 }} />
              <span className="truncate">{task.lead_name}</span>
            </div>
          )}
        </div>

        {/* Snippet description */}
        {snippet && (
          <div
            className="px-3 py-2 mb-3 rounded-lg text-[12px] leading-relaxed"
            style={{
              background:
                'linear-gradient(135deg, rgba(0,157,219,0.06) 0%, rgba(217,110,39,0.03) 100%)',
              border: '1px solid rgba(0,157,219,0.10)',
              color: 'var(--text-secondary)',
            }}
          >
            <span className="italic">
              "{snippet}
              {(task.description || '').length > 80 ? '…' : ''}"
            </span>
          </div>
        )}

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {tags.slice(0, 5).map((t) => (
              <span
                key={t}
                className="text-[9px] px-2 py-0.5 rounded-full font-semibold tracking-wide"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(0,157,219,0.10) 0%, rgba(217,110,39,0.06) 100%)',
                  color: 'var(--primary)',
                  border: '1px solid rgba(0,157,219,0.18)',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Footer hint */}
        <div
          className="pt-2 mt-2 border-t flex items-center justify-between"
          style={{ borderColor: 'rgba(0,157,219,0.10)' }}
        >
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Aperçu
          </span>
          <span className="text-[10px] font-semibold" style={{ color: 'var(--primary)' }}>
            Cliquer pour ouvrir →
          </span>
        </div>
      </div>
    </div>
  );
}
