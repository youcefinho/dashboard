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
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6 py-12 text-center"
      style={{
        background:
          'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
      }}
    >
      {/* Orb #1 — cyan top-left */}
      <div
        aria-hidden
        className="hero-stat-orb absolute -top-32 left-1/4 w-[420px] h-[420px] rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, rgba(0,157,219,0.28) 0%, rgba(0,157,219,0.08) 50%, transparent 80%)',
          filter: 'blur(70px)',
        }}
      />
      {/* Orb #2 — orange bottom-right */}
      <div
        aria-hidden
        className="hero-stat-orb absolute -bottom-32 right-1/4 w-[380px] h-[380px] rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, rgba(217,110,39,0.22) 0%, rgba(217,110,39,0.06) 50%, transparent 80%)',
          filter: 'blur(70px)',
          animationDelay: '4s',
        }}
      />

      {/* WifiOff XL avec halo pulse */}
      <div className="relative mb-7">
        <div
          aria-hidden
          className="absolute inset-0 rounded-3xl pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(0,157,219,0.40) 0%, rgba(217,110,39,0.22) 50%, transparent 80%)',
            filter: 'blur(28px)',
            transform: 'scale(1.8)',
            animation: 'hot-lead-pulse 3.5s ease-in-out infinite',
          }}
        />
        <div
          className="relative w-[104px] h-[104px] rounded-3xl flex items-center justify-center"
          style={{
            background:
              'linear-gradient(135deg, #009DDB 0%, #0BB5E9 50%, #D96E27 100%)',
            boxShadow:
              '0 8px 32px -6px rgba(0,157,219,0.55), 0 0 40px -8px rgba(217,110,39,0.40), inset 0 1px 0 rgba(255,255,255,0.25)',
          }}
        >
          <WifiOff
            size={52}
            className="text-white"
            strokeWidth={2.2}
            style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))' }}
          />
        </div>
      </div>

      <p
        className="relative text-[10px] font-bold uppercase tracking-[0.18em] mb-2"
        style={{
          background: 'linear-gradient(90deg, #009DDB 0%, #D96E27 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        Mode hors ligne
      </p>

      <h1 className="relative text-3xl font-bold tracking-tight text-[var(--text-primary)] mb-3 max-w-2xl">
        <span className="text-gradient-brand">Pas de connexion</span> internet
      </h1>

      <p className="relative text-sm text-[var(--text-secondary)] max-w-md mb-8 leading-relaxed">
        Cette page n'a pas été mise en cache et nécessite une connexion. Vérifiez votre
        réseau WiFi ou cellulaire, puis réessayez. Vos modifications faites hors ligne
        seront synchronisées automatiquement.
      </p>

      <button
        onClick={handleRetry}
        className="relative inline-flex items-center gap-2 h-11 px-6 text-sm font-semibold rounded-[10px] text-white active:scale-[0.98] transition-all cursor-pointer mb-8"
        style={{
          background:
            'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
          boxShadow:
            '0 4px 16px -2px rgba(0,157,219,0.45), 0 0 22px -4px rgba(217,110,39,0.35), inset 0 1px 0 rgba(255,255,255,0.20)',
          border: '1px solid rgba(0,157,219,0.55)',
        }}
      >
        <Icon as={RefreshCcw} size="md" strokeWidth={2.4} />
        {t('offline.retry')}
      </button>

      <div className="relative max-w-md w-full">
        <p
          className="text-[9px] font-bold uppercase tracking-[0.18em] mb-3"
          style={{
            background: 'linear-gradient(90deg, #009DDB 0%, #D96E27 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Disponible hors ligne
        </p>
        <ul className="space-y-2 text-left">
          {OFFLINE_AVAILABLE.map((it, i) => (
            <li
              key={it.path}
              className="flex items-center gap-3 text-sm animate-fade-in"
              style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'both' }}
            >
              <span
                className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-white shrink-0"
                style={{
                  background:
                    'linear-gradient(135deg, #37CA37 0%, #2ba62b 100%)',
                  boxShadow:
                    '0 2px 8px -2px rgba(55,202,55,0.40), inset 0 1px 0 rgba(255,255,255,0.20)',
                }}
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
