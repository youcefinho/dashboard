import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Modal, Skeleton, EmptyState } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { getAppointments, createAppointment, updateAppointment, rescheduleAppointment, getCalendars, sendAppointmentReminderNow, type Calendar as CalType } from '@/lib/api';
import type { Appointment, AppointmentType, AppointmentStatus } from '@/lib/types';
import { APPOINTMENT_TYPE_LABELS, APPOINTMENT_TYPE_ICONS, APPOINTMENT_TYPE_COLORS, APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPES } from '@/lib/types';
import { ChevronLeft, ChevronRight, CalendarDays, Clock, MapPin, User, Plus, Check, X, BellRing, ExternalLink } from 'lucide-react';
import { DndContext, useDraggable, useDroppable, DragEndEvent, pointerWithin } from '@dnd-kit/core';

type ViewMode = 'day' | 'week' | 'month' | 'agenda';

// --- DnD Components ---
function DraggableEvent({ appointment, children }: { appointment: Appointment, children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appointment.id,
    data: { appointment }
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10, opacity: isDragging ? 0.8 : 1 } : undefined;
  
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="cursor-move">
      {children}
    </div>
  );
}

function DroppableSlot({ id, date, hour, children, className }: { id: string, date: string, hour?: number, children?: React.ReactNode, className?: string }) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { date, hour }
  });
  return (
    <div ref={setNodeRef} className={`${className || ''} ${isOver ? 'bg-[var(--brand-tint)]/50 ring-2 ring-[var(--brand-primary)] ring-inset' : ''}`}>
      {children}
    </div>
  );
}
// ----------------------

