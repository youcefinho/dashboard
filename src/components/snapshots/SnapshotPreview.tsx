// ── SnapshotPreview — Sprint 35 (Snapshots) ─────────────────────────────────
// Composant PUR stateless qui rend l'aperçu (dry-run) d'un import de snapshot.
//
// Tableau : 1 ligne par entité présente dans `summary.totals` avec colonnes
// Entité | Créés | Skipped (idempotent) | Échoués | Total. Click sur une ligne
// révèle un drawer expandable listant les `log` entries filtrées par entité.
//
// Style Stripe-clean (Card surface, Badge intent par status, no console.log).
// i18n via t() — clés `snapshots.preview.col_created/col_skipped/col_failed`.
import { Fragment, useState, useMemo } from 'react';
import type { ImportSummary, ImportLogEntry, SnapshotEntityName } from '../../lib/api';
import { t } from '../../lib/i18n';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

export interface SnapshotPreviewProps {
  summary: ImportSummary;
  log: ImportLogEntry[];
}

type EntityRow = {
  entity: SnapshotEntityName;
  created: number;
  skipped: number;
  failed: number;
  total: number;
};

export function SnapshotPreview({ summary, log }: SnapshotPreviewProps) {
  const [expandedEntity, setExpandedEntity] = useState<SnapshotEntityName | null>(null);

  // Build sorted rows from totals (only entities that have any counts)
  const rows: EntityRow[] = useMemo(() => {
    const entries = Object.entries(summary.totals ?? {}) as Array<
      [SnapshotEntityName, { created: number; skipped: number; failed: number }]
    >;
    return entries
      .map(([entity, counts]) => ({
        entity,
        created: counts.created ?? 0,
        skipped: counts.skipped ?? 0,
        failed: counts.failed ?? 0,
        total: (counts.created ?? 0) + (counts.skipped ?? 0) + (counts.failed ?? 0),
      }))
      .filter((row) => row.total > 0)
      .sort((a, b) => a.entity.localeCompare(b.entity));
  }, [summary.totals]);

  // Group log entries by entity once for fast filtering on expand
  const logByEntity = useMemo(() => {
    const map = new Map<SnapshotEntityName, ImportLogEntry[]>();
    for (const entry of log) {
      const list = map.get(entry.entity);
      if (list) {
        list.push(entry);
      } else {
        map.set(entry.entity, [entry]);
      }
    }
    return map;
  }, [log]);

  const grandTotals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        created: acc.created + r.created,
        skipped: acc.skipped + r.skipped,
        failed: acc.failed + r.failed,
        total: acc.total + r.total,
      }),
      { created: 0, skipped: 0, failed: 0, total: 0 },
    );
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Card>
        <p
          className="text-sm text-[var(--text-secondary)]"
          role="status"
          aria-label={t('snapshots.preview.empty')}
        >
          Aucun changement
        </p>
      </Card>
    );
  }

  const headerCellCls =
    'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]';
  const bodyCellCls = 'px-3 py-2 text-sm text-[var(--text-primary)]';

  return (
    <Card className="p-0 overflow-hidden">
      <table
        className="w-full border-collapse"
        aria-label={t('snapshots.preview.table_label') || 'Aperçu de l\'import du snapshot'}
      >
        <thead className="bg-[var(--bg-muted)] border-b border-[var(--border)]">
          <tr>
            <th scope="col" className={headerCellCls}>
              Entité
            </th>
            <th scope="col" className={`${headerCellCls} text-right`}>
              {t('snapshots.preview.col_created')}
            </th>
            <th scope="col" className={`${headerCellCls} text-right`}>
              {t('snapshots.preview.col_skipped')}
            </th>
            <th scope="col" className={`${headerCellCls} text-right`}>
              {t('snapshots.preview.col_failed')}
            </th>
            <th scope="col" className={`${headerCellCls} text-right`}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isExpanded = expandedEntity === row.entity;
            const entries = logByEntity.get(row.entity) ?? [];
            return (
              <Fragment key={row.entity}>
                <tr
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-controls={`snapshot-preview-drawer-${row.entity}`}
                  aria-label={`${row.entity} — ${row.total}`}
                  onClick={() => setExpandedEntity(isExpanded ? null : row.entity)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedEntity(isExpanded ? null : row.entity);
                    }
                  }}
                  className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-[var(--bg-hover)]"
                  data-testid={`snapshot-preview-row-${row.entity}`}
                >
                  <td className={`${bodyCellCls} font-medium`}>{row.entity}</td>
                  <td className={`${bodyCellCls} text-right`}>
                    <Badge intent="success" fill="soft">
                      {row.created}
                    </Badge>
                  </td>
                  <td className={`${bodyCellCls} text-right`}>
                    <Badge intent="warning" fill="soft">
                      {row.skipped}
                    </Badge>
                  </td>
                  <td className={`${bodyCellCls} text-right`}>
                    <Badge intent="danger" fill="soft">
                      {row.failed}
                    </Badge>
                  </td>
                  <td className={`${bodyCellCls} text-right tabular-nums font-medium`}>
                    {row.total}
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td
                      colSpan={5}
                      id={`snapshot-preview-drawer-${row.entity}`}
                      className="bg-[var(--bg-muted)] border-b border-[var(--border)] p-0"
                      data-testid={`snapshot-preview-drawer-${row.entity}`}
                    >
                      {entries.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-[var(--text-secondary)]">
                          Aucune entrée de journal
                        </p>
                      ) : (
                        <ul className="divide-y divide-[var(--border)]">
                          {entries.map((entry, idx) => (
                            <li
                              key={`${entry.entity}-${idx}-${entry.old_id ?? ''}`}
                              className="px-3 py-2 flex items-center gap-3 text-xs"
                            >
                              <Badge
                                intent={
                                  entry.action === 'created'
                                    ? 'success'
                                    : entry.action === 'skipped'
                                      ? 'warning'
                                      : 'danger'
                                }
                                fill="soft"
                              >
                                {entry.action}
                              </Badge>
                              <span className="font-mono text-[var(--text-secondary)] truncate">
                                {entry.old_id ?? '—'}
                                <span className="px-1 text-[var(--text-muted)]">→</span>
                                {entry.new_id ?? '—'}
                              </span>
                              {entry.reason ? (
                                <span className="text-[var(--text-secondary)] italic ml-auto">
                                  {entry.reason}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot className="bg-[var(--bg-muted)] border-t border-[var(--border)]">
          <tr>
            <td className={`${bodyCellCls} font-semibold`}>Total</td>
            <td className={`${bodyCellCls} text-right tabular-nums font-semibold`}>
              {grandTotals.created}
            </td>
            <td className={`${bodyCellCls} text-right tabular-nums font-semibold`}>
              {grandTotals.skipped}
            </td>
            <td className={`${bodyCellCls} text-right tabular-nums font-semibold`}>
              {grandTotals.failed}
            </td>
            <td className={`${bodyCellCls} text-right tabular-nums font-semibold`}>
              {grandTotals.total}
            </td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

export default SnapshotPreview;
