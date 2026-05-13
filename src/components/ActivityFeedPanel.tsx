// ── ActivityFeedPanel — Stream d'activité d'équipe (Sprint 22) ──────────────
// Différenciateur "agency owner" vs GHL : voir en temps réel ce que toute
// l'équipe fait. Slide-over panel ouvert depuis un icône Activity dans le header.

import { useState, useEffect, useCallback, useRef } from 'react';
import { SlidePanel, Skeleton, EmptyState } from '@/components/ui';
import { Activity, Loader2, RefreshCcw } from 'lucide-react';
import { getRecentActivity } from '@/lib/api';
import { ACTIVITY_LABELS, ACTIVITY_ICONS, type ActivityLogEntry, type ActivityType } from '@/lib/types';
import { LeadLink } from '@/components/panels/LeadLink';

interface ActivityFeedPanelProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const POLL_INTERVAL_MS = 30_000;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hier';
  if (d < 7) return `il y a ${d}j`;
  return new Date(dateStr).toLocaleDateString('fr-CA');
}

function groupByDay(entries: ActivityLogEntry[]): Array<{ date: string; items: ActivityLogEntry[] }> {
  const groups = new Map<string, ActivityLogEntry[]>();
  for (const e of entries) {
    const key = new Date(e.created_at).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' });
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
          className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer"
          title="Rafraîchir"
          aria-label="Rafraîchir"
        >
          {isRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
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
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 sticky top-0 bg-[var(--bg-surface)] py-1">
                {group.date}
              </h3>
              <div className="space-y-2">
                {group.items.map((entry) => {
                  let parsedDetails: Record<string, unknown> = {};
                  try { parsedDetails = entry.details ? JSON.parse(entry.details) : {}; } catch { /* ignore */ }
                  const icon = ACTIVITY_ICONS[entry.action as ActivityType] || '•';
                  const label = ACTIVITY_LABELS[entry.action as ActivityType] || entry.action;
                  return (
                    <div key={entry.id} className="flex gap-2 p-2 rounded-[var(--radius-md)] hover:bg-[var(--bg-subtle)] transition-colors">
                      <div className="w-7 h-7 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center text-xs shrink-0">
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--text-primary)] leading-snug">
                          <span className="font-semibold">{entry.user_name || 'Système'}</span>{' '}
                          <span className="text-[var(--text-secondary)]">{label.toLowerCase()}</span>
                          {entry.lead_id && entry.lead_name && (
                            <>{' '}<LeadLink leadId={entry.lead_id} className="text-[var(--brand-primary)] hover:underline">{entry.lead_name}</LeadLink></>
                          )}
                        </p>
                        {Object.keys(parsedDetails).length > 0 && (
                          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate">
                            {Object.entries(parsedDetails).slice(0, 2).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(' · ')}
                          </p>
                        )}
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{timeAgo(entry.created_at)}</p>
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
