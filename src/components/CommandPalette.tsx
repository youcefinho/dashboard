// ── CommandPalette — Recherche + Intent engine (Sprint 19) ─────────────────
// Sprint 19 a étendu ce composant : en plus de la recherche fuzzy, le palette
// détecte des **intents** dans la query et offre des actions directement
// exécutables (créer lead, naviguer, etc.). Inspiration : Linear, Raycast.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { getLeads, getClients, createLead, updateLead } from '@/lib/api';
import type { Lead, Client, LeadStatus } from '@/lib/types';
import { LEAD_STATUSES, STATUS_LABELS } from '@/lib/types';
import { usePanelStack, useToast } from '@/components/ui';

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

// ── Intent parser : detect actions from natural-ish input ────────────────────

type ParsedIntent =
  | { type: 'create-lead'; name: string }
  | { type: 'navigate'; target: string }
  | { type: 'move-status'; leadQuery: string; status: LeadStatus }
  | { type: 'open-lead'; query: string }
  | null;

const ROUTE_KEYWORDS: Array<{ keywords: string[]; path: string; label: string }> = [
  { keywords: ['dashboard', 'tableau de bord', 'accueil'], path: '/dashboard', label: 'Dashboard' },
  { keywords: ['leads', 'prospects'], path: '/leads', label: 'Leads' },
  { keywords: ['clients', 'sous-comptes'], path: '/clients', label: 'Clients' },
  { keywords: ['pipeline', 'kanban'], path: '/pipeline', label: 'Pipeline' },
  { keywords: ['inbox', 'conversations', 'messages'], path: '/inbox', label: 'Conversations' },
  { keywords: ['calendrier', 'calendar', 'rdv'], path: '/calendar', label: 'Calendrier' },
  { keywords: ['taches', 'tasks', 'todo'], path: '/tasks', label: 'Tâches' },
  { keywords: ['templates', 'modeles'], path: '/templates', label: 'Templates' },
  { keywords: ['workflows', 'automations'], path: '/workflows', label: 'Workflows' },
  { keywords: ['rapports', 'reports', 'analytics'], path: '/reports', label: 'Rapports' },
  { keywords: ['settings', 'parametres', 'reglages'], path: '/settings', label: 'Paramètres' },
  { keywords: ['integrations'], path: '/integrations', label: 'Intégrations' },
];

function parseIntent(query: string): ParsedIntent {
  const q = query.trim();
  if (!q) return null;

  // "créer lead Jean Dupont" / "create lead Jean" / "nouveau lead Jean" / "+lead Jean"
  const createLeadMatch = q.match(/^(?:cr[ée]er?|create|new|nouveau|nouvelle|\+)\s+(?:lead|prospect|contact)\s+(.+)/i);
  if (createLeadMatch) {
    return { type: 'create-lead', name: createLeadMatch[1]!.trim() };
  }

  // "aller au pipeline" / "go to leads" / ">leads"
  const navMatch = q.match(/^(?:aller|go|naviguer|navigate|ouvrir|open|>)\s*(?:au|vers|to|à)?\s+(.+)/i);
  if (navMatch) {
    const target = navMatch[1]!.toLowerCase().trim();
    const route = ROUTE_KEYWORDS.find(r => r.keywords.some(k => target.includes(k)));
    if (route) return { type: 'navigate', target: route.path };
  }

  // "déplacer X en contacted" / "move X to signed"
  const moveMatch = q.match(/^(?:d[ée]placer?|move|passer)\s+(.+?)\s+(?:en|vers|to|à)\s+(\w+)/i);
  if (moveMatch) {
    const statusInput = moveMatch[2]!.toLowerCase();
    const status = LEAD_STATUSES.find(s =>
      s === statusInput || STATUS_LABELS[s]?.toLowerCase().includes(statusInput)
    );
    if (status) return { type: 'move-status', leadQuery: moveMatch[1]!.trim(), status };
  }

  return null;
}

// ── Storage key pour actions récentes ────────────────────────────────────────
const RECENT_INTENTS_KEY = 'intralys_cmd_recent_intents';

