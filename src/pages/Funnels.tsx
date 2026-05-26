// ── Funnels — liste des funnels / landing pages (LOT FUNNEL, Sprint 1) ─────
//
// Manager-C Phase C. Liste getFunnels() · création (createFunnel, blank ou
// gabarit funnel-templates) · dupliquer (getFunnel+createFunnel) · supprimer
// (deleteFunnel) · publier (publishFunnel) · résumé analytics (compteurs
// dénormalisés sur Funnel). i18n t('funnel.*') — clés figées Phase A, AUCUNE
// création. Helpers api FIGÉS Phase A consommés tels quels.

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
  Skeleton,
  EmptyState,
  useToast,
  useConfirm,
} from '@/components/ui';
import {
  Plus,
  LayoutTemplate,
  Copy,
  Trash2,
  ExternalLink,
  Eye,
  Send,
  Pencil,
} from 'lucide-react';
import {
  getFunnels,
  getFunnel,
  createFunnel,
  deleteFunnel,
  publishFunnel,
  type Funnel,
  type FunnelStep,
} from '@/lib/api';
import { FUNNEL_TEMPLATES } from './funnel-templates';
import { t } from '@/lib/i18n';

function statusVariant(s: Funnel['status']): 'success' | 'warning' | 'neutral' {
  if (s === 'published') return 'success';
  if (s === 'archived') return 'neutral';
  return 'warning';
}

