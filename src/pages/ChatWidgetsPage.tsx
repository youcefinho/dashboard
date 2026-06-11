// ── ChatWidgetsPage — Sprint 36 (Agent B4) ──────────────────────────────────
// Page STANDALONE routée `/chat-widgets` — gestion des widgets de chat live.
// Liste les widgets (1 card par widget), ouvre un drawer ChatWidgetSettings
// (B1) en mode create ou edit, et expose toggle actif + delete + count sessions.
//
// API back FIGÉE (Phase A) :
//   getChatWidgets()                        → ApiResponse<ChatWidget[]>
//   updateChatWidget(id, { is_active })     → ApiResponse<ChatWidget>
//   deleteChatWidget(id)                    → ApiResponse<{ ok: true }>
//   getChatWidgetSessions(widgetId, …)      → ApiResponse<ChatSession[]>
//
// Style : Stripe-clean, cohérent avec SnapshotsPage (AppLayout + PageHero).
// Toutes les chaînes via t(). Aucun console.log (CLAUDE.md). aria-labels i18n.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { MessageCircle, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { PageHero } from '../components/ui/PageHero';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Icon } from '../components/ui/Icon';
import { SlidePanel } from '../components/ui/SlidePanel';
import { useToast } from '../components/ui/Toast';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { ChatWidgetSettings } from '../components/settings/ChatWidgetSettings';
import {
  getChatWidgets,
  updateChatWidget,
  deleteChatWidget,
  getChatWidgetSessions,
  type ChatWidget,
} from '../lib/api';
import { t } from '../lib/i18n';

// ── Types internes ──────────────────────────────────────────────────────────

interface WidgetRow {
  widget: ChatWidget;
  /** Nombre de sessions all-time (fetch on-demand). `null` = pas encore chargé. */
  sessionsCount: number | null;
}

type DrawerMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; widgetId: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Origins safely countées (NULL legacy = 0). */
function originsCount(widget: ChatWidget): number {
  return Array.isArray(widget.allowed_origins)
    ? widget.allowed_origins.length
    : 0;
}

/** Couleur hex sécurisée — fallback brand si null/empty. */
function safeColor(raw: string | null): string {
  if (!raw) return 'var(--primary, #00B5F5)';
  const v = raw.trim();
  if (!v) return 'var(--primary, #00B5F5)';
  return v;
}

// ── Composant ───────────────────────────────────────────────────────────────

