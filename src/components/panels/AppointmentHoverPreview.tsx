// ── AppointmentHoverPreview — Carte preview hover sur Calendar (Sprint 25 vague 5A)
// Hover sur appointment card/pill → 320×260 carte avec type icon coloré,
// title, time start-end + duration calc, location, lead lié, reminder status.
// Gradient orb couleur appointment type.
//
// Hook `useAppointmentHoverPreview` → portal-rendered, désactivé touch.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui';
import {
  APPOINTMENT_TYPE_COLORS,
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  type Appointment,
} from '@/lib/types';
import { Phone, Video, Calendar as CalendarIcon, User as UserIcon, MapPin, Clock, BellRing, FileSignature, Pin } from 'lucide-react';

const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 260;

const APPT_TYPE_ICON: Record<string, typeof CalendarIcon> = {
  call: Phone,
  meeting: UserIcon,
  visit: MapPin,
  signing: FileSignature,
  other: Pin,
};

interface UseAppointmentHoverPreviewOptions {
  appointment: Appointment;
  disabled?: boolean;
  delay?: number;
}

interface UseAppointmentHoverPreviewResult {
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

export function useAppointmentHoverPreview({
  appointment,
  disabled = false,
  delay = 320,
}: UseAppointmentHoverPreviewOptions): UseAppointmentHoverPreviewResult {
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
          <AppointmentPreviewCard appointment={appointment} position={position} />,
          document.body
        )
      : null;

  return { onMouseEnter, onMouseLeave, preview };
}

function fmtTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return date.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
}

function diffMinutes(startIso: string, endIso: string): number {
  if (!startIso || !endIso) return 0;
  const s = new Date(startIso + (startIso.endsWith('Z') ? '' : 'Z'));
  const e = new Date(endIso + (endIso.endsWith('Z') ? '' : 'Z'));
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 60000));
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

function AppointmentPreviewCard({
  appointment,
  position,
}: {
  appointment: Appointment;
  position: { x: number; y: number };
}) {
  const color = APPOINTMENT_TYPE_COLORS[appointment.type] || 'var(--primary)';
  const TypeIcon = APPT_TYPE_ICON[appointment.type] || CalendarIcon;
  const dur = diffMinutes(appointment.start_time, appointment.end_time);
  const isVideo = (appointment.conference_link || '').length > 0;
  const ResolvedIcon = isVideo ? Video : TypeIcon;

  return (
    <div
      className="fixed z-[100] w-[320px] rounded-2xl overflow-hidden pointer-events-none motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200"
      style={{
        left: position.x,
        top: position.y,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(249,252,254,0.96) 100%)',
        backdropFilter: 'blur(18px) saturate(170%)',
        WebkitBackdropFilter: 'blur(18px) saturate(170%)',
        border: '1px solid rgba(0,157,219,0.18)',
        boxShadow:
          '0 1px 2px rgba(15,23,42,0.06), 0 16px 40px -10px rgba(0,157,219,0.22), 0 32px 64px -16px rgba(15,23,42,0.20), inset 0 1px 0 rgba(255,255,255,0.8)',
      }}
    >
      {/* Orb décoratif coloré selon type */}
      <div
        aria-hidden
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${color}38 0%, ${color}14 50%, transparent 80%)`,
          filter: 'blur(32px)',
        }}
      />

      {/* Bandeau gauche coloré type */}
      <div
        aria-hidden
        className="absolute top-0 left-0 bottom-0 w-1"
        style={{
          background: `linear-gradient(180deg, ${color} 0%, ${color}66 100%)`,
          boxShadow: `0 0 12px ${color}66`,
        }}
      />

      <div className="relative p-4 pl-5">
        {/* Header : icon coloré + titre + status */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${color}28 0%, ${color}14 100%)`,
              border: `1px solid ${color}40`,
              color,
            }}
          >
            <Icon as={ResolvedIcon} size={18} strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className="text-[14px] font-bold leading-tight"
              style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}
            >
              {appointment.title}
            </h3>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                style={{
                  background: `${color}18`,
                  color,
                  border: `1px solid ${color}30`,
                }}
              >
                {APPOINTMENT_TYPE_LABELS[appointment.type]}
              </span>
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium"
                style={{
                  background: 'rgba(0,157,219,0.08)',
                  color: 'var(--text-secondary)',
                  border: '1px solid rgba(0,157,219,0.15)',
                }}
              >
                {APPOINTMENT_STATUS_LABELS[appointment.status]}
              </span>
            </div>
          </div>
        </div>

        {/* Meta info */}
        <div className="space-y-1.5 mb-3">
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <Icon as={Clock} size="xs" style={{ color, opacity: 0.85 }} />
            <span className="font-semibold tabular-nums">
              {fmtTime(appointment.start_time)} – {fmtTime(appointment.end_time)}
            </span>
            {dur > 0 && (
              <span className="text-[10px] text-[var(--text-muted)]">· {formatDuration(dur)}</span>
            )}
          </div>
          {appointment.location && (
            <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <Icon as={MapPin} size="xs" style={{ color, opacity: 0.85 }} />
              <span className="truncate">{appointment.location}</span>
            </div>
          )}
          {appointment.lead_name && (
            <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <Icon as={UserIcon} size="xs" style={{ color, opacity: 0.85 }} />
              <span className="truncate">{appointment.lead_name}</span>
            </div>
          )}
          {appointment.reminder_minutes > 0 && (
            <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <Icon as={BellRing} size="xs" style={{ color, opacity: 0.85 }} />
              <span>Rappel {appointment.reminder_minutes} min avant</span>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div
          className="pt-2 mt-1 border-t flex items-center justify-between"
          style={{ borderColor: `${color}20` }}
        >
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Aperçu
          </span>
          <span className="text-[10px] font-semibold" style={{ color }}>
            Cliquer pour ouvrir →
          </span>
        </div>
      </div>
    </div>
  );
}
