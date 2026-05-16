// ── AuditLogSettings — Sprint 23 W32 : cards row-premium + Tag color-coded + KpiStrip + segmented-control
import { useState, useMemo } from 'react';
import { Card, Button, Input, Tag, KpiStrip, EmptyState, Icon } from '@/components/ui';
import { Activity, LogIn, KeyRound, Download, AlertTriangle, Filter } from 'lucide-react';
// Sprint 48 M3.2/M3.4 — formatte audit timestamps dans le TZ user + locale
import { formatDateInTimezone, getStoredTimezone } from '@/lib/i18n/timezone';
import { getLocale } from '@/lib/i18n';

type AuditAction = 'user.login' | 'api_key.create' | 'lead.export' | 'lead.delete' | string;

function categorize(action: AuditAction): { category: string; variant: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'accent' } {
  if (action.startsWith('user.login') || action.includes('logout')) return { category: 'auth', variant: 'info' };
  if (action.includes('api_key')) return { category: 'security', variant: 'accent' };
  if (action.includes('export')) return { category: 'export', variant: 'warning' };
  if (action.includes('delete')) return { category: 'delete', variant: 'danger' };
  if (action.includes('create')) return { category: 'create', variant: 'success' };
  return { category: 'other', variant: 'brand' };
}

const FILTERS = [
  { key: '', label: 'Toutes' },
  { key: 'login', label: 'Connexions' },
  { key: 'create', label: 'Créations' },
  { key: 'export', label: 'Exports' },
  { key: 'delete', label: 'Suppressions' },
] as const;

export function AuditLogSettings() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('');

  const [logs] = useState([
    { id: 1, action: 'user.login', user: 'rochdi@intralys.com', resource: 'auth', ip: '192.168.1.1', date: new Date().toISOString() },
    { id: 2, action: 'api_key.create', user: 'rochdi@intralys.com', resource: 'settings', ip: '192.168.1.1', date: new Date(Date.now() - 3600000).toISOString() },
    { id: 3, action: 'lead.export', user: 'mathis@guimont.com', resource: 'leads', ip: '10.0.0.5', date: new Date(Date.now() - 86400000).toISOString() },
  ]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (filter && !l.action.includes(filter)) return false;
      if (search && !l.user.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [logs, filter, search]);

  // KPI : actions in last 24h + per major category
  const kpis = useMemo(() => {
    const dayAgo = Date.now() - 86400000;
    const recent = logs.filter((l) => new Date(l.date).getTime() >= dayAgo);
    const auth = recent.filter((l) => categorize(l.action).category === 'auth').length;
    const exports = recent.filter((l) => categorize(l.action).category === 'export').length;
    const security = recent.filter((l) => categorize(l.action).category === 'security').length;
    return [
      { label: 'Actions / 24h', value: recent.length, color: 'brand' as const, icon: <Activity size={12} /> },
      { label: 'Connexions', value: auth, color: 'info' as const, icon: <LogIn size={12} /> },
      { label: 'Sécurité', value: security, color: 'accent' as const, icon: <KeyRound size={12} /> },
      { label: 'Exports', value: exports, color: 'warning' as const, icon: <Download size={12} /> },
    ];
  }, [logs]);

  return (
    <div className="space-y-6">
      <KpiStrip items={kpis} />

      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3">Journal d'audit</h3>
            <p className="t-caption text-[var(--gray-500)]">Trace des actions sensibles sur ton compte.</p>
          </div>
          <Button variant="secondary" size="sm" leftIcon={<Icon as={Download} size="sm" />}>
            Exporter CSV
          </Button>
        </header>

        <div className="flex gap-3 mb-4 flex-wrap items-center">
          <div className="max-w-xs flex-1 min-w-[200px]">
            <Input
              leftIcon={<Icon as={Filter} size="sm" />}
              placeholder="Rechercher un utilisateur..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="segmented-control" role="tablist" aria-label="Filtres d'actions">
            {FILTERS.map((f) => (
              <button
                key={f.key || 'all'}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`${filter === f.key ? 'is-active' : ''}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          // Sprint 42 M3.3 — EmptyState cohérent (first-time vs filtered)
          logs.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={<Icon as={Activity} size={28} />}
              title="Aucun événement"
              description="Le journal d'audit enregistrera ici toutes les actions sensibles (connexions, créations, exports, suppressions) dès qu'elles se produiront."
            />
          ) : (
            <EmptyState
              variant="compact"
              icon={<Icon as={AlertTriangle} size={28} />}
              title="Aucun résultat"
              description="Aucun événement ne correspond à tes filtres. Essaye d'élargir la recherche."
              action={
                (search || filter) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearch('');
                      setFilter('');
                    }}
                  >
                    Réinitialiser les filtres
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="space-y-2.5">
            {filtered.map((log, idx) => {
              const cat = categorize(log.action);
              return (
                <div
                  key={log.id}
                  className="row-premium list-item-enter flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl"
                  style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
                >
                  <div className="text-xs text-[var(--text-muted)] font-medium whitespace-nowrap min-w-[160px]">
                    {formatDateInTimezone(log.date, getStoredTimezone(), getLocale())}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{log.user}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {log.resource} • IP <span className="font-mono">{log.ip}</span>
                    </p>
                  </div>
                  <Tag variant={cat.variant} dot>
                    {log.action}
                  </Tag>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
