// ── DateRangePicker — Sélecteur date avec presets (premium Sprint 23 wave 10) ─
// Refonte visuelle : glassmorphism, gradient sur preset actif, orb décoratif,
// inputs date custom avec ring brand. Light theme baseline préservée.

import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, Sparkles } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Icon } from './Icon';

interface DateRange {
  start: string;
  end: string;
}

interface DateRangePickerProps {
  value?: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

type Preset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30' | 'custom';

export function DateRangePicker({ value, onChange, className = '' }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<Preset>('this_month');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatDate = (date: Date) => date.toISOString().split('T')[0] || '';

  const handlePreset = (preset: Preset) => {
    setActivePreset(preset);
    const now = new Date();
    let start = new Date();
    let end = new Date();

    switch (preset) {
      case 'today':
        break;
      case 'yesterday':
        start.setDate(now.getDate() - 1);
        end.setDate(now.getDate() - 1);
        break;
      case 'this_week': {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        start.setDate(diff);
        break;
      }
      case 'this_month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last_30':
        start.setDate(now.getDate() - 30);
        break;
      case 'custom':
        return;
    }

    onChange({ start: formatDate(start), end: formatDate(end) });
    setIsOpen(false);
  };

  const getLabel = () => {
    switch (activePreset) {
      case 'today': return "Aujourd'hui";
      case 'yesterday': return 'Hier';
      case 'this_week': return 'Cette semaine';
      case 'this_month': return 'Ce mois';
      case 'last_30': return '30 derniers jours';
      case 'custom': return 'Personnalisé';
    }
  };

  const presets: Array<{ id: Preset; label: string; hint?: string }> = [
    { id: 'today', label: "Aujourd'hui", hint: 'J' },
    { id: 'yesterday', label: 'Hier', hint: 'J-1' },
    { id: 'this_week', label: 'Cette semaine', hint: '7j' },
    { id: 'this_month', label: 'Ce mois', hint: 'M' },
    { id: 'last_30', label: '30 derniers jours', hint: '30j' },
  ];

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* ── Trigger button — premium gradient hint + glow on hover ── */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group flex items-center gap-2 px-3.5 py-2 text-sm rounded-lg transition-all whitespace-nowrap cursor-pointer"
        style={{
          background: isOpen
            ? 'linear-gradient(135deg, rgba(0,157,219,0.10) 0%, rgba(217,110,39,0.06) 100%)'
            : 'var(--bg-surface)',
          border: isOpen ? '1px solid rgba(0,157,219,0.45)' : '1px solid var(--border-subtle)',
          boxShadow: isOpen
            ? '0 0 0 3px rgba(0,157,219,0.12), 0 4px 12px -2px rgba(0,157,219,0.18)'
            : '0 1px 2px rgba(15,23,42,0.04)',
        }}
      >
        <Icon
          as={Calendar}
          size={15}
          className="transition-colors"
          style={{ color: isOpen ? 'var(--primary)' : 'var(--text-muted)' }}
        />
        <span
          className="font-semibold transition-colors"
          style={{ color: isOpen ? 'var(--primary)' : 'var(--text-strong)' }}
        >
          {getLabel()}
        </span>
        <Icon
          as={ChevronDown}
          size={13}
          className="transition-transform ml-0.5"
          style={{
            color: isOpen ? 'var(--primary)' : 'var(--text-muted)',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>

      {/* ── Popover panel — glassmorphism + orb + gradient header ── */}
      {isOpen && (
        <div
          className="absolute z-50 top-full mt-2 right-0 md:left-0 md:right-auto min-w-[260px] rounded-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(249,252,254,0.96) 100%)',
            backdropFilter: 'blur(16px) saturate(170%)',
            WebkitBackdropFilter: 'blur(16px) saturate(170%)',
            border: '1px solid rgba(0,157,219,0.18)',
            boxShadow:
              '0 1px 2px rgba(15,23,42,0.04), 0 12px 32px -8px rgba(0,157,219,0.22), 0 32px 64px -16px rgba(15,23,42,0.20), inset 0 1px 0 rgba(255,255,255,0.7)',
          }}
        >
          {/* Orb décoratif top-right */}
          <div
            aria-hidden
            className="absolute -top-12 -right-12 w-32 h-32 rounded-full pointer-events-none"
            style={{
              background:
                'radial-gradient(circle, rgba(0,157,219,0.18) 0%, rgba(217,110,39,0.08) 50%, transparent 80%)',
              filter: 'blur(20px)',
            }}
          />

          {/* Header gradient subtil */}
          <div
            className="relative px-3 py-2 flex items-center gap-1.5 border-b"
            style={{ borderColor: 'rgba(0,157,219,0.10)' }}
          >
            <Icon as={Sparkles} size={11} style={{ color: 'var(--primary)' }} />
            <span
              className="text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{
                background: 'linear-gradient(90deg,#009DDB 0%,#D96E27 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Période rapide
            </span>
          </div>

          <div className="relative flex flex-col p-1">
            {presets.map((p) => (
              <PresetButton
                key={p.id}
                active={activePreset === p.id}
                onClick={() => handlePreset(p.id)}
                hint={p.hint}
              >
                {p.label}
              </PresetButton>
            ))}
            <div
              className="h-px mx-2 my-1"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(0,157,219,0.18) 50%, transparent 100%)',
              }}
            />
            <PresetButton active={activePreset === 'custom'} onClick={() => handlePreset('custom')}>
              Personnalisé…
            </PresetButton>
          </div>

