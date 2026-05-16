// ── ScopePicker — Sprint 30 vague 30-2B ─────────────────────────────────
// Multi-select chips groupés par catégorie pour scopes API + events webhook.
// FilterChip primitive est mono-select linéaire — ScopePicker propose une
// grille catégorisée avec headers brand + chip toggle + select-all par cat.
//
// Usage typique :
//   <ScopePicker
//     mode="scope"          // 8 scopes API (read:*, write:*)
//     value={selectedScopes}
//     onChange={setSelectedScopes}
//   />
//   <ScopePicker
//     mode="event"          // 12 events groupés (lead/deal/task/conversation)
//     value={selectedEvents}
//     onChange={setSelectedEvents}
//   />

import { useMemo } from 'react';
import { Check, Lock, Shield, Webhook, User, Briefcase, ListTodo, MessageSquare } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Icon } from './Icon';
import { cn } from '@/lib/cn';

export type ScopePickerMode = 'scope' | 'event';

export interface ScopeOption {
  key: string;
  label: string;
  description?: string;
}

export interface ScopeCategory {
  id: string;
  label: string;
  icon: React.ReactNode;
  options: ScopeOption[];
}

// ── 8 scopes API (read/write × 4 ressources) ──
export const API_SCOPES: ScopeCategory[] = [
  {
    id: 'leads',
    label: 'Leads',
    icon: <Icon as={User} size={13} strokeWidth={2} />,
    options: [
      { key: 'read:leads', label: 'Lecture leads', description: 'Lister + détails' },
      { key: 'write:leads', label: 'Écriture leads', description: 'Créer + modifier + supprimer' },
    ],
  },
  {
    id: 'deals',
    label: 'Deals',
    icon: <Icon as={Briefcase} size={13} strokeWidth={2} />,
    options: [
      { key: 'read:deals', label: 'Lecture deals', description: 'Pipeline + montants' },
      { key: 'write:deals', label: 'Écriture deals', description: 'Modifier étape + valeurs' },
    ],
  },
  {
    id: 'tasks',
    label: 'Tâches',
    icon: <Icon as={ListTodo} size={13} strokeWidth={2} />,
    options: [
      { key: 'read:tasks', label: 'Lecture tâches', description: 'Lister + assignations' },
      { key: 'write:tasks', label: 'Écriture tâches', description: 'Créer + terminer' },
    ],
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: <Icon as={MessageSquare} size={13} strokeWidth={2} />,
    options: [
      { key: 'read:conversations', label: 'Lecture messages', description: 'Threads + historique' },
      { key: 'write:conversations', label: 'Écriture messages', description: 'Envoyer SMS / email' },
    ],
  },
];

// ── 12 events webhook (3 par ressource × 4 ressources) ──
export const WEBHOOK_EVENTS: ScopeCategory[] = [
  {
    id: 'lead',
    label: 'Lead',
    icon: <Icon as={User} size={13} strokeWidth={2} />,
    options: [
      { key: 'lead.created', label: 'Lead créé', description: 'Nouveau lead entrant' },
      { key: 'lead.status_changed', label: 'Statut modifié', description: 'Changement de statut' },
      { key: 'lead.assigned', label: 'Lead assigné', description: 'Assignation user' },
    ],
  },
  {
    id: 'deal',
    label: 'Deal',
    icon: <Icon as={Briefcase} size={13} strokeWidth={2} />,
    options: [
      { key: 'deal.stage_changed', label: 'Étape changée', description: 'Mouvement pipeline' },
      { key: 'deal.won', label: 'Deal gagné', description: 'Fermeture gagnée' },
      { key: 'deal.lost', label: 'Deal perdu', description: 'Fermeture perdue' },
    ],
  },
  {
    id: 'task',
    label: 'Tâche',
    icon: <Icon as={ListTodo} size={13} strokeWidth={2} />,
    options: [
      { key: 'task.created', label: 'Tâche créée', description: 'Nouvelle tâche' },
      { key: 'task.completed', label: 'Tâche terminée', description: 'Marquée done' },
      { key: 'task.overdue', label: 'Tâche en retard', description: 'Dépassement deadline' },
    ],
  },
  {
    id: 'conversation',
    label: 'Conversation',
    icon: <Icon as={MessageSquare} size={13} strokeWidth={2} />,
    options: [
      { key: 'message.received', label: 'Message reçu', description: 'SMS / email entrant' },
      { key: 'message.sent', label: 'Message envoyé', description: 'Sortant confirmé' },
      { key: 'appointment.created', label: 'RDV créé', description: 'Rendez-vous planifié' },
    ],
  },
];

