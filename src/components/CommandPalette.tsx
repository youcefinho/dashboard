// ── CommandPalette — Recherche globale ⌘K ───────────────────

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { getLeads, getClients } from '@/lib/api';
import type { Lead, Client } from '@/lib/types';

interface CommandItem {
  id: string;
  icon: string;
  label: string;
  description: string;
  action: () => void;
  category: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Charger les données pour la recherche
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Focus l'input après le rendu
      setTimeout(() => inputRef.current?.focus(), 50);
      // Charger leads et clients
      getLeads().then(res => { if (res.data) setLeads(res.data); }).catch(() => { /* ignoré */ });
      getClients().then(res => { if (res.data) setClients(res.data); }).catch(() => { /* ignoré */ });
    }
  }, [isOpen]);

  // Naviguer et fermer
  const go = useCallback((path: string) => {
    onClose();
    void navigate({ to: path });
  }, [onClose, navigate]);

  // Construction des items
  const allItems = useMemo((): CommandItem[] => {
    const pages: CommandItem[] = [
      { id: 'nav-dashboard', icon: '📊', label: 'Dashboard', description: 'Vue globale', action: () => go('/dashboard'), category: 'Navigation' },
      { id: 'nav-leads', icon: '📋', label: 'Leads', description: 'Liste des leads', action: () => go('/leads'), category: 'Navigation' },
      { id: 'nav-clients', icon: '👥', label: 'Clients', description: 'Gestion des sous-comptes', action: () => go('/clients'), category: 'Navigation' },
      { id: 'nav-pipeline', icon: '🔀', label: 'Pipeline', description: 'Vue Kanban', action: () => go('/pipeline'), category: 'Navigation' },
      { id: 'nav-inbox', icon: '💬', label: 'Conversations', description: 'Inbox email/SMS', action: () => go('/inbox'), category: 'Navigation' },
      { id: 'nav-templates', icon: '📝', label: 'Templates', description: 'Modèles d\'email', action: () => go('/templates'), category: 'Navigation' },
      { id: 'nav-workflows', icon: '⚡', label: 'Automations', description: 'Workflows', action: () => go('/workflows'), category: 'Navigation' },
      { id: 'nav-calendar', icon: '📅', label: 'Calendrier', description: 'Rendez-vous', action: () => go('/calendar'), category: 'Navigation' },
      { id: 'nav-tasks', icon: '✅', label: 'Tâches', description: 'Todo list', action: () => go('/tasks'), category: 'Navigation' },
      { id: 'nav-integrations', icon: '🔌', label: 'Intégrations', description: 'Facebook, Google, Calendly', action: () => go('/integrations'), category: 'Navigation' },
      { id: 'nav-reports', icon: '📈', label: 'Rapports', description: 'Analytics', action: () => go('/reports'), category: 'Navigation' },
      { id: 'nav-settings', icon: '⚙️', label: 'Paramètres', description: 'Configuration', action: () => go('/settings'), category: 'Navigation' },
    ];

    const leadItems: CommandItem[] = leads.map(l => ({
      id: `lead-${l.id}`,
      icon: l.type === 'inbound' ? '🏠' : '💰',
      label: l.name,
      description: `${l.client_name || l.client_id} · ${l.email}`,
      action: () => go(`/leads/${l.id}`),
      category: 'Leads',
    }));

    const clientItems: CommandItem[] = clients.map(c => ({
      id: `client-${c.id}`,
      icon: '🏢',
      label: c.name,
      description: `${c.email || ''} · ${c.lead_count ?? 0} leads`,
      action: () => go(`/clients/${c.id}/leads`),
      category: 'Clients',
    }));

    return [...pages, ...leadItems, ...clientItems];
  }, [leads, clients, go]);

  // Filtrer par query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 15);
    const q = query.toLowerCase();
    return allItems.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [query, allItems]);

  // Regrouper par catégorie
  const groupedItems = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    filteredItems.forEach(item => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category]!.push(item);
    });
    return groups;
  }, [filteredItems]);

  // Reset index quand query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Clavier
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filteredItems[selectedIndex]) {
      e.preventDefault();
      filteredItems[selectedIndex].action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filteredItems, selectedIndex, onClose]);

  if (!isOpen) return null;

  let flatIndex = 0;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        {/* Input de recherche */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher leads, pages, clients..."
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-subtle)] text-[var(--text-muted)] rounded border border-[var(--border-subtle)]">ESC</kbd>
        </div>

        {/* Résultats */}
        <div className="max-h-[400px] overflow-y-auto py-2">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-[var(--text-muted)]">Aucun résultat pour « {query} »</p>
            </div>
          ) : (
            Object.entries(groupedItems).map(([category, items]) => (
              <div key={category}>
                <p className="px-4 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">{category}</p>
                {items.map((item) => {
                  const itemIndex = flatIndex++;
                  const isSelected = itemIndex === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      onClick={item.action}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition-colors ${
                        isSelected ? 'bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]' : 'hover:bg-[var(--bg-subtle)]'
                      }`}
                    >
                      <span className="text-base w-6 text-center shrink-0">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.label}</p>
                        <p className="text-[10px] text-[var(--text-muted)] truncate">{item.description}</p>
                      </div>
                      {isSelected && (
                        <kbd className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-subtle)] text-[var(--text-muted)] rounded shrink-0">↵</kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">
          <span>↑↓ naviguer</span>
          <span>↵ ouvrir</span>
          <span>esc fermer</span>
        </div>
      </div>
    </div>
  );
}
