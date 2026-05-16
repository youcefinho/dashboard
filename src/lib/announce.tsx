// ── announce — Screen reader announcement singleton store (Sprint 34 vague 34-3B) ─
// Helper `announceSR(message, politeness?)` qui push dans un store singleton.
// Component subscriber `<LiveRegionPortal />` à mount dans AppLayout root
// rendra deux régions aria-live (polite + assertive) qui consomment le store.
//
// Queue management :
//   - messages 'polite' identiques consécutifs <500ms sont dédupliqués (anti-spam)
//   - 'assertive' bypass dedup (errors critiques toujours annoncées)
//   - chaque message reste 5s dans la live region puis clear (re-announce future)
//
// Usage :
//   import { announceSR } from '@/lib/announce';
//   announceSR("Enregistré");                       // polite (default)
//   announceSR("Connexion perdue", 'assertive');    // alert
//
//   <LiveRegionPortal /> est rendu une seule fois dans AppLayout.

import { useEffect, useState, type CSSProperties } from 'react';

export type Politeness = 'polite' | 'assertive';

interface AnnounceEntry {
  id: number;
  message: string;
  politeness: Politeness;
  at: number;
}

type Listener = (entry: AnnounceEntry) => void;

const listeners = new Set<Listener>();
let lastPolite: { message: string; at: number } | null = null;
let lastAssertive: { message: string; at: number } | null = null;
let nextId = 1;

const DEDUP_WINDOW_MS = 500;

/**
 * Pousse un message dans la file d'annonces SR.
 *
 * @param message  Texte à annoncer (vide ignoré)
 * @param politeness 'polite' (default — attend pause) ou 'assertive' (interrompt)
 */
export function announceSR(message: string, politeness: Politeness = 'polite'): void {
  if (!message || !message.trim()) return;
  const now = Date.now();

  // Dedup window : si même message <500ms sur la même région, skip
  const trimmed = message.trim();
  if (politeness === 'polite') {
    if (lastPolite && lastPolite.message === trimmed && now - lastPolite.at < DEDUP_WINDOW_MS) {
      return;
    }
    lastPolite = { message: trimmed, at: now };
  } else {
    if (lastAssertive && lastAssertive.message === trimmed && now - lastAssertive.at < DEDUP_WINDOW_MS) {
      return;
    }
    lastAssertive = { message: trimmed, at: now };
  }

  const entry: AnnounceEntry = {
    id: nextId++,
    message: trimmed,
    politeness,
    at: now,
  };
  listeners.forEach((l) => {
    try { l(entry); } catch { /* listener swallow */ }
  });
}

/**
 * Hook interne pour le LiveRegionPortal. Souscrit aux annonces et expose
 * les messages courants polite + assertive (avec auto-clear 5s).
 */
function useAnnounceSubscription() {
  const [polite, setPolite] = useState<string>('');
  const [assertive, setAssertive] = useState<string>('');

  useEffect(() => {
    const onEntry: Listener = (entry) => {
      // Le truc clé : pour qu'un même message re-déclenche une annonce SR,
      // il faut qu'il change. On vide d'abord (microtask) puis remet la
      // valeur (next tick) — ainsi React commit deux fois et le SR observe
      // une mutation textContent.
      if (entry.politeness === 'assertive') {
        setAssertive('');
        // queueMicrotask évite que React batch les deux setStates en un seul commit
        queueMicrotask(() => setAssertive(entry.message));
        window.setTimeout(() => {
          setAssertive((prev) => (prev === entry.message ? '' : prev));
        }, 5000);
      } else {
        setPolite('');
        queueMicrotask(() => setPolite(entry.message));
        window.setTimeout(() => {
          setPolite((prev) => (prev === entry.message ? '' : prev));
        }, 5000);
      }
    };
    listeners.add(onEntry);
    return () => { listeners.delete(onEntry); };
  }, []);

  return { polite, assertive };
}

const SR_ONLY_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * Composant à mounter UNE SEULE FOIS dans AppLayout root. Rend deux régions
 * aria-live invisibles (polite + assertive) qui consomment le store global.
 */
export function LiveRegionPortal() {
  const { polite, assertive } = useAnnounceSubscription();
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={SR_ONLY_STYLE}
        data-live-region="polite"
      >
        {polite}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        style={SR_ONLY_STYLE}
        data-live-region="assertive"
      >
        {assertive}
      </div>
    </>
  );
}

/**
 * Reset interne (utile pour tests unitaires)
 */
export function __resetAnnounceForTests() {
  listeners.clear();
  lastPolite = null;
  lastAssertive = null;
  nextId = 1;
}
