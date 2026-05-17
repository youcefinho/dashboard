// ── QuickAddFab — Bouton flottant universel de création rapide ──────────────
// Différenciateur power-user vs GHL : depuis n'importe quelle page, "+" → menu
// rapide pour créer lead / RDV / tâche / note. Réduit la friction de capture.
//
// Comportement :
//   - FAB bottom-right (au-dessus de MobileBottomNav sur mobile)
//   - Click → Popover avec 4 actions
//   - Click sur une action → mini-modale avec 1 champ principal + save
//   - Lead créé → ouvre LeadPanel directement
//   - Pas visible sur les routes publiques (Login, landing, etc.) — wrapped dans AppLayout

import { useState, useEffect, useRef } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Plus, UserPlus, CalendarPlus, ListChecks, StickyNote, Loader2 } from 'lucide-react';
import { createLead, createTask, createAppointment, getClients } from '@/lib/api';
import type { Client } from '@/lib/types';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { usePanelStack, useToast, BottomSheet } from '@/components/ui';
import { useNavigate } from '@tanstack/react-router';
import { triggerHaptic } from '@/lib/sensorial';
import { t } from '@/lib/i18n';

type QuickAction = 'lead' | 'appointment' | 'task' | 'note';

const ACTIONS: Array<{ id: QuickAction; label: string; icon: typeof UserPlus; color: string; shortcut: string }> = [
  { id: 'lead', label: t('fab.new_lead'), icon: UserPlus, color: 'var(--primary)', shortcut: 'L' },
  { id: 'appointment', label: t('fab.new_appointment'), icon: CalendarPlus, color: 'var(--accent-orange)', shortcut: 'R' },
  { id: 'task', label: t('fab.new_task'), icon: ListChecks, color: 'var(--success)', shortcut: 'T' },
  { id: 'note', label: t('fab.quick_note'), icon: StickyNote, color: 'var(--warning)', shortcut: 'N' },
];

