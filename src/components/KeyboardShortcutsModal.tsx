// ── KeyboardShortcutsModal — Aide raccourcis clavier (touche ?) ──────────────
// Sprint 23 wave 40 — sections premium gradient + search filter live + kbd brand

import { useEffect, useState, useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Search } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Icon } from '@/components/ui';

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const SECTIONS: ShortcutSection[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Ouvrir la recherche globale + commandes' },
      { keys: ['?'], description: 'Afficher ces raccourcis' },
      { keys: ['Esc'], description: 'Fermer la modale / panel / popover actuel' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['G', 'D'], description: 'Aller au Dashboard' },
      { keys: ['G', 'L'], description: 'Aller aux Leads' },
      { keys: ['G', 'P'], description: 'Aller au Pipeline' },
      { keys: ['G', 'I'], description: 'Aller à l\'Inbox' },
      { keys: ['G', 'C'], description: 'Aller au Calendrier' },
      { keys: ['G', 'T'], description: 'Aller aux Tâches' },
    ],
  },
  {
    title: 'Recherche / Commandes (dans ⌘K)',
    shortcuts: [
      { keys: ['nouveau lead', '<nom>'], description: 'Créer un lead rapidement' },
      { keys: ['aller au', '<page>'], description: 'Naviguer par nom de page' },
      { keys: ['déplacer', '<lead>', 'en', '<statut>'], description: 'Changer le statut d\'un lead' },
    ],
  },
  {
    title: 'AI inline (touche Sparkles)',
    shortcuts: [
      { keys: ['Améliorer'], description: 'Correction + clarification du texte' },
      { keys: ['Raccourcir'], description: 'Réduire d\'environ 50%' },
      { keys: ['Formel'], description: 'Registre professionnel québécois' },
      { keys: ['Amical'], description: 'Registre chaleureux québécois' },
    ],
  },
];

function KbdChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center justify-center min-w-[26px] h-7 px-2 text-[10px] font-mono font-bold rounded-md tabular-nums transition-all"
      style={{
        background: 'linear-gradient(135deg, rgba(0,157,219,0.10) 0%, rgba(217,110,39,0.06) 100%)',
        border: '1px solid rgba(0,157,219,0.22)',
        color: 'var(--primary)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.50)',
      }}
    >
      {children}
    </span>
  );
}

export function KeyboardShortcutsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingNavKey, setPendingNavKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setIsOpen(true);
        setPendingNavKey(null);
        return;
      }

      if (pendingNavKey === 'g') {
        e.preventDefault();
        const routes: Record<string, string> = {
          d: '/dashboard', l: '/leads', p: '/pipeline', i: '/inbox',
          c: '/calendar', t: '/tasks',
        };
        const path = routes[e.key.toLowerCase()];
        if (path) window.location.assign(path);
        setPendingNavKey(null);
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        setPendingNavKey('g');
        setTimeout(() => setPendingNavKey(prev => prev === 'g' ? null : prev), 1500);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pendingNavKey]);

  // Reset query au open
  useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);

  // Filtrage live des sections par query
  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS
      .map(section => ({
        ...section,
        shortcuts: section.shortcuts.filter(s =>
          s.description.toLowerCase().includes(q) ||
          s.keys.some(k => k.toLowerCase().includes(q))
        ),
      }))
      .filter(section => section.shortcuts.length > 0);
  }, [query]);

  return (
    <Modal open={isOpen} onOpenChange={setIsOpen} title="Raccourcis clavier" size="lg">
      <div className="space-y-4">
        {/* Search filter live */}
        <Input
          autoFocus
          placeholder="Filtrer les raccourcis..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          leftIcon={<Icon as={Search} size={15} />}
        />

        <div className="space-y-5 max-h-[55vh] overflow-y-auto -mr-2 pr-2">
          {filteredSections.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-6">
              Aucun raccourci ne correspond à « {query} ».
            </p>
          ) : (
            filteredSections.map(section => (
              <div key={section.title}>
                {/* Section header — gradient label + accent line */}
                <div className="flex items-center gap-3 mb-3">
                  <h3
                    className="text-[10px] font-bold uppercase tracking-[0.18em] heading-premium text-gradient-brand"
                  >
                    {section.title}
                  </h3>
                  <div
                    aria-hidden
                    className="flex-1 h-px"
                    style={{
                      background:
                        'linear-gradient(90deg, rgba(0,157,219,0.40) 0%, rgba(217,110,39,0.18) 50%, transparent 100%)',
                    }}
                  />
                </div>
                <div className="space-y-1">
                  {section.shortcuts.map((s, i) => (
                    <div
                      key={i}
                      className="row-premium list-item-enter flex items-center justify-between py-2 px-2.5 rounded-md"
                      style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
                    >
                      <span className="text-xs text-[var(--text-secondary)]">{s.description}</span>
                      <div className="flex items-center gap-1 shrink-0 ml-3">
                        {s.keys.map((k, ki) => (
                          <KbdChip key={ki}>{k}</KbdChip>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-[var(--border-subtle)] pt-3 text-[10px] text-[var(--text-muted)] text-center">
          Appuyer sur <KbdChip>?</KbdChip> n'importe où dans l'app pour revoir cette liste.
        </div>
      </div>
    </Modal>
  );
}
