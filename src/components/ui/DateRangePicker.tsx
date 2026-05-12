import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

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
      case 'this_week':
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
        start.setDate(diff);
        break;
      case 'this_month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last_30':
        start.setDate(now.getDate() - 30);
        break;
      case 'custom':
        return; // Don't auto close or update dates yet
    }

    onChange({ start: formatDate(start), end: formatDate(end) });
    setIsOpen(false);
  };

  const getLabel = () => {
    switch (activePreset) {
      case 'today': return "Aujourd'hui";
      case 'yesterday': return "Hier";
      case 'this_week': return "Cette semaine";
      case 'this_month': return "Ce mois";
      case 'last_30': return "30 derniers jours";
      case 'custom': return "Personnalisé";
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 text-sm border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] rounded-lg transition-colors whitespace-nowrap"
      >
        <Calendar size={16} className="text-[var(--text-muted)]" />
        <span className="font-medium text-[var(--text-strong)]">{getLabel()}</span>
        <ChevronDown size={14} className="text-[var(--text-muted)] ml-1" />
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full mt-2 right-0 md:left-0 md:right-auto min-w-[200px] bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col py-1">
            <PresetButton active={activePreset === 'today'} onClick={() => handlePreset('today')}>Aujourd'hui</PresetButton>
            <PresetButton active={activePreset === 'yesterday'} onClick={() => handlePreset('yesterday')}>Hier</PresetButton>
            <PresetButton active={activePreset === 'this_week'} onClick={() => handlePreset('this_week')}>Cette semaine</PresetButton>
            <PresetButton active={activePreset === 'this_month'} onClick={() => handlePreset('this_month')}>Ce mois</PresetButton>
            <PresetButton active={activePreset === 'last_30'} onClick={() => handlePreset('last_30')}>30 derniers jours</PresetButton>
            <div className="h-px bg-[var(--border-subtle)] my-1 mx-2" />
            <PresetButton active={activePreset === 'custom'} onClick={() => handlePreset('custom')}>Personnalisé...</PresetButton>
          </div>
          
          {activePreset === 'custom' && (
            <div className="p-3 bg-[var(--bg-subtle)] border-t border-[var(--border-subtle)] space-y-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Du</label>
                <input 
                  type="date" 
                  value={value?.start || ''}
                  onChange={e => onChange({ start: e.target.value, end: value?.end || '' })}
                  className="w-full text-sm p-1.5 rounded border border-[var(--border-strong)]" 
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Au</label>
                <input 
                  type="date" 
                  value={value?.end || ''}
                  onChange={e => onChange({ start: value?.start || '', end: e.target.value })}
                  className="w-full text-sm p-1.5 rounded border border-[var(--border-strong)]" 
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PresetButton({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left px-4 py-2 text-sm transition-colors ${
        active 
          ? 'bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] font-medium' 
          : 'text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]'
      }`}
    >
      {children}
    </button>
  );
}
