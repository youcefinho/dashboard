// ── CommandPalette — Recherche + Intent engine (Sprint 19, visuel Sprint 23 wave 25) ───
// Sprint 19 a étendu ce composant : en plus de la recherche fuzzy, le palette
// détecte des **intents** dans la query et offre des actions directement
// exécutables (créer lead, naviguer, etc.). Inspiration : Linear, Raycast.
// Sprint 23 wave 25 — refonte visuelle dramatique (glassmorphism, gradient brand,
// accent left border sur item selected, footer kbd chips brand-tinted, empty state).

import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { getLeads, getClients, createLead, updateLead, globalSearch } from '@/lib/api';
import type { GlobalSearchResult } from '@/lib/api';
import type { Lead, Client, LeadStatus } from '@/lib/types';
import { LEAD_STATUSES, STATUS_LABELS } from '@/lib/types';
import { AI_SORT_MODES, AI_SORT_LABELS, AI_SORT_DESCRIPTIONS } from '@/lib/aiSort';
import { usePanelStack, useToast } from '@/components/ui';
import { fuzzyScoreMulti } from '@/lib/fuzzy';
// Sprint 49 M3.4 — Recherche naturelle (NL → filtres structurés → URL params)
import { isNaturalLanguageQuery, parseNlQuery, nlFiltersToPath } from '@/lib/nlQuery';
import { t } from '@/lib/i18n';
// Sprint 45 M3.4 — DiscoverAppTour lazy (8 steps guided tour, intent "discover_app")
const DiscoverAppTour = lazy(() =>
  import('@/components/onboarding/DiscoverAppTour').then((m) => ({ default: m.DiscoverAppTour }))
);

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
  // Sprint 45 M3.4 — Intent "discover_app" : tour guidé 8 steps via langage naturel
  | { type: 'discover-app' }
  // Sprint 49 M3.4 — Intent "nl-search" : requête langage naturel → filtres
  | { type: 'nl-search'; query: string }
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

// ── Sprint 30 vague 30-1C — Reports views deep-links via CmdPalette ──
// Tape `reports:funnel`, `reports:sources`, `reports:performance` (etc.) pour
// ouvrir une vue spécifique du module Rapports avec le bon onglet sélectionné.
const REPORTS_VIEWS: Array<{ key: string; view: string; label: string; group: string }> = [
  { key: 'funnel', view: 'funnel', label: 'Funnel de conversion', group: 'BUSINESS' },
  { key: 'sources', view: 'sources', label: 'Sources d\'acquisition', group: 'BUSINESS' },
  { key: 'sales', view: 'sales', label: 'Ventes & ROI', group: 'BUSINESS' },
  { key: 'trends', view: 'trends', label: 'Tendances', group: 'BUSINESS' },
  { key: 'performance', view: 'performance', label: 'Performance sous-comptes', group: 'AGENCE' },
  { key: 'activity', view: 'activity', label: 'Activité agents', group: 'ÉQUIPE' },
  { key: 'calendar', view: 'calendar', label: 'Rendez-vous', group: 'ÉQUIPE' },
  { key: 'workflow', view: 'workflow', label: 'Workflows', group: 'MARKETING' },
  { key: 'email', view: 'email', label: 'Emails', group: 'MARKETING' },
  { key: 'sms', view: 'sms', label: 'SMS', group: 'MARKETING' },
  { key: 'forms', view: 'forms', label: 'Formulaires', group: 'MARKETING' },
  { key: 'reviews', view: 'reviews', label: 'Réputation', group: 'MARKETING' },
];

// ── Sprint 30 vague 30-1B — Filters in-palette ─────────────────────
// Format reconnu : `status:hot`, `source:meta`, `client:acme`, `reports:funnel`.
// Quand l'user tape un préfixe `:` seul (ou `status:`, etc.), on révèle la
// section "Filtres" avec les filtres applicables disponibles + cible route.
type FilterKind = 'status' | 'source' | 'client' | 'reports';

