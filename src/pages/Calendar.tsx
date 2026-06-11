// ── Calendar page — Sprint 41 M2 refonte Stripe (2026-05-15) ────────────────
// Refonte complète paradigme Stripe Dashboard : subtle, monochromatique,
// shadows noir 5-10 %, AUCUN orb, AUCUN gradient brand massif, AUCUN glow.
//
// Préserve 100 % la logique métier + le hook drag-resize Sprint 31 (snap 15min
// + haptic). API publique inchangée.
//
// Architecture des views :
//   - cal-toolbar (sticky header haut : nav prev/next/today + pill switcher + date range)
//   - cal-grid (week | day : 7/1 colonnes timeline 7h-21h, today live-line)
//   - cal-month-grid (6 × 7 cells)
//   - cal-agenda (liste verticale chronologique)
//   - cal-minical (sidebar 7×6 grid 28px)
//   - cal-event-panel (SlidePanel droite — détail event)
//   - cal-empty-overlay (center overlay si pas d'events visibles)

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Tag, Skeleton, useToast, SlidePanel, Switch, Icon, EmptyStateIllustration, EmptyState, PageHero, Select } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { getAppointments, createAppointment, updateAppointment, rescheduleAppointment, getCalendars, getClients, sendAppointmentReminderNow, type Calendar as CalType } from '@/lib/api';
import type { Appointment, AppointmentType, AppointmentStatus, Client } from '@/lib/types';
import { APPOINTMENT_TYPE_LABELS, APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPES } from '@/lib/types';
import { ChevronLeft, ChevronRight, CalendarDays, Clock, MapPin, User, Plus, Check, X, BellRing, ExternalLink, ChevronsUpDown, Copy, Trash2 } from 'lucide-react';
import { DndContext, useDraggable, useDroppable, DragEndEvent, pointerWithin } from '@dnd-kit/core';
import { useHaptic } from '@/hooks/useHaptic';
import { useShortcuts } from '@/hooks/useShortcuts';
import { announceSR } from '@/lib/announce';
import { useAppointmentHoverPreview } from '@/components/panels/AppointmentHoverPreview';
// Sprint 33 C3 — Calendar sync status badge (Google Calendar / Outlook)
import { CalendarSyncStatusBadge } from '@/components/calendar/CalendarSyncStatusBadge';
// Sprint 49 — Surface external calendar-sync controls (connect / sync now / preview)
import { ExternalCalendarSync } from '@/components/calendar/ExternalCalendarSync';
// Sprint 48 M3.2 — Intl date/time formatters
import { formatDate } from '@/lib/i18n/datetime';
import { formatDateInTimezone, getStoredTimezone } from '@/lib/i18n/timezone';
import { getLocale, t } from '@/lib/i18n';
// Sprint 44 M3.3 — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';

type ViewMode = 'day' | 'week' | 'month' | 'agenda';

// ── DnD components ────────────────────────────────────────────────────────
function DraggableEvent({ appointment, children }: { appointment: Appointment; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appointment.id,
    data: { appointment },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10, opacity: isDragging ? 0.5 : 1 } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="cursor-move">
      {children}
    </div>
  );
}

function DroppableSlot({ id, date, hour, children, className }: { id: string; date: string; hour?: number; children?: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { date, hour } });
  return (
    <div ref={setNodeRef} className={`${className || ''} ${isOver ? 'cal-slot-over' : ''}`}>
      {children}
    </div>
  );
}

function AppointmentHoverWrap({ appointment, children }: { appointment: Appointment; children: React.ReactNode }) {
  const hp = useAppointmentHoverPreview({ appointment });
  return (
    <span onMouseEnter={hp.onMouseEnter} onMouseLeave={hp.onMouseLeave} className="contents">
      {hp.preview}
      {children}
    </span>
  );
}

// ── Resize state (Sprint 31 preserved verbatim) ───────────────────────────
type ResizeMode = 'top' | 'bottom';
interface ResizingState {
  apptId: string;
  mode: ResizeMode;
  baseStartMs: number;
  baseEndMs: number;
  startY: number;
  previewStartMs: number;
  previewEndMs: number;
}

const HOUR_PX = 64;
const SNAP_MIN = 15;
const MIN_DURATION_MIN = 15;
const MAX_DURATION_MIN = 8 * 60;

// ── Variant mapping Appointment type → Tag variant (Stripe palette) ──────
function typeToVariant(t: AppointmentType): 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent' {
  switch (t) {
    case 'meeting':   return 'brand';
    case 'call':      return 'info';
    case 'visit':     return 'success';
    case 'signing':   return 'accent';
    case 'followup' as AppointmentType:  return 'warning';
    default:          return 'neutral';
  }
}
function statusToVariant(s: AppointmentStatus): 'success' | 'danger' | 'warning' | 'info' {
  if (s === 'confirmed') return 'success';
  if (s === 'cancelled') return 'danger';
  if (s === 'completed') return 'info';
  return 'warning';
}

