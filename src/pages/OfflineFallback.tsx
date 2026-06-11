// ── OfflineFallback — Page hors-ligne premium (Sprint 24 vague 5A) ─────────
// S'affiche quand le SW intercepte une route non cachée et que l'appareil
// est offline. Liste les pages disponibles offline depuis offline/sync.

import { WifiOff, RefreshCcw, CheckCircle2 } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/lib/i18n';

// Pages cachées par défaut (cf src/lib/offline/sync.ts — fallback statique
// si l'API du module change).
const OFFLINE_AVAILABLE = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Leads (liste cachée)', path: '/leads' },
  { label: 'Conversations récentes', path: '/conversations' },
  { label: 'Tâches', path: '/tasks' },
];

export function OfflineFallback() {
  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12 text-center bg-[var(--bg-canvas)]"
    >
      {/* Section principale — empty-state-premium-s4 */}
      <div className="empty-state-premium-s4 animate-stagger stagger-1">
        {/* Icône WifiOff dans un ring subtil */}
        <div className="empty-icon-ring">
          <WifiOff
            size={36}
            strokeWidth={1.75}
          />
        </div>

        <p className="t-meta text-[var(--primary)] mb-1">
          Mode hors ligne
        </p>

        <h3>
          Pas de connexion internet
        </h3>

        <p>
          Cette page n'a pas été mise en cache et nécessite une connexion. Vérifiez votre
          réseau WiFi ou cellulaire, puis réessayez.
        </p>

        <button
          onClick={handleRetry}
          className="inline-flex items-center gap-2 h-10 px-5 text-sm font-semibold rounded-[var(--radius-lg)] text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] active:scale-[0.98] transition-all cursor-pointer shadow-[var(--shadow-sm)] mt-2"
        >
          <Icon as={RefreshCcw} size="md" strokeWidth={2} />
          {t('offline.retry')}
        </button>
      </div>

      {/* Liste des pages disponibles offline */}
      <div className="max-w-md w-full mt-8 animate-stagger stagger-2">
        <p className="t-meta text-[var(--text-muted)] mb-3">
          Disponible hors ligne
        </p>
        <ul className="space-y-2 text-left">
          {OFFLINE_AVAILABLE.map((it, i) => (
            <li
              key={it.path}
              className={`flex items-center gap-3 text-sm animate-stagger stagger-${Math.min(i + 3, 8)}`}
            >
              <span
                className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-md)] bg-[var(--success-soft)] text-[var(--success)] shrink-0"
              >
                <CheckCircle2 size={13} strokeWidth={2.5} />
              </span>
              <a
                href={it.path}
                className="leading-relaxed text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors"
              >
                {it.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
