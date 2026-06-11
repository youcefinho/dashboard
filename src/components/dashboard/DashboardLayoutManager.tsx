// ── Dashboard Layout Manager — CRUD des layouts personnalisés (Sprint 6 D4) ──
// Surface l'API existante getDashboardLayouts / createDashboardLayout /
// updateDashboardLayout / deleteDashboardLayout. 100 % additif : ne touche pas
// au rendu par défaut du dashboard. Le layout_json sérialise la config widgets
// (même forme que WidgetConfig[] persistée en localStorage côté page).

import { useState, useEffect, useCallback, useId } from 'react';
import {
  getDashboardLayouts,
  createDashboardLayout,
  updateDashboardLayout,
  deleteDashboardLayout,
  type DashboardLayout,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import { LayoutGrid, Plus, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react';

// La forme stockée dans layout_json — laissée générique pour découpler de la page.
export interface LayoutPayload {
  widgets: unknown;
}

interface Props {
  /** Config widgets courante de la page, à sauvegarder dans un nouveau layout. */
  currentWidgets: unknown;
  /** Applique la config widgets d'un layout chargé au dashboard. */
  onApplyLayout: (widgets: unknown) => void;
}

export function DashboardLayoutManager({ currentWidgets, onApplyLayout }: Props) {
  const [layouts, setLayouts] = useState<DashboardLayout[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Création / renommage
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string>('');
  const [renameName, setRenameName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>('');

  const selectId = useId();
  const newNameId = useId();

  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 3000);
  }, []);

  const loadLayouts = useCallback(async () => {
    setIsLoading(true);
    setError('');
    const res = await getDashboardLayouts();
    if (res.error) setError(res.error);
    else {
      // Parsing défensif : réponse null/non-tableau → liste vide plutôt que crash.
      const rows = Array.isArray(res.data) ? res.data : [];
      setLayouts(rows);
      const def = rows.find(l => l.is_default === 1);
      if (def) setActiveId(prev => prev || def.id);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { void loadLayouts(); }, [loadLayouts]);

  const parseWidgets = (layout: DashboardLayout): unknown => {
    try {
      const parsed = JSON.parse(layout.layout_json) as Partial<LayoutPayload> | unknown[];
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object' && 'widgets' in parsed) {
        return (parsed as LayoutPayload).widgets;
      }
      return null;
    } catch {
      return null;
    }
  };

  const handleSelect = (id: string) => {
    setActiveId(id);
    if (!id) return;
    const layout = layouts.find(l => l.id === id);
    if (!layout) return;
    const widgets = parseWidgets(layout);
    if (widgets != null) {
      onApplyLayout(widgets);
      flashNotice(t('dashboards.applied', { name: layout.name }));
    } else {
      setError(t('dashboards.error.parse'));
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    const res = await createDashboardLayout({
      name,
      layout_json: JSON.stringify({ widgets: currentWidgets } satisfies LayoutPayload),
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setCreating(false);
    setNewName('');
    if (res.data?.id) setActiveId(res.data.id);
    flashNotice(t('dashboards.created', { name }));
    await loadLayouts();
  };

  const startRename = (layout: DashboardLayout) => {
    setRenamingId(layout.id);
    setRenameName(layout.name);
    setConfirmDeleteId('');
  };

  const handleRename = async (id: string) => {
    const name = renameName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    const res = await updateDashboardLayout(id, { name });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setRenamingId('');
    flashNotice(t('dashboards.renamed', { name }));
    await loadLayouts();
  };

  const handleSaveCurrent = async (id: string) => {
    setBusy(true);
    setError('');
    const res = await updateDashboardLayout(id, {
      layout_json: JSON.stringify({ widgets: currentWidgets } satisfies LayoutPayload),
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    flashNotice(t('dashboards.saved'));
    await loadLayouts();
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    setError('');
    const res = await deleteDashboardLayout(id);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setConfirmDeleteId('');
    if (activeId === id) setActiveId('');
    flashNotice(t('dashboards.deleted'));
    await loadLayouts();
  };

  const activeLayout = layouts.find(l => l.id === activeId);

  return (
    <div
      className="mb-4 p-4 rounded-xl"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      aria-busy={isLoading || busy}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <LayoutGrid size={14} className="text-[var(--primary)]" />
          {t('dashboards.title')}
        </h3>
        {(isLoading || busy) && (
          <span role="status" aria-live="polite" className="inline-flex items-center">
            <Loader2 size={14} className="animate-spin text-[var(--text-muted)]" aria-hidden />
            <span className="sr-only">{t('dashboards.loading')}</span>
          </span>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 px-3 py-2 rounded-lg text-xs"
          style={{ background: 'var(--danger-soft, rgba(233,61,61,0.10))', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 px-3 py-2 rounded-lg text-xs"
          style={{ background: 'var(--success-soft, rgba(55,202,55,0.10))', color: 'var(--success)' }}
        >
          {notice}
        </div>
      )}

      {/* État chargement */}
      {isLoading ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('dashboards.loading')}
        </p>
      ) : layouts.length === 0 && !creating ? (
        /* État vide */
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('dashboards.empty')}
          </p>
          <button
            type="button"
            onClick={() => { setCreating(true); setNewName(''); }}
            disabled={busy}
            className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition hover:bg-[var(--brand-tint)] disabled:opacity-50"
            style={{ border: '1px solid var(--border-default)', color: 'var(--primary)' }}
          >
            <Plus size={14} /> {t('dashboards.create_first')}
          </button>
        </div>
      ) : (
        <>
          {/* Sélecteur de layout actif + actions */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <label htmlFor={selectId} className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {t('dashboards.active_label')}
            </label>
            <select
              id={selectId}
              value={activeId}
              onChange={(e) => handleSelect(e.target.value)}
              disabled={busy}
              className="h-8 px-2 rounded-lg text-xs cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
            >
              <option value="">{t('dashboards.default_option')}</option>
              {layouts.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>

            {activeLayout && renamingId !== activeLayout.id && (
              <>
                <button
                  type="button"
                  onClick={() => void handleSaveCurrent(activeLayout.id)}
                  disabled={busy}
                  className="h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer transition hover:bg-[var(--bg-subtle)] disabled:opacity-50"
                  style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                  title={t('dashboards.save_current_title')}
                >
                  <Check size={13} /> {t('dashboards.save_current')}
                </button>
                <button
                  type="button"
                  onClick={() => startRename(activeLayout)}
                  disabled={busy}
                  className="h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer transition hover:bg-[var(--bg-subtle)] disabled:opacity-50"
                  style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                  title={t('dashboards.rename')}
                  aria-label={t('dashboards.rename')}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmDeleteId(activeLayout.id); setRenamingId(''); }}
                  disabled={busy}
                  className="h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer transition hover:bg-[var(--danger-soft,rgba(233,61,61,0.10))] disabled:opacity-50"
                  style={{ border: '1px solid var(--border-default)', color: 'var(--danger)' }}
                  title={t('dashboards.delete')}
                  aria-label={t('dashboards.delete')}
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => { setCreating(true); setNewName(''); setRenamingId(''); setConfirmDeleteId(''); }}
              disabled={busy || creating}
              className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition hover:bg-[var(--brand-tint)] disabled:opacity-50 ml-auto"
              style={{ border: '1px solid var(--border-default)', color: 'var(--primary)' }}
            >
              <Plus size={14} /> {t('dashboards.new')}
            </button>
          </div>

          {/* Renommage inline du layout actif */}
          {activeLayout && renamingId === activeLayout.id && (
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRename(activeLayout.id);
                  if (e.key === 'Escape') setRenamingId('');
                }}
                aria-label={t('dashboards.rename')}
                autoFocus
                className="h-8 px-2 rounded-lg text-xs flex-1"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--primary)', color: 'var(--text-primary)' }}
              />
              <button
                type="button"
                onClick={() => void handleRename(activeLayout.id)}
                disabled={busy || !renameName.trim()}
                className="h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer transition hover:bg-[var(--brand-tint)] disabled:opacity-50"
                style={{ border: '1px solid var(--border-default)', color: 'var(--primary)' }}
                aria-label={t('dashboards.confirm')}
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => setRenamingId('')}
                className="h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer transition hover:bg-[var(--bg-subtle)]"
                style={{ border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
                aria-label={t('dashboards.cancel')}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Confirmation de suppression */}
          {confirmDeleteId && (
            <div
              role="alertdialog"
              aria-label={t('dashboards.delete_confirm_title')}
              className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg"
              style={{ background: 'var(--danger-soft, rgba(233,61,61,0.08))', border: '1px solid var(--danger)' }}
            >
              <span className="text-xs flex-1" style={{ color: 'var(--danger)' }}>
                {t('dashboards.delete_confirm', { name: layouts.find(l => l.id === confirmDeleteId)?.name ?? '' })}
              </span>
              <button
                type="button"
                onClick={() => void handleDelete(confirmDeleteId)}
                disabled={busy}
                className="h-7 px-3 rounded-lg text-xs font-semibold cursor-pointer text-white transition disabled:opacity-50"
                style={{ background: 'var(--danger)' }}
              >
                {t('dashboards.delete_confirm_yes')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId('')}
                className="h-7 px-3 rounded-lg text-xs font-medium cursor-pointer transition hover:bg-[var(--bg-subtle)]"
                style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
              >
                {t('dashboards.cancel')}
              </button>
            </div>
          )}
        </>
      )}

      {/* Formulaire de création */}
      {creating && (
        <div className="flex items-center gap-2 mt-1">
          <input
            id={newNameId}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
              if (e.key === 'Escape') { setCreating(false); setNewName(''); }
            }}
            placeholder={t('dashboards.name_placeholder')}
            aria-label={t('dashboards.name_placeholder')}
            autoFocus
            className="h-8 px-2 rounded-lg text-xs flex-1"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--primary)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy || !newName.trim()}
            className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer text-white transition disabled:opacity-50"
            style={{ background: 'var(--primary)' }}
          >
            <Check size={14} /> {t('dashboards.save')}
          </button>
          <button
            type="button"
            onClick={() => { setCreating(false); setNewName(''); }}
            className="h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer transition hover:bg-[var(--bg-subtle)]"
            style={{ border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
            aria-label={t('dashboards.cancel')}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