export function CalendarPage() {
  const { success, error: toastError, info, warning } = useToast();
  const haptic = useHaptic();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [calendars, setCalendars] = useState<CalType[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Sprint LOT 1-3 — Error state inline + retry (gap audit Calendar)
  const [loadError, setLoadError] = useState<string | null>(null);

  const [resizing, setResizing] = useState<ResizingState | null>(null);
  const resizingRef = useRef<ResizingState | null>(null);
  resizingRef.current = resizing;
  const lastSnapMinRef = useRef<number | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>(() => typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'week');
  const [currentDate, setCurrentDate] = useState(new Date());

  const [selectedCalendars, setSelectedCalendars] = useState<Set<string>>(new Set());

  // Live now tick — refresh today live-line position every 60s
  const [nowTick, setNowTick] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [showAddModal, setShowAddModal] = useState(false);
  const [detailAppt, setDetailAppt] = useState<Appointment | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTimeStart, setFormTimeStart] = useState('10:00');
  const [formTimeEnd, setFormTimeEnd] = useState('11:00');
  const [formLocation, setFormLocation] = useState('');
  const [formType, setFormType] = useState<AppointmentType>('meeting');
  const [formCalendarId, setFormCalendarId] = useState('');
  const [formClientId, setFormClientId] = useState('');
  const [formRecurring, setFormRecurring] = useState('none');
  const [formReminder, setFormReminder] = useState(60);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [apptRes, calRes, clientsRes] = await Promise.all([
        getAppointments(),
        getCalendars(),
        getClients(),
      ]);
      if (apptRes.data) setAppointments(apptRes.data);
      if (calRes.data) {
        setCalendars(calRes.data);
        if (calRes.data.length > 0 && selectedCalendars.size === 0) {
          setSelectedCalendars(new Set(calRes.data.map(c => c.id)));
          setFormCalendarId(calRes.data[0]!.id);
        }
      }
      if (clientsRes.data) {
        setClients(clientsRes.data);
        if (clientsRes.data.length > 0) {
          setFormClientId(prev => prev || clientsRes.data![0]!.id);
        }
      }
      // Sprint LOT 1-3 — Si tous les endpoints critiques échouent → error inline
      if (!apptRes.data && !calRes.data) {
        setLoadError(apptRes.error || calRes.error || t('calendar.error.load_failed'));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('calendar.error.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [selectedCalendars.size]);

  useEffect(() => { void load(); }, [load]);

  const filteredAppointments = useMemo(() => {
    return appointments.filter(a => !a.calendar_id || selectedCalendars.has(a.calendar_id));
  }, [appointments, selectedCalendars]);

  // Navigation
  const navigate = (delta: number) => {
    const d = new Date(currentDate);
    if (viewMode === 'month') d.setMonth(d.getMonth() + delta);
    else if (viewMode === 'day') d.setDate(d.getDate() + delta);
    else d.setDate(d.getDate() + delta * 7);
    setCurrentDate(d);
  };
  const goToday = () => setCurrentDate(new Date());

  // Helpers
  const isToday = (d: Date) => d.toDateString() === new Date().toDateString();
  const dayStr = (d: Date) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  };
  const apptsFor = (d: Date) => filteredAppointments.filter(a => a.start_time.slice(0, 10) === dayStr(d));
  // Sprint 48 M3.2/M3.4 — display dans le TZ user, locale active
  const fmtTime = (s: string) => formatDateInTimezone(new Date(s + (s.endsWith('Z') ? '' : 'Z')), getStoredTimezone(), getLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });

  const getWeekDays = (): Date[] => {
    const s = new Date(currentDate);
    s.setDate(s.getDate() - s.getDay() + 1);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(d.getDate() + i); return d; });
  };

  const getMonthDays = (): Date[] => {
    const first = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const startDay = first.getDay() || 7;
    const start = new Date(first);
    start.setDate(start.getDate() - (startDay - 1));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  };

  const handleCreate = async () => {
    if (!formTitle || !formDate || !formClientId) return;
    setIsSaving(true);
    const rrule = formRecurring === 'none' ? null : `FREQ=${formRecurring.toUpperCase()}`;
    const res = await createAppointment({
      title: formTitle,
      description: formDescription,
      start_time: `${formDate}T${formTimeStart}:00`,
      end_time: `${formDate}T${formTimeEnd}:00`,
      location: formLocation,
      type: formType,
      calendar_id: formCalendarId,
      recurring_rule: rrule,
      reminder_minutes: formReminder,
      client_id: formClientId,
    });
    setIsSaving(false); setShowAddModal(false);
    setFormTitle(''); setFormDescription(''); setFormDate(''); setFormLocation(''); setFormRecurring('none');
    void load();
    // Sprint 41 M3.3 — Toast création
    if (res?.error) {
      toastError(t('calendar.toast.create_error'));
    } else {
      success(t('calendar.toast.created'));
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const appt = active.data.current?.appointment as Appointment;
    const dropDate = over.data.current?.date as string;
    const dropHour = over.data.current?.hour as number | undefined;
    if (!appt || !dropDate) return;
    const oldStart = new Date(appt.start_time + (appt.start_time.endsWith('Z') ? '' : 'Z'));
    const oldEnd = new Date(appt.end_time + (appt.end_time.endsWith('Z') ? '' : 'Z'));
    const durationMs = oldEnd.getTime() - oldStart.getTime();
    let newStart = new Date(`${dropDate}T${oldStart.toLocaleTimeString('en-GB', { hour12: false })}`);
    if (dropHour !== undefined) {
      newStart = new Date(`${dropDate}T${String(dropHour).padStart(2, '0')}:00:00`);
    }
    const newEnd = new Date(newStart.getTime() + durationMs);
    setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, start_time: newStart.toISOString(), end_time: newEnd.toISOString() } : a));
    const res = await rescheduleAppointment(appt.id, newStart.toISOString(), newEnd.toISOString());
    void load();
    // Sprint 41 M3.3 — Toast déplacement
    if (res?.error) {
      toastError(t('calendar.toast.move_error'));
    } else {
      info(t('calendar.toast.moved'));
    }
  };

  // ── Resize handlers (Sprint 31 31-3B preserved) ──
  const startResize = useCallback((e: React.MouseEvent, appt: Appointment, mode: ResizeMode) => {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    e.stopPropagation();
    const baseStart = new Date(appt.start_time + (appt.start_time.endsWith('Z') ? '' : 'Z'));
    const baseEnd = new Date(appt.end_time + (appt.end_time.endsWith('Z') ? '' : 'Z'));
    setResizing({
      apptId: appt.id,
      mode,
      baseStartMs: baseStart.getTime(),
      baseEndMs: baseEnd.getTime(),
      startY: e.clientY,
      previewStartMs: baseStart.getTime(),
      previewEndMs: baseEnd.getTime(),
    });
    lastSnapMinRef.current = null;
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const deltaY = e.clientY - r.startY;
      const deltaMin = Math.round((deltaY * 60) / HOUR_PX);
      const snappedDeltaMin = Math.round(deltaMin / SNAP_MIN) * SNAP_MIN;
      let nextStartMs = r.baseStartMs;
      let nextEndMs = r.baseEndMs;
      if (r.mode === 'bottom') {
        nextEndMs = r.baseEndMs + snappedDeltaMin * 60_000;
      } else {
        nextStartMs = r.baseStartMs + snappedDeltaMin * 60_000;
      }
      const durMin = (nextEndMs - nextStartMs) / 60_000;
      if (durMin < MIN_DURATION_MIN) {
        if (r.mode === 'bottom') nextEndMs = nextStartMs + MIN_DURATION_MIN * 60_000;
        else nextStartMs = nextEndMs - MIN_DURATION_MIN * 60_000;
      }
      if (durMin > MAX_DURATION_MIN) {
        if (r.mode === 'bottom') nextEndMs = nextStartMs + MAX_DURATION_MIN * 60_000;
        else nextStartMs = nextEndMs - MAX_DURATION_MIN * 60_000;
      }
      if (lastSnapMinRef.current !== snappedDeltaMin) {
        lastSnapMinRef.current = snappedDeltaMin;
        haptic.vibrate('medium');
      }
      setResizing({ ...r, previewStartMs: nextStartMs, previewEndMs: nextEndMs });
    };
    const onUp = async () => {
      const r = resizingRef.current;
      if (!r) return;
      const hasChange = r.previewStartMs !== r.baseStartMs || r.previewEndMs !== r.baseEndMs;
      setResizing(null);
      lastSnapMinRef.current = null;
      if (!hasChange) return;
      const newStart = new Date(r.previewStartMs).toISOString();
      const newEnd = new Date(r.previewEndMs).toISOString();
      setAppointments(prev => prev.map(a => a.id === r.apptId ? { ...a, start_time: newStart, end_time: newEnd } : a));
      haptic.vibrate('success');
      try {
        const res = await rescheduleAppointment(r.apptId, newStart, newEnd);
        if (res.error) {
          toastError(t('calendar.toast.update_error'));
          void load();
        }
      } catch {
        toastError(t('calendar.toast.update_error'));
        void load();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing?.apptId]);

  const getResizedTimes = (appt: Appointment): { startMs: number; endMs: number; isResizing: boolean } => {
    const r = resizing;
    if (r && r.apptId === appt.id) {
      return { startMs: r.previewStartMs, endMs: r.previewEndMs, isResizing: true };
    }
    const s = new Date(appt.start_time + (appt.start_time.endsWith('Z') ? '' : 'Z'));
    const e = new Date(appt.end_time + (appt.end_time.endsWith('Z') ? '' : 'Z'));
    return { startMs: s.getTime(), endMs: e.getTime(), isResizing: false };
  };

  const changeStatus = async (id: string, status: AppointmentStatus) => {
    // Capture l'ancien statut pour permettre undo
    const prevAppt = appointments.find(a => a.id === id);
    const prevStatus = prevAppt?.status;
    await updateAppointment(id, { status });
    if (detailAppt?.id === id) setDetailAppt(prev => prev ? { ...prev, status } : null);
    void load();
    // Sprint 41 M3.3 — Toast feedback selon transition
    if (status === 'cancelled') {
      warning(t('calendar.toast.cancelled'), prevStatus && prevStatus !== 'cancelled' ? {
        action: {
          label: t('calendar.action.undo'),
          onClick: () => { void updateAppointment(id, { status: prevStatus }); void load(); },
        },
        duration: 5000,
      } : undefined);
    } else if (status === 'confirmed') {
      success(t('calendar.toast.confirmed'));
    }
  };

  const sendReminder = async (id: string) => {
    const res = await sendAppointmentReminderNow(id);
    if (res.error) toastError(t('calendar.toast.reminder_error', { err: res.error }));
    else success(t('calendar.toast.reminder_sent'));
  };

  const handleDuplicate = async (appt: Appointment) => {
    const start = new Date(appt.start_time + (appt.start_time.endsWith('Z') ? '' : 'Z'));
    const end = new Date(appt.end_time + (appt.end_time.endsWith('Z') ? '' : 'Z'));
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
    await createAppointment({
      title: `${appt.title} ${t('calendar.copy_suffix')}`,
      description: appt.description ?? '',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      location: appt.location ?? '',
      type: appt.type,
      calendar_id: appt.calendar_id ?? '',
      recurring_rule: null,
      reminder_minutes: 60,
      client_id: appt.client_id ?? clients[0]?.id ?? '',
    });
    // Sprint 41 M3.3 — Toast dupliqué
    success(t('calendar.toast.duplicated'));
    setDetailAppt(null);
    void load();
  };

  // ── Sprint 41 M3.1 — Keyboard shortcuts (Google Calendar-style) ───────────
  // t : today · n : new event · w/d/m : switch view · ←/→ : prev/next period
  // Escape : close detail panel
  useShortcuts({
    't': () => goToday(),
    'n': () => {
      setFormDate(dayStr(currentDate));
      setShowAddModal(true);
    },
    'w': () => setViewMode('week'),
    'd': () => setViewMode('day'),
    'm': () => setViewMode('month'),
    'ArrowLeft': () => navigate(-1),
    'ArrowRight': () => navigate(1),
    'Escape': () => {
      if (detailAppt) { setDetailAppt(null); return; }
      if (showAddModal) { setShowAddModal(false); return; }
    },
  });

  // Sprint 41 M3.4 — announce SR changement de view
  useEffect(() => {
    const label = viewMode === 'day' ? t('calendar.view.day') : viewMode === 'week' ? t('calendar.view.week') : viewMode === 'month' ? t('calendar.view.month') : t('calendar.view.agenda');
    announceSR(t('calendar.sr.showing', { view: label.toLowerCase() }), 'polite');
  }, [viewMode]);

  const hours = Array.from({ length: 15 }, (_, i) => i + 7); // 7h → 21h
  const weekDays = getWeekDays();
  const monthDays = getMonthDays();
  const periodLabel = viewMode === 'month'
    ? formatDate(currentDate, getLocale(), { month: 'long', year: 'numeric' })
    : viewMode === 'day'
    ? formatDate(currentDate, getLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : `${weekDays[0] ? formatDate(weekDays[0], getLocale(), { day: 'numeric', month: 'short' }) : ''} – ${weekDays[6] ? formatDate(weekDays[6], getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : ''}`;

  // Empty state check (week/day)
  const visibleApptsForRange = useMemo(() => {
    if (viewMode === 'week') return weekDays.flatMap(d => apptsFor(d));
    if (viewMode === 'day') return apptsFor(currentDate);
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, weekDays, currentDate, filteredAppointments]);

  // Sprint 44 M3.3 — Pull-to-refresh
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await load(); }, { scrollParent: scrollParentRef });

  // Sprint LOT 1-3 — Si load() a échoué globalement : on rend un block alert + retry
  // au lieu du calendrier vide (gap audit Calendar). L'utilisateur peut quand
  // même réessayer sans recharger la page.
  if (loadError && !isLoading) {
    return (
      <AppLayout title={t('calendar.page.title')}>
        <div className="p-6">
          <Card className="p-6 border border-[var(--danger)]/30" role="alert" aria-live="assertive">
            <p className="text-sm font-semibold text-[var(--danger)] mb-1">
              {t('calendar.error.load_failed')}
            </p>
            <p className="text-xs text-[var(--text-muted)] mb-3 break-all">{loadError}</p>
            <Button variant="secondary" onClick={() => void load()}>
              {t('action.retry')}
            </Button>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={t('calendar.page.title')}>
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <div className="cal-page">
        <PageHero
          title={t('calendar.page.title')}
          description={t('calendar.subtitle')}
          compact
        />
        <div className="cal-shell">

          {/* ── Sidebar : Mini-cal + filtres ──────────────────────── */}
          <aside className="cal-sidebar">
            <Button className="w-full" leftIcon={<Icon as={Plus} size={16} />} onClick={() => { setFormDate(dayStr(new Date())); setShowAddModal(true); }}>
              {t('calendar.new_event')}
            </Button>

            {/* Mini calendar Stripe-clean */}
            <div className="cal-minical">
              <div className="cal-minical-header">
                <button type="button" onClick={() => navigate(-1)} aria-label={t('calendar.aria.prev_month')} className="cal-minical-nav">
                  <Icon as={ChevronLeft} size={14} />
                </button>
                <span className="cal-minical-label">
                  {currentDate.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' })}
                </span>
                <button type="button" onClick={() => navigate(1)} aria-label={t('calendar.aria.next_month')} className="cal-minical-nav">
                  <Icon as={ChevronRight} size={14} />
                </button>
              </div>
              <div className="cal-minical-grid cal-minical-head">
                {['L','M','M','J','V','S','D'].map((d, i) => (
                  <div key={`${d}-${i}`} className="cal-minical-head-cell">{d}</div>
                ))}
              </div>
              <div className="cal-minical-grid">
                {monthDays.map((d, i) => {
                  const dayToday = isToday(d);
                  const otherMonth = d.getMonth() !== currentDate.getMonth();
                  const dayHasEvents = apptsFor(d).length > 0;
                  const isSelected = !dayToday && d.toDateString() === currentDate.toDateString();
                  const ariaLabel = t('calendar.aria.goto_date', { date: d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }) });
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setCurrentDate(d); setViewMode('day'); }}
                      aria-label={ariaLabel}
                      aria-current={dayToday ? 'date' : undefined}
                      data-today={dayToday || undefined}
                      data-selected={isSelected || undefined}
                      data-other-month={otherMonth || undefined}
                      className="cal-minical-cell"
                    >
                      <span className="cal-minical-num">{d.getDate()}</span>
                      {dayHasEvents && !dayToday && !isSelected && <span className="cal-minical-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Calendars filter */}
            <div className="cal-filters">
              <h3 className="cal-filters-title">{t('calendar.calendars')}</h3>
              <div className="cal-filters-list">
                {calendars.map(cal => {
                  const isChecked = selectedCalendars.has(cal.id);
                  const toggle = (next: boolean) => {
                    const newSet = new Set(selectedCalendars);
                    if (next) newSet.add(cal.id); else newSet.delete(cal.id);
                    setSelectedCalendars(newSet);
                  };
                  return (
                    <div
                      key={cal.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('[role="switch"]')) return;
                        toggle(!isChecked);
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && !(e.target as HTMLElement).closest('[role="switch"]')) {
                          e.preventDefault();
                          toggle(!isChecked);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={isChecked ? t('calendar.aria.toggle_calendar_hide', { name: cal.name }) : t('calendar.aria.toggle_calendar_show', { name: cal.name })}
                      aria-pressed={isChecked}
                      className="cal-filter-row"
                    >
                      <Switch size="sm" variant="brand" checked={isChecked} onCheckedChange={toggle} />
                      <span className="cal-filter-dot" style={{ background: cal.color }} aria-hidden="true" />
                      <span className="cal-filter-name">{cal.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* ── Main panel ───────────────────────────────────────── */}
          <div className="cal-main">
            {/* Toolbar Stripe-clean */}
            <div className="cal-toolbar">
              <div className="cal-toolbar-left">
                <div className="cal-toolbar-nav">
                  <button
                    type="button"
                    onClick={() => navigate(-1)}
                    aria-label={viewMode === 'month' ? t('calendar.aria.prev_month') : viewMode === 'day' ? t('calendar.aria.prev_day') : t('calendar.aria.prev_period')}
                    className="cal-nav-btn"
                  >
                    <Icon as={ChevronLeft} size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(1)}
                    aria-label={viewMode === 'month' ? t('calendar.aria.next_month') : viewMode === 'day' ? t('calendar.aria.next_day') : t('calendar.aria.next_period')}
                    className="cal-nav-btn"
                  >
                    <Icon as={ChevronRight} size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={goToday}
                    aria-label={t('calendar.aria.goto_today')}
                    className="cal-today-btn"
                  >
                    <Icon as={CalendarDays} size={14} />
                    <span>{t('calendar.today')}</span>
                  </button>
                </div>
                <h2 className="cal-period-label">{periodLabel}</h2>
              </div>

              <div className="cal-toolbar-right">
                {/* Sprint 33 C3 — badge agrégé sync calendrier (null si aucune connexion) */}
                <CalendarSyncStatusBadge compact />
                <div className="cal-view-switcher" role="tablist" aria-label={t('calendar.aria.view_mode')}>
                  {(['day', 'week', 'month', 'agenda'] as const).map(v => {
                    const label = v === 'day' ? t('calendar.view.day') : v === 'week' ? t('calendar.view.week') : v === 'month' ? t('calendar.view.month') : t('calendar.view.agenda');
                    const selected = viewMode === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-label={t('calendar.aria.view_named', { view: label.toLowerCase() })}
                        onClick={() => setViewMode(v)}
                        className={`cal-view-pill${selected ? ' is-active' : ''}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <Button variant="primary" size="sm" leftIcon={<Icon as={Plus} size={14} />} onClick={() => { setFormDate(dayStr(new Date())); setShowAddModal(true); }}>
                  {t('calendar.new_event')}
                </Button>
              </div>
            </div>

            {/* Views */}
            <DndContext onDragEnd={handleDragEnd} collisionDetection={pointerWithin}>
              {isLoading ? (
                viewMode === 'month' ? (
                  <Card className="cal-card-shell">
                    <div className="cal-month-headrow">
                      {['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(d => (
                        <div key={d} className="cal-month-head-cell">{d}</div>
                      ))}
                    </div>
                    <div className="cal-month-grid">
                      {Array.from({ length: 42 }).map((_, i) => (
                        <div key={i} className="cal-month-cell">
                          <Skeleton className="h-3 w-5" style={{ animationDelay: `${i * 20}ms` }} />
                          {i % 3 === 0 && <Skeleton className="h-3 w-full rounded mt-1" style={{ animationDelay: `${i * 20 + 30}ms` }} />}
                          {i % 4 === 0 && <Skeleton className="h-3 w-3/4 rounded mt-1" style={{ animationDelay: `${i * 20 + 60}ms` }} />}
                        </div>
                      ))}
                    </div>
                  </Card>
                ) : viewMode === 'agenda' ? (
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Card key={i} className="cal-agenda-row">
                        <div className="cal-skeleton-agenda-row" style={{ animationDelay: `${i * 60}ms` }}>
                          <div className="cal-skeleton-agenda-date">
                            <Skeleton className="h-5 w-6" style={{ animationDelay: `${i * 60}ms` }} />
                            <Skeleton className="h-3 w-8 mt-1" style={{ animationDelay: `${i * 60 + 20}ms` }} />
                          </div>
                          <div className="cal-skeleton-agenda-main">
                            <Skeleton className="h-3.5 w-2/3" style={{ animationDelay: `${i * 60 + 40}ms` }} />
                            <Skeleton className="h-3 w-1/2 mt-2" style={{ animationDelay: `${i * 60 + 60}ms` }} />
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  /* Sprint 41 M3.2 — Week/Day skeleton fidèle au layout (7 cols × hours + 5 events placeholders) */
                  <Card className="cal-card-shell cal-skeleton-week">
                    <div className="cal-week-inner">
                      <div className="cal-week-headrow">
                        <div className="cal-week-gutter" />
                        <div className="cal-week-headcols">
                          {(viewMode === 'day' ? [0] : [0,1,2,3,4,5,6]).map(i => (
                            <div key={i} className="cal-week-headcol">
                              <Skeleton className="h-3 w-8 mx-auto" style={{ animationDelay: `${i * 40}ms` }} />
                              <Skeleton className="h-4 w-6 mx-auto mt-1" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="cal-week-body">
                        <div className="cal-week-gutter">
                          {hours.map(h => (
                            <div key={h} className="cal-hour-label">
                              <Skeleton className="h-2.5 w-9" style={{ animationDelay: `${h * 30}ms` }} />
                            </div>
                          ))}
                        </div>
                        <div className="cal-week-cols">
                          {(viewMode === 'day' ? [0] : [0,1,2,3,4,5,6]).map(colIdx => {
                            // 5 placeholders positionnés entre 9h-17h, déterministe par colIdx
                            const seeds = [
                              { hour: 9 + (colIdx % 3), duration: 60 },
                              { hour: 11 + (colIdx % 2), duration: 45 },
                              { hour: 14 + (colIdx % 3), duration: 90 },
                              { hour: 16 + (colIdx % 2), duration: 30 },
                            ];
                            // Variations : ne pas montrer tous les events sur toutes les colonnes
                            const visibleSeeds = seeds.filter((_, i) => (colIdx + i) % 2 === 0);
                            return (
                              <div key={colIdx} className="cal-week-col">
                                {hours.map(h => <div key={h} className="cal-hour-slot" aria-hidden="true" />)}
                                {visibleSeeds.map((seed, i) => {
                                  const top = (seed.hour - 7) * HOUR_PX + 4;
                                  const height = (seed.duration / 60) * HOUR_PX - 8;
                                  return (
                                    <div
                                      key={i}
                                      className="cal-skeleton-event"
                                      style={{ top: `${top}px`, height: `${height}px`, animationDelay: `${(colIdx * 80) + (i * 40)}ms` }}
                                      aria-hidden="true"
                                    />
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              ) : viewMode === 'month' ? (
                /* ── Vue Mois ── */
                <Card className="cal-card-shell print-calendar-month">
                  <div className="cal-month-headrow">
                    {['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(d => (
                      <div key={d} className="cal-month-head-cell">{d}</div>
                    ))}
                  </div>
                  <div className="cal-month-grid print-calendar-grid">
                    {monthDays.map(day => {
                      const dateKey = dayStr(day);
                      const dayAppts = apptsFor(day);
                      const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                      const dayToday = isToday(day);
                      const visible = dayAppts.slice(0, 3);
                      const overflow = dayAppts.length - visible.length;
                      return (
                        <DroppableSlot
                          key={dateKey}
                          id={`month-${dateKey}`}
                          date={dateKey}
                          className={`cal-month-cell${dayToday ? ' is-today' : ''}${!isCurrentMonth ? ' is-other-month' : ''}`}
                        >
                          <div className="cal-month-cell-head">
                            <span className={`cal-month-cell-num${dayToday ? ' is-today' : ''}`}>{day.getDate()}</span>
                          </div>
                          <div className="cal-month-cell-events">
                            {visible.map(a => {
                              const cal = calendars.find(c => c.id === a.calendar_id);
                              const color = cal?.color;
                              const variant = typeToVariant(a.type);
                              return (
                                <DraggableEvent key={a.id} appointment={a}>
                                  <AppointmentHoverWrap appointment={a}>
                                    <button
                                      type="button"
                                      onClick={() => setDetailAppt(a)}
                                      aria-label={t('calendar.aria.appt_at', { title: a.title, time: fmtTime(a.start_time) })}
                                      className="cal-month-event"
                                      title={`${fmtTime(a.start_time)} · ${a.title}`}
                                    >
                                      <Tag dot size="xs" variant={variant} color={color}>
                                        <span className="cal-month-event-time">{fmtTime(a.start_time)}</span>
                                        <span className="cal-month-event-title">{a.title}</span>
                                      </Tag>
                                    </button>
                                  </AppointmentHoverWrap>
                                </DraggableEvent>
                              );
                            })}
                            {overflow > 0 && (
                              <button
                                type="button"
                                className="cal-month-more"
                                onClick={() => { setCurrentDate(day); setViewMode('day'); }}
                                aria-label={overflow > 1 ? t('calendar.aria.see_more_other', { n: overflow }) : t('calendar.aria.see_more_one', { n: overflow })}
                              >
                                {overflow > 1 ? t('calendar.more_other', { n: overflow }) : t('calendar.more_one', { n: overflow })}
                              </button>
                            )}
                          </div>
                        </DroppableSlot>
                      );
                    })}
                  </div>
                </Card>
              ) : viewMode === 'week' ? (
                /* ── Vue Semaine ── */
                <Card className="cal-card-shell cal-week">
                  <div className="cal-week-inner">
                    {/* Days header */}
                    <div className="cal-week-headrow">
                      <div className="cal-week-gutter" />
                      <div className="cal-week-headcols">
                        {weekDays.map(day => (
                          <div key={day.toISOString()} className={`cal-week-headcol${isToday(day) ? ' is-today' : ''}`}>
                            <div className="cal-week-dayname">{day.toLocaleDateString('fr-CA', { weekday: 'short' })}</div>
                            <div className={`cal-week-daynum${isToday(day) ? ' is-today' : ''}`}>{day.getDate()}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Grid */}
                    <div className="cal-week-body">
                      <div className="cal-week-gutter">
                        {hours.map(h => (
                          <div key={h} className="cal-hour-label">{h.toString().padStart(2, '0')}:00</div>
                        ))}
                      </div>
                      <div className="cal-week-cols">
                        {weekDays.map(day => {
                          const dateKey = dayStr(day);
                          const dayIsToday = isToday(day);
                          const nowTop = (nowTick.getHours() - 7) * HOUR_PX + (nowTick.getMinutes() / 60) * HOUR_PX;
                          const showLive = dayIsToday && nowTick.getHours() >= 7 && nowTick.getHours() < 22;
                          return (
                            <div key={dateKey} className={`cal-week-col${dayIsToday ? ' is-today' : ''}`}>
                              {hours.map(h => (
                                <DroppableSlot key={`${dateKey}-${h}`} id={`week-${dateKey}-${h}`} date={dateKey} hour={h} className="cal-hour-slot" />
                              ))}
                              {showLive && (
                                <div className="cal-live-line" style={{ top: `${Math.max(0, nowTop)}px` }} aria-hidden="true">
                                  <span className="cal-live-dot" />
                                </div>
                              )}
                              {apptsFor(day).map(a => {
                                const { startMs, endMs, isResizing } = getResizedTimes(a);
                                const start = new Date(startMs);
                                const end = new Date(endMs);
                                const top = (start.getHours() - 7) * HOUR_PX + (start.getMinutes() / 60) * HOUR_PX;
                                const durMin = (endMs - startMs) / 60_000;
                                const height = Math.max(28, (durMin / 60) * HOUR_PX);
                                const cal = calendars.find(c => c.id === a.calendar_id);
                                const color = cal?.color;
                                const variant = typeToVariant(a.type);
                                const fmtFromDate = (d: Date) => d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
                                return (
                                  <div
                                    key={a.id}
                                    className={`cal-event-wrap${isResizing ? ' is-resizing' : ''}`}
                                    style={{ top: `${Math.max(0, top)}px`, height: `${height}px`, zIndex: isResizing ? 12 : 6 }}
                                  >
                                    <DraggableEvent appointment={a}>
                                      <AppointmentHoverWrap appointment={a}>
                                        <div
                                          onClick={() => setDetailAppt(a)}
                                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailAppt(a); } }}
                                          tabIndex={0}
                                          role="button"
                                          aria-label={t('calendar.aria.appt_at', { title: a.title, time: fmtFromDate(start) })}
                                          className={`cal-event cal-event--${variant}`}
                                          style={color ? ({ ['--event-color' as any]: color }) : undefined}
                                        >
                                          <span
                                            className="cal-event-handle cal-event-handle--top"
                                            onMouseDown={(e) => startResize(e, a, 'top')}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            aria-hidden="true"
                                          >
                                            <Icon as={ChevronsUpDown} size={8} />
                                          </span>
                                          <div className="cal-event-title">{a.title}</div>
                                          <div className="cal-event-time">{fmtFromDate(start)}{isResizing ? ` – ${fmtFromDate(end)}` : ''}</div>
                                          <span
                                            className="cal-event-handle cal-event-handle--bottom"
                                            onMouseDown={(e) => startResize(e, a, 'bottom')}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            aria-hidden="true"
                                          >
                                            <Icon as={ChevronsUpDown} size={8} />
                                          </span>
                                        </div>
                                      </AppointmentHoverWrap>
                                    </DraggableEvent>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  {visibleApptsForRange.length === 0 && (
                    <CalendarEmptyOverlay
                      title={t('calendar.empty.week')}
                      onCreate={() => { setFormDate(dayStr(new Date())); setShowAddModal(true); }}
                    />
                  )}
                </Card>
              ) : viewMode === 'day' ? (
                /* ── Vue Jour ── */
                <Card className="cal-card-shell cal-day">
                  <div className="cal-week-inner">
                    <div className="cal-week-body">
                      <div className="cal-week-gutter">
                        {hours.map(h => (
                          <div key={h} className="cal-hour-label">{h.toString().padStart(2, '0')}:00</div>
                        ))}
                      </div>
                      <div className="cal-day-col-wrap">
                        {(() => {
                          const dayIsToday = isToday(currentDate);
                          const nowTop = (nowTick.getHours() - 7) * HOUR_PX + (nowTick.getMinutes() / 60) * HOUR_PX;
                          const showLive = dayIsToday && nowTick.getHours() >= 7 && nowTick.getHours() < 22;
                          return (
                            <div className={`cal-day-col${dayIsToday ? ' is-today' : ''}`}>
                              {hours.map(h => (
                                <DroppableSlot key={h} id={`day-${dayStr(currentDate)}-${h}`} date={dayStr(currentDate)} hour={h} className="cal-hour-slot" />
                              ))}
                              {showLive && (
                                <div className="cal-live-line" style={{ top: `${Math.max(0, nowTop)}px` }} aria-hidden="true">
                                  <span className="cal-live-dot" />
                                </div>
                              )}
                              {apptsFor(currentDate).map(a => {
                                const { startMs, endMs, isResizing } = getResizedTimes(a);
                                const start = new Date(startMs);
                                const end = new Date(endMs);
                                const top = (start.getHours() - 7) * HOUR_PX + (start.getMinutes() / 60) * HOUR_PX;
                                const durMin = (endMs - startMs) / 60_000;
                                const height = Math.max(36, (durMin / 60) * HOUR_PX);
                                const cal = calendars.find(c => c.id === a.calendar_id);
                                const color = cal?.color;
                                const variant = typeToVariant(a.type);
                                const fmtFromDate = (d: Date) => d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
                                return (
                                  <div
                                    key={a.id}
                                    className={`cal-event-wrap cal-event-wrap--day${isResizing ? ' is-resizing' : ''}`}
                                    style={{ top: `${Math.max(0, top)}px`, height: `${height}px`, zIndex: isResizing ? 12 : 6 }}
                                  >
                                    <AppointmentHoverWrap appointment={a}>
                                      <div
                                        onClick={() => setDetailAppt(a)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailAppt(a); } }}
                                        tabIndex={0}
                                        role="button"
                                        aria-label={t('calendar.aria.appt_from_to', { title: a.title, start: fmtFromDate(start), end: fmtFromDate(end) })}
                                        className={`cal-event cal-event--${variant} cal-event--day`}
                                        style={color ? ({ ['--event-color' as any]: color }) : undefined}
                                      >
                                        <span className="cal-event-handle cal-event-handle--top" onMouseDown={(e) => startResize(e, a, 'top')} onPointerDown={(e) => e.stopPropagation()} aria-hidden="true">
                                          <Icon as={ChevronsUpDown} size={8} />
                                        </span>
                                        <div className="cal-event-row">
                                          <span className="cal-event-title">{a.title}</span>
                                          <span className="cal-event-time">{fmtFromDate(start)} – {fmtFromDate(end)}</span>
                                        </div>
                                        {a.lead_name && <div className="cal-event-meta"><Icon as={User} size={11} /> {a.lead_name}</div>}
                                        {a.location && <div className="cal-event-meta"><Icon as={MapPin} size={11} /> {a.location}</div>}
                                        <span className="cal-event-handle cal-event-handle--bottom" onMouseDown={(e) => startResize(e, a, 'bottom')} onPointerDown={(e) => e.stopPropagation()} aria-hidden="true">
                                          <Icon as={ChevronsUpDown} size={8} />
                                        </span>
                                      </div>
                                    </AppointmentHoverWrap>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  {visibleApptsForRange.length === 0 && (
                    <CalendarEmptyOverlay
                      title={t('calendar.empty.day')}
                      onCreate={() => { setFormDate(dayStr(currentDate)); setShowAddModal(true); }}
                    />
                  )}
                </Card>
              ) : (
                /* ── Vue Agenda ── */
                <div className="cal-agenda">
                  {filteredAppointments.length === 0 ? (
                    <Card className="cal-card-shell">
                      <CalendarEmptyOverlay
                        title={t('calendar.empty.none')}
                        onCreate={() => { setFormDate(dayStr(new Date())); setShowAddModal(true); }}
                      />
                    </Card>
                  ) : (
                    [...filteredAppointments].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()).map(appt => {
                      const isPast = new Date(appt.start_time + 'Z') < new Date();
                      const cal = calendars.find(c => c.id === appt.calendar_id);
                      const variant = typeToVariant(appt.type);
                      return (
                        <button
                          key={appt.id}
                          type="button"
                          className={`cal-agenda-row${isPast ? ' is-past' : ''}`}
                          onClick={() => setDetailAppt(appt)}
                          aria-label={t('calendar.aria.appt_named', { title: appt.title })}
                        >
                          <div className="cal-agenda-date">
                            <span className="cal-agenda-day">{new Date(appt.start_time + 'Z').toLocaleDateString('fr-CA', { day: '2-digit' })}</span>
                            <span className="cal-agenda-month">{new Date(appt.start_time + 'Z').toLocaleDateString('fr-CA', { month: 'short' })}</span>
                          </div>
                          <div className="cal-agenda-main">
                            <div className="cal-agenda-title-row">
                              <span className="cal-agenda-title">{appt.title}</span>
                              <Tag dot size="xs" variant={variant} color={cal?.color}>{APPOINTMENT_TYPE_LABELS[appt.type]}</Tag>
                              <Tag size="xs" variant={statusToVariant(appt.status)} statusIcon>{APPOINTMENT_STATUS_LABELS[appt.status]}</Tag>
                            </div>
                            <div className="cal-agenda-meta">
                              <span><Icon as={Clock} size={12} /> {fmtTime(appt.start_time)} – {fmtTime(appt.end_time)}</span>
                              {cal && <span><span className="cal-filter-dot" style={{ background: cal.color }} /> {cal.name}</span>}
                              {appt.location && <span><Icon as={MapPin} size={12} /> {appt.location}</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </DndContext>

            {/* Sprint 49 — Sync calendriers externes (Google Calendar / Outlook) */}
            <ExternalCalendarSync />
          </div>
        </div>
      </div>

      {/* ── Modal création ──────────────────────────────────────── */}
      <Modal open={showAddModal} onOpenChange={() => setShowAddModal(false)} title={t('calendar.modal.title')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">{t('calendar.field.client')} <span className="text-[var(--danger)]">*</span></label>
              <Select value={formClientId} onChange={e => setFormClientId(e.target.value)} size="md">
                <option value="">{t('calendar.field.client_ph')}</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">{t('calendar.field.calendar')}</label>
              <Select value={formCalendarId} onChange={e => setFormCalendarId(e.target.value)} size="md">
                {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block">{t('calendar.field.event_title')} <span className="text-[var(--danger)]">*</span></label>
            <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder={t('calendar.field.event_title_ph')} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs font-medium mb-1 block">{t('calendar.field.date')}</label><Input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} /></div>
            <div><label className="text-xs font-medium mb-1 block">{t('calendar.field.start')}</label><Input type="time" value={formTimeStart} onChange={e => setFormTimeStart(e.target.value)} /></div>
            <div><label className="text-xs font-medium mb-1 block">{t('calendar.field.end')}</label><Input type="time" value={formTimeEnd} onChange={e => setFormTimeEnd(e.target.value)} /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">{t('calendar.field.type')}</label>
              <Select value={formType} onChange={e => setFormType(e.target.value as AppointmentType)} size="md">
                {APPOINTMENT_TYPES.map(at => <option key={at} value={at}>{APPOINTMENT_TYPE_LABELS[at]}</option>)}
              </Select>
            </div>
            <div><label className="text-xs font-medium mb-1 block">{t('calendar.field.location')}</label><Input value={formLocation} onChange={e => setFormLocation(e.target.value)} /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">{t('calendar.field.recurrence')}</label>
              <Select value={formRecurring} onChange={e => setFormRecurring(e.target.value)} size="md">
                <option value="none">{t('calendar.recurrence.none')}</option>
                <option value="daily">{t('calendar.recurrence.daily')}</option>
                <option value="weekly">{t('calendar.recurrence.weekly')}</option>
                <option value="monthly">{t('calendar.recurrence.monthly')}</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">{t('calendar.field.reminder')}</label>
              <Input type="number" value={formReminder} onChange={e => setFormReminder(Number(e.target.value))} />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block">{t('calendar.field.notes')}</label>
            <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm resize-none" />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setShowAddModal(false)}>{t('calendar.cancel')}</Button>
            <Button onClick={() => void handleCreate()} disabled={isSaving || !formTitle || !formDate || !formCalendarId || !formClientId}>
              {isSaving ? t('calendar.creating') : t('calendar.create_event')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── SlidePanel détail Stripe ────────────────────────────── */}
      <SlidePanel
        open={!!detailAppt}
        onOpenChange={(o) => { if (!o) setDetailAppt(null); }}
        title={detailAppt?.title ?? t('calendar.detail.title')}
        size="sm"
        footer={detailAppt ? (
          <div className="cal-event-panel-footer">
            <Button variant="ghost" size="sm" leftIcon={<Icon as={Check} size={14} />} onClick={() => void changeStatus(detailAppt.id, 'confirmed')} disabled={detailAppt.status === 'confirmed'}>{t('calendar.detail.confirm')}</Button>
            <Button variant="ghost" size="sm" leftIcon={<Icon as={BellRing} size={14} />} onClick={() => void sendReminder(detailAppt.id)}>{t('calendar.detail.reminder')}</Button>
            <Button variant="ghost" size="sm" leftIcon={<Icon as={Copy} size={14} />} onClick={() => void handleDuplicate(detailAppt)}>{t('calendar.detail.duplicate')}</Button>
            <Button variant="ghost" size="sm" leftIcon={<Icon as={Trash2} size={14} />} className="cal-event-panel-danger" onClick={() => void changeStatus(detailAppt.id, 'cancelled')} disabled={detailAppt.status === 'cancelled'}>{t('calendar.detail.cancel')}</Button>
          </div>
        ) : undefined}
      >
        {detailAppt && (() => {
          const cal = calendars.find(c => c.id === detailAppt.calendar_id);
          const variant = typeToVariant(detailAppt.type);
          const startD = new Date(detailAppt.start_time + (detailAppt.start_time.endsWith('Z') ? '' : 'Z'));
          const endD = new Date(detailAppt.end_time + (detailAppt.end_time.endsWith('Z') ? '' : 'Z'));
          return (
            <div className="cal-event-panel">
              <div className="cal-event-panel-tags">
                <Tag size="xs" variant={variant} dot color={cal?.color}>{APPOINTMENT_TYPE_LABELS[detailAppt.type]}</Tag>
                <Tag size="xs" variant={statusToVariant(detailAppt.status)} statusIcon>{APPOINTMENT_STATUS_LABELS[detailAppt.status]}</Tag>
              </div>

              <div className="cal-event-panel-row">
                <Icon as={Clock} size={14} className="cal-event-panel-icon" />
                <div>
                  <div className="cal-event-panel-row-primary">
                    {startD.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'long' })}
                  </div>
                  <div className="cal-event-panel-row-secondary">
                    {startD.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false })} – {endD.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </div>
                </div>
              </div>

              {detailAppt.location && (
                <div className="cal-event-panel-row">
                  <Icon as={MapPin} size={14} className="cal-event-panel-icon" />
                  <a href={detailAppt.location.startsWith('http') ? detailAppt.location : `https://maps.google.com/?q=${detailAppt.location}`} target="_blank" rel="noreferrer" className="cal-event-panel-link">
                    {detailAppt.location}
                    <Icon as={ExternalLink} size={12} />
                  </a>
                </div>
              )}

              {detailAppt.lead_name && (
                <div className="cal-event-panel-row">
                  <Icon as={User} size={14} className="cal-event-panel-icon" />
                  <div className="cal-event-panel-row-primary">{detailAppt.lead_name}</div>
                </div>
              )}

              {cal && (
                <div className="cal-event-panel-row">
                  <span className="cal-filter-dot" style={{ background: cal.color }} aria-hidden="true" />
                  <div className="cal-event-panel-row-secondary">{cal.name}</div>
                </div>
              )}

              {detailAppt.description && (
                <div className="cal-event-panel-desc">
                  {detailAppt.description}
                </div>
              )}

              <div className="cal-event-panel-row">
                <Icon as={X} size={14} className="cal-event-panel-icon" />
                <button
                  type="button"
                  className="cal-event-panel-link"
                  onClick={() => void changeStatus(detailAppt.id, 'cancelled')}
                  disabled={detailAppt.status === 'cancelled'}
                >
                  {t('calendar.detail.mark_cancelled')}
                </button>
              </div>
            </div>
          );
        })()}
      </SlidePanel>

      </div>
    </AppLayout>
  );
}

// ── Empty state overlay centré ──────────────────────────────────────────────
// Sprint 45 M2.2 — Illustration Stripe-clean (kind="calendar") + animation float
function CalendarEmptyOverlay({ title, onCreate }: { title: string; onCreate: () => void }) {
  return (
    <EmptyState
      className="cal-empty-overlay"
      illustration={<EmptyStateIllustration kind="calendar" size={140} />}
      title={title}
      description={t('calendar.empty.desc')}
      action={
        <Button variant="primary" size="sm" leftIcon={<Icon as={Plus} size={14} />} onClick={onCreate}>
          {t('calendar.new_event')}
        </Button>
      }
    />
  );
}
