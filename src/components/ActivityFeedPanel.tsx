// ── ActivityFeedPanel — Stream d'activité d'équipe (Sprint 22) ──────────────
// Différenciateur "agency owner" vs GHL : voir en temps réel ce que toute
// l'équipe fait. Slide-over panel ouvert depuis un icône Activity dans le header.

import { useState, useEffect, useCallback, useRef } from 'react';
import { SlidePanel, Skeleton, EmptyState, Avatar, Icon } from '@/components/ui';
import { Activity, Loader2, RefreshCcw } from 'lucide-react';
import { getRecentActivity } from '@/lib/api';
import { ACTIVITY_LABELS, ACTIVITY_ICONS, type ActivityLogEntry, type ActivityType } from '@/lib/types';
import { LeadLink } from '@/components/panels/LeadLink';
// Sprint 48 M3.2 — Intl relative time + locale-aware date
import { formatRelativeTime, formatDate } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';

interface ActivityFeedPanelProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const POLL_INTERVAL_MS = 30_000;

function timeAgo(dateStr: string): string {
  // Sprint 48 M3.2 — Intl.RelativeTimeFormat (locale-aware)
  return formatRelativeTime(dateStr, getLocale());
}

function groupByDay(entries: ActivityLogEntry[]): Array<{ date: string; items: ActivityLogEntry[] }> {
  const groups = new Map<string, ActivityLogEntry[]>();
  for (const e of entries) {
    const key = formatDate(e.created_at, getLocale(), { day: 'numeric', month: 'long' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return Array.from(groups.entries()).map(([date, items]) => ({ date, items }));
}

export function ActivityFeedPanel({ open, onOpenChange }: ActivityFeedPanelProps) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    const res = await getRecentActivity(50);
    if (res.data) setEntries(res.data);
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    if (open) {
      void load(false);
      pollRef.current = window.setInterval(() => void load(true), POLL_INTERVAL_MS);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open, load]);

  // Stack level — si d'autres panels sont ouverts, on est au-dessus
  const stackLevel = 0; // ActivityFeed est standalone (pas dans PanelStackProvider)

  const groups = groupByDay(entries);

  return (
    <SlidePanel
      open={open}
      onOpenChange={onOpenChange}
      title="Activité d'équipe"
      description="Dernières actions sur tous les leads"
      size="md"
      stackLevel={stackLevel}
      headerActions={
        <button
          onClick={() => void load(true)}
          disabled={isRefreshing}
          className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--primary)] transition-colors cursor-pointer"
          title="Rafraîchir"
          aria-label="Rafraîchir"
        >
          {isRefreshing ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={RefreshCcw} size="sm" />}
        </button>
      }
    >
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Activity size={32} />}
          title="Pas d'activité récente"
          description="Quand votre équipe agit sur des leads, vous le verrez ici en quasi temps réel."
        />
      ) : (
        <div className="space-y-5">
          {groups.map(group => (
            <div key={group.date}>
              <h3 className="activity-feed-day-label-s18">
                {group.date}
              </h3>
              <div className="space-y-1.5">
                {group.items.map((entry, idx) => {
                  let parsedDetails: Record<string, unknown> = {};
                  try { parsedDetails = entry.details ? JSON.parse(entry.details) : {}; } catch { /* ignore */ }
                  const icon = ACTIVITY_ICONS[entry.action as ActivityType] || '•';
                  const label = ACTIVITY_LABELS[entry.action as ActivityType] || entry.action;
                  return (
                    <div
                      key={entry.id}
                      className="activity-feed-item-s18"
                      style={{ animationDelay: `${Math.min(idx, 20) * 30}ms` }}
                    >
                      <div className="relative shrink-0">
                        <Avatar name={entry.user_name || 'Système'} size="xs" />
                        <span aria-hidden className="activity-feed-dot-s18">
                          {icon}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--text-primary)] leading-snug">
                          <span className="font-semibold">{entry.user_name || 'Système'}</span>{' '}
                          <span className="text-[var(--text-secondary)]">{label.toLowerCase()}</span>
                          {entry.lead_id && entry.lead_name && (
                            <>{' '}<LeadLink leadId={entry.lead_id} className="text-[var(--primary)] hover:underline">{entry.lead_name}</LeadLink></>
                          )}
                        </p>
                        {Object.keys(parsedDetails).length > 0 && (
                          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate">
                            {Object.entries(parsedDetails).slice(0, 2).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(' · ')}
                          </p>
                        )}
                        <p className="activity-feed-time-s18">{timeAgo(entry.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-[var(--text-muted)] text-center pt-3 border-t border-[var(--border-subtle)]">
            Mise à jour automatique toutes les 30 secondes
          </p>
        </div>
      )}
    </SlidePanel>
  );
}
