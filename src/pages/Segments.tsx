// ── Page Segments — Segments de leads dynamiques (LOT G6) ───────────────────
//
// Corps RÉEL Phase B (Manager-C). Export FIGÉ `SegmentsPage` (consommé par
// App.tsx route /segments via lazy). Liste des segments + builder de critères
// AND (status/source/score/tags/dates + comportemental opened/clicked +
// in_sequence) + aperçu live débounce (previewSegment) + enrôlement masse.
// Helpers api.ts FIGÉS Phase A consommés tels quels : getSegments / getSegment
// / createSegment / updateSegment / deleteSegment / previewSegment /
// enrollSegment. i18n 100 % `t('segment.*')` (clés figées Phase A, AUCUNE
// création). Discrimination erreur : présence de `res.data` / texte
// `res.error`, JAMAIS `res.code` (ApiResponse gelé).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button,
  Card,
  Tag,
  Icon,
  Input,
  Select,
  Skeleton,
  EmptyState,
  Switch,
  FilterChip,
  SlidePanel,
  PageHero,
  useToast,
  useConfirm,
} from '@/components/ui';
import { Plus, Filter, RefreshCw, Trash2, Pencil, UserPlus, Users } from 'lucide-react';
import {
  getSegments,
  getSegment,
  createSegment,
  updateSegment,
  deleteSegment,
  previewSegment,
  enrollSegment,
  getWorkflows,
  getAllTags,
  getBroadcastHistory,
} from '@/lib/api';
import type { SegmentCriteria, LeadSegment } from '@/lib/api';
import type { Workflow } from '@/lib/types';
import { LEAD_STATUSES, LEAD_SOURCES, STATUS_LABELS, SOURCE_LABELS } from '@/lib/types';
import { t, getLocale } from '@/lib/i18n';
import { formatDateTime } from '@/lib/i18n/datetime';
import { SmartListsPanel } from '@/components/segments/SmartListsPanel';

// Broadcast minimal pour les critères comportementaux (dropdown campagnes).
type BroadcastOpt = { id: string; subject: string };

// État local du builder. Tous les champs optionnels reflètent SegmentCriteria.
// On garde des flags d'activation par bloc pour distinguer « non filtré » de
// « filtré vide » sans polluer le criteria envoyé au serveur.
type Builder = {
  statuses: string[];
  sources: string[];
  scoreOn: boolean;
  scoreOp: 'gte' | 'lte' | 'eq';
  scoreValue: number;
  tagsIn: string[];
  tagsNotIn: string[];
  createdAfter: string;
  createdBefore: string;
  activityAfter: string;
  activityBefore: string;
  // Comportemental : 'none' | 'opened' | 'not_opened' | 'clicked' | 'not_clicked'
  behaviorKind: 'none' | 'opened' | 'not_opened' | 'clicked' | 'not_clicked';
  behaviorBroadcastId: string;
  behaviorWithinDays: number;
  // in_sequence : 'any' (non filtré) | 'in' | 'not_in'
  inSequence: 'any' | 'in' | 'not_in';
};

const EMPTY_BUILDER: Builder = {
  statuses: [],
  sources: [],
  scoreOn: false,
  scoreOp: 'gte',
  scoreValue: 50,
  tagsIn: [],
  tagsNotIn: [],
  createdAfter: '',
  createdBefore: '',
  activityAfter: '',
  activityBefore: '',
  behaviorKind: 'none',
  behaviorBroadcastId: '',
  behaviorWithinDays: 30,
  inSequence: 'any',
};

// Builder UI → SegmentCriteria (n'inclut que les blocs réellement actifs).
function builderToCriteria(b: Builder): SegmentCriteria {
  const c: SegmentCriteria = {};
  if (b.statuses.length) c.status = b.statuses;
  if (b.sources.length) c.source = b.sources;
  if (b.scoreOn) c.score = { op: b.scoreOp, value: b.scoreValue };
  if (b.tagsIn.length) c.tags_in = b.tagsIn;
  if (b.tagsNotIn.length) c.tags_not_in = b.tagsNotIn;
  if (b.createdAfter) c.created_after = b.createdAfter;
  if (b.createdBefore) c.created_before = b.createdBefore;
  if (b.activityAfter) c.last_activity_after = b.activityAfter;
  if (b.activityBefore) c.last_activity_before = b.activityBefore;
  if (b.behaviorKind !== 'none' && b.behaviorBroadcastId) {
    const win = b.behaviorWithinDays > 0 ? { within_days: b.behaviorWithinDays } : {};
    if (b.behaviorKind === 'opened')
      c.opened_campaign = { broadcast_id: b.behaviorBroadcastId, ...win };
    else if (b.behaviorKind === 'not_opened')
      c.opened_campaign = { broadcast_id: b.behaviorBroadcastId, negate: true, ...win };
    else if (b.behaviorKind === 'clicked')
      c.clicked_campaign = { broadcast_id: b.behaviorBroadcastId, ...win };
    else if (b.behaviorKind === 'not_clicked')
      c.clicked_campaign = { broadcast_id: b.behaviorBroadcastId, negate: true, ...win };
  }
  if (b.inSequence === 'in') c.in_sequence = true;
  else if (b.inSequence === 'not_in') c.in_sequence = false;
  return c;
}

