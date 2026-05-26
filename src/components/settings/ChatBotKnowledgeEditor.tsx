// ── ChatBotKnowledgeEditor — Sprint 42 (Agent B2) ──────────────────────────
// CRUD knowledge base entries pour l'AI Chat Agent (tenant courant).
//
// API back FIGÉE (Phase A) :
//   listChatKnowledge()         → ApiResponse<ChatKnowledgeBaseEntry[]>
//   createChatKnowledge(input)  → ApiResponse<ChatKnowledgeBaseEntry>
//   updateChatKnowledge(id,in)  → ApiResponse<ChatKnowledgeBaseEntry>
//   deleteChatKnowledge(id)     → ApiResponse<{ success: boolean }>
//
// Composant standalone : peut être monté tel quel par ChatBotSettings (B1)
// ou utilisé ailleurs (route dédiée, modale plein écran, etc.).
//
// Style : Stripe-clean, flat surfaces, focus ring purple, source badges
// neutres. Toutes chaînes via t(). Aucun console.log (CLAUDE.md).
// aria-labels i18n sur chaque action. Imports relatifs.

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import { Plus, Pencil, Trash2, BookOpen } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import {
  listChatKnowledge,
  createChatKnowledge,
  updateChatKnowledge,
  deleteChatKnowledge,
  type ChatKnowledgeBaseEntry,
  type ChatKnowledgeSource,
} from '../../lib/api';

// ── Constantes ─────────────────────────────────────────────────────────────

const CONTENT_MAX = 4000;
const PREVIEW_CHARS = 100;

const SOURCE_VALUES: ChatKnowledgeSource[] = ['manual', 'url', 'faq'];

function sourceLabel(s: ChatKnowledgeSource): string {
  if (s === 'url') return t('chat_bot.knowledge.source_url');
  if (s === 'faq') return t('chat_bot.knowledge.source_faq');
  return t('chat_bot.knowledge.source_manual');
}

const SOURCE_BADGE_CLASS: Record<ChatKnowledgeSource, string> = {
  manual:
    'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]',
  url: 'bg-sky-50 text-sky-700 border-sky-200',
  faq: 'bg-violet-50 text-violet-700 border-violet-200',
};

/** Tronque le content à PREVIEW_CHARS sans couper en plein mot si possible. */
function previewContent(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= PREVIEW_CHARS) return flat;
  const slice = flat.slice(0, PREVIEW_CHARS);
  const lastSpace = slice.lastIndexOf(' ');
  const safe = lastSpace > 60 ? slice.slice(0, lastSpace) : slice;
  return `${safe}…`;
}

// ── Composant ──────────────────────────────────────────────────────────────

