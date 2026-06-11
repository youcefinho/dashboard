// ── DateRangePicker — Sélecteur date avec presets (premium Sprint 23 wave 10) ─
// Refonte visuelle : glassmorphism, gradient sur preset actif, orb décoratif,
// inputs date custom avec ring brand. Light theme baseline préservée.

import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
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
            ? 'var(--primary-soft)'
            : 'var(--bg-surface)',
          border: isOpen ? '1px solid var(--primary)' : '1px solid var(--border)',
          boxShadow: isOpen
            ? '0 0 0 3px var(--primary-ring)'
            : 'var(--shadow-xs)',
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
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >

          <div
            className="relative px-3 py-2 flex items-center gap-1.5 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span
              className="text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ color: 'var(--text-muted)' }}
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
              style={{ background: 'var(--border)' }}
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
                borderColor: 'var(--border)',
                background: 'var(--bg-subtle)',
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
          ? 'var(--primary-soft)'
          : 'transparent',
        color: active ? 'var(--primary)' : 'var(--text-primary)',
        fontWeight: active ? 700 : 500,
        boxShadow: active ? 'inset 3px 0 0 0 var(--primary)' : 'none',
      }}
      onPointerMove={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)';
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
              ? 'var(--primary)'
              : 'var(--bg-muted)',
            color: active ? 'var(--text-inverse)' : 'var(--text-muted)',
            boxShadow: 'none',
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
          border: isFocused ? '1px solid var(--primary)' : '1px solid var(--border)',
          boxShadow: isFocused
            ? '0 0 0 3px var(--primary-ring)'
            : 'none',
          color: 'var(--text-primary)',
        }}
      />
    </div>
  );
}
