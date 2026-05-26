// ── Sites — liste des sites web multi-pages (LOT SITE BUILDER, Sprint 10) ────
//
// Manager-C Phase B (frontend) — fichier NOUVEAU (§6.G/§6.H), export
// `SitesPage`. CALQUE src/pages/Funnels.tsx (LOT FUNNEL) : liste getSites() ·
// création (createSite — vierge ou gabarit site-templates → va au builder) ·
// supprimer (deleteSite) · publier (publishSite) · ouvrir le builder
// (/sites/$siteId). Statut draft/published/archived. i18n t('site.*') (clés
// figées Phase A — AUCUNE création). Helpers api FIGÉS Phase A consommés tels
// quels.

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
  Trash2,
  ExternalLink,
  Eye,
  Send,
  Pencil,
} from 'lucide-react';
import {
  getSites,
  createSite,
  deleteSite,
  publishSite,
  type Site,
} from '@/lib/api';
import { SITE_TEMPLATES, instantiateTemplatePages } from './site-templates';
import { t } from '@/lib/i18n';

function statusVariant(s: Site['status']): 'success' | 'warning' | 'neutral' {
  if (s === 'published') return 'success';
  if (s === 'archived') return 'neutral';
  return 'warning';
}

export function SitesPage() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // ── Sprint LOT 1-3 — Error state inline + retry (gap audit Sites) ──
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState(''); // '' = vierge
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await getSites();
      if (res.data) {
        setSites(res.data);
      } else if (res.error) {
        setLoadError(res.error);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('sites.error.load_failed'));
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
    const tmpl = SITE_TEMPLATES.find((x) => x.id === templateId);
    const res = await createSite({
      name,
      description: tmpl?.description ?? null,
      status: 'draft',
      ...(tmpl
        ? {
            nav_json: JSON.stringify(tmpl.nav),
            pages: instantiateTemplatePages(tmpl),
          }
        : {}),
    });
    setBusy(false);
    if (res.data?.id) {
      setCreateOpen(false);
      setNewName('');
      setTemplateId('');
      success(t('site.builder.saved'));
      navigate({ to: '/sites/$siteId', params: { siteId: res.data.id } });
    } else {
      toastError(res.error || t('site.error.create'));
    }
  };

  const handleDelete = async (s: Site) => {
    // Renforcement : confirm danger enrichi — description "irréversible" +
    // mention perte de toutes les pages (vs juste le nom).
    const ok = await confirm({
      title: t('site.page.delete'),
      description: t('site.delete.confirm_desc', { name: s.name }),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteSite(s.id);
    if (res.data) {
      setSites((prev) => prev.filter((x) => x.id !== s.id));
      // Renforcement : toast succès dédié (delete), pas générique save.
      success(t('site.delete.success'));
    } else {
      toastError(res.error || t('site.error.save'));
    }
  };

  const handlePublish = async (s: Site) => {
    const res = await publishSite(s.id);
    if (res.data?.url) {
      // Renforcement : toast succès dédié (publish), pas libellé du bouton.
      success(t('site.publish.success'));
      void load();
    } else {
      toastError(res.error || t('site.error.publish'));
    }
  };

  return (
    <AppLayout title={t('site.list.title')}>
      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="t-h1">{t('site.list.title')}</h1>
            <p className="text-muted">{t('site.list.subtitle')}</p>
          </div>
          <Button
            variant="primary"
            leftIcon={<Icon as={Plus} size="sm" />}
            onClick={() => setCreateOpen(true)}
          >
            {t('site.list.new')}
          </Button>
        </div>

        {isLoading ? (
          <div
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-busy="true"
            aria-live="polite"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-5">
                <Skeleton className="h-5 w-2/3 mb-3" />
                <Skeleton className="h-3 w-1/3 mb-4" />
                <Skeleton className="h-10 w-full rounded-md" />
              </Card>
            ))}
          </div>
        ) : loadError ? (
          // Sprint LOT 1-3 — Error inline + retry (gap audit Sites)
          <Card className="p-6 border border-[var(--danger)]/30" role="alert" aria-live="assertive">
            <p className="text-sm font-semibold text-[var(--danger)] mb-1">
              {t('sites.error.load_failed')}
            </p>
            <p className="text-xs text-[var(--text-muted)] mb-3 break-all">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              {t('action.retry')}
            </Button>
          </Card>
        ) : sites.length === 0 ? (
          <EmptyState
            icon={<Icon as={LayoutTemplate} size={40} />}
            title={t('site.list.empty')}
            action={
              <Button
                variant="primary"
                leftIcon={<Icon as={Plus} size="sm" />}
                onClick={() => setCreateOpen(true)}
              >
                {t('site.list.new')}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((s) => {
              const slug = s.publication?.slug;
              const isLive =
                s.status === 'published' && !!s.publication?.is_active;
              return (
                <Card key={s.id} className="p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      className="text-left font-semibold leading-tight hover:underline"
                      onClick={() =>
                        navigate({
                          to: '/sites/$siteId',
                          params: { siteId: s.id },
                        })
                      }
                    >
                      {s.name}
                    </button>
                    <Tag variant={statusVariant(s.status)} size="sm" statusIcon>
                      {t(`site.status.${s.status}`)}
                    </Tag>
                  </div>

                  {s.description ? (
                    <p className="text-sm text-muted line-clamp-2">
                      {s.description}
                    </p>
                  ) : null}

                  <div className="flex items-center gap-4 text-sm text-muted">
                    {/* Sprint LOT 1-3 — a11y : label sémantique sur compteur de vues */}
                    <span
                      title={t('sites.view_count')}
                      aria-label={`${t('sites.view_count')} : ${s.total_views ?? 0}`}
                    >
                      <Icon as={Eye} size="sm" aria-hidden="true" /> {s.total_views ?? 0}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-auto pt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Icon as={Pencil} size="sm" />}
                      onClick={() =>
                        navigate({
                          to: '/sites/$siteId',
                          params: { siteId: s.id },
                        })
                      }
                    >
                      {t('site.builder.title')}
                    </Button>
                    {isLive && slug ? (
                      <a
                        className="chip-btn chip-btn--sm"
                        href={`/site/${slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${t('sites.open_published')} : ${s.name}`}
                      >
                        <Icon as={ExternalLink} size="sm" aria-hidden="true" />{' '}
                        {t('site.status.published')}
                      </a>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Icon as={Send} size="sm" />}
                        onClick={() => void handlePublish(s)}
                      >
                        {t('site.publish.button')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Icon as={Trash2} size="sm" />}
                      onClick={() => void handleDelete(s)}
                      aria-label={t('site.action.delete_aria', { name: s.name })}
                      title={t('site.page.delete')}
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
        title={t('site.list.new')}
        size="sm"
      >
        <div className="flex flex-col gap-4 p-1">
          <div>
            <label className="prop-label">{t('site.list.title')}</label>
            <Input
              value={newName}
              autoFocus
              placeholder={t('site.list.new')}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
            />
          </div>
          <div>
            <label className="prop-label">{t('site.builder.pages')}</label>
            <Select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">{t('action.create')}</option>
              {SITE_TEMPLATES.map((tm) => (
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
              {t('site.list.new')}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