export interface ScopePickerProps {
  mode: ScopePickerMode;
  value: string[];
  onChange: (next: string[]) => void;
  /** Catégories custom (override des defaults) */
  categories?: ScopeCategory[];
  /** Désactive le picker entier (read-only) */
  disabled?: boolean;
  className?: string;
}

export function ScopePicker({ mode, value, onChange, categories, disabled = false, className }: ScopePickerProps) {
  const cats = useMemo(
    () => categories ?? (mode === 'scope' ? API_SCOPES : WEBHOOK_EVENTS),
    [categories, mode],
  );

  const selected = useMemo(() => new Set(value), [value]);

  const toggle = (key: string) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(Array.from(next));
  };

  const toggleCategory = (cat: ScopeCategory, allSelected: boolean) => {
    if (disabled) return;
    const next = new Set(selected);
    for (const opt of cat.options) {
      if (allSelected) next.delete(opt.key);
      else next.add(opt.key);
    }
    onChange(Array.from(next));
  };

  const totalCount = cats.reduce((acc, c) => acc + c.options.length, 0);
  const selectedCount = value.length;
  const allWildcard = mode === 'event' && value.includes('*');

  return (
    <div className={cn('scope-picker', className)} role="group" aria-label={mode === 'scope' ? 'Sélection des scopes' : 'Sélection des évènements'}>
      <div className="scope-picker-header">
        <div className="flex items-center gap-2">
          {mode === 'scope' ? (
            <Icon as={Shield} size={14} className="text-[var(--primary)]" />
          ) : (
            <Icon as={Webhook} size={14} className="text-[var(--primary)]" />
          )}
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            {mode === 'scope' ? 'Permissions accordées' : 'Évènements à écouter'}
          </span>
        </div>
        <span className="scope-picker-count" aria-live="polite">
          {allWildcard ? `Tous (${totalCount})` : `${selectedCount} / ${totalCount}`}
        </span>
      </div>

      {mode === 'event' && (
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            if (allWildcard) onChange([]);
            else onChange(['*']);
          }}
          className={cn('scope-chip scope-chip--wildcard', allWildcard && 'scope-chip--selected')}
          disabled={disabled}
        >
          <Icon as={Lock} size={11} strokeWidth={2.4} />
          <span>Tous les évènements</span>
          <span className="scope-chip__hint">recommandé</span>
          {allWildcard && <Icon as={Check} size={11} strokeWidth={3} className="ml-auto" />}
        </button>
      )}

      <div className="scope-picker-grid">
        {cats.map((cat) => {
          const catKeys = cat.options.map((o) => o.key);
          const catSelectedCount = catKeys.filter((k) => selected.has(k)).length;
          const allCatSelected = catSelectedCount === catKeys.length;
          const dimmed = allWildcard;

          return (
            <div key={cat.id} className={cn('scope-picker-category', dimmed && 'scope-picker-category--dimmed')}>
              <div className="scope-picker-category-header">
                <div className="flex items-center gap-1.5">
                  <span className="scope-picker-category-icon">{cat.icon}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {cat.label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleCategory(cat, allCatSelected)}
                  disabled={disabled || dimmed}
                  className="scope-picker-category-toggle"
                >
                  {allCatSelected ? 'Tout retirer' : `Tout (${catKeys.length})`}
                </button>
              </div>
              <div className="scope-picker-category-chips">
                {cat.options.map((opt) => {
                  const active = selected.has(opt.key) || allWildcard;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => toggle(opt.key)}
                      disabled={disabled || dimmed}
                      className={cn('scope-chip', active && 'scope-chip--selected')}
                      aria-pressed={active}
                      title={opt.description}
                    >
                      <span className="scope-chip__check" aria-hidden>
                        {active && <Icon as={Check} size={10} strokeWidth={3} />}
                      </span>
                      <span className="scope-chip__label">
                        <code className="scope-chip__key">{opt.key}</code>
                        <span className="scope-chip__desc">{opt.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
