// ══════════════════════════════════════════════════════════════
// ██  SharedDashboard — Sprint 46 M1.3
// ██  Vue publique (token URL) d'un dashboard partagé. Pas d'auth.
// ║  Route : /dashboards/shared/$token
// ══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { getSharedDashboard } from '@/lib/api';
import { DashboardBuilder, createEmptyDashboard, type DashboardBuilderValue } from '@/components/reports/DashboardBuilder';
import { Card, Skeleton } from '@/components/ui';

export function SharedDashboardPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const [name, setName] = useState<string>('Dashboard partagé');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [value, setValue] = useState<DashboardBuilderValue>(createEmptyDashboard());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await getSharedDashboard(token);
      if (cancelled) return;
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setName(res.data.name || 'Dashboard partagé');
        setUpdatedAt(res.data.updated_at || null);
        setValue((res.data.config as DashboardBuilderValue) || createEmptyDashboard());
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="shared-dashboard-page">
      <header className="shared-dashboard-page__header">
        <div className="shared-dashboard-page__brand">Intralys</div>
        <div className="shared-dashboard-page__meta">
          <h1 className="shared-dashboard-page__title">{name}</h1>
          {updatedAt && (
            <span className="shared-dashboard-page__date">
              Maj : {new Date(updatedAt * 1000).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          )}
        </div>
      </header>

      <main className="shared-dashboard-page__main">
        {loading ? (
          <Skeleton className="h-[420px] w-full rounded-2xl" />
        ) : error ? (
          <Card className="p-8 text-center">
            <h2 className="text-base font-semibold mb-2">Lien invalide ou expiré</h2>
            <p className="text-sm text-[var(--text-muted)]">{error}</p>
          </Card>
        ) : (
          <DashboardBuilder value={value} onChange={() => {}} readOnly />
        )}
      </main>

      <footer className="shared-dashboard-page__footer">
        Propulsé par Intralys CRM · <a href="https://intralys.app">intralys.app</a>
      </footer>
    </div>
  );
}
