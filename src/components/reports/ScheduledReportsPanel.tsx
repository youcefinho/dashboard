// ── ScheduledReportsPanel — Onglet « Planifiés » de Reports.tsx ─────────────
// LOT SCHEDREPORT Sprint A — Phase B Manager-C (front exclusif).
// Liste + créer / éditer / pause-resume / supprimer des rapports planifiés.
// Helpers + type + clés i18n posés en Phase A (api.ts / reports.scheduled.*).
// SUBTLE Stripe-grade : réutilise Card / Tag / Button / Input / Select /
// SlidePanel / EmptyState. ApiResponse INCHANGÉ → string-match sur `error`.

import { useState, useEffect, useCallback } from 'react';
import {
  Card, Tag, Button, Input, Select, SlidePanel,
  EmptyState, EmptyStateIllustration, Skeleton,
  useToast, useConfirm, Icon,
} from '@/components/ui';
import {
  getScheduledReports, createScheduledReport, updateScheduledReport,
  deleteScheduledReport, type ScheduledReportRecord,
  getDashboards, type DashboardRecord,
} from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';
import { Plus, Pause, Play, Trash2, Mail, Users } from 'lucide-react';

// Cadence labels via i18n (Phase A : cadence_weekly / cadence_monthly).
function cadenceLabel(cadence: string): string {
  return cadence === 'monthly'
    ? t('reports.scheduled.cadence_monthly')
    : t('reports.scheduled.cadence_weekly');
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return formatDate(d, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

// Parse une saisie « a@x.com, b@y.com » → array nettoyée.
function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,\n;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

interface FormState {
  name: string;
  cadence: 'weekly' | 'monthly';
  recipients: string;
  day_of_week: number;   // 1 = lundi … 7 = dimanche (utilisé si weekly)
  day_of_month: number;  // 1..28 (utilisé si monthly)
  // LOT REPORT-TEMPLATES (Sprint 15) — dashboard à planifier. '' = aucun
  // (rétro-compat : digest d'activité générique inchangé côté cron Manager-B).
  dashboard_id: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  cadence: 'weekly',
  recipients: '',
  day_of_week: 1,
  day_of_month: 1,
  dashboard_id: '',
};

export function ScheduledReportsPanel() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState<ScheduledReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  // LOT REPORT-TEMPLATES (Sprint 15) — dashboards disponibles pour le sélecteur.
  const [dashboards, setDashboards] = useState<DashboardRecord[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getScheduledReports();
    if (res.data) setItems(res.data);
    setLoading(false);
  }, []);

  // Best-effort : la liste alimente le sélecteur de dashboard à planifier.
  // Données absentes / erreur ⇒ liste vide (le sélecteur reste sur « aucun »).
  const loadDashboards = useCallback(async () => {
    const res = await getDashboards();
    if (res.data) setDashboards(res.data);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadDashboards(); }, [loadDashboards]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setPanelOpen(true);
  };

  const handleCreate = async () => {
    const recipients = parseRecipients(form.recipients);
    if (!form.name.trim() || recipients.length === 0) {
      toastError(t('reports.toast.create_error'));
      return;
    }
    setSubmitting(true);
    // LOT REPORT-TEMPLATES (Sprint 15) — dashboard_id : '' ⇒ null (rétro-compat,
    // digest d'activité générique). Sinon le cron rend ce dashboard (Manager-B).
    const dashboardId = form.dashboard_id ? Number(form.dashboard_id) : null;
    const res = await createScheduledReport({
      name: form.name.trim(),
      report_kind: 'summary',
      cadence: form.cadence,
      recipients,
      day_of_week: form.cadence === 'weekly' ? form.day_of_week : null,
      day_of_month: form.cadence === 'monthly' ? form.day_of_month : null,
      dashboard_id: dashboardId,
      format: 'html',
    });
    setSubmitting(false);
    if (res.data) {
      success(t('reports.toast.created'));
      setPanelOpen(false);
      void load();
    } else {
      toastError(t('reports.toast.create_error'));
    }
  };

  // LOT REPORT-TEMPLATES (Sprint 15) — retargeter le dashboard d'un rapport
  // existant via le PATCH existant. '' ⇒ null (retour au digest d'activité).
  const handleChangeDashboard = async (rec: ScheduledReportRecord, raw: string) => {
    const dashboardId = raw ? Number(raw) : null;
    const res = await updateScheduledReport(rec.id, { dashboard_id: dashboardId });
    if (res.data) {
      success(t('reports.toast.saved'));
      void load();
    } else {
      toastError(t('reports.toast.save_error'));
    }
  };

  const handleToggleStatus = async (rec: ScheduledReportRecord) => {
    const nextStatus = rec.status === 'active' ? 'paused' : 'active';
    const res = await updateScheduledReport(rec.id, { status: nextStatus });
    if (res.data) {
      success(t('reports.toast.saved'));
      void load();
    } else {
      toastError(t('reports.toast.save_error'));
    }
  };

  const handleDelete = async (rec: ScheduledReportRecord) => {
    const confirmed = await confirm({
      title: t('reports.scheduled.delete'),
      description: rec.name || t('reports.scheduled.title'),
      confirmLabel: t('reports.scheduled.delete'),
      danger: true,
    });
    if (!confirmed) return;
    const res = await deleteScheduledReport(rec.id);
    if (res.data?.success) {
      success(t('reports.toast.deleted'));
      void load();
    } else {
      toastError(t('reports.toast.delete_error'));
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const formFooter = (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={() => setPanelOpen(false)} className="text-xs">
        {t('action.cancel')}
      </Button>
      <Button variant="primary" onClick={handleCreate} isLoading={submitting} className="text-xs gap-1.5">
        <Icon as={Plus} size={14} /> {t('reports.scheduled.create')}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Icon as={Mail} size={15} className="text-[var(--primary)]" />
          {t('reports.scheduled.title')}
        </h3>
        <Button variant="primary" onClick={openCreate} className="text-xs gap-1.5">
          <Icon as={Plus} size={14} /> {t('reports.scheduled.create')}
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-32 w-full rounded-2xl" />
      ) : items.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            variant="first-time"
            illustration={<EmptyStateIllustration kind="reports" size={160} />}
            title={t('reports.scheduled.empty')}
            description={t('reports.scheduled.title')}
          />
        </Card>
      ) : (
        <div className="sched-report-list">
          {items.map(rec => {
            const isActive = rec.status === 'active';
            return (
              <Card key={rec.id} className="sched-report-card">
                <div className="sched-report-card__head">
                  <h4 className="sched-report-card__title" title={rec.name || ''}>
                    {rec.name || t('reports.scheduled.title')}
                  </h4>
                  <Tag
                    size="sm"
                    variant={isActive ? 'success' : 'neutral'}
                    statusIcon
                  >
                    {isActive ? t('reports.scheduled.status_active') : t('reports.scheduled.status_paused')}
                  </Tag>
                </div>

                <div className="sched-report-card__meta">
                  <span className="sched-report-card__chip">
                    {cadenceLabel(rec.cadence)}
                  </span>
                  <span className="sched-report-card__chip inline-flex items-center gap-1">
                    <Icon as={Users} size={12} />
                    {rec.recipients.length} {t('reports.scheduled.recipients').toLowerCase()}
                  </span>
                </div>

                <dl className="sched-report-card__dates">
                  <div>
                    <dt>{t('reports.scheduled.next_run')}</dt>
                    <dd className="t-mono-num">{fmtDate(rec.next_run_at)}</dd>
                  </div>
                  <div>
                    <dt>{t('reports.scheduled.last_sent')}</dt>
                    <dd className="t-mono-num">{fmtDate(rec.last_sent_at)}</dd>
                  </div>
                </dl>

                {/* LOT REPORT-TEMPLATES (Sprint 15) — dashboard à planifier.
                    « — » (aucun) = digest d'activité générique (rétro-compat). */}
                <div className="mt-2 mb-3">
                  <Select
                    label={t('reports.scheduled.dashboard')}
                    value={rec.dashboard_id != null ? String(rec.dashboard_id) : ''}
                    onChange={e => handleChangeDashboard(rec, e.target.value)}
                  >
                    <option value="">—</option>
                    {dashboards.map(d => (
                      <option key={d.id} value={String(d.id)}>{d.name}</option>
                    ))}
                  </Select>
                </div>

                <div className="sched-report-card__actions">
                  <Button
                    variant="secondary"
                    onClick={() => handleToggleStatus(rec)}
                    className="text-xs gap-1.5"
                  >
                    <Icon as={isActive ? Pause : Play} size={13} />
                    {isActive ? t('reports.scheduled.pause') : t('reports.scheduled.resume')}
                  </Button>
                  <button
                    type="button"
                    className="sched-report-card__icon-btn sched-report-card__icon-btn--danger"
                    onClick={() => handleDelete(rec)}
                    aria-label={t('reports.scheduled.delete')}
                    title={t('reports.scheduled.delete')}
                  >
                    <Icon as={Trash2} size={14} />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Form de création */}
      <SlidePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title={t('reports.scheduled.create')}
        description={t('reports.scheduled.title')}
        size="md"
        footer={formFooter}
      >
        <div className="space-y-4">
          <Input
            label={t('reports.scheduled.title')}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder={t('reports.scheduled.title')}
          />

          <Select
            label={t('reports.scheduled.cadence_weekly') + ' / ' + t('reports.scheduled.cadence_monthly')}
            value={form.cadence}
            onChange={e => setForm(f => ({ ...f, cadence: e.target.value as 'weekly' | 'monthly' }))}
          >
            <option value="weekly">{t('reports.scheduled.cadence_weekly')}</option>
            <option value="monthly">{t('reports.scheduled.cadence_monthly')}</option>
          </Select>

          {form.cadence === 'weekly' ? (
            <Select
              label={t('reports.scheduled.next_run')}
              value={String(form.day_of_week)}
              onChange={e => setForm(f => ({ ...f, day_of_week: Number(e.target.value) }))}
            >
              <option value="1">{t('reports.scheduled.day_1')}</option>
              <option value="2">{t('reports.scheduled.day_2')}</option>
              <option value="3">{t('reports.scheduled.day_3')}</option>
              <option value="4">{t('reports.scheduled.day_4')}</option>
              <option value="5">{t('reports.scheduled.day_5')}</option>
              <option value="6">{t('reports.scheduled.day_6')}</option>
              <option value="7">{t('reports.scheduled.day_7')}</option>
            </Select>
          ) : (
            <Input
              type="number"
              min={1}
              max={28}
              label={t('reports.scheduled.next_run')}
              value={String(form.day_of_month)}
              onChange={e => setForm(f => ({
                ...f,
                day_of_month: Math.max(1, Math.min(28, Number(e.target.value) || 1)),
              }))}
            />
          )}

          <Input
            label={t('reports.scheduled.recipients')}
            value={form.recipients}
            onChange={e => setForm(f => ({ ...f, recipients: e.target.value }))}
            placeholder={t('reports.scheduled.recipients_placeholder')}
            helper={t('reports.scheduled.recipients_helper')}
          />

          {/* LOT REPORT-TEMPLATES (Sprint 15) — sélecteur de dashboard à planifier.
              « Aucun » (valeur vide) ⇒ digest d'activité générique (rétro-compat).
              Un dashboard choisi ⇒ le cron rendra ce dashboard (backend Manager-B). */}
          <Select
            label={t('reports.scheduled.dashboard')}
            value={form.dashboard_id}
            onChange={e => setForm(f => ({ ...f, dashboard_id: e.target.value }))}
          >
            <option value="">—</option>
            {dashboards.map(d => (
              <option key={d.id} value={String(d.id)}>{d.name}</option>
            ))}
          </Select>
        </div>
      </SlidePanel>
    </div>
  );
}
