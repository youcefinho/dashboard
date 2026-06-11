// ── Page Mode Visite Mobile — Intralys CRM (Sprint 6 D6) ────
// Route : /visit/:leadId — layout 1 colonne, gros touch targets

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { Phone, MessageSquare, Mail, StickyNote, Camera, ChevronLeft, CheckCircle, Circle, Star, Zap, MapPin, Clock } from 'lucide-react';
import { takePhoto } from '@/lib/camera';
import { Textarea, KpiStrip, type KpiItem, Icon, useConfirm } from '@/components/ui';
// Sprint 48 M3 — Intl currency + date
import { formatMoneyCAD } from '@/lib/i18n/number';
import { formatDate } from '@/lib/i18n/datetime';
import { getLocale, t } from '@/lib/i18n';

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  score: number;
  address?: string;
  avatar_url?: string;
  notes?: string;
  client_name?: string;
  deal_value?: number;
  created_at: string;
}

interface ChecklistItem {
  id: string;
  labelKey: string;
  done: boolean;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: '1', labelKey: 'visit.checklist.item.contact', done: false },
  { id: '2', labelKey: 'visit.checklist.item.services', done: false },
  { id: '3', labelKey: 'visit.checklist.item.needs', done: false },
  { id: '4', labelKey: 'visit.checklist.item.photos', done: false },
  { id: '5', labelKey: 'visit.checklist.item.next_steps', done: false },
  { id: '6', labelKey: 'visit.checklist.item.followup', done: false },
];

const STATUS_KEYS: Record<string, string> = {
  new: 'visit.status.new', contacted: 'visit.status.contacted', qualified: 'visit.status.qualified',
  inbound: 'visit.status.inbound', customer: 'visit.status.customer', won: 'visit.status.won', lost: 'visit.status.lost',
};

