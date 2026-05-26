// ══════════════════════════════════════════════════════════════
// ██  SharedDashboard — Sprint 46 M1.3 + LOT D (Phase B Manager-C)
// ██  Vue publique (token URL) d'un dashboard partagé. Pas d'auth.
// ║  Route : /dashboards/shared/$token
// ══════════════════════════════════════════════════════════════
//
// LOT D Phase B Manager-C (2026-05-20) :
//   - Affiche le SNAPSHOT figé renvoyé par le backend (Manager-B) si dispo,
//     sinon dégradation gracieuse = render la config live (avec flag visuel
//     "données live, snapshot indisponible").
//   - Indicateurs d'audit : `reports.audit.shared_at` (date partage) +
//     `reports.audit.last_view` (dernière consultation, si fourni).
//   - Scope badge (`reports.scope.bound_to_*`) propagé via prop
//     `<DashboardBuilder scope=...>` quand backend l'expose.
//   - Mode READ-ONLY strict (pas de drag, pas d'édition, pas de save).

import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { getSharedDashboard } from '@/lib/api';
import { DashboardBuilder, createEmptyDashboard, type DashboardBuilderValue } from '@/components/reports/DashboardBuilder';
import { Card, Skeleton, Tag, Icon, Button } from '@/components/ui';
import { Unlink } from 'lucide-react';
import { t } from '@/lib/i18n';

const LinkOff = Unlink;

// Le backend Manager-B peut enrichir la réponse de `getSharedDashboard`
// avec ces champs additifs ; on les lit en best-effort sans casser
// rétro-compat Sprint 46 M1.3.
interface SharedDashboardEnriched {
  id: number;
  name: string;
  config: any;
  updated_at: number;
  shared_at?: number;
  last_view?: number;
  snapshot?: { widgets: any[]; cols?: number; data?: Record<string, any> } | null;
  scope?: 'client' | 'agency' | 'legacy';
}

function formatDateFr(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('fr-CA', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatDateTimeFr(ts: number): string {
  return new Date(ts * 1000).toLocaleString('fr-CA', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function SharedDashboardPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const [name, setName] = useState<string>(t('shared.title'));
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [sharedAt, setSharedAt] = useState<number | null>(null);
  const [lastView, setLastView] = useState<number | null>(null);
  const [scope, setScope] = useState<'client' | 'agency' | 'legacy' | undefined>(undefined);
  const [snapshotMode, setSnapshotMode] = useState<'snapshot' | 'live'>('live');
  const [value, setValue] = useState<DashboardBuilderValue>(createEmptyDashboard());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Renforcement — reload counter for retry
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await getSharedDashboard(token);
      if (cancelled) return;
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        const d = res.data as SharedDashboardEnriched;
        setName(d.name || t('shared.title'));
        setUpdatedAt(d.updated_at || null);
        setSharedAt(d.shared_at || null);
        setLastView(d.last_view || null);
        if (d.scope === 'client' || d.scope === 'agency' || d.scope === 'legacy') {
          setScope(d.scope);
        }
        // Snapshot figé prioritaire (Manager-B). Sinon fallback config live.
        if (d.snapshot && Array.isArray(d.snapshot.widgets)) {
          setValue({
            cols: d.snapshot.cols || 12,
            widgets: d.snapshot.widgets,
          });
          setSnapshotMode('snapshot');
        } else {
          setValue((d.config as DashboardBuilderValue) || createEmptyDashboard());
          setSnapshotMode('live');
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token, reloadKey]);

  return (
    <div className="shared-dashboard-page">
      <header className="shared-dashboard-page__header">
        <div className="shared-dashboard-page__brand">Intralys</div>
        <div className="shared-dashboard-page__meta">
          {loading ? (
            <Skeleton className="h-7 w-56 rounded-md mb-1" />
          ) : (
            <h1 className="shared-dashboard-page__title">{name}</h1>
          )}
          <div className="shared-dashboard-page__audit">
            {sharedAt ? (
              <span className="shared-dashboard-page__date">
                {t('reports.audit.shared_at')} {formatDateFr(sharedAt)}
              </span>
            ) : updatedAt && (
              <span className="shared-dashboard-page__date">
                Maj : {formatDateFr(updatedAt)}
              </span>
            )}
            {lastView && (
              <span className="shared-dashboard-page__last-view">
                · {t('reports.audit.last_view')} : {formatDateTimeFr(lastView)}
              </span>
            )}
            {snapshotMode === 'snapshot' && (
              <Tag size="sm" variant="success" className="shared-dashboard-page__snapshot-tag">
                {t('reports.share.snapshot_frozen')}
              </Tag>
            )}
            {snapshotMode === 'live' && (
              <Tag size="sm" variant="warning" className="shared-dashboard-page__snapshot-tag">
                {t('reports.share.live_data')}
              </Tag>
            )}
          </div>
        </div>
      </header>

      <main className="shared-dashboard-page__main" aria-busy={loading} aria-live="polite">
        {loading ? (
          <>
            <span className="sr-only">{t('shared.loading')}</span>
            <Skeleton className="h-[420px] w-full rounded-2xl" />
          </>
        ) : error ? (
          <Card className="shared-dashboard-page__error" role="alert" aria-live="assertive">
            <span className="shared-dashboard-page__error-icon" aria-hidden>
              <Icon as={LinkOff} size={22} />
            </span>
            <h2 className="shared-dashboard-page__error-title">{t('shared.expired')}</h2>
            <p className="text-xs text-[var(--text-muted)] mt-2 mb-3 break-all">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              {t('shared.error.retry')}
            </Button>
          </Card>
        ) : (
          <DashboardBuilder value={value} onChange={() => {}} readOnly scope={scope} />
        )}
      </main>

      <footer className="shared-dashboard-page__footer">
        Propulsé par Intralys CRM · <a href="https://intralys.app">intralys.app</a>
      </footer>
    </div>
  );
}