// SegmentCriteria → Builder (édition d'un segment existant).
function criteriaToBuilder(c: SegmentCriteria | undefined): Builder {
  const b: Builder = { ...EMPTY_BUILDER };
  if (!c) return b;
  if (c.status) b.statuses = c.status;
  if (c.source) b.sources = c.source;
  if (c.score) {
    b.scoreOn = true;
    b.scoreOp = c.score.op;
    b.scoreValue = c.score.value;
  }
  if (c.tags_in) b.tagsIn = c.tags_in;
  if (c.tags_not_in) b.tagsNotIn = c.tags_not_in;
  if (c.created_after) b.createdAfter = c.created_after.slice(0, 10);
  if (c.created_before) b.createdBefore = c.created_before.slice(0, 10);
  if (c.last_activity_after) b.activityAfter = c.last_activity_after.slice(0, 10);
  if (c.last_activity_before) b.activityBefore = c.last_activity_before.slice(0, 10);
  if (c.opened_campaign) {
    b.behaviorKind = c.opened_campaign.negate ? 'not_opened' : 'opened';
    b.behaviorBroadcastId = c.opened_campaign.broadcast_id;
    if (c.opened_campaign.within_days) b.behaviorWithinDays = c.opened_campaign.within_days;
  } else if (c.clicked_campaign) {
    b.behaviorKind = c.clicked_campaign.negate ? 'not_clicked' : 'clicked';
    b.behaviorBroadcastId = c.clicked_campaign.broadcast_id;
    if (c.clicked_campaign.within_days) b.behaviorWithinDays = c.clicked_campaign.within_days;
  }
  if (c.in_sequence === true) b.inSequence = 'in';
  else if (c.in_sequence === false) b.inSequence = 'not_in';
  return b;
}