export function CalendarPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [calendars, setCalendars] = useState<CalType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  
  // Sidebar Filters
  const [selectedCalendars, setSelectedCalendars] = useState<Set<string>>(new Set());
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState<Appointment | null>(null);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTimeStart, setFormTimeStart] = useState('10:00');
  const [formTimeEnd, setFormTimeEnd] = useState('11:00');
  const [formLocation, setFormLocation] = useState('');
  const [formType, setFormType] = useState<AppointmentType>('meeting');
  const [formCalendarId, setFormCalendarId] = useState('');
  const [formRecurring, setFormRecurring] = useState('none');
  const [formReminder, setFormReminder] = useState(60);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const [apptRes, calRes] = await Promise.all([
      getAppointments(),
      getCalendars()
    ]);
    if (apptRes.data) setAppointments(apptRes.data);
    if (calRes.data) {
      setCalendars(calRes.data);
      if (calRes.data.length > 0 && selectedCalendars.size === 0) {
        setSelectedCalendars(new Set(calRes.data.map(c => c.id)));
        setFormCalendarId(calRes.data[0]!.id);
      }
    }
    setIsLoading(false);
  }, [selectedCalendars.size]);

  useEffect(() => { void load(); }, [load]);

  // Derived
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
  const fmtTime = (s: string) => new Date(s + (s.endsWith('Z') ? '' : 'Z')).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });

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
    if (!formTitle || !formDate) return;
    setIsSaving(true);
    let rrule = formRecurring === 'none' ? null : `FREQ=${formRecurring.toUpperCase()}`;
    await createAppointment({ 
      title: formTitle, 
      description: formDescription, 
      start_time: `${formDate}T${formTimeStart}:00`, 
      end_time: `${formDate}T${formTimeEnd}:00`, 
      location: formLocation, 
      type: formType, 
      calendar_id: formCalendarId,
      recurring_rule: rrule,
      reminder_minutes: formReminder,
      client_id: 'internal' // or dynamic
    });
    setIsSaving(false); setShowAddModal(false);
    setFormTitle(''); setFormDescription(''); setFormDate(''); setFormLocation(''); setFormRecurring('none');
    void load();
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

    let newStart = new Date(`${dropDate}T${oldStart.toLocaleTimeString('en-GB', {hour12: false})}`);
    if (dropHour !== undefined) {
      newStart = new Date(`${dropDate}T${String(dropHour).padStart(2, '0')}:00:00`);
    }
    const newEnd = new Date(newStart.getTime() + durationMs);

    // Optimistic UI Update
    setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, start_time: newStart.toISOString(), end_time: newEnd.toISOString() } : a));
    
    await rescheduleAppointment(appt.id, newStart.toISOString(), newEnd.toISOString());
    void load();
  };

  const changeStatus = async (id: string, status: AppointmentStatus) => { 
    await updateAppointment(id, { status }); 
    if (showDetailModal?.id === id) setShowDetailModal(prev => prev ? { ...prev, status } : null);
    void load(); 
  };

  const sendReminder = async (id: string) => {
    await sendAppointmentReminderNow(id);
    alert('Rappel envoyé !');
  };

  const hours = Array.from({ length: 15 }, (_, i) => i + 7); // 7h-21h
  const weekDays = getWeekDays();
  const monthDays = getMonthDays();
  const periodLabel = viewMode === 'month'
    ? currentDate.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' })
    : viewMode === 'day'
    ? currentDate.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : `${weekDays[0]?.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })} — ${weekDays[6]?.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <AppLayout title="Calendrier">
      <div className="flex flex-col lg:flex-row gap-6">
        
        {/* ── Sidebar ── */}
        <div className="w-full lg:w-64 flex-shrink-0 space-y-6">
          <Button className="w-full" leftIcon={<Plus size={16} />} onClick={() => { setFormDate(dayStr(new Date())); setShowAddModal(true); }}>
            Nouveau RDV
          </Button>

          {/* Mini Calendar Picker */}
          <Card className="p-3">
             <div className="flex items-center justify-between mb-3 px-1">
               <button onClick={() => navigate(-1)} className="p-1 hover:bg-[var(--bg-subtle)] rounded"><ChevronLeft size={14}/></button>
               <span className="text-xs font-bold capitalize">{currentDate.toLocaleDateString('fr-CA', { month: 'short', year: 'numeric' })}</span>
               <button onClick={() => navigate(1)} className="p-1 hover:bg-[var(--bg-subtle)] rounded"><ChevronRight size={14}/></button>
             </div>
             <div className="grid grid-cols-7 gap-1 text-center mb-1">
               {['L','M','M','J','V','S','D'].map(d => <div key={d} className="text-[10px] font-semibold text-[var(--text-muted)]">{d}</div>)}
             </div>
             <div className="grid grid-cols-7 gap-1 text-center">
               {monthDays.map((d, i) => (
                 <button key={i} onClick={() => { setCurrentDate(d); setViewMode('day'); }}
                   className={`text-[11px] h-6 w-6 mx-auto rounded flex items-center justify-center hover:bg-[var(--brand-tint)]
                   ${d.getMonth() !== currentDate.getMonth() ? 'text-[var(--text-muted)] opacity-50' : 'text-[var(--text-primary)]'}
                   ${isToday(d) ? 'bg-[var(--brand-primary)] text-white font-bold' : ''}`}>
                   {d.getDate()}
                 </button>
               ))}
             </div>
          </Card>

          {/* Calendars Filter */}
          <div>
            <h3 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Mes Calendriers</h3>
            <div className="space-y-2">
              {calendars.map(cal => (
                <label key={cal.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-[var(--bg-subtle)] p-1.5 rounded -ml-1.5">
                  <input type="checkbox" checked={selectedCalendars.has(cal.id)} onChange={e => {
                    const newSet = new Set(selectedCalendars);
                    if (e.target.checked) newSet.add(cal.id); else newSet.delete(cal.id);
                    setSelectedCalendars(newSet);
                  }} className="rounded border-[var(--border-default)]" style={{ accentColor: cal.color }} />
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: cal.color }}></span>
                  <span className="truncate">{cal.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ── Main View ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-[var(--text-primary)] capitalize">{periodLabel}</h2>
              <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5 ml-4">
                {(['day', 'week', 'month', 'agenda'] as const).map(v => (
                  <button key={v} onClick={() => setViewMode(v)}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium cursor-pointer transition-all
                      ${viewMode === v ? 'bg-[var(--brand-primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                    {v === 'day' ? 'Jour' : v === 'week' ? 'Semaine' : v === 'month' ? 'Mois' : 'Agenda'}
                  </button>
                ))}
              </div>
              <button onClick={goToday} className="ml-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--brand-tint)] text-[var(--brand-primary)] hover:bg-[var(--brand-soft)] transition-all">Aujourd'hui</button>
            </div>
            <div className="flex items-center gap-2">
               <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg border hover:bg-[var(--bg-subtle)] text-[var(--text-muted)]"><ChevronLeft size={16} /></button>
               <button onClick={() => navigate(1)} className="p-1.5 rounded-lg border hover:bg-[var(--bg-subtle)] text-[var(--text-muted)]"><ChevronRight size={16} /></button>
            </div>
          </div>

          <DndContext onDragEnd={handleDragEnd} collisionDetection={pointerWithin}>
            {isLoading ? (
              <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : viewMode === 'month' ? (
              /* ── Vue Mois ── */
              <Card className="p-0 overflow-hidden flex-1 flex flex-col">
                <div className="grid grid-cols-7 border-b border-[var(--border-subtle)]">
                  {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => (
                    <div key={d} className="text-center text-[11px] font-semibold text-[var(--text-secondary)] uppercase py-2">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 flex-1 auto-rows-fr bg-[var(--border-subtle)] gap-px">
                  {monthDays.map(day => {
                    const dateKey = dayStr(day);
                    const dayAppts = apptsFor(day);
                    const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                    return (
                      <DroppableSlot key={dateKey} id={`month-${dateKey}`} date={dateKey} className={`min-h-[100px] p-1.5 bg-[var(--bg-surface)] ${!isCurrentMonth ? 'opacity-50' : ''}`}>
                        <div className="flex justify-between items-start mb-1">
                          <p className={`text-[11px] font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday(day) ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-primary)]'}`}>
                            {day.getDate()}
                          </p>
                        </div>
                        <div className="space-y-1">
                          {dayAppts.map(a => {
                            const cal = calendars.find(c => c.id === a.calendar_id);
                            const color = cal?.color || APPOINTMENT_TYPE_COLORS[a.type];
                            return (
                              <DraggableEvent key={a.id} appointment={a}>
                                <div onClick={() => setShowDetailModal(a)} className="text-[10px] px-1.5 py-0.5 rounded truncate font-medium cursor-pointer hover:opacity-80 transition-opacity"
                                  style={{ background: `${color}15`, color: color, borderLeft: `2px solid ${color}` }}>
                                  {fmtTime(a.start_time)} {a.title}
                                </div>
                              </DraggableEvent>
                            );
                          })}
                        </div>
                      </DroppableSlot>
                    );
                  })}
                </div>
              </Card>
            ) : viewMode === 'week' ? (
              /* ── Vue Semaine ── */
              <Card className="p-0 flex-1 flex flex-col overflow-auto min-h-[600px]">
                <div className="flex border-b border-[var(--border-subtle)]">
                  <div className="w-16 flex-shrink-0" />
                  <div className="flex-1 grid grid-cols-7">
                    {weekDays.map(day => (
                      <div key={day.toISOString()} className="text-center py-2 border-l border-[var(--border-subtle)]">
                        <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase">{day.toLocaleDateString('fr-CA', { weekday: 'short' })}</div>
                        <div className={`text-lg font-bold mt-0.5 mx-auto w-8 h-8 flex items-center justify-center rounded-full ${isToday(day) ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-primary)]'}`}>{day.getDate()}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-1">
                  <div className="w-16 flex-shrink-0 border-r border-[var(--border-subtle)]">
                    {hours.map(h => <div key={h} className="h-16 text-[10px] font-medium text-[var(--text-muted)] text-right pr-2 pt-1">{h}:00</div>)}
                  </div>
                  <div className="flex-1 grid grid-cols-7">
                    {weekDays.map(day => {
                      const dateKey = dayStr(day);
                      return (
                        <div key={dateKey} className="border-r border-[var(--border-subtle)] relative">
                          {hours.map(h => (
                            <DroppableSlot key={`${dateKey}-${h}`} id={`week-${dateKey}-${h}`} date={dateKey} hour={h} className="h-16 border-b border-[var(--border-subtle)]/50" />
                          ))}
                          {apptsFor(day).map(a => {
                            const start = new Date(a.start_time + (a.start_time.endsWith('Z') ? '' : 'Z'));
                            const h = start.getHours();
                            const m = start.getMinutes();
                            const top = (h - 7) * 64 + (m / 60) * 64;
                            const cal = calendars.find(c => c.id === a.calendar_id);
                            const color = cal?.color || APPOINTMENT_TYPE_COLORS[a.type];
                            return (
                              <div key={a.id} className="absolute left-1 right-1" style={{ top: `${Math.max(0, top)}px`, minHeight: '40px', zIndex: 5 }}>
                                <DraggableEvent appointment={a}>
                                  <div onClick={() => setShowDetailModal(a)} className="p-1.5 rounded-md text-[10px] font-medium border cursor-pointer hover:shadow-md transition-shadow"
                                    style={{ background: `${color}15`, borderColor: `${color}40`, borderLeft: `3px solid ${color}` }}>
                                    <div className="font-bold text-[var(--text-primary)]">{a.title}</div>
                                    <div className="text-[var(--text-muted)]">{fmtTime(a.start_time)}</div>
                                  </div>
                                </DraggableEvent>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            ) : viewMode === 'day' ? (
              /* ── Vue Jour ── */
              <Card className="p-0 flex-1 flex overflow-auto min-h-[600px]">
                <div className="w-16 flex-shrink-0 border-r border-[var(--border-subtle)]">
                  {hours.map(h => <div key={h} className="h-16 text-[10px] font-medium text-[var(--text-muted)] text-right pr-2 pt-1">{h}:00</div>)}
                </div>
                <div className="flex-1 relative">
                  {hours.map(h => <div key={h} className="h-16 border-b border-[var(--border-subtle)]/50" />)}
                  {apptsFor(currentDate).map(a => {
                    const start = new Date(a.start_time + (a.start_time.endsWith('Z') ? '' : 'Z'));
                    const end = new Date(a.end_time + (a.end_time.endsWith('Z') ? '' : 'Z'));
                    const top = (start.getHours() - 7) * 64 + (start.getMinutes() / 60) * 64;
                    const height = ((end.getTime() - start.getTime()) / 3600000) * 64;
                    const cal = calendars.find(c => c.id === a.calendar_id);
                    const color = cal?.color || APPOINTMENT_TYPE_COLORS[a.type];
                    return (
                      <div key={a.id} onClick={() => setShowDetailModal(a)} className="absolute left-2 right-2 p-2 rounded-lg text-xs font-medium border cursor-pointer hover:shadow-md transition-shadow"
                        style={{ top: `${Math.max(0, top)}px`, height: `${Math.max(30, height)}px`, background: `${color}15`, borderColor: `${color}40`, borderLeft: `4px solid ${color}` }}>
                        <div className="flex justify-between">
                          <span className="font-bold text-[var(--text-primary)]">{a.title}</span>
                          <span className="text-[var(--text-muted)]">{fmtTime(a.start_time)} - {fmtTime(a.end_time)}</span>
                        </div>
                        {a.lead_name && <div className="mt-1 text-[var(--text-secondary)] flex items-center gap-1"><User size={12}/> {a.lead_name}</div>}
                        {a.location && <div className="mt-1 text-[var(--text-secondary)] flex items-center gap-1"><MapPin size={12}/> {a.location}</div>}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ) : (
              /* ── Vue Agenda ── */
              <div className="space-y-3">
                {filteredAppointments.length === 0 ? (
                  <EmptyState icon={<CalendarDays size={48} />} title="Aucun rendez-vous" description="Planifiez votre premier rendez-vous." />
                ) : (
                  [...filteredAppointments].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()).map(appt => {
                    const isPast = new Date(appt.start_time + 'Z') < new Date();
                    const cal = calendars.find(c => c.id === appt.calendar_id);
                    const color = cal?.color || APPOINTMENT_TYPE_COLORS[appt.type];
                    return (
                      <Card key={appt.id} className={`p-4 cursor-pointer hover:shadow-sm transition-shadow ${isPast ? 'opacity-60' : ''}`} onClick={() => setShowDetailModal(appt)}>
                        <div className="flex items-start gap-4">
                          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: `${color}15`, color }}>
                            {APPOINTMENT_TYPE_ICONS[appt.type]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm font-bold text-[var(--text-primary)] truncate">{appt.title}</h3>
                              <Badge color={appt.status === 'confirmed' ? 'var(--success)' : appt.status === 'cancelled' ? 'var(--danger)' : 'var(--info)'}>{APPOINTMENT_STATUS_LABELS[appt.status]}</Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
                              <span className="flex items-center gap-1.5"><CalendarDays size={13} /> {new Date(appt.start_time+'Z').toLocaleDateString('fr-CA', {weekday:'short', day:'numeric', month:'short'})}</span>
                              <span className="flex items-center gap-1.5"><Clock size={13} /> {fmtTime(appt.start_time)}–{fmtTime(appt.end_time)}</span>
                              {cal && <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{backgroundColor: color}}></div> {cal.name}</span>}
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            )}
          </DndContext>
        </div>
      </div>

      {/* ── Modal Creation ── */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Nouveau rendez-vous">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Calendrier</label>
              <select className="w-full px-3 py-2 rounded-lg border text-sm" value={formCalendarId} onChange={e => setFormCalendarId(e.target.value)}>
                {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Titre</label>
              <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Ex: Démo SaaS" />
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs font-medium mb-1 block">Date</label><Input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} /></div>
            <div><label className="text-xs font-medium mb-1 block">Début</label><Input type="time" value={formTimeStart} onChange={e => setFormTimeStart(e.target.value)} /></div>
            <div><label className="text-xs font-medium mb-1 block">Fin</label><Input type="time" value={formTimeEnd} onChange={e => setFormTimeEnd(e.target.value)} /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Type</label>
              <select className="w-full px-3 py-2 rounded-lg border text-sm" value={formType} onChange={e => setFormType(e.target.value as any)}>
                {APPOINTMENT_TYPES.map(t => <option key={t} value={t}>{APPOINTMENT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div><label className="text-xs font-medium mb-1 block">Lieu / Lien visio</label><Input value={formLocation} onChange={e => setFormLocation(e.target.value)} /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Récurrence</label>
              <select className="w-full px-3 py-2 rounded-lg border text-sm" value={formRecurring} onChange={e => setFormRecurring(e.target.value)}>
                <option value="none">Une seule fois</option>
                <option value="daily">Tous les jours</option>
                <option value="weekly">Toutes les semaines</option>
                <option value="monthly">Tous les mois</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Rappel (minutes avant)</label>
              <Input type="number" value={formReminder} onChange={e => setFormReminder(Number(e.target.value))} />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block">Notes</label>
            <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm resize-none" />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setShowAddModal(false)}>Annuler</Button>
            <Button onClick={() => void handleCreate()} disabled={isSaving || !formTitle || !formDate || !formCalendarId}>
              {isSaving ? 'Création...' : 'Créer le RDV'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal Detail ── */}
      {showDetailModal && (
        <Modal isOpen={!!showDetailModal} onClose={() => setShowDetailModal(null)} title="Détails du rendez-vous">
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-bold">{showDetailModal.title}</h3>
              <p className="text-sm text-[var(--text-secondary)]">{new Date(showDetailModal.start_time+'Z').toLocaleString('fr-FR')} - {new Date(showDetailModal.end_time+'Z').toLocaleTimeString('fr-FR')}</p>
            </div>
            
            {showDetailModal.location && (
              <div className="p-3 bg-[var(--bg-subtle)] rounded-lg flex items-center gap-3 text-sm">
                <MapPin size={16} className="text-[var(--brand-primary)]" />
                <a href={showDetailModal.location.startsWith('http') ? showDetailModal.location : `https://maps.google.com/?q=${showDetailModal.location}`} target="_blank" rel="noreferrer" className="text-[var(--brand-primary)] hover:underline flex items-center gap-1">
                  {showDetailModal.location} <ExternalLink size={12} />
                </a>
              </div>
            )}

            {showDetailModal.description && (
               <div className="text-sm bg-[var(--bg-surface)] border p-3 rounded-lg whitespace-pre-wrap">
                 {showDetailModal.description}
               </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="secondary" leftIcon={<Check size={14}/>} onClick={() => void changeStatus(showDetailModal.id, 'confirmed')} disabled={showDetailModal.status === 'confirmed'}>Confirmer</Button>
              <Button size="sm" variant="ghost" leftIcon={<X size={14}/>} className="text-[var(--danger)] border-[var(--danger)] hover:bg-[var(--danger-soft)] border" onClick={() => void changeStatus(showDetailModal.id, 'cancelled')} disabled={showDetailModal.status === 'cancelled'}>Annuler RDV</Button>
              <Button size="sm" variant="secondary" leftIcon={<BellRing size={14}/>} onClick={() => void sendReminder(showDetailModal.id)}>Envoyer rappel auto</Button>
            </div>
          </div>
        </Modal>
      )}

    </AppLayout>
  );
}
