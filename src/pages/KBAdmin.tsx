// ── KBAdmin — gestion base de connaissances (LOT G1 HELPDESK, Sprint 8) ────
//
// Phase B Manager-C (front exclusif). Liste des articles (listKBArticles) +
// éditeur en panneau slide-over : titre + catégorie + body markdown (textarea
// simple v1) + toggle publish/draft. Create/update/delete via les helpers api
// FIGÉS Phase A. Suppression confirmée via useConfirm. Lien "voir public" →
// /help/$slug. i18n t('kb.*') — clés figées Phase A.
//
// La route /kb/$articleId ouvre l'édition (même page, panneau slide-over).

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  SlidePanel,
  Skeleton,
  Tag,
  Textarea,
  useConfirm,
  useToast,
} from '@/components/ui';
import {
  listKBArticles,
  getKBArticle,
  createKBArticle,
  updateKBArticle,
  deleteKBArticle,
  type KBArticle,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import { BookOpen, ExternalLink, Plus, Trash2, Eye } from 'lucide-react';

type Draft = {
  id?: string;
  title: string;
  category: string;
  body_md: string;
  status: 'draft' | 'published';
  slug?: string | null;
};

const EMPTY_DRAFT: Draft = {
  title: '',
  category: '',
  body_md: '',
  status: 'draft',
};

export function KBAdminPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { success, error: toastError } = useToast();
  const { articleId } = useParams({ strict: false }) as { articleId?: string };

  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [loading, setLoading] = useState(true);
  // Renforcement — error state
  const [loadError, setLoadError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listKBArticles();
      if (res.error) {
        setLoadError(res.error);
      } else if (res.data) {
        setArticles(res.data);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('kb.error.load_failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = useCallback(async (id?: string) => {
    if (!id) {
      setDraft(EMPTY_DRAFT);
      setOpen(true);
      return;
    }
    setOpen(true);
    const res = await getKBArticle(id);
    if (res.data) {
      const a = res.data;
      setDraft({
        id: a.id,
        title: a.title || '',
        category: a.category || '',
        body_md: a.body_md || '',
        status: a.status === 'published' ? 'published' : 'draft',
        slug: a.slug,
      });
    }
  }, []);

  // Route /kb/$articleId → ouvre l'éditeur sur cet article.
  useEffect(() => {
    if (articleId) void openEditor(articleId);
  }, [articleId, openEditor]);

  const closeEditor = (next: boolean) => {
    if (next) return;
    setOpen(false);
    setDraft(EMPTY_DRAFT);
    if (articleId) navigate({ to: '/kb' }).catch(() => {});
  };

  const save = async (publish?: boolean) => {
    if (!draft.title.trim()) {
      toastError(t('kb.title'));
      return;
    }
    setSaving(true);
    const payload: Partial<KBArticle> = {
      title: draft.title.trim(),
      category: draft.category.trim() || null,
      body_md: draft.body_md,
      status: publish !== undefined ? (publish ? 'published' : 'draft') : draft.status,
    };
    const res = draft.id
      ? await updateKBArticle(draft.id, payload)
      : await createKBArticle(payload);
    setSaving(false);
    if (res.error) {
      toastError(res.error);
      return;
    }
    success(draft.id ? t('kb.title') : t('kb.publish'));
    closeEditor(false);
    void load();
  };

  const remove = async (a: KBArticle) => {
    const ok = await confirm({
      title: t('kb.confirm.delete_title', { title: a.title || t('kb.title.untitled') }),
      description: t('kb.confirm.delete_desc'),
      confirmLabel: t('kb.action.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await deleteKBArticle(a.id);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('kb.toast.deleted'));
      void load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('kb.toast.delete_failed'));
    }
  };

  return (
    <AppLayout title={t('kb.title')}>
      <div className="page-kb-admin" style={{ padding: '4px 0' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ marginRight: 'auto' }}>
            <h1 className="t-h1" style={{ marginBottom: 2 }}>
              {t('kb.title')}
            </h1>
            <p className="t-caption">{t('kb.articles_count', { n: articles.length })}</p>
          </div>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={14} />}
            onClick={() => openEditor()}
          >
            {t('kb.new')}
          </Button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy="true" aria-live="polite">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-[var(--radius-md)]" />
            ))}
          </div>
        ) : loadError ? (
          /* Renforcement — error state */
          <Card className="p-6" role="alert" aria-live="assertive">
            <p className="text-sm font-semibold text-[var(--danger)] mb-1">
              {t('kb.error.load_failed')}
            </p>
            <p className="text-xs text-[var(--text-muted)] mb-3 break-all">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={() => { void load(); }}>
              {t('kb.action.retry')}
            </Button>
          </Card>
        ) : articles.length === 0 ? (
          <Card>
            <EmptyState
              icon={<BookOpen size={48} />}
              variant="first-time"
              title={t('kb.empty.title')}
              description={t('kb.empty.description')}
              action={
                <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => openEditor()}>
                  {t('kb.new')}
                </Button>
              }
            />
          </Card>
        ) : (
          <Card className="!p-0 overflow-hidden">
            <div className="kb-table" role="table" aria-live="polite">
              <div className="kb-row kb-row--head" role="row">
                <span role="columnheader">{t('kb.title')}</span>
                <span role="columnheader">{t('kb.category')}</span>
                <span role="columnheader">{t('kb.status')}</span>
                <span role="columnheader">{t('kb.column.views')}</span>
                <span role="columnheader" aria-label={t('kb.action.delete')} />
              </div>
              {articles.map((a) => (
                <div key={a.id} className="kb-row" role="row">
                  <button
                    type="button"
                    className="kb-cell-title"
                    role="cell"
                    onClick={() => openEditor(a.id)}
                  >
                    {a.title || t('kb.title.untitled')}
                  </button>
                  <span role="cell" className="t-caption">
                    {a.category || '—'}
                  </span>
                  <span role="cell">
                    <Tag
                      variant={a.status === 'published' ? 'success' : 'neutral'}
                      size="xs"
                      statusIcon
                    >
                      {a.status === 'published' ? t('kb.publish') : t('kb.status.draft')}
                    </Tag>
                  </span>
                  <span role="cell" className="t-caption tabular-nums">
                    {a.view_count ?? 0}
                  </span>
                  <span role="cell" className="kb-cell-actions">
                    {a.status === 'published' && a.slug && (
                      <a
                        href={`/help-center/${a.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="kb-icon-link"
                        title={t('kb.action.view_public')}
                        aria-label={t('kb.action.view_public')}
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                      </a>
                    )}
                    <button
                      type="button"
                      className="kb-icon-link kb-icon-link--danger"
                      onClick={() => remove(a)}
                      title={t('kb.action.delete')}
                      aria-label={t('kb.action.delete')}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* ── Éditeur slide-over ───────────────────────────────────────────── */}
      <SlidePanel
        open={open}
        onOpenChange={closeEditor}
        size="lg"
        title={draft.id ? draft.title || t('kb.title') : t('kb.title')}
        description={draft.id ? t('kb.body') : undefined}
        closeLabel={t('kb.action.close')}
        headerActions={
          draft.id && draft.status === 'published' && draft.slug ? (
            <a
              href={`/help-center/${draft.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="kb-icon-link"
              title={t('kb.action.view_public')}
              aria-label={t('kb.action.view_public')}
            >
              <Eye size={16} aria-hidden="true" />
            </a>
          ) : undefined
        }
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              size="sm"
              isLoading={saving}
              aria-busy={saving}
              disabled={saving}
              onClick={() => save(false)}
            >
              {t('kb.action.save_draft')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={saving}
              aria-busy={saving}
              disabled={saving}
              onClick={() => save(true)}
            >
              {t('kb.publish')}
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input
            label={t('kb.title')}
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder={t('kb.title')}
          />
          <Select
            label={t('kb.category')}
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
          >
            <option value="">{t('kb.category')}</option>
            <option value="general">{t('kb_admin.category.general')}</option>
            <option value="facturation">{t('kb_admin.category.billing')}</option>
            <option value="technique">{t('kb_admin.category.technical')}</option>
            <option value="compte">{t('kb_admin.category.account')}</option>
          </Select>
          <Textarea
            label={t('kb.body')}
            value={draft.body_md}
            onChange={(e) => setDraft((d) => ({ ...d, body_md: e.target.value }))}
            placeholder={t('kb.body.placeholder')}
            rows={14}
            helper={t('kb.body.helper')}
          />
        </div>
      </SlidePanel>
    </AppLayout>
  );
}