export function FunnelsPage() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState(''); // '' = vierge
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await getFunnels();
      if (res.error || !res.data) {
        setLoadError(true);
      } else {
        setFunnels(res.data);
      }
    } catch {
      // Renforcement (CLAUDE.md "Aucun console.log") : on swallow et on bascule
      // sur l'EmptyState d'erreur (avec bouton retry). L'erreur réelle est
      // déjà loguée par apiFetch côté lib/api.ts si besoin.
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    const tmpl = FUNNEL_TEMPLATES.find((x) => x.id === templateId);
    const steps: Partial<FunnelStep>[] | undefined = tmpl
      ? tmpl.steps.map((s, i) => ({
          name: s.name,
          step_type: s.step_type,
          position: i,
          // page rattachée — blocks instanciés (id généré côté builder/save).
          page: {
            id: '',
            funnel_id: '',
            step_id: '',
            title: s.name,
            blocks: s.blocks.map((bl) => ({
              ...bl,
              id: crypto.randomUUID(),
            })),
          },
        }))
      : undefined;
    const res = await createFunnel({
      name,
      industry: tmpl?.industry ?? null,
      status: 'draft',
      ...(steps ? { steps: steps as FunnelStep[] } : {}),
    });
    setBusy(false);
    if (res.data?.id) {
      setCreateOpen(false);
      setNewName('');
      setTemplateId('');
      success(t('funnel.builder.saved'));
      navigate({ to: '/funnels/$funnelId', params: { funnelId: res.data.id } });
    } else {
      toastError(res.error || t('funnel.error.create'));
    }
  };

  const handleDuplicate = async (f: Funnel) => {
    setBusy(true);
    try {
    const full = await getFunnel(f.id);
    const src = full.data;
    const steps: Partial<FunnelStep>[] | undefined = src?.steps?.map((s, i) => ({
      name: s.name,
      step_type: s.step_type,
      position: i,
      page: s.page
        ? {
            id: '',
            funnel_id: '',
            step_id: '',
            title: s.page.title,
            blocks: (s.page.blocks || []).map((bl) => ({
              ...bl,
              id: crypto.randomUUID(),
            })),
          }
        : null,
    }));
    const res = await createFunnel({
      name: `${f.name} (copie)`,
      industry: f.industry ?? null,
      status: 'draft',
      ...(steps ? { steps: steps as FunnelStep[] } : {}),
    });
    if (res.data?.id) {
      // Renforcement : toast succès distinct pour duplication (vs save générique).
      success(t('funnel.duplicate.success'));
      void load();
    } else {
      toastError(res.error || t('funnel.error.create'));
    }
    } catch {
      // Renforcement (CLAUDE.md "Aucun console.log") : swallow + toast erreur.
      toastError(t('funnel.error.create'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (f: Funnel) => {
    // Renforcement : confirm danger enrichi — description avec mention
    // "irréversible" et perte des stats/étapes (vs juste le nom).
    const ok = await confirm({
      title: t('funnel.step.delete'),
      description: t('funnel.delete.confirm_desc', { name: f.name }),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteFunnel(f.id);
    if (res.data) {
      setFunnels((prev) => prev.filter((x) => x.id !== f.id));
      // Renforcement : toast succès dédié (delete), pas générique save.
      success(t('funnel.delete.success'));
    } else {
      toastError(res.error || t('funnel.error.not_found'));
    }
  };

  const handlePublish = async (f: Funnel) => {
    const res = await publishFunnel(f.id);
    if (res.data?.url) {
      success(t('funnel.publish.live'));
      void load();
    } else {
      toastError(res.error || t('funnel.error.publish'));
    }
  };

  return (
    <AppLayout title={t('funnel.list.title')}>
      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="t-h1">{t('funnel.list.title')}</h1>
            <p className="text-muted">{t('funnel.list.subtitle')}</p>
          </div>
          <Button
            variant="primary"
            leftIcon={<Icon as={Plus} size="sm" />}
            onClick={() => setCreateOpen(true)}
          >
            {t('funnel.list.new')}
          </Button>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-live="polite">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-5">
                <Skeleton className="h-5 w-2/3 mb-3" />
                <Skeleton className="h-3 w-1/3 mb-4" />
                <Skeleton className="h-10 w-full rounded-md" />
              </Card>
            ))}
          </div>
        ) : loadError ? (
          <EmptyState
            icon={<Icon as={LayoutTemplate} size={40} />}
            title={t('funnel.list.error_load')}
            description={t('funnel.list.error_load_desc')}
            action={
              <Button variant="primary" onClick={() => void load()}>
                {t('funnel.list.retry')}
              </Button>
            }
          />
        ) : funnels.length === 0 ? (
          <EmptyState
            icon={<Icon as={LayoutTemplate} size={40} />}
            title={t('funnel.list.empty')}
            action={
              <Button
                variant="primary"
                leftIcon={<Icon as={Plus} size="sm" />}
                onClick={() => setCreateOpen(true)}
              >
                {t('funnel.list.new')}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {funnels.map((f) => {
              const slug = f.publication?.slug;
              const isLive =
                f.status === 'published' && !!f.publication?.is_active;
              return (
                <Card key={f.id} className="p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      className="text-left font-semibold leading-tight hover:underline"
                      onClick={() =>
                        navigate({
                          to: '/funnels/$funnelId',
                          params: { funnelId: f.id },
                        })
                      }
                    >
                      {f.name}
                    </button>
                    <Tag variant={statusVariant(f.status)} size="sm" statusIcon>
                      {t(`funnel.status.${f.status}`)}
                    </Tag>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-muted">
                    <span title={t('funnel.analytics.views')}>
                      <Icon as={Eye} size="sm" /> {f.total_views ?? 0}
                    </span>
                    <span title={t('funnel.analytics.submissions')}>
                      <Icon as={Send} size="sm" /> {f.total_submissions ?? 0}
                    </span>
                    <span title={t('funnel.analytics.conversions')}>
                      ✓ {f.total_conversions ?? 0}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-auto pt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Icon as={Pencil} size="sm" />}
                      onClick={() =>
                        navigate({
                          to: '/funnels/$funnelId',
                          params: { funnelId: f.id },
                        })
                      }
                    >
                      {t('funnel.builder.title')}
                    </Button>
                    {isLive && slug ? (
                      <a
                        className="chip-btn chip-btn--sm"
                        href={`/p/${slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon as={ExternalLink} size="sm" />{' '}
                        {t('funnel.publish.live')}
                      </a>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Icon as={Send} size="sm" />}
                        onClick={() => void handlePublish(f)}
                      >
                        {t('funnel.publish.button')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      leftIcon={<Icon as={Copy} size="sm" />}
                      onClick={() => void handleDuplicate(f)}
                      aria-label={t('funnel.action.duplicate_aria', { name: f.name })}
                      title={t('fb.props.duplicate')}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Icon as={Trash2} size="sm" />}
                      onClick={() => void handleDelete(f)}
                      aria-label={t('funnel.action.delete_aria', { name: f.name })}
                      title={t('funnel.step.delete')}
                    />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t('funnel.create.title')}
        size="sm"
      >
        <div className="flex flex-col gap-4 p-1">
          <div>
            <label className="prop-label">{t('funnel.create.name')}</label>
            <Input
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
            />
          </div>
          <div>
            <label className="prop-label">
              {t('funnel.create.from_template')}
            </label>
            <Select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">{t('funnel.create.from_blank')}</option>
              {FUNNEL_TEMPLATES.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              isLoading={busy}
              disabled={!newName.trim()}
              onClick={() => void handleCreate()}
            >
              {t('funnel.create.title')}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
