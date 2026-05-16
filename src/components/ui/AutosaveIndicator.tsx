// ── AutosaveIndicator — Pilule autosave premium (Sprint 24 vague 6A) ───────
// Inspiration Notion / Linear : feedback discret mais constant en haut-droite
// d'un formulaire pour rassurer l'utilisateur que ses modifications sont
// enregistrées sans qu'il ait à cliquer sur "Enregistrer".
//
// 5 états :
//   - idle    : rien (no render)
//   - dirty   : dot orange pulse + "Modifications non enregistrées"
//   - saving  : spinner + "Enregistrement..."
//   - saved   : check vert + "Enregistré il y a Xs" (auto-decay vers idle après 5s)
//   - error   : warning rouge + "Échec — Réessayer" (bouton retry)
//
// `lastSaved` time auto-update toutes les 30s via setInterval cleanup.

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, AlertCircle, RefreshCcw } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Icon } from './Icon';
// Sprint 34 vague 34-3B — annonce SR au passage à `saved` / `error`
import { announceSR } from '@/lib/announce';
// Sprint 48 M3.2 — Intl date formatter (locale-aware)
import { formatDate } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';

export type AutosaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface AutosaveIndicatorProps {
  state: AutosaveState;
  /** Date du dernier save effectif — affichée en relatif ("il y a 3s") */
  lastSaved?: Date | null;
  /** Callback retry en cas d'erreur */
  onRetry?: () => void;
  className?: string;
}

function formatRelativeShort(date: Date): string {
  const diff = Math.max(0, Date.now() - date.getTime());
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return "à l'instant";
  if (secs < 60) return `il y a ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  return `le ${formatDate(date, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function AutosaveIndicator({
  state,
  lastSaved,
  onRetry,
  className = '',
}: AutosaveIndicatorProps) {
  // tick force a re-render every 30s for relative time on `saved`
  const [, setTick] = useState(0);

  useEffect(() => {
    if (state !== 'saved' || !lastSaved) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [state, lastSaved]);

  // Sprint 34 vague 34-3B — annonce SR au passage saved/error.
  // On annonce uniquement les transitions vers ces états (pas chaque re-render).
  const lastAnnouncedStateRef = useRef<AutosaveState | null>(null);
  useEffect(() => {
    if (state === lastAnnouncedStateRef.current) return;
    if (state === 'saved') {
      lastAnnouncedStateRef.current = state;
      announceSR('Enregistré', 'polite');
    } else if (state === 'error') {
      lastAnnouncedStateRef.current = state;
      announceSR("Échec de l'enregistrement", 'assertive');
    } else {
      lastAnnouncedStateRef.current = state;
    }
  }, [state]);

  if (state === 'idle') return null;

  if (state === 'dirty') {
    return (
      <span
        className={`autosave-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${className}`}
        style={{
          background:
            'linear-gradient(135deg, rgba(217,110,39,0.10) 0%, rgba(255,154,0,0.06) 100%)',
          border: '1px solid rgba(217,110,39,0.30)',
          color: 'var(--accent-orange, #D96E27)',
        }}
        aria-live="polite"
      >
        <span
          className="autosave-dot autosave-dot--dirty inline-block w-2 h-2 rounded-full"
          style={{
            background: '#D96E27',
            boxShadow: '0 0 8px rgba(217,110,39,0.6)',
          }}
          aria-hidden
        />
        Modifications non enregistrées
      </span>
    );
  }

  if (state === 'saving') {
    return (
      <span
        className={`autosave-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${className}`}
        style={{
          background:
            'linear-gradient(135deg, rgba(0,157,219,0.10) 0%, rgba(11,181,233,0.06) 100%)',
          border: '1px solid rgba(0,157,219,0.30)',
          color: 'var(--primary, #009DDB)',
        }}
        aria-live="polite"
      >
        <Icon as={Loader2} size={11} className="animate-spin" strokeWidth={2.5} />
        Enregistrement...
      </span>
    );
  }

  if (state === 'saved') {
    return (
      <span
        className={`autosave-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${className}`}
        style={{
          background:
            'linear-gradient(135deg, rgba(55,202,55,0.10) 0%, rgba(55,202,55,0.05) 100%)',
          border: '1px solid rgba(55,202,55,0.30)',
          color: '#2ba62b',
        }}
        aria-live="polite"
      >
        <Icon as={Check} size={12} strokeWidth={2.8} />
        {lastSaved ? `Enregistré ${formatRelativeShort(lastSaved)}` : 'Enregistré'}
      </span>
    );
  }

  // error
  return (
    <span
      className={`autosave-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${className}`}
      style={{
        background:
          'linear-gradient(135deg, rgba(233,61,61,0.12) 0%, rgba(233,61,61,0.06) 100%)',
        border: '1px solid rgba(233,61,61,0.35)',
        color: '#C92424',
      }}
      role="alert"
      aria-live="assertive"
    >
      <Icon as={AlertCircle} size={11} strokeWidth={2.5} />
      Échec
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 ml-1 underline hover:no-underline cursor-pointer"
        >
          <Icon as={RefreshCcw} size={10} strokeWidth={2.5} />
          Réessayer
        </button>
      )}
    </span>
  );
}