export function QuickAddFab() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<QuickAction | null>(null);
  const [value, setValue] = useState('');
  const [extraField, setExtraField] = useState(''); // ex: date pour RDV
  const [isSaving, setIsSaving] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  // Sprint 30 vague 30-3A — scroll-aware shrink + long-press fan-out
  const [isShrunk, setIsShrunk] = useState(false);
  const [isFanOut, setIsFanOut] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const { openPanel } = usePanelStack();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();

  // Détection mobile (pointer coarse ou width < 768) pour switcher Popover → BottomSheet
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px), (pointer: coarse)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  // Sprint 30 vague 30-3A — scroll-aware shrink (Y>200px → 40px icon-only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        // Scroll détecté soit sur window, soit sur le main scroll container
        const winY = window.scrollY || 0;
        const mainEl = document.getElementById('main-content');
        const mainY = mainEl ? mainEl.scrollTop : 0;
        const y = Math.max(winY, mainY);
        setIsShrunk(y > 200);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const mainEl = document.getElementById('main-content');
    mainEl?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      mainEl?.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Charger clients on demand (pour lead default client_id)
  useEffect(() => {
    if (activeAction === 'lead' && clients.length === 0) {
      getClients().then(r => { if (r.data) setClients(r.data); }).catch(() => {});
    }
  }, [activeAction, clients.length]);

  const openAction = (action: QuickAction) => {
    setIsOpen(false);
    setActiveAction(action);
    setValue('');
    setExtraField(action === 'appointment' ? new Date().toISOString().slice(0, 10) : '');
  };

  const closeModal = () => {
    setActiveAction(null);
    setValue('');
    setExtraField('');
  };

  const handleSave = async () => {
    if (!value.trim() || !activeAction) return;
    setIsSaving(true);
    try {
      if (activeAction === 'lead') {
        if (clients.length === 0) {
          toastError(t('fab.no_client'));
          return;
        }
        const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
        const placeholderEmail = `${slug || 'lead'}-${Date.now().toString(36)}@quick.local`;
        const res = await createLead({
          client_id: clients[0]!.id,
          name: value.trim(),
          email: placeholderEmail,
          source: 'manual',
        });
        if (res.data?.id) {
          success(t('fab.lead_created').replace('{name}', value.trim()));
          closeModal();
          openPanel({ type: 'lead', id: res.data.id });
        } else {
          toastError(`Erreur : ${res.error || 'inconnue'}`);
        }
        return;
      }
      if (activeAction === 'task') {
        const res = await createTask({
          title: value.trim(),
          status: 'todo',
          priority: 'medium',
          due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        });
        if (res.data?.id) {
          success(t('fab.task_created'));
          closeModal();
        } else {
          toastError(`Erreur : ${res.error || 'inconnue'}`);
        }
        return;
      }
      if (activeAction === 'appointment') {
        if (!extraField) {
          toastError(t('fab.date_required'));
          return;
        }
        const res = await createAppointment({
          title: value.trim(),
          start_time: `${extraField}T09:00:00`,
          end_time: `${extraField}T10:00:00`,
          type: 'meeting',
        });
        if (res.data?.id) {
          success(t('fab.appt_created'));
          closeModal();
          void navigate({ to: '/calendar' });
        } else {
          toastError(`Erreur : ${res.error || 'inconnue'}`);
        }
        return;
      }
      if (activeAction === 'note') {
        // Note rapide standalone : on stocke en localStorage pour l'instant
        // (pas d'endpoint /notes/quick — pourrait être ajouté en Sprint suivant)
        const stored = localStorage.getItem('intralys_quick_notes');
        const notes = stored ? (JSON.parse(stored) as Array<{ body: string; ts: number }>) : [];
        notes.unshift({ body: value.trim(), ts: Date.now() });
        localStorage.setItem('intralys_quick_notes', JSON.stringify(notes.slice(0, 50)));
        success(t('fab.note_saved'));
        closeModal();
        return;
      }
    } finally {
      setIsSaving(false);
    }
  };

  const meta = activeAction ? ACTIONS.find(a => a.id === activeAction)! : null;

  const actionGrid = (
    <div className="grid grid-cols-2 gap-2">
      {ACTIONS.map(({ id, label, icon: Icon, color, shortcut }) => (
        <button
          key={id}
          type="button"
          onClick={() => openAction(id)}
          className="action-chip text-left flex flex-col items-start gap-1.5 !py-3 !px-3 group"
          title={`${label} (${shortcut})`}
        >
          <span className="flex items-center justify-between w-full">
            <span
              className="action-chip-icon"
              style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)`, borderColor: `color-mix(in srgb, ${color} 28%, transparent)` }}
            >
              <Icon size={14} strokeWidth={2.25} />
            </span>
            <kbd className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-muted)] group-hover:border-[rgba(0,157,219,0.30)] group-hover:text-[var(--primary)] transition-colors">
              {shortcut}
            </kbd>
          </span>
          <span className="text-xs font-semibold text-[var(--text-primary)]">{label}</span>
        </button>
      ))}
    </div>
  );

  // Sprint 30 vague 30-3A — long-press 400ms → fan-out arc 4 actions
  const startLongPress = () => {
    longPressFired.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      triggerHaptic('medium');
      setIsFanOut(true);
    }, 400);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const handleFabTap = () => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return; // ne pas ouvrir le popover si long-press déjà fired
    }
    triggerHaptic('light');
    if (isMobile) setIsOpen((v) => !v);
  };
  const closeFanOut = () => setIsFanOut(false);
  const handleFanOutAction = (id: QuickAction) => {
    setIsFanOut(false);
    openAction(id);
  };

  const fabClassName = [
    'quick-add-fab',
    'fixed bottom-20 right-5 z-40 rounded-full transition-all active:scale-95 cursor-pointer flex items-center justify-center md:bottom-6',
    isShrunk ? 'fab-shrunk w-10 h-10' : 'w-14 h-14 hover:scale-110',
  ].join(' ');

  const triggerBtn = (
    <button
      type="button"
      data-tour-id="quick-add-fab"
      onClick={isMobile ? handleFabTap : undefined}
      onTouchStart={startLongPress}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
      onTouchMove={cancelLongPress}
      onMouseDown={startLongPress}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
      className={fabClassName}
      style={{
        background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
        boxShadow: '0 6px 22px -2px rgba(0,157,219,0.55), 0 0 0 4px rgba(0,157,219,0.10), 0 0 28px -4px rgba(217,110,39,0.45)',
      }}
      aria-label={t('fab.title')}
      title={t('fab.title')}
    >
      <Plus size={isShrunk ? 18 : 24} strokeWidth={2.5} className={`text-white transition-transform duration-200 ${isOpen || isFanOut ? 'rotate-45' : ''}`} />
    </button>
  );

  // Fan-out arc — 4 actions disposées sur un arc 80° (de -10° à 90° en sens horaire-anti),
  // radius 64px depuis centre FAB. Angles (en degrés depuis vertical haut, sens anti-horaire) :
  //   0° = haut, 80° = gauche. On répartit 4 actions sur 80° → step 26.67°.
  // Position relative au FAB (right-5 bottom-20) : on calcule (-sin*r, -cos*r).
  const fanOutOverlay = isFanOut ? (
    <>
      <div
        className="fixed inset-0 z-30"
        onClick={closeFanOut}
        onTouchStart={closeFanOut}
        aria-hidden
      />
      <div
        className="fab-fan-out fixed z-40 pointer-events-none"
        style={{ right: '20px', bottom: isShrunk ? '80px' : '80px', width: 0, height: 0 }}
        role="menu"
        aria-label="Actions de création rapide"
      >
        {ACTIONS.map(({ id, label, icon: ActionIcon, color }, idx) => {
          const step = 80 / (ACTIONS.length - 1 || 1); // 4 actions → step ≈ 26.67°
          const angleDeg = idx * step; // 0° = direct top, 80° ≈ left
          const angleRad = (angleDeg * Math.PI) / 180;
          const r = 64;
          // FAB center est à (right:20+halfW, bottom:80+halfH). Anchor (0,0) = FAB center.
          // x va vers la gauche → négatif right; y va vers le haut → négatif bottom.
          const dx = -Math.sin(angleRad) * r;
          const dy = -Math.cos(angleRad) * r;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleFanOutAction(id)}
              className="fab-fan-out-item pointer-events-auto absolute w-11 h-11 rounded-full flex items-center justify-center"
              style={{
                transform: `translate(${dx}px, ${dy}px)`,
                background: `color-mix(in srgb, ${color} 92%, white)`,
                boxShadow: `0 6px 18px -4px ${color}, 0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)`,
                animationDelay: `${idx * 40}ms`,
                color: '#fff',
              }}
              aria-label={label}
              title={label}
            >
              <ActionIcon size={18} strokeWidth={2.25} />
            </button>
          );
        })}
      </div>
    </>
  ) : null;

  return (
    <>
      {fanOutOverlay}
      {isMobile ? (
        <>
          {triggerBtn}
          <BottomSheet
            open={isOpen}
            onOpenChange={setIsOpen}
            title={t('fab.title')}
            description={t('fab.choose_type')}
            size="auto"
            showHandle
          >
            {actionGrid}
          </BottomSheet>
        </>
      ) : (
        <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
          <Popover.Trigger asChild>{triggerBtn}</Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="end"
              sideOffset={14}
              className="z-[60] w-[300px] p-3 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[var(--shadow-lg)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
              style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 24px 64px -12px rgba(0,157,219,0.20)' }}
            >
              <div className="px-1 pb-2 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] flex items-center justify-between">
                <span>{t('fab.title')}</span>
                <span className="text-[9px] normal-case tracking-normal text-[var(--text-muted)]/70">{t('fab.hint')}</span>
              </div>
              {actionGrid}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}

      {/* Mini-modale création rapide */}
      <Modal
        open={activeAction !== null}
        onOpenChange={(o) => { if (!o) closeModal(); }}
        title={meta?.label || ''}
        size="sm"
      >
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder={
              activeAction === 'lead' ? t('fab.ph_lead') :
              activeAction === 'appointment' ? t('fab.ph_appointment') :
              activeAction === 'task' ? t('fab.ph_task') :
              t('fab.ph_note')
            }
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isSaving) void handleSave(); }}
          />
          {activeAction === 'appointment' && (
            <Input
              type="date"
              value={extraField}
              onChange={(e) => setExtraField(e.target.value)}
              placeholder="Date"
            />
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={closeModal} disabled={isSaving}>{t('fab.cancel')}</Button>
            <Button onClick={() => void handleSave()} disabled={!value.trim() || isSaving}
              leftIcon={isSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
              {t('fab.create')}
            </Button>
          </div>
          {activeAction === 'lead' && (
            <p className="text-[10px] text-[var(--text-muted)]">
              {t('fab.email_hint')}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