export function ChatBotKnowledgeEditor() {
  const { success, error: toastError } = useToast();

  const [entries, setEntries] = useState<ChatKnowledgeBaseEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState<string>('');
  const [formContent, setFormContent] = useState<string>('');
  const [formSource, setFormSource] =
    useState<ChatKnowledgeSource>('manual');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Chargement initial ──────────────────────────────────────────────────
  const loadEntries = useCallback(async () => {
    setLoading(true);
    const res = await listChatKnowledge();
    if (res.error) {
      toastError(res.error);
      setEntries([]);
    } else if (res.data) {
      setEntries(res.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  // ── Form helpers ────────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setEditId(null);
    setFormTitle('');
    setFormContent('');
    setFormSource('manual');
  }, []);

  const handleOpenCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const handleOpenEdit = useCallback((entry: ChatKnowledgeBaseEntry) => {
    setEditId(entry.id);
    setFormTitle(entry.title);
    setFormContent(entry.content);
    setFormSource(entry.source);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(
    (open: boolean) => {
      setModalOpen(open);
      if (!open) resetForm();
    },
    [resetForm],
  );

  // ── Submit (create / update) ───────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const title = formTitle.trim();
      const content = formContent.trim();
      if (!title || !content) return;

      setSubmitting(true);
      const input = { title, content, source: formSource };
      const res = editId
        ? await updateChatKnowledge(editId, input)
        : await createChatKnowledge(input);
      setSubmitting(false);

      if (res.error) {
        toastError(res.error);
        return;
      }
      success(
        editId
          ? t('chat_bot.knowledge.title')
          : t('chat_bot.knowledge.create'),
      );
      setModalOpen(false);
      resetForm();
      void loadEntries();
    },
    [
      formTitle,
      formContent,
      formSource,
      editId,
      success,
      toastError,
      resetForm,
      loadEntries,
    ],
  );

  // ── Delete (soft-disable) ───────────────────────────────────────────────
  const handleDelete = useCallback(
    async (entry: ChatKnowledgeBaseEntry) => {
      const ok =
        typeof window === 'undefined'
          ? true
          : window.confirm(`${t('action.delete')} — ${entry.title}`);
      if (!ok) return;
      setBusyId(entry.id);
      const res = await deleteChatKnowledge(entry.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      void loadEntries();
    },
    [toastError, loadEntries],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  const contentLen = formContent.length;
  const submitDisabled =
    submitting || !formTitle.trim() || !formContent.trim();

  return (
    <div className="space-y-6" data-testid="chat-bot-knowledge-editor">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('chat_bot.knowledge.title')}</h2>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="md" />}
          aria-label={t('chat_bot.knowledge.create')}
        >
          {t('chat_bot.knowledge.create')}
        </Button>
      </header>

      {/* Liste / loading / empty */}
      {loading ? (
        <div className="space-y-3" data-testid="chat-bot-knowledge-loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Icon as={BookOpen} size={40} />}
          title={t('chat_bot.knowledge.empty')}
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('chat_bot.knowledge.create')}
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3 list-none p-0 m-0"
          data-testid="chat-bot-knowledge-list"
          aria-label={t('chat_bot.knowledge.title')}
        >
          {entries.map((entry) => {
            const isBusy = busyId === entry.id;
            const labelEdit = t('action.edit');
            const labelDelete = t('action.delete');
            return (
              <li
                key={entry.id}
                data-testid={`chat-bot-knowledge-row-${entry.id}`}
                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">
                      {entry.title}
                    </h3>
                    <span
                      data-testid={`chat-bot-knowledge-source-${entry.id}`}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${SOURCE_BADGE_CLASS[entry.source]}`}
                    >
                      {sourceLabel(entry.source)}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                    {previewContent(entry.content)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() => handleOpenEdit(entry)}
                    disabled={isBusy}
                    aria-label={`${labelEdit} — ${entry.title}`}
                  >
                    {labelEdit}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    onClick={() => void handleDelete(entry)}
                    disabled={isBusy}
                    aria-label={`${labelDelete} — ${entry.title}`}
                  >
                    {labelDelete}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal create / edit */}
      <Modal
        open={modalOpen}
        onOpenChange={handleCloseModal}
        title={
          editId
            ? `${t('action.edit')} — ${t('chat_bot.knowledge.title')}`
            : t('chat_bot.knowledge.create')
        }
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="kb-title"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('chat_bot.knowledge.title')}
            </label>
            <Input
              id="kb-title"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              autoFocus
              required
              maxLength={200}
              aria-label={t('chat_bot.knowledge.title')}
            />
          </div>

          <div>
            <label
              htmlFor="kb-content"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('chat_bot.knowledge.title')}
            </label>
            <Textarea
              id="kb-content"
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              rows={8}
              required
              maxLength={CONTENT_MAX}
              showCounter
              aria-label={t('chat_bot.knowledge.title')}
              aria-describedby="kb-content-count"
            />
            <div
              id="kb-content-count"
              className="text-xs text-[var(--text-muted)] mt-1 text-right tabular-nums"
              aria-live="polite"
            >
              {contentLen} / {CONTENT_MAX}
            </div>
          </div>

          <div>
            <label
              htmlFor="kb-source"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('chat_bot.knowledge.source_manual')}
            </label>
            <Select
              id="kb-source"
              value={formSource}
              onChange={(e) =>
                setFormSource(e.target.value as ChatKnowledgeSource)
              }
              aria-label={t('chat_bot.knowledge.source_manual')}
            >
              {SOURCE_VALUES.map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleCloseModal(false)}
              disabled={submitting}
            >
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              isLoading={submitting}
              disabled={submitDisabled}
              aria-label={editId ? t('action.save') : t('action.create')}
            >
              {editId ? t('action.save') : t('action.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
