// ── PanelStack — Gestionnaire de slide-over panels stackables ────────────────
// Permet d'empiler jusqu'à 3 panels avec gestion URL state + back/forward browser.
//
// Setup (App root) :
//   <PanelStackProvider renderers={{ lead: LeadPanel, task: TaskPanel, ... }}>
//     <App />
//   </PanelStackProvider>
//
// Usage dans un composant :
//   const { openPanel } = usePanelStack();
//   onClick={() => openPanel({ type: 'lead', id: 'lead-001' })}
//
// URL sync :
//   /leads?panel=lead:lead-001  → ouvre panel lead-001
//   /leads?panel=lead:lead-001,task:task-042  → stack de 2 panels

import { createContext, useContext, useState, useEffect, useCallback, type ComponentType, type ReactNode } from 'react';

export interface PanelDescriptor {
  type: string;
  id: string;
}

interface PanelStackContextValue {
  panels: PanelDescriptor[];
  openPanel: (panel: PanelDescriptor) => void;
  closeTopPanel: () => void;
  closeAllPanels: () => void;
  replaceTopPanel: (panel: PanelDescriptor) => void;
}

const PanelStackContext = createContext<PanelStackContextValue | undefined>(undefined);

export function usePanelStack(): PanelStackContextValue {
  const ctx = useContext(PanelStackContext);
  if (!ctx) throw new Error('usePanelStack must be used inside <PanelStackProvider>');
  return ctx;
}

const MAX_STACK = 3;
const URL_PARAM = 'panel';

function serializePanels(panels: PanelDescriptor[]): string {
  return panels.map(p => `${p.type}:${p.id}`).join(',');
}

function parsePanels(value: string | null): PanelDescriptor[] {
  if (!value) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const [type, ...rest] = s.split(':');
      if (!type || rest.length === 0) return null;
      return { type, id: rest.join(':') };
    })
    .filter((p): p is PanelDescriptor => p !== null)
    .slice(0, MAX_STACK);
}

function syncUrl(panels: PanelDescriptor[]) {
  const url = new URL(window.location.href);
  if (panels.length === 0) {
    url.searchParams.delete(URL_PARAM);
  } else {
    url.searchParams.set(URL_PARAM, serializePanels(panels));
  }
  window.history.pushState(window.history.state, '', url.toString());
}

function readUrl(): PanelDescriptor[] {
  if (typeof window === 'undefined') return [];
  const params = new URLSearchParams(window.location.search);
  return parsePanels(params.get(URL_PARAM));
}

interface PanelStackProviderProps {
  /** Map de type → composant rendu pour ce type. Le composant reçoit `id` et `stackLevel`. */
  renderers: Record<string, ComponentType<{ id: string; stackLevel: number }>>;
  children: ReactNode;
}

export function PanelStackProvider({ renderers, children }: PanelStackProviderProps) {
  const [panels, setPanels] = useState<PanelDescriptor[]>(() => readUrl());

  // Sync URL ↔ state via popstate (back/forward browser)
  useEffect(() => {
    const handlePop = () => {
      setPanels(readUrl());
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const openPanel = useCallback((panel: PanelDescriptor) => {
    setPanels(prev => {
      // Évite les doublons consécutifs (re-cliquer le même lead)
      if (prev.length > 0 && prev[prev.length - 1]!.type === panel.type && prev[prev.length - 1]!.id === panel.id) {
        return prev;
      }
      const next = [...prev, panel].slice(-MAX_STACK);
      syncUrl(next);
      return next;
    });
  }, []);

  const closeTopPanel = useCallback(() => {
    setPanels(prev => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      syncUrl(next);
      return next;
    });
  }, []);

  const closeAllPanels = useCallback(() => {
    setPanels(prev => {
      if (prev.length === 0) return prev;
      syncUrl([]);
      return [];
    });
  }, []);

  const replaceTopPanel = useCallback((panel: PanelDescriptor) => {
    setPanels(prev => {
      const next = prev.length === 0 ? [panel] : [...prev.slice(0, -1), panel];
      syncUrl(next);
      return next;
    });
  }, []);

  return (
    <PanelStackContext.Provider value={{ panels, openPanel, closeTopPanel, closeAllPanels, replaceTopPanel }}>
      {children}
      {/* Rendu des panels : du bas vers le top, le dernier (top) ferme avec ESC */}
      {panels.map((panel, idx) => {
        const Renderer = renderers[panel.type];
        if (!Renderer) {
          // Type inconnu — log silencieux, ne pas crasher
          return null;
        }
        const stackLevel = panels.length - 1 - idx;
        return (
          <Renderer
            key={`${panel.type}:${panel.id}:${idx}`}
            id={panel.id}
            stackLevel={stackLevel}
          />
        );
      })}
    </PanelStackContext.Provider>
  );
}
