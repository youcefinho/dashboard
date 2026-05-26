// ── Page Sequences — Séquences drip multi-touch (Sprint 5) ──────────────────
//
// Corps réel Phase C (Manager-C). Export FIGÉ `SequencesPage` (consommé par
// App.tsx route /sequences via lazy). La séquence = workflow is_sequence=1 ;
// l'édition se fait via une LISTE LINÉAIRE simple d'étapes alternant
// `send_email` (choix d'un modèle email existant) et `wait` (délai) — PAS le
// canvas @xyflow (volontaire : simple pour pros non-tech). Helpers api.ts
// FIGÉS Phase A consommés tels quels : getSequences / getSequence /
// createSequence / updateSequence / deleteSequence / enrollInSequence.
// Le contenu d'un courriel s'édite dans EmailBuilder EXISTANT (lien vers la
// route /templates/builder/$templateId — rien à recréer). i18n 100% `t('seq.*')`
// (clés figées Phase A, AUCUNE création). Discrimination erreur : présence de
// `res.data` / texte `res.error`, JAMAIS `res.code` (§6.A apiFetch gelé).

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button,
  Card,
  Tag,
  Icon,
  Modal,
  Input,
  Select,
  Textarea,
  Skeleton,
  EmptyState,
  Switch,
  useToast,
  useConfirm,
} from '@/components/ui';
import {
  Plus,
  Mail,
  Clock,
  Trash2,
  Pencil,
  UserPlus,
  ArrowUp,
  ArrowDown,
  GitBranch,
} from 'lucide-react';
import {
  getSequences,
  getSequence,
  getSequenceStats,
  createSequence,
  updateSequence,
  deleteSequence,
  enrollInSequence,
  getTemplates,
  getLeads,
} from '@/lib/api';
import type {
  Workflow,
  WorkflowStep,
  EmailTemplate,
  Lead,
  SequenceStats,
} from '@/lib/types';
import { t } from '@/lib/i18n';

// ── Modèle d'étape côté éditeur (UI). Le serveur stocke `config` en JSON
// string (WorkflowStep.config). On encode send_email → { template_id },
// wait → { minutes }. Le moteur EXISTANT (workflows.ts) lit déjà ce JSON.
type DraftStep =
  | { step_type: 'send_email'; template_id: string }
  | { step_type: 'wait'; minutes: number };

// Conversions minutes <-> (valeur, unité) pour une saisie non-tech.
const WAIT_UNITS: Array<{ key: 'minutes' | 'hours' | 'days'; factor: number }> = [
  { key: 'minutes', factor: 1 },
  { key: 'hours', factor: 60 },
  { key: 'days', factor: 1440 },
];

function splitWait(minutes: number): { value: number; unit: 'minutes' | 'hours' | 'days' } {
  for (const u of [...WAIT_UNITS].reverse()) {
    if (minutes >= u.factor && minutes % u.factor === 0) {
      return { value: minutes / u.factor, unit: u.key };
    }
  }
  return { value: minutes, unit: 'minutes' };
}

// Ratio 0..1 (§6.A) → pourcentage lisible (ex: 0.421 → "42.1 %").
function formatRate(rate: number): string {
  const r = Number.isFinite(rate) ? rate : 0;
  return `${(r * 100).toFixed(1)} %`;
}

function parseStepConfig(step: WorkflowStep): DraftStep | null {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = step.config ? (JSON.parse(step.config) as Record<string, unknown>) : {};
  } catch {
    cfg = {};
  }
  if (step.step_type === 'send_email') {
    return { step_type: 'send_email', template_id: String(cfg.template_id ?? '') };
  }
  if (step.step_type === 'wait') {
    const m = Number(cfg.minutes ?? cfg.delay_minutes ?? 0);
    return { step_type: 'wait', minutes: Number.isFinite(m) ? m : 0 };
  }
  return null;
}