          {/* Custom panel — inputs date avec focus ring brand */}
          {activePreset === 'custom' && (
            <div
              className="relative p-3 space-y-2.5 border-t"
              style={{
                borderColor: 'rgba(0,157,219,0.10)',
                background: 'linear-gradient(180deg, rgba(0,157,219,0.03) 0%, rgba(217,110,39,0.02) 100%)',
              }}
            >
              <DateField
                label="Du"
                value={value?.start || ''}
                onChange={(v) => onChange({ start: v, end: value?.end || '' })}
              />
              <DateField
                label="Au"
                value={value?.end || ''}
                onChange={(v) => onChange({ start: value?.start || '', end: v })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PresetButton({
  active,
  onClick,
  hint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex items-center justify-between text-left px-2.5 py-2 text-[13px] rounded-[var(--radius-sm)] transition-all cursor-pointer"
      style={{
        background: active
          ? 'linear-gradient(90deg, rgba(0,157,219,0.14) 0%, rgba(217,110,39,0.08) 100%)'
          : 'transparent',
        color: active ? 'var(--primary)' : 'var(--text-strong)',
        fontWeight: active ? 700 : 500,
        boxShadow: active ? 'inset 3px 0 0 0 #009DDB' : 'none',
      }}
      onPointerMove={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = 'rgba(0,157,219,0.06)';
        }
      }}
      onPointerLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }
      }}
    >
      <span>{children}</span>
      {hint && (
        <span
          className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-full"
          style={{
            background: active
              ? 'linear-gradient(135deg,#009DDB,#D96E27)'
              : 'var(--bg-muted)',
            color: active ? '#fff' : 'var(--text-muted)',
            boxShadow: active ? '0 0 8px rgba(0,157,219,0.4)' : 'none',
          }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  return (
    <div>
      <label
        className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1 block"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className="w-full text-[13px] px-2.5 py-1.5 rounded-lg outline-none transition-all"
        style={{
          background: 'var(--bg-surface)',
          border: isFocused ? '1px solid rgba(0,157,219,0.45)' : '1px solid var(--border-subtle)',
          boxShadow: isFocused
            ? '0 0 0 3px rgba(0,157,219,0.12), 0 0 16px rgba(0,157,219,0.10)'
            : 'none',
          color: 'var(--text-primary)',
        }}
      />
    </div>
  );
}
