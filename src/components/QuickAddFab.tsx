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

import { useState, useEffect } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Plus, UserPlus, CalendarPlus, ListChecks, StickyNote, Loader2 } from 'lucide-react';
import { createLead, createTask, createAppointment, getClients } from '@/lib/api';
import type { Client } from '@/lib/types';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { usePanelStack, useToast } from '@/components/ui';
import { useNavigate } from '@tanstack/react-router';

type QuickAction = 'lead' | 'appointment' | 'task' | 'note';

const ACTIONS: Array<{ id: QuickAction; label: string; icon: typeof UserPlus; color: string; shortcut: string }> = [
  { id: 'lead', label: 'Nouveau lead', icon: UserPlus, color: 'var(--brand-primary)', shortcut: 'L' },
  { id: 'appointment', label: 'Nouveau RDV', icon: CalendarPlus, color: 'var(--accent-orange)', shortcut: 'R' },
  { id: 'task', label: 'Nouvelle tâche', icon: ListChecks, color: 'var(--success)', shortcut: 'T' },
  { id: 'note', label: 'Note rapide', icon: StickyNote, color: 'var(--warning)', shortcut: 'N' },
];

export function QuickAddFab() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<QuickAction | null>(null);
  const [value, setValue] = useState('');
  const [extraField, setExtraField] = useState(''); // ex: date pour RDV
  const [isSaving, setIsSaving] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const { openPanel } = usePanelStack();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();

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
          toastError('Aucun client disponible — créez-en un d\'abord.');
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
          success(`Lead « ${value.trim()} » créé`);
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
          success('Tâche créée');
          closeModal();
        } else {
          toastError(`Erreur : ${res.error || 'inconnue'}`);
        }
        return;
      }
      if (activeAction === 'appointment') {
        if (!extraField) {
          toastError('Date requise');
          return;
        }
        const res = await createAppointment({
          title: value.trim(),
          start_time: `${extraField}T09:00:00`,
          end_time: `${extraField}T10:00:00`,
          type: 'meeting',
        });
        if (res.data?.id) {
          success('RDV créé');
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
        success('Note enregistrée localement');
        closeModal();
        return;
      }
    } finally {
      setIsSaving(false);
    }
  };

  const meta = activeAction ? ACTIONS.find(a => a.id === activeAction)! : null;

  return (
    <>
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="fixed bottom-20 right-5 z-40 w-12 h-12 rounded-full shadow-[0_4px_12px_oklch(0.7_0.15_220/0.4)] hover:shadow-[0_6px_20px_oklch(0.7_0.15_220/0.6)] transition-all hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center md:bottom-6"
            style={{ background: 'linear-gradient(135deg, var(--brand-primary), var(--accent-orange))' }}
            aria-label="Création rapide"
            title="Création rapide (lead, RDV, tâche, note)"
          >
            <Plus size={22} strokeWidth={2.5} className={`text-white transition-transform ${isOpen ? 'rotate-45' : ''}`} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="end"
            sideOffset={12}
            className="z-[60] w-56 p-1 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[var(--shadow-lg)] animate-in fade-in-0 zoom-in-95"
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Création rapide
            </div>
            {ACTIONS.map(({ id, label, icon: Icon, color }) => (
              <button
                key={id}
                type="button"
                onClick={() => openAction(id)}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-[var(--radius-sm)] text-left hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
              >
                <Icon size={15} style={{ color }} className="shrink-0" />
                <span className="text-xs font-medium text-[var(--text-primary)] flex-1">{label}</span>
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

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
              activeAction === 'lead' ? 'Nom du lead (ex: Jean Dupont)' :
              activeAction === 'appointment' ? 'Titre du RDV' :
              activeAction === 'task' ? 'Titre de la tâche' :
              'Contenu de la note'
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
            <Button variant="ghost" onClick={closeModal} disabled={isSaving}>Annuler</Button>
            <Button onClick={() => void handleSave()} disabled={!value.trim() || isSaving}
              leftIcon={isSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
              Créer
            </Button>
          </div>
          {activeAction === 'lead' && (
            <p className="text-[10px] text-[var(--text-muted)]">
              Email placeholder généré — à compléter dans la fiche après création.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