function loadRecentIntents(): string[] {
  try {
    const v = localStorage.getItem(RECENT_INTENTS_KEY);
    return v ? (JSON.parse(v) as string[]).slice(0, 5) : [];
  } catch { return []; }
}

function saveRecentIntent(q: string): void {
  try {
    const current = loadRecentIntents().filter(x => x !== q);
    const next = [q, ...current].slice(0, 5);
    localStorage.setItem(RECENT_INTENTS_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

const PLACEHOLDER_HINTS = [
  'Essayez : « nouveau lead Jean Dupont »',
  'Essayez : « aller au pipeline »',
  'Essayez : « déplacer Jean en signed »',
  'Tapez « / » pour les commandes',
];

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hintIndex, setHintIndex] = useState(0);
  const [recentIntents, setRecentIntents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { openPanel } = usePanelStack();
  const { success, error: toastError } = useToast();

  // Rotate placeholder hints
  useEffect(() => {
    if (!isOpen) return;
    setHintIndex(Math.floor(Math.random() * PLACEHOLDER_HINTS.length));
    const interval = setInterval(() => {
      setHintIndex(i => (i + 1) % PLACEHOLDER_HINTS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Charger les données pour la recherche
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setRecentIntents(loadRecentIntents());
      setTimeout(() => inputRef.current?.focus(), 50);
      getLeads().then(res => { if (res.data) setLeads(res.data); }).catch(() => { /* ignoré */ });
      getClients().then(res => { if (res.data) setClients(res.data); }).catch(() => { /* ignoré */ });
    }
  }, [isOpen]);

  const go = useCallback((path: string) => {
    onClose();
    void navigate({ to: path });
  }, [onClose, navigate]);

  // ── Exécuteurs d'intents ───────────────────────────────────────────────────
  const intent = useMemo(() => parseIntent(query), [query]);

  const executeIntent = useCallback(async (i: NonNullable<ParsedIntent>) => {
    saveRecentIntent(query);
    if (i.type === 'create-lead') {
      if (clients.length === 0) {
        toastError('Aucun client disponible — créez-en un d\'abord.');
        return;
      }
      // Pour quick-create, slug du nom comme email placeholder
      const slug = i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
      const placeholderEmail = `${slug || 'lead'}-${Date.now().toString(36)}@quick.local`;
      onClose();
      const res = await createLead({
        client_id: clients[0]!.id,
        name: i.name,
        email: placeholderEmail,
        source: 'manual',
      });
      if (res.data?.id) {
        success(`Lead « ${i.name} » créé. Pensez à compléter l'email.`);
        openPanel({ type: 'lead', id: res.data.id });
      } else {
        toastError(`Erreur création lead : ${res.error || 'inconnue'}`);
      }
      return;
    }
    if (i.type === 'navigate') {
      go(i.target);
      return;
    }
    if (i.type === 'move-status') {
      const q = i.leadQuery.toLowerCase();
      const match = leads.find(l => l.name.toLowerCase().includes(q) || l.email?.toLowerCase().includes(q));
      if (!match) {
        toastError(`Aucun lead trouvé pour « ${i.leadQuery} ».`);
        return;
      }
      onClose();
      const res = await updateLead(match.id, { status: i.status });
      if (res.error) {
        toastError(`Erreur mise à jour : ${res.error}`);
      } else {
        success(`« ${match.name} » → ${STATUS_LABELS[i.status]}`);
      }
      return;
    }
  }, [query, clients, leads, openPanel, go, onClose, success, toastError]);

  // ── Items search classique (back-compat) ───────────────────────────────────
  const allItems = useMemo((): CommandItem[] => {
    const pages: CommandItem[] = ROUTE_KEYWORDS.map(r => ({
      id: `nav-${r.path}`,
      icon: '🧭',
      label: r.label,
      description: `Aller vers ${r.path}`,
      action: () => go(r.path),
      category: 'Navigation',
    }));

    const leadItems: CommandItem[] = leads.map(l => ({
      id: `lead-${l.id}`,
      icon: l.type === 'inbound' ? '🏠' : '💰',
      label: l.name,
      description: `${l.client_name || l.client_id} · ${l.email}`,
      action: () => { onClose(); openPanel({ type: 'lead', id: l.id }); },
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
  }, [leads, clients, go, onClose, openPanel]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 15);
    const q = query.toLowerCase();
    return allItems.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [query, allItems]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    filteredItems.forEach(item => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category]!.push(item);
    });
    return groups;
  }, [filteredItems]);

  // Intent items affichés en tête comme "actions détectées"
  const intentItems = useMemo((): CommandItem[] => {
    if (!intent) return [];
    if (intent.type === 'create-lead') {
      return [{
        id: 'intent-create-lead',
        icon: '✨',
        label: `Créer le lead « ${intent.name} »`,
        description: 'Crée le lead et ouvre sa fiche pour compléter',
        action: () => void executeIntent(intent),
        category: 'Action détectée',
      }];
    }
    if (intent.type === 'navigate') {
      const route = ROUTE_KEYWORDS.find(r => r.path === intent.target);
      return [{
        id: 'intent-navigate',
        icon: '🎯',
        label: `Aller vers ${route?.label || intent.target}`,
        description: intent.target,
        action: () => void executeIntent(intent),
        category: 'Action détectée',
      }];
    }
    if (intent.type === 'move-status') {
      return [{
        id: 'intent-move',
        icon: '🔀',
        label: `Déplacer « ${intent.leadQuery} » en ${STATUS_LABELS[intent.status]}`,
        description: 'Met à jour le statut du lead',
        action: () => void executeIntent(intent),
        category: 'Action détectée',
      }];
    }
    return [];
  }, [intent, executeIntent]);

  const combinedItems = useMemo(() => [...intentItems, ...filteredItems], [intentItems, filteredItems]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, combinedItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && combinedItems[selectedIndex]) {
      e.preventDefault();
      combinedItems[selectedIndex].action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [combinedItems, selectedIndex, onClose]);

  if (!isOpen) return null;

  // ── Render ──────────────────────────────────────────────────────────────────
  let flatIndex = 0;

  // Regrouper avec intents en haut
  const groupsForRender: Array<[string, CommandItem[]]> = [];
  if (intentItems.length > 0) groupsForRender.push(['Action détectée', intentItems]);
  for (const [cat, items] of Object.entries(groupedItems)) {
    groupsForRender.push([cat, items]);
  }

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        {/* Input */}
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
            placeholder={query ? '' : PLACEHOLDER_HINTS[hintIndex]}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-subtle)] text-[var(--text-muted)] rounded border border-[var(--border-subtle)]">ESC</kbd>
        </div>

        {/* Résultats */}
        <div className="max-h-[400px] overflow-y-auto py-2">
          {/* Section "Récents" si query vide et qu'il y en a */}
          {!query.trim() && recentIntents.length > 0 && (
            <div>
              <p className="px-4 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Actions récentes</p>
              {recentIntents.map((recent, idx) => (
                <button
                  key={`recent-${idx}`}
                  onClick={() => setQuery(recent)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-left cursor-pointer transition-colors hover:bg-[var(--bg-subtle)]"
                >
                  <span className="text-base w-6 text-center shrink-0 opacity-60">↩</span>
                  <span className="text-sm text-[var(--text-secondary)] truncate flex-1">{recent}</span>
                </button>
              ))}
            </div>
          )}

          {combinedItems.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-[var(--text-muted)]">Aucun résultat pour « {query} »</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">Essayez « nouveau lead [nom] » ou « aller au pipeline »</p>
            </div>
          ) : (
            groupsForRender.map(([category, items]) => (
              <div key={category}>
                <p className={`px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${category === 'Action détectée' ? 'text-[var(--brand-primary)]' : 'text-[var(--text-muted)]'}`}>
                  {category === 'Action détectée' ? '🎯 ' : ''}{category}
                </p>
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
          {intentItems.length > 0 && <span className="ml-auto text-[var(--brand-primary)]">🎯 Action prête</span>}
        </div>
      </div>
    </div>
  );
}
