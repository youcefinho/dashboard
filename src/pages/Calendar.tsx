// ── Page Calendar — Refonte Sprint Design 2 (D2.3) ──────────

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Modal, Skeleton, EmptyState } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { getAppointments, createAppointment, updateAppointment } from '@/lib/api';
import type { Appointment, AppointmentType, AppointmentStatus } from '@/lib/types';
import { APPOINTMENT_TYPE_LABELS, APPOINTMENT_TYPE_ICONS, APPOINTMENT_TYPE_COLORS, APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPES } from '@/lib/types';
import { ChevronLeft, ChevronRight, CalendarDays, Clock, MapPin, User, Plus, Check, X } from 'lucide-react';

type ViewMode = 'day' | 'week' | 'month' | 'agenda';

export function CalendarPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [showAddModal, setShowAddModal] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTimeStart, setFormTimeStart] = useState('10:00');
  const [formTimeEnd, setFormTimeEnd] = useState('11:00');
  const [formLocation, setFormLocation] = useState('');
  const [formType, setFormType] = useState<AppointmentType>('meeting');
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const r = await getAppointments();
    if (r.data) setAppointments(r.data);
    setIsLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

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
  const dayStr = (d: Date) => d.toISOString().slice(0, 10);
  const apptsFor = (d: Date) => appointments.filter(a => a.start_time.slice(0, 10) === dayStr(d));
  const fmtTime = (s: string) => new Date(s + (s.endsWith('Z') ? '' : 'Z')).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });

  const getWeekDays = (): Date[] => {
    const s = new Date(currentDate);
    s.setDate(s.getDate() - s.getDay() + 1);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(d.getDate() + i); return d; });
  };

  const getMonthDays = (): Date[] => {
    const first = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const startDay = first.getDay() || 7; // 1=lundi
    const start = new Date(first);
    start.setDate(start.getDate() - (startDay - 1));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  };

  const timeAgo = (s: string) => {
    const ms = new Date(s + (s.endsWith('Z') ? '' : 'Z')).getTime() - Date.now();
    const h = Math.round(ms / 3600000);
    if (h < 0) return `il y a ${Math.abs(h)}h`;
    if (h < 24) return `dans ${h}h`;
    return `dans ${Math.round(h / 24)}j`;
  };

  const handleCreate = async () => {
    if (!formTitle || !formDate) return;
    setIsSaving(true);
    await createAppointment({ title: formTitle, description: formDescription, start_time: `${formDate}T${formTimeStart}:00`, end_time: `${formDate}T${formTimeEnd}:00`, location: formLocation, type: formType, client_id: 'gatineau' });
    setIsSaving(false); setShowAddModal(false);
    setFormTitle(''); setFormDescription(''); setFormDate(''); setFormLocation('');
    void load();
  };

  const changeStatus = async (id: string, status: AppointmentStatus) => { await updateAppointment(id, { status }); void load(); };

  const todayAppts = appointments.filter(a => a.start_time.slice(0, 10) === dayStr(new Date()));
  const upcomingCount = appointments.filter(a => a.start_time > new Date().toISOString() && a.status !== 'cancelled').length;
  const confirmedCount = appointments.filter(a => a.status === 'confirmed').length;

  // Hours for Day view
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
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Stats pills */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium">
          <CalendarDays size={14} className="text-[var(--brand-primary)]" />
          <span className="text-[var(--text-secondary)]">{todayAppts.length} aujourd'hui</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium">
          <Check size={14} className="text-[var(--success)]" />
          <span className="text-[var(--text-secondary)]">{confirmedCount} confirmés</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium">
          <Clock size={14} className="text-[var(--info)]" />
          <span className="text-[var(--text-secondary)]">{upcomingCount} à venir</span>
        </div>

        <div className="flex-1" />

        {/* View switcher */}
        <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5">
          {(['day', 'week', 'month', 'agenda'] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium cursor-pointer transition-all
                ${viewMode === v ? 'bg-[var(--brand-primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
              {v === 'day' ? 'Jour' : v === 'week' ? 'Semaine' : v === 'month' ? 'Mois' : 'Agenda'}
            </button>
          ))}
        </div>

        <Button size="sm" leftIcon={<Plus size={14} />}
          onClick={() => { setFormDate(dayStr(new Date())); setShowAddModal(true); }}>
          Nouveau RDV
        </Button>
      </div>

      {/* ── Navigation période ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-[var(--bg-subtle)] cursor-pointer transition-all text-[var(--text-muted)]"><ChevronLeft size={18} /></button>
          <button onClick={() => navigate(1)} className="p-1.5 rounded-lg hover:bg-[var(--bg-subtle)] cursor-pointer transition-all text-[var(--text-muted)]"><ChevronRight size={18} /></button>
          <h2 className="text-sm font-bold text-[var(--text-primary)] capitalize">{periodLabel}</h2>
        </div>
        <button onClick={goToday}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--brand-tint)] text-[var(--brand-primary)] hover:bg-[var(--brand-soft)] cursor-pointer transition-all">
          Aujourd'hui
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : viewMode === 'month' ? (
        /* ── Vue Mois ── */
        <Card className="p-3 overflow-hidden">
          <div className="grid grid-cols-7 mb-1">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-[var(--border-subtle)] rounded-lg overflow-hidden">
            {monthDays.map(day => {
              const isCurrentMonth = day.getMonth() === currentDate.getMonth();
              const dayAppts = apptsFor(day);
              return (
                <div key={day.toISOString()}
                  onClick={() => { setCurrentDate(day); setViewMode('day'); }}
                  className={`min-h-[80px] p-1.5 bg-[var(--bg-surface)] cursor-pointer transition-all hover:bg-[var(--bg-subtle)]
                    ${!isCurrentMonth ? 'opacity-40' : ''} ${isToday(day) ? 'ring-2 ring-inset ring-[var(--brand-primary)]' : ''}`}>
                  <p className={`text-[11px] font-semibold mb-1 ${isToday(day) ? 'text-[var(--brand-primary)]' : 'text-[var(--text-secondary)]'}`}>
                    {day.getDate()}
                  </p>
                  {dayAppts.slice(0, 3).map(a => (
                    <div key={a.id} className="text-[9px] px-1 py-0.5 rounded mb-0.5 truncate font-medium"
                      style={{ background: `${APPOINTMENT_TYPE_COLORS[a.type]}15`, color: APPOINTMENT_TYPE_COLORS[a.type] }}>
                      {fmtTime(a.start_time)} {a.title}
                    </div>
                  ))}
                  {dayAppts.length > 3 && <p className="text-[9px] text-[var(--text-muted)]">+{dayAppts.length - 3}</p>}
                </div>
              );
            })}
          </div>
        </Card>
      ) : viewMode === 'day' ? (
        /* ── Vue Jour ── */
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-[var(--border-subtle)]">
            {hours.map(h => {
              const slot = `${String(h).padStart(2, '0')}:`;
              const slotAppts = apptsFor(currentDate).filter(a => fmtTime(a.start_time).startsWith(slot));
              return (
                <div key={h} className="flex min-h-[48px]">
                  <div className="w-16 flex-shrink-0 py-2 px-3 text-[11px] font-medium text-[var(--text-muted)] text-right border-r border-[var(--border-subtle)]">
                    {String(h).padStart(2, '0')}:00
                  </div>
                  <div className="flex-1 p-1.5 flex flex-wrap gap-1.5">
                    {slotAppts.map(a => (
                      <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: `${APPOINTMENT_TYPE_COLORS[a.type]}15`, color: APPOINTMENT_TYPE_COLORS[a.type], borderLeft: `3px solid ${APPOINTMENT_TYPE_COLORS[a.type]}` }}>
                        <span>{APPOINTMENT_TYPE_ICONS[a.type]}</span>
                        <span>{a.title}</span>
                        <span className="opacity-60">{fmtTime(a.start_time)}–{fmtTime(a.end_time)}</span>
                        {a.lead_name && <span className="opacity-60">· {a.lead_name}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : viewMode === 'week' ? (
        /* ── Vue Semaine ── */
        <Card className="p-3">
          <div className="grid grid-cols-7 gap-1.5">
            {weekDays.map(day => {
              const dayAppts = apptsFor(day);
              return (
                <div key={day.toISOString()}
                  onClick={() => { setCurrentDate(day); setViewMode('day'); }}
                  className={`min-h-[140px] p-2.5 rounded-xl border cursor-pointer transition-all hover:shadow-md
                    ${isToday(day) ? 'border-[var(--brand-primary)] bg-[var(--brand-tint)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className={`text-xs font-bold ${isToday(day) ? 'text-[var(--brand-primary)]' : 'text-[var(--text-secondary)]'}`}>
                      {day.toLocaleDateString('fr-CA', { weekday: 'short' })}
                    </p>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold
                      ${isToday(day) ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-primary)]'}`}>
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {dayAppts.map(a => (
                      <div key={a.id} className="p-1.5 rounded-lg text-[10px] border-l-[3px]"
                        style={{ borderLeftColor: APPOINTMENT_TYPE_COLORS[a.type], background: `${APPOINTMENT_TYPE_COLORS[a.type]}08` }}>
                        <p className="font-semibold text-[var(--text-primary)] truncate">{fmtTime(a.start_time)}</p>
                        <p className="text-[var(--text-muted)] truncate">{a.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        /* ── Vue Agenda ── */
        appointments.length === 0 ? (
          <EmptyState icon={<CalendarDays size={48} />} title="Aucun rendez-vous" description="Planifiez votre premier rendez-vous." />
        ) : (
          <div className="space-y-2">
            {[...appointments].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()).map(appt => {
              const isPast = new Date(appt.start_time + 'Z') < new Date();
              return (
                <Card key={appt.id} className={`p-4 ${isPast ? 'opacity-50' : ''}`}>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                      style={{ background: `${APPOINTMENT_TYPE_COLORS[appt.type]}15` }}>
                      {APPOINTMENT_TYPE_ICONS[appt.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{appt.title}</h3>
                        <Badge color={appt.status === 'confirmed' ? 'var(--success)' : appt.status === 'cancelled' ? 'var(--danger)' : appt.status === 'completed' ? 'var(--info)' : appt.status === 'no_show' ? 'var(--warning)' : 'var(--text-muted)'}>
                          {APPOINTMENT_STATUS_LABELS[appt.status]}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                        <span className="flex items-center gap-1"><Clock size={11} /> {fmtTime(appt.start_time)}–{fmtTime(appt.end_time)} · {timeAgo(appt.start_time)}</span>
                        {appt.location && <span className="flex items-center gap-1"><MapPin size={11} /> {appt.location}</span>}
                        {appt.lead_name && <span className="flex items-center gap-1 text-[var(--brand-primary)]"><User size={11} /> {appt.lead_name}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {appt.status === 'scheduled' && (
                        <button onClick={() => void changeStatus(appt.id, 'confirmed')}
                          className="p-1.5 rounded-lg bg-[var(--success-soft)] text-[var(--success)] hover:bg-[var(--success)]/20 cursor-pointer transition-all">
                          <Check size={14} />
                        </button>
                      )}
                      {(appt.status === 'scheduled' || appt.status === 'confirmed') && (
                        <button onClick={() => void changeStatus(appt.id, 'cancelled')}
                          className="p-1.5 rounded-lg text-[var(--danger)] hover:bg-[var(--danger-soft)] cursor-pointer transition-all">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* ── Modal nouveau RDV ── */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Nouveau rendez-vous">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Titre</label>
            <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Ex: Rencontre avec Sophie Tremblay" />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Type</label>
            <div className="grid grid-cols-5 gap-1">
              {APPOINTMENT_TYPES.map(t => (
                <button key={t} onClick={() => setFormType(t)}
                  className={`p-2 text-center rounded-lg border text-xs cursor-pointer transition-all
                    ${formType === t ? 'border-[var(--brand-primary)] bg-[var(--brand-tint)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'}`}>
                  <p>{APPOINTMENT_TYPE_ICONS[t]}</p>
                  <p className="text-[10px] mt-0.5">{APPOINTMENT_TYPE_LABELS[t]}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Date</label><Input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} /></div>
            <div><label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Début</label><Input type="time" value={formTimeStart} onChange={e => setFormTimeStart(e.target.value)} /></div>
            <div><label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Fin</label><Input type="time" value={formTimeEnd} onChange={e => setFormTimeEnd(e.target.value)} /></div>
          </div>
          <div><label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Lieu</label><Input value={formLocation} onChange={e => setFormLocation(e.target.value)} placeholder="Bureau, Zoom, adresse..." /></div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Description</label>
            <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={2} placeholder="Notes..."
              className="w-full px-3 py-2 bg-[var(--bg-canvas)] border border-[var(--border-default)] rounded-lg text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] resize-none" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowAddModal(false)}>Annuler</Button>
            <Button onClick={() => void handleCreate()} disabled={isSaving || !formTitle || !formDate} leftIcon={<CalendarDays size={14} />}>
              {isSaving ? 'Création...' : 'Créer le RDV'}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
