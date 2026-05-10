// ── CalendarPage — Vue calendrier des rendez-vous ──────────

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Modal, Input, Skeleton, EmptyState } from '@/components/ui';
import { getAppointments, createAppointment, updateAppointment } from '@/lib/api';
import type { Appointment, AppointmentType, AppointmentStatus } from '@/lib/types';
import { APPOINTMENT_TYPE_LABELS, APPOINTMENT_TYPE_ICONS, APPOINTMENT_TYPE_COLORS, APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPES } from '@/lib/types';

type ViewMode = 'week' | 'list';

export function CalendarPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showAddModal, setShowAddModal] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTimeStart, setFormTimeStart] = useState('10:00');
  const [formTimeEnd, setFormTimeEnd] = useState('11:00');
  const [formLocation, setFormLocation] = useState('');
  const [formType, setFormType] = useState<AppointmentType>('meeting');
  const [isSaving, setIsSaving] = useState(false);

  const loadAppointments = useCallback(async () => {
    setIsLoading(true);
    const result = await getAppointments();
    if (result.data) {
      setAppointments(result.data);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  // Navigation semaine
  const goToWeek = (delta: number) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + delta * 7);
    setCurrentDate(d);
  };

  // Jours de la semaine courante
  const getWeekDays = (): Date[] => {
    const start = new Date(currentDate);
    start.setDate(start.getDate() - start.getDay() + 1); // Lundi
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  };

  const formatDateShort = (d: Date): string => {
    return d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const isToday = (d: Date): boolean => {
    const today = new Date();
    return d.toDateString() === today.toDateString();
  };

  const getAppointmentsForDay = (day: Date): Appointment[] => {
    const dayStr = day.toISOString().slice(0, 10);
    return appointments.filter(a => a.start_time.slice(0, 10) === dayStr);
  };

  const formatTime = (isoStr: string): string => {
    const d = new Date(isoStr + (isoStr.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const timeAgo = (dateStr: string): string => {
    const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffH = Math.round(diffMs / 3600000);
    if (diffH < 0) return `il y a ${Math.abs(diffH)}h`;
    if (diffH < 24) return `dans ${diffH}h`;
    const diffD = Math.round(diffH / 24);
    return `dans ${diffD}j`;
  };

  const handleCreate = async () => {
    if (!formTitle || !formDate) return;
    setIsSaving(true);

    await createAppointment({
      title: formTitle,
      description: formDescription,
      start_time: `${formDate}T${formTimeStart}:00`,
      end_time: `${formDate}T${formTimeEnd}:00`,
      location: formLocation,
      type: formType,
      client_id: 'gatineau', // Default pour le MVP
    });

    setIsSaving(false);
    setShowAddModal(false);
    setFormTitle(''); setFormDescription(''); setFormDate(''); setFormLocation('');
    void loadAppointments();
  };

  const handleStatusChange = async (id: string, status: AppointmentStatus) => {
    await updateAppointment(id, { status });
    void loadAppointments();
  };

  // Stats rapides
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = appointments.filter(a => a.start_time.slice(0, 10) === today).length;
  const upcomingCount = appointments.filter(a => a.start_time > new Date().toISOString() && a.status !== 'cancelled').length;
  const confirmedCount = appointments.filter(a => a.status === 'confirmed').length;

  const weekDays = getWeekDays();

  return (
    <AppLayout title="Calendrier">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">📅 Calendrier</h1>
          <Badge color="var(--brand-primary)">{todayCount} aujourd'hui</Badge>
          <Badge color="var(--success)">{upcomingCount} à venir</Badge>
        </div>
        <div className="flex gap-2">
          {/* Toggle vue */}
          <div className="flex bg-[var(--bg-subtle)] rounded-[var(--radius-md)] p-0.5">
            <button onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors ${viewMode === 'list' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)]'}`}>
              📋 Liste
            </button>
            <button onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors ${viewMode === 'week' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)]'}`}>
              📅 Semaine
            </button>
          </div>
          <Button onClick={() => { setFormDate(new Date().toISOString().slice(0, 10)); setShowAddModal(true); }}>
            + Nouveau RDV
          </Button>
        </div>
      </div>

      {/* Stats rapides */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--brand-primary)]">{todayCount}</p>
          <p className="text-xs text-[var(--text-muted)]">Aujourd'hui</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--success)]">{confirmedCount}</p>
          <p className="text-xs text-[var(--text-muted)]">Confirmés</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--info)]">{upcomingCount}</p>
          <p className="text-xs text-[var(--text-muted)]">À venir</p>
        </Card>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : viewMode === 'week' ? (
        /* ── Vue semaine ──────────────────────────── */
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => goToWeek(-1)} className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-primary)] cursor-pointer">← Sem. précédente</button>
            <h3 className="text-sm font-semibold">
              {weekDays[0]?.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' })} — {weekDays[6]?.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' })}
            </h3>
            <button onClick={() => goToWeek(1)} className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-primary)] cursor-pointer">Sem. suivante →</button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((day) => {
              const dayAppts = getAppointmentsForDay(day);
              return (
                <div key={day.toISOString()} className={`min-h-[120px] p-2 rounded-[var(--radius-sm)] border ${
                  isToday(day) ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/5' : 'border-[var(--border-subtle)]'
                }`}>
                  <p className={`text-xs font-semibold mb-1 ${isToday(day) ? 'text-[var(--brand-primary)]' : 'text-[var(--text-muted)]'}`}>
                    {formatDateShort(day)}
                  </p>
                  <div className="space-y-1">
                    {dayAppts.map((appt) => (
                      <div key={appt.id} className="text-[10px] p-1.5 rounded bg-[var(--bg-subtle)] border-l-2"
                        style={{ borderLeftColor: APPOINTMENT_TYPE_COLORS[appt.type] }}>
                        <p className="font-medium truncate">{formatTime(appt.start_time)}</p>
                        <p className="truncate text-[var(--text-muted)]">{appt.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        /* ── Vue liste ───────────────────────────── */
        appointments.length === 0 ? (
          <EmptyState icon="📅" title="Aucun rendez-vous" description="Planifiez votre premier rendez-vous avec un lead." />
        ) : (
          <div className="space-y-2">
            {[...appointments]
              .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
              .map((appt) => {
                const isPast = new Date(appt.start_time + 'Z') < new Date();
                return (
                  <Card key={appt.id} className={`p-4 ${isPast ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-4">
                      {/* Icône type */}
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                        style={{ background: `${APPOINTMENT_TYPE_COLORS[appt.type]}15` }}>
                        {APPOINTMENT_TYPE_ICONS[appt.type]}
                      </div>

                      {/* Infos */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="text-sm font-semibold truncate">{appt.title}</h3>
                          <Badge color={
                            appt.status === 'confirmed' ? 'var(--success)' :
                            appt.status === 'cancelled' ? 'var(--danger)' :
                            appt.status === 'completed' ? 'var(--info)' :
                            appt.status === 'no_show' ? 'var(--warning)' : 'var(--text-muted)'
                          }>
                            {APPOINTMENT_STATUS_LABELS[appt.status]}
                          </Badge>
                        </div>
                        <p className="text-xs text-[var(--text-muted)]">
                          {APPOINTMENT_TYPE_LABELS[appt.type]} · {formatTime(appt.start_time)} — {formatTime(appt.end_time)} · {timeAgo(appt.start_time)}
                        </p>
                        {appt.location && (
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">📍 {appt.location}</p>
                        )}
                        {appt.lead_name && (
                          <p className="text-xs text-[var(--brand-primary)] mt-0.5">👤 {appt.lead_name}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-1 shrink-0">
                        {appt.status === 'scheduled' && (
                          <button onClick={() => void handleStatusChange(appt.id, 'confirmed')}
                            className="px-2 py-1 text-[10px] bg-[var(--success)]/15 text-[var(--success)] rounded-[var(--radius-sm)] hover:bg-[var(--success)]/25 cursor-pointer">
                            ✅ Confirmer
                          </button>
                        )}
                        {(appt.status === 'scheduled' || appt.status === 'confirmed') && (
                          <button onClick={() => void handleStatusChange(appt.id, 'cancelled')}
                            className="px-2 py-1 text-[10px] text-[var(--danger)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] hover:bg-[var(--danger)]/10 cursor-pointer">
                            ✕
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

      {/* Modal ajout RDV */}
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
                  className={`p-2 text-center rounded-[var(--radius-sm)] border text-xs cursor-pointer transition-all ${
                    formType === t ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/10' : 'border-[var(--border-subtle)]'
                  }`}>
                  <p>{APPOINTMENT_TYPE_ICONS[t]}</p>
                  <p className="text-[10px]">{APPOINTMENT_TYPE_LABELS[t]}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Date</label>
              <Input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Début</label>
              <Input type="time" value={formTimeStart} onChange={e => setFormTimeStart(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Fin</label>
              <Input type="time" value={formTimeEnd} onChange={e => setFormTimeEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Lieu</label>
            <Input value={formLocation} onChange={e => setFormLocation(e.target.value)} placeholder="Bureau, Zoom, adresse..." />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Description</label>
            <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)}
              rows={2} placeholder="Notes pour le rendez-vous..."
              className="w-full px-3 py-2 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-primary)] resize-none" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>Annuler</Button>
            <Button onClick={() => void handleCreate()} disabled={isSaving || !formTitle || !formDate}>
              {isSaving ? 'Création...' : '📅 Créer le RDV'}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
