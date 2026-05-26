// ── Sprint 24 — Observabilité : panneau alert rules (Manager-C remplissage) ──
//
// Liste des AlertRule[] + bouton "Créer" → modal form + toggle enabled inline +
// section "Déclenchements récents" (10 derniers alert_events).
//
// API : fetchAlerts / createAlertRule / updateAlertRule / deleteAlertRule
// (lib/api.ts FIGÉ Phase A). i18n : `alerts.*` (24 clés, FIGÉES Phase A).
// Validation client-side simple (name non vide, threshold ≥ 0, webhook → target
// non vide). Best-effort : si API échoue → fallback i18n alerts.error_not_found.

import { useCallback, useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { fetchAlerts, createAlertRule, updateAlertRule, deleteAlertRule } from '@/lib/api';
import type { AlertRule, AlertEvent, AlertConditionType, AlertChannel } from '@/lib/types';
import {
  Card,
  Button,
  Input,
  Select,
  Switch,
  EmptyState,
  Icon,
  Skeleton,
  Tag,
  Modal,
} from '@/components/ui';
import { Plus, Trash2, AlertTriangle, Bell, Activity } from 'lucide-react';

interface FormState {
  name: string;
  condition_type: AlertConditionType;
  metric_name: string;
  threshold: number;
  window_minutes: number;
  notification_channel: AlertChannel;
  notification_target: string;
  enabled: boolean;
}

function emptyForm(): FormState {
  return {
    name: '',
    condition_type: 'error_rate',
    metric_name: '',
    threshold: 0,
    window_minutes: 60,
    notification_channel: 'log',
    notification_target: '',
    enabled: true,
  };
}

export function AlertRulesPanel() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAlerts();
      if (res.error || !res.data) {
        setRules([]);
        setEvents([]);
        setError(res.error ?? t('alerts.error_not_found'));
      } else {
        setRules(res.data.rules ?? []);
        setEvents(res.data.events ?? []);
      }
    } catch {
      setRules([]);
      setEvents([]);
      setError(t('alerts.error_not_found'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const handleCreate = useCallback(async () => {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError(t('alerts.error_invalid'));
      return;
    }
    if (!Number.isFinite(form.threshold) || form.threshold < 0) {
      setFormError(t('alerts.error_invalid'));
      return;
    }
    if (!Number.isFinite(form.window_minutes) || form.window_minutes <= 0) {
      setFormError(t('alerts.error_invalid'));
      return;
    }
    if (form.notification_channel === 'webhook' && !form.notification_target.trim()) {
      setFormError(t('alerts.error_invalid'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await createAlertRule({
        name: form.name.trim(),
        condition_type: form.condition_type,
        metric_name: form.metric_name.trim() || null,
        threshold: form.threshold,
        window_minutes: form.window_minutes,
        notification_channel: form.notification_channel,
        notification_target: form.notification_target.trim(),
        enabled: form.enabled,
      });
      if (res.error) {
        setFormError(res.error);
        return;
      }
      setCreateOpen(false);
      setForm(emptyForm());
      await loadAlerts();
    } catch {
      setFormError(t('alerts.error_invalid'));
    } finally {
      setSubmitting(false);
    }
  }, [form, loadAlerts]);

  const handleToggle = useCallback(
    async (rule: AlertRule) => {
      // Optimistic update local pour feedback immédiat ; revalidation après.
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)),
      );
      await updateAlertRule(rule.id, { enabled: !rule.enabled });
      await loadAlerts();
    },
    [loadAlerts],
  );

  const handleDelete = useCallback(
    async (rule: AlertRule) => {
      // confirm() natif — pas de useConfirm() pour rester léger (compat tests).
      if (typeof window !== 'undefined' && !window.confirm(t('alerts.delete_confirm'))) return;
      await deleteAlertRule(rule.id);
      await loadAlerts();
    },
    [loadAlerts],
  );

  function conditionLabel(c: AlertConditionType): string {
    switch (c) {
      case 'error_rate': return t('alerts.condition_error_rate');
      case 'p95_latency': return t('alerts.condition_p95_latency');
      case 'web_vital_p75': return t('alerts.condition_web_vital_p75');
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Card : liste des règles ───────────────────────────── */}
      <Card className="p-6">
        <header className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h3 className="t-h3">{t('alerts.title')}</h3>
            {error && (
              <p className="t-caption text-[var(--danger)] mt-1">
                <Icon as={AlertTriangle} size={12} className="inline mr-1" />
                {error}
              </p>
            )}
          </div>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Icon as={Plus} size="sm" />}
            onClick={() => {
              setForm(emptyForm());
              setFormError(null);
              setCreateOpen(true);
            }}
          >
            {t('alerts.create')}
          </Button>
        </header>

        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={Bell} size={28} />}
            title={t('alerts.empty')}
            description={t('alerts.title')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="py-2 pr-3 font-medium">{t('alerts.name')}</th>
                  <th className="py-2 pr-3 font-medium">{t('alerts.condition_type')}</th>
                  <th className="py-2 pr-3 font-medium">{t('alerts.threshold')}</th>
                  <th className="py-2 pr-3 font-medium">{t('alerts.window_minutes')}</th>
                  <th className="py-2 pr-3 font-medium">{t('alerts.channel')}</th>
                  <th className="py-2 pr-3 font-medium">{t('alerts.enabled')}</th>
                  <th className="py-2 pr-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-t border-[var(--border-subtle)]"
                    data-testid={`alert-rule-row-${rule.id}`}
                  >
                    <td className="py-2 pr-3 font-medium text-[var(--text-primary)]">{rule.name}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">
                      {conditionLabel(rule.condition_type)}
                      {rule.metric_name ? (
                        <span className="ml-1 text-[var(--text-muted)] font-mono text-xs">
                          ({rule.metric_name})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{rule.threshold}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {rule.window_minutes} min
                    </td>
                    <td className="py-2 pr-3">
                      {rule.notification_channel === 'webhook'
                        ? t('alerts.channel_webhook')
                        : t('alerts.channel_log')}
                    </td>
                    <td className="py-2 pr-3">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={() => void handleToggle(rule)}
                        size="sm"
                        aria-label={`${t('alerts.enabled')} — ${rule.name}`}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Icon as={Trash2} size="sm" />}
                        onClick={() => void handleDelete(rule)}
                        aria-label={`${t('alerts.delete')} — ${rule.name}`}
                      >
                        {t('alerts.delete')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Card : déclenchements récents ──────────────────────── */}
      <Card className="p-6">
        <header className="flex items-center justify-between mb-4">
          <h3 className="t-h3">{t('alerts.events_title')}</h3>
        </header>
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={Activity} size={28} />}
            title={t('alerts.events_empty')}
          />
        ) : (
          <ul className="space-y-2">
            {events.slice(0, 10).map((ev) => {
              const isResolved = ev.resolved_at !== null;
              return (
                <li
                  key={ev.id}
                  className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-subtle)] last:border-b-0"
                  data-testid={`alert-event-${ev.id}`}
                >
                  <span className="text-sm font-mono text-[var(--text-secondary)] truncate">
                    {ev.rule_id}
                  </span>
                  <span className="flex items-center gap-3">
                    {isResolved ? (
                      <Tag variant="success" dot>
                        {t('alerts.events_resolved')}
                      </Tag>
                    ) : (
                      <Tag variant="danger" dot>
                        {t('alerts.events_firing')}
                      </Tag>
                    )}
                    <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                      {new Date(ev.triggered_at).toLocaleString()}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── Modal Create ───────────────────────────────────────── */}
      <Modal
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setFormError(null);
        }}
        title={t('alerts.create')}
        size="md"
      >
        <div className="space-y-3">
          <Input
            label={t('alerts.name')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="error_rate_alert"
          />

          <Select
            label={t('alerts.condition_type')}
            value={form.condition_type}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                condition_type: e.target.value as AlertConditionType,
                // Reset metric_name si on change de type (cohérence form).
                metric_name: '',
              }))
            }
          >
            <option value="error_rate">{t('alerts.condition_error_rate')}</option>
            <option value="p95_latency">{t('alerts.condition_p95_latency')}</option>
            <option value="web_vital_p75">{t('alerts.condition_web_vital_p75')}</option>
          </Select>

          {form.condition_type === 'web_vital_p75' && (
            <Select
              label={t('alerts.metric_name')}
              value={form.metric_name}
              onChange={(e) => setForm((f) => ({ ...f, metric_name: e.target.value }))}
            >
              <option value="">—</option>
              <option value="LCP">LCP</option>
              <option value="CLS">CLS</option>
              <option value="INP">INP</option>
              <option value="TTFB">TTFB</option>
              <option value="FCP">FCP</option>
            </Select>
          )}

          {form.condition_type === 'p95_latency' && (
            <Input
              label={t('alerts.metric_name')}
              value={form.metric_name}
              onChange={(e) => setForm((f) => ({ ...f, metric_name: e.target.value }))}
              placeholder="/api/leads"
            />
          )}

          <Input
            type="number"
            label={t('alerts.threshold')}
            value={String(form.threshold)}
            onChange={(e) =>
              setForm((f) => ({ ...f, threshold: parseFloat(e.target.value) || 0 }))
            }
          />

          <Input
            type="number"
            label={t('alerts.window_minutes')}
            value={String(form.window_minutes)}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                window_minutes: parseInt(e.target.value, 10) || 0,
              }))
            }
          />

          <Select
            label={t('alerts.channel')}
            value={form.notification_channel}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                notification_channel: e.target.value as AlertChannel,
              }))
            }
          >
            <option value="log">{t('alerts.channel_log')}</option>
            <option value="webhook">{t('alerts.channel_webhook')}</option>
          </Select>

          {form.notification_channel === 'webhook' && (
            <Input
              label={t('alerts.target_url')}
              value={form.notification_target}
              onChange={(e) =>
                setForm((f) => ({ ...f, notification_target: e.target.value }))
              }
              placeholder="https://..."
            />
          )}

          <div className="flex items-center gap-3 pt-2">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              size="sm"
              label={t('alerts.enabled')}
            />
          </div>

          {formError && (
            <p className="t-caption text-[var(--danger)]" role="alert">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleCreate()}
              isLoading={submitting}
            >
              {t('alerts.create')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