function toggleIn(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function SegmentsPage() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [segments, setSegments] = useState<LeadSegment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recomputingId, setRecomputingId] = useState<string | null>(null);

  // Données auxiliaires pour le builder
  const [allTags, setAllTags] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastOpt[]>([]);

  // Éditeur (création + édition partagent le panel)
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [builder, setBuilder] = useState<Builder>(EMPTY_BUILDER);
  const [busy, setBusy] = useState(false);

  // Aperçu live (débounce)
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewSample, setPreviewSample] = useState<Array<Record<string, unknown>>>([]);
  const [previewing, setPreviewing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Enrôlement masse
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSegId, setEnrollSegId] = useState<string | null>(null);
  const [enrollWorkflowId, setEnrollWorkflowId] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [segRes, tagRes, wfRes, histRes] = await Promise.all([
        getSegments(),
        getAllTags(),
        getWorkflows(),
        getBroadcastHistory(50),
      ]);
      if (segRes.data) setSegments(segRes.data);
      else if (segRes.error) setLoadError(segRes.error);
      if (tagRes.data) setAllTags(tagRes.data);
      if (wfRes.data) setWorkflows(wfRes.data);
      if (histRes.data) {
        setBroadcasts(
          histRes.data.map((r) => ({
            id: String(r.id ?? ''),
            subject: String(r.subject ?? '(sans objet)'),
          }))
        );
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('segment.error.load'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetEditor = () => {
    setEditingId(null);
    setName('');
    setBuilder(EMPTY_BUILDER);
    setPreviewCount(null);
    setPreviewSample([]);
  };

  const openCreate = () => {
    resetEditor();
    setEditOpen(true);
  };

  const openEdit = async (seg: LeadSegment) => {
    resetEditor();
    setBusy(true);
    const res = await getSegment(seg.id);
    setBusy(false);
    if (!res.data) {
      toastError(res.error || t('segment.empty_title'));
      return;
    }
    setEditingId(res.data.id);
    setName(res.data.name);
    setBuilder(criteriaToBuilder(res.data.criteria));
    setEditOpen(true);
  };

  // Aperçu live : recalcule à chaque changement de critère, débounce 450ms.
  const criteria = useMemo(() => builderToCriteria(builder), [builder]);

  useEffect(() => {
    if (!editOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreviewing(true);
    debounceRef.current = setTimeout(async () => {
      const res = await previewSegment(criteria);
      setPreviewing(false);
      if (res.data) {
        setPreviewCount(res.data.count);
        setPreviewSample(res.data.sample || []);
      } else {
        setPreviewCount(null);
        setPreviewSample([]);
      }
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [criteria, editOpen]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const res = editingId
      ? await updateSegment(editingId, { name: name.trim(), criteria })
      : await createSegment({ name: name.trim(), criteria });
    setBusy(false);
    if (res.data) {
      setEditOpen(false);
      resetEditor();
      success(t('segment.save'));
      void load();
    } else {
      toastError(res.error || t('segment.save'));
    }
  };

  const handleRecompute = async (seg: LeadSegment) => {
    // Le recompute = re-preview persistant : on relit le segment (le serveur
    // recalcule cached_count à la lecture). On réutilise getSegment.
    setRecomputingId(seg.id);
    const res = await getSegment(seg.id);
    setRecomputingId(null);
    if (res.data) {
      setSegments((prev) => prev.map((s) => (s.id === seg.id ? res.data! : s)));
      success(t('segment.recompute_ok'));
    } else {
      toastError(res.error || t('segment.recompute'));
    }
  };

  const handleDelete = async (seg: LeadSegment) => {
    const ok = await confirm({
      title: t('segment.delete'),
      description: t('segment.confirm_delete'),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteSegment(seg.id);
    if (res.data) {
      setSegments((prev) => prev.filter((s) => s.id !== seg.id));
      success(t('segment.delete'));
    } else {
      toastError(res.error || t('segment.delete'));
    }
  };

  const openEnroll = (seg: LeadSegment) => {
    setEnrollSegId(seg.id);
    setEnrollWorkflowId(workflows[0]?.id ?? '');
    setEnrollOpen(true);
  };

  const handleEnroll = async () => {
    if (!enrollSegId || !enrollWorkflowId) return;
    setBusy(true);
    const res = await enrollSegment(enrollSegId, enrollWorkflowId);
    setBusy(false);
    if (res.data) {
      setEnrollOpen(false);
      success(t('segment.enroll_ok'));
    } else {
      toastError(res.error || t('segment.enroll_in'));
    }
  };

  return (
    <AppLayout title={t('segment.title')}>
      <div className="p-6">
        <PageHero
          meta={t('segment.title')}
          title={t('segment.title')}
          description={t('segment.subtitle')}
          actions={
            <Button
              variant="primary"
              leftIcon={<Icon as={Plus} size="sm" />}
              onClick={openCreate}
            >
              {t('segment.new')}
            </Button>
          }
        />

        {loadError && !isLoading && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)]/30 text-[var(--danger)]"
          >
            <span className="text-sm">{loadError}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()} aria-label={t('action.retry')}>
              {t('action.retry')}
            </Button>
          </div>
        )}
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-live="polite">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-5">
                <Skeleton className="h-5 w-2/3 mb-3" />
                <Skeleton className="h-3 w-1/3 mb-4" />
                <Skeleton className="h-8 w-full rounded-md" />
              </Card>
            ))}
          </div>
        ) : segments.length === 0 && !loadError ? (
          <EmptyState
            icon={<Icon as={Filter} size={40} />}
            title={t('segment.empty_title')}
            description={t('segment.empty_desc')}
            action={
              <Button
                variant="primary"
                leftIcon={<Icon as={Plus} size="sm" />}
                onClick={openCreate}
              >
                {t('segment.new')}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-stagger">
            {segments.map((seg, idx) => (
              <Card key={seg.id} className={`p-5 flex flex-col gap-3 segment-card card-interactive-bump stagger-${Math.min(idx + 1, 8)}`}>
                <div className="flex items-start justify-between gap-2">
                  <button
                    className="text-left font-semibold leading-tight hover:underline"
                    onClick={() => void openEdit(seg)}
                  >
                    {seg.name}
                  </button>
                  <Tag variant="neutral" size="sm">
                    <Icon as={Users} size="sm" /> <span className="t-mono-num">{seg.cached_count ?? 0}</span>
                  </Tag>
                </div>

                <div className="text-xs text-muted">
                  {t('segment.members_count')}:{' '}
                  <strong className="t-mono-num">{seg.cached_count ?? 0}</strong>
                  {seg.cached_at ? (
                    <span className="ml-2">
                      {formatDateTime(seg.cached_at, getLocale())}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-auto pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => void openEdit(seg)}
                  >
                    {t('segment.criteria')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={recomputingId === seg.id}
                    leftIcon={<Icon as={RefreshCw} size="sm" />}
                    onClick={() => void handleRecompute(seg)}
                  >
                    {t('segment.recompute')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={UserPlus} size="sm" />}
                    onClick={() => openEnroll(seg)}
                  >
                    {t('segment.enroll_in')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(seg)}
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    aria-label={t('segment.delete')}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* ── Smart Lists : segments dynamiques par règles (additif) ── */}
        <SmartListsPanel />
      </div>

      {/* ── Éditeur de segment : builder de critères + aperçu live ── */}
      <SlidePanel
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) resetEditor();
        }}
        title={editingId ? t('segment.criteria') : t('segment.new')}
        size="lg"
        closeLabel={t('action.cancel')}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-muted segment-preview-foot">
              {previewing ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <>
                  <strong>{previewCount ?? 0}</strong>{' '}
                  {t('segment.members_count')}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setEditOpen(false)}>
                {t('action.cancel')}
              </Button>
              <Button
                variant="primary"
                isLoading={busy}
                disabled={!name.trim()}
                onClick={() => void handleSave()}
              >
                {t('segment.save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-5 segment-builder">
          <div>
            <label className="prop-label">{t('segment.name')}</label>
            <Input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Statut */}
          <div>
            <label className="prop-label">{t('segment.crit.status')}</label>
            <div className="flex flex-wrap gap-2">
              {LEAD_STATUSES.map((s) => (
                <FilterChip
                  key={s}
                  label={STATUS_LABELS[s]}
                  variant={builder.statuses.includes(s) ? 'active' : 'available'}
                  onClick={() =>
                    setBuilder((b) => ({ ...b, statuses: toggleIn(b.statuses, s) }))
                  }
                />
              ))}
            </div>
          </div>

          {/* Source */}
          <div>
            <label className="prop-label">{t('segment.crit.source')}</label>
            <div className="flex flex-wrap gap-2">
              {LEAD_SOURCES.map((s) => (
                <FilterChip
                  key={s}
                  label={SOURCE_LABELS[s] ?? s}
                  variant={builder.sources.includes(s) ? 'active' : 'available'}
                  onClick={() =>
                    setBuilder((b) => ({ ...b, sources: toggleIn(b.sources, s) }))
                  }
                />
              ))}
            </div>
          </div>

          {/* Score */}
          <div className="flex flex-col gap-2">
            <Switch
              checked={builder.scoreOn}
              onCheckedChange={(v) => setBuilder((b) => ({ ...b, scoreOn: v }))}
              size="sm"
              label={t('segment.crit.score')}
            />
            {builder.scoreOn ? (
              <div className="flex items-center gap-2">
                <Select
                  value={builder.scoreOp}
                  onChange={(e) =>
                    setBuilder((b) => ({
                      ...b,
                      scoreOp: e.target.value as Builder['scoreOp'],
                    }))
                  }
                  className="w-40"
                >
                  <option value="gte">{t('segment.crit.score_gte')}</option>
                  <option value="lte">≤</option>
                  <option value="eq">=</option>
                </Select>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={builder.scoreValue}
                  onChange={(e) =>
                    setBuilder((b) => ({
                      ...b,
                      scoreValue: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-28"
                />
              </div>
            ) : null}
          </div>

          {/* Tags inclus / exclus */}
          {allTags.length > 0 ? (
            <>
              <div>
                <label className="prop-label">{t('segment.crit.tags_in')}</label>
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => (
                    <FilterChip
                      key={tag}
                      label={tag}
                      variant={builder.tagsIn.includes(tag) ? 'active' : 'available'}
                      onClick={() =>
                        setBuilder((b) => ({ ...b, tagsIn: toggleIn(b.tagsIn, tag) }))
                      }
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="prop-label">{t('segment.crit.tags_not_in')}</label>
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => (
                    <FilterChip
                      key={tag}
                      label={tag}
                      variant={builder.tagsNotIn.includes(tag) ? 'active' : 'available'}
                      onClick={() =>
                        setBuilder((b) => ({
                          ...b,
                          tagsNotIn: toggleIn(b.tagsNotIn, tag),
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {/* Date de création */}
          <div>
            <label className="prop-label">{t('segment.crit.created_range')}</label>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={builder.createdAfter}
                onChange={(e) =>
                  setBuilder((b) => ({ ...b, createdAfter: e.target.value }))
                }
              />
              <span className="text-muted">–</span>
              <Input
                type="date"
                value={builder.createdBefore}
                onChange={(e) =>
                  setBuilder((b) => ({ ...b, createdBefore: e.target.value }))
                }
              />
            </div>
          </div>

          {/* Dernière activité */}
          <div>
            <label className="prop-label">{t('segment.crit.activity_range')}</label>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={builder.activityAfter}
                onChange={(e) =>
                  setBuilder((b) => ({ ...b, activityAfter: e.target.value }))
                }
              />
              <span className="text-muted">–</span>
              <Input
                type="date"
                value={builder.activityBefore}
                onChange={(e) =>
                  setBuilder((b) => ({ ...b, activityBefore: e.target.value }))
                }
              />
            </div>
          </div>

          {/* Comportemental : ouvert / cliqué une campagne */}
          <div>
            <label className="prop-label">{t('segment.crit.opened')}</label>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={builder.behaviorKind}
                onChange={(e) =>
                  setBuilder((b) => ({
                    ...b,
                    behaviorKind: e.target.value as Builder['behaviorKind'],
                  }))
                }
                className="w-56"
              >
                <option value="none">—</option>
                <option value="opened">{t('segment.crit.opened')}</option>
                <option value="not_opened">{t('segment.crit.not_opened')}</option>
                <option value="clicked">{t('segment.crit.clicked')}</option>
                <option value="not_clicked">{t('segment.crit.not_clicked')}</option>
              </Select>
              {builder.behaviorKind !== 'none' ? (
                <>
                  <Select
                    value={builder.behaviorBroadcastId}
                    onChange={(e) =>
                      setBuilder((b) => ({
                        ...b,
                        behaviorBroadcastId: e.target.value,
                      }))
                    }
                    className="flex-1 min-w-[180px]"
                  >
                    <option value="">—</option>
                    {broadcasts.map((bc) => (
                      <option key={bc.id} value={bc.id}>
                        {bc.subject}
                      </option>
                    ))}
                  </Select>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      value={builder.behaviorWithinDays}
                      onChange={(e) =>
                        setBuilder((b) => ({
                          ...b,
                          behaviorWithinDays: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="w-20"
                    />
                    <span className="text-xs text-muted">
                      {t('segment.crit.within_days')}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {/* In sequence */}
          <div>
            <label className="prop-label">{t('segment.crit.in_sequence')}</label>
            <Select
              value={builder.inSequence}
              onChange={(e) =>
                setBuilder((b) => ({
                  ...b,
                  inSequence: e.target.value as Builder['inSequence'],
                }))
              }
              className="w-56"
            >
              <option value="any">—</option>
              <option value="in">{t('segment.crit.in_sequence')}</option>
              <option value="not_in">{t('segment.crit.not_in')}</option>
            </Select>
          </div>

          {/* Aperçu échantillon */}
          {previewSample.length > 0 ? (
            <div className="segment-sample">
              <label className="prop-label">{t('segment.members_count')}</label>
              <div className="flex flex-col gap-1">
                {previewSample.slice(0, 8).map((row, i) => (
                  <div key={i} className="text-sm text-muted truncate">
                    {String(row.name ?? row.email ?? row.id ?? '—')}
                    {row.email && row.name ? (
                      <span className="ml-2 text-xs">{String(row.email)}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : !previewing && previewCount === 0 ? (
            <div className="segment-sample segment-preview-empty">
              <p className="text-sm text-muted">{t('segment.preview_empty')}</p>
            </div>
          ) : null}
        </div>
      </SlidePanel>

      {/* ── Enrôler le segment dans une séquence/workflow ── */}
      <SlidePanel
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        title={t('segment.enroll_in')}
        size="sm"
        closeLabel={t('action.cancel')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEnrollOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              isLoading={busy}
              disabled={!enrollWorkflowId}
              onClick={() => void handleEnroll()}
            >
              {t('segment.enroll_in')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="prop-label">{t('segment.enroll_in')}</label>
            <Select
              value={enrollWorkflowId}
              onChange={(e) => setEnrollWorkflowId(e.target.value)}
            >
              <option value="">—</option>
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </SlidePanel>
    </AppLayout>
  );
}