const STATUS_VALUES: Array<{ value: string; label: string }> = [
  { value: 'hot', label: 'Hot (score ≥ 70)' },
  { value: 'new', label: 'Nouveau' },
  { value: 'contacted', label: 'Contacté' },
  { value: 'qualified', label: 'Qualifié' },
  { value: 'won', label: 'Gagné' },
  { value: 'lost', label: 'Perdu' },
];

const SOURCE_VALUES: Array<{ value: string; label: string }> = [
  { value: 'meta', label: 'Meta (Facebook/Instagram)' },
  { value: 'google', label: 'Google Ads' },
  { value: 'website', label: 'Site web' },
  { value: 'referral', label: 'Référence' },
  { value: 'manual', label: 'Manuel' },
  { value: 'direct', label: 'Direct' },
];

interface ParsedFilter {
  kind: FilterKind;
  value: string; // partial ok
  raw: string;
}

function parseFilter(query: string): ParsedFilter | null {
  const q = query.trim().toLowerCase();
  if (!q.includes(':')) return null;
  const m = q.match(/^(status|source|client|reports)\s*:\s*(.*)$/);
  if (!m) {
    // colon seul sans préfixe valide → on déclenche menu de filter kinds
    if (q === ':' || q.endsWith(':')) {
      return { kind: 'status', value: '', raw: q }; // sentinelle "show all kinds"
    }
    return null;
  }
  return { kind: m[1] as FilterKind, value: m[2] || '', raw: q };
}

