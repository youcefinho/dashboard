// ── AuditLogSettings — Sprint 23 Sécurité / conformité (RÉÉCRITURE) ─────────
// Fetch via getAuditLog(query) — fini le mock useState. Filter chips (action,
// user, date) + pagination offset/limit + export CSV best-effort (200 lignes).
// Badge "Sensible — masqué" affiché si row.redacted === 1.
// La signature publique est sans props — appelée par <SettingsPage /> directement.

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Input,
  Tag,
  KpiStrip,
  EmptyState,
  Icon,
  Skeleton,
} from '@/components/ui';
import {
  Activity,
  LogIn,
  KeyRound,
  Download,
  AlertTriangle,
  Filter,
  Lock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
// Sprint 48 M3.2/M3.4 — formatte audit timestamps dans le TZ user + locale
import { formatDateInTimezone, getStoredTimezone } from '@/lib/i18n/timezone';
import { getLocale, t } from '@/lib/i18n';
import { getAuditLog } from '@/lib/api';
import type { AuditLogEntry, AuditLogQuery } from '@/lib/types';

type AuditAction = string;

function categorize(action: AuditAction): {
  category: string;
  variant: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
} {
  if (action.startsWith('user.login') || action.includes('logout'))
    return { category: 'auth', variant: 'info' };
  if (action.includes('api_key'))
    return { category: 'security', variant: 'accent' };
  if (action.includes('export'))
    return { category: 'export', variant: 'warning' };
  if (action.includes('delete'))
    return { category: 'delete', variant: 'danger' };
  if (action.includes('create'))
    return { category: 'create', variant: 'success' };
  return { category: 'other', variant: 'brand' };
}

const FILTERS = [
  { key: '', label: 'Toutes' },
  { key: 'login', label: 'Connexions' },
  { key: 'create', label: 'Créations' },
  { key: 'export', label: 'Exports' },
  { key: 'delete', label: 'Suppressions' },
] as const;

const PAGE_SIZE = 50;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function AuditLogSettings() {
  const [searchUser, setSearchUser] = useState('');
  const [filterAction, setFilterAction] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [page, setPage] = useState(0);

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const query: AuditLogQuery = useMemo(
    () => ({
      action: filterAction || undefined,
      user_id: searchUser.trim() || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [filterAction, searchUser, dateFrom, dateTo, page],
  );

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAuditLog(query);
      if (res.error || !res.data) {
        setLogs([]);
        setHasMore(false);
        setError(res.error || 'Erreur de chargement');
      } else {
        setLogs(res.data);
        setHasMore(res.data.length === PAGE_SIZE);
      }
    } catch {
      setLogs([]);
      setHasMore(false);
      setError('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Reset à la page 0 quand un filtre change
  // (sauf si on est déjà à 0)
  useEffect(() => {
    setPage(0);
  }, [filterAction, searchUser, dateFrom, dateTo]);

  // KPIs : actions des dernières 24h dans la page courante (proxy meilleur effort)
  const kpis = useMemo(() => {
    const dayAgo = Date.now() - 86400000;
    const recent = logs.filter(
      (l) => new Date(l.created_at).getTime() >= dayAgo,
    );
    const auth = recent.filter((l) => categorize(l.action).category === 'auth').length;
    const exports = recent.filter((l) => categorize(l.action).category === 'export').length;
    const security = recent.filter((l) => categorize(l.action).category === 'security').length;
    return [
      {
        label: 'Actions / 24h',
        value: recent.length,
        color: 'brand' as const,
        icon: <Activity size={12} />,
      },
      {
        label: 'Connexions',
        value: auth,
        color: 'info' as const,
        icon: <LogIn size={12} />,
      },
      {
        label: 'Sécurité',
        value: security,
        color: 'accent' as const,
        icon: <KeyRound size={12} />,
      },
      {
        label: 'Exports',
        value: exports,
        color: 'warning' as const,
        icon: <Download size={12} />,
      },
    ];
  }, [logs]);

  async function handleExportCsv() {
    // Best-effort : on récupère jusqu'à 200 lignes avec les mêmes filtres
    const res = await getAuditLog({ ...query, limit: 200, offset: 0 });
    const rows = res.data ?? [];
    const headers = [
      'id',
      'created_at',
      'user_id',
      'action',
      'resource_type',
      'resource_id',
      'ip',
      'redacted',
    ];
    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.id,
          r.created_at,
          r.user_id ?? '',
          r.action,
          r.resource_type ?? '',
          r.resource_id ?? '',
          r.ip ?? '',
          r.redacted,
        ]
          .map(csvEscape)
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `intralys-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const hasFilters = !!(filterAction || searchUser || dateFrom || dateTo);

  return (
    <div className="space-y-6">
      <KpiStrip items={kpis} />

      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3">{t('audit.viewer.title')}</h3>
            <p className="t-caption text-[var(--gray-500)]">
              Trace des actions sensibles sur ton compte.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Icon as={Download} size="sm" />}
            onClick={() => void handleExportCsv()}
          >
            {t('audit.viewer.export')}
          </Button>
        </header>

        <div className="flex gap-3 mb-4 flex-wrap items-center">
          <div className="max-w-xs flex-1 min-w-[200px]">
            <Input
              leftIcon={<Icon as={Filter} size="sm" />}
              placeholder={t('audit.viewer.filter_user')}
              value={searchUser}
              onChange={(e) => setSearchUser(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label={`${t('audit.viewer.filter_date')} (début)`}
              containerClassName="w-[160px]"
            />
            <span className="text-xs text-[var(--text-muted)]">→</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label={`${t('audit.viewer.filter_date')} (fin)`}
              containerClassName="w-[160px]"
            />
          </div>
          <div
            className="segmented-control"
            role="tablist"
            aria-label={t('audit.viewer.filter_action')}
          >
            {FILTERS.map((f) => (
              <button
                key={f.key || 'all'}
                type="button"
                role="tab"
                aria-selected={filterAction === f.key}
                onClick={() => setFilterAction(f.key)}
                className={`${filterAction === f.key ? 'is-active' : ''}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={AlertTriangle} size={28} />}
            title="Erreur de chargement"
            description={error}
            action={
              <Button variant="secondary" size="sm" onClick={() => void fetchLogs()}>
                Réessayer
              </Button>
            }
          />
        ) : logs.length === 0 ? (
          hasFilters ? (
            <EmptyState
              variant="compact"
              icon={<Icon as={AlertTriangle} size={28} />}
              title={t('audit.viewer.empty')}
              description="Aucun événement ne correspond à tes filtres. Essaye d'élargir la recherche."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearchUser('');
                    setFilterAction('');
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  Réinitialiser les filtres
                </Button>
              }
            />
          ) : (
            <EmptyState
              variant="compact"
              icon={<Icon as={Activity} size={28} />}
              title="Aucun événement"
              description="Le journal d'audit enregistrera ici toutes les actions sensibles (connexions, créations, exports, suppressions) dès qu'elles se produiront."
            />
          )
        ) : (
          <>
            <div className="space-y-2.5">
              {logs.map((log, idx) => {
                const cat = categorize(log.action);
                const isRedacted = log.redacted === 1;
                return (
                  <div
                    key={log.id}
                    className="row-premium list-item-enter flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl"
                    style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
                  >
                    <div className="text-xs text-[var(--text-muted)] font-medium whitespace-nowrap min-w-[160px]">
                      {formatDateInTimezone(
                        log.created_at,
                        getStoredTimezone(),
                        getLocale(),
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {log.user_id ?? '—'}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {log.resource_type ?? '—'}
                        {log.resource_id ? ` · ${log.resource_id}` : ''}
                        {log.ip ? (
                          <>
                            {' '}
                            • IP <span className="font-mono">{log.ip}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isRedacted && (
                        <Tag variant="warning" dot>
                          <Icon as={Lock} size={10} className="mr-1" />
                          {t('audit.viewer.redacted')}
                        </Tag>
                      )}
                      <Tag variant={cat.variant} dot>
                        {log.action}
                      </Tag>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
              <p className="text-xs text-[var(--text-muted)]">
                Page {page + 1}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  leftIcon={<Icon as={ChevronLeft} size="sm" />}
                >
                  Précédent
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasMore}
                  onClick={() => setPage((p) => p + 1)}
                  rightIcon={<Icon as={ChevronRight} size="sm" />}
                >
                  Suivant
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