export function ChatWidgetsPage() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  // ── État ────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<WidgetRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerMode>({ kind: 'closed' });
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Charge widgets + sessions counts ────────────────────────────────────
  const loadWidgets = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    const res = await getChatWidgets();
    if (res.error) {
      setLoadError(res.error);
      setIsLoading(false);
      return;
    }
    const widgets = res.data ?? [];
    // Affiche d'abord la liste (sessionsCount = null = "chargement"), puis
    // déclenche en parallèle les fetchs de count (UX rapide, pas de cascade).
    const initial: WidgetRow[] = widgets.map((w) => ({
      widget: w,
      sessionsCount: null,
    }));
    setRows(initial);
    setIsLoading(false);

    // Sessions counts en parallèle — best-effort (erreur = on laisse null).
    await Promise.all(
      widgets.map(async (w) => {
        const sres = await getChatWidgetSessions(w.id, { limit: 200 });
        if (sres.data) {
          setRows((prev) =>
            prev.map((r) =>
              r.widget.id === w.id
                ? { ...r, sessionsCount: sres.data?.length ?? 0 }
                : r,
            ),
          );
        }
      }),
    );
  }, []);

  useEffect(() => {
    void loadWidgets();
  }, [loadWidgets]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleCreate = useCallback(() => {
    setDrawer({ kind: 'create' });
  }, []);

  const handleEdit = useCallback((widgetId: string) => {
    setDrawer({ kind: 'edit', widgetId });
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawer({ kind: 'closed' });
  }, []);

  const handleSaved = useCallback(() => {
    setDrawer({ kind: 'closed' });
    void loadWidgets();
  }, [loadWidgets]);

  const handleToggleActive = useCallback(
    async (widget: ChatWidget): Promise<void> => {
      setTogglingId(widget.id);
      const next = widget.is_active === 1 ? false : true;
      const res = await updateChatWidget(widget.id, { is_active: next });
      setTogglingId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      // Mise à jour optimiste locale en cas de succès (évite un re-fetch full).
      if (res.data) {
        const updated = res.data;
        setRows((prev) =>
          prev.map((r) =>
            r.widget.id === widget.id ? { ...r, widget: updated } : r,
          ),
        );
      }
      success(t('toast.saved'));
    },
    [success, toastError],
  );

  const handleDelete = useCallback(
    async (widget: ChatWidget): Promise<void> => {
      const ok = await confirm({
        title: t('chat_widgets.delete_confirm'),
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      setDeletingId(widget.id);
      const res = await deleteChatWidget(widget.id);
      setDeletingId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      setRows((prev) => prev.filter((r) => r.widget.id !== widget.id));
      success(t('toast.deleted'));
    },
    [confirm, success, toastError],
  );

  // ── Drawer title (i18n) ─────────────────────────────────────────────────
  const drawerTitle = useMemo<string>(() => {
    if (drawer.kind === 'create') return t('chat_widgets.create');
    if (drawer.kind === 'edit') return t('chat_widgets.title');
    return '';
  }, [drawer]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <AppLayout title={t('chat_widgets.title')}>
      <PageHero
        meta="Workspace · Live chat"
        title={t('chat_widgets.title')}
        highlight={t('chat_widgets.title')}
        description={t('chat_widgets.snippet_help')}
        actions={
          <Button
            variant="premium"
            onClick={handleCreate}
            leftIcon={<Icon as={Plus} size="sm" />}
            aria-label={t('chat_widgets.create')}
            data-testid="cwp-btn-create"
          >
            {t('chat_widgets.create')}
          </Button>
        }
      />

      {/* ── Body : liste cards ─────────────────────────────────────────── */}
      {isLoading ? (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          data-testid="cwp-loading"
        >
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex flex-col gap-3 p-5">
              <Skeleton className="h-5 w-2/3 rounded-md" />
              <Skeleton className="h-3 w-1/2 rounded-md" />
              <Skeleton className="h-3 w-1/3 rounded-md" />
              <div className="mt-2 flex gap-2">
                <Skeleton className="h-8 w-20 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </Card>
          ))}
        </div>
      ) : loadError ? (
        <Card
          className="p-6"
          aria-live="polite"
          role="alert"
          data-testid="cwp-error"
        >
          <p className="text-sm text-[var(--danger-text)]">{loadError}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadWidgets()}
            className="mt-3"
            aria-label={`${t('action.retry')} — ${t('chat_widgets.title')}`}
            data-testid="cwp-btn-retry"
          >
            {t('action.retry')}
          </Button>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-0" data-testid="cwp-empty">
          <EmptyState
            icon={<Icon as={MessageCircle} size="md" />}
            title={t('chat_widgets.list_empty')}
            action={
              <Button
                variant="premium"
                onClick={handleCreate}
                leftIcon={<Icon as={Plus} size="sm" />}
                aria-label={t('chat_widgets.create')}
                data-testid="cwp-btn-create-empty"
              >
                {t('chat_widgets.create')}
              </Button>
            }
          />
        </Card>
      ) : (
        <ul
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-stagger stagger-1"
          aria-label={t('chat_widgets.title')}
          data-testid="cwp-list"
        >
          {rows.map((row) => {
            const w = row.widget;
            const isActive = w.is_active === 1;
            const isToggling = togglingId === w.id;
            const isDeleting = deletingId === w.id;
            const origins = originsCount(w);
            const sessions = row.sessionsCount;
            return (
              <li key={w.id}>
                <Card
                  className="flex h-full flex-col gap-4 p-5 stripe-card hover-lift-stripe"
                  data-testid={`cwp-card-${w.id}`}
                >
                  {/* Header : name + couleur + statut */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full border border-[var(--border-subtle)]"
                        style={{ backgroundColor: safeColor(w.primary_color) }}
                        aria-label={t('chat_widgets.primary_color')}
                        data-testid={`cwp-color-${w.id}`}
                      />
                      <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {w.name ?? t('chat_widgets.name')}
                      </span>
                    </div>
                    <Badge
                      intent={isActive ? 'success' : 'neutral'}
                      fill="soft"
                      size="sm"
                      dot
                      aria-label={
                        isActive ? t('chat_inbox.online') : t('chat_inbox.offline')
                      }
                    >
                      {isActive
                        ? t('chat_inbox.online')
                        : t('chat_inbox.offline')}
                    </Badge>
                  </div>

                  {/* Body : meta (origins, sessions, position) */}
                  <dl className="flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
                    <div className="flex justify-between gap-2">
                      <dt>{t('chat_widgets.allowed_origins')}</dt>
                      <dd className="font-mono text-[var(--text-primary)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {origins}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>{t('chat_widgets.sessions_history')}</dt>
                      <dd
                        className="font-mono text-[var(--text-primary)]"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                        data-testid={`cwp-sessions-${w.id}`}
                      >
                        {sessions === null ? '…' : sessions}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>{t('chat_widgets.position')}</dt>
                      <dd className="font-mono text-[var(--text-primary)]">
                        {w.position}
                      </dd>
                    </div>
                  </dl>

                  {/* Footer : actions */}
                  <div className="mt-auto flex flex-wrap gap-2 pt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Icon as={Pencil} size="sm" />}
                      onClick={() => handleEdit(w.id)}
                      aria-label={`${t('action.edit')} — ${w.name ?? ''}`}
                      data-testid={`cwp-btn-edit-${w.id}`}
                    >
                      {t('action.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Icon as={Power} size="sm" />}
                      onClick={() => void handleToggleActive(w)}
                      disabled={isToggling}
                      isLoading={isToggling}
                      aria-label={
                        isActive
                          ? `${t('chat_inbox.offline')} — ${w.name ?? ''}`
                          : `${t('chat_inbox.online')} — ${w.name ?? ''}`
                      }
                      data-testid={`cwp-btn-toggle-${w.id}`}
                    >
                      {isActive
                        ? t('chat_inbox.offline')
                        : t('chat_inbox.online')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Icon as={Trash2} size="sm" />}
                      onClick={() => void handleDelete(w)}
                      disabled={isDeleting}
                      isLoading={isDeleting}
                      aria-label={`${t('action.delete')} — ${w.name ?? ''}`}
                      data-testid={`cwp-btn-delete-${w.id}`}
                      className="ml-auto text-[var(--danger-text)]"
                    >
                      {t('action.delete')}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Drawer : create / edit ─────────────────────────────────────── */}
      <SlidePanel
        open={drawer.kind !== 'closed'}
        onOpenChange={(open) => {
          if (!open) handleCloseDrawer();
        }}
        title={drawerTitle}
        size="xl"
        closeLabel={t('action.cancel')}
        bodyClassName="px-5 py-5"
      >
        {drawer.kind === 'closed' ? null : (
          <ChatWidgetSettings
            widgetId={drawer.kind === 'edit' ? drawer.widgetId : undefined}
            onSaved={handleSaved}
          />
        )}
      </SlidePanel>
    </AppLayout>
  );
}

export default ChatWidgetsPage;
