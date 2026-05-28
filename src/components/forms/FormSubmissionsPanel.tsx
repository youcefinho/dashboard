// ── FormSubmissionsPanel — surface les soumissions + analytics par champ ─────
// Manager-C (additif). Ouvert depuis Forms.tsx via une action « Voir les
// soumissions ». Deux onglets :
//   • Soumissions  → getFormSubmissions(formId) — liste/table générique.
//   • Analytics    → getFormFieldAnalytics(formId) — complétion / abandon /champ.
// Helpers api FIGÉS consommés tels quels. i18n t('formsx.*'). loading
// (aria-busy) / vide / erreur (role=alert). Style Stripe sobre, primitives
// existantes (@/components/ui). 100% additif — ne touche pas au CRUD existant.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SlidePanel,
  Button,
  Skeleton,
  EmptyState,
  Icon,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui';
import { Inbox, BarChart3 } from 'lucide-react';
import { getFormSubmissions, getFormFieldAnalytics } from '@/lib/api';
import type { FormFieldAnalyticsRow } from '@/lib/types';
import { t, getLocale } from '@/lib/i18n';
import { formatDateTime } from '@/lib/i18n/datetime';

interface FormSubmissionsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  formName: string;
}

// Clés de métadonnées connues — affichées à part de la charge utile (payload).
const META_KEYS = new Set([
  'id',
  'form_id',
  'client_id',
  'created_at',
  'updated_at',
  'ip',
  'ip_address',
  'user_agent',
]);

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

// Rend une valeur arbitraire de champ en string lisible (objets → JSON).
function renderValue(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// Extrait la charge utile (réponses au formulaire) d'une soumission, en
// gérant le cas où elle est imbriquée sous `data`/`payload`/`fields` (string
// JSON ou objet) ou aplatie à la racine (hors clés de métadonnées).
function extractPayload(sub: Record<string, unknown>): Array<[string, unknown]> {
  const nestedKey = ['data', 'payload', 'fields', 'answers'].find(
    k => sub[k] != null,
  );
  let payload: Record<string, unknown> | null = null;
  if (nestedKey) {
    const raw = sub[nestedKey];
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
      } catch {
        payload = null;
      }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      payload = raw as Record<string, unknown>;
    }
  }
  if (!payload) {
    payload = Object.fromEntries(
      Object.entries(sub).filter(([k]) => !META_KEYS.has(k)),
    );
  }
  return Object.entries(payload);
}

function getCreatedAt(sub: Record<string, unknown>): string | null {
  const raw = sub.created_at ?? sub.createdAt ?? sub.submitted_at;
  return raw == null ? null : String(raw);
}

function analyticsIntent(rate: number): 'success' | 'warning' | 'danger' {
  if (rate >= 50) return 'danger';
  if (rate >= 20) return 'warning';
  return 'success';
}

