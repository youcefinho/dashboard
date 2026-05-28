// ── Forms — liste / gestion des formulaires (LOT FORMS XL, Sprint 5) ───────
//
// Manager-C Phase B (front). Liste getForms() · KPIs (vues / soumissions /
// conversion) · création (createForm puis navigation vers le builder — corrige
// le flux `formId='new'` qui 404) · éditer (→ builder) · supprimer (deleteForm).
// i18n t('forms.list.*') — clés FIGÉES Phase A, AUCUNE création. Helpers api
// FIGÉS Phase A consommés tels quels. Style Stripe sobre, primitives existantes.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button,
  Card,
  Icon,
  Modal,
  Input,
  Skeleton,
  EmptyState,
  KpiStrip,
  useToast,
  useConfirm,
} from '@/components/ui';
import type { KpiItem } from '@/components/ui';
import { FormSubmissionsPanel } from '@/components/forms/FormSubmissionsPanel';
import { Plus, FileText, Pencil, Trash2, ExternalLink, Inbox } from 'lucide-react';
import {
  getForms,
  createForm,
  deleteForm,
  getActiveSubAccount,
} from '@/lib/api';
import { t } from '@/lib/i18n';

interface FormRow {
  id: string;
  name: string;
  slug: string;
  client_id: string;
  total_views: number;
  total_submissions: number;
  is_active: number;
}

function toRow(r: Record<string, unknown>): FormRow {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    slug: String(r.slug ?? ''),
    client_id: String(r.client_id ?? ''),
    total_views: Number(r.total_views ?? 0),
    total_submissions: Number(r.total_submissions ?? 0),
    is_active: Number(r.is_active ?? 1),
  };
}

function conversion(views: number, subs: number): string {
  if (!views || views <= 0) return '0';
  return ((subs / views) * 100).toFixed(1);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
}

