// ── CalendarSyncSettings — Sprint 33 Agent C2 ──────────────────────────────
// Panel détaillé pour Integrations.tsx (intégration via Agent C3 ou autre).
// Affiche :
//   - les boutons de connexion Google / Outlook (CalendarConnectButtons)
//   - la table des connexions actives avec actions (Sync now)
//   - un résumé des conflits détectés (avec lien vers le Calendrier)

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import {
  getCalendarConnections,
  syncCalendarNow,
  getCalendarConflicts,
} from '@/lib/api';
import type { CalendarConnection, CalendarConflict } from '@/lib/types';
import { CalendarConnectButtons } from './CalendarConnectButtons';
import { Card, Button, Badge } from '@/components/ui';

export function CalendarSyncSettings() {
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [conflicts, setConflicts] = useState<CalendarConflict[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [connsRes, conflictsRes] = await Promise.all([
      getCalendarConnections(),
      getCalendarConflicts(),
    ]);
    setLoading(false);
    if (connsRes.data) setConnections(connsRes.data);
    if (conflictsRes.data) setConflicts(conflictsRes.data);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSyncNow(connId: string) {
    setSyncing(connId);
    await syncCalendarNow(connId);
    setSyncing(null);
    await load();
  }

  return (
    <div className="space-y-6" data-component="CalendarSyncSettings">
      <CalendarConnectButtons onConnected={load} />

      {connections.length > 0 && (
        <Card>
          <h4>{t('calendar_sync.title')}</h4>
          <table className="w-full">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Compte</th>
                <th>Statut</th>
                <th>Dernière sync</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.provider === 'google_calendar' ? 'Google' : 'Outlook'}
                  </td>
                  <td>{c.externalAccountEmail || '—'}</td>
                  <td>
                    <Badge
                      intent={
                        c.status === 'active'
                          ? 'success'
                          : c.status === 'error'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {c.status}
                    </Badge>
                  </td>
                  <td className="text-xs">
                    {c.lastPullAt
                      ? new Date(c.lastPullAt).toLocaleString()
                      : '—'}
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={() => handleSyncNow(c.id)}
                      disabled={syncing === c.id}
                    >
                      {syncing === c.id ? '…' : t('calendar_sync.sync_now')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {conflicts.length > 0 && (
        <Card>
          <h4 className="text-amber-700">
            {t('calendar_sync.conflict.title')} ({conflicts.length})
          </h4>
          <p className="text-sm">Voir l'onglet Calendrier pour résoudre.</p>
        </Card>
      )}

      {loading && connections.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">…</p>
      )}
    </div>
  );
}
