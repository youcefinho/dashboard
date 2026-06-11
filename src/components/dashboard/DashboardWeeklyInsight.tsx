// ── DashboardWeeklyInsight — Widget IA hebdomadaire (Giga Sprint Design) ──
// Extrait de Dashboard.tsx. Composant autonome avec data fetching interne
// (car il a son propre cycle de vie : fetch + generate).

import { useState, useEffect, useCallback } from 'react';
import { Sparkles, RefreshCw, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { getWeeklyInsight, generateWeeklyInsight } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { WeeklyAiInsight } from '@/lib/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Métriques typées (évite `any`)
interface InsightMetrics {
  leads_this_week: number;
  leads_delta_pct: number;
  deals_won_this_week: number;
  deals_won_delta: number;
  pipeline_value: number;
  messages_count: number;
}

export function DashboardWeeklyInsight() {
  const [insight, setInsight] = useState<WeeklyAiInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsight = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getWeeklyInsight();
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setInsight(res.data);
      }
    } catch {
      setError(t('dashboard.error.generic') || 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateWeeklyInsight();
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setInsight(res.data);
      }
    } catch {
      setError(t('dashboard.error.generic') || 'Une erreur est survenue.');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    void fetchInsight();
  }, [fetchInsight]);

  // Parse les métriques JSON
  let metrics: InsightMetrics | null = null;
  if (insight?.metric_changes_json) {
    try {
      metrics = JSON.parse(insight.metric_changes_json) as InsightMetrics;
    } catch {
      // Silencieux — les métriques sont optionnelles
    }
  }

  if (loading) {
    return (
      <div className="surface-card p-6 mb-6 animate-fade-in-up stagger-2">
        <div className="flex items-center justify-between mb-4">
          <div className="skeleton-shimmer h-6 w-48 rounded" />
          <div className="skeleton-shimmer h-8 w-32 rounded" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-16 w-full rounded-lg" />
          ))}
        </div>
        <div className="skeleton-shimmer h-40 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="surface-card p-5 mb-6 animate-fade-in-up stagger-2">
      {/* Header avec bouton Générer */}
      <div
        className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <h3 className="text-section-title flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--primary)]" />
            {t('dashboard.page.widget_weekly_insight')}
          </h3>
          <p className="text-subtitle mt-0.5">
            {insight
              ? `${t('dashboard.weekly_insight.generated_on')} ${new Date(insight.created_at).toLocaleDateString('fr-CA', { dateStyle: 'long' })}`
              : t('dashboard.weekly_insight.no_data')}
          </p>
        </div>
        <button
          onClick={() => void handleGenerate()}
          disabled={generating}
          className={`h-9 px-4 rounded-lg text-xs font-semibold flex items-center gap-2 transition duration-200 cursor-pointer press-scale ${
            generating
              ? 'opacity-50 cursor-not-allowed bg-[var(--bg-subtle)] text-[var(--text-muted)]'
              : 'bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm hover:shadow'
          }`}
        >
          <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
          {generating ? t('dashboard.weekly_insight.generating') : t('dashboard.weekly_insight.generate')}
        </button>
      </div>

      {/* Message d'erreur */}
      {error && (
        <div
          className="p-3 rounded-lg mb-4 flex items-center gap-2 text-xs"
          style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
        >
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Métriques KPI mini */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricMini
            label={t('dashboard.weekly_insight.leads')}
            value={metrics.leads_this_week}
            delta={`${metrics.leads_delta_pct >= 0 ? '+' : ''}${metrics.leads_delta_pct}%`}
            isPositive={metrics.leads_delta_pct >= 0}
          />
          <MetricMini
            label={t('dashboard.weekly_insight.deals')}
            value={metrics.deals_won_this_week}
            delta={metrics.deals_won_delta !== 0 ? `${metrics.deals_won_delta >= 0 ? '+' : ''}${metrics.deals_won_delta}` : undefined}
            isPositive={metrics.deals_won_delta >= 0}
          />
          <MetricMini
            label={t('dashboard.weekly_insight.pipeline_val')}
            value={`${(metrics.pipeline_value / 1000).toFixed(1)}K $`}
          />
          <MetricMini
            label={t('dashboard.weekly_insight.messages')}
            value={metrics.messages_count}
          />
        </div>
      )}

      {/* Contenu IA markdown */}
      {insight ? (
        <div
          className="prose prose-sm max-w-none prose-headings:font-bold prose-headings:text-[var(--text-primary)] text-sm leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {insight.content}
          </ReactMarkdown>
        </div>
      ) : (
        !loading && !generating && (
          <div className="empty-state-premium">
            <div className="empty-state-premium-icon">
              <Sparkles size={20} />
            </div>
            <p className="empty-state-premium-title">
              {t('dashboard.weekly_insight.click_generate')}
            </p>
            <button
              onClick={() => void handleGenerate()}
              className="mt-4 h-8 px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition duration-200 cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] press-scale"
            >
              <Sparkles size={12} />
              {t('dashboard.weekly_insight.generate_first')}
            </button>
          </div>
        )
      )}
    </div>
  );
}

// ── Mini métrique pour le widget IA ─────────────────────────
function MetricMini({
  label,
  value,
  delta,
  isPositive,
}: {
  label: string;
  value: number | string;
  delta?: string;
  isPositive?: boolean;
}) {
  return (
    <div className="surface-inset p-3.5">
      <div className="text-meta-label mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-[var(--text-primary)]">
          {value}
        </span>
        {delta && (
          <span
            className={`stat-delta ${isPositive ? 'stat-delta-up' : 'stat-delta-down'}`}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}