export function FormsPage() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [forms, setForms] = useState<FormRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  // Panneau « Voir les soumissions » (+ analytics par champ). 100% additif.
  const [submissionsFor, setSubmissionsFor] = useState<FormRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const res = await getForms();
    if (res.data) setForms(res.data.map(toRow));
    else setLoadError(res.error || t('common.loading_error'));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = useMemo<KpiItem[]>(() => {
    const totalViews = forms.reduce((a, f) => a + f.total_views, 0);
    const totalSubs = forms.reduce((a, f) => a + f.total_submissions, 0);
    return [
      { label: t('forms.list.col_views'), value: totalViews, color: 'brand' },
      { label: t('forms.list.col_submissions'), value: totalSubs, color: 'success' },
      { label: t('forms.list.col_conversion'), value: `${conversion(totalViews, totalSubs)}%`, color: 'warning' },
    ];
  }, [forms]);

  // Flux de création propre : `getForm('new')` renverrait 404 — on crée d'abord
  // via createForm puis on navigue vers le builder avec l'id réel.
  // client_id : dérivé d'un formulaire existant (mono-tenant) sinon du sous-compte
  // actif. handleCreateForm exige client_id|name|slug (worker §forms.ts).
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    const clientId = forms[0]?.client_id || getActiveSubAccount() || '';
    const baseSlug = slugify(name) || `form-${Date.now()}`;
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await createForm({ client_id: clientId, name, slug, fields: [] });
    setBusy(false);
    if (res.data?.id) {
      setCreateOpen(false);
      setNewName('');
      navigate({ to: '/forms/builder/$formId', params: { formId: res.data.id } });
    } else {
      // Renforcement : fallback toast vers clé dédiée (création), pas
      // 'forms.list.new' (libellé du bouton, hors-contexte erreur).
      toastError(res.error || t('forms.list.create_error'));
    }
  };

  const handleDelete = async (f: FormRow) => {
    // Renforcement : confirm danger enrichi — titre dédié + description avec
    // count submissions pour informer du risque (perte d'historique) +
    // mention "irréversible". 100% additif, calque Pipeline.tsx delete.
    const ok = await confirm({
      title: t('forms.list.delete_confirm_title'),
      description: t('forms.list.delete_confirm_desc', {
        name: f.name || f.slug,
        count: f.total_submissions,
      }),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteForm(f.id);
    if (res.data) {
      setForms(prev => prev.filter(x => x.id !== f.id));
      // Renforcement : toast succès dédié au lieu du libellé action générique.
      success(t('forms.list.delete_success'));
    } else {
      // Renforcement : fallback erreur dédié au lieu de 'public_form.not_found'
      // (hors-contexte, libellé du formulaire public introuvable).
      toastError(res.error || t('forms.list.delete_error'));
    }
  };

  return (
    <AppLayout title={t('forms.list.title')}>
      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <h1 className="t-h1">{t('forms.list.title')}</h1>
          <Button
            variant="primary"
            leftIcon={<Icon as={Plus} size="sm" />}
            onClick={() => setCreateOpen(true)}
          >
            {t('forms.list.new')}
          </Button>
        </div>

        {!isLoading && !loadError && forms.length > 0 && <KpiStrip items={kpis} className="mb-6" />}

        {isLoading ? (
          <Card className="p-5" aria-busy="true" aria-live="polite">
            <span className="sr-only">{t('common.loading')}</span>
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          </Card>
        ) : loadError ? (
          <Card className="p-5" role="alert">
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t('common.loading_error')}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{loadError}</p>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                {t('common.retry')}
              </Button>
            </div>
          </Card>
        ) : forms.length === 0 ? (
          <EmptyState
            icon={<Icon as={FileText} size={40} />}
            title={t('forms.list.empty')}
            action={
              <Button
                variant="primary"
                leftIcon={<Icon as={Plus} size="sm" />}
                onClick={() => setCreateOpen(true)}
              >
                {t('forms.list.new')}
              </Button>
            }
          />
        ) : (
          <Card className="p-0 overflow-hidden">
            {/* Renforcement a11y : <caption> sr-only pour annoncer la nature
                de la table aux lecteurs d'écran (WCAG 1.3.1). */}
            <table className="w-full text-sm">
              <caption className="sr-only">{t('forms.list.table_caption')}</caption>
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                  <th scope="col" className="px-4 py-3 font-medium">{t('forms.list.col_name')}</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">{t('forms.list.col_views')}</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">{t('forms.list.col_submissions')}</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">{t('forms.list.col_conversion')}</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">
                    <span className="sr-only">{t('action.edit')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {forms.map(f => (
                  <tr key={f.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-canvas)]">
                    <td className="px-4 py-3">
                      <button
                        className="text-left font-medium text-[var(--text-primary)] hover:underline"
                        onClick={() => navigate({ to: '/forms/builder/$formId', params: { formId: f.id } })}
                        aria-label={t('forms.list.action_open_aria', { name: f.name || f.slug })}
                      >
                        {f.name || f.slug}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{f.total_views}</td>
                    <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{f.total_submissions}</td>
                    <td className="px-4 py-3 text-right text-[var(--text-secondary)]">
                      {conversion(f.total_views, f.total_submissions)}%
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {f.slug && (
                          <a
                            className="chip-btn chip-btn--sm"
                            href={`/f/${f.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t('forms.list.action_public_aria', { name: f.name || f.slug })}
                          >
                            <Icon as={ExternalLink} size="sm" aria-hidden="true" />
                          </a>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Icon as={Inbox} size="sm" />}
                          onClick={() => setSubmissionsFor(f)}
                          aria-label={t('formsx.action_view_aria', { name: f.name || f.slug })}
                          title={t('formsx.action_view')}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Icon as={Pencil} size="sm" />}
                          onClick={() => navigate({ to: '/forms/builder/$formId', params: { formId: f.id } })}
                          aria-label={t('forms.list.action_open_aria', { name: f.name || f.slug })}
                          title={t('action.edit')}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Icon as={Trash2} size="sm" />}
                          onClick={() => void handleDelete(f)}
                          aria-label={t('funnel.action.delete_aria', { name: f.name || f.slug })}
                          title={t('action.delete')}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {submissionsFor && (
        <FormSubmissionsPanel
          open={!!submissionsFor}
          onOpenChange={open => { if (!open) setSubmissionsFor(null); }}
          formId={submissionsFor.id}
          formName={submissionsFor.name || submissionsFor.slug}
        />
      )}

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t('forms.list.new')} size="sm">
        <div className="flex flex-col gap-4 p-1">
          <div>
            <label className="prop-label">{t('forms.list.col_name')}</label>
            <Input
              value={newName}
              autoFocus
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>{t('action.cancel')}</Button>
            <Button variant="primary" isLoading={busy} disabled={!newName.trim()} onClick={() => void handleCreate()}>
              {t('forms.list.new')}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