function parseIntent(query: string): ParsedIntent {
  const q = query.trim();
  if (!q) return null;

  // ── Sprint 45 M3.4 — "discover_app" intent (tour guidé 8 steps) ───────
  // Triggers naturels FR/EN : "découvrir l'app" / "tour guidé" / "tour de l'app"
  // / "comment ça marche" / "discover" / "guided tour" / "app tour"
  if (
    /^(?:d[ée]couvrir|d[ée]couvre|tour\s+(?:guid[ée]|de\s+l['']?app|complet)|comment\s+(?:ça|ca)\s+marche|how\s+(?:does|do)\s+(?:it|this)\s+work|discover|guided\s+tour|app\s+tour|onboarding|aide.+tour)\b/i.test(q)
  ) {
    return { type: 'discover-app' };
  }

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

  // Sprint 49 M3.4 — Recherche naturelle : "trouve mes leads chauds…",
  // "montre les deals bloqués…", "find …", "show me …". Placé en dernier
  // pour ne PAS court-circuiter create-lead / navigate / move-status /
  // discover-app (intents Sprint 19/45 préservés — triggers disjoints).
  if (isNaturalLanguageQuery(q)) {
    return { type: 'nl-search', query: q };
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

// ── Sprint 24 vague 4A — Favoris (item paths bookmarked) ─────────────────────
const FAVORITES_KEY = 'intralys_cmd_favorites';

function loadFavorites(): string[] {
  try {
    const v = localStorage.getItem(FAVORITES_KEY);
    return v ? (JSON.parse(v) as string[]) : [];
  } catch { return []; }
}

function saveFavorites(favs: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  } catch { /* ignore */ }
}

// ── Sprint 24 vague 4A — Saved Searches (smart lists Leads existantes) ───────
interface SmartListLite {
  id: string;
  name: string;
  filters: Record<string, unknown>;
}

function loadSmartLists(): SmartListLite[] {
  try {
    const v = localStorage.getItem('intralys_smart_lists');
    if (!v) return [];
    const arr = JSON.parse(v) as SmartListLite[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function smartListToParams(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  return params.toString();
}

const PLACEHOLDER_HINTS = [
  'Essayez : « nouveau lead Jean Dupont »',
  'Essayez : « aller au pipeline »',
  'Essayez : « déplacer Jean en signed »',
  'Tapez « / » pour les commandes',
  'Filtre : « status:hot » ou « source:meta »',
  'Rapports : « reports:funnel »',
  // Sprint 45 M3.4 — Discover tour hint
  'Essayez : « découvrir l\'app » pour le tour guidé',
  // Sprint 49 M3.4 — Recherche naturelle hint
  'IA : « trouve mes leads chauds pas contactés cette semaine »',
  'IA : « montre les deals bloqués en négociation »',
];

// Icônes thématiques par catégorie (rendu en chip)
const CATEGORY_ICONS: Record<string, string> = {
  'Action détectée': '🎯',
  'Favoris': '⭐',
  'Recents': '⚡',
  'Saved Searches': '🔖',
  'Filtres': '⏷',
  'Navigation': '🧭',
  'Leads': '👥',
  'Clients': '🏢',
  'Tâches': '✅',
  'Conversations': '💬',
  'Rapports': '📊',
  'AI Sort': '✨',
  'Suggestions': '⚡',
};

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hintIndex, setHintIndex] = useState(0);
  const [recentIntents, setRecentIntents] = useState<string[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  // Sprint 24 vague 4A — favoris + saved searches + bounce trigger
  const [favorites, setFavorites] = useState<string[]>([]);
  const [smartLists, setSmartLists] = useState<SmartListLite[]>([]);
  const [bouncePinId, setBouncePinId] = useState<string | null>(null);
  // Sprint 45 M3.4 — DiscoverAppTour (intent "discover_app")
  const [discoverTourOpen, setDiscoverTourOpen] = useState(false);
  // Sprint 49 M3.4 — Recherche naturelle : état "parsing en cours"
  const [nlParsing, setNlParsing] = useState(false);
  // LOT B / S-B2 — Recherche globale serveur (GET /api/search).
  // serverResults : null = pas encore interrogé / query courte → fallback local.
  //                 [] = serveur a répondu sans résultat.
  const [serverResults, setServerResults] = useState<GlobalSearchResult[] | null>(null);
  const [serverSearching, setServerSearching] = useState(false);
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
      setFavorites(loadFavorites());
      setSmartLists(loadSmartLists());
      setTimeout(() => inputRef.current?.focus(), 50);
      getLeads().then(res => { if (res.data) setLeads(res.data); }).catch(() => { /* ignoré */ });
      getClients().then(res => { if (res.data) setClients(res.data); }).catch(() => { /* ignoré */ });
      // LOT B — reset état serveur à chaque ouverture
      setServerResults(null);
      setServerSearching(false);
    }
  }, [isOpen]);

  // LOT B / S-B2 — Recherche globale serveur, debounced ≥ 250 ms.
  // Déclenchée seulement si q.trim().length >= 2. Si l'appel échoue (réseau /
  // dev sans worker / erreur) → serverResults reste null → le fallback local
  // fuzzy actuel (allItems sur leads/clients déjà chargés) prend le relais.
  // Aucune régression UX offline/dev : l'existant est INTACT, on superpose.
  useEffect(() => {
    if (!isOpen) return;
    const q = query.trim();
    // Query trop courte OU mode intent/filtre → pas de recherche serveur,
    // on retombe sur le comportement local existant.
    if (q.length < 2 || parseIntent(query) || parseFilter(query)) {
      setServerResults(null);
      setServerSearching(false);
      return;
    }
    let cancelled = false;
    setServerSearching(true);
    const handle = window.setTimeout(() => {
      globalSearch(q, { limit: 8 })
        .then((res) => {
          if (cancelled) return;
          if (res.data && Array.isArray(res.data.results)) {
            setServerResults(res.data.results);
          } else {
            // Erreur serveur → fallback local (null = pas de section serveur)
            setServerResults(null);
          }
        })
        .catch(() => {
          if (!cancelled) setServerResults(null);
        })
        .finally(() => {
          if (!cancelled) setServerSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, isOpen]);

  // Sprint 24 vague 4A — toggle favori sur un id (path d'item)
  const toggleFavorite = useCallback((itemId: string) => {
    setFavorites(prev => {
      const has = prev.includes(itemId);
      const next = has ? prev.filter(x => x !== itemId) : [...prev, itemId];
      saveFavorites(next);
      return next;
    });
    setBouncePinId(itemId);
    setTimeout(() => setBouncePinId(null), 360);
  }, []);

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
        toastError(t('cmd.no_client'));
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
        success(t('cmd.create_lead_label').replace('{name}', i.name));
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
        toastError(`${t('cmd.no_result')} « ${i.leadQuery} ».`);
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
    // Sprint 45 M3.4 — Discover app : ferme la palette et lance le tour 8 steps
    if (i.type === 'discover-app') {
      onClose();
      // Petit delay pour laisser la palette disparaître proprement
      window.setTimeout(() => setDiscoverTourOpen(true), 100);
      return;
    }
    // Sprint 49 M3.4 — Recherche naturelle : parse NL → filtres → URL params.
    // parseNlQuery garantit toujours un résultat (fallback regex local
    // offline-safe). On navigue ensuite vers la page cible filtrée.
    if (i.type === 'nl-search') {
      setNlParsing(true);
      try {
        const res = await parseNlQuery(i.query, 'fr-CA');
        const path = nlFiltersToPath(res.filters);
        setNlParsing(false);
        onClose();
        if (res.fromFallback && Object.keys(res.filters).filter(k => k !== 'target').length === 0) {
          toastError(t('cmd.nl_error'));
        } else {
          success(res.explanation);
        }
        void navigate({ to: path });
      } catch {
        setNlParsing(false);
        toastError(t('cmd.nl_parse_error'));
      }
      return;
    }
  }, [query, clients, leads, openPanel, go, onClose, success, toastError, navigate]);

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

    // Sprint 30 vague 30-1C — Reports views deep-links comme items navigation
    const reportsItems: CommandItem[] = REPORTS_VIEWS.map(r => ({
      id: `reports-${r.view}`,
      icon: '📊',
      label: `Rapports · ${r.label}`,
      description: `Ouvrir /reports?view=${r.view} (${r.group.toLowerCase()})`,
      action: () => go(`/reports?view=${r.view}`),
      category: 'Rapports',
    }));

    // Sprint 31 vague 31-2B — AI Smart Sort deep-links pour Leads
    const aiSortItems: CommandItem[] = AI_SORT_MODES.map(mode => ({
      id: `ai-sort-${mode}`,
      icon: '✨',
      label: `AI Sort: ${AI_SORT_LABELS[mode]}`,
      description: AI_SORT_DESCRIPTIONS[mode],
      action: () => go(`/leads?aisort=${mode}`),
      category: 'AI Sort',
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

    return [...pages, ...reportsItems, ...aiSortItems, ...leadItems, ...clientItems];
  }, [leads, clients, go, onClose, openPanel]);

  // ── Sprint 30 vague 30-1B — Filter parse + items ─────────────────────
  const filter = useMemo(() => parseFilter(query), [query]);

  const filterItems = useMemo((): CommandItem[] => {
    if (!filter) return [];

    // Sentinelle "tape `:`" → liste des kinds disponibles
    if (filter.raw === ':' || filter.raw === '') {
      return (['status', 'source', 'client', 'reports'] as const).map((k) => ({
        id: `filter-kind-${k}`,
        icon: '⏷',
        label: `${k}:`,
        description: `Filtrer par ${k}`,
        action: () => { setQuery(`${k}:`); inputRef.current?.focus(); },
        category: 'Filtres',
      }));
    }

    const v = filter.value.toLowerCase();

    if (filter.kind === 'status') {
      const matches = v
        ? STATUS_VALUES.filter(s => s.value.startsWith(v) || s.label.toLowerCase().includes(v))
        : STATUS_VALUES;
      return matches.map(s => ({
        id: `filter-status-${s.value}`,
        icon: '🏷',
        label: `status:${s.value}`,
        description: `Filtrer Leads → ${s.label}`,
        action: () => {
          const params = new URLSearchParams();
          if (s.value === 'hot') {
            params.set('scoreMin', '70');
          } else {
            params.set('status', s.value);
          }
          go(`/leads?${params.toString()}`);
        },
        category: 'Filtres',
      }));
    }

    if (filter.kind === 'source') {
      const matches = v
        ? SOURCE_VALUES.filter(s => s.value.startsWith(v) || s.label.toLowerCase().includes(v))
        : SOURCE_VALUES;
      return matches.map(s => ({
        id: `filter-source-${s.value}`,
        icon: '📥',
        label: `source:${s.value}`,
        description: `Filtrer Leads → source ${s.label}`,
        action: () => {
          const params = new URLSearchParams();
          params.set('source', s.value);
          go(`/leads?${params.toString()}`);
        },
        category: 'Filtres',
      }));
    }

    if (filter.kind === 'client') {
      const matches = v
        ? clients.filter(c => c.name.toLowerCase().includes(v))
        : clients;
      return matches.slice(0, 6).map(c => ({
        id: `filter-client-${c.id}`,
        icon: '🏢',
        label: `client:${c.name.toLowerCase()}`,
        description: `Filtrer Leads → sous-compte ${c.name}`,
        action: () => go(`/leads?client=${c.id}`),
        category: 'Filtres',
      }));
    }

    if (filter.kind === 'reports') {
      const matches = v
        ? REPORTS_VIEWS.filter(r => r.view.startsWith(v) || r.label.toLowerCase().includes(v))
        : REPORTS_VIEWS;
      return matches.map(r => ({
        id: `filter-reports-${r.view}`,
        icon: '📊',
        label: `reports:${r.view}`,
        description: `Ouvrir Rapports → ${r.label}`,
        action: () => go(`/reports?view=${r.view}`),
        category: 'Filtres',
      }));
    }

    return [];
  }, [filter, clients, go]);

  const filteredItems = useMemo(() => {
    // Quand le user est en mode filtre, on n'affiche pas les items génériques
    if (filter) return [];

    if (!query.trim()) {
      // Sprint 24 vague 4A — exclure les items déjà épinglés (évite doublon avec Favoris)
      return allItems.filter(item => !favorites.includes(item.id)).slice(0, 15);
    }

    // Sprint 30 vague 30-1B — fuzzy ranking (Levenshtein-lite + word boundaries)
    const scored = allItems
      .map((item) => {
        const score = fuzzyScoreMulti(query, [
          { value: item.label, weight: 1.0 },
          { value: item.description, weight: 0.55 },
          { value: item.category, weight: 0.35 },
        ]);
        return { item, score };
      })
      .filter((x) => x.score >= 0.30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.item);

    return scored;
  }, [query, allItems, favorites, filter]);

  // LOT B / S-B2 — Items issus de la recherche serveur (/api/search).
  // Groupés par type via les clés i18n FIGÉES par Manager A (§6.5).
  // Navigation iso-fonctionnelle : go(result.url) — url vient du serveur.
  const SERVER_SECTION_LABEL: Record<string, string> = useMemo(() => ({
    lead: t('search.section_leads'),
    client: t('search.section_clients'),
    task: t('search.section_tasks'),
    conversation: t('search.section_conversations'),
  }), []);

  const SERVER_SECTION_ICON: Record<string, string> = {
    lead: '👥',
    client: '🏢',
    task: '✅',
    conversation: '💬',
  };

  const serverItems = useMemo((): CommandItem[] => {
    if (!serverResults || serverResults.length === 0) return [];
    return serverResults.map((r) => ({
      id: `srv-${r.type}-${r.id}`,
      icon: SERVER_SECTION_ICON[r.type] || '🔍',
      label: r.title,
      description: r.subtitle,
      action: () => go(r.url),
      category: SERVER_SECTION_LABEL[r.type] || r.type,
    }));
  }, [serverResults, SERVER_SECTION_LABEL, go]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    // LOT B — quand le serveur a répondu (serverResults non-null), on privilégie
    // ses résultats pour la portion "recherche d'entités". Le fallback local
    // (filteredItems) reste actif si serverResults est null (offline/dev/erreur).
    const baseList = serverResults !== null ? serverItems : filteredItems;
    baseList.forEach(item => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category]!.push(item);
    });
    return groups;
  }, [filteredItems, serverItems, serverResults]);

  // Intent items affichés en tête comme "actions détectées"
  const intentItems = useMemo((): CommandItem[] => {
    if (!intent) return [];
    if (intent.type === 'create-lead') {
      return [{
        id: 'intent-create-lead',
        icon: '✨',
      label: `${t('cmd.create_lead_label').replace('{name}', intent.name)}`,
        description: t('cmd.create_lead_desc'),
        action: () => void executeIntent(intent),
        category: t('cmd.category_detected'),
      }];
    }
    if (intent.type === 'navigate') {
      const route = ROUTE_KEYWORDS.find(r => r.path === intent.target);
      return [{
        id: 'intent-navigate',
        icon: '🎯',
        label: `${t('cmd.go_to')} ${route?.label || intent.target}`,
        description: intent.target,
        action: () => void executeIntent(intent),
        category: t('cmd.category_detected'),
      }];
    }
    if (intent.type === 'move-status') {
      return [{
        id: 'intent-move',
        icon: '🔀',
        label: t('cmd.move_label').replace('{lead}', intent.leadQuery).replace('{status}', STATUS_LABELS[intent.status]),
        description: t('cmd.move_desc'),
        action: () => void executeIntent(intent),
        category: t('cmd.category_detected'),
      }];
    }
    // Sprint 45 M3.4 — Discover app intent → tour guidé 8 steps
    if (intent.type === 'discover-app') {
      return [{
        id: 'intent-discover-app',
        icon: '🧭',
        label: t('cmd.discover_label'),
        description: t('cmd.discover_desc'),
        action: () => void executeIntent(intent),
        category: t('cmd.category_detected'),
      }];
    }
    // Sprint 49 M3.4 — Recherche naturelle → filtres structurés
    if (intent.type === 'nl-search') {
      return [{
        id: 'intent-nl-search',
        icon: nlParsing ? '⏳' : '🔮',
        label: nlParsing
          ? t('cmd.nl_parsing')
          : `${t('cmd.nl_label')} : « ${intent.query} »`,
        description: nlParsing
          ? t('cmd.nl_parsing_desc')
          : t('cmd.nl_desc'),
        action: () => { if (!nlParsing) void executeIntent(intent); },
        category: t('cmd.category_detected'),
      }];
    }
    return [];
  }, [intent, executeIntent, nlParsing]);

  // Sprint 24 vague 4A — items "Favoris" : extraits depuis allItems filtrés par favorites[]
  // Affichés seulement si query vide (Linear/Raycast pattern)
  const favoriteItems = useMemo((): CommandItem[] => {
    if (query.trim()) return [];
    if (favorites.length === 0) return [];
    return allItems
      .filter(item => favorites.includes(item.id))
      .map(item => ({ ...item, category: t('cmd.category_favorites') }));
  }, [favorites, allItems, query]);

  // Sprint 24 vague 4A — items "Saved Searches" : smart lists Leads existantes
  const savedSearchItems = useMemo((): CommandItem[] => {
    if (query.trim()) return [];
    return smartLists.map(sl => ({
      id: `saved-${sl.id}`,
      icon: '🔖',
      label: sl.name,
      description: `${t('cmd.saved_view')} · ${Object.keys(sl.filters).length} filtre(s)`,
      action: () => {
        const params = smartListToParams(sl.filters);
        go(params ? `/leads?${params}` : '/leads');
      },
      category: t('cmd.category_saved'),
    }));
  }, [smartLists, go, query]);

  // LOT B — la portion "recherche d'entités" = résultats serveur si répondu,
  // sinon fallback local (filteredItems). Cohérent avec groupedItems pour que
  // la navigation clavier matche exactement le rendu.
  const entitySearchItems = useMemo(
    () => (serverResults !== null ? serverItems : filteredItems),
    [serverResults, serverItems, filteredItems]
  );

  const combinedItems = useMemo(
    () => [...intentItems, ...filterItems, ...favoriteItems, ...entitySearchItems, ...savedSearchItems],
    [intentItems, filterItems, favoriteItems, entitySearchItems, savedSearchItems]
  );

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
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
      // Sprint 24 vague 4A — cmd/ctrl+D pour bookmark item sélectionné
      const cur = combinedItems[selectedIndex];
      if (cur && cur.category !== t('cmd.category_favorites') && cur.category !== t('cmd.category_detected') && cur.category !== t('cmd.category_saved') && cur.category !== t('cmd.category_filters')) {
        e.preventDefault();
        toggleFavorite(cur.id);
      } else if (cur && cur.category === t('cmd.category_favorites')) {
        // Unpin depuis section Favoris
        e.preventDefault();
        // Retrouver l'id originel (favoriteItems garde le même id que allItems)
        toggleFavorite(cur.id);
      }
    }
  }, [combinedItems, selectedIndex, onClose, toggleFavorite]);

  // Sprint 45 M3.4 — Le DiscoverAppTour peut être actif même quand la palette
  // est fermée (lancée via intent, ferme la palette, puis se déploie sur l'app).
  // Pattern : on bail-out la palette si !isOpen, mais on garde le tour mounté.
  if (!isOpen) {
    return discoverTourOpen ? (
      <Suspense fallback={null}>
        <DiscoverAppTour open={discoverTourOpen} onClose={() => setDiscoverTourOpen(false)} />
      </Suspense>
    ) : null;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  let flatIndex = 0;

  const hasQuery = query.trim().length > 0;
  const showRecents = !hasQuery && recentIntents.length > 0;

  // Sprint 24 vague 4A — ordre final :
  //   Action détectée → Filtres → Favoris → (Recents render séparé) → Navigation/Leads/Clients/Rapports → Saved Searches
  const groupsForRender: Array<[string, CommandItem[]]> = [];
  if (intentItems.length > 0) groupsForRender.push([t('cmd.category_detected'), intentItems]);
  if (filterItems.length > 0) groupsForRender.push([t('cmd.category_filters'), filterItems]);
  if (favoriteItems.length > 0) groupsForRender.push([t('cmd.category_favorites'), favoriteItems]);
  for (const [cat, items] of Object.entries(groupedItems)) {
    groupsForRender.push([cat, items]);
  }
  if (savedSearchItems.length > 0) groupsForRender.push([t('cmd.category_saved'), savedSearchItems]);

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div
        className="cmd-palette"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
        aria-describedby="cmd-palette-desc"
      >
        {/* Sprint 48 M1.3 — description SR (sr-only) pour orientation */}
        <span id="cmd-palette-desc" className="sr-only-aaa">
          {t('cmd.sr_desc')}
        </span>
        {/* Search input */}
        <div className={`cmd-search ${isFocused ? 'is-focused' : ''}`}>
          <span className="cmd-search-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={hasQuery ? '' : PLACEHOLDER_HINTS[hintIndex]}
            className="cmd-search-input"
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
            aria-controls="cmd-palette-listbox"
            aria-activedescendant={`cmd-item-${selectedIndex}`}
            aria-label={t('cmd.search_label')}
          />
          {hasQuery && (
            <button
              type="button"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className="chip-btn chip-btn--sm"
              aria-label={t('cmd.clear')}
              title="Effacer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
          <kbd className="cmd-kbd cmd-kbd--ghost">ESC</kbd>
        </div>

        {/* Résultats */}
        <div
          className="cmd-results max-h-[420px] overflow-y-auto py-1"
          id="cmd-palette-listbox"
          role="listbox"
          aria-label={t('cmd.results_label')}
        >
          {/* Section "Récents" si query vide et qu'il y en a */}
          {showRecents && (
            <div>
              <div className="cmd-section-header">
                <span aria-hidden="true">⚡</span>
                <span className="cmd-section-header-label">{t('cmd.recents')}</span>
                <span className="cmd-section-header-line" />
              </div>
              {recentIntents.map((recent, idx) => (
                <button
                  key={`recent-${idx}`}
                  type="button"
                  onClick={() => { setQuery(recent); inputRef.current?.focus(); }}
                  className="cmd-item"
                >
                  <span className="cmd-recent-icon" aria-hidden="true">↩</span>
                  <div className="cmd-item-body">
                    <div className="cmd-item-label">{recent}</div>
                    <div className="cmd-item-desc">{t('cmd.replay')}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* LOT B — état "recherche serveur en cours" (i18n figé §6.5) */}
          {serverSearching && combinedItems.length === 0 && hasQuery ? (
            <div className="cmd-empty">
              <span className="cmd-empty-icon" aria-hidden="true">⏳</span>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {t('search.searching')}
              </div>
            </div>
          ) : combinedItems.length === 0 && hasQuery ? (
            <div className="cmd-empty">
              <span className="cmd-empty-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {t('search.no_results')} « {query} »
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                Essaie « <span className="text-[var(--primary)] font-medium">leads</span> », « <span className="text-[var(--primary)] font-medium">paramètres</span> » ou « <span className="text-[var(--primary)] font-medium">nouveau lead [nom]</span> »
              </div>
            </div>
          ) : (
            groupsForRender.map(([category, items]) => (
              <div key={category}>
                <div className="cmd-section-header">
                  <span aria-hidden="true">{CATEGORY_ICONS[category] || '🔍'}</span>
                  <span className="cmd-section-header-label">{category}</span>
                  <span className="cmd-section-header-line" />
                </div>
                {items.map((item) => {
                  const itemIndex = flatIndex++;
                  const isSelected = itemIndex === selectedIndex;
                  // Sprint 24 vague 4A — étoile pin/unpin (sauf catégories spéciales)
                  const canPin = category !== 'Action détectée' && category !== 'Saved Searches' && category !== 'Filtres';
                  const isPinned = favorites.includes(item.id);
                  const showStar = canPin && (isSelected || isPinned);
                  const isBouncing = bouncePinId === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`cmd-item-${itemIndex}`}
                      type="button"
                      onClick={item.action}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                      className={`cmd-item ${isSelected ? 'is-selected' : ''} ${category === 'Filtres' ? 'cmd-item--filter' : ''}`}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <span className="cmd-item-icon" aria-hidden="true">{item.icon}</span>
                      <div className="cmd-item-body">
                        <div className="cmd-item-label">{item.label}</div>
                        <div className="cmd-item-desc">{item.description}</div>
                      </div>
                      {showStar && (
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={isPinned ? t('cmd.remove_fav') : t('cmd.add_fav')}
                          title={isPinned ? `${t('cmd.remove_fav')} (⌘D)` : `${t('cmd.add_fav')} (⌘D)`}
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
                          className={`cmd-fav-icon ${isPinned ? 'is-pinned' : ''} ${isBouncing ? 'is-bouncing' : ''}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </span>
                      )}
                      {isSelected && (
                        <kbd className="cmd-kbd cmd-item-shortcut">↵</kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="cmd-footer">
          <span className="cmd-footer-hint">
            <kbd className="cmd-kbd">↑↓</kbd>
            <span>{t('cmd.footer_nav')}</span>
          </span>
          <span className="cmd-footer-hint">
            <kbd className="cmd-kbd">↵</kbd>
            <span>{t('cmd.footer_open')}</span>
          </span>
          <span className="cmd-footer-hint">
            <kbd className="cmd-kbd">Esc</kbd>
            <span>{t('cmd.footer_close')}</span>
          </span>
          <span className="cmd-footer-hint">
            <kbd className="cmd-kbd">⌘K</kbd>
            <span>{t('cmd.footer_toggle')}</span>
          </span>
          <span className="cmd-footer-hint">
            <kbd className="cmd-kbd">⌘D</kbd>
            <span>{t('cmd.footer_fav')}</span>
          </span>
          {intentItems.length > 0 && (
            <span className="cmd-footer-status">
              <span aria-hidden="true">🎯</span>
              {t('cmd.action_ready')}
            </span>
          )}
        </div>
      </div>
      {/* Sprint 45 M3.4 — DiscoverAppTour overlay (8 steps guided tour). Mounté
          dans la même tree pour permettre setDiscoverTourOpen via intent. */}
      {discoverTourOpen && (
        <Suspense fallback={null}>
          <DiscoverAppTour open={discoverTourOpen} onClose={() => setDiscoverTourOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
