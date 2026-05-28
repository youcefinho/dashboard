import { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Tag, Skeleton, EmptyState, useConfirm, KpiStrip, Textarea, PageHero, Icon } from '@/components/ui';
import type { KpiItem } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { getDocumentTemplates, createDocumentTemplate, updateDocumentTemplate, deleteDocumentTemplate, type DocumentTemplate } from '@/lib/api';
import { FileText, Plus, Trash2, Edit, CheckCircle2 } from 'lucide-react';
import { t } from '@/lib/i18n';

export function DocumentTemplatesPage() {
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newHtml, setNewHtml] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = editingId !== null;
  const isFormOpen = isCreating || isEditing;

  const closeForm = () => {
    setIsCreating(false);
    setEditingId(null);
    setNewTitle('');
    setNewHtml('');
    setActionError(null);
  };

  const startEdit = (tpl: DocumentTemplate) => {
    setActionError(null);
    setIsCreating(false);
    setEditingId(tpl.id);
    setNewTitle(tpl.name);
    setNewHtml(tpl.body_html);
  };

  const loadTemplates = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await getDocumentTemplates();
      setTemplates(res.data || []);
    } catch (e) {
      console.error(e);
      setLoadError(t('doc_tpl.error_load'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  const handleSave = async () => {
    const name = newTitle.trim();
    const html = newHtml.trim();
    if (!name || !html || isSaving) return;
    setActionError(null);
    setIsSaving(true);
    try {
      if (editingId) {
        await updateDocumentTemplate(editingId, { name, body_html: html });
      } else {
        await createDocumentTemplate({ name, body_html: html, category: 'contract' });
      }
      closeForm();
      void loadTemplates();
    } catch (e) {
      console.error(e);
      setActionError(t(editingId ? 'doctpl.error_update' : 'doc_tpl.error_create'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: t('doc_tpl.confirm.title'),
      description: t('doc_tpl.confirm.desc_named', { name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      await deleteDocumentTemplate(id);
      void loadTemplates();
    } catch (e) {
      console.error(e);
      setActionError(t('doc_tpl.error_delete'));
    }
  };

  // ── KPI computed (total templates / utilisés ce mois) ──
  const kpis: KpiItem[] = useMemo(() => {
    const total = templates.length;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const recentCount = templates.filter(t => {
      const created = new Date(t.created_at);
      return created >= monthStart;
    }).length;
    return [
      { label: t('doc_tpl.kpi.total'), value: total, color: 'brand', icon: <Icon as={FileText} size={12} /> },
      { label: t('doc_tpl.kpi.month'), value: recentCount, color: 'success', icon: <Icon as={CheckCircle2} size={12} /> },
    ];
  }, [templates]);

  return (
    <AppLayout title={t('doc_tpl.page.title')}>
      <PageHero
        meta={t('doc_tpl.hero.meta')}
        title={t('doc_tpl.page.title')}
        highlight={t('doc_tpl.page.title')}
        description={t('doc_tpl.hero.desc')}
        actions={!isFormOpen && (
          <Button variant="premium" onClick={() => { closeForm(); setIsCreating(true); }} leftIcon={<Icon as={Plus} size="sm" />}>
            {t('doc_tpl.action.new')}
          </Button>
        )}
      />

      {!isLoading && templates.length > 0 && <KpiStrip items={kpis} />}

      {actionError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 px-4 py-3 rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] text-sm text-[var(--danger)] flex items-center justify-between gap-3"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs underline hover:no-underline"
            aria-label={t('doc_tpl.error_dismiss')}
          >
            {t('doc_tpl.error_dismiss')}
          </button>
        </div>
      )}

      {isFormOpen && (
        <Card className="p-6 mb-6 animate-fade-in border border-[var(--primary)]">
          <h3 className="text-lg font-bold mb-4">{isEditing ? t('doctpl.form.edit_title') : t('doc_tpl.form.title')}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="doc-tpl-name">{t('doc_tpl.form.name')}</label>
              <Input
                id="doc-tpl-name"
                placeholder={t('doc_tpl.form.name_placeholder')}
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="doc-tpl-content">{t('doc_tpl.form.content')}</label>
              <Textarea
                id="doc-tpl-content"
                rows={12}
                className="font-mono text-xs"
                placeholder={t('doc_tpl.form.content_placeholder')}
                value={newHtml}
                onChange={e => setNewHtml(e.target.value)}
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {t('doc_tpl.form.variables_hint')}
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={closeForm}>{t('doc_tpl.form.cancel')}</Button>
              <Button onClick={() => void handleSave()} disabled={isSaving || !newTitle.trim() || !newHtml.trim()}>
                {isSaving ? t('doc_tpl.form.saving') : isEditing ? t('doctpl.form.update') : t('doc_tpl.form.save')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-live="polite">
          {/* KPI strip skeleton */}
          <div className="flex gap-3">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-20 flex-1 rounded-2xl" />)}
          </div>
          {/* Grid 6 cards */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-3/4 mb-4" />
                <div className="flex gap-2 pt-3 border-t border-[var(--border-subtle)]">
                  <Skeleton className="h-7 w-20 rounded-md" />
                  <Skeleton className="h-7 w-7 rounded-md ml-auto" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : loadError ? (
        <EmptyState
          icon={<Icon as={FileText} size={40} />}
          title={loadError}
          description={t('doc_tpl.error_load_desc')}
          action={<Button variant="primary" onClick={() => void loadTemplates()}>{t('doc_tpl.error_retry')}</Button>}
        />
      ) : templates.length === 0 && !isFormOpen ? (
        <EmptyState
          variant="first-time"
          icon={<Icon as={FileText} size={48} />}
          title={t('doc_tpl.empty.title')}
          description={t('doc_tpl.empty.desc')}
          action={<Button variant="primary" onClick={() => setIsCreating(true)}>{t('doc_tpl.empty.action')}</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(tpl => {
            const vars = tpl.body_html.match(/\{\{([^}]+)\}\}/g)?.slice(0, 5).join(', ');
            return (
            <div key={tpl.id} className="card-premium p-5 flex flex-col list-item-enter">
              <div className="flex justify-between items-start mb-3">
                <Tag variant="brand" size="sm">{t('doctemplates.card.badge')}</Tag>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(tpl)}
                    aria-label={t('doc_tpl.action.edit_aria', { name: tpl.name })}
                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--primary)] rounded hover:bg-[var(--bg-subtle)] transition-colors"
                  >
                    <Icon as={Edit} size="sm" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(tpl.id, tpl.name)}
                    aria-label={t('doc_tpl.action.delete_aria', { name: tpl.name })}
                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] rounded hover:bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] transition-colors"
                  >
                    <Icon as={Trash2} size="sm" />
                  </button>
                </div>
              </div>
              <h3 className="font-bold text-lg mb-1 line-clamp-1">{tpl.name}</h3>
              <p className="text-xs text-[var(--text-muted)] mb-4 flex-1">
                {t('doc_tpl.card.created_on', { date: new Date(tpl.created_at).toLocaleDateString('fr-CA') })}
              </p>
              <div className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-subtle)] p-2 rounded">
                {t('doc_tpl.card.variables_label')}: {vars || t('doc_tpl.card.variables_none')}...
              </div>
            </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