export function SequencesPage() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [sequences, setSequences] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);

  // Éditeur (création + édition partagent le modal)
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [busy, setBusy] = useState(false);

  // Stats d'engagement (Sequence Analytics §6.H) — chargées à l'ouverture du
  // détail d'une séquence existante. open_rate/click_rate = ratios 0..1
  // (§6.A), formattés en % à l'affichage. Rétro-compat : erreur → masqué.
  const [stats, setStats] = useState<SequenceStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Enrôlement
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSeqId, setEnrollSeqId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [enrollLeadId, setEnrollLeadId] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const [seqRes, tplRes] = await Promise.all([
      getSequences(),
      getTemplates(),
    ]);
    if (seqRes.data) setSequences(seqRes.data);
    else setLoadError(seqRes.error || t('common.loading_error'));
    if (tplRes.data) setTemplates(tplRes.data.filter((x) => x.channel === 'email'));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetEditor = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setSteps([]);
    setStats(null);
    setStatsLoading(false);
  };

  const openCreate = () => {
    resetEditor();
    setEditOpen(true);
  };

  const openEdit = async (seq: Workflow) => {
    resetEditor();
    setBusy(true);
    const res = await getSequence(seq.id);
    setBusy(false);
    if (!res.data) {
      toastError(res.error || t('seq.empty_title'));
      return;
    }
    setEditingId(res.data.id);
    setName(res.data.name);
    setDescription(res.data.description || '');
    const ordered = [...(res.data.steps || [])].sort(
      (a, b) => a.step_order - b.step_order
    );
    setSteps(
      ordered
        .map(parseStepConfig)
        .filter((s): s is DraftStep => s !== null)
    );
    setEditOpen(true);

    // Stats d'engagement : lecture pure, best-effort. Une erreur (stub/backend
    // indisponible) ne bloque pas l'édition — la section reste masquée.
    setStats(null);
    setStatsLoading(true);
    const statsRes = await getSequenceStats(res.data.id);
    setStatsLoading(false);
    if (statsRes.data) setStats(statsRes.data);
  };

  const addStep = (kind: 'send_email' | 'wait') => {
    setSteps((prev) => [
      ...prev,
      kind === 'send_email'
        ? { step_type: 'send_email', template_id: templates[0]?.id ?? '' }
        : { step_type: 'wait', minutes: 1440 },
    ]);
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });
  };

  const removeStep = (idx: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateStep = (idx: number, patch: Partial<DraftStep>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? ({ ...s, ...patch } as DraftStep) : s))
    );
  };

  const buildPayload = () => ({
    name: name.trim(),
    description: description.trim(),
    is_sequence: 1,
    trigger_type: 'manual' as const,
    steps: steps.map((s, i) => ({
      step_order: i,
      step_type: s.step_type,
      config:
        s.step_type === 'send_email'
          ? JSON.stringify({ template_id: s.template_id })
          : JSON.stringify({ minutes: s.minutes }),
    })),
  });

  const handleSave = async () => {
    if (!name.trim() || steps.length === 0) return;
    setBusy(true);
    const payload = buildPayload();
    const res = editingId
      ? await updateSequence(editingId, payload as Partial<Workflow> & {
          steps?: Partial<WorkflowStep>[];
        })
      : await createSequence(payload as Partial<Workflow> & {
          steps?: Partial<WorkflowStep>[];
        });
    setBusy(false);
    if (res.data) {
      setEditOpen(false);
      resetEditor();
      success(t('seq.save'));
      void load();
    } else {
      toastError(res.error || t('seq.save'));
    }
  };

  const handleToggleActive = async (seq: Workflow) => {
    const next = seq.is_active ? 0 : 1;
    const res = await updateSequence(seq.id, { is_active: next });
    if (res.data) {
      setSequences((prev) =>
        prev.map((s) => (s.id === seq.id ? { ...s, is_active: next } : s))
      );
      success(next ? t('seq.active') : t('seq.paused'));
    } else {
      toastError(res.error || t('seq.save'));
    }
  };

  const handleDelete = async (seq: Workflow) => {
    const ok = await confirm({
      title: t('seq.delete'),
      description: t('seq.delete_confirm'),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteSequence(seq.id);
    if (res.data) {
      setSequences((prev) => prev.filter((s) => s.id !== seq.id));
      success(t('seq.delete'));
    } else {
      toastError(res.error || t('seq.delete'));
    }
  };

  const openEnroll = async (seq: Workflow) => {
    setEnrollSeqId(seq.id);
    setEnrollLeadId('');
    setEnrollOpen(true);
    if (leads.length === 0) {
      const res = await getLeads({ limit: 200 });
      if (res.data) setLeads(res.data);
    }
  };

  const handleEnroll = async () => {
    if (!enrollSeqId || !enrollLeadId) return;
    setBusy(true);
    const res = await enrollInSequence(enrollSeqId, enrollLeadId);
    setBusy(false);
    if (res.data) {
      setEnrollOpen(false);
      success(t('seq.enroll_success'));
      void load();
    } else {
      toastError(res.error || t('seq.enroll'));
    }
  };

  return (
    <AppLayout title={t('seq.title')}>
      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="t-h1">{t('seq.title')}</h1>
            <p className="text-muted">{t('seq.subtitle')}</p>
          </div>
          <Button
            variant="primary"
            leftIcon={<Icon as={Plus} size="sm" />}
            onClick={openCreate}
          >
            {t('seq.new')}
          </Button>
        </div>

        {isLoading ? (
          <div
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-busy="true"
            aria-live="polite"
          >
            <span className="sr-only">{t('common.loading')}</span>
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-5">
                <Skeleton className="h-5 w-2/3 mb-3" />
                <Skeleton className="h-3 w-1/3 mb-4" />
                <Skeleton className="h-10 w-full rounded-md" />
              </Card>
            ))}
          </div>
        ) : loadError ? (
          <Card className="p-5" role="alert">
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm font-medium">{t('common.loading_error')}</p>
              <p className="text-xs text-muted">{loadError}</p>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                {t('common.retry')}
              </Button>
            </div>
          </Card>
        ) : sequences.length === 0 ? (
          <EmptyState
            icon={<Icon as={GitBranch} size={40} />}
            title={t('seq.empty_title')}
            description={t('seq.empty_desc')}
            action={
              <Button
                variant="primary"
                leftIcon={<Icon as={Plus} size="sm" />}
                onClick={openCreate}
              >
                {t('seq.new')}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sequences.map((seq) => (
              <Card key={seq.id} className="p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    className="text-left font-semibold leading-tight hover:underline"
                    onClick={() => void openEdit(seq)}
                  >
                    {seq.name}
                  </button>
                  <Tag
                    variant={seq.is_active ? 'success' : 'neutral'}
                    size="sm"
                    statusIcon
                  >
                    {seq.is_active ? t('seq.active') : t('seq.paused')}
                  </Tag>
                </div>

                {seq.description ? (
                  <p className="text-sm text-muted line-clamp-2">
                    {seq.description}
                  </p>
                ) : null}

                <div className="flex items-center gap-4 text-sm text-muted">
                  <span title={t('seq.steps')}>
                    <Icon as={Mail} size="sm" /> {seq.steps_count ?? 0}{' '}
                    {t('seq.steps')}
                  </span>
                  <span title={t('seq.enrolled')}>
                    <Icon as={UserPlus} size="sm" />{' '}
                    {seq.active_enrollments ?? 0} {t('seq.enrolled')}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-auto pt-2">
                  <Switch
                    checked={!!seq.is_active}
                    onCheckedChange={() => void handleToggleActive(seq)}
                    size="sm"
                    variant="success"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => void openEdit(seq)}
                  >
                    {t('seq.steps')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={UserPlus} size="sm" />}
                    onClick={() => void openEnroll(seq)}
                  >
                    {t('seq.enroll')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(seq)}
                    aria-label={t('seq.delete')}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Éditeur de séquence : liste linéaire d'étapes (non-tech) ── */}
      <Modal
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) resetEditor();
        }}
        title={editingId ? t('seq.steps') : t('seq.new')}
        size="lg"
      >
        <div className="flex flex-col gap-4 p-1">
          <div>
            <label className="prop-label">{t('seq.name')}</label>
            <Input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="prop-label">{t('seq.description')}</label>
            <Textarea
              value={description}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* ── Stats d'engagement (séquence existante) ── */}
          {editingId ? (
            statsLoading ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Card key={i} className="p-3">
                    <Skeleton className="h-3 w-2/3 mb-2" />
                    <Skeleton className="h-5 w-1/2" />
                  </Card>
                ))}
              </div>
            ) : stats ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(
                  [
                    { key: 'seq.stat_sent', value: String(stats.sent) },
                    { key: 'seq.stat_opened', value: String(stats.opened) },
                    { key: 'seq.stat_clicked', value: String(stats.clicked) },
                    { key: 'seq.stat_open_rate', value: formatRate(stats.open_rate) },
                    { key: 'seq.stat_click_rate', value: formatRate(stats.click_rate) },
                  ] as const
                ).map((s) => (
                  <Card key={s.key} className="p-3">
                    <div className="text-xs text-muted">{t(s.key)}</div>
                    <div className="text-lg font-semibold leading-tight mt-0.5">
                      {s.value}
                    </div>
                  </Card>
                ))}
              </div>
            ) : null
          ) : null}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="prop-label">{t('seq.steps')}</label>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Icon as={Mail} size="sm" />}
                  onClick={() => addStep('send_email')}
                >
                  {t('seq.step_email')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Icon as={Clock} size="sm" />}
                  onClick={() => addStep('wait')}
                >
                  {t('seq.step_wait')}
                </Button>
              </div>
            </div>

            {steps.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">
                {t('seq.empty_desc')}
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {steps.map((step, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-3 rounded-md border border-subtle p-3"
                  >
                    <span className="text-xs font-medium text-muted w-6 text-center">
                      {idx + 1}
                    </span>
                    {step.step_type === 'send_email' ? (
                      <>
                        <Icon as={Mail} size="sm" />
                        <span className="text-sm w-28 shrink-0">
                          {t('seq.step_email')}
                        </span>
                        <Select
                          value={step.template_id}
                          onChange={(e) =>
                            updateStep(idx, { template_id: e.target.value })
                          }
                          className="flex-1"
                        >
                          <option value="">—</option>
                          {templates.map((tpl) => (
                            <option key={tpl.id} value={tpl.id}>
                              {tpl.name}
                            </option>
                          ))}
                        </Select>
                        {step.template_id ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<Icon as={Pencil} size="sm" />}
                            onClick={() =>
                              navigate({
                                to: '/templates/builder/$templateId',
                                params: { templateId: step.template_id },
                              })
                            }
                            aria-label={t('seq.step_email')}
                          />
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Icon as={Clock} size="sm" />
                        <span className="text-sm w-28 shrink-0">
                          {t('seq.step_wait')}
                        </span>
                        {(() => {
                          const { value, unit } = splitWait(step.minutes);
                          const factor =
                            WAIT_UNITS.find((u) => u.key === unit)?.factor ?? 1;
                          return (
                            <>
                              <Input
                                type="number"
                                min={1}
                                value={value}
                                onChange={(e) => {
                                  const v = Math.max(
                                    1,
                                    Number(e.target.value) || 1
                                  );
                                  updateStep(idx, { minutes: v * factor });
                                }}
                                className="w-24"
                              />
                              <Select
                                value={unit}
                                onChange={(e) => {
                                  const nf =
                                    WAIT_UNITS.find(
                                      (u) => u.key === e.target.value
                                    )?.factor ?? 1;
                                  updateStep(idx, { minutes: value * nf });
                                }}
                                className="w-32"
                              >
                                <option value="minutes">min</option>
                                <option value="hours">h</option>
                                <option value="days">j</option>
                              </Select>
                            </>
                          );
                        })()}
                      </>
                    )}
                    <div className="flex items-center gap-1 ml-auto">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={idx === 0}
                        onClick={() => moveStep(idx, -1)}
                        leftIcon={<Icon as={ArrowUp} size="sm" />}
                        aria-label={t('common.move_up')}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={idx === steps.length - 1}
                        onClick={() => moveStep(idx, 1)}
                        leftIcon={<Icon as={ArrowDown} size="sm" />}
                        aria-label={t('common.move_down')}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeStep(idx)}
                        leftIcon={<Icon as={Trash2} size="sm" />}
                        aria-label={t('seq.delete')}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              isLoading={busy}
              disabled={!name.trim() || steps.length === 0}
              onClick={() => void handleSave()}
            >
              {t('seq.save')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Enrôler un contact ── */}
      <Modal
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        title={t('seq.enroll')}
        size="sm"
      >
        <div className="flex flex-col gap-4 p-1">
          <div>
            <label className="prop-label">{t('seq.enroll')}</label>
            <Select
              value={enrollLeadId}
              onChange={(e) => setEnrollLeadId(e.target.value)}
            >
              <option value="">—</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} {l.email ? `· ${l.email}` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEnrollOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              isLoading={busy}
              disabled={!enrollLeadId}
              onClick={() => void handleEnroll()}
            >
              {t('seq.enroll')}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
