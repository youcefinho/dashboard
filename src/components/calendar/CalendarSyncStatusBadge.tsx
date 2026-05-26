// ── CalendarSyncStatusBadge — Sprint 33 Agent C2 ────────────────────────────
// Compact pill pour la toolbar de la Calendar page. Affiche l'état agrégé des
// connexions calendrier (synced / pending / error) basé sur l'état de toutes
// les CalendarConnection actives. Renvoie null si aucune connexion.
//
// Props :
//   - compact?: boolean  — mode ultra-compact (icône seule, sans label ni count)

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { getCalendarConnections } from '@/lib/api';
import type { CalendarConnection } from '@/lib/types';
import { Badge } from '@/components/ui';

interface Props {
  compact?: boolean;
}

export function CalendarSyncStatusBadge({ compact = false }: Props) {
  const [connections, setConnections] = useState<CalendarConnection[]>([]);

  useEffect(() => {
    getCalendarConnections().then((res) => {
      if (res.data) setConnections(res.data);
    });
  }, []);

  if (connections.length === 0) return null;

  const allActive = connections.every((c) => c.status === 'active');
  const hasError = connections.some((c) => c.status === 'error');
  const variant = hasError ? 'danger' : allActive ? 'success' : 'warning';
  const status = hasError ? 'error' : allActive ? 'synced' : 'pending';

  return (
    <Badge intent={variant} data-component="CalendarSyncStatusBadge">
      {compact ? '⏱' : '⏱ '}
      {t(`calendar_sync.status.${status}`)}
      {!compact && connections.length > 0 && ` (${connections.length})`}
    </Badge>
  );
}
