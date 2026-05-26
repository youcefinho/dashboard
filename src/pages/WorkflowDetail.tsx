// ── WorkflowDetail — Vue détaillée d'un workflow avec steps ─

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Tag, Skeleton, EmptyState, Tabs, TabsList, TabsTrigger, TabsContent, KpiStrip, Switch, Avatar, Icon, useConfirm } from '@/components/ui';
import type { KpiItem } from '@/components/ui';
import { getWorkflow, toggleWorkflow, getWorkflowExecLog } from '@/lib/api';
import type { Workflow, WorkflowStep, WorkflowEnrollment, TriggerType, StepType, EnrollmentStatus, ExecLogEntry } from '@/lib/types';
import { TRIGGER_LABELS, TRIGGER_ICONS, STEP_TYPE_LABELS, STEP_TYPE_ICONS, ENROLLMENT_STATUS_LABELS } from '@/lib/types';
import { Activity, Settings, Users, GitMerge } from 'lucide-react';
import { t } from '@/lib/i18n';

type WorkflowWithDetails = Workflow & { steps: WorkflowStep[]; enrollments: WorkflowEnrollment[] };
type TabType = 'sequence' | 'config' | 'enrollments' | 'analytics';

export function WorkflowDetailPage() {
  const { workflowId } = useParams({ strict: false }) as { workflowId: string };
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [workflow, setWorkflow] = useState<WorkflowWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('sequence');
  // ── Journal d'exécution (LOT AUTOMATION BUILDER — wf_log.*) ──────────────
  const [execLog, setExecLog] = useState<ExecLogEntry[]>([]);
  const [execLogLoaded, setExecLogLoaded] = useState(false);
  const [execLogError, setExecLogError] = useState<string | null>(null);

  const loadWorkflow = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const result = await getWorkflow(workflowId);
    if (result.data) {
      setWorkflow(result.data);
    } else if (result.error) {
      setLoadError(result.error || t('wf_detail.error_load'));
    }
    setIsLoading(false);
  }, [workflowId]);

  useEffect(() => {
    void loadWorkflow();
  }, [loadWorkflow]);

  // Charge le journal d'exécution à la première ouverture de l'onglet analytics.
  const loadExecLog = useCallback(async () => {
    setExecLogError(null);
    const r = await getWorkflowExecLog(workflowId);
    if (r.data) {
      setExecLog(r.data);
    } else if (r.error) {
      setExecLogError(r.error || t('wf_log.error_load'));
    }
    setExecLogLoaded(true);
  }, [workflowId]);

  useEffect(() => {
    if (activeTab !== 'analytics' || execLogLoaded) return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadExecLog();
    })();
    return () => { cancelled = true; };
  }, [activeTab, execLogLoaded, loadExecLog]);

  const handleToggle = async () => {
    if (!workflow) return;
    // Confirmer la désactivation (action sensible : arrête les enrôlements actifs)
    if (workflow.is_active) {
      const ok = await confirm({
        title: t('wf_detail.confirm.deactivate_title'),
        description: t('wf_detail.confirm.deactivate_desc', { name: workflow.name }),
        confirmLabel: t('wf_detail.confirm.deactivate_cta'),
        danger: true,
      });
      if (!ok) return;
    }
    await toggleWorkflow(workflow.id, workflow.is_active === 0);
    void loadWorkflow();
  };

  const formatDelay = (minutes: number): string => {
    if (minutes < 60) return t('wf_detail.delay.min', { n: minutes });
    if (minutes < 1440) return t('wf_detail.delay.hours', { n: Math.round(minutes / 60) });
    return t('wf_detail.delay.days', { n: Math.round(minutes / 1440) });
  };

  const parseConfig = (configStr: string): Record<string, unknown> => {
    try { return JSON.parse(configStr) as Record<string, unknown>; }
    catch { return {}; }
  };

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr + 'Z').getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('wf_detail.time.now');
    if (diffMin < 60) return t('wf_detail.time.min_ago', { n: diffMin });
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return t('wf_detail.time.hours_ago', { n: diffH });
    return t('wf_detail.time.days_ago', { n: Math.floor(diffH / 24) });
  };

  if (isLoading) {
    return (
      <AppLayout title={t('wf_detail.page.title')}>
        <div className="max-w-4xl space-y-4" aria-busy="true" aria-live="polite">
          {/* Hero : titre + meta */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
          </Card>
          {/* 3 KPI inline */}
          <div className="flex gap-3">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-20 flex-1 rounded-2xl" />)}
          </div>
          {/* Table enrollments 5 rows */}
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
              <Skeleton className="h-4 w-40" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)] last:border-0">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (loadError) {
    return (
      <AppLayout title={t('wf_detail.error_load')}>
        <EmptyState
          icon={<Icon as={Activity} size={40} />}
          title={t('wf_detail.error_load')}
          description={t('wf_detail.error_load_desc')}
          action={
            <div className="flex gap-2 flex-wrap justify-center">
              <Button variant="primary" onClick={() => void loadWorkflow()}>{t('wf_detail.error_retry')}</Button>
              <Button variant="secondary" onClick={() => void navigate({ to: '/workflows' })}>{t('wf_detail.return')}</Button>
            </div>
          }
        />
      </AppLayout>
    );
  }

  if (!workflow) {
    return (
      <AppLayout title={t('wf_detail.not_found')}>
        <EmptyState title={t('wf_detail.not_found')} description={t('wf_detail.not_found_desc')}
          action={<Button onClick={() => void navigate({ to: '/workflows' })}>{t('wf_detail.return')}</Button>} />
      </AppLayout>
    );
  }

  const steps = workflow.steps || [];
  const enrollments = workflow.enrollments || [];

  // Analytics KpiStrip items (Sprint 23 wave 37)
  const analyticsKpis: KpiItem[] = useMemo(() => [
    { label: t('wf_detail.kpi.total'), value: enrollments.length, color: 'brand' },
    { label: t('wf_detail.kpi.active'), value: enrollments.filter(e => e.status === 'active').length, color: 'success' },
    { label: t('wf_detail.kpi.completed'), value: enrollments.filter(e => e.status === 'completed').length, color: 'info' },
  ], [enrollments]);

  // ── Métriques par step depuis le journal d'exécution (drop-off + conversion).
  // executed/skipped/failed comptés par step_id. Drop-off = part des entrants
  // qui n'atteignent PAS le step suivant ; conversion globale = part des
  // enrôlés ayant atteint le DERNIER step exécuté.
  const stepMetrics = useMemo(() => {
    const byStep = new Map<string, { executed: number; skipped: number; failed: number }>();
    for (const e of execLog) {
      const sid = e.step_id || '';
      if (!sid) continue;
      const m = byStep.get(sid) || { executed: 0, skipped: 0, failed: 0 };
      if (e.status === 'executed') m.executed += 1;
      else if (e.status === 'skipped') m.skipped += 1;
      else if (e.status === 'failed') m.failed += 1;
      byStep.set(sid, m);
    }
    const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
    const rows = ordered.map((s) => {
      const m = byStep.get(s.id) || { executed: 0, skipped: 0, failed: 0 };
      return { step: s, reached: m.executed + m.skipped + m.failed, ...m };
    });
    // Drop-off entre un step et le suivant (sur la base des "reached").
    const withDrop = rows.map((r, i) => {
      const next = rows[i + 1];
      const dropoff = next && r.reached > 0 ? Math.max(0, Math.round((1 - next.reached / r.reached) * 100)) : 0;
      return { ...r, dropoff };
    });
    const firstReached = withDrop[0]?.reached ?? 0;
    const lastReached = withDrop[withDrop.length - 1]?.reached ?? 0;
    const conversion = firstReached > 0 ? Math.round((lastReached / firstReached) * 100) : 0;
    return { rows: withDrop, conversion };
  }, [execLog, steps]);

  const fmtExecAt = (s: string): string => {
    try { return new Date(s.includes('Z') ? s : s + 'Z').toLocaleString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return s; }
  };
  const statusVariant = (st: string): 'success' | 'warning' | 'danger' | 'neutral' =>
    st === 'executed' ? 'success' : st === 'skipped' ? 'warning' : st === 'failed' ? 'danger' : 'neutral';

  return (
    <AppLayout title={workflow.name}>
      <button onClick={() => void navigate({ to: '/workflows' })}
        className="text-sm text-[var(--text-muted)] hover:text-[var(--primary)] mb-4 flex items-center gap-1 cursor-pointer">
        {t('wf_detail.back')}
      </button>

      <div className="print-builder-snapshot grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-5xl">
        {/* Colonne principale — Steps visuels */}
        <div className="lg:col-span-2 space-y-4">
          {/* En-tête */}
          <Card className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold">{workflow.name}</h2>
                <p className="text-sm text-[var(--text-muted)] mt-1">{workflow.description}</p>
              </div>
              <Switch
                checked={!!workflow.is_active}
                onCheckedChange={() => void handleToggle()}
                variant="success"
                size="md"
                aria-label={t(workflow.is_active ? 'wf_detail.toggle.deactivate_aria' : 'wf_detail.toggle.activate_aria', { name: workflow.name })}
              />
            </div>

            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
              <span className="text-lg">{TRIGGER_ICONS[workflow.trigger_type as TriggerType] || '⚡'}</span>
              <span className="text-sm font-medium">
                {t('wf_detail.trigger')} : <strong>{TRIGGER_LABELS[workflow.trigger_type as TriggerType]}</strong>
              </span>
              {workflow.trigger_config && workflow.trigger_config !== '{}' && (
                <span className="text-xs text-[var(--text-muted)] ml-2">
                  ({workflow.trigger_config})
                </span>
              )}
            </div>
          </Card>

          {/* ── Tabs primitive (Sprint 23 wave 37) ── */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)}>
            <TabsList className="overflow-x-auto hide-scrollbar">
              <TabsTrigger value="sequence"><Icon as={GitMerge} size={15} className="inline mr-2" />{t('wf_detail.tab.sequence')}</TabsTrigger>
              <TabsTrigger value="config"><Icon as={Settings} size={15} className="inline mr-2" />{t('wf_detail.tab.config')}</TabsTrigger>
              <TabsTrigger value="enrollments"><Icon as={Users} size={15} className="inline mr-2" />{t('wf_detail.tab.enrollments')}</TabsTrigger>
              <TabsTrigger value="analytics"><Icon as={Activity} size={15} className="inline mr-2" />{t('wf_detail.tab.analytics')}</TabsTrigger>
            </TabsList>

            <TabsContent value="sequence">
              <Card className="p-5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-semibold">{t('wf_detail.sequence_title', { n: steps.length })}</h3>
                  <Link to={`/workflows/${workflow.id}/edit`}>
                    <Button size="sm" variant="secondary">{t('wf_detail.edit')}</Button>
                  </Link>
                </div>
                {steps.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">{t('wf_detail.no_steps')}</p>
                ) : (
                  <div className="space-y-0">
                    {steps.sort((a, b) => a.step_order - b.step_order).map((step, i) => {
                      const config = parseConfig(step.config);
                      const isLast = i === steps.length - 1;
                      return (
                        <div key={step.id}>
                          <div className="flex items-start gap-3">
                            <div className="flex flex-col items-center">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                                step.step_type === 'wait'
                                  ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
                                  : step.step_type === 'condition'
                                    ? 'bg-[var(--info)]/15 text-[var(--info)]'
                                    : 'bg-[var(--primary)]/15 text-[var(--primary)]'
                              }`}>
                                {STEP_TYPE_ICONS[step.step_type as StepType] || '•'}
                              </div>
                              {!isLast && (
                                <div className="w-0.5 h-8 bg-[var(--border-subtle)]" />
                              )}
                            </div>
                            <div className="flex-1 pb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-[var(--text-muted)]">#{step.step_order}</span>
                                <span className="text-sm font-medium">{STEP_TYPE_LABELS[step.step_type as StepType]}</span>
                              </div>
                              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                {step.step_type === 'wait' && `⏳ Attendre ${formatDelay(Number(config.delay_minutes || 0))}`}
                                {step.step_type === 'send_email' && `📧 Template : ${String(config.template_id || '')}`}
                                {step.step_type === 'send_sms' && `💬 « ${String(config.message || '').slice(0, 60)}... »`}
                                {step.step_type === 'add_tag' && `🏷️ Tag : ${String(config.tag || '')}`}
                                {step.step_type === 'remove_tag' && `🏷️ Retirer : ${String(config.tag || '')}`}
                                {step.step_type === 'change_status' && `🔄 → ${String(config.status || '')}`}
                                {step.step_type === 'notify' && `🔔 « ${String(config.message || '').slice(0, 80)}... »`}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="config">
              <Card className="p-5 space-y-4">
                <h3 className="text-sm font-semibold">{t('wf_detail.config_title')}</h3>
                <div className="bg-[var(--bg-subtle)] p-4 rounded-[var(--radius-md)] text-sm">
                  <p><span className="text-[var(--text-muted)]">{t('wf_detail.config.type')}:</span> {TRIGGER_LABELS[workflow.trigger_type as TriggerType]}</p>
                  <p className="mt-2"><span className="text-[var(--text-muted)]">{t('wf_detail.config.filter_json')}:</span></p>
                  <pre className="mt-1 p-2 bg-[var(--bg-surface)] rounded text-xs overflow-x-auto text-[var(--text-primary)]">
                    {workflow.trigger_config || '{}'}
                  </pre>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="enrollments">
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-4">{t('wf_detail.enrollments_title', { n: enrollments.length })}</h3>
                {enrollments.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">{t('wf_detail.no_enrolled')}</p>
                ) : (
                  <div className="rounded-lg overflow-hidden border border-[var(--border-subtle)]">
                    <div className="grid grid-cols-[1fr_140px_120px] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)] px-3 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)]">
                      <span>{t('common.lead')}</span>
                      <span>{t('common.enrolled_on')}</span>
                      <span>{t('wf_detail.col.status')}</span>
                    </div>
                    {enrollments.map((enr, idx) => (
                      <div
                        key={enr.id}
                        className="row-premium grid grid-cols-[1fr_140px_120px] items-center px-3 py-2.5 text-sm list-item-enter"
                        style={{ animationDelay: `${Math.min(idx * 30, 240)}ms` }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar name={enr.lead_name || enr.lead_id} size="sm" />
                          <span className="font-medium truncate">{enr.lead_name || enr.lead_id}</span>
                        </div>
                        <span className="text-[var(--text-muted)] text-xs" title={new Date(enr.enrolled_at + 'Z').toLocaleString('fr-CA')}>{timeAgo(enr.enrolled_at)}</span>
                        <span>
                          <Tag dot size="sm" variant={
                            enr.status === 'active' ? 'success' :
                            enr.status === 'completed' ? 'info' : 'neutral'
                          }>
                            {ENROLLMENT_STATUS_LABELS[enr.status as EnrollmentStatus]}
                          </Tag>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="analytics">
              <Card className="p-5 space-y-5">
                <h3 className="text-sm font-semibold">{t('wf_detail.perf')}</h3>
                <KpiStrip items={analyticsKpis} />

                {!execLogLoaded ? (
                  <div className="space-y-2" aria-busy="true" aria-live="polite">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-md" />)}
                  </div>
                ) : execLogError ? (
                  <div className="flex items-center justify-between gap-3 px-3 py-3 rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)]">
                    <span className="text-sm text-[var(--danger)]">{t('wf_log.error_load')}</span>
                    <Button size="sm" variant="secondary" onClick={() => { setExecLogLoaded(false); void loadExecLog(); }}>
                      {t('wf_log.retry')}
                    </Button>
                  </div>
                ) : execLog.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">{t('wf_log.empty')}</p>
                ) : (
                  <>
                    {/* Conversion globale */}
                    <div className="flex items-center gap-3 px-3 py-2 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
                      <span className="text-xs text-[var(--text-muted)]">{t('wf_log.conversion')}</span>
                      <strong className="text-sm text-[var(--success)]">{stepMetrics.conversion}%</strong>
                    </div>

                    {/* Drop-off par step */}
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)] mb-2">{t('wf_log.dropoff')}</h4>
                      <div className="space-y-2">
                        {stepMetrics.rows.map((r) => (
                          <div key={r.step.id} className="flex items-center gap-2 text-xs">
                            <span className="w-6 h-6 rounded-full bg-[var(--brand-tint)] text-[var(--primary)] text-[10px] font-bold flex items-center justify-center shrink-0">
                              {STEP_TYPE_ICONS[r.step.step_type as StepType] || '•'}
                            </span>
                            <span className="flex-1 truncate">{STEP_TYPE_LABELS[r.step.step_type as StepType]}</span>
                            <span className="text-[var(--text-muted)]" title="executed / skipped / failed">
                              {r.executed}/{r.skipped}/{r.failed}
                            </span>
                            <div className="w-20 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
                              <div className="h-full bg-[var(--danger)]" style={{ width: `${r.dropoff}%` }} />
                            </div>
                            <span className="w-9 text-right text-[var(--text-secondary)]">{r.dropoff}%</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Timeline d'exécution (wf_log.*) */}
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)] mb-2">{t('wf_log.title')}</h4>
                      <div className="rounded-lg overflow-hidden border border-[var(--border-subtle)]">
                        <div className="grid grid-cols-[1fr_90px_120px] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)] px-3 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)]">
                          <span>{t('wf_log.step')}</span>
                          <span>{t('wf_log.status')}</span>
                          <span>{t('wf_log.executed_at')}</span>
                        </div>
                        {execLog.slice(0, 50).map((e, idx) => (
                          <div key={e.id ?? idx} className="grid grid-cols-[1fr_90px_120px] items-center px-3 py-2 text-xs border-b border-[var(--border-subtle)] last:border-0">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="leading-none">{STEP_TYPE_ICONS[e.step_type as StepType] || '•'}</span>
                              <span className="truncate">{e.step_type ? (STEP_TYPE_LABELS[e.step_type as StepType] || e.step_type) : (e.step_id || '—')}</span>
                            </span>
                            <span><Tag dot size="xs" variant={statusVariant(e.status)}>{e.status}</Tag></span>
                            <span className="text-[var(--text-muted)]">{fmtExecAt(e.executed_at)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Colonne latérale */}
        <div className="space-y-4">
          {/* Stats */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('wf_detail.stats')}</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">{t('wf_detail.stats.status')}</span>
                <Tag dot size="sm" variant={workflow.is_active ? 'success' : 'neutral'}>
                  {workflow.is_active ? t('wf_detail.stats.active') : t('wf_detail.stats.inactive')}
                </Tag>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">{t('wf_detail.stats.steps')}</span>
                <span className="font-medium">{steps.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">{t('wf_detail.stats.enrolled')}</span>
                <span className="font-medium">{enrollments.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">{t('wf_detail.kpi.active')}</span>
                <span className="font-medium text-[var(--success)]">
                  {enrollments.filter(e => e.status === 'active').length}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">{t('wf_detail.kpi.completed')}</span>
                <span className="font-medium">
                  {enrollments.filter(e => e.status === 'completed').length}
                </span>
              </div>
            </div>
          </Card>

          {/* Enrollments overview removed from sidebar, moved to tab */}

          {/* Infos */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('wf_detail.infos')}</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">{t('wf_detail.infos.created')}</span>
                <span>{new Date(workflow.created_at).toLocaleDateString('fr-CA')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">{t('wf_detail.infos.scope')}</span>
                <span>{workflow.client_id ? t('wf_detail.infos.scope_client') : t('wf_detail.infos.scope_global')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">{t('wf_detail.infos.id')}</span>
                <span className="font-mono truncate ml-2" title={workflow.id}>{workflow.id.slice(0, 12)}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
