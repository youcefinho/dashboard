// ── CalendarConflictResolver — Sprint 33 Agent C3 ────────────────────────────
// Modal de résolution de conflit calendrier (Intralys vs externe).
//
// Affiche les deux versions (Intralys + Google/Outlook) côte à côte avec
// timestamp et permet de garder l'une ou l'autre via resolveCalendarConflict().
//
// Note d'implémentation : la spec parle de `Dialog` mais le design system
// n'expose que `Modal` (Radix Dialog wrappé, même API publique open/onOpenChange/
// title). On utilise donc `Modal` qui est l'équivalent canonique du codebase.

import { useState, useEffect } from 'react';
import { t } from '@/lib/i18n';
import { getCalendarConflicts, resolveCalendarConflict } from '@/lib/api';
import type { CalendarConflict } from '@/lib/types';
import { Modal, Button, Card } from '@/components/ui';

interface Props {
  /** ID du sync (= CalendarConflict.syncId) à résoudre. */
  conflictId?: string;
  open: boolean;
  onClose: () => void;
  /** Callback optionnel post-résolution (refresh de la liste parent). */
  onResolved?: () => void;
}

export function CalendarConflictResolver({
  conflictId,
  open,
  onClose,
  onResolved,
}: Props) {
  const [conflict, setConflict] = useState<CalendarConflict | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!open || !conflictId) {
      setConflict(null);
      return;
    }
    setLoading(true);
    getCalendarConflicts()
      .then((res) => {
        const c = res.data?.find((x) => x.syncId === conflictId);
        setConflict(c ?? null);
      })
      .finally(() => setLoading(false));
  }, [open, conflictId]);

  async function handleResolve(resolution: 'keep_intralys' | 'keep_external') {
    if (!conflictId) return;
    setResolving(true);
    await resolveCalendarConflict(conflictId, resolution);
    setResolving(false);
    if (onResolved) onResolved();
    onClose();
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('calendar_sync.conflict.title')}
      size="lg"
    >
      <div data-component="CalendarConflictResolver">
        {loading || !conflict ? (
          <div className="text-sm text-[var(--text-muted)] py-4">…</div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              Le rendez-vous a été modifié à la fois dans Intralys et dans le
              calendrier externe.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* ── Version Intralys ────────────────────────────────────── */}
              <Card
                data-version="intralys"
                className="flex flex-col gap-2"
              >
                <h4 className="text-sm font-semibold">Version Intralys</h4>
                <p className="text-sm text-[var(--text-primary)] break-words">
                  {conflict.intralysSummary}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {new Date(conflict.intralysUpdatedAt).toLocaleString()}
                </p>
                <div className="mt-auto pt-2">
                  <Button
                    onClick={() => void handleResolve('keep_intralys')}
                    disabled={resolving}
                  >
                    {t('calendar_sync.conflict.keep_intralys')}
                  </Button>
                </div>
              </Card>

              {/* ── Version externe (Google / Outlook) ──────────────────── */}
              <Card
                data-version="external"
                className="flex flex-col gap-2"
              >
                <h4 className="text-sm font-semibold">
                  Version{' '}
                  {conflict.provider === 'google_calendar'
                    ? 'Google'
                    : 'Outlook'}
                </h4>
                <p className="text-sm text-[var(--text-primary)] break-words">
                  {conflict.externalSummary}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {new Date(conflict.externalUpdatedAt).toLocaleString()}
                </p>
                <div className="mt-auto pt-2">
                  <Button
                    onClick={() => void handleResolve('keep_external')}
                    disabled={resolving}
                  >
                    {t('calendar_sync.conflict.keep_external')}
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
