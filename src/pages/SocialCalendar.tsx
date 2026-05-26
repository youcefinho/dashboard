// ── Page SocialCalendar — calendrier visuel de planification des posts ──────
// LOT SOCIAL PLANNER (Sprint 9) — Manager-C (front). Export nommé FIGÉ
// `SocialCalendarPage` (route /social/calendar, App.tsx FIGÉ Phase A).
//
// Grille mensuelle PROPRE au Social planner (DISTINCTE de Calendar.tsx des RDV —
// rien à voir, §6.I-8). Affiche les posts planifiés (getSocialPosts filtrés sur
// scheduled_at) à leur date. Clic sur un jour → panneau latéral listant /
// permettant de voir les posts de ce jour. Re-planification optionnelle via le
// helper FIGÉ scheduleSocialPost (depuis le panneau du jour).
//
// Helpers FIGÉS consommés tels quels (§6.A). Libellés t('social.*'). AUCUN CSS
// global (utilitaires Tailwind + tokens var(--…)).

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Card, EmptyState, PageHero, SlidePanel, useToast } from '@/components/ui';
import { ChevronLeft, ChevronRight, ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react';
import { getSocialPosts, scheduleSocialPost } from '@/lib/api';
import type { SocialPost } from '@/lib/types';
import { SocialPostCard, NetworkIcon } from '@/components/social';
import { t } from '@/lib/i18n';

/** Clé locale YYYY-MM-DD (heure locale) pour un Date / une date ISO. */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function SocialCalendarPage() {
  const toast = useToast();
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await getSocialPosts();
      // Discrimination d'erreur : absence de `data` OU `error` présent.
      if (res.data) setPosts(res.data);
      else if (res.error) setLoadError(true);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Posts planifiés indexés par jour local (uniquement ceux ayant scheduled_at).
  const postsByDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const p of posts) {
      if (!p.scheduled_at) continue;
      const d = new Date(p.scheduled_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = dayKey(d);
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [posts]);

  // Grille du mois : semaines commençant lundi (FR-CA).
  const weeks = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    // Lundi = 0 … Dimanche = 6
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - offset);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      cells.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    const result: Date[][] = [];
    for (let w = 0; w < 6; w++) result.push(cells.slice(w * 7, w * 7 + 7));
    // Retire la 6e semaine si entièrement hors mois.
    if (result[5]?.every((d) => d.getMonth() !== month)) result.pop();
    return result;
  }, [cursor]);

  const monthLabel = cursor.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
  const todayKey = dayKey(new Date());
  const selectedPosts = selectedDay ? (postsByDay.get(selectedDay) ?? []) : [];

  // Re-planification depuis le panneau du jour (helper FIGÉ scheduleSocialPost).
  const reschedule = async (post: SocialPost) => {
    if (!selectedDay) return;
    // Conserve l'heure existante si présente, sinon midi.
    const existing = post.scheduled_at ? new Date(post.scheduled_at) : null;
    const hours = existing && !Number.isNaN(existing.getTime()) ? existing.getHours() : 12;
    const minutes = existing && !Number.isNaN(existing.getTime()) ? existing.getMinutes() : 0;
    const [y, m, dd] = selectedDay.split('-').map(Number);
    if (y === undefined || m === undefined || dd === undefined) return;
    const target = new Date(y, m - 1, dd, hours, minutes);
    const res = await scheduleSocialPost(post.id, target.toISOString());
    if (res.data) {
      toast.success(t('social.saved'));
      await loadData();
    } else {
      toast.error(res.error ?? t('social.not_configured'));
    }
  };

  return (
    <AppLayout title={t('social.calendar')}>
      <PageHero
        meta="Social"
        title={t('social.calendar')}
        highlight={t('social.title')}
        description={t('social.subtitle')}
        actions={
          <Link to="/social">
            <Button variant="secondary" leftIcon={<ArrowLeft size={14} />}>{t('social.composer')}</Button>
          </Link>
        }
      />

      <Card className="p-0 overflow-hidden">
        {/* En-tête mois + navigation */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
          <button
            type="button"
            aria-label={t('social.calendar_prev_month')}
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-semibold text-[var(--text-primary)] capitalize">{monthLabel}</span>
          <button
            type="button"
            aria-label={t('social.calendar_next_month')}
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {loading ? (
          <div className="p-4" role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">{t('common.loading')}</span>
            <div className="skeleton h-80 rounded-[var(--radius-lg)]" />
          </div>
        ) : loadError ? (
          <div className="p-4">
            <EmptyState
              variant="compact"
              icon={<AlertTriangle size={32} strokeWidth={1.8} />}
              title={t('social.load_error')}
              description={t('social.load_error_desc')}
              action={
                <Button onClick={() => void loadData()} leftIcon={<RefreshCw size={14} />}>
                  {t('social.retry')}
                </Button>
              }
            />
          </div>
        ) : (
          <div className="p-3">
            {/* En-têtes de jours */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((d, i) => (
                <div key={i} className="text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] py-1">{d}</div>
              ))}
            </div>
            {/* Cellules */}
            <div className="grid grid-cols-7 gap-1">
              {weeks.flat().map((d) => {
                const key = dayKey(d);
                const inMonth = d.getMonth() === cursor.getMonth();
                const dayPosts = postsByDay.get(key) ?? [];
                const isToday = key === todayKey;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDay(key)}
                    className={`text-left min-h-[78px] p-1.5 rounded-[var(--radius-md)] border transition-colors cursor-pointer ${
                      inMonth ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-subtle)] opacity-60'
                    } ${isToday ? 'border-[var(--primary)]' : 'border-[var(--border-subtle)]'} hover:border-[var(--primary)]`}
                  >
                    <span className={`text-[12px] ${isToday ? 'font-bold text-[var(--primary)]' : 'text-[var(--text-secondary)]'}`}>
                      {d.getDate()}
                    </span>
                    {dayPosts.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {dayPosts.slice(0, 2).map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center gap-1 px-1 py-0.5 rounded-[var(--radius-sm,4px)] bg-[var(--bg-subtle)] text-[10px] text-[var(--text-secondary)] truncate"
                          >
                            {(() => {
                              const first = (p.networks ?? [])[0];
                              return first ? <NetworkIcon provider={first} /> : null;
                            })()}
                            <span className="truncate">{p.content || '—'}</span>
                          </div>
                        ))}
                        {dayPosts.length > 2 && (
                          <div className="text-[10px] text-[var(--text-muted)] px-1">+{dayPosts.length - 2}</div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Panneau latéral : posts du jour sélectionné */}
      <SlidePanel
        open={!!selectedDay}
        onOpenChange={(o) => { if (!o) setSelectedDay(null); }}
        title={selectedDay ? new Date(`${selectedDay}T00:00:00`).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' }) : t('social.calendar')}
      >
        {selectedPosts.length === 0 ? (
          <EmptyState
            variant="first-time"
            icon={<span className="text-4xl">🗓️</span>}
            title={t('social.empty')}
            description={t('social.subtitle')}
          />
        ) : (
          <div className="space-y-3">
            {selectedPosts.map((post) => (
              <SocialPostCard
                key={post.id}
                post={post}
                onEdit={() => { /* l'édition se fait sur /social — on garde le calendrier en lecture/replanif. */ }}
                onDelete={() => { /* suppression gérée sur /social */ }}
                onSchedule={(p) => void reschedule(p)}
              />
            ))}
          </div>
        )}
        <div className="mt-4">
          <Link to="/social">
            <Button variant="ghost" fullWidth>{t('social.composer')}</Button>
          </Link>
        </div>
      </SlidePanel>
    </AppLayout>
  );
}
