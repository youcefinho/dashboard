// ── VariantBuilder — Sprint 44 LOT FUNNEL-S44 (Agent B2) ──────────────────
// CRUD des variantes A/B/C... d'une étape de funnel (table fb_variants).
// Consomme helpers FIGÉS Phase A : listStepVariants / createStepVariant /
// updateStepVariant / deleteStepVariant + interface FunnelStepVariant.
//
// Style Stripe-clean (Sprint 38 reset). Imports RELATIFS (consigne Sprint 44).
// aria-labels via t(). Aucun console.log (CLAUDE.md).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, FlaskConical } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Switch } from '../ui/Switch';
import { Tag } from '../ui/Tag';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import {
  listStepVariants,
  createStepVariant,
  updateStepVariant,
  deleteStepVariant,
  type FunnelStepVariant,
  type FunnelStepVariantInput,
} from '../../lib/api';
import { t } from '../../lib/i18n';

// ── Props ────────────────────────────────────────────────────────────────────

export interface VariantBuilderProps {
  stepId: string;
}

// ── Form state (controlled) ─────────────────────────────────────────────────

interface VariantForm {
  variant_name: string;
  content_html: string;
  traffic_pct: number;
  is_control: boolean;
}

const EMPTY_FORM: VariantForm = {
  variant_name: '',
  content_html: '',
  traffic_pct: 0.5,
  is_control: false,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** 0..1 → '50' (% entier sans le symbole). */
function pctToInt(v: number): number {
  return Math.round(v * 100);
}

/** Somme arrondie 0..100 (%) — pour message warning trafic. */
function sumTrafficPct(variants: FunnelStepVariant[]): number {
  return Math.round(
    variants.reduce((acc, v) => acc + (v.traffic_pct ?? 0), 0) * 100,
  );
}

// ── Composant ───────────────────────────────────────────────────────────────

export function VariantBuilder({ stepId }: VariantBuilderProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [variants, setVariants] = useState<FunnelStepVariant[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<VariantForm>(EMPTY_FORM);
  const [busy, setBusy] = useState<boolean>(false);

  // ── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!stepId) return;
    setLoading(true);
    setLoadError(null);
    const res = await listStepVariants(stepId);
    if (res.error) {
      setLoadError(res.error);
      toastError(res.error);
      setVariants([]);
    } else if (res.data) {
      setVariants(res.data);
    }
    setLoading(false);
  }, [stepId, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Modal helpers ───────────────────────────────────────────────────────
  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (v: FunnelStepVariant) => {
    setEditId(v.id);
    setForm({
      variant_name: v.variant_name ?? '',
      content_html: v.content_html ?? '',
      traffic_pct: typeof v.traffic_pct === 'number' ? v.traffic_pct : 0.5,
      is_control: !!v.is_control,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    if (busy) return;
    setModalOpen(false);
    setEditId(null);
    setForm({ ...EMPTY_FORM });
  };

  // ── Mutations ───────────────────────────────────────────────────────────
  const submit = async () => {
    const name = form.variant_name.trim();
    if (!name) {
      toastError(t('funnels.variants.name'));
      return;
    }
    const trafficClamped = Math.max(0, Math.min(1, Number(form.traffic_pct) || 0));
    const payload: FunnelStepVariantInput = {
      variant_name: name,
      content_html: form.content_html || null,
      traffic_pct: trafficClamped,
      is_control: form.is_control,
    };
    setBusy(true);
    const res = editId
      ? await updateStepVariant(editId, payload)
      : await createStepVariant(stepId, payload);
    setBusy(false);
    if (res.error || !res.data) {
      toastError(res.error || t('funnels.variants.save'));
      return;
    }
    success(t('funnels.variants.save'));
    setModalOpen(false);
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    void load();
  };

  const handleDelete = async (v: FunnelStepVariant) => {
    const ok = await confirm({
      title: t('funnels.variants.delete_confirm'),
      description: v.variant_name,
      danger: true,
    });
    if (!ok) return;
    const res = await deleteStepVariant(v.id);
    if (res.error) {
      toastError(res.error);
      return;
    }
    success(t('funnels.variants.delete_confirm'));
    setVariants((prev) => prev.filter((x) => x.id !== v.id));
  };

  // ── Validation trafic total ~100 % ──────────────────────────────────────
  const trafficSumInt = useMemo(() => sumTrafficPct(variants), [variants]);
  const trafficWarning =
    variants.length > 0 && Math.abs(trafficSumInt - 100) > 1;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header — titre + bouton create */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {t('funnels.variants.title')}
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            {variants.length > 0
              ? `${variants.length} · ${trafficSumInt} %`
              : t('funnels.variants.empty')}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Icon as={Plus} size="sm" aria-hidden="true" />}
          onClick={openCreate}
          aria-label={t('funnels.variants.create')}
        >
          {t('funnels.variants.create')}
        </Button>
      </div>

      {/* Warning : somme trafic != 100 % */}
      {trafficWarning ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {t('funnels.variants.traffic_sum_warning', { value: trafficSumInt })}
        </div>
      ) : null}

      {/* Liste / loading / error / empty */}
      {loading ? (
        <div
          className="grid gap-3"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t('funnels.variants.title')}
        >
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="mb-2 h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </Card>
          ))}
        </div>
      ) : loadError ? (
        <Card className="p-6">
          <div role="alert" className="space-y-2">
            <p className="text-sm font-medium text-danger">
              {t('common.loading_error')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{loadError}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              aria-label={t('action.retry')}
            >
              {t('action.retry')}
            </Button>
          </div>
        </Card>
      ) : variants.length === 0 ? (
        <EmptyState
          icon={<Icon as={FlaskConical} size={32} aria-hidden="true" />}
          title={t('funnels.variants.empty')}
          action={
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Icon as={Plus} size="sm" aria-hidden="true" />}
              onClick={openCreate}
            >
              {t('funnels.variants.create')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {variants.map((v) => (
            <Card key={v.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--text-primary)]">
                      {v.variant_name}
                    </span>
                    {v.is_control ? (
                      <Tag variant="success" size="sm">
                        {t('funnels.variants.control_badge')}
                      </Tag>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <label
                      htmlFor={`vbtraffic-${v.id}`}
                      className="text-xs text-[var(--text-muted)]"
                    >
                      {t('funnels.variants.traffic_pct')}
                    </label>
                    <input
                      id={`vbtraffic-${v.id}`}
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={pctToInt(v.traffic_pct)}
                      aria-label={t('funnels.variants.traffic_pct')}
                      onChange={async (e) => {
                        const next = Number(e.target.value) / 100;
                        // Optimistic UI : maj locale + appel API.
                        setVariants((prev) =>
                          prev.map((x) =>
                            x.id === v.id ? { ...x, traffic_pct: next } : x,
                          ),
                        );
                        const r = await updateStepVariant(v.id, {
                          traffic_pct: next,
                        });
                        if (r.error) toastError(r.error);
                      }}
                      className="h-1.5 flex-1 cursor-pointer accent-[var(--primary)]"
                    />
                    <span className="w-12 text-right text-xs tabular-nums text-[var(--text-primary)]">
                      {pctToInt(v.traffic_pct)} %
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('funnels.variants.edit')}
                    leftIcon={<Icon as={Pencil} size="sm" aria-hidden="true" />}
                    onClick={() => openEdit(v)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('funnels.variants.delete_confirm')}
                    leftIcon={<Icon as={Trash2} size="sm" aria-hidden="true" />}
                    onClick={() => void handleDelete(v)}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal CRUD */}
      <Modal
        open={modalOpen}
        onOpenChange={(v) => (v ? setModalOpen(true) : closeModal())}
        title={
          editId
            ? t('funnels.variants.edit')
            : t('funnels.variants.create')
        }
        size="lg"
      >
        <div className="flex flex-col gap-4 p-1">
          <div>
            <label
              htmlFor="vb-name"
              className="mb-1 block text-xs font-medium text-[var(--text-muted)]"
            >
              {t('funnels.variants.name')}
            </label>
            <Input
              id="vb-name"
              autoFocus
              value={form.variant_name}
              placeholder="A"
              onChange={(e) =>
                setForm((f) => ({ ...f, variant_name: e.target.value }))
              }
              aria-label={t('funnels.variants.name')}
            />
          </div>

          <div>
            <label
              htmlFor="vb-html"
              className="mb-1 block text-xs font-medium text-[var(--text-muted)]"
            >
              {t('funnels.variants.content_html')}
            </label>
            <Textarea
              id="vb-html"
              rows={12}
              value={form.content_html}
              placeholder="<!doctype html>..."
              onChange={(e) =>
                setForm((f) => ({ ...f, content_html: e.target.value }))
              }
              aria-label={t('funnels.variants.content_html')}
              className="font-mono text-xs"
              spellCheck={false}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="vb-traffic"
                className="mb-1 block text-xs font-medium text-[var(--text-muted)]"
              >
                {t('funnels.variants.traffic_pct')} (0 — 1)
              </label>
              <Input
                id="vb-traffic"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={form.traffic_pct}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    traffic_pct: Number(e.target.value) || 0,
                  }))
                }
                aria-label={t('funnels.variants.traffic_pct')}
              />
            </div>
            <div className="flex items-end">
              <Switch
                id="vb-control"
                checked={form.is_control}
                onCheckedChange={(c) =>
                  setForm((f) => ({ ...f, is_control: c }))
                }
                label={t('funnels.variants.is_control')}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              isLoading={busy}
              disabled={!form.variant_name.trim() || busy}
              onClick={() => void submit()}
            >
              {t('funnels.variants.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default VariantBuilder;
