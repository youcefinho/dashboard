// ── Sprint 30 — Release Candidate / Beta : ReleaseGatesPanel (Manager-C) ────
//
// Composant lecture seule : affiche les 8 checks gates retournés par
// `fetchReleaseGates()` (`ApiResponse<ReleaseGatesStatus>`) avec un badge
// Pass/Fail par ligne + un badge global "all green / gate failed" + un bouton
// "Vérifier" qui déclenche le fetch. Pas de mutation : juste un re-fetch.
//
// Intégré dans ObservabilityPanel (Sprint 24) sous forme de 3e tab
// "Release Gates" (ajouté par le même Manager-C).
//
// API : fetchReleaseGates (lib/api.ts FIGÉ Phase A).
// Types : ReleaseGatesStatus / ReleaseGateCheck (lib/types.ts FIGÉ Phase A).
// i18n : `release_gates.*` (10 clés, FIGÉES Phase A, parité ×4 catalogues).
// Best-effort : si API échoue (res.error) → EmptyState gracieux, pas de crash.

import { useCallback, useState } from 'react';
import { t } from '@/lib/i18n';
import { fetchReleaseGates } from '@/lib/api';
import type { ReleaseGatesStatus, ReleaseGateCheck } from '@/lib/types';
import {
  Card,
  Button,
  Tag,
  EmptyState,
  Skeleton,
  Icon,
} from '@/components/ui';
import { ShieldCheck, RefreshCw, AlertOctagon } from 'lucide-react';

type CheckKey = keyof ReleaseGatesStatus['checks'];

interface CheckRow {
  key: CheckKey;
  // Si label commence par `release_gates.*` ou un autre namespace i18n, on
  // passe par t(). Sinon, libellé technique direct (ex: `/api/health`).
  label: string;
}

// Ordre stable d'affichage des 8 checks (correspondance 1:1 avec le contrat
// LOT-RC-BETA — i18n keys du Phase A + libellés techniques directs pour les
// 3 dernières clés absentes du catalogue (parité ×4 stricte respectée).
const CHECK_ROWS: CheckRow[] = [
  { key: 'migrations_last_seq', label: 'release_gates.migrations_seq' },
  { key: 'env_critical_present', label: 'release_gates.env_critical' },
  { key: 'env_optional_present', label: 'release_gates.env_critical' },
  { key: 'dev_bypass_off', label: 'release_gates.dev_bypass_off' },
  { key: 'payments_live_disabled', label: 'release_gates.payments_disabled' },
  { key: 'health_endpoint', label: '/api/health' },
  { key: 'web_vitals_endpoint', label: '/api/admin/web-vitals' },
  { key: 'beta_codes_seeded', label: 'Beta codes seeded' },
];

function renderCheckRow(row: CheckRow, check: ReleaseGateCheck | undefined) {
  if (!check) return null;
  const variant = check.ok ? 'success' : 'danger';
  const badgeLabel = check.ok
    ? t('release_gates.all_green')
    : t('release_gates.gate_failed');
  const displayLabel = row.label.startsWith('release_gates.')
    ? t(row.label)
    : row.label;

  return (
    <li
      key={row.key}
      className="flex items-start justify-between gap-3 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0"
      data-testid={`release-gate-row-${row.key}`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm text-[var(--text-primary)]">
          {displayLabel}
        </div>
        {check.missing && check.missing.length > 0 && (
          <div className="text-xs text-[var(--text-muted)] mt-0.5 break-words">
            {t('release_gates.env_missing')}: {check.missing.join(', ')}
          </div>
        )}
        {typeof check.value !== 'undefined' && (
          <div className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
            value: {String(check.value)}
          </div>
        )}
        {typeof check.status !== 'undefined' && (
          <div className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
            status: {check.status}
          </div>
        )}
        {typeof check.count !== 'undefined' && (
          <div className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
            count: {check.count}
          </div>
        )}
      </div>
      <Tag variant={variant} size="sm" dot>
        {badgeLabel}
      </Tag>
    </li>
  );
}

export function ReleaseGatesPanel() {
  const [status, setStatus] = useState<ReleaseGatesStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchReleaseGates();
      if (res.error || !res.data) {
        setError(res.error ?? t('release_gates.gate_failed'));
        setStatus(null);
      } else {
        setStatus(res.data);
      }
    } catch {
      setError(t('release_gates.gate_failed'));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <Card className="p-6" data-testid="release-gates-panel">
      <header className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon as={ShieldCheck} size={14} className="text-[var(--primary)]" />
            <h3 className="t-h3">{t('release_gates.title')}</h3>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {t('release_gates.subtitle')}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleRun()}
          disabled={loading}
          isLoading={loading}
          leftIcon={<Icon as={RefreshCw} size="sm" />}
          data-testid="release-gates-run"
        >
          {t('release_gates.run_check')}
        </Button>
      </header>

      {loading && <Skeleton className="h-64 w-full rounded-xl" />}

      {!loading && error && (
        <EmptyState
          variant="compact"
          icon={<Icon as={AlertOctagon} size={28} />}
          title={t('release_gates.gate_failed')}
          description={error}
        />
      )}

      {!loading && !error && !status && (
        <EmptyState
          variant="compact"
          icon={<Icon as={ShieldCheck} size={28} />}
          title={t('release_gates.run_check')}
          description={t('release_gates.subtitle')}
        />
      )}

      {!loading && !error && status && (
        <>
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            <Tag variant={status.all_green ? 'success' : 'danger'} dot>
              {status.all_green
                ? t('release_gates.all_green')
                : t('release_gates.gate_failed')}
            </Tag>
            <span className="text-xs text-[var(--text-muted)]">
              {new Date(status.checked_at).toLocaleString()}
            </span>
          </div>
          <ul className="space-y-0">
            {CHECK_ROWS.map((row) =>
              renderCheckRow(row, status.checks[row.key]),
            )}
          </ul>
        </>
      )}
    </Card>
  );
}
