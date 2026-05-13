// ── KeyboardShortcutsModal — Aide raccourcis clavier (touche ?) ──────────────
// Inspiration Linear/Notion. Active la touche `?` (sans modifier) pour ouvrir.
// Ignoré quand le focus est dans un input/textarea.

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';

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
    title: 'AI inline (touche ✨ Sparkles)',
    shortcuts: [
      { keys: ['Améliorer'], description: 'Correction + clarification du texte' },
      { keys: ['Raccourcir'], description: 'Réduire d\'environ 50%' },
      { keys: ['Formel'], description: 'Registre professionnel québécois' },
      { keys: ['Amical'], description: 'Registre chaleureux québécois' },
    ],
  },
];

export function KeyboardShortcutsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingNavKey, setPendingNavKey] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore les inputs/textareas/contenteditable
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      ) {
        return;
      }

      // Ignore avec modifiers
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ? = ouvrir cette modale (Shift+/ sur QWERTY ; key directe sur AZERTY)
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setIsOpen(true);
        setPendingNavKey(null);
        return;
      }

      // Séquences "G + X" pour navigation
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
        // Démarre une séquence — timeout 1500ms
        setPendingNavKey('g');
        setTimeout(() => setPendingNavKey(prev => prev === 'g' ? null : prev), 1500);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pendingNavKey]);

  return (
    <Modal open={isOpen} onOpenChange={setIsOpen} title="Raccourcis clavier" size="lg">
      <div className="space-y-5 max-h-[60vh] overflow-y-auto">
        {SECTIONS.map(section => (
          <div key={section.title}>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              {section.title}
            </h3>
            <div className="space-y-1.5">
              {section.shortcuts.map((s, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-[var(--radius-sm)] hover:bg-[var(--bg-subtle)] transition-colors">
                  <span className="text-xs text-[var(--text-secondary)]">{s.description}</span>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    {s.keys.map((k, ki) => (
                      <span key={ki} className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-[10px] font-mono font-semibold bg-[var(--bg-subtle)] border border-[var(--border-default)] rounded-[var(--radius-sm)] text-[var(--text-secondary)]">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="border-t border-[var(--border-subtle)] pt-3 text-[10px] text-[var(--text-muted)] text-center">
          Appuyer sur <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[9px] font-mono bg-[var(--bg-subtle)] border border-[var(--border-default)] rounded">?</kbd> n'importe où dans l'app pour revoir cette liste.
        </div>
      </div>
    </Modal>
  );
}