export function VisitModePage() {
  const { leadId } = useParams({ from: '/visit/$leadId' });
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [lead, setLead] = useState<Lead | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() => {
    try {
      const saved = localStorage.getItem(`visit_checklist_${leadId}`);
      return saved ? JSON.parse(saved) as ChecklistItem[] : DEFAULT_CHECKLIST;
    } catch { return DEFAULT_CHECKLIST; }
  });
  const [note, setNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Charger le lead
  const loadLead = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`);
      if (!res.ok) {
        setLoadError(t('visit.error_load'));
        setIsLoading(false);
        return;
      }
      const json = await res.json() as { data?: Lead };
      if (json.data) {
        setLead(json.data);
        setStatus(json.data.status);
      }
    } catch {
      setLoadError(t('visit.error_load'));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    void loadLead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // Persister checklist
  useEffect(() => {
    localStorage.setItem(`visit_checklist_${leadId}`, JSON.stringify(checklist));
  }, [checklist, leadId]);

  const toggleCheck = (id: string) => {
    setChecklist(prev => prev.map(item =>
      item.id === id ? { ...item, done: !item.done } : item
    ));
  };

  const completedCount = checklist.filter(c => c.done).length;
  const progress = Math.round((completedCount / checklist.length) * 100);

  const saveNote = async () => {
    if (!note.trim() || !lead) return;
    setIsSavingNote(true);
    setNoteError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: note, note_type: 'visit' }),
      });
      if (!res.ok) {
        setNoteError(t('visit.error_save_note'));
      } else {
        setNote('');
        setShowNoteInput(false);
      }
    } catch {
      setNoteError(t('visit.error_save_note'));
    }
    setIsSavingNote(false);
  };

  const handleFinish = async () => {
    if (completedCount < checklist.length) {
      const ok = await confirm({
        title: t('visit.finish.confirm_title'),
        description: t('visit.finish.confirm_desc', { done: completedCount, total: checklist.length }),
        confirmLabel: t('visit.finish.confirm_cta'),
        danger: false,
      });
      if (!ok) return;
    }
    void navigate({ to: '/leads' });
  };

  const handlePhotoCapture = async () => {
    const photo = await takePhoto();
    if (photo) {
      setPhotos(prev => [...prev, photo.dataUrl]);
      // En production : upload vers R2 via /api/files
    }
  };

  // Fallback legacy input file (garder pour compatibilité)
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotos(prev => [...prev, url]);
  };

  const updateStatus = async (newStatus: string) => {
    setStatus(newStatus);
    await fetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
  };

  const scoreColor = (score: number) =>
    score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444';

  if (isLoading) {
    return (
      <div
        className="min-h-screen bg-[var(--gray-900)] flex items-center justify-center"
        role="status"
        aria-busy="true"
        aria-live="polite"
        aria-label={t('visit.loading')}
      >
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <span className="sr-only">{t('visit.loading')}</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[var(--gray-900)] flex flex-col items-center justify-center gap-4 p-6" role="alert">
        <p className="text-white text-lg">{loadError}</p>
        <div className="flex gap-3">
          <button
            onClick={() => void loadLead()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 active:scale-95"
          >
            {t('visit.error_retry')}
          </button>
          <button onClick={() => void navigate({ to: '/leads' })} className="text-indigo-400 underline">
            {t('visit.back_to_leads')}
          </button>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="min-h-screen bg-[var(--gray-900)] flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-white text-lg">{t('visit.not_found')}</p>
        <button onClick={() => void navigate({ to: '/leads' })} className="text-indigo-400 underline">
          {t('visit.back_to_leads')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--gray-900)] text-white flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[var(--gray-900)]/95 backdrop-blur border-b border-[var(--border-strong)] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void navigate({ to: '/leads' })}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-[var(--gray-800)] active:scale-95 transition-all"
            aria-label={t('visit.back_to_leads')}
          >
            <Icon as={ChevronLeft} size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg truncate">{lead.name}</h1>
            <p className="text-xs text-[var(--text-muted)] truncate">{lead.client_name || t('visit.page.title')}</p>
          </div>
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
            style={{ background: scoreColor(lead.score) + '20', color: scoreColor(lead.score) }}
            aria-label={t('visit.score_aria', { score: lead.score })}
          >
            <Icon as={Zap} size="xs" />
            {lead.score}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-40">
        {/* KPI compact session visite */}
        <div className="px-3 pt-3">
          <KpiStrip
            items={[
              { label: t('visit.kpi.checklist'), value: `${completedCount}/${checklist.length}`, color: 'brand' },
              { label: t('visit.kpi.photos'), value: photos.length, color: 'accent' },
              { label: t('visit.kpi.progress'), value: `${progress}%`, color: progress >= 80 ? 'success' : 'warning' },
            ] as KpiItem[]}
          />
        </div>
        {/* Infos contact */}
        <div className="px-4 py-4 border-b border-[var(--border-strong)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xl font-bold shrink-0">
              {lead.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-base">{lead.name}</p>
              {lead.email && <p className="text-sm text-[var(--text-muted)] truncate">{lead.email}</p>}
              {lead.address && (
                <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                  <Icon as={MapPin} size={10} /> {lead.address}
                </p>
              )}
            </div>
          </div>

          {/* Deal value */}
          {(lead.deal_value ?? 0) > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <Icon as={Star} size="sm" className="text-yellow-400" />
              <span className="text-sm font-semibold text-yellow-400">
                {formatMoneyCAD(lead.deal_value!, getLocale())}
              </span>
            </div>
          )}

          {/* Timestamp */}
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <Icon as={Clock} size={10} />
            {t('visit.created_on', { date: formatDate(lead.created_at, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) })}
          </p>
        </div>

        {/* Quick Actions */}
        <div className="px-4 py-4 border-b border-[var(--border-strong)]">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('visit.actions.section')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="group" aria-label={t('visit.actions.section')}>
            {lead.phone && (
              <a href={`tel:${lead.phone}`}
                aria-label={t('visit.actions.call_aria', { phone: lead.phone })}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-green-500/10 border border-green-500/20 active:scale-95 transition-all">
                <Phone size={22} className="text-green-400" />
                <span className="text-[10px] text-green-400 font-medium">{t('visit.actions.call')}</span>
              </a>
            )}
            {lead.phone && (
              <a href={`sms:${lead.phone}`}
                aria-label={t('visit.actions.sms_aria', { phone: lead.phone })}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 active:scale-95 transition-all">
                <MessageSquare size={22} className="text-blue-400" />
                <span className="text-[10px] text-blue-400 font-medium">{t('visit.actions.sms')}</span>
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`}
                aria-label={t('visit.actions.email_aria', { email: lead.email })}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 active:scale-95 transition-all">
                <Mail size={22} className="text-purple-400" />
                <span className="text-[10px] text-purple-400 font-medium">{t('visit.actions.email')}</span>
              </a>
            )}
            <button
              onClick={() => setShowNoteInput(p => !p)}
              aria-expanded={showNoteInput}
              aria-label={t('visit.actions.note_aria')}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 active:scale-95 transition-all"
            >
              <StickyNote size={22} className="text-orange-400" />
              <span className="text-[10px] text-orange-400 font-medium">{t('visit.actions.note')}</span>
            </button>
          </div>
        </div>

        {/* Note rapide */}
        {showNoteInput && (
          <div className="px-4 py-4 border-b border-[var(--border-strong)] bg-[var(--gray-900)]/50">
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('visit.note.placeholder')}
              rows={3}
              autoFocus
              maxLength={500}
              showCounter
              resize="none"
              aria-label={t('visit.note.placeholder')}
              className="!bg-[var(--gray-800)] !border-[var(--border-strong)] !text-white placeholder:!text-[var(--text-muted)]"
            />
            {noteError && (
              <p role="alert" aria-live="assertive" className="mt-2 text-xs text-red-400">
                {noteError}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setShowNoteInput(false); setNote(''); setNoteError(null); }}
                className="flex-1 py-2 rounded-lg text-sm text-[var(--text-muted)] bg-[var(--gray-800)] active:scale-95">
                {t('visit.note.cancel')}
              </button>
              <button onClick={() => void saveNote()} disabled={!note.trim() || isSavingNote}
                aria-label={t('visit.note.save')}
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
                style={{ background: 'var(--primary)', boxShadow: '0 4px 12px rgba(99,91,255,0.4)' }}>
                {isSavingNote ? t('visit.note.saving') : t('visit.note.save')}
              </button>
            </div>
          </div>
        )}

        {/* Checklist visite */}
        <div className="px-4 py-4 border-b border-[var(--border-strong)]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              {t('visit.checklist.title')}
            </p>
            <span className="text-xs text-indigo-400 font-semibold" aria-label={t('visit.checklist.progress_aria', { done: completedCount, total: checklist.length })}>
              {completedCount}/{checklist.length}
            </span>
          </div>
          {/* Barre de progression */}
          <div className="h-1.5 rounded-full bg-[var(--gray-800)] overflow-hidden mb-4">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
              style={{ width: `${progress}%` }} />
          </div>
          <div className="space-y-2" role="list">
            {checklist.map((item, idx) => {
              const label = t(item.labelKey);
              return (
              <button
                key={item.id}
                onClick={() => toggleCheck(item.id)}
                role="listitem"
                aria-pressed={item.done}
                aria-label={label}
                className={`list-item-enter w-full flex items-center gap-3 p-3 rounded-xl border transition-all active:scale-[0.98] text-left min-h-[52px] ${
                  item.done
                    ? 'border-[rgba(99,91,255,0.40)] bg-[rgba(99,91,255,0.10)]'
                    : 'border-[var(--border-strong)] bg-[var(--gray-800)]/50 hover:border-gray-600'
                }`}
                style={{ animationDelay: `${Math.min(idx, 20) * 30}ms` }}
              >
                <span
                  aria-hidden
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-all duration-200"
                  style={
                    item.done
                      ? {
                          background: 'var(--primary)',
                          boxShadow: '0 0 16px -2px rgba(99,91,255,0.55), 0 0 0 2px rgba(99,91,255,0.18)',
                          transform: 'scale(1)',
                        }
                      : {
                          background: 'transparent',
                          border: '2px solid #4b5563',
                        }
                  }
                >
                  {item.done && <CheckCircle size={16} strokeWidth={3} className="text-white animate-in zoom-in-50 duration-200" />}
                  {!item.done && <Circle size={0} className="opacity-0" />}
                </span>
                <span className={`text-sm flex-1 ${item.done ? 'text-cyan-100 line-through opacity-70' : 'text-white'}`}>
                  {label}
                </span>
              </button>
              );
            })}
          </div>
        </div>

        {/* Photos */}
        <div className="px-4 py-4 border-b border-[var(--border-strong)]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('visit.photos.title')}</p>
            <button onClick={() => void handlePhotoCapture()}
              aria-label={t('visit.photos.add_aria')}
              className="flex items-center gap-1.5 text-xs text-indigo-400 font-medium active:scale-95">
              <Camera size={14} />
              {t('visit.photos.add')}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileInput}
            aria-label={t('visit.photos.add_aria')}
          />
          {photos.length === 0 ? (
            <button onClick={() => void handlePhotoCapture()}
              aria-label={t('visit.photos.empty')}
              className="w-full border-2 border-dashed border-[var(--border-strong)] rounded-xl py-8 flex flex-col items-center gap-2 text-[var(--text-muted)] active:scale-98">
              <Camera size={28} />
              <span className="text-sm">{t('visit.photos.empty')}</span>
            </button>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={t('visit.photos.alt', { n: i + 1 })}
                  className="list-item-enter w-full aspect-square object-cover rounded-lg"
                  style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                />
              ))}
              <button onClick={() => fileInputRef.current?.click()}
                aria-label={t('visit.photos.add_aria')}
                className="aspect-square border-2 border-dashed border-[var(--border-strong)] rounded-lg flex items-center justify-center text-[var(--text-muted)] active:scale-95 hover:border-cyan-400 transition-colors">
                <Camera size={20} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Bar — segmented-control mobile XL touch */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-[var(--gray-900)]/95 backdrop-blur border-t border-[var(--border-strong)] px-3 py-3 z-20">
        {/* Status segmented-control horizontal scroll (touch XL ≥44px) */}
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-2 mb-2 no-scrollbar" role="group" aria-label={t('visit.status.section_aria')}>
          {Object.entries(STATUS_KEYS).map(([k, labelKey]) => {
            const isActive = status === k;
            const label = t(labelKey);
            return (
              <button
                key={k}
                onClick={() => void updateStatus(k)}
                className={`shrink-0 min-h-[44px] px-4 rounded-xl text-sm font-semibold transition-all whitespace-nowrap active:scale-[0.96] ${
                  isActive ? 'text-white' : 'text-[var(--text-muted)] bg-[var(--gray-800)] border border-[var(--border-strong)] hover:border-gray-600'
                }`}
                style={
                  isActive
                    ? {
                        background: 'var(--primary)',
                        boxShadow: '0 4px 14px -2px rgba(99,91,255,0.50), 0 0 0 1px rgba(99,91,255,0.32)',
                      }
                    : undefined
                }
                aria-pressed={isActive}
                aria-label={t('visit.status.set_aria', { status: label })}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          {/* Progress mini */}
          <div className="flex-1 flex items-center gap-2">
            <div
              className="flex-1 h-1.5 rounded-full bg-[var(--gray-800)] overflow-hidden"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('visit.kpi.progress')}
            >
              <div className="h-full rounded-full transition-all"
                style={{ width: `${progress}%`, background: 'linear-gradient(135deg, #635BFF, #8B5CF6)' }} />
            </div>
            <span className="text-[10px] text-[var(--text-muted)] tabular-nums w-9 text-right">{progress}%</span>
          </div>
          <button
            onClick={() => void handleFinish()}
            aria-label={t('visit.finish.cta_aria')}
            className="px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold text-white active:scale-95 transition-all whitespace-nowrap"
            style={{
              background: 'var(--primary)',
              boxShadow: '0 4px 14px -2px rgba(99,91,255,0.50)',
            }}
          >
            {t('visit.finish.cta')}
          </button>
        </div>
      </div>
    </div>
  );
}