export function FormSubmissionsPanel({
  open,
  onOpenChange,
  formId,
  formName,
}: FormSubmissionsPanelProps) {
  const locale = getLocale();

  const [submissions, setSubmissions] = useState<Array<Record<string, unknown>>>([]);
  const [subLoading, setSubLoading] = useState(true);
  const [subError, setSubError] = useState<string | null>(null);

  const [analytics, setAnalytics] = useState<FormFieldAnalyticsRow[]>([]);
  const [anLoading, setAnLoading] = useState(true);
  const [anError, setAnError] = useState<string | null>(null);

  const loadSubmissions = useCallback(async () => {
    if (!formId) return;
    setSubLoading(true);
    setSubError(null);
    try {
      const res = await getFormSubmissions(formId);
      if (res.data) setSubmissions(Array.isArray(res.data) ? res.data : []);
      else {
        setSubmissions([]);
        setSubError(res.error || t('common.loading_error'));
      }
    } catch {
      setSubmissions([]);
      setSubError(t('common.loading_error'));
    } finally {
      setSubLoading(false);
    }
  }, [formId]);

  const loadAnalytics = useCallback(async () => {
    if (!formId) return;
    setAnLoading(true);
    setAnError(null);
    try {
      const res = await getFormFieldAnalytics(formId);
      if (res.data) setAnalytics(Array.isArray(res.data) ? res.data : []);
      else {
        setAnalytics([]);
        setAnError(res.error || t('common.loading_error'));
      }
    } catch {
      setAnalytics([]);
      setAnError(t('common.loading_error'));
    } finally {
      setAnLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    if (open) {
      void loadSubmissions();
      void loadAnalytics();
    }
  }, [open, loadSubmissions, loadAnalytics]);

  // Colonnes dynamiques : union des clés de payload sur les soumissions chargées.
  const columns = useMemo(() => {
    const seen: string[] = [];
    const set = new Set<string>();
    for (const sub of submissions) {
      for (const [k] of extractPayload(sub)) {
        if (!set.has(k)) {
          set.add(k);
          seen.push(k);
        }
      }
    }
    return seen.slice(0, 8); // garde la table lisible
  }, [submissions]);

  return (
    <SlidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={t('formsx.panel_title', { name: formName })}
      description={t('formsx.panel_desc')}
      size="xl"
      closeLabel={t('action.close')}
    >
      <Tabs defaultValue="submissions">
        <TabsList>
          <TabsTrigger value="submissions">
            <span className="inline-flex items-center gap-2">
              <Icon as={Inbox} size="sm" aria-hidden="true" />
              {t('formsx.tab_submissions')}
            </span>
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <span className="inline-flex items-center gap-2">
              <Icon as={BarChart3} size="sm" aria-hidden="true" />
              {t('formsx.tab_analytics')}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* ── Onglet Soumissions ─────────────────────────────── */}
        <TabsContent value="submissions">
          {subLoading ? (
            <div aria-busy="true" aria-live="polite" className="space-y-3">
              <span className="sr-only">{t('common.loading')}</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-1/4" />
                </div>
              ))}
            </div>
          ) : subError ? (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t('common.loading_error')}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{subError}</p>
              <Button variant="secondary" size="sm" onClick={() => void loadSubmissions()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : submissions.length === 0 ? (
            <EmptyState
              icon={<Icon as={Inbox} size={40} />}
              title={t('formsx.submissions_empty')}
              description={t('formsx.submissions_empty_desc')}
            />
          ) : (
            <div className="overflow-x-auto">
              <p className="text-xs text-[var(--text-muted)] mb-3">
                {t('formsx.submissions_count', { count: submissions.length })}
              </p>
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {t('formsx.submissions_caption', { name: formName })}
                </caption>
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                    <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      {t('formsx.col_date')}
                    </th>
                    {columns.map(c => (
                      <th key={c} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((sub, i) => {
                    const created = getCreatedAt(sub);
                    const payload = Object.fromEntries(extractPayload(sub));
                    const key = String(sub.id ?? i);
                    return (
                      <tr
                        key={key}
                        className="border-b border-[var(--border-subtle)] last:border-0 align-top"
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">
                          {created ? formatDateTime(created, locale, DATE_OPTS) : '—'}
                        </td>
                        {columns.map(c => (
                          <td key={c} className="px-3 py-2 text-[var(--text-primary)] max-w-[220px] truncate">
                            {renderValue(payload[c])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Onglet Analytics par champ ─────────────────────── */}
        <TabsContent value="analytics">
          {anLoading ? (
            <div aria-busy="true" aria-live="polite" className="space-y-3">
              <span className="sr-only">{t('common.loading')}</span>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : anError ? (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t('common.loading_error')}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{anError}</p>
              <Button variant="secondary" size="sm" onClick={() => void loadAnalytics()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : analytics.length === 0 ? (
            <EmptyState
              icon={<Icon as={BarChart3} size={40} />}
              title={t('formsx.analytics_empty')}
              description={t('formsx.analytics_empty_desc')}
            />
          ) : (
            <div className="overflow-x-auto">
              <p className="text-xs text-[var(--text-muted)] mb-3">
                {t('formsx.analytics_hint')}
              </p>
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {t('formsx.analytics_caption', { name: formName })}
                </caption>
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                    <th scope="col" className="px-3 py-2 font-medium">{t('formsx.col_field')}</th>
                    <th scope="col" className="px-3 py-2 font-medium text-right">{t('formsx.col_reached')}</th>
                    <th scope="col" className="px-3 py-2 font-medium text-right">{t('formsx.col_completed')}</th>
                    <th scope="col" className="px-3 py-2 font-medium text-right">{t('formsx.col_dropoff')}</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.map((row, i) => {
                    const rawRate = Number(row.dropoff_rate ?? 0);
                    const rate = Number.isFinite(rawRate) ? rawRate : 0;
                    const fieldName = row.field_name || `field_${i}`;
                    return (
                      <tr
                        key={fieldName}
                        className="border-b border-[var(--border-subtle)] last:border-0"
                      >
                        <td className="px-3 py-2 font-medium text-[var(--text-primary)]">
                          {row.field_name || '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--text-secondary)]">
                          {Number(row.reached ?? 0).toLocaleString(locale)}
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--text-secondary)]">
                          {Number(row.completed ?? 0).toLocaleString(locale)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Badge intent={analyticsIntent(rate)} fill="soft" size="sm">
                            {rate.toFixed(1)}%
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </SlidePanel>
  );
}
